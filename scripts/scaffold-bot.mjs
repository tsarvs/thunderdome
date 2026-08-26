#!/usr/bin/env node
/**
 * Scaffolds a new bots/<game-id>/<bot-id>/ directory — a starter bot using @thunderdome/bot-sdk's
 * runBot() (see docs/guides/rps-bot-author-guide.md), with a decideAction() left as a TODO for
 * whatever game it's targeting. Works for any game, not just ones scaffolded by
 * scripts/scaffold-game.mjs.
 *
 * Usage:
 *   node scripts/scaffold-bot.mjs <game-id> <bot-id> [--name "Display Name"] [--lang ts|js]
 *     [--author-name "Name"] [--author-contact "email"]
 *
 * Example:
 *   node scripts/scaffold-bot.mjs card-game-hearts my-first-hearts-bot
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  assertKebabCase,
  assertTargetIsFresh,
  gitConfig,
  insertIntoBashArray,
  kebabToTitle,
  parseArgs,
  REPO_ROOT,
  writeScaffoldFile,
} from './lib/scaffold-utils.mjs';

const args = parseArgs(process.argv.slice(2), {
  positionals: ['gameId', 'botId'],
  flags: ['name', 'lang', 'author-name', 'author-contact'],
});

if (!args.gameId || !args.botId) {
  console.error(
    'Usage: node scripts/scaffold-bot.mjs <game-id> <bot-id> [--name "Display Name"] [--lang ts|js] ...',
  );
  process.exit(1);
}

const gameId = args.gameId;
const botId = args.botId;
assertKebabCase(gameId, 'game-id');
assertKebabCase(botId, 'bot-id');

const lang = args.lang ?? 'ts';
if (lang !== 'ts' && lang !== 'js') {
  throw new Error(`--lang must be "ts" or "js", got "${lang}"`);
}

const title = args.name ?? kebabToTitle(botId);
const authorName = args['author-name'] ?? gitConfig('user.name') ?? 'Your Name';
const authorContact = args['author-contact'] ?? gitConfig('user.email') ?? 'you@example.com';

const gameManifestPath = join(REPO_ROOT, 'games', gameId, 'manifest.json');
if (!existsSync(gameManifestPath)) {
  console.warn(
    `warning: games/${gameId}/manifest.json not found — proceeding anyway (the game may live ` +
      `outside this repo, or you haven't scaffolded/merged it yet).`,
  );
}

const botDir = join(REPO_ROOT, 'bots', gameId, botId);
assertTargetIsFresh(botDir, `bots/${gameId}/${botId}`);

console.log(`Scaffolding bots/${gameId}/${botId}/ ("${title}", ${lang})...`);

writeScaffoldFile(
  join(botDir, 'manifest.json'),
  `${JSON.stringify(
    {
      id: botId,
      name: title,
      version: '0.1.0',
      game: gameId,
      author: { name: authorName, contact: authorContact },
      runtime: { language: 'node' },
      interface: { transport: 'stdio' },
      protocolVersion: '^1.0',
      description: `TODO: describe ${title}'s strategy.`,
    },
    null,
    2,
  )}\n`,
);

if (lang === 'ts') {
  writeScaffoldFile(
    join(botDir, 'package.json'),
    `${JSON.stringify(
      {
        name: botId,
        version: '0.1.0',
        private: true,
        type: 'module',
        scripts: { build: 'tsc' },
        dependencies: { '@thunderdome/bot-sdk': 'file:./vendor/thunderdome-bot-sdk.tgz' },
        devDependencies: { '@types/node': '^25.0.0', typescript: '^5.6.3' },
      },
      null,
      2,
    )}\n`,
  );

  writeScaffoldFile(
    join(botDir, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          lib: ['ES2022'],
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          outDir: 'dist',
          rootDir: 'src',
          strict: true,
          skipLibCheck: true,
          esModuleInterop: true,
          forceConsistentCasingInFileNames: true,
        },
        include: ['src'],
      },
      null,
      2,
    )}\n`,
  );

  writeScaffoldFile(
    join(botDir, 'Dockerfile'),
    `FROM node:25-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY vendor ./vendor
RUN npm ci
COPY src ./src
RUN npm run build

# @thunderdome/bot-sdk is a real runtime dependency (not just a type-checking-time one), so the
# final image needs node_modules too — installed separately here with --omit=dev so
# typescript/@types/node never end up in the runtime image.
FROM node:25-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY vendor ./vendor
RUN npm ci --omit=dev

FROM node:25-alpine
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
ENTRYPOINT ["node", "dist/index.js"]
`,
  );

  writeScaffoldFile(
    join(botDir, 'src', 'index.ts'),
    `#!/usr/bin/env node
/**
 * ${title} — a starter bot for the "${gameId}" game.
 *
 * All of the NDJSON wire-protocol handling (the init/ready handshake, reading "observation",
 * exiting on "match-end") lives in @thunderdome/bot-sdk's runBot() — see
 * docs/guides/rps-bot-author-guide.md for the full protocol walkthrough. There are two things
 * left to do here:
 *   1. Replace the Observation/Action placeholder types below with the real shapes for
 *      "${gameId}" (check games/${gameId}/src/types.ts if it's defined in this repo).
 *   2. Implement decideAction().
 */
