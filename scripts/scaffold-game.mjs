#!/usr/bin/env node
/**
 * Scaffolds a new games/<game-id>/ workspace package — a minimal but real GameDefinition (see
 * docs/guides/game-authoring-guide.md) that builds, type-checks, and passes its own tests
 * unmodified. It plays a trivial "everyone submits a no-op action for N rounds, then it's a
 * draw" game — not a real game, just something that satisfies every method on the interface so
 * you have a working skeleton to replace piece by piece rather than an empty one to fill in
 * from scratch.
 *
 * Usage:
 *   node scripts/scaffold-game.mjs <game-id> [--name "Display Name"]
 *     [--min-participants N] [--max-participants N]
 *     [--maintainer-name "Name"] [--maintainer-contact "email"]
 *
 * Example:
 *   node scripts/scaffold-game.mjs card-game-hearts --name "Hearts"
 */
import { join } from 'node:path';
import {
  assertKebabCase,
  assertTargetIsFresh,
  gitConfig,
  insertIntoBashArray,
  kebabToCamel,
  kebabToPascal,
  kebabToTitle,
  parseArgs,
  REPO_ROOT,
  writeScaffoldFile,
} from './lib/scaffold-utils.mjs';

const args = parseArgs(process.argv.slice(2), {
  positionals: ['id'],
  flags: ['name', 'min-participants', 'max-participants', 'maintainer-name', 'maintainer-contact'],
});

if (!args.id) {
  console.error('Usage: node scripts/scaffold-game.mjs <game-id> [--name "Display Name"] ...');
  process.exit(1);
}

const id = args.id;
assertKebabCase(id, 'game-id');

const pascal = kebabToPascal(id);
const camel = kebabToCamel(id);
const title = args.name ?? kebabToTitle(id);
const minParticipants = Number.parseInt(args['min-participants'] ?? '2', 10);
const maxParticipants = Number.parseInt(args['max-participants'] ?? '2', 10);
if (maxParticipants < minParticipants) {
  throw new Error(
    `--max-participants (${String(maxParticipants)}) must be >= --min-participants (${String(minParticipants)})`,
  );
}

const NAME_POOL = ['alice', 'bob', 'carol', 'dave', 'erin', 'frank', 'grace', 'heidi'];
const testParticipantCount = Math.min(Math.max(minParticipants, 2), NAME_POOL.length);
const testParticipantIds = NAME_POOL.slice(0, testParticipantCount);

const maintainerName = args['maintainer-name'] ?? gitConfig('user.name') ?? 'Your Name';
const maintainerContact = args['maintainer-contact'] ?? gitConfig('user.email') ?? 'you@example.com';

const gameDir = join(REPO_ROOT, 'games', id);
assertTargetIsFresh(gameDir, 'games/<game-id>');

console.log(`Scaffolding games/${id}/ ("${title}")...`);

writeScaffoldFile(
  join(gameDir, 'manifest.json'),
  `${JSON.stringify(
    {
      id,
      name: title,
      version: '0.1.0',
      entryPackage: `@thunderdome/game-${id}`,
      protocolVersion: '^1.0',
      minParticipants,
      maxParticipants,
      deterministic: false,
      maintainers: [{ name: maintainerName, contact: maintainerContact }],
      description: `TODO: describe ${title}.`,
    },
    null,
    2,
  )}\n`,
);

writeScaffoldFile(
  join(gameDir, 'package.json'),
  `${JSON.stringify(
    {
      name: `@thunderdome/game-${id}`,
      version: '0.1.0',
      private: true,
      type: 'module',
      main: './dist/index.js',
      types: './dist/index.d.ts',
      scripts: {
        build: 'tsc -p tsconfig.json',
        typecheck: 'tsc -p tsconfig.test.json',
        test: 'vitest run',
      },
      dependencies: {
        '@thunderdome/engine': '^0.1.0',
        zod: '^3.23.8',
      },
    },
    null,
    2,
  )}\n`,
);

