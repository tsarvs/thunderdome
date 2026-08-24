// `thunderdome cleanup` — Phase 12's backstop for leftover bot containers. `match run`/
// `tournament run` (via apps/cli/src/lib/match-execution.ts) and the CLI's own SIGINT/SIGTERM
// handler (apps/cli/src/index.ts) are the primary defense; this exists for whatever slips past
// both — most notably the process being SIGKILLed (or the host crashing) before either gets a
// chance to run. Formalizes what had been a manual `docker ps -a --filter
// label=thunderdome.matchId | xargs docker rm -f` habit during this project's own development.
import { listThunderdomeContainers, removeThunderdomeContainers } from '@thunderdome/runtime';

export async function runCleanupCommand(): Promise<number> {
  const containers = await listThunderdomeContainers();
  if (containers.length === 0) {
    console.log('No leftover Thunderdome containers found.');
    return 0;
  }

  console.log(`Found ${String(containers.length)} leftover container(s):`);
  for (const container of containers) {
    console.log(
      `  ${container.id.slice(0, 12)}  match=${container.matchId}  participant=${container.participantId}  state=${container.state}`,
    );
  }

  await removeThunderdomeContainers(containers);
  console.log('Removed.');
  return 0;
}
