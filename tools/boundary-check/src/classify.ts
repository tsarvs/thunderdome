export interface Issue {
  code: string;
  message: string;
}

export interface ClassifyOptions {
  changedPaths: readonly string[];
  hasOverrideLabel: boolean;
}

export interface ClassifyResult {
  issues: Issue[];
  warnings: string[];
}

// bots/<game-id>/<bot-id>/... — the atomic unit for "one bot directory per PR" is the
// (game, bot) pair, not just the first path segment (which is only the game grouping).
function botIdFromPath(path: string): string | undefined {
  return /^bots\/([^/]+\/[^/]+)\//.exec(path)?.[1];
}

/**
 * Mechanically enforces the one boundary that reviewer diligence alone can't reliably catch
 * across a high volume of low-scrutiny community PRs (docs/adr/0007-repository-enforcement.md):
 * a bot submission touches exactly one bots/<game>/<bot-id> directory and nothing else, unless
 * a maintainer has explicitly opted into a mixed-scope PR via the maintainer-override label.
 */
export function classifyChangedPaths(options: ClassifyOptions): ClassifyResult {
  const { changedPaths, hasOverrideLabel } = options;
  const issues: Issue[] = [];
  const warnings: string[] = [];

  const botPaths = changedPaths.filter((path) => path.startsWith('bots/'));
  const nonBotPaths = changedPaths.filter((path) => !path.startsWith('bots/'));
  const botIds = [...new Set(botPaths.map(botIdFromPath))].filter(
    (id): id is string => id !== undefined,
  );

  if (botPaths.length === 0) {
    return { issues, warnings };
  }

  if (botIds.length > 1) {
    issues.push({
      code: 'multiple-bot-dirs',
      message: `PR touches multiple bot directories: ${botIds.join(', ')} — a bot PR must modify exactly one bots/<game>/<bot-id> directory.`,
    });
  }

  if (nonBotPaths.length > 0) {
    if (hasOverrideLabel) {
      warnings.push('maintainer-override applied — mixed-scope PR allowed.');
    } else {
      const preview = nonBotPaths.slice(0, 5).join(', ');
      const suffix = nonBotPaths.length > 5 ? ', ...' : '';
      issues.push({
        code: 'mixed-scope',
        message: `PR touches platform/games paths alongside bots/** (${preview}${suffix}) — split into separate PRs, or have a maintainer apply the "maintainer-override" label.`,
      });
    }
  }

  return { issues, warnings };
}
