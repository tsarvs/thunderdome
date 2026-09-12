/**
 * Prints every entity currently in `data/dataset.json` as `id — name` lines, generated fresh from
 * the real dataset (never hand-copied, so it can't drift) — this is what a human pastes into
 * `portfolio-research-update-skill.md`'s prompt so a free web-research agent references EXISTING
 * companies/reactors/materials by their real ids instead of minting duplicates.
 *
 * Usage: yarn workspace @thunderdome/research-fusion run list:entities
 */
import { loadDatasetFromFile } from './applyResearchUpdate.js';

function main(): void {
  const dataset = loadDatasetFromFile();
  const sorted = [...dataset.entities].sort((a, b) => a.id.localeCompare(b.id));
  for (const entity of sorted) {
    console.log(`${entity.id} — ${entity.name}`);
  }
}

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main();
}
