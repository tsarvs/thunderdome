import { describe, expect, it } from 'vitest';
import { findDuplicateIds, validateManifestEntry } from '../src/manifests.js';

const validBotManifest = {
  id: 'random-rps',
  name: 'Random RPS',
  version: '1.0.0',
  game: 'rock-paper-scissors',
  author: { name: 'Jane Doe', contact: 'jane@example.com' },
  runtime: { language: 'node' },
  interface: { transport: 'stdio' },
  protocolVersion: '^1.0',
};

const validGameManifest = {
  id: 'rock-paper-scissors',
  name: 'Rock Paper Scissors',
  version: '1.0.0',
  entryPackage: '@thunderdome/game-rock-paper-scissors',
  protocolVersion: '^1.0',
  minParticipants: 2,
  maxParticipants: 2,
  maintainers: [{ name: 'Jane Doe', contact: 'jane@example.com' }],
};

describe('validateManifestEntry', () => {
  it('accepts a valid bot manifest whose id and game match its nested directory', () => {
    const issues = validateManifestEntry({
      path: 'bots/rock-paper-scissors/random-rps/manifest.json',
      raw: validBotManifest,
    });
    expect(issues).toEqual([]);
  });

  it('rejects a bot manifest that fails schema validation', () => {
    const issues = validateManifestEntry({
      path: 'bots/rock-paper-scissors/random-rps/manifest.json',
      raw: { ...validBotManifest, version: 'not-semver' },
    });
    expect(issues.map((i) => i.code)).toEqual(['invalid-bot-manifest']);
  });

  it('rejects a bot manifest whose id does not match its directory name', () => {
    const issues = validateManifestEntry({
      path: 'bots/rock-paper-scissors/random-rps/manifest.json',
      raw: { ...validBotManifest, id: 'some-other-bot' },
    });
    expect(issues.map((i) => i.code)).toEqual(['manifest-id-mismatch']);
  });

  it('rejects a bot manifest whose game does not match its directory grouping', () => {
    const issues = validateManifestEntry({
      path: 'bots/rock-paper-scissors/random-rps/manifest.json',
      raw: { ...validBotManifest, game: 'chess' },
    });
    expect(issues.map((i) => i.code)).toEqual(['manifest-game-mismatch']);
  });

  it('reports both an id and a game mismatch together when both are wrong', () => {
    const issues = validateManifestEntry({
      path: 'bots/rock-paper-scissors/random-rps/manifest.json',
      raw: { ...validBotManifest, id: 'some-other-bot', game: 'chess' },
    });
    expect(issues.map((i) => i.code).sort()).toEqual([
      'manifest-game-mismatch',
      'manifest-id-mismatch',
    ]);
  });

  it('accepts a valid game manifest whose id matches its directory', () => {
    const issues = validateManifestEntry({
      path: 'games/rock-paper-scissors/manifest.json',
      raw: validGameManifest,
    });
    expect(issues).toEqual([]);
  });

  it('rejects a game manifest that fails schema validation', () => {
    const issues = validateManifestEntry({
      path: 'games/rock-paper-scissors/manifest.json',
      raw: { ...validGameManifest, maintainers: [] },
    });
    expect(issues.map((i) => i.code)).toEqual(['invalid-game-manifest']);
  });

  it('returns no issues for a path outside bots/ and games/', () => {
    const issues = validateManifestEntry({ path: 'packages/engine/package.json', raw: {} });
    expect(issues).toEqual([]);
  });

  it('returns no issues for a bot manifest path missing the game-grouping level', () => {
    // The old flat bots/<id>/manifest.json shape no longer matches at all — this documents
    // that a path shaped like the pre-nesting layout is simply not recognized as a bot
    // manifest, rather than silently validated against the wrong assumptions.
    const issues = validateManifestEntry({
      path: 'bots/random-rps/manifest.json',
      raw: validBotManifest,
    });
    expect(issues).toEqual([]);
  });
});

describe('findDuplicateIds', () => {
  it('finds no issues when all ids are unique', () => {
    const issues = findDuplicateIds([
      { path: 'bots/rock-paper-scissors/random-rps/manifest.json', id: 'random-rps' },
      { path: 'bots/rock-paper-scissors/copycat-rps/manifest.json', id: 'copycat-rps' },
    ]);
    expect(issues).toEqual([]);
  });

  it('flags a duplicate id across two manifests, even under different game groupings', () => {
    const issues = findDuplicateIds([
      { path: 'bots/rock-paper-scissors/random-rps/manifest.json', id: 'random-rps' },
      { path: 'bots/chess/random-rps/manifest.json', id: 'random-rps' },
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe('duplicate-manifest-id');
    expect(issues[0]?.message).toContain('bots/rock-paper-scissors/random-rps/manifest.json');
    expect(issues[0]?.message).toContain('bots/chess/random-rps/manifest.json');
  });
});
