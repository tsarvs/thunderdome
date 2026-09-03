// `thunderdome cleanup` — a backstop for leftover bot containers and images (and, transitively,
// any anonymous volumes attached to those containers — see packages/runtime/src/cleanup.ts).
// `match run`/`tournament run` (via apps/cli/src/lib/match-execution.ts) and the CLI's own
// SIGINT/SIGTERM handler (apps/cli/src/index.ts) are the primary defense; this exists for
// whatever slips past both — most notably the process being SIGKILLed (or the host crashing)
// before either gets a chance to run. Formalizes what had been a manual `docker ps -a --filter
// label=thunderdome.matchId | xargs docker rm -f` habit during this project's own development.
import {
  listThunderdomeContainers,
  listThunderdomeImages,
  removeThunderdomeContainers,
  removeThunderdomeImages,
  type RemovalOutcome,
} from '@thunderdome/runtime';

// A removal failure here is almost always transient — most commonly the daemon still tearing
// down a container's resources at the storage-driver level even though the `remove()` call
// itself already returned — so retrying a few times, a moment apart, converges to zero without
// making the caller manually re-invoke this command over and over (which is what happened before
// this retry loop existed: a silently-swallowed failure looked identical to success, so the only
// way to actually finish the job was to keep running `cleanup` and hope).
const MAX_ATTEMPTS = 10;
const RETRY_DELAY_MS = 500;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function reportOutcome(outcome: RemovalOutcome): void {
  if (outcome.failures.length === 0) {
    console.log(`  removed ${String(outcome.removedCount)}`);
    return;
  }
  console.log(
    `  removed ${String(outcome.removedCount)}, ${String(outcome.failures.length)} failed to remove (retrying)`,
  );
  for (const failure of outcome.failures) {
    console.log(`    ${failure.id.slice(0, 12)}: ${failure.reason}`);
  }
}

async function cleanupContainers(): Promise<void> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const containers = await listThunderdomeContainers();
    if (containers.length === 0) {
      console.log('No leftover Thunderdome containers found.');
      return;
    }
    console.log(
      `Found ${String(containers.length)} leftover container(s) (attempt ${String(attempt)}/${String(MAX_ATTEMPTS)})...`,
    );
    for (const container of containers) {
      console.log(
        `  ${container.id.slice(0, 12)}  match=${container.matchId}  participant=${container.participantId}  state=${container.state}`,
      );
    }
    // Containers first — an image still referenced by a container can't be removed, so this
    // order is what makes the image cleanup below actually succeed instead of a no-op.
    reportOutcome(await removeThunderdomeContainers(containers));
    if (attempt < MAX_ATTEMPTS) {
      await delay(RETRY_DELAY_MS);
    }
  }

  const remaining = await listThunderdomeContainers();
  if (remaining.length === 0) {
    console.log('No leftover Thunderdome containers found.');
    return;
  }
  console.log(
    `Gave up after ${String(MAX_ATTEMPTS)} attempts — ${String(remaining.length)} container(s) still present.`,
  );
}

async function cleanupImages(): Promise<void> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const images = await listThunderdomeImages();
    if (images.length === 0) {
      console.log('No leftover Thunderdome bot images found.');
      return;
    }
    console.log(
      `Found ${String(images.length)} leftover bot image(s) (attempt ${String(attempt)}/${String(MAX_ATTEMPTS)})...`,
    );
    for (const image of images) {
      console.log(`  ${image.id.slice(0, 19)}  ${image.tags.join(', ')}`);
    }
    reportOutcome(await removeThunderdomeImages(images));
    if (attempt < MAX_ATTEMPTS) {
      await delay(RETRY_DELAY_MS);
    }
  }

  const remaining = await listThunderdomeImages();
  if (remaining.length === 0) {
    console.log('No leftover Thunderdome bot images found.');
    return;
  }
  console.log(
    `Gave up after ${String(MAX_ATTEMPTS)} attempts — ${String(remaining.length)} bot image(s) still present.`,
  );
}

export async function runCleanupCommand(): Promise<number> {
  await cleanupContainers();
  await cleanupImages();
  return 0;
}
