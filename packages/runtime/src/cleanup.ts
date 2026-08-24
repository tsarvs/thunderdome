// A backstop, not the primary defense: `runSingleMatch` (apps/cli/src/lib/match-execution.ts)
// and its interrupt handler are what should normally tear every container down. This exists for
// whatever slips past both — most notably a `SIGKILL` (or a host crash) that never gives the CLI
// process a chance to run any of its own cleanup code at all. Every container this platform
// creates carries the `thunderdome.matchId`/`thunderdome.participantId` labels
// (docs/adr/0003-docker-bot-isolation.md, packages/runtime/src/docker-config.ts) regardless of
// which process created it or whether that process is still alive, so this never needs to know
// about matches, lifecycles, or anything else — only the label.
import Docker from 'dockerode';

export interface ThunderdomeContainerInfo {
  id: string;
  matchId: string;
  participantId: string;
  /** Docker's own container state string, e.g. `"running"`, `"exited"`, `"created"`. */
  state: string;
}

/** Every container this platform has ever created that the daemon still knows about — running
 * or already exited, from this process or a different one entirely. */
export async function listThunderdomeContainers(
  docker: Docker = new Docker(),
): Promise<ThunderdomeContainerInfo[]> {
  const containers = await docker.listContainers({
    all: true,
    filters: { label: ['thunderdome.matchId'] },
  });
  return containers.map((container) => ({
    id: container.Id,
    matchId: container.Labels['thunderdome.matchId'] ?? 'unknown',
    participantId: container.Labels['thunderdome.participantId'] ?? 'unknown',
    state: container.State,
  }));
}

/** Force-removes every listed container. Best-effort: one already gone by the time this runs
 * (e.g. removed by something else in the meantime) is not an error. */
export async function removeThunderdomeContainers(
  infos: readonly ThunderdomeContainerInfo[],
  docker: Docker = new Docker(),
): Promise<void> {
  await Promise.all(
    infos.map(async (info) => {
      try {
        await docker.getContainer(info.id).remove({ force: true });
      } catch {
        // Already gone — fine.
      }
    }),
  );
}