writeScaffoldFile(
  join(gameDir, 'tsconfig.json'),
  `${JSON.stringify(
    {
      extends: '../../tsconfig.base.json',
      compilerOptions: { outDir: 'dist', rootDir: 'src' },
      include: ['src'],
    },
    null,
    2,
  )}\n`,
);

writeScaffoldFile(
  join(gameDir, 'tsconfig.test.json'),
  `${JSON.stringify(
    {
      extends: './tsconfig.json',
      compilerOptions: { noEmit: true, rootDir: '.' },
      include: ['src', 'test'],
    },
    null,
    2,
  )}\n`,
);

writeScaffoldFile(
  join(gameDir, 'vitest.config.ts'),
  `import { defineConfig } from 'vitest/config';\n\nexport default defineConfig({ test: { environment: 'node' } });\n`,
);

writeScaffoldFile(
  join(gameDir, 'src', 'types.ts'),
  `import { z } from 'zod';

// TODO: replace with whatever your game actually needs to configure. See
// docs/guides/game-authoring-guide.md §9 for the parseConfig pattern this schema plugs into.
export const ${pascal}ConfigSchema = z.object({
  totalRounds: z.number().int().positive().default(10),
});
export type ${pascal}Config = z.infer<typeof ${pascal}ConfigSchema>;

// TODO: replace with your game's real action shape. This placeholder is a single no-op value so
// the scaffolded game runs unmodified — every participant "acts" but there's nothing to decide.
export const ${pascal}ActionSchema = z.object({ noop: z.literal(true) });
export type ${pascal}Action = z.infer<typeof ${pascal}ActionSchema>;

export interface ${pascal}State {
  participantIds: string[];
  config: ${pascal}Config;
  round: number;
}

// TODO: this is where a real game would add per-participant fields (hand, board, score, ...).
// See docs/adr/0005-observation-vs-game-state.md — getObservation, not TState, decides what a
// participant is told.
export interface ${pascal}Observation {
  round: number;
  totalRounds: number;
  opponentIds: string[];
}

// TODO: this is where a real game reports who won. This placeholder never has a winner — see
// getStandingOutcomes in game.ts, which always reports a draw for it.
export interface ${pascal}Result {
  participantIds: string[];
  totalRounds: number;
}
`,
);

