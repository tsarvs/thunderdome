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
} from '@thunderdome/runtime';

export async function runCleanupCommand(): Promise<number> {
  const containers = await listThunderdomeContainers();
  if (containers.length === 0) {
    console.log('No leftover Thunderdome containers found.');
  } else {
    console.log(`Found ${String(containers.length)} leftover container(s):`);
    for (const container of containers) {
      console.log(
        `  ${container.id.slice(0, 12)}  match=${container.matchId}  participant=${container.participantId}  state=${container.state}`,
      );
    }

    // Containers first — an image still referenced by a container can't be removed, so this
    // order is what makes the image removal below actually succeed instead of a no-op.
    await removeThunderdomeContainers(containers);
    console.log('Removed.');
  }

  const images = await listThunderdomeImages();
  if (images.length === 0) {
    console.log('No leftover Thunderdome bot images found.');
  } else {
    console.log(`Found ${String(images.length)} leftover bot image(s):`);
    for (const image of images) {
      console.log(`  ${image.id.slice(0, 19)}  ${image.tags.join(', ')}`);
    }

    await removeThunderdomeImages(images);
    console.log('Removed.');
  }

  return 0;
}
