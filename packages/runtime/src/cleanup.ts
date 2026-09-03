// A backstop, not the primary defense: `runSingleMatch` (apps/cli/src/lib/match-execution.ts)
// and its interrupt handler are what should normally tear every container down. This exists for
// whatever slips past both — most notably a `SIGKILL` (or a host crash) that never gives the CLI
// process a chance to run any of its own cleanup code at all. Every container this platform
// creates carries the `thunderdome.matchId`/`thunderdome.participantId` labels
// (docs/adr/0003-docker-bot-isolation.md, packages/runtime/src/docker-config.ts) regardless of
// which process created it or whether that process is still alive, so this never needs to know
// about matches, lifecycles, or anything else — only the label. Images have no such label (only
// containers do), so image cleanup below matches on the `thunderdome-bot-` tag prefix instead.
// There is no separate volume cleanup: bots never mount named/bind volumes (`Binds: []`), so the
// only volumes a bot container could ever have are anonymous ones from its own image, which
// `removeThunderdomeContainers` already takes with it via `v: true`.
import Docker from 'dockerode';
import { THUNDERDOME_BOT_IMAGE_TAG_PREFIX } from './image-build.js';

export interface ThunderdomeContainerInfo {
  id: string;
  matchId: string;
  participantId: string;
  /** Docker's own container state string, e.g. `"running"`, `"exited"`, `"created"`. */
  state: string;
}

export interface RemovalFailure {
  id: string;
  reason: string;
}

/** `removedCount` includes anything that was already gone by the time removal ran (a 404 from
 * the daemon) — that's a success from the caller's perspective, not a failure. Only `failures`
 * are genuine: the daemon rejected the removal for some other reason (most commonly a transient
 * one, e.g. the container's own teardown hadn't fully released its resources yet), and the
 * resource is still actually present. */
export interface RemovalOutcome {
  removedCount: number;
  failures: RemovalFailure[];
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'statusCode' in error && error.statusCode === 404
  );
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

/** Force-removes every listed container, and along with it any anonymous volume Docker attached
 * to that container (`v: true`) — bots never mount named/bind volumes (`Binds: []` in
 * docker-config.ts), so an anonymous volume from a bot image's own `VOLUME` instruction is the
 * only kind of volume a bot container could have. One already gone by the time this runs (e.g.
 * removed by something else in the meantime) counts as removed, not a failure — but any other
 * rejection from the daemon (most commonly transient: the container's own teardown hadn't fully
 * released its resources yet) is reported back rather than silently swallowed, so a caller can
 * retry instead of wrongly believing everything is gone. */
export async function removeThunderdomeContainers(
  infos: readonly ThunderdomeContainerInfo[],
  docker: Docker = new Docker(),
): Promise<RemovalOutcome> {
  const failures: RemovalFailure[] = [];
  let removedCount = 0;
  await Promise.all(
    infos.map(async (info) => {
      try {
        await docker.getContainer(info.id).remove({ force: true, v: true });
        removedCount += 1;
      } catch (error) {
        if (isNotFoundError(error)) {
          removedCount += 1;
          return;
        }
        failures.push({ id: info.id, reason: reasonOf(error) });
      }
    }),
  );
  return { removedCount, failures };
}

export interface ThunderdomeImageInfo {
  id: string;
  /** Every tag on the image that matches the bot image convention (an image can carry other,
   * unrelated tags too — only these are what make it "ours"). */
  tags: string[];
}

/** Every image this platform has ever built for a bot that the daemon still knows about. Built
 * images carry no labels (only containers do), so this filters on the `thunderdome-bot-` tag
 * prefix from `botImageTag` instead. */
export async function listThunderdomeImages(
  docker: Docker = new Docker(),
): Promise<ThunderdomeImageInfo[]> {
  const images = await docker.listImages({
    filters: { reference: [`${THUNDERDOME_BOT_IMAGE_TAG_PREFIX}*`] },
  });
  return images.map((image) => ({
    id: image.Id,
    tags: (image.RepoTags ?? []).filter((tag) => tag.startsWith(THUNDERDOME_BOT_IMAGE_TAG_PREFIX)),
  }));
}

/** Force-removes every listed image. One already gone by the time this runs counts as removed,
 * not a failure. Anything else the daemon rejects — most commonly "still referenced by a
 * container this call didn't know about" (callers should remove containers first; see
 * `runCleanupCommand`) — is reported back rather than silently swallowed, so a caller can retry
 * instead of wrongly believing everything is gone. */
export async function removeThunderdomeImages(
  infos: readonly ThunderdomeImageInfo[],
  docker: Docker = new Docker(),
): Promise<RemovalOutcome> {
  const failures: RemovalFailure[] = [];
  let removedCount = 0;
  await Promise.all(
    infos.map(async (info) => {
      try {
        await docker.getImage(info.id).remove({ force: true });
        removedCount += 1;
      } catch (error) {
        if (isNotFoundError(error)) {
          removedCount += 1;
          return;
        }
        failures.push({ id: info.id, reason: reasonOf(error) });
      }
    }),
  );
  return { removedCount, failures };
}
