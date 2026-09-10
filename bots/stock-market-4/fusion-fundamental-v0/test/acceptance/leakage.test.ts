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

/**
 * Spec §22: a match that stops before Sept 8 must produce IDENTICAL Sept-7 behavior (decision AND
 * explanation, not just orders) to a match that later runs a Sept-8 round. This guards against any
 * bug where a bot's later round could retroactively "leak" into an earlier round's decision —
 * e.g. via some shared, pre-populated closure state.
 */
describe('point-in-time isolation: Sept 7 behavior is identical whether or not Sept 8 ever happens (spec §22)', () => {
  it('the Sept 7 decision is byte-for-byte identical whether the match ends there or continues into Sept 8', () => {
    const sept7Observation = buildObservation({
      round: 1,
      date: '2026-09-07',
      ticker: 'ELMT',
      priceDollars: 20,
      portfolio: emptyPortfolio(),
      researchSnapshot: fusionSnapshotAt(DAY_BEFORE_ACQUISITION),
    });

    // World A: a match that only ever runs the Sept 7 round.
    const decisionsA: unknown[] = [];
    const decideActionA = createDecideAction(DEFAULT_FUSION_FUNDAMENTAL_CONFIG, (d) => decisionsA.push(d));
    const actionA = decideActionA(sept7Observation);

    // World B: the same Sept 7 round, but the match continues into Sept 8 afterward.
    const decisionsB: unknown[] = [];
    const decideActionB = createDecideAction(DEFAULT_FUSION_FUNDAMENTAL_CONFIG, (d) => decisionsB.push(d));
    const actionB = decideActionB(sept7Observation);
    decideActionB(
      buildObservation({
        round: 2,
        date: '2026-09-08',
        ticker: 'ELMT',
        priceDollars: 20.5,
        portfolio: emptyPortfolio(),
        researchSnapshot: fusionSnapshotAt(ACQUISITION_DAY),
      }),
    );

    expect(actionA).toEqual(actionB);
    expect(decisionsA[0]).toEqual(decisionsB[0]);
  });
});
