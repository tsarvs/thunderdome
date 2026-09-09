import { createResearchSnapshot } from '@thunderdome/research-core';
import { describe, expect, it } from 'vitest';
import { createFusionFixtureDataset, FUSION_FIXTURE_IDS } from '../src/index.js';

/**
 * The fixture's core proof (spec §45). WORLD TRUTH: Walter Tosto wins a commercial production
 * contract for SPARC vacuum vessels in 2029 — both a relationship-state transition and a
 * discrete event are recorded for it. RESEARCH: no evidence of this exists until 2029-03-01.
 *
 * A snapshot taken before that must not be able to see it, in ANY form — not the relationship
 * state, not the event, not the evidence, not even as a stray string in the serialized JSON —
 * even though the full dataset (constructed with hindsight) already contains it.
 */
describe('critical information-leak test: the 2029 production contract', () => {
  const dataset = createFusionFixtureDataset();

  it('the full dataset (world truth, built with hindsight) does contain the production contract', () => {
    const relationship = dataset.relationships.find(
      (r) => r.id === FUSION_FIXTURE_IDS.relationships.walterTostoSparc,
    );
    expect(relationship?.states.some((s) => s.status === 'production contract')).toBe(true);
    expect(dataset.events.some((e) => e.type === 'SUPPLIER_WON_PRODUCTION_CONTRACT')).toBe(true);
    expect(
      dataset.evidence.some(
        (e) => e.id === FUSION_FIXTURE_IDS.evidence.walterTostoProductionContract,
      ),
    ).toBe(true);
  });

  it('a 2028 snapshot does not see the production-contract relationship state', () => {
    const snapshot = createResearchSnapshot(dataset, '2028-12-31T23:59:59Z');
    const relationship = snapshot.state.relationships.find(
      (r) => r.id === FUSION_FIXTURE_IDS.relationships.walterTostoSparc,
    );
    expect(relationship?.states.some((s) => s.status === 'production contract')).toBe(false);
  });

  it('a 2028 snapshot does not see the SUPPLIER_WON_PRODUCTION_CONTRACT event', () => {
    const snapshot = createResearchSnapshot(dataset, '2028-12-31T23:59:59Z');
    expect(snapshot.state.events.some((e) => e.type === 'SUPPLIER_WON_PRODUCTION_CONTRACT')).toBe(
      false,
    );
  });

  it('a 2028 snapshot does not see the supporting evidence', () => {
    const snapshot = createResearchSnapshot(dataset, '2028-12-31T23:59:59Z');
    expect(
      snapshot.state.evidence.some(
        (e) => e.id === FUSION_FIXTURE_IDS.evidence.walterTostoProductionContract,
      ),
    ).toBe(false);
  });

  it('the serialized 2028 snapshot contains no trace of it as a string, anywhere', () => {
    // Note: "production contract" alone is NOT a safe substring to check here — the dataset
    // separately (and correctly) contains that phrase for the A.L.M.T./Sumitomo ITER
    // relationships, which were already known in 2021. This checks markers unique to the 2029
    // Walter Tosto event instead.
    const snapshot = createResearchSnapshot(dataset, '2028-12-31T23:59:59Z');
    const json = JSON.stringify(snapshot);
    expect(json).not.toContain('Walter Tosto announced a commercial production contract');
    expect(json).not.toContain('SUPPLIER_WON_PRODUCTION_CONTRACT');
    expect(json).not.toContain(FUSION_FIXTURE_IDS.evidence.walterTostoProductionContract);
  });

  it('a snapshot taken exactly the day before it happened still cannot see it', () => {
    const snapshot = createResearchSnapshot(dataset, '2029-02-28T23:59:59Z');
    expect(JSON.stringify(snapshot)).not.toContain(
      'Walter Tosto announced a commercial production contract',
    );
  });

  it('a snapshot taken once it was recorded DOES see it', () => {
    const snapshot = createResearchSnapshot(dataset, '2029-03-01T00:00:00Z');
    const relationship = snapshot.state.relationships.find(
      (r) => r.id === FUSION_FIXTURE_IDS.relationships.walterTostoSparc,
    );
    expect(relationship?.states.some((s) => s.status === 'production contract')).toBe(true);
    expect(snapshot.state.events.some((e) => e.type === 'SUPPLIER_WON_PRODUCTION_CONTRACT')).toBe(
      true,
    );
  });

  it('never mutates the source dataset while producing snapshots', () => {
    const before = JSON.stringify(dataset);
    createResearchSnapshot(dataset, '2028-12-31T23:59:59Z');
    createResearchSnapshot(dataset, '2029-06-01T00:00:00Z');
    expect(JSON.stringify(dataset)).toBe(before);
  });
});

/**
 * A second, independent point-in-time case from the September 2026 research dump: ELMT's
 * ams OSRAM acquisition was announced (SEC Exhibit 99.1) on 2026-09-08. A decision made even one
 * day earlier must not see it.
 */
describe('point-in-time test: the ELMT / ams OSRAM acquisition (announced 2026-09-08)', () => {
  const dataset = createFusionFixtureDataset();

  it('is absent from a snapshot taken the day before the announcement', () => {
    // Note: "ams OSRAM" the company name alone is NOT a safe substring here — the entity
    // legitimately exists as known background (recordedAt 2023, like every other company in
    // this fixture) well before the acquisition itself was ever announced. This checks the
    // acquisition-specific evidence/event instead.
    const snapshot = createResearchSnapshot(dataset, '2026-09-07T23:59:59Z');
    expect(snapshot.state.events.some((e) => e.type === 'ACQUISITION_ANNOUNCED')).toBe(false);
    expect(
      snapshot.state.evidence.some(
        (e) => e.id === FUSION_FIXTURE_IDS.evidence.elmtAmsOsramAcquisition,
      ),
    ).toBe(false);
    expect(JSON.stringify(snapshot)).not.toContain('Schwabm');
    expect(JSON.stringify(snapshot)).not.toContain('definitive agreement');
  });

  it('is present from the moment of the announcement', () => {
    const snapshot = createResearchSnapshot(dataset, '2026-09-08T00:00:00Z');
    expect(snapshot.state.events.some((e) => e.type === 'ACQUISITION_ANNOUNCED')).toBe(true);
    expect(
      snapshot.state.evidence.some(
        (e) => e.id === FUSION_FIXTURE_IDS.evidence.elmtAmsOsramAcquisition,
      ),
    ).toBe(true);
  });
});

/**
 * A third point-in-time case: Vitzro Nextech's Hanwha Aerospace contract, announced 2026-08-06 —
 * explicitly NOT a fusion contract, but still subject to the same point-in-time discipline.
 */
describe('point-in-time test: the Vitzro Nextech / Hanwha Aerospace contract (announced 2026-08-06)', () => {
  const dataset = createFusionFixtureDataset();

  it('is absent from a snapshot taken the day before the announcement', () => {
    const snapshot = createResearchSnapshot(dataset, '2026-08-05T23:59:59Z');
    expect(snapshot.state.events.some((e) => e.type === 'AEROSPACE_CONTRACT_AWARDED')).toBe(false);
    expect(JSON.stringify(snapshot)).not.toContain('Hanwha');
  });

  it('is present from the moment of the announcement', () => {
    const snapshot = createResearchSnapshot(dataset, '2026-08-06T00:00:00Z');
    expect(snapshot.state.events.some((e) => e.type === 'AEROSPACE_CONTRACT_AWARDED')).toBe(true);
  });
});