writeScaffoldFile(
  join(gameDir, 'src', 'game.ts'),
  `import { err, ok, type GameDefinition, type StandingOutcome } from '@thunderdome/engine';
import {
  ${pascal}ActionSchema,
  ${pascal}ConfigSchema,
  type ${pascal}Action,
  type ${pascal}Config,
  type ${pascal}Observation,
  type ${pascal}Result,
  type ${pascal}State,
} from './types.js';

/**
 * ${title} — starter GameDefinition.
 *
 * This plays a trivial placeholder game: every round, all participants submit a no-op action,
 * and after \`config.totalRounds\` rounds it ends in a tie among everyone. It exists so the
 * scaffold builds, type-checks, and passes its own tests immediately — replace each method below
 * with your real rules. Walk through docs/guides/game-authoring-guide.md section by section as
 * you do; it's numbered to match the order below.
 */
export const ${camel}: GameDefinition<
  ${pascal}Config,
  ${pascal}State,
  ${pascal}Observation,
  ${pascal}Action,
  ${pascal}Result
> = {
  id: '${id}',
  version: '0.1.0',

  // §9 — parseConfig
  parseConfig(raw) {
    const result = ${pascal}ConfigSchema.safeParse(raw);
    return result.success
      ? ok(result.data)
      : err(result.error.issues.map((issue) => issue.message).join('; '));
  },

  // §3 — initialize, and where randomness is allowed to come from (the \`rng\` argument). This
  // game's manifest declares minParticipants: ${minParticipants}, maxParticipants: ${maxParticipants} — keep this
  // check in sync with the manifest if you change either.
  initialize({ participantIds, config }) {
    if (participantIds.length < ${minParticipants} || participantIds.length > ${maxParticipants}) {
      throw new Error(
        \`${id} requires between ${minParticipants} and ${maxParticipants} participants, got \${String(participantIds.length)}\`,
      );
    }
    return { participantIds: [...participantIds], config, round: 0 };
  },

  // §4 — getObservation: the sole authority for what a participant sees
  getObservation(state, participantId) {
    if (!state.participantIds.includes(participantId)) {
      throw new Error(\`unknown participant "\${participantId}"\`);
    }
    const opponentIds = state.participantIds.filter((candidateId) => candidateId !== participantId);
    return { round: state.round, totalRounds: state.config.totalRounds, opponentIds };
  },

  // §2 — who acts each round. This placeholder is simultaneous (like Rock-Paper-Scissors): every
  // participant is required to act every round. If your game is sequential (like Connect Four),
  // return just \`[{ participantId: state.participantIds[state.currentPlayerIndex], required: true }]\`
  // instead.
  getPendingActions(state) {
    return state.participantIds.map((participantId) => ({ participantId, required: true }));
  },

  // §5 — validateAction
  validateAction(_state, _participantId, raw) {
    const result = ${pascal}ActionSchema.safeParse(raw);
    return result.success ? ok(result.data) : err('action must be { noop: true }');
  },

  // §5 — resolve
  resolve({ state }) {
    return {
      nextState: { ...state, round: state.round + 1 },
      // TODO: emit whatever a spectator/replay would want to see about this round.
      events: [{ type: 'round-played', participantIds: state.participantIds }],
    };
  },

  // §6 — onMissingAction is optional; this placeholder omits it entirely, so a missing required
  // action just forfeits the match (the engine's default). Add it back if your game has a
  // sensible substitute action for a timed-out/invalid/disconnected participant.

  // §7 — isTerminal, getResult, getStandingOutcomes. Bounded by construction: exactly
  // totalRounds rounds are played, full stop — see the guide's §7 for why a new game should be
  // able to point at its own state and say concretely why this always becomes true.
  isTerminal(state) {
    return state.round >= state.config.totalRounds;
  },

  getResult(state) {
    return { participantIds: state.participantIds, totalRounds: state.config.totalRounds };
  },

  getStandingOutcomes(result) {
    // TODO: report a real winner/loser once resolve() actually decides one. This placeholder
    // always reports a tie, since the placeholder game has no way to win or lose.
    const outcomes: StandingOutcome[] = result.participantIds.map((participantId) => ({
      participantId,
      rank: 1,
      outcome: 'draw',
    }));
    return outcomes;
  },

  // §8 — resourceLimits (opaque to the engine; see docs/guides/security-model.md)
  resourceLimits: { cpus: 0.5, memoryMb: 128, turnTimeoutMs: 5000 },
};
`,
);

writeScaffoldFile(
  join(gameDir, 'src', 'index.ts'),
  `export * from './types.js';
export * from './game.js';

// The registry-driven CLI (@thunderdome/registry + apps/cli) resolves a game manifest's
// \`entryPackage\` and dynamically imports it — it can't statically know each game's own export
// name (\`${camel}\` here), so every game's entrypoint must also export its GameDefinition under
// this fixed name (games/rock-paper-scissors/src/index.ts established the convention).
export { ${camel} as game } from './game.js';
`,
);

