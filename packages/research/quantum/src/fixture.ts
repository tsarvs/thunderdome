import type { ResearchDataset } from '@thunderdome/research-core';

/**
 * Deliberately a skeleton, not a domain model: just enough to prove that
 * `@thunderdome/research-core`'s schema is generic across a SECOND, unrelated domain — using its
 * own vocabulary (`"quantum-architecture"`, `"error-correction-code"`, ...) that research-core
 * never inspects — without requiring any change to research-core itself (spec §53). Building out
 * this package's real quantum research is future work; see README.md.
 */
export const QUANTUM_FIXTURE_IDS = {
  entities: {
    ibmQuantum: 'entity-ibm-quantum',
    superconductingQubit: 'entity-superconducting-qubit',
    surfaceCode: 'entity-surface-code',
  },
  relationships: {
    ibmQuantumUsesSuperconductingQubit: 'rel-ibm-quantum-uses-superconducting-qubit',
  },
  evidence: {
    ibmSurfaceCodeResults: 'evidence-ibm-surface-code-results',
  },
  hypotheses: {
    surfaceCodeNecessary: 'hypothesis-surface-code-necessary',
  },
} as const;

const ids = QUANTUM_FIXTURE_IDS;

export function createQuantumSkeletonDataset(): ResearchDataset {
  return {
    id: 'dataset-quantum-skeleton',
    name: 'Quantum Research (skeleton)',
    version: '0.1.0',
    domain: 'quantum',
    createdAt: '2026-01-01T00:00:00Z',

    entities: [
      {
        id: ids.entities.ibmQuantum,
        type: 'company',
        name: 'IBM Quantum',
        recordedAt: '2026-01-01T00:00:00Z',
      },
      {
        id: ids.entities.superconductingQubit,
        type: 'quantum-architecture',
        name: 'Superconducting Qubit',
        recordedAt: '2026-01-01T00:00:00Z',
      },
      {
        id: ids.entities.surfaceCode,
        type: 'error-correction-code',
        name: 'Surface Code',
        recordedAt: '2026-01-01T00:00:00Z',
      },
    ],

    relationships: [
      {
        id: ids.relationships.ibmQuantumUsesSuperconductingQubit,
        type: 'uses',
        fromEntityId: ids.entities.ibmQuantum,
        toEntityId: ids.entities.superconductingQubit,
        states: [
          {
            status: 'active',
            recordedAt: '2026-01-01T00:00:00Z',
            effectiveFrom: '2026-01-01T00:00:00Z',
            evidenceIds: [ids.evidence.ibmSurfaceCodeResults],
          },
        ],
      },
    ],

    evidence: [
      {
        id: ids.evidence.ibmSurfaceCodeResults,
        observedAt: '2026-01-01T00:00:00Z',
        source: { name: 'IBM Quantum publication' },
        description:
          'IBM Quantum published surface-code error-correction results on a superconducting-qubit platform.',
        entityIds: [
          ids.entities.ibmQuantum,
          ids.entities.superconductingQubit,
          ids.entities.surfaceCode,
        ],
      },
    ],

    assertions: [],

    hypotheses: [
      {
        id: ids.hypotheses.surfaceCodeNecessary,
        name: 'Surface-code necessity',
        statement:
          'Surface-code error correction is necessary for fault-tolerant quantum computing at scale.',
        status: 'active',
        createdAt: '2026-01-01T00:00:00Z',
        assessments: [
          {
            timestamp: '2026-01-01T00:00:00Z',
            confidence: { value: 0.7 },
            supportingEvidenceIds: [ids.evidence.ibmSurfaceCodeResults],
            contradictingEvidenceIds: [],
          },
        ],
      },
    ],

    assumptions: [],
    variables: [],
    models: [],
    scenarios: [],
    events: [],
    questions: [],
  };
}
