import { describe, expect, it } from 'vitest';
import { classifyChangedPaths } from '../src/classify.js';

describe('classifyChangedPaths', () => {
  it('passes a clean single-bot-directory PR', () => {
    const result = classifyChangedPaths({
      changedPaths: [
        'bots/rock-paper-scissors/random-rps/manifest.json',
        'bots/rock-paper-scissors/random-rps/index.mjs',
      ],
      hasOverrideLabel: false,
    });
    expect(result.issues).toEqual([]);
  });

  it('fails a PR touching multiple bot directories', () => {
    const result = classifyChangedPaths({
      changedPaths: [
        'bots/rock-paper-scissors/random-rps/manifest.json',
        'bots/rock-paper-scissors/copycat-rps/manifest.json',
      ],
      hasOverrideLabel: false,
    });
    expect(result.issues.map((i) => i.code)).toContain('multiple-bot-dirs');
  });

  it('fails a PR touching two bots even under the same game grouping', () => {
    // The game segment (rock-paper-scissors/) is shared, but the bot id is not — still two
    // distinct bot directories.
    const result = classifyChangedPaths({
      changedPaths: [
        'bots/rock-paper-scissors/random-rps/index.mjs',
        'bots/rock-paper-scissors/copycat-rps/index.mjs',
      ],
      hasOverrideLabel: false,
    });
    expect(result.issues.map((i) => i.code)).toContain('multiple-bot-dirs');
  });

  it('fails a PR mixing bots/** and platform paths without an override label', () => {
    const result = classifyChangedPaths({
      changedPaths: [
        'bots/rock-paper-scissors/random-rps/manifest.json',
        'packages/engine/src/index.ts',
      ],
      hasOverrideLabel: false,
    });
    expect(result.issues.map((i) => i.code)).toContain('mixed-scope');
  });

  it('allows the same mixed-scope PR when the maintainer-override label is applied', () => {
    const result = classifyChangedPaths({
      changedPaths: [
        'bots/rock-paper-scissors/random-rps/manifest.json',
        'packages/engine/src/index.ts',
      ],
      hasOverrideLabel: true,
    });
    expect(result.issues).toEqual([]);
    expect(result.warnings).toEqual(['maintainer-override applied — mixed-scope PR allowed.']);
  });

  it('does not flag a platform-only PR at all', () => {
    const result = classifyChangedPaths({
      changedPaths: ['packages/engine/src/index.ts', 'games/chess/src/index.ts'],
      hasOverrideLabel: false,
    });
    expect(result.issues).toEqual([]);
    expect(result.warnings).toEqual([]);
  });
});
