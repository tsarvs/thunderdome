import { describe, expect, it } from 'vitest';
import { DEFAULT_FUSION_FUNDAMENTAL_CONFIG } from '../../src/config.js';
import { createDecideAction } from '../../src/index.js';
import {
  buildObservation,
  DAY_BEFORE_ACQUISITION,
  ACQUISITION_DAY,
  emptyPortfolio,
  fusionSnapshotAt,
} from '../support/fixtures.js';

/** Spec §23: identical inputs must produce identical decisions and orders — no clock, no
 * randomness, no external I/O anywhere in the pipeline. Runs the exact same multi-round sequence
 * through two entirely separate bot instances and diffs every round's output. */
describe('determinism (spec §23)', () => {
  it('produces identical decisions across two independent runs of the same input sequence', () => {
    function runSequence() {
      const decisions: unknown[] = [];
      const decideAction = createDecideAction(DEFAULT_FUSION_FUNDAMENTAL_CONFIG, (d) => decisions.push(d));
      const portfolio = emptyPortfolio();

      const actions = [
        decideAction(
          buildObservation({
            round: 1,
            date: '2026-09-07',
            ticker: 'ELMT',
            priceDollars: 20,
            portfolio,
            researchSnapshot: fusionSnapshotAt(DAY_BEFORE_ACQUISITION),
          }),
        ),
        decideAction(
          buildObservation({
            round: 2,
            date: '2026-09-08',
            ticker: 'ELMT',
            priceDollars: 20.5,
            portfolio,
            researchSnapshot: fusionSnapshotAt(ACQUISITION_DAY),
          }),
        ),
      ];
      return { actions, decisions };
    }

    const runA = runSequence();
    const runB = runSequence();

    expect(runA.actions).toEqual(runB.actions);
    expect(runA.decisions).toEqual(runB.decisions);
  });

  it('running the same single round many times in fresh instances always yields the same result', () => {
    const results = Array.from({ length: 5 }, () => {
      const decideAction = createDecideAction(DEFAULT_FUSION_FUNDAMENTAL_CONFIG);
      return decideAction(
        buildObservation({
          round: 1,
          date: '2026-09-08',
          ticker: 'ELMT',
          priceDollars: 20,
          portfolio: emptyPortfolio(),
          researchSnapshot: fusionSnapshotAt(ACQUISITION_DAY),
        }),
      );
    });
    for (const result of results.slice(1)) {
      expect(result).toEqual(results[0]);
    }
  });
});