import { runBot } from '@thunderdome/bot-sdk';

// TODO: replace with the real observation shape for "${gameId}".
interface Observation {
  [key: string]: unknown;
}

// TODO: replace with the real action shape for "${gameId}".
interface Action {
  [key: string]: unknown;
}

function decideAction(_observation: Observation): Action {
  // TODO: implement your strategy.
  throw new Error('decideAction() is not implemented yet');
}

runBot<Observation, Action>({ decideAction });
`,
  );
} else {
  writeScaffoldFile(
    join(botDir, 'package.json'),
    `${JSON.stringify(
      {
        name: botId,
        version: '0.1.0',
        private: true,
        type: 'module',
        dependencies: { '@thunderdome/bot-sdk': 'file:./vendor/thunderdome-bot-sdk.tgz' },
      },
      null,
      2,
    )}\n`,
  );

  writeScaffoldFile(
    join(botDir, 'Dockerfile'),
    `FROM node:25-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY vendor ./vendor
RUN npm ci --omit=dev
COPY index.mjs ./
ENTRYPOINT ["node", "index.mjs"]
`,
  );

  writeScaffoldFile(
    join(botDir, 'index.mjs'),
    `#!/usr/bin/env node
/**
 * ${title} — a starter bot for the "${gameId}" game.
 *
 * All of the NDJSON wire-protocol handling (the init/ready handshake, reading "observation",
 * exiting on "match-end") lives in @thunderdome/bot-sdk's runBot() — see
 * docs/guides/rps-bot-author-guide.md for the full protocol walkthrough. There's one thing left
 * to do here: implement decideAction() below for however "${gameId}" observations/actions are
 * actually shaped (check games/${gameId}/src/types.ts if it's defined in this repo).
 *
 * If your strategy needs its own randomness, seed a PRNG from the \`rngSeed\` runBot() hands you
 * via \`onInit\` — never Math.random() (docs/adr/0004-deterministic-randomness.md) — see
 * bots/connect-four/random-connect-four/index.mjs for a worked example (mulberry32 PRNG seeded
 * from rngSeed).
 */
import { runBot } from '@thunderdome/bot-sdk';

function decideAction(_observation) {
  // TODO: implement your strategy.
  throw new Error('decideAction() is not implemented yet');
}

runBot({ decideAction });
`,
  );
}

writeScaffoldFile(
  join(botDir, 'vendor', '.gitkeep'),
  `This directory holds a vendored @thunderdome/bot-sdk tarball, generated by
scripts/pack-bot-sdk.sh — see that script's own comments for why bots/** vendors a tarball
instead of depending on the workspace package directly. Run it (from the repo root) to populate
this directory and generate a matching package-lock.json:

    ./scripts/pack-bot-sdk.sh
`,
);

const packBotSdkPath = join(REPO_ROOT, 'scripts', 'pack-bot-sdk.sh');
insertIntoBashArray(packBotSdkPath, 'BOT_DIRS', `bots/${gameId}/${botId}`);

console.log(`
Next steps:
  1. ./scripts/pack-bot-sdk.sh   # vendors @thunderdome/bot-sdk into bots/${gameId}/${botId}/
                                  # and generates its package-lock.json (requires network access)
  2. Fill in the Observation/Action types and decideAction() in
     bots/${gameId}/${botId}/${lang === 'ts' ? 'src/index.ts' : 'index.mjs'}
  3. docker build -t thunderdome-${botId} bots/${gameId}/${botId}
  4. yarn thunderdome match run ${botId} <another-bot-id> --config '{}'
     (see docs/guides/rps-bot-author-guide.md §7-8 for the full loop, including smoke-test.mjs)

IMPORTANT if you're submitting this as a community bot PR: tools/boundary-check (CI) requires a
bot PR to touch only bots/${gameId}/${botId}/** (docs/adr/0007-repository-enforcement.md). The
edit this script just made to scripts/pack-bot-sdk.sh is a platform-file change that will fail
that check if you commit it. Run pack-bot-sdk.sh locally to generate your vendor/ tarball and
package-lock.json as above, then revert the script edit before committing:
    git checkout -- scripts/pack-bot-sdk.sh
A maintainer will add your bot to BOT_DIRS separately when merging (or apply the
"maintainer-override" label if this really is a maintainer-authored reference bot meant to keep
that edit).
`);