writeScaffoldFile(
  join(gameDir, 'test', 'game.test.ts'),
  `import { createRng } from '@thunderdome/rng';
import { describe, expect, it } from 'vitest';
import { ${camel} } from '../src/game.js';

const rng = createRng(Buffer.alloc(16, 1));

// This game's manifest declares minParticipants: ${minParticipants}, maxParticipants: ${maxParticipants} — these
// tests use ${String(testParticipantIds.length)} participant(s) as a representative roster within that range.
const PARTICIPANT_IDS = ${JSON.stringify(testParticipantIds)};

function initialState(totalRounds = 3) {
  const configResult = ${camel}.parseConfig({ totalRounds });
  if (!configResult.ok) {
    throw new Error(configResult.reason);
  }
  return ${camel}.initialize({
    config: configResult.value,
    participantIds: PARTICIPANT_IDS,
    rng,
  });
}

describe('${camel}.parseConfig', () => {
  it('defaults totalRounds to 10 when omitted', () => {
    const result = ${camel}.parseConfig({});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.totalRounds).toBe(10);
    }
  });

  it('rejects a non-positive totalRounds', () => {
    expect(${camel}.parseConfig({ totalRounds: 0 }).ok).toBe(false);
  });
});

describe('${camel}.initialize', () => {
  it('rejects a participant roster outside [${minParticipants}, ${maxParticipants}]', () => {
    const configResult = ${camel}.parseConfig({});
    if (!configResult.ok) {
      throw new Error(configResult.reason);
    }
    expect(() =>
      ${camel}.initialize({ config: configResult.value, participantIds: [], rng }),
    ).toThrow();
  });
});

describe('${camel}.getObservation', () => {
  it("reports every other participant's id from each participant's own perspective", () => {
    const state = initialState();
    const [first, ...restFromFirst] = PARTICIPANT_IDS;
    const last = PARTICIPANT_IDS.at(-1);
    if (first === undefined || last === undefined) {
      throw new Error('PARTICIPANT_IDS must not be empty');
    }
    expect(${camel}.getObservation(state, first).opponentIds).toEqual(restFromFirst);
    expect(${camel}.getObservation(state, last).opponentIds).toEqual(
      PARTICIPANT_IDS.slice(0, -1),
    );
  });
});

describe('${camel}.getPendingActions / validateAction', () => {
  it('requires an action from every participant each round', () => {
    const state = initialState();
    expect(${camel}.getPendingActions(state)).toEqual(
      PARTICIPANT_IDS.map((participantId) => ({ participantId, required: true })),
    );
  });

  it('accepts the no-op action and rejects anything else', () => {
    const state = initialState();
    const [firstParticipantId] = PARTICIPANT_IDS;
    if (firstParticipantId === undefined) {
      throw new Error('PARTICIPANT_IDS must not be empty');
    }
    expect(${camel}.validateAction(state, firstParticipantId, { noop: true }).ok).toBe(true);
    expect(${camel}.validateAction(state, firstParticipantId, {}).ok).toBe(false);
  });
});

describe('${camel}.resolve / isTerminal / getResult / getStandingOutcomes', () => {
  it('is terminal only once exactly totalRounds rounds have been played', () => {
    let state = initialState(2);
    const actions = new Map(PARTICIPANT_IDS.map((participantId) => [participantId, { noop: true as const }]));

    expect(${camel}.isTerminal(state)).toBe(false);
    state = ${camel}.resolve({ state, actions, rng }).nextState;
    expect(${camel}.isTerminal(state)).toBe(false);
    state = ${camel}.resolve({ state, actions, rng }).nextState;
    expect(${camel}.isTerminal(state)).toBe(true);

    const result = ${camel}.getResult(state);
    expect(result).toEqual({ participantIds: PARTICIPANT_IDS, totalRounds: 2 });
    expect(${camel}.getStandingOutcomes(result)).toEqual(
      PARTICIPANT_IDS.map((participantId) => ({ participantId, rank: 1, outcome: 'draw' })),
    );
  });
});
`,
);

insertIntoBashArray(
  join(REPO_ROOT, 'scripts', 'build.sh'),
  'INDEPENDENT_PACKAGES',
  `@thunderdome/game-${id}`,
);

console.log(`
Next steps:
  1. yarn install                                          # link the new workspace package
  2. yarn build && yarn lint && yarn typecheck && yarn test # confirm the placeholder builds clean
  3. Replace games/${id}/src/types.ts and src/game.ts with your real rules —
     docs/guides/game-authoring-guide.md walks through every method, in the same order the
     TODO comments reference.
  4. Scaffold at least one bot so the game is provably playable end to end:
       node scripts/scaffold-bot.mjs ${id} <bot-id>
     (see docs/guides/game-authoring-guide.md §12)
`);
