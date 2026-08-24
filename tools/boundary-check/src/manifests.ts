import { BotManifestSchema } from '@thunderdome/bot-sdk';
import { GameManifestSchema } from '@thunderdome/game-sdk';
import type { Issue } from './classify.js';

export interface ManifestEntry {
  path: string;
  raw: unknown;
}

export interface IdentifiedManifest {
  path: string;
  id: string;
}

const BOT_MANIFEST_PATH = /^bots\/([^/]+)\/([^/]+)\/manifest\.json$/;
const GAME_MANIFEST_PATH = /^games\/([^/]+)\/manifest\.json$/;

/**
 * Reading a competitor's or game's metadata must never require executing their code
 * (docs/adr/0001-monorepo-and-boundary.md) — this only ever parses manifest.json against the
 * shared Zod schemas owned by bot-sdk/game-sdk.
 */
export function validateManifestEntry(entry: ManifestEntry): Issue[] {
  const botMatch = BOT_MANIFEST_PATH.exec(entry.path);
  if (botMatch) {
    const gameSegment = botMatch[1];
    const botId = botMatch[2];
    if (gameSegment === undefined || botId === undefined) {
      throw new Error(
        `unreachable: BOT_MANIFEST_PATH matched but didn't capture both groups for "${entry.path}"`,
      );
    }

    const result = BotManifestSchema.safeParse(entry.raw);
    if (!result.success) {
      return [
        {
          code: 'invalid-bot-manifest',
          message: `${entry.path}: ${result.error.issues.map((i) => i.message).join('; ')}`,
        },
      ];
    }

    const issues: Issue[] = [];
    if (result.data.id !== botId) {
      issues.push({
        code: 'manifest-id-mismatch',
        message: `${entry.path}: manifest id "${result.data.id}" does not match directory "bots/${gameSegment}/${botId}"`,
      });
    }
    // bots/<game-id>/ is an organizational grouping, not an independent source of truth — it
    // must agree with the manifest's own `game` field, or the two would be free to drift apart.
    if (result.data.game !== gameSegment) {
      issues.push({
        code: 'manifest-game-mismatch',
        message: `${entry.path}: manifest game "${result.data.game}" does not match its directory grouping "bots/${gameSegment}/"`,
      });
    }
    return issues;
  }

  const gameMatch = GAME_MANIFEST_PATH.exec(entry.path);
  if (gameMatch) {
    const gameId = gameMatch[1];
    if (gameId === undefined) {
      throw new Error(
        `unreachable: GAME_MANIFEST_PATH matched but didn't capture a group for "${entry.path}"`,
      );
    }

    const result = GameManifestSchema.safeParse(entry.raw);
    if (!result.success) {
      return [
        {
          code: 'invalid-game-manifest',
          message: `${entry.path}: ${result.error.issues.map((i) => i.message).join('; ')}`,
        },
      ];
    }
    if (result.data.id !== gameId) {
      return [
        {
          code: 'manifest-id-mismatch',
          message: `${entry.path}: manifest id "${result.data.id}" does not match directory "games/${gameId}"`,
        },
      ];
    }
    return [];
  }

  return [];
}

/** Checked across every manifest in the repo, not just the ones changed by this PR. */
export function findDuplicateIds(manifests: readonly IdentifiedManifest[]): Issue[] {
  const byId = new Map<string, string[]>();
  for (const manifest of manifests) {
    const paths = byId.get(manifest.id) ?? [];
    paths.push(manifest.path);
    byId.set(manifest.id, paths);
  }

  const issues: Issue[] = [];
  for (const [id, paths] of byId) {
    if (paths.length > 1) {
      issues.push({
        code: 'duplicate-manifest-id',
        message: `id "${id}" is declared in multiple manifests: ${paths.join(', ')}`,
      });
    }
  }
  return issues;
}
