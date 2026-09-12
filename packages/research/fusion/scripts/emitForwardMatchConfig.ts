/**
 * Emits a complete `stock-market-4` FORWARD_SHADOW match `--config` JSON to stdout, wiring
 * `@thunderdome/research-fusion`'s fixture into `researchTimeline` via `buildResearchTimeline` —
 * the piece `match forward run` has no other way to get (unlike `runBacktest.ts`, which calls
 * `createResearchSnapshot` fresh per simulated day, a real match's config carries the whole
 * timeline up front once, at creation).
 *
 * Usage: yarn workspace @thunderdome/research-fusion run emit:forward-config -- \
 *   --market-dataset-id fusion-fundamental-v0 --market-dataset-version 3 \
 *   --start-date 2026-07-13 --end-date 2026-12-31 --universe ELMT,FURUKAWA,... > config.json
 */
import { createFusionFixtureDataset } from '../src/fixture.js';
import { buildResearchTimeline } from '../src/timeline.js';

function requireArg(args: Record<string, string>, name: string): string {
  const value = args[name];
  if (value === undefined) throw new Error(`missing required --${name}`);
  return value;
}

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token?.startsWith('--') !== true) continue;
    const name = token.slice(2);
    const value = argv[i + 1];
    if (value === undefined) throw new Error(`--${name} needs a value`);
    args[name] = value;
    i++;
  }
  return args;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const asOfDate = args['as-of-date'] ?? requireArg(args, 'end-date');
  const storeDir = args['store-dir'] ?? './.thunderdome/market-data';

  const dataset = createFusionFixtureDataset();
  const researchTimeline = buildResearchTimeline(dataset, asOfDate);

  const config = {
    gameType: 'FORWARD_SHADOW',
    marketDataUniverse: requireArg(args, 'universe').split(','),
    marketDataset: {
      id: requireArg(args, 'market-dataset-id'),
      version: requireArg(args, 'market-dataset-version'),
      storeDir,
    },
    startDate: requireArg(args, 'start-date'),
    endDate: requireArg(args, 'end-date'),
    researchTimeline,
  };

  process.stdout.write(JSON.stringify(config));
}

main();
