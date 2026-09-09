import type { ResearchDataset } from '@thunderdome/research-core';

/**
 * Well-known ids used throughout the fixture, exported so tests can reference them without
 * duplicating string literals that could silently drift from the dataset itself.
 */
export const FUSION_FIXTURE_IDS = {
  entities: {
    // Reactors / projects
    arc: 'entity-arc',
    sparc: 'entity-sparc',
    iter: 'entity-iter',
    euDemo: 'entity-eu-demo',
    jDemo: 'entity-j-demo',
    step: 'entity-step',
    cfetr: 'entity-cfetr',
    cfedr: 'entity-cfedr',
    best: 'entity-best',
    dtt: 'entity-dtt',
    compassU: 'entity-compass-u',
    crest: 'entity-crest',
    // Companies / organizations
    cfs: 'entity-cfs',
    elmt: 'entity-elmt',
    fujikura: 'entity-fujikura',
    furukawa: 'entity-furukawa',
    walterTosto: 'entity-walter-tosto',
    vitzroNextech: 'entity-vitzro-nextech',
    vitzroTech: 'entity-vitzro-tech',
    simic: 'entity-simic',
    ati: 'entity-ati',
    almt: 'entity-almt',
    sumitomo: 'entity-sumitomo',
    plansee: 'entity-plansee',
    almonty: 'entity-almonty',
    kennametal: 'entity-kennametal',
    amsc: 'entity-amsc',
    shanghaiSuperconductor: 'entity-shanghai-superconductor',
    amsOsram: 'entity-ams-osram',
    typeOne: 'entity-type-one',
    realta: 'entity-realta',
    doe: 'entity-doe',
    // Materials
    tungsten: 'entity-tungsten',
    hts: 'entity-hts',
    vanadium: 'entity-vanadium',
    flibe: 'entity-flibe',
    tritium: 'entity-tritium',
    rhenium: 'entity-rhenium',
    cucrzr: 'entity-cucrzr',
    // Components
    vacuumVessel: 'entity-vacuum-vessel',
    tfMagnet: 'entity-tf-magnet',
    tfCase: 'entity-tf-case',
    divertor: 'entity-divertor',
    firstWall: 'entity-first-wall',
    plasmaFacingComponents: 'entity-plasma-facing-components',
    highHeatFluxComponents: 'entity-high-heat-flux-components',

    // ELMT / Schwabmünchen (see ELMT_FIXTURE_IDS-adjacent block below in this same object)
    eurofusion: 'entity-eurofusion',
    otherPrivateFusion: 'entity-other-private-fusion',
    schwabmunchenMetalOperations: 'entity-schwabmunchen-metal-operations',
    schwabmunchenMaterialsLab: 'entity-schwabmunchen-materials-lab',
    schwabmunchenWorkforce: 'entity-schwabmunchen-workforce',
    schwabmunchenCustomerBase: 'entity-schwabmunchen-customer-base',
    elmtSchwabmunchenAcquisition: 'entity-elmt-schwabmunchen-acquisition',
    europeanRefractoryMetalsPlatform: 'entity-european-refractory-metals-platform',
    // Manufacturing capabilities (spec §4)
    capPowderFormation: 'entity-cap-powder-formation',
    capPressing: 'entity-cap-pressing',
    capSintering: 'entity-cap-sintering',
    capSwaging: 'entity-cap-swaging',
    capWireDrawing: 'entity-cap-wire-drawing',
    capFinishing: 'entity-cap-finishing',
    capMachining: 'entity-cap-machining',
    capPowderInjectionMolding: 'entity-cap-powder-injection-molding',
    capChemicalMaterialAnalysis: 'entity-cap-chemical-material-analysis',
    capPhysicalMaterialAnalysis: 'entity-cap-physical-material-analysis',
    // Tungsten products (spec §5)
    tungstenPowder: 'entity-tungsten-powder',
    tungstenRod: 'entity-tungsten-rod',
    tungstenPin: 'entity-tungsten-pin',
    tungstenHeavyWire: 'entity-tungsten-heavy-wire',
    tungstenFineWire: 'entity-tungsten-fine-wire',
    tungstenElectrode: 'entity-tungsten-electrode',
    tungstenMachinedComponent: 'entity-tungsten-machined-component',
    tungstenPimComponent: 'entity-tungsten-pim-component',
    pureTungsten: 'entity-pure-tungsten',
    kDopedTungsten: 'entity-k-doped-tungsten',
    // Molybdenum products (spec §6)
    molybdenumPowder: 'entity-molybdenum-powder',
    molybdenumRod: 'entity-molybdenum-rod',
    molybdenumWire: 'entity-molybdenum-wire',
    molybdenumComponent: 'entity-molybdenum-component',
    // Planned future materials (spec §7)
    tzm: 'entity-tzm',
    tungstenHeavyAlloy: 'entity-tungsten-heavy-alloy',
    // Fusion materials domain (spec §8)
    fusionMaterials: 'entity-fusion-materials',
    tungstenFusionMaterials: 'entity-tungsten-fusion-materials',
  },
  relationships: {
    elmtCfs: 'rel-elmt-cfs',
    fujikuraCfs: 'rel-fujikura-cfs',
    walterTostoSparc: 'rel-walter-tosto-sparc',
    walterTostoIter: 'rel-walter-tosto-iter',
    walterTostoDtt: 'rel-walter-tosto-dtt',
    arcUsesTungsten: 'rel-arc-uses-tungsten',
    arcDependsHts: 'rel-arc-depends-hts',
    arcRequiresVacuumVessel: 'rel-arc-requires-vacuum-vessel',
    arcRequiresTfMagnet: 'rel-arc-requires-tf-magnet',
    arcRequiresDivertor: 'rel-arc-requires-divertor',
    tfMagnetRequiresHts: 'rel-tf-magnet-requires-hts',
    tfMagnetRequiresTfCase: 'rel-tf-magnet-requires-tf-case',
    simicSparcTfCases: 'rel-simic-sparc-tf-cases',
    almtIter: 'rel-almt-iter',
    sumitomoIter: 'rel-sumitomo-iter',
    atiElmtChadwick: 'rel-ati-elmt-chadwick',
    cfsRealta: 'rel-cfs-realta',
    cfsTypeOne: 'rel-cfs-type-one',
    divertorUsesCucrzr: 'rel-divertor-uses-cucrzr',
    divertorUsesTungsten: 'rel-divertor-uses-tungsten',
    almontyPlansee: 'rel-almonty-plansee',
    // ELMT / Schwabmünchen
    elmtSchwabmunchen: 'rel-elmt-schwabmunchen',
    elmtManufacturesTungsten: 'rel-elmt-manufactures-tungsten',
    elmtEstablishesPlatform: 'rel-elmt-establishes-platform',
    platformImplementedAtSchwabmunchen: 'rel-platform-implemented-at-schwabmunchen',
    elmtPlansToExpandAtSchwabmunchen: 'rel-elmt-plans-to-expand-at-schwabmunchen',
    schwabmunchenPlansToProduceTzm: 'rel-schwabmunchen-plans-to-produce-tzm',
    schwabmunchenPlansToProduceTungstenHeavyAlloy:
      'rel-schwabmunchen-plans-to-produce-tungsten-heavy-alloy',
    schwabmunchenHasHistoricalFusionExperience:
      'rel-schwabmunchen-has-historical-fusion-experience',
    fusionMaterialsIncludesTungsten: 'rel-fusion-materials-includes-tungsten',
    tungstenFusionMaterialsIncludesFirstWall: 'rel-tungsten-fusion-materials-includes-first-wall',
    tungstenFusionMaterialsIncludesDivertor: 'rel-tungsten-fusion-materials-includes-divertor',
    tungstenFusionMaterialsIncludesPfc: 'rel-tungsten-fusion-materials-includes-pfc',
    tungstenFusionMaterialsIncludesHhf: 'rel-tungsten-fusion-materials-includes-hhf',
    schwabmunchenHasCapabilityPowderFormation: 'rel-schwabmunchen-has-capability-powder-formation',
    schwabmunchenHasCapabilityPressing: 'rel-schwabmunchen-has-capability-pressing',
    schwabmunchenHasCapabilitySintering: 'rel-schwabmunchen-has-capability-sintering',
    schwabmunchenHasCapabilitySwaging: 'rel-schwabmunchen-has-capability-swaging',
    schwabmunchenHasCapabilityWireDrawing: 'rel-schwabmunchen-has-capability-wire-drawing',
    schwabmunchenHasCapabilityFinishing: 'rel-schwabmunchen-has-capability-finishing',
    schwabmunchenHasCapabilityMachining: 'rel-schwabmunchen-has-capability-machining',
    schwabmunchenHasCapabilityPim: 'rel-schwabmunchen-has-capability-pim',
    schwabmunchenHasCapabilityChemicalAnalysis:
      'rel-schwabmunchen-has-capability-chemical-analysis',
    schwabmunchenHasCapabilityPhysicalAnalysis:
      'rel-schwabmunchen-has-capability-physical-analysis',
    schwabmunchenManufacturesPureTungsten: 'rel-schwabmunchen-manufactures-pure-tungsten',
    schwabmunchenManufacturesKDopedTungsten: 'rel-schwabmunchen-manufactures-k-doped-tungsten',
    schwabmunchenManufacturesTungstenPowder: 'rel-schwabmunchen-manufactures-tungsten-powder',
    schwabmunchenManufacturesMolybdenumPowder: 'rel-schwabmunchen-manufactures-molybdenum-powder',
  },
  evidence: {
    elmtCfs: 'evidence-elmt-cfs',
    elmtTungstenEstimate: 'evidence-elmt-tungsten-estimate',
    fujikuraHts: 'evidence-fujikura-hts',
    walterTostoVessel: 'evidence-walter-tosto-vessel',
    walterTostoProductionContract: 'evidence-walter-tosto-production-contract',
    walterTosto2024Findings: 'evidence-walter-tosto-2024-findings',
    cfsFunding2026: 'evidence-cfs-funding-2026',
    cfsRealtaAgreement: 'evidence-cfs-realta-agreement',
    cfsTypeOneLicense: 'evidence-cfs-type-one-license',
    sparcHtsDelivery: 'evidence-sparc-hts-delivery',
    cfsMagnetTests2025: 'evidence-cfs-magnet-tests-2025',
    sparcMagnetSpecs: 'evidence-sparc-magnet-specs',
    fujikuraInvestment2025: 'evidence-fujikura-investment-2025',
    simicTfCaseContract: 'evidence-simic-tf-case-contract',
    almtIterContract2021: 'evidence-almt-iter-contract-2021',
    planseeSupplyCommentary2026: 'evidence-plansee-supply-commentary-2026',
    arcV3aDesignParams: 'evidence-arc-v3a-design-params',
    arcHtsEstimate: 'evidence-arc-hts-estimate',
    sparcTfCaseForgingData: 'evidence-sparc-tf-case-forging-data',
    arc2015InconelVesselDesign: 'evidence-arc-2015-inconel-vessel-design',
    arc2025VanadiumVesselModel: 'evidence-arc-2025-vanadium-vessel-model',
    tungstenIrradiationPaper: 'evidence-tungsten-irradiation-paper',
    tungstenFleetDemandStudy2025: 'evidence-tungsten-fleet-demand-study-2025',
    rheniumProduction2024: 'evidence-rhenium-production-2024',
    elmtFinancials: 'evidence-elmt-financials',
    elmtChadwickSelection: 'evidence-elmt-chadwick-selection',
    elmtManagementTungstenEstimates: 'evidence-elmt-management-tungsten-estimates',
    elmtAmsOsramAcquisition: 'evidence-elmt-ams-osram-acquisition',
    vitzroNextechListingFinancials: 'evidence-vitzro-nextech-listing-financials',
    vitzroNextechIterContracts: 'evidence-vitzro-nextech-iter-contracts',
    vitzroNextechHanwhaContract: 'evidence-vitzro-nextech-hanwha-contract',
    cfetrBlanketNeutronicsPaper: 'evidence-cfetr-blanket-neutronics-paper',
    flareFirstLightTbr: 'evidence-flare-first-light-tbr',
    tritiumExtractionResearch: 'evidence-tritium-extraction-research',
    tritiumFuelCycleResearch: 'evidence-tritium-fuel-cycle-research',
    pfcMaterialsResearch: 'evidence-pfc-materials-research',
    maintenanceAvailabilityResearch: 'evidence-maintenance-availability-research',
    almontySangdongOfftake: 'evidence-almonty-sangdong-offtake',
    elmtSchwabmunchenApa: 'evidence-elmt-schwabmunchen-apa',
    osramHistoricalMaterialsDocumentation: 'evidence-osram-historical-materials-documentation',
    schwabmunchenFusionResearchPublication: 'evidence-schwabmunchen-fusion-research-publication',
  },
  assertions: {
    qualificationNotProcurement: 'assertion-qualification-not-procurement',
    switchingCosts: 'assertion-switching-costs',
    fusionSentimentTrap: 'assertion-fusion-sentiment-trap',
    directnessBias: 'assertion-directness-bias',
    commodityTrap: 'assertion-commodity-trap',
    qualificationFallacy: 'assertion-qualification-fallacy',
    contractFallacy: 'assertion-contract-fallacy',
    marketCapBlindness: 'assertion-market-cap-blindness',
    bottleneckPowerIndependentOfRevenueSize:
      'assertion-bottleneck-power-independent-of-revenue-size',
    replacementDemandCompounds: 'assertion-replacement-demand-compounds',
  },
  hypotheses: {
    t001TungstenBottleneck: 'hypothesis-t001-tungsten-bottleneck',
    t002RheniumBottleneck: 'hypothesis-t002-rhenium-bottleneck',
    t003TritiumSelfSufficiency: 'hypothesis-t003-tritium-self-sufficiency',
    t008TritiumConstrainsGrowth: 'hypothesis-t008-tritium-constrains-growth',
    t009HighTbrStrategicValue: 'hypothesis-t009-high-tbr-strategic-value',
    h016RawHtsScarcity: 'hypothesis-h016-raw-hts-scarcity',
    h018QualifiedConductorBottleneck: 'hypothesis-h018-qualified-conductor-bottleneck',
    h019TfMajorityOfArcHts: 'hypothesis-h019-tf-majority-of-arc-hts',
    h020ValueMigratesDownstream: 'hypothesis-h020-value-migrates-downstream',
    h021KaMMoreMeaningfulThanKm: 'hypothesis-h021-ka-m-more-meaningful-than-km',
    h022CfsCapturesDownstreamShare: 'hypothesis-h022-cfs-captures-downstream-share',
    h023MagnetManufacturingBottleneck: 'hypothesis-h023-magnet-manufacturing-bottleneck',
    h024IntegrationCapturesMoreValue: 'hypothesis-h024-integration-captures-more-value',
    h026LearningCurvesReduceCosts: 'hypothesis-h026-learning-curves-reduce-costs',
    h032: 'hypothesis-h032',
    h033: 'hypothesis-h033',
    h034: 'hypothesis-h034',
    hElmt001: 'hypothesis-h-elmt-001',
    hElmt002: 'hypothesis-h-elmt-002',
    hElmt003: 'hypothesis-h-elmt-003',
    hElmt004: 'hypothesis-h-elmt-004',
    hElmt005: 'hypothesis-h-elmt-005',
    hElmt006: 'hypothesis-h-elmt-006',
    hElmt007: 'hypothesis-h-elmt-007',
    hElmt008: 'hypothesis-h-elmt-008',
  },
  assumptions: {
    supplierMarketSharePersistence: 'assumption-supplier-market-share-persistence',
    uniformFirstWallThickness: 'assumption-uniform-first-wall-thickness',
    tritiumSupplyConstrained: 'assumption-tritium-supply-constrained',
    htsTapePrice: 'assumption-hts-tape-price',
    tfCaseUnitCost: 'assumption-tf-case-unit-cost',
    elmtIncrementalEbitMargin: 'assumption-elmt-incremental-ebit-margin',
  },
  variables: {
    reactorsDeployed: 'variable-reactors-deployed',
    supplierMarketShare: 'variable-supplier-market-share',
    replacementCount: 'variable-replacement-count',
    fusionRevenue: 'variable-fusion-revenue',
    arcFirstWallArea: 'variable-arc-first-wall-area',
    arcFirstWallThickness: 'variable-arc-first-wall-thickness',
    tungstenDensity: 'variable-tungsten-density',
    arcTungstenVolume: 'variable-arc-tungsten-volume',
    tungstenMass: 'variable-tungsten-mass',
    elmtPrototypeTungstenEstimate: 'variable-elmt-prototype-tungsten-estimate',
    arcHtsLength: 'variable-arc-hts-length',
    sparcHtsLength: 'variable-sparc-hts-length',
    tfCaseCount: 'variable-tf-case-count',
    tfCaseUnitCostVar: 'variable-tf-case-unit-cost',
    tfCaseTotalCost: 'variable-tf-case-total-cost',
    sparcVesselMass: 'variable-sparc-vessel-mass',
    sparcVesselContractValue: 'variable-sparc-vessel-contract-value',
    arcVesselHistoricalCostIntensity: 'variable-arc-vessel-historical-cost-intensity',
    elmtMarketCapSnapshot: 'variable-elmt-market-cap-snapshot',
    elmtIncrementalEbitMargin: 'variable-elmt-incremental-ebit-margin',
    elmtValuationMultiple: 'variable-elmt-valuation-multiple',
    elmtContentPerReactorLow: 'variable-elmt-content-per-reactor-low',
    elmtContentPerReactorHigh: 'variable-elmt-content-per-reactor-high',
    elmtFusionRevenueTarget: 'variable-elmt-fusion-revenue-target',
  },
  models: {
    fusionRevenue: 'model-fusion-revenue',
    arcTungstenEstimate: 'model-arc-tungsten-estimate',
    elmtValuationSensitivity: 'model-elmt-valuation-sensitivity',
  },
  calculations: {
    fusionRevenue: 'calc-fusion-revenue',
    tungstenVolume: 'calc-tungsten-volume',
    tungstenMass: 'calc-tungsten-mass',
    tfCaseTotalCost: 'calc-tf-case-total-cost',
    elmtFusionRevenueTarget: 'calc-elmt-fusion-revenue-target',
  },
  scenarios: {
    highDemandConstrainedTritium: 'scenario-high-demand-constrained-tritium',
    fusionBull: 'scenario-fusion-bull',
    fusionDelay: 'scenario-fusion-delay',
    materialsBottleneck: 'scenario-materials-bottleneck',
    htsBreakthrough: 'scenario-hts-breakthrough',
    tritiumBottleneck: 'scenario-tritium-bottleneck',
    fusionFalseDawn: 'scenario-fusion-false-dawn',
    supplierWinner: 'scenario-supplier-winner',
    commodityTrap: 'scenario-commodity-trap',
  },
  events: {
    walterTostoProductionContract: 'event-walter-tosto-production-contract',
    tritiumSupplyConstraintPersists: 'event-tritium-supply-constraint-persists',
    elmtAmsOsramAcquisitionAnnounced: 'event-elmt-ams-osram-acquisition-announced',
    vitzroNextechHanwhaContractAwarded: 'event-vitzro-nextech-hanwha-contract-awarded',
  },
} as const;

const ids = FUSION_FIXTURE_IDS;

/**
 * A structured ingestion of a real fusion-research knowledge dump (research snapshot: September
 * 2026) into `@thunderdome/research-core`'s schema. This supersedes the smaller illustrative
 * fixture this file used to hold — see git history for that version.
 *
 * Still NOT the complete fusion research database: some source detail is deliberately folded
 * into `Evidence.description` text rather than exploded into a dedicated `Variable` for every
 * numeric parameter (e.g. individual academic-paper irradiation conditions), to avoid
 * proliferating hundreds of low-value near-duplicate objects. Nothing is silently lost — the
 * substantive numbers are preserved as text — but not everything is independently queryable.
 *
 * Ingestion conventions applied throughout, following the source dump's own instructions:
 * - Provenance classification (FACT / COMPANY_CLAIM / ENGINEERING_ESTIMATE / OUR_INFERENCE /
 *   HYPOTHESIS / etc.) is preserved in `metadata.provenanceClass`, since research-core has no
 *   first-class field for it — a domain-level metadata convention, not a core schema change.
 * - Where the source gives no explicit date, `observedAt`/`recordedAt` is conservatively set to
 *   this snapshot's own date (2026-09-08) rather than an invented earlier date — the safe
 *   direction for point-in-time integrity (never claim something was known earlier than
 *   evidenced).
 * - Plausible relationships are NOT promoted to established ones: e.g. ELMT manufactures
 *   tungsten and ARC requires tungsten, but no ELMT-supplies-ARC relationship exists anywhere in
 *   this dataset, because no evidence establishes it (source dump §60/§79).
 * - Bot/portfolio-construction/signal-generation methodology from the source dump is
 *   deliberately excluded: research-core must stay unaware of any bot that might consume it.
 */
export function createFusionFixtureDataset(): ResearchDataset {
  const SNAPSHOT = '2026-09-08T00:00:00Z';

  // The nine fusion programs tracked independently for both "potential fusion customer" (spec
  // §10) and "fusion qualification" (spec §11) relationships, each initialized UNKNOWN/
  // confidence 0 unless evidence establishes otherwise (none does, currently). "DEMO" is
  // represented by the existing EU-DEMO entity (see comment at ids.entities.euDemo's use above).
  const FUSION_PROGRAM_ENTITY_IDS: { suffix: string; entityId: string }[] = [
    { suffix: 'iter', entityId: ids.entities.iter },
    { suffix: 'demo', entityId: ids.entities.euDemo },
    { suffix: 'eurofusion', entityId: ids.entities.eurofusion },
    { suffix: 'dtt', entityId: ids.entities.dtt },
    { suffix: 'step', entityId: ids.entities.step },
    { suffix: 'sparc', entityId: ids.entities.sparc },
    { suffix: 'arc', entityId: ids.entities.arc },
    { suffix: 'cfs', entityId: ids.entities.cfs },
    { suffix: 'other', entityId: ids.entities.otherPrivateFusion },
  ];

  // The 36 ELMT/Schwabmünchen research questions (spec §17) — generated from one list rather
  // than hand-duplicated as 36 near-identical object literals. `code` matches the source dump's
  // own RQ-ELMT-NNN numbering; `id` is this dataset's actual unique identifier.
  const ELMT_RESEARCH_QUESTIONS: { question: string; relatedEntityIds: string[] }[] = [
    {
      question: 'What was the historical revenue of the Schwabmünchen metal operation?',
      relatedEntityIds: [ids.entities.schwabmunchenMetalOperations],
    },
    {
      question: 'What was the historical EBITDA/profitability of the operation?',
      relatedEntityIds: [ids.entities.schwabmunchenMetalOperations],
    },
    {
      question: 'What is the annual tungsten production capacity?',
      relatedEntityIds: [ids.entities.schwabmunchenMetalOperations, ids.entities.tungsten],
    },
    {
      question: 'What is the annual molybdenum production capacity?',
      relatedEntityIds: [ids.entities.schwabmunchenMetalOperations],
    },
    {
      question: 'What is current facility utilization?',
      relatedEntityIds: [ids.entities.schwabmunchenMetalOperations],
    },
    {
      question: 'What products account for the majority of revenue?',
      relatedEntityIds: [ids.entities.schwabmunchenMetalOperations],
    },
    {
      question: 'Who are the largest inherited customers?',
      relatedEntityIds: [ids.entities.schwabmunchenCustomerBase],
    },
    {
      question: 'What customer qualifications transfer to ELMT?',
      relatedEntityIds: [ids.entities.schwabmunchenCustomerBase],
    },
    {
      question: 'Does the facility possess any nuclear-industry certifications?',
      relatedEntityIds: [ids.entities.schwabmunchenMetalOperations],
    },
    {
      question: 'Does the facility possess any fusion-specific qualifications?',
      relatedEntityIds: [ids.entities.schwabmunchenMetalOperations],
    },
    {
      question: 'Does Schwabmünchen currently supply ITER?',
      relatedEntityIds: [ids.entities.iter],
    },
    {
      question: 'Does Schwabmünchen currently supply DEMO/EUROfusion?',
      relatedEntityIds: [ids.entities.euDemo, ids.entities.eurofusion],
    },
    { question: 'Does Schwabmünchen currently supply DTT?', relatedEntityIds: [ids.entities.dtt] },
    {
      question: 'Does Schwabmünchen currently supply STEP?',
      relatedEntityIds: [ids.entities.step],
    },
    {
      question: 'Does Schwabmünchen currently supply SPARC?',
      relatedEntityIds: [ids.entities.sparc],
    },
    { question: 'Does Schwabmünchen currently supply ARC?', relatedEntityIds: [ids.entities.arc] },
    {
      question: 'Does Schwabmünchen currently supply Commonwealth Fusion Systems?',
      relatedEntityIds: [ids.entities.cfs],
    },
    {
      question: 'What fusion-specific products has the operation previously manufactured?',
      relatedEntityIds: [ids.entities.schwabmunchenMetalOperations],
    },
    {
      question: 'What tungsten alloys can the facility currently manufacture?',
      relatedEntityIds: [ids.entities.schwabmunchenMetalOperations, ids.entities.tungsten],
    },
    {
      question: 'Can the facility manufacture K-doped tungsten at commercial scale?',
      relatedEntityIds: [ids.entities.kDopedTungsten],
    },
    {
      question: "What is the facility's tungsten wire capacity?",
      relatedEntityIds: [ids.entities.tungstenHeavyWire, ids.entities.tungstenFineWire],
    },
    {
      question: "What is the facility's tungsten component capacity?",
      relatedEntityIds: [ids.entities.tungstenMachinedComponent],
    },
    {
      question: 'What materials-testing capabilities are available?',
      relatedEntityIds: [ids.entities.schwabmunchenMaterialsLab],
    },
    {
      question: 'What incremental CapEx is required for fusion qualification?',
      relatedEntityIds: [ids.entities.schwabmunchenMetalOperations],
    },
    {
      question: 'What pension liabilities does ELMT assume?',
      relatedEntityIds: [ids.entities.elmtSchwabmunchenAcquisition],
    },
    {
      question: 'What employee obligations does ELMT assume?',
      relatedEntityIds: [ids.entities.schwabmunchenWorkforce],
    },
    {
      question: 'What is the final economic purchase consideration at closing?',
      relatedEntityIds: [ids.entities.elmtSchwabmunchenAcquisition],
    },
    {
      question: 'What restructuring costs will ELMT incur?',
      relatedEntityIds: [ids.entities.elmtSchwabmunchenAcquisition],
    },
    {
      question: 'How much legacy OSRAM demand will disappear?',
      relatedEntityIds: [ids.entities.schwabmunchenCustomerBase],
    },
    {
      question: 'How much manufacturing capacity becomes available for new customers?',
      relatedEntityIds: [ids.entities.schwabmunchenMetalOperations],
    },
    {
      question: 'How quickly can ELMT replace displaced OSRAM demand?',
      relatedEntityIds: [ids.entities.schwabmunchenCustomerBase],
    },
    {
      question: 'What inherited technical personnel have fusion-specific expertise?',
      relatedEntityIds: [ids.entities.schwabmunchenWorkforce],
    },
    {
      question: 'What historical fusion research relationships exist?',
      relatedEntityIds: [ids.entities.fusionMaterials],
    },
    {
      question: 'What inherited intellectual property or process know-how transfers?',
      relatedEntityIds: [ids.entities.elmtSchwabmunchenAcquisition],
    },
    {
      question: 'What European regulatory/quality certifications transfer?',
      relatedEntityIds: [ids.entities.elmtSchwabmunchenAcquisition],
    },
    {
      question:
        'What portion of Schwabmünchen production could eventually be directed toward fusion?',
      relatedEntityIds: [ids.entities.schwabmunchenMetalOperations, ids.entities.fusionMaterials],
    },
  ];

  return {
    id: 'dataset-fusion-2026-09',
    name: 'Fusion Research (September 2026 snapshot)',
    version: '2026.09',
    domain: 'fusion',
    createdAt: SNAPSHOT,

    // ------------------------------------------------------------------------------------------
    // Entities
    // ------------------------------------------------------------------------------------------
    entities: [
      // Reactors / projects
      {
        id: ids.entities.arc,
        type: 'reactor',
        name: 'ARC',
        description:
          "MIT/CFS's compact fusion reactor concept; current published design iteration is referred to as ARC V3A.",
        // Earlier than the fixture's usual 2023-01-01 background baseline: cited by
        // evidence-arc-2015-inconel-vessel-design, a real 2015-dated historical estimate — see
        // findTemporalIntegrityViolations, which caught this when it was still 2023-01-01.
        recordedAt: '2015-01-01T00:00:00Z',
      },
      {
        id: ids.entities.sparc,
        type: 'reactor',
        name: 'SPARC',
        description: "CFS's demonstration tokamak, under construction.",
        recordedAt: '2023-01-01T00:00:00Z',
      },
      {
        id: ids.entities.iter,
        type: 'reactor',
        name: 'ITER',
        description: 'International multi-party tokamak project.',
        // Cited by evidence-almt-iter-contract-2021 (real 2021-dated evidence) — see the note on
        // entity-arc above for why this predates the fixture's usual 2023-01-01 baseline.
        recordedAt: '2021-01-01T00:00:00Z',
      },
      {
        id: ids.entities.euDemo,
        type: 'reactor',
        name: 'EU-DEMO',
        recordedAt: '2023-01-01T00:00:00Z',
      },
      {
        id: ids.entities.jDemo,
        type: 'reactor',
        name: 'J-DEMO',
        recordedAt: '2023-01-01T00:00:00Z',
      },
      { id: ids.entities.step, type: 'reactor', name: 'STEP', recordedAt: '2023-01-01T00:00:00Z' },
      {
        id: ids.entities.cfetr,
        type: 'reactor',
        name: 'CFETR',
        recordedAt: '2023-01-01T00:00:00Z',
      },
      {
        id: ids.entities.cfedr,
        type: 'reactor',
        name: 'CFEDR',
        recordedAt: '2023-01-01T00:00:00Z',
      },
      { id: ids.entities.best, type: 'reactor', name: 'BEST', recordedAt: '2023-01-01T00:00:00Z' },
      { id: ids.entities.dtt, type: 'reactor', name: 'DTT', recordedAt: '2023-01-01T00:00:00Z' },
      {
        id: ids.entities.compassU,
        type: 'reactor',
        name: 'COMPASS-U',
        // Cited by evidence-pfc-materials-research (real 2021-dated evidence) — see the note on
        // entity-arc above for why this predates the fixture's usual 2023-01-01 baseline.
        recordedAt: '2021-01-01T00:00:00Z',
      },
      {
        id: ids.entities.crest,
        type: 'reactor',
        name: 'CREST',
        description: 'D-D-startup fuel-cycle concept/scenario.',
        recordedAt: '2023-01-01T00:00:00Z',
      },

      // Companies / organizations
      {
        id: ids.entities.cfs,
        type: 'company',
        name: 'Commonwealth Fusion Systems',
        recordedAt: '2023-01-01T00:00:00Z',
      },
      {
        id: ids.entities.elmt,
        type: 'company',
        name: 'ELMT',
        description:
          'Advanced materials manufacturer (tungsten, molybdenum, specialized alloys); NASDAQ: ELMT.',
        recordedAt: '2023-01-01T00:00:00Z',
        metadata: { ticker: 'ELMT', exchange: 'NASDAQ' },
      },
      {
        id: ids.entities.fujikura,
        type: 'company',
        name: 'Fujikura',
        description: 'HTS wire manufacturer; ticker 5803.',
        recordedAt: '2023-01-01T00:00:00Z',
        metadata: { ticker: '5803' },
      },
      {
        id: ids.entities.furukawa,
        type: 'company',
        name: 'Furukawa Electric',
        description: 'HTS-relevant manufacturer; ticker 5801.',
        recordedAt: '2023-01-01T00:00:00Z',
        metadata: { ticker: '5801' },
      },
      {
        id: ids.entities.walterTosto,
        type: 'company',
        name: 'Walter Tosto',
        description: 'Pressure-vessel fabricator.',
        recordedAt: '2023-01-01T00:00:00Z',
      },
      {
        id: ids.entities.vitzroNextech,
        type: 'company',
        name: 'Vitzro Nextech',
        description: 'Fusion/aerospace/plasma engineering company; KOSDAQ: 488900.',
        recordedAt: '2023-01-01T00:00:00Z',
        metadata: { ticker: 'KOSDAQ:488900' },
      },
      {
        id: ids.entities.vitzroTech,
        type: 'company',
        name: 'Vitzro Tech',
        description: 'Fusion-engineering-relevant company; ticker 042370.',
        recordedAt: '2023-01-01T00:00:00Z',
        metadata: { ticker: '042370' },
      },
      {
        id: ids.entities.simic,
        type: 'company',
        name: 'SIMIC',
        description: 'TF case fabricator.',
        recordedAt: '2023-01-01T00:00:00Z',
      },
      {
        id: ids.entities.ati,
        type: 'company',
        name: 'ATI',
        description:
          'Vanadium/specialty alloys and nuclear materials manufacturer, descended from the Wah Chang vanadium lineage.',
        recordedAt: '2023-01-01T00:00:00Z',
      },
      {
        id: ids.entities.almt,
        type: 'company',
        name: 'A.L.M.T.',
        description: 'Tungsten monoblock manufacturer.',
        // Cited by evidence-almt-iter-contract-2021 (real 2021-dated evidence) — see the note on
        // entity-arc above for why this predates the fixture's usual 2023-01-01 baseline.
        recordedAt: '2021-01-01T00:00:00Z',
      },
      {
        id: ids.entities.sumitomo,
        type: 'company',
        name: 'Sumitomo',
        // Cited by evidence-almt-iter-contract-2021 (real 2021-dated evidence) — see the note on
        // entity-arc above for why this predates the fixture's usual 2023-01-01 baseline.
        recordedAt: '2021-01-01T00:00:00Z',
      },
      {
        id: ids.entities.plansee,
        type: 'company',
        name: 'Plansee',
        description: 'Private tungsten supplier.',
        recordedAt: '2023-01-01T00:00:00Z',
      },
      {
        id: ids.entities.almonty,
        type: 'company',
        name: 'Almonty',
        description: 'Tungsten mining company (Sangdong project).',
        recordedAt: '2023-01-01T00:00:00Z',
      },
      {
        id: ids.entities.kennametal,
        type: 'company',
        name: 'Kennametal',
        description: 'Diversified materials company with tungsten exposure.',
        recordedAt: '2023-01-01T00:00:00Z',
      },
      {
        id: ids.entities.amsc,
        type: 'company',
        name: 'AMSC',
        description: 'Superconducting technology company.',
        recordedAt: '2023-01-01T00:00:00Z',
      },
      {
        id: ids.entities.shanghaiSuperconductor,
        type: 'company',
        name: 'Shanghai Superconductor',
        description: 'Private REBCO supplier.',
        recordedAt: '2023-01-01T00:00:00Z',
      },
      // Description deliberately generic: the Schwabmünchen divestiture to ELMT wasn't
      // announced until 2026-09-08 (see evidence-elmt-ams-osram-acquisition) — an entity's own
      // description must not leak evidence-gated content, since the entity itself is visible
      // from 2023 onward. See information-leak.test.ts.
      {
        id: ids.entities.amsOsram,
        type: 'company',
        name: 'ams OSRAM',
        description:
          'Semiconductor/optoelectronics company with tungsten/molybdenum manufacturing operations.',
        recordedAt: '2023-01-01T00:00:00Z',
      },
      {
        id: ids.entities.typeOne,
        type: 'company',
        name: 'Type One',
        description: 'HTS cable technology/manufacturing licensor.',
        recordedAt: '2023-01-01T00:00:00Z',
      },
      // Description deliberately generic — see the ams OSRAM entity above for why.
      {
        id: ids.entities.realta,
        type: 'company',
        name: 'Realta',
        recordedAt: '2023-01-01T00:00:00Z',
      },
      {
        id: ids.entities.doe,
        type: 'government-agency',
        name: 'DOE',
        description: 'U.S. Department of Energy.',
        recordedAt: '2023-01-01T00:00:00Z',
      },

      // Materials
      {
        id: ids.entities.tungsten,
        type: 'material',
        name: 'Tungsten',
        // Cited by evidence-almt-iter-contract-2021 and evidence-pfc-materials-research (both
        // real 2021-dated evidence) — see the note on entity-arc above for why this predates the
        // fixture's usual 2023-01-01 baseline.
        recordedAt: '2021-01-01T00:00:00Z',
      },
      {
        id: ids.entities.hts,
        type: 'material',
        name: 'HTS',
        description: 'High-temperature superconductor tape (REBCO).',
        recordedAt: '2023-01-01T00:00:00Z',
      },
      {
        id: ids.entities.vanadium,
        type: 'material',
        name: 'Vanadium',
        description: 'V-4Cr-4Ti structural alloy.',
        recordedAt: '2023-01-01T00:00:00Z',
      },
      {
        id: ids.entities.flibe,
        type: 'material',
        name: 'FLiBe',
        description: 'Molten-salt breeder/coolant/shielding medium.',
        recordedAt: '2023-01-01T00:00:00Z',
      },
      {
        id: ids.entities.tritium,
        type: 'material',
        name: 'Tritium',
        recordedAt: '2023-01-01T00:00:00Z',
      },
      {
        id: ids.entities.rhenium,
        type: 'material',
        name: 'Rhenium',
        description: 'Byproduct of copper/molybdenum mining; relevant to tungsten transmutation.',
        recordedAt: '2023-01-01T00:00:00Z',
      },
      {
        id: ids.entities.cucrzr,
        type: 'material',
        name: 'CuCrZr',
        description: 'Copper-chromium-zirconium alloy used in plasma-facing components.',
        // Cited by evidence-pfc-materials-research (real 2021-dated evidence) — see the note on
        // entity-arc above for why this predates the fixture's usual 2023-01-01 baseline.
        recordedAt: '2021-01-01T00:00:00Z',
      },

      // Components
      {
        id: ids.entities.vacuumVessel,
        type: 'component',
        name: 'Vacuum Vessel',
        // Cited by evidence-arc-2015-inconel-vessel-design (real 2015-dated evidence) — see the
        // note on entity-arc above for why this predates the fixture's usual 2023-01-01 baseline.
        recordedAt: '2015-01-01T00:00:00Z',
      },
      {
        id: ids.entities.tfMagnet,
        type: 'component',
        name: 'TF Magnet',
        description: 'Toroidal-field magnet.',
        recordedAt: '2023-01-01T00:00:00Z',
      },
      {
        id: ids.entities.tfCase,
        type: 'component',
        name: 'TF Case',
        description: 'Structural case enclosing a TF magnet winding pack.',
        recordedAt: '2023-01-01T00:00:00Z',
      },
      {
        id: ids.entities.divertor,
        type: 'component',
        name: 'Divertor',
        // Cited by evidence-pfc-materials-research (real 2021-dated evidence) — see the note on
        // entity-arc above for why this predates the fixture's usual 2023-01-01 baseline.
        recordedAt: '2021-01-01T00:00:00Z',
      },
      {
        id: ids.entities.firstWall,
        type: 'component',
        name: 'First Wall',
        recordedAt: '2023-01-01T00:00:00Z',
      },
      {
        id: ids.entities.plasmaFacingComponents,
        type: 'component-category',
        name: 'Plasma-Facing Components',
        recordedAt: '2023-01-01T00:00:00Z',
      },
      {
        id: ids.entities.highHeatFluxComponents,
        type: 'component-category',
        name: 'High-Heat-Flux Components',
        recordedAt: '2023-01-01T00:00:00Z',
      },

      // ------------------------------------------------------------------------------------------
      // ELMT / Schwabmünchen (see fixture-elmt-schwabmunchen.md-equivalent doc comment at the
      // relevant relationship/evidence/hypothesis/question blocks below)
      // ------------------------------------------------------------------------------------------
      {
        id: ids.entities.eurofusion,
        type: 'organization',
        name: 'EUROfusion',
        description: 'European fusion research consortium coordinating DEMO-related research.',
        recordedAt: '2023-01-01T00:00:00Z',
      },
      {
        id: ids.entities.otherPrivateFusion,
        type: 'company',
        name: 'Other Private Fusion',
        description:
          'A placeholder aggregate entity representing unspecified/other private fusion developers, used only to track an explicitly UNKNOWN relationship bucket (spec §10/§11) — not a real company.',
        recordedAt: '2023-01-01T00:00:00Z',
      },
      {
        id: ids.entities.schwabmunchenMetalOperations,
        type: 'manufacturing_facility',
        name: 'Schwabmünchen Metal Operations',
        description:
          'Tungsten/molybdenum manufacturing operation in Schwabmünchen, Bavaria, Germany, announced for acquisition by The Elmet Group from ams OSRAM. Metal-production operations have existed at the site since approximately 1961; production area approximately 26,800 m2; produces more than 3,500 products; contains an integrated manufacturing chain and an on-site chemical/physical materials laboratory. Annual capacity, utilization, revenue, EBITDA, and customer concentration are not established by current evidence — see the RQ-ELMT research questions.',
        recordedAt: SNAPSHOT,
        metadata: {
          ownerBeforeTransaction: 'ams OSRAM / OSRAM GmbH',
          acquirer: 'The Elmet Group',
          productionAreaSqm: 26_800,
          productCountApprox: 3500,
          siteOperatingSince: 1961,
        },
      },
      {
        id: ids.entities.schwabmunchenMaterialsLab,
        type: 'materials_laboratory',
        name: 'Schwabmünchen Materials Lab',
        description:
          'On-site chemical/physical materials characterization laboratory at Schwabmünchen. Finer-grained methods (e.g. microscopy, metallography, powder characterization, crystallographic analysis, mechanical/thermal testing) are plausible but not individually named in current evidence, so only the two broad categories (chemical and physical analysis) are encoded as capabilities. This is a general materials-characterization capability, not automatically a nuclear/fusion qualification laboratory.',
        recordedAt: SNAPSHOT,
      },
      {
        id: ids.entities.schwabmunchenWorkforce,
        type: 'workforce',
        name: 'Schwabmünchen Workforce',
        description:
          'Historical/transaction-specific workforce information: approximately 157 employees were associated with the relevant metal-production business at the time of the transaction documentation, with planned workforce restructuring following the transaction. 157 is a point-in-time transaction-documentation figure, not the current or permanent workforce.',
        recordedAt: SNAPSHOT,
        metadata: {
          employeeCountAtTransaction: 157,
          knownByDate: SNAPSHOT,
          effectiveDate: '2026-09-03',
          plannedEmployeeCount: 'UNKNOWN',
          source: 'SEC Asset Purchase Agreement',
        },
      },
      {
        id: ids.entities.schwabmunchenCustomerBase,
        type: 'customer_base',
        name: 'Schwabmünchen Customer Base',
        description:
          'The acquired operation has existing external customers; ELMT intends to maintain customer supply and will assume supply, quality, and technical support responsibilities for the transferred business, with production/transition arrangements in place. Customer count, largest customer, customer concentration, revenue by customer, and end-market (fusion/aerospace/semiconductor/medical/industrial) customer counts are not established by current evidence — see the RQ-ELMT research questions.',
        recordedAt: SNAPSHOT,
      },
      {
        id: ids.entities.elmtSchwabmunchenAcquisition,
        type: 'acquisition',
        name: 'ELMT / Schwabmünchen Acquisition',
        description:
          "ELMT's newly formed German subsidiary, Elmet Technologies GmbH, entered into a definitive agreement (dated 2026-09-03) to acquire assets and rights associated with the Schwabmünchen tungsten/molybdenum manufacturing operation from ams OSRAM / OSRAM GmbH, via an asset purchase. Closing is expected Q1 2027, subject to regulatory approvals and transition requirements. Purchase consideration is formula-defined (starting at a negative EUR 18M amount, adjusted for items including pension assets, defined-benefit pension liabilities, a restructuring prepayment, working capital relative to a specified target, and other transaction-specific adjustments) — the final economic consideration at closing is UNKNOWN until closing occurs.",
        recordedAt: SNAPSHOT,
        metadata: {
          buyer: 'The Elmet Group (via Elmet Technologies GmbH)',
          seller: 'ams OSRAM / OSRAM GmbH',
          agreementDate: '2026-09-03',
          announcementDate: '2026-09-08',
          expectedClose: 'Q1 2027',
          transactionType: 'asset purchase',
          purchaseConsideration: { status: 'formula_defined', finalConsideration: 'UNKNOWN' },
        },
      },
      {
        id: ids.entities.europeanRefractoryMetalsPlatform,
        type: 'platform',
        name: 'European Refractory Metals Platform',
        description:
          "ELMT's first EU refractory-metals manufacturing footprint, intended as a local-for-local European manufacturing platform. Tungsten is identified by ELMT as an EU critical raw material with limited European processing capacity. This is a structural relationship in the research graph, not an investment conclusion.",
        recordedAt: SNAPSHOT,
      },

      // Manufacturing capabilities (spec §4) — sequence noted in each description; not modeled
      // as separate precedes-edges between capability entities (would add graph complexity
      // without changing any research conclusion).
      {
        id: ids.entities.capPowderFormation,
        type: 'manufacturing_capability',
        name: 'Powder Formation',
        description: 'First step in the Schwabmünchen tungsten/molybdenum manufacturing chain.',
        recordedAt: SNAPSHOT,
      },
      {
        id: ids.entities.capPressing,
        type: 'manufacturing_capability',
        name: 'Pressing',
        description: 'Second step in the manufacturing chain, after Powder Formation.',
        recordedAt: SNAPSHOT,
      },
      {
        id: ids.entities.capSintering,
        type: 'manufacturing_capability',
        name: 'Sintering',
        description: 'Third step in the manufacturing chain, after Pressing.',
        recordedAt: SNAPSHOT,
      },
      {
        id: ids.entities.capSwaging,
        type: 'manufacturing_capability',
        name: 'Swaging',
        description: 'Fourth step in the manufacturing chain, after Sintering.',
        recordedAt: SNAPSHOT,
      },
      {
        id: ids.entities.capWireDrawing,
        type: 'manufacturing_capability',
        name: 'Wire Drawing',
        description: 'Fifth step in the manufacturing chain, after Swaging.',
        recordedAt: SNAPSHOT,
      },
      {
        id: ids.entities.capFinishing,
        type: 'manufacturing_capability',
        name: 'Finishing',
        description: 'Sixth and final step in the core manufacturing chain, after Wire Drawing.',
        recordedAt: SNAPSHOT,
      },
      {
        id: ids.entities.capMachining,
        type: 'manufacturing_capability',
        name: 'Machining',
        description: 'A downstream manufacturing capability, not part of every product line.',
        recordedAt: SNAPSHOT,
      },
      {
        id: ids.entities.capPowderInjectionMolding,
        type: 'manufacturing_capability',
        name: 'Powder Injection Molding',
        description: 'A downstream manufacturing capability, not part of every product line.',
        recordedAt: SNAPSHOT,
      },
      {
        id: ids.entities.capChemicalMaterialAnalysis,
        type: 'manufacturing_capability',
        name: 'Chemical Material Analysis',
        description: 'A materials-lab analytical capability.',
        recordedAt: SNAPSHOT,
      },
      {
        id: ids.entities.capPhysicalMaterialAnalysis,
        type: 'manufacturing_capability',
        name: 'Physical Material Analysis',
        description: 'A materials-lab analytical capability.',
        recordedAt: SNAPSHOT,
      },

      // Tungsten products (spec §5) — created regardless of evidentiary support per the source
      // dump's own instruction; only some are connected to Schwabmünchen via a relationship
      // below (see the "only where there is evidence" note there).
      {
        id: ids.entities.tungstenPowder,
        type: 'product',
        name: 'Tungsten Powder',
        recordedAt: SNAPSHOT,
      },
      { id: ids.entities.tungstenRod, type: 'product', name: 'Tungsten Rod', recordedAt: SNAPSHOT },
      { id: ids.entities.tungstenPin, type: 'product', name: 'Tungsten Pin', recordedAt: SNAPSHOT },
      {
        id: ids.entities.tungstenHeavyWire,
        type: 'product',
        name: 'Tungsten Heavy Wire',
        recordedAt: SNAPSHOT,
      },
      {
        id: ids.entities.tungstenFineWire,
        type: 'product',
        name: 'Tungsten Fine Wire',
        recordedAt: SNAPSHOT,
      },
      {
        id: ids.entities.tungstenElectrode,
        type: 'product',
        name: 'Tungsten Electrode',
        recordedAt: SNAPSHOT,
      },
      {
        id: ids.entities.tungstenMachinedComponent,
        type: 'product',
        name: 'Tungsten Machined Component',
        recordedAt: SNAPSHOT,
      },
      {
        id: ids.entities.tungstenPimComponent,
        type: 'product',
        name: 'Tungsten PIM Component',
        recordedAt: SNAPSHOT,
      },
      {
        id: ids.entities.pureTungsten,
        type: 'material',
        name: 'Pure Tungsten',
        recordedAt: SNAPSHOT,
      },
      {
        id: ids.entities.kDopedTungsten,
        type: 'material',
        name: 'K-Doped Tungsten',
        recordedAt: SNAPSHOT,
      },

      // Molybdenum products (spec §6)
      {
        id: ids.entities.molybdenumPowder,
        type: 'product',
        name: 'Molybdenum Powder',
        recordedAt: SNAPSHOT,
      },
      {
        id: ids.entities.molybdenumRod,
        type: 'product',
        name: 'Molybdenum Rod',
        recordedAt: SNAPSHOT,
      },
      {
        id: ids.entities.molybdenumWire,
        type: 'product',
        name: 'Molybdenum Wire',
        recordedAt: SNAPSHOT,
      },
      {
        id: ids.entities.molybdenumComponent,
        type: 'product',
        name: 'Molybdenum Component',
        recordedAt: SNAPSHOT,
      },

      // Planned future materials (spec §7) — NOT current Schwabmünchen production capabilities;
      // see the "plans_to_produce" relationships below (status: planned).
      { id: ids.entities.tzm, type: 'material', name: 'TZM', recordedAt: SNAPSHOT },
      {
        id: ids.entities.tungstenHeavyAlloy,
        type: 'material',
        name: 'Tungsten Heavy Alloy',
        recordedAt: SNAPSHOT,
      },

      // Fusion materials domain (spec §8)
      {
        id: ids.entities.fusionMaterials,
        type: 'material-domain',
        name: 'Fusion Materials',
        recordedAt: '2023-01-01T00:00:00Z',
      },
      {
        id: ids.entities.tungstenFusionMaterials,
        type: 'material-domain',
        name: 'Tungsten Fusion Materials',
        recordedAt: '2023-01-01T00:00:00Z',
      },
    ],

    // ------------------------------------------------------------------------------------------
    // Relationships
    // ------------------------------------------------------------------------------------------
    relationships: [
      {
        id: ids.relationships.elmtCfs,
        type: 'development_relationship',
        fromEntityId: ids.entities.elmt,
        toEntityId: ids.entities.cfs,
        states: [
          {
            status: 'development-stage',
            recordedAt: '2024-03-01T00:00:00Z',
            effectiveFrom: '2024-01-01T00:00:00Z',
            evidenceIds: [ids.evidence.elmtCfs],
          },
        ],
      },
      {
        id: ids.relationships.fujikuraCfs,
        type: 'supplies',
        fromEntityId: ids.entities.fujikura,
        toEntityId: ids.entities.cfs,
        states: [
          {
            status: 'supplier',
            // recordedAt must be >= evidence-fujikura-hts's own observedAt (2024-09-01): research
            // couldn't have recorded this in 2023 using evidence it hadn't observed yet —
            // effectiveFrom (2023-01-01) is a separate, real-world-validity date and stays as-is.
            recordedAt: '2024-09-01T00:00:00Z',
            effectiveFrom: '2023-01-01T00:00:00Z',
            effectiveTo: '2025-01-01T00:00:00Z',
            evidenceIds: [ids.evidence.fujikuraHts],
          },
          {
            status: 'supplier (investor)',
            recordedAt: '2025-01-01T00:00:00Z',
            effectiveFrom: '2025-01-01T00:00:00Z',
            evidenceIds: [ids.evidence.fujikuraInvestment2025],
          },
        ],
      },
      {
        id: ids.relationships.walterTostoSparc,
        type: 'supplies',
        fromEntityId: ids.entities.walterTosto,
        toEntityId: ids.entities.sparc,
        states: [
          {
            status: 'tested',
            recordedAt: '2024-01-01T00:00:00Z',
            effectiveFrom: '2023-06-01T00:00:00Z',
            effectiveTo: '2025-01-01T00:00:00Z',
            evidenceIds: [ids.evidence.walterTostoVessel],
            confidence: { value: 0.6, basis: 'early fabrication-capability disclosure' },
          },
          {
            status: 'qualified',
            recordedAt: '2025-06-01T00:00:00Z',
            effectiveFrom: '2025-01-01T00:00:00Z',
            effectiveTo: '2028-01-01T00:00:00Z',
            evidenceIds: [ids.evidence.walterTostoVessel],
            confidence: { value: 0.85 },
          },
          // Not knowable until 2029 — see information-leak.test.ts.
          {
            status: 'production contract',
            recordedAt: '2029-03-01T00:00:00Z',
            effectiveFrom: '2028-01-01T00:00:00Z',
            evidenceIds: [ids.evidence.walterTostoProductionContract],
            confidence: { value: 0.97 },
          },
        ],
      },
      {
        id: ids.relationships.walterTostoIter,
        type: 'supplies',
        fromEntityId: ids.entities.walterTosto,
        toEntityId: ids.entities.iter,
        states: [
          {
            status: 'supplier',
            recordedAt: '2024-01-01T00:00:00Z',
            effectiveFrom: '2021-01-01T00:00:00Z',
            evidenceIds: [ids.evidence.walterTosto2024Findings],
          },
        ],
      },
      {
        id: ids.relationships.walterTostoDtt,
        type: 'qualification',
        fromEntityId: ids.entities.walterTosto,
        toEntityId: ids.entities.dtt,
        states: [
          {
            status: 'preselected',
            recordedAt: '2024-01-01T00:00:00Z',
            effectiveFrom: '2024-01-01T00:00:00Z',
            evidenceIds: [ids.evidence.walterTosto2024Findings],
          },
        ],
      },
      {
        id: ids.relationships.arcUsesTungsten,
        type: 'uses',
        fromEntityId: ids.entities.arc,
        toEntityId: ids.entities.tungsten,
        states: [
          {
            status: 'design-dependency',
            recordedAt: '2023-01-01T00:00:00Z',
            effectiveFrom: '2023-01-01T00:00:00Z',
            evidenceIds: [],
          },
        ],
      },
      {
        id: ids.relationships.arcDependsHts,
        type: 'depends_on',
        fromEntityId: ids.entities.arc,
        toEntityId: ids.entities.hts,
        states: [
          {
            status: 'design-dependency',
            recordedAt: '2023-01-01T00:00:00Z',
            effectiveFrom: '2023-01-01T00:00:00Z',
            evidenceIds: [],
          },
        ],
      },
      {
        id: ids.relationships.arcRequiresVacuumVessel,
        type: 'requires',
        fromEntityId: ids.entities.arc,
        toEntityId: ids.entities.vacuumVessel,
        states: [
          {
            status: 'design-dependency',
            recordedAt: '2023-01-01T00:00:00Z',
            effectiveFrom: '2023-01-01T00:00:00Z',
            evidenceIds: [],
          },
        ],
      },
      {
        id: ids.relationships.arcRequiresTfMagnet,
        type: 'requires',
        fromEntityId: ids.entities.arc,
        toEntityId: ids.entities.tfMagnet,
        states: [
          {
            status: 'design-dependency',
            recordedAt: '2026-01-01T00:00:00Z',
            effectiveFrom: '2023-01-01T00:00:00Z',
            evidenceIds: [ids.evidence.arcHtsEstimate],
          },
        ],
      },
      {
        id: ids.relationships.arcRequiresDivertor,
        type: 'requires',
        fromEntityId: ids.entities.arc,
        toEntityId: ids.entities.divertor,
        states: [
          {
            status: 'design-dependency',
            recordedAt: '2026-01-01T00:00:00Z',
            effectiveFrom: '2023-01-01T00:00:00Z',
            evidenceIds: [ids.evidence.arcV3aDesignParams],
          },
        ],
      },
      {
        id: ids.relationships.tfMagnetRequiresHts,
        type: 'requires',
        fromEntityId: ids.entities.tfMagnet,
        toEntityId: ids.entities.hts,
        states: [
          {
            status: 'design-dependency',
            recordedAt: '2026-01-01T00:00:00Z',
            effectiveFrom: '2023-01-01T00:00:00Z',
            evidenceIds: [],
          },
        ],
      },
      {
        id: ids.relationships.tfMagnetRequiresTfCase,
        type: 'requires',
        fromEntityId: ids.entities.tfMagnet,
        toEntityId: ids.entities.tfCase,
        states: [
          {
            status: 'design-dependency',
            recordedAt: '2026-01-01T00:00:00Z',
            effectiveFrom: '2023-01-01T00:00:00Z',
            evidenceIds: [],
          },
        ],
      },
      {
        id: ids.relationships.simicSparcTfCases,
        type: 'supplies',
        fromEntityId: ids.entities.simic,
        toEntityId: ids.entities.tfCase,
        states: [
          {
            status: 'production-began',
            // All three states here are known only via the SAME single retrospective
            // CONVERSATION_RESEARCH evidence, observed once on 2025-12-31 — so recordedAt is
            // 2025-12-31 for all three (that's genuinely when research learned this whole
            // history), even though effectiveFrom/effectiveTo (the real-world validity window
            // for each stage) are staggered across 2024-2025.
            recordedAt: '2025-12-31T00:00:00Z',
            effectiveFrom: '2024-07-01T00:00:00Z',
            effectiveTo: '2024-12-10T00:00:00Z',
            evidenceIds: [ids.evidence.simicTfCaseContract],
          },
          {
            status: 'first-units-shipped',
            recordedAt: '2025-12-31T00:00:00Z',
            effectiveFrom: '2024-12-10T00:00:00Z',
            effectiveTo: '2025-01-01T00:00:00Z',
            evidenceIds: [ids.evidence.simicTfCaseContract],
          },
          {
            status: 'delivery-complete',
            recordedAt: '2025-12-31T00:00:00Z',
            effectiveFrom: '2025-01-01T00:00:00Z',
            evidenceIds: [ids.evidence.simicTfCaseContract],
          },
        ],
      },
      {
        id: ids.relationships.almtIter,
        type: 'supplies',
        fromEntityId: ids.entities.almt,
        toEntityId: ids.entities.iter,
        states: [
          {
            status: 'production contract',
            recordedAt: '2021-01-01T00:00:00Z',
            effectiveFrom: '2021-01-01T00:00:00Z',
            evidenceIds: [ids.evidence.almtIterContract2021],
          },
        ],
      },
      {
        id: ids.relationships.sumitomoIter,
        type: 'supplies',
        fromEntityId: ids.entities.sumitomo,
        toEntityId: ids.entities.iter,
        states: [
          {
            status: 'production contract',
            recordedAt: '2021-01-01T00:00:00Z',
            effectiveFrom: '2021-01-01T00:00:00Z',
            evidenceIds: [ids.evidence.almtIterContract2021],
          },
        ],
      },
      {
        id: ids.relationships.atiElmtChadwick,
        type: 'development_relationship',
        fromEntityId: ids.entities.ati,
        toEntityId: ids.entities.elmt,
        states: [
          {
            status: 'development-stage',
            recordedAt: SNAPSHOT,
            effectiveFrom: SNAPSHOT,
            evidenceIds: [ids.evidence.elmtChadwickSelection],
          },
        ],
      },
      {
        id: ids.relationships.cfsRealta,
        type: 'development_relationship',
        fromEntityId: ids.entities.cfs,
        toEntityId: ids.entities.realta,
        states: [
          {
            status: 'agreement',
            recordedAt: '2026-07-01T00:00:00Z',
            effectiveFrom: '2026-07-01T00:00:00Z',
            evidenceIds: [ids.evidence.cfsRealtaAgreement],
          },
        ],
      },
      {
        id: ids.relationships.cfsTypeOne,
        type: 'licenses',
        fromEntityId: ids.entities.cfs,
        toEntityId: ids.entities.typeOne,
        states: [
          {
            status: 'exclusive-license',
            recordedAt: '2025-01-01T00:00:00Z',
            effectiveFrom: '2025-01-01T00:00:00Z',
            evidenceIds: [ids.evidence.cfsTypeOneLicense],
          },
        ],
      },
      {
        id: ids.relationships.divertorUsesCucrzr,
        type: 'uses',
        fromEntityId: ids.entities.divertor,
        toEntityId: ids.entities.cucrzr,
        states: [
          {
            status: 'design-dependency',
            recordedAt: '2026-01-01T00:00:00Z',
            effectiveFrom: '2021-01-01T00:00:00Z',
            evidenceIds: [ids.evidence.pfcMaterialsResearch],
          },
        ],
      },
      {
        id: ids.relationships.divertorUsesTungsten,
        type: 'uses',
        fromEntityId: ids.entities.divertor,
        toEntityId: ids.entities.tungsten,
        states: [
          {
            status: 'design-dependency',
            recordedAt: '2026-01-01T00:00:00Z',
            effectiveFrom: '2021-01-01T00:00:00Z',
            evidenceIds: [ids.evidence.pfcMaterialsResearch],
          },
        ],
      },
      {
        id: ids.relationships.almontyPlansee,
        type: 'supplies',
        fromEntityId: ids.entities.almonty,
        toEntityId: ids.entities.plansee,
        states: [
          {
            status: 'offtake',
            recordedAt: '2026-07-01T00:00:00Z',
            effectiveFrom: '2026-07-01T00:00:00Z',
            evidenceIds: [ids.evidence.almontySangdongOfftake],
          },
        ],
      },

      // ------------------------------------------------------------------------------------------
      // ELMT / Schwabmünchen
      // ------------------------------------------------------------------------------------------
      {
        id: ids.relationships.elmtSchwabmunchen,
        type: 'acquires',
        fromEntityId: ids.entities.elmt,
        toEntityId: ids.entities.schwabmunchenMetalOperations,
        states: [
          {
            status: 'agreement_signed',
            recordedAt: SNAPSHOT,
            effectiveFrom: '2026-09-03T00:00:00Z',
            evidenceIds: [ids.evidence.elmtAmsOsramAcquisition, ids.evidence.elmtSchwabmunchenApa],
          },
        ],
      },
      {
        id: ids.relationships.elmtManufacturesTungsten,
        type: 'manufactures',
        fromEntityId: ids.entities.elmt,
        toEntityId: ids.entities.tungsten,
        states: [
          {
            status: 'active',
            recordedAt: SNAPSHOT,
            effectiveFrom: '2023-01-01T00:00:00Z',
            evidenceIds: [
              ids.evidence.elmtAmsOsramAcquisition,
              ids.evidence.osramHistoricalMaterialsDocumentation,
            ],
          },
        ],
      },
      {
        id: ids.relationships.elmtEstablishesPlatform,
        type: 'establishes',
        fromEntityId: ids.entities.elmt,
        toEntityId: ids.entities.europeanRefractoryMetalsPlatform,
        states: [
          {
            status: 'active',
            recordedAt: SNAPSHOT,
            effectiveFrom: SNAPSHOT,
            evidenceIds: [ids.evidence.elmtAmsOsramAcquisition],
          },
        ],
      },
      {
        id: ids.relationships.platformImplementedAtSchwabmunchen,
        type: 'implemented_at',
        fromEntityId: ids.entities.europeanRefractoryMetalsPlatform,
        toEntityId: ids.entities.schwabmunchenMetalOperations,
        states: [
          {
            status: 'active',
            recordedAt: SNAPSHOT,
            effectiveFrom: SNAPSHOT,
            evidenceIds: [ids.evidence.elmtAmsOsramAcquisition],
          },
        ],
      },
      {
        id: ids.relationships.elmtPlansToExpandAtSchwabmunchen,
        type: 'plans_to_expand_at',
        fromEntityId: ids.entities.elmt,
        toEntityId: ids.entities.schwabmunchenMetalOperations,
        states: [
          {
            status: 'planned',
            recordedAt: SNAPSHOT,
            effectiveFrom: SNAPSHOT,
            evidenceIds: [ids.evidence.elmtAmsOsramAcquisition],
            metadata: { notCurrentCapability: true },
          },
        ],
      },
      {
        id: ids.relationships.schwabmunchenPlansToProduceTzm,
        type: 'plans_to_produce',
        fromEntityId: ids.entities.schwabmunchenMetalOperations,
        toEntityId: ids.entities.tzm,
        states: [
          {
            status: 'planned',
            recordedAt: SNAPSHOT,
            effectiveFrom: SNAPSHOT,
            evidenceIds: [ids.evidence.elmtAmsOsramAcquisition],
            metadata: { notCurrentCapability: true },
          },
        ],
      },
      {
        id: ids.relationships.schwabmunchenPlansToProduceTungstenHeavyAlloy,
        type: 'plans_to_produce',
        fromEntityId: ids.entities.schwabmunchenMetalOperations,
        toEntityId: ids.entities.tungstenHeavyAlloy,
        states: [
          {
            status: 'planned',
            recordedAt: SNAPSHOT,
            effectiveFrom: SNAPSHOT,
            evidenceIds: [ids.evidence.elmtAmsOsramAcquisition],
            metadata: { notCurrentCapability: true },
          },
        ],
      },
      {
        id: ids.relationships.schwabmunchenHasHistoricalFusionExperience,
        type: 'has_historical_experience_with',
        fromEntityId: ids.entities.schwabmunchenMetalOperations,
        toEntityId: ids.entities.fusionMaterials,
        states: [
          {
            status: 'documented',
            recordedAt: SNAPSHOT,
            effectiveFrom: SNAPSHOT,
            evidenceIds: [ids.evidence.schwabmunchenFusionResearchPublication],
            metadata: { commercialSupplyStatus: 'unknown', qualificationStatus: 'unknown' },
          },
        ],
      },
      {
        id: ids.relationships.fusionMaterialsIncludesTungsten,
        type: 'includes',
        fromEntityId: ids.entities.fusionMaterials,
        toEntityId: ids.entities.tungsten,
        states: [
          {
            status: 'active',
            recordedAt: '2023-01-01T00:00:00Z',
            effectiveFrom: '2023-01-01T00:00:00Z',
            evidenceIds: [],
          },
        ],
      },
      {
        id: ids.relationships.tungstenFusionMaterialsIncludesFirstWall,
        type: 'includes',
        fromEntityId: ids.entities.tungstenFusionMaterials,
        toEntityId: ids.entities.firstWall,
        states: [
          {
            status: 'active',
            recordedAt: '2023-01-01T00:00:00Z',
            effectiveFrom: '2023-01-01T00:00:00Z',
            evidenceIds: [],
          },
        ],
      },
      {
        id: ids.relationships.tungstenFusionMaterialsIncludesDivertor,
        type: 'includes',
        fromEntityId: ids.entities.tungstenFusionMaterials,
        toEntityId: ids.entities.divertor,
        states: [
          {
            status: 'active',
            recordedAt: '2023-01-01T00:00:00Z',
            effectiveFrom: '2023-01-01T00:00:00Z',
            evidenceIds: [],
          },
        ],
      },
      {
        id: ids.relationships.tungstenFusionMaterialsIncludesPfc,
        type: 'includes',
        fromEntityId: ids.entities.tungstenFusionMaterials,
        toEntityId: ids.entities.plasmaFacingComponents,
        states: [
          {
            status: 'active',
            recordedAt: '2023-01-01T00:00:00Z',
            effectiveFrom: '2023-01-01T00:00:00Z',
            evidenceIds: [],
          },
        ],
      },
      {
        id: ids.relationships.tungstenFusionMaterialsIncludesHhf,
        type: 'includes',
        fromEntityId: ids.entities.tungstenFusionMaterials,
        toEntityId: ids.entities.highHeatFluxComponents,
        states: [
          {
            status: 'active',
            recordedAt: '2023-01-01T00:00:00Z',
            effectiveFrom: '2023-01-01T00:00:00Z',
            evidenceIds: [],
          },
        ],
      },

      // Manufacturing capability relationships (spec §4)
      ...(
        [
          [
            ids.relationships.schwabmunchenHasCapabilityPowderFormation,
            ids.entities.capPowderFormation,
          ],
          [ids.relationships.schwabmunchenHasCapabilityPressing, ids.entities.capPressing],
          [ids.relationships.schwabmunchenHasCapabilitySintering, ids.entities.capSintering],
          [ids.relationships.schwabmunchenHasCapabilitySwaging, ids.entities.capSwaging],
          [ids.relationships.schwabmunchenHasCapabilityWireDrawing, ids.entities.capWireDrawing],
          [ids.relationships.schwabmunchenHasCapabilityFinishing, ids.entities.capFinishing],
          [ids.relationships.schwabmunchenHasCapabilityMachining, ids.entities.capMachining],
          [ids.relationships.schwabmunchenHasCapabilityPim, ids.entities.capPowderInjectionMolding],
          [
            ids.relationships.schwabmunchenHasCapabilityChemicalAnalysis,
            ids.entities.capChemicalMaterialAnalysis,
          ],
          [
            ids.relationships.schwabmunchenHasCapabilityPhysicalAnalysis,
            ids.entities.capPhysicalMaterialAnalysis,
          ],
        ] as const
      ).map(([relationshipId, capabilityEntityId]) => ({
        id: relationshipId,
        type: 'has_capability',
        fromEntityId: ids.entities.schwabmunchenMetalOperations,
        toEntityId: capabilityEntityId,
        states: [
          {
            status: 'active',
            recordedAt: SNAPSHOT,
            effectiveFrom: SNAPSHOT,
            evidenceIds: [
              ids.evidence.elmtAmsOsramAcquisition,
              ids.evidence.osramHistoricalMaterialsDocumentation,
            ],
          },
        ],
      })),

      // Product relationships (spec §5/§6) — connected only where evidence supports it; the
      // other 10 product entities remain created but unconnected (see the source dump's own
      // "connect only where there is evidence" instruction).
      {
        id: ids.relationships.schwabmunchenManufacturesPureTungsten,
        type: 'manufactures',
        fromEntityId: ids.entities.schwabmunchenMetalOperations,
        toEntityId: ids.entities.pureTungsten,
        states: [
          {
            status: 'active',
            recordedAt: SNAPSHOT,
            effectiveFrom: SNAPSHOT,
            evidenceIds: [ids.evidence.osramHistoricalMaterialsDocumentation],
          },
        ],
      },
      {
        id: ids.relationships.schwabmunchenManufacturesKDopedTungsten,
        type: 'manufactures',
        fromEntityId: ids.entities.schwabmunchenMetalOperations,
        toEntityId: ids.entities.kDopedTungsten,
        states: [
          {
            status: 'active',
            recordedAt: SNAPSHOT,
            effectiveFrom: SNAPSHOT,
            evidenceIds: [ids.evidence.osramHistoricalMaterialsDocumentation],
          },
        ],
      },
      {
        id: ids.relationships.schwabmunchenManufacturesTungstenPowder,
        type: 'manufactures',
        fromEntityId: ids.entities.schwabmunchenMetalOperations,
        toEntityId: ids.entities.tungstenPowder,
        states: [
          {
            status: 'active',
            recordedAt: SNAPSHOT,
            effectiveFrom: SNAPSHOT,
            evidenceIds: [ids.evidence.elmtAmsOsramAcquisition],
          },
        ],
      },
      {
        id: ids.relationships.schwabmunchenManufacturesMolybdenumPowder,
        type: 'manufactures',
        fromEntityId: ids.entities.schwabmunchenMetalOperations,
        toEntityId: ids.entities.molybdenumPowder,
        states: [
          {
            status: 'active',
            recordedAt: SNAPSHOT,
            effectiveFrom: SNAPSHOT,
            evidenceIds: [ids.evidence.elmtAmsOsramAcquisition],
          },
        ],
      },

      // Fusion customer relationships (spec §10) and fusion qualification (spec §11) — every
      // program initialized as UNKNOWN/confidence 0 unless evidence establishes otherwise (none
      // does, currently). Generated from one list rather than hand-duplicated per program.
      ...FUSION_PROGRAM_ENTITY_IDS.map(({ suffix, entityId }) => ({
        id: `rel-schwabmunchen-potential-fusion-customer-${suffix}`,
        type: 'potential_fusion_customer',
        fromEntityId: ids.entities.schwabmunchenMetalOperations,
        toEntityId: entityId,
        states: [
          {
            status: 'UNKNOWN',
            confidence: { value: 0 },
            recordedAt: SNAPSHOT,
            effectiveFrom: SNAPSHOT,
            evidenceIds: [],
          },
        ],
      })),
      ...FUSION_PROGRAM_ENTITY_IDS.map(({ suffix, entityId }) => ({
        id: `rel-schwabmunchen-fusion-qualification-${suffix}`,
        type: 'fusion_qualification',
        fromEntityId: ids.entities.schwabmunchenMetalOperations,
        toEntityId: entityId,
        states: [
          {
            status: 'UNKNOWN',
            confidence: { value: 0 },
            recordedAt: SNAPSHOT,
            effectiveFrom: SNAPSHOT,
            evidenceIds: [],
          },
        ],
      })),
    ],

    // ------------------------------------------------------------------------------------------
    // Evidence
    // ------------------------------------------------------------------------------------------
    evidence: [
      {
        id: ids.evidence.elmtCfs,
        observedAt: '2024-03-01T00:00:00Z',
        source: { name: 'ELMT public disclosure' },
        description:
          'ELMT reported development-stage work with CFS involving fusion-relevant materials.',
        entityIds: [ids.entities.elmt, ids.entities.cfs],
        metadata: { provenanceClass: 'COMPANY_CLAIM' },
      },
      {
        id: ids.evidence.elmtTungstenEstimate,
        observedAt: '2024-06-01T00:00:00Z',
        source: { name: 'ELMT public disclosure' },
        description:
          'ELMT publicly discussed an approximate tungsten-content estimate for its fusion-relevant prototype components. The estimate is disclosed as preliminary and is NOT a verified commercial bill of materials.',
        entityIds: [ids.entities.elmt, ids.entities.tungsten],
        metadata: {
          provenanceClass: 'ENGINEERING_ESTIMATE',
          estimateType: 'preliminary-prototype',
          verifiedCommercialBom: false,
        },
      },
      {
        id: ids.evidence.fujikuraHts,
        observedAt: '2024-09-01T00:00:00Z',
        source: { name: 'Fujikura public disclosure' },
        description:
          'Fujikura reported HTS wire production relevant to fusion magnet applications, supporting a fusion-specific HTS relationship with CFS, established by 2023.',
        entityIds: [ids.entities.fujikura, ids.entities.hts, ids.entities.cfs],
        metadata: { provenanceClass: 'COMPANY_CLAIM' },
      },
      {
        id: ids.evidence.walterTostoVessel,
        observedAt: '2024-01-01T00:00:00Z',
        source: { name: 'Walter Tosto public disclosure' },
        description:
          'Walter Tosto confirmed as SPARC vacuum-vessel supplier: contract established 2021, including vessel and internal structures; reported value approximately €35-40M; vessel approximately 96 tonnes (each half approximately 48 tonnes); first half shipped Italy -> Massachusetts by An-124.',
        entityIds: [ids.entities.walterTosto, ids.entities.sparc, ids.entities.vacuumVessel],
        metadata: { provenanceClass: 'COMPANY_CLAIM' },
      },
      {
        id: ids.evidence.walterTostoProductionContract,
        observedAt: '2029-03-01T00:00:00Z',
        source: { name: 'Walter Tosto public disclosure' },
        description:
          'Walter Tosto announced a commercial production contract for SPARC vacuum vessels.',
        entityIds: [ids.entities.walterTosto, ids.entities.sparc],
        metadata: { provenanceClass: 'COMPANY_CLAIM' },
      },
      {
        id: ids.evidence.walterTosto2024Findings,
        observedAt: '2024-01-01T00:00:00Z',
        source: {
          name: 'CONVERSATION_RESEARCH',
          metadata: { note: 'Source not captured in the ingested dump.' },
        },
        description:
          "Walter Tosto also supplies ITER, JT-60SA cases, and is preselected/undergoing qualification for DTT, alongside continued investment in nuclear/big-science manufacturing capability. Tosto Group 2024 consolidated revenue >€166M; Walter Tosto standalone revenue ~€108M — the SPARC vessel contract is economically material relative to Walter Tosto's standalone scale (our inference).",
        entityIds: [ids.entities.walterTosto, ids.entities.iter, ids.entities.dtt],
        metadata: { provenanceClass: 'CONVERSATION_RESEARCH' },
      },
      {
        id: ids.evidence.cfsFunding2026,
        observedAt: '2026-07-01T00:00:00Z',
        source: { name: 'CONVERSATION_RESEARCH' },
        description:
          "CFS raised approximately $1B in July 2026; total capital raised discussed across CFS's history is approximately $4B.",
        entityIds: [ids.entities.cfs],
        metadata: { provenanceClass: 'COMPANY_CLAIM' },
      },
      {
        id: ids.evidence.cfsRealtaAgreement,
        observedAt: '2026-07-01T00:00:00Z',
        source: { name: 'CONVERSATION_RESEARCH' },
        description:
          'CFS announced a 2026 HTS magnet agreement with Realta, potentially worth multiple billions.',
        entityIds: [ids.entities.cfs, ids.entities.realta],
        metadata: { provenanceClass: 'COMPANY_CLAIM' },
      },
      {
        id: ids.evidence.cfsTypeOneLicense,
        observedAt: '2025-01-01T00:00:00Z',
        source: { name: 'CONVERSATION_RESEARCH' },
        description:
          'CFS licensed HTS cable technology/manufacturing from Type One under an exclusive arrangement in 2025.',
        entityIds: [ids.entities.cfs, ids.entities.typeOne],
        metadata: { provenanceClass: 'COMPANY_CLAIM' },
      },
      {
        id: ids.evidence.sparcHtsDelivery,
        observedAt: '2025-12-31T00:00:00Z',
        source: { name: 'CONVERSATION_RESEARCH' },
        description:
          'SPARC requires approximately 10,000 km of HTS tape and required approximately 40x industry scale-up from 2018 levels; CFS reported nearly all SPARC HTS tape had been delivered by 2025.',
        entityIds: [ids.entities.sparc, ids.entities.hts, ids.entities.cfs],
        metadata: { provenanceClass: 'COMPANY_CLAIM' },
      },
      {
        id: ids.evidence.cfsMagnetTests2025,
        observedAt: '2025-01-01T00:00:00Z',
        source: { name: 'CONVERSATION_RESEARCH' },
        description:
          'Full-scale SPARC TF magnets passed DOE-validated tests in 2025. A 2024 pulsed magnet demonstration reached approximately 50 kA. CFS conductor architectures: TF uses "NINT"; PF/CS uses "PIT-VIPER" (incorporating TSTC-derived technology) — reported high I x B performance, fiber-optic quench detection, very low resistance joints (approximately nΩ scale), and more than 4 km of PIT-VIPER fabricated.',
        entityIds: [ids.entities.cfs, ids.entities.sparc, ids.entities.doe, ids.entities.tfMagnet],
        metadata: { provenanceClass: 'GOVERNMENT_CLAIM' },
      },
      {
        id: ids.evidence.sparcMagnetSpecs,
        observedAt: '2026-01-01T00:00:00Z',
        source: { name: 'CONVERSATION_RESEARCH' },
        description:
          'SPARC: 18 TF coils; historical individual coil mass ~18,025 kg (winding pack ~7,975 kg, implied non-winding-pack mass ~10,050 kg); approximately 270 km REBCO per coil across 16 pancakes; operating current ~31.3 kA; peak field ~23 T; stored energy ~316 MJ; a later completed magnet approximately 24 tonnes; first pancake cycle ~30 days, later cycle ~12 days, later target/achievement approximately 1/day; 288 pancakes total; magnet factory ~165,000 sq ft.',
        entityIds: [ids.entities.sparc, ids.entities.tfMagnet, ids.entities.hts],
        metadata: { provenanceClass: 'COMPANY_CLAIM' },
      },
      {
        id: ids.evidence.fujikuraInvestment2025,
        observedAt: '2025-01-01T00:00:00Z',
        source: { name: 'CONVERSATION_RESEARCH' },
        description:
          'Fujikura invested in CFS in 2025 and expanded capacity in 2026. Faraday Factory Japan was also identified as a SPARC supplier.',
        entityIds: [ids.entities.fujikura, ids.entities.cfs],
        metadata: { provenanceClass: 'COMPANY_CLAIM' },
      },
      {
        id: ids.evidence.simicTfCaseContract,
        observedAt: '2025-12-31T00:00:00Z',
        source: { name: 'CONVERSATION_RESEARCH' },
        description:
          'SIMIC selected as main supplier for SPARC TF cases; production began July 2024; first two shipped December 10, 2024; an additional 24 cases followed, with final cases delivered in 2025. No public contract value established. Each case involves a Nitronic 50 trough, cover, SS316LN seal plate, Inconel 718 bolts, large precision forgings, and cryogenic high-strength requirements (~1 GPa stress environment): historical trough forging ~18,177 kg, cover forging ~6,697 kg, cross-section >350 mm, yield >1,200 MPa at 20 K, fracture toughness >200 MPa*m^0.5 at 77 K.',
        entityIds: [ids.entities.simic, ids.entities.sparc, ids.entities.tfCase],
        metadata: { provenanceClass: 'COMPANY_CLAIM' },
      },
      {
        id: ids.evidence.almtIterContract2021,
        observedAt: '2021-01-01T00:00:00Z',
        source: { name: 'CONVERSATION_RESEARCH' },
        description:
          "A.L.M.T./Sumitomo won an approximately ¥3.5B ITER tungsten monoblock contract in 2021; A.L.M.T.'s production capacity line expanded more than 8x; A.L.M.T. and a Chinese supplier reportedly produced approximately 65,000 monoblocks since October 2022, approximately half associated with A.L.M.T.",
        entityIds: [
          ids.entities.almt,
          ids.entities.sumitomo,
          ids.entities.iter,
          ids.entities.tungsten,
        ],
        metadata: { provenanceClass: 'GOVERNMENT_CLAIM' },
      },
      {
        id: ids.evidence.planseeSupplyCommentary2026,
        observedAt: '2026-01-01T00:00:00Z',
        source: { name: 'CONVERSATION_RESEARCH' },
        description:
          '2026 commentary indicates tight tungsten supply and higher prices from Plansee.',
        entityIds: [ids.entities.plansee, ids.entities.tungsten],
        metadata: { provenanceClass: 'COMPANY_CLAIM' },
      },
      {
        id: ids.evidence.arcV3aDesignParams,
        observedAt: '2026-01-01T00:00:00Z',
        source: { name: 'Published ARC V3A engineering design' },
        description:
          'ARC V3A published/current design parameters (subject to change; final material choices not frozen): major radius R0 4.62 m; minor radius a 1.18 m; plasma volume 189 m3; plasma surface area 257 m2; toroidal field B0 11.4 T; plasma current 12 MA; fusion power ~1.13 GW (performance estimates range ~600-1300 MW depending on assumptions); net electric power >=400 MW; Q ~51; 18 TF coils; max coupled RF power 50 MW (ICRF is the sole auxiliary heating system); pulse flattop ~900 s; target lifetime ~20 years; vacuum vessel replacement approximately every 1-2 full-power-years; first wall 5 mm tungsten baseline; inner wall 1 cm vanadium baseline; FLiBe cooling channel 4.5 cm; outer wall 3 cm vanadium; tungsten-carbide shielding; FLiBe used for breeding/neutron multiplication/cooling/shielding; vessel designed to be consumable/demountable; double-null long-legged X-point divertor geometry. Particularly uncertain: exact final tungsten BOM, final HTS split between TF/PF/CS, final vanadium quantity, final FLiBe quantity, tungsten-carbide shield quantity, final divertor configuration, final supplier selection, commercial procurement strategy.',
        entityIds: [
          ids.entities.arc,
          ids.entities.tungsten,
          ids.entities.vanadium,
          ids.entities.flibe,
          ids.entities.vacuumVessel,
          ids.entities.divertor,
        ],
        metadata: { provenanceClass: 'PUBLISHED_ENGINEERING_DESIGN' },
      },
      {
        id: ids.evidence.arcHtsEstimate,
        observedAt: '2026-01-01T00:00:00Z',
        source: { name: 'CONVERSATION_RESEARCH' },
        description:
          'Estimated total ARC REBCO: approximately 15,000-20,000 km, central working estimate 20,000 km. Not a final procurement BOM. Historical SPARC benchmark: TF system previously associated with approximately 5,730 km of REBCO in an earlier design context (extrapolation to ARC is NOT a factual ARC specification); a historical-fraction scenario would put ~9,720 km as TF-associated if ARC retained a similar TF fraction to historical SPARC. Illustrative raw tape cost $15-30/m implies $300M-$600M for 20,000 km — a cost sensitivity, not a procurement forecast. Alternative literature pricing discussed: ~$20/m competitive price, or ~$20-80/m depending on normalization. A more relevant metric for high-field conductor economics is $/kA*m: indicative current values ~$100-200/kA*m, with longer-term targets ~$10-20/kA*m.',
        entityIds: [ids.entities.arc, ids.entities.sparc, ids.entities.hts, ids.entities.tfMagnet],
        metadata: { provenanceClass: 'ENGINEERING_ESTIMATE' },
      },
      {
        id: ids.evidence.sparcTfCaseForgingData,
        observedAt: '2025-01-01T00:00:00Z',
        source: { name: 'CONVERSATION_RESEARCH' },
        description:
          'Illustrative TF case economics (OUR_ESTIMATE / LOW_CONFIDENCE, not an observed contract price): working model $1M-$4M per case, central assumption $2M/case; 18 cases implies $18M-$72M, central ~$36M. Potential TF case supplier landscape beyond SIMIC includes MHI, HD Hyundai, Walter Tosto, CNIM, ATI, and Carpenter — none established as SPARC/ARC suppliers by evidence in this dataset.',
        entityIds: [ids.entities.tfCase, ids.entities.simic],
        metadata: { provenanceClass: 'OUR_INFERENCE' },
      },
      {
        id: ids.evidence.arc2015InconelVesselDesign,
        observedAt: '2015-01-01T00:00:00Z',
        source: { name: 'CONVERSATION_RESEARCH' },
        description:
          'Historical (2015) ARC Inconel vessel design: ~86.5 tonnes; fabrication estimate ~$92M (FY2014). Approximate breakdown: first wall 3.72 t / $4M; inner wall 16.6 t / $18M; outer wall 51.4 t / $55M; ribbing 6.8 t / $7.2M; posts 4.14 t / $4.4M — approximate fabrication intensity ~$1.06M/tonne. This is a historical engineering model; do not use as current ARC pricing without adjustment (materials and design have since shifted to a vanadium/tungsten baseline).',
        entityIds: [ids.entities.arc, ids.entities.vacuumVessel],
        metadata: { provenanceClass: 'ENGINEERING_ESTIMATE' },
      },
      {
        id: ids.evidence.arc2025VanadiumVesselModel,
        observedAt: '2025-01-01T00:00:00Z',
        source: { name: 'CONVERSATION_RESEARCH' },
        description:
          'A 2025 ARC-class vessel model using V-4Cr-4Ti (density ~6.05 g/cm3) over a ~3.5 m3 vessel volume implies structural mass ~21.2 tonnes. Not the current V3A final bill of materials.',
        entityIds: [ids.entities.arc, ids.entities.vacuumVessel, ids.entities.vanadium],
        metadata: { provenanceClass: 'ENGINEERING_ESTIMATE' },
      },
      {
        id: ids.evidence.tungstenIrradiationPaper,
        observedAt: '2023-01-01T00:00:00Z',
        publishedAt: '2023-01-01T00:00:00Z',
        source: {
          name: 'Acta Materialia 257 (2023) 119025',
          uri: 'https://doi.org/10.1016/j.actamat.2023.119025',
          metadata: { preprint: 'SSRN 4208215' },
        },
        description:
          '"Degradation of Electrical Resistivity of Tungsten Following Shielded Neutron Irradiation": tungsten irradiated at ORNL HFIR (~0.2-0.7 dpa, ~500-1000C) shows radiation defects degrading electron mobility/thermal transport; defect clusters and W->Re->Os transmutation both contribute (estimated ~0.83 at% Re/dpa in the relevant regime); at ~0.4 dpa/~590C defects dominate, at ~0.7 dpa/~750C Re solid-solution contribution becomes important; recrystallization occurs near ~990C. Potential mitigations: W-Re alloys, improved materials, alternative PFC materials.',
        entityIds: [ids.entities.tungsten, ids.entities.rhenium],
        metadata: { provenanceClass: 'PAPER_FINDING' },
      },
      {
        id: ids.evidence.tungstenFleetDemandStudy2025,
        observedAt: '2025-01-01T00:00:00Z',
        source: { name: 'CONVERSATION_RESEARCH' },
        description:
          'A 2025 fleet study modeled large-scale tungsten demand: ARIES-ST at 500 MWth ~4,231 t, at 2 GWth ~29,034 t; EU-DEMO1 at 500 MWth ~3,945 t, at 2 GWth ~9,554 t. A large commercial fusion fleet could require very large tungsten inventories; the study indicated new tungsten resources potentially needed by ~2050, depending on deployment trajectory.',
        entityIds: [ids.entities.tungsten, ids.entities.euDemo],
        metadata: { provenanceClass: 'ENGINEERING_ESTIMATE' },
      },
      {
        id: ids.evidence.rheniumProduction2024,
        observedAt: '2024-01-01T00:00:00Z',
        source: { name: 'CONVERSATION_RESEARCH' },
        description:
          '2024 world rhenium production ~62,000 kg; rhenium is mostly produced as a byproduct of copper/molybdenum mining.',
        entityIds: [ids.entities.rhenium],
        metadata: { provenanceClass: 'FACT' },
      },
      {
        id: ids.evidence.elmtFinancials,
        observedAt: SNAPSHOT,
        source: { name: 'ELMT SEC/company financial disclosures' },
        description:
          'ELMT 2025: revenue ~$201.6M, adjusted EBITDA ~$23.8M. Q2 FY2026: revenue ~$66.4M (+35.2% YoY), adjusted EBITDA ~$8.9M (+57.9% YoY), backlog ~$131.5M-$132M. Market snapshot discussed: market cap ~$511M, share price ~$16.78 — a point-in-time market observation not to be reused outside its observation date.',
        entityIds: [ids.entities.elmt],
        metadata: { provenanceClass: 'FACT' },
      },
      {
        id: ids.evidence.elmtChadwickSelection,
        observedAt: SNAPSHOT,
        source: { name: 'CONVERSATION_RESEARCH' },
        description:
          'ELMT and ATI were selected under ARPA-E CHADWICK to manufacture candidate tungsten/vanadium materials for ARC-relevant irradiation testing. This is a development/irradiation-testing relationship; it does NOT establish an ARC production contract.',
        entityIds: [ids.entities.elmt, ids.entities.ati, ids.entities.doe, ids.entities.arc],
        metadata: { provenanceClass: 'GOVERNMENT_CLAIM' },
      },
      {
        id: ids.evidence.elmtManagementTungstenEstimates,
        observedAt: SNAPSHOT,
        source: { name: 'ELMT SEC/company disclosures' },
        description:
          'Management estimates discussed suggest a prototype fusion reactor implies ~$4M tungsten content and ~$5M specialty HPM content for ELMT; larger units approximately 3x the tungsten content. These are company management estimates, not observed contract values.',
        entityIds: [ids.entities.elmt, ids.entities.tungsten, ids.entities.arc],
        metadata: { provenanceClass: 'COMPANY_CLAIM' },
      },
      {
        id: ids.evidence.elmtAmsOsramAcquisition,
        observedAt: SNAPSHOT,
        publishedAt: SNAPSHOT,
        availableAt: SNAPSHOT,
        source: { name: 'SEC Exhibit 99.1, September 8 2026' },
        description:
          "ELMT announced a definitive agreement to acquire ams OSRAM's tungsten/molybdenum manufacturing operations in Schwabmünchen, Germany (powder, rods, wire, electrodes, machined components, integrated production, materials laboratory); expected closing Q1 2027. Metal-production operations have existed at the Schwabmünchen site since approximately 1961, over a production area of approximately 26,800 m2, producing more than 3,500 products with an integrated manufacturing chain (powder formation, pressing, sintering, swaging, wire drawing, finishing) plus downstream machining and powder-injection-molding capabilities and an on-site chemical/physical materials laboratory. ELMT intends to retain the existing Schwabmünchen leadership/operating team; invest in workforce, equipment, capacity, quality systems, and commercial infrastructure; support existing customers through production/transition arrangements; establish a European manufacturing platform using the site (ELMT's first EU refractory-metals manufacturing footprint, tungsten being an EU critical raw material with limited European processing capacity); and expand the material portfolio to include TZM and tungsten heavy alloy (a planned, not current, capability). Potentially increases ELMT's European manufacturing footprint, tungsten capacity, vertical integration, and geographic diversification, and explicitly identifies fusion/high-energy research as a target market for the acquired operation. This is NOT automatically fusion-positive — it could strengthen the base business independently of fusion — and does NOT establish that ELMT is currently a commercial fusion supplier.",
        entityIds: [
          ids.entities.elmt,
          ids.entities.amsOsram,
          ids.entities.schwabmunchenMetalOperations,
          ids.entities.schwabmunchenMaterialsLab,
          ids.entities.schwabmunchenCustomerBase,
          ids.entities.elmtSchwabmunchenAcquisition,
          ids.entities.europeanRefractoryMetalsPlatform,
          ids.entities.tzm,
          ids.entities.tungstenHeavyAlloy,
        ],
        metadata: { provenanceClass: 'COMPANY_CLAIM' },
      },
      {
        id: ids.evidence.vitzroNextechListingFinancials,
        observedAt: SNAPSHOT,
        source: { name: 'Vitzro Nextech financial disclosures' },
        description:
          'Vitzro Nextech listed November 21, 2025; point-in-time price discussed ~KRW 9,330, market cap ~KRW 270B, ~28.98M shares, 52-week range ~KRW 6,540-31,100. 2025: revenue ~KRW 36.79B, operating loss ~KRW 7.36B, net loss ~KRW 6.6B. H1 2026: revenue ~KRW 13.79B, operating loss ~KRW 6.49B, net loss ~KRW 5.40B. H1 2026 revenue mix approximately: aerospace 40.1%, plasma 33.5%, fusion 19.9%, remainder accelerator. Products include tungsten monoblocks/legs, bending blocks, endboxes, module structures, target assemblies, cassette divertor components, NBI, ICRF, and ITER/blanket/diagnostic shielding.',
        entityIds: [ids.entities.vitzroNextech, ids.entities.tungsten],
        metadata: { provenanceClass: 'FACT' },
      },
      {
        id: ids.evidence.vitzroNextechIterContracts,
        observedAt: '2026-01-01T00:00:00Z',
        source: { name: 'CONVERSATION_RESEARCH' },
        description:
          'Vitzro Nextech ITER-related contracts: vertical stabilization coil ~KRW 19B, busbar ~KRW 14.5B, plus diagnostic and blanket shielding work; company has stated approximately KRW 50B of ITER orders over three years. Projected (not actual) fusion revenue discussed: 2025 KRW 11.1B, 2026 KRW 13.6B, 2027 KRW 20.9B, 2028 KRW 16.0B.',
        entityIds: [ids.entities.vitzroNextech, ids.entities.iter],
        metadata: { provenanceClass: 'COMPANY_CLAIM' },
      },
      {
        id: ids.evidence.vitzroNextechHanwhaContract,
        observedAt: '2026-08-06T00:00:00Z',
        publishedAt: '2026-08-06T00:00:00Z',
        availableAt: '2026-08-06T00:00:00Z',
        source: { name: 'CONVERSATION_RESEARCH' },
        description:
          'On August 6, 2026, Vitzro Nextech announced an aerospace engine component contract with Hanwha Aerospace worth approximately KRW 53.5B (approximately 145% of 2025 revenue), with completion expected November 2029. This is NOT a fusion contract.',
        entityIds: [ids.entities.vitzroNextech],
        metadata: { provenanceClass: 'COMPANY_CLAIM' },
      },
      {
        id: ids.evidence.cfetrBlanketNeutronicsPaper,
        observedAt: '2026-03-07T00:00:00Z',
        publishedAt: '2026-09-01T00:00:00Z',
        source: {
          name: 'Fusion Engineering and Design 230 (September 2026) 115839',
          metadata: { preprint: 'SSRN 6365815, posted March 7 2026' },
        },
        description:
          '"Neutronic analysis of tritium breeding characteristics and the neutron coupling effect in the CFETR Helium-Cooled Ceramic Breeder blanket": blanket geometry determines tritium breeding; material/structure choices matter; local under-breeding and under-multiplication can occur; whole-reactor neutron coupling matters — TBR is a system-level design problem, not a local one.',
        entityIds: [ids.entities.cfetr, ids.entities.tritium],
        metadata: { provenanceClass: 'PAPER_FINDING' },
      },
      {
        id: ids.evidence.flareFirstLightTbr,
        observedAt: '2026-01-01T00:00:00Z',
        source: { name: 'CONVERSATION_RESEARCH' },
        description:
          'FLARE (a liquid-lithium blanket concept, blanket depth ~2m) reported TBR ~1.8, with some simulations >1.8 and one MCNP geometry ~2.06. One scenario: ~41.3 mg tritium produced/shot, ~86.8 kg/year produced, ~42.1 kg/year consumed. High TBR does not by itself prove tritium extraction, processing, containment, maintenance, reliability, or commercial economics; potential risks include vacuum integrity, corrosion, pumping, and heat removal. Core principle: TBR alone is insufficient.',
        entityIds: [ids.entities.tritium],
        metadata: { provenanceClass: 'COMPANY_CLAIM' },
      },
      {
        id: ids.evidence.tritiumExtractionResearch,
        observedAt: '2026-05-01T00:00:00Z',
        publishedAt: '2027-01-01T00:00:00Z',
        source: {
          name: 'Environmental Impact Assessment Review 122 (January 2027) 108654; Nuclear Fusion 63 (2023), DOI 10.1088/1741-4326/acbec7',
          metadata: { preprint: 'SSRN 6685502, SSRN 6777486, May 2026' },
        },
        description:
          'Tritium extraction LCA compared four approaches (Maroni oxidation, Maroni electrolysis, direct lithium/tritium electrolysis, distillation), finding large differences in climate impact, energy use, and material requirements, driven mainly by electricity, process configuration, and system boundaries. A companion PbLi extraction study found continuous inline tritium removal important: slow extraction increases inventory, startup requirements, buffer requirements, and safety risk (methods: free surface, permeable membrane; critical variables: flow, geometry, membrane properties, diffusion, recombination). Useful framework: Net T availability = TBR x extraction efficiency x recovery efficiency - decay - leakage - inventory losses.',
        entityIds: [ids.entities.tritium],
        metadata: { provenanceClass: 'PAPER_FINDING' },
      },
      {
        id: ids.evidence.tritiumFuelCycleResearch,
        observedAt: '2026-04-28T00:00:00Z',
        publishedAt: '2026-09-01T00:00:00Z',
        source: {
          name: 'Fusion Engineering and Design 230 (September 2026) 115897; Abdou (2021)',
          metadata: { preprint: 'SSRN 6664032, April 28 2026' },
        },
        description:
          'Tritium supply/demand study: peak theoretical stockpiles ~35.1-47.5 kg vs. ITER requirement ~15.9 kg; potential deficits under high-demand/low-supply scenarios (>28 kg shortage mid-2050s, ~42 kg by 2070, ~181 kg if reactors need ~10% external top-up; ~760 tonnes/year if fusion supplies 10% of global electricity by 2100 — highly scenario-dependent). Approximate startup tritium inventories: ITER 15.9 kg, EU-DEMO 15 kg, J-DEMO 11.25 kg, STEP 7 kg, CFEDR 3.21 kg, ARC 1.14 kg, SPARC 0.75 kg, BEST 0.89 kg. Separately, Abdou (2021) establishes TBR_A >= TBR_R as the core self-sufficiency criterion, with achievable TBR ~1.05-1.15; self-sufficiency may be possible if fueling x burn fraction > ~0.7% and processing < ~4 hours (a stronger regime: >~2% and ~1-4 hours), with example startup inventories ~11 kg for 3 GW at 2%/4h, <5 kg at 5%/1h. Startup-inventory bottlenecks are distinct from mature-fleet self-sufficiency bottlenecks.',
        entityIds: [
          ids.entities.tritium,
          ids.entities.iter,
          ids.entities.euDemo,
          ids.entities.jDemo,
          ids.entities.step,
          ids.entities.cfedr,
          ids.entities.arc,
          ids.entities.sparc,
          ids.entities.best,
        ],
        metadata: { provenanceClass: 'PAPER_FINDING' },
      },
      {
        id: ids.evidence.pfcMaterialsResearch,
        observedAt: '2021-01-01T00:00:00Z',
        source: { name: 'CONVERSATION_RESEARCH' },
        description:
          'Plasma-facing-component materials research: 2025 findings show CuCrZr precipitate coarsening causing ~29% strength loss, with a cyclic-heating model producing ~44% degradation (degradation is not simply representable as dpa). 2021 DEMO divertor findings show high uncertainty in tungsten lifetime, CuCrZr lifetime, heat flux, fatigue, ratcheting, and irradiation effects — full fusion-relevant verification remains difficult. A 2026 European material downselection considers K-doped tungsten, W2C, ZrC, WfW, ODS-Cu, and Wf-CuCr, with fabrication/high-temperature-strength/scale-up/qualification as the main challenges; COMPASS-U uses 100% tungsten coverage; 2026 K-doped tungsten mockups reached cyclic tests up to ~2000 cycles at heat flux up to ~20 MW/m2, with qualification ongoing.',
        entityIds: [
          ids.entities.cucrzr,
          ids.entities.tungsten,
          ids.entities.divertor,
          ids.entities.compassU,
        ],
        metadata: { provenanceClass: 'PAPER_FINDING' },
      },
      {
        id: ids.evidence.maintenanceAvailabilityResearch,
        observedAt: '2026-01-01T00:00:00Z',
        source: { name: 'CONVERSATION_RESEARCH' },
        description:
          'Maintenance/availability research: Crofts & Harman (2014) found blanket/divertor sector replacement around every ~1000h, with four remote-handling systems considered for ~75% availability; Farquhar (2019) modeled planned in-vessel maintenance <=250 days (e.g. 30 days cooldown, 30 days pumpdown/conditioning), with blanket replacement estimates ranging 825 days (1 RM system) down to 155 days (6 systems), and laser cutting/welding improvements saving ~180h/sector and cutting welding from 70h to 29h. Schwartz (2026) found plant value can be ~15% higher than naive availability-proportional calculations, that 80% availability with annual maintenance can retain ~91% of plant value, that maintenance timing matters, and modeled blanket durability ~0.7-5 FPY with blanket cost ~$0-500M/GW. Tesini (2026) proposed a "Q_ENG" engineering burden index cascading from Q_PHYSICS through Q_ENG, Q_GLOBAL, to Q_PLANT.',
        entityIds: [ids.entities.vacuumVessel, ids.entities.divertor],
        metadata: { provenanceClass: 'PAPER_FINDING' },
      },
      {
        id: ids.evidence.almontySangdongOfftake,
        observedAt: '2026-07-01T00:00:00Z',
        source: { name: 'CONVERSATION_RESEARCH' },
        description:
          "Almonty's Sangdong tungsten processing began July 2026. An amended offtake with GTP/Plansee runs approximately 21 years, approximately 4.41M MTU, with volume increased ~40% and improved pricing. Fusion demand is only one possible demand source; current economics are driven by broader tungsten market conditions.",
        entityIds: [ids.entities.almonty, ids.entities.plansee, ids.entities.tungsten],
        metadata: { provenanceClass: 'COMPANY_CLAIM' },
      },
      {
        id: ids.evidence.elmtSchwabmunchenApa,
        observedAt: SNAPSHOT,
        publishedAt: SNAPSHOT,
        availableAt: SNAPSHOT,
        source: { name: 'SEC Asset Purchase Agreement (exhibit to ELMT SEC filing)' },
        description:
          'Asset Purchase Agreement dated 2026-09-03: ELMT\'s newly formed German subsidiary, Elmet Technologies GmbH, agreed to acquire assets and rights associated with the Schwabmünchen operation from ams OSRAM/OSRAM GmbH via an asset purchase. Approximately 157 employees were associated with the relevant metal-production business at the time of the transaction documentation, with planned workforce restructuring following the transaction. Existing customers are intended to be supported through production/transition arrangements; ELMT will assume supply, quality, and technical support responsibilities for the transferred business after closing. The purchase-price mechanism is a formula beginning with a negative EUR 18M amount, then adjusted for items including pension assets, defined-benefit pension liabilities, a restructuring prepayment, working capital relative to a specified target, and other transaction-specific adjustments — the final closing consideration is NOT simply "ELMT paid/received EUR 18M" and remains UNKNOWN until closing.',
        entityIds: [
          ids.entities.elmt,
          ids.entities.amsOsram,
          ids.entities.elmtSchwabmunchenAcquisition,
          ids.entities.schwabmunchenWorkforce,
          ids.entities.schwabmunchenCustomerBase,
        ],
        metadata: { provenanceClass: 'COMPANY_CLAIM' },
      },
      {
        id: ids.evidence.osramHistoricalMaterialsDocumentation,
        observedAt: SNAPSHOT,
        source: { name: 'Historical OSRAM materials documentation' },
        description:
          "Historical OSRAM materials documentation indicates the Schwabmünchen operation's experience with multiple tungsten compositions (including pure tungsten and potassium-doped tungsten), molybdenum products, an integrated manufacturing chain (powder formation, pressing, sintering, swaging, wire drawing, finishing), and downstream machining/powder-injection-molding capabilities, plus chemical/physical materials-analysis capabilities. Does not establish current commercial production volumes.",
        entityIds: [
          ids.entities.schwabmunchenMetalOperations,
          ids.entities.pureTungsten,
          ids.entities.kDopedTungsten,
        ],
        metadata: { provenanceClass: 'COMPANY_CLAIM' },
      },
      {
        id: ids.evidence.schwabmunchenFusionResearchPublication,
        observedAt: SNAPSHOT,
        source: { name: 'Documented publication (Schwabmünchen/ams OSRAM personnel)' },
        description:
          'A documented publication involving personnel associated with the Schwabmünchen/ams OSRAM operation concerns tungsten wire/materials research for fusion-reactor applications. This establishes historical fusion-materials technical research involvement. It does NOT establish commercial fusion supply, ITER/DEMO/private-fusion qualification, a fusion customer relationship, or fleet-scale fusion supply.',
        entityIds: [ids.entities.schwabmunchenMetalOperations, ids.entities.fusionMaterials],
        metadata: { provenanceClass: 'PAPER_FINDING' },
      },
    ],

    // ------------------------------------------------------------------------------------------
    // Assertions
    // ------------------------------------------------------------------------------------------
    assertions: [
      {
        id: ids.assertions.qualificationNotProcurement,
        statement: 'Supplier qualification does not imply commercial procurement.',
        status: 'active',
        createdAt: '2025-06-01T00:00:00Z',
        confidence: { value: 0.85 },
        evidenceIds: [ids.evidence.walterTostoVessel],
        entityIds: [ids.entities.walterTosto, ids.entities.sparc],
        relationshipIds: [ids.relationships.walterTostoSparc],
      },
      {
        id: ids.assertions.switchingCosts,
        statement: 'Specialized manufacturing capability can create supplier switching costs.',
        status: 'active',
        createdAt: '2025-06-01T00:00:00Z',
        confidence: { value: 0.8 },
        evidenceIds: [ids.evidence.walterTostoVessel, ids.evidence.fujikuraHts],
        entityIds: [ids.entities.walterTosto, ids.entities.fujikura],
        relationshipIds: [ids.relationships.walterTostoSparc, ids.relationships.fujikuraCfs],
      },
      {
        id: ids.assertions.fusionSentimentTrap,
        statement:
          'A fusion stock rising because fusion headlines are positive does not imply future earnings increase.',
        status: 'active',
        createdAt: SNAPSHOT,
        evidenceIds: [],
      },
      {
        id: ids.assertions.directnessBias,
        statement:
          'A company saying "we work in fusion" may have less economic exposure to fusion than a boring industrial supplier does.',
        status: 'active',
        createdAt: SNAPSHOT,
        evidenceIds: [],
      },
      {
        id: ids.assertions.commodityTrap,
        statement:
          'Selling a fusion-relevant commodity material does not necessarily mean capturing fusion economics.',
        status: 'active',
        createdAt: SNAPSHOT,
        evidenceIds: [ids.evidence.almontySangdongOfftake],
        entityIds: [ids.entities.kennametal, ids.entities.almonty],
      },
      {
        id: ids.assertions.qualificationFallacy,
        statement:
          'Being technically capable of manufacturing a component does not imply being qualified to supply it for fusion.',
        status: 'active',
        createdAt: SNAPSHOT,
        evidenceIds: [],
      },
      {
        id: ids.assertions.contractFallacy,
        statement:
          'One prototype or demonstration-scale contract does not imply fleet-scale commercial revenue.',
        status: 'active',
        createdAt: SNAPSHOT,
        evidenceIds: [ids.evidence.elmtChadwickSelection],
        entityIds: [ids.entities.elmt],
      },
      {
        id: ids.assertions.marketCapBlindness,
        statement:
          'A large company receiving modest fusion revenue may have less fusion economic leverage than a much smaller company receiving less absolute fusion revenue.',
        status: 'active',
        createdAt: SNAPSHOT,
        evidenceIds: [],
      },
      {
        id: ids.assertions.bottleneckPowerIndependentOfRevenueSize,
        statement:
          'The most economically attractive supplier may not be the one selling the most material, but the one controlling the component whose absence stops the reactor; bottleneck power should be modeled independently of revenue size.',
        status: 'active',
        createdAt: SNAPSHOT,
        evidenceIds: [ids.evidence.simicTfCaseContract, ids.evidence.walterTostoVessel],
        entityIds: [ids.entities.simic, ids.entities.walterTosto],
      },
      {
        id: ids.assertions.replacementDemandCompounds,
        statement:
          'A component with a high replacement frequency can have greater lifetime economics than a component with a large one-time sale; fleet economic exposure is initial deployment demand plus replacement demand.',
        status: 'active',
        createdAt: SNAPSHOT,
        evidenceIds: [ids.evidence.arcV3aDesignParams],
        entityIds: [ids.entities.arc, ids.entities.vacuumVessel],
      },
    ],

    // ------------------------------------------------------------------------------------------
    // Hypotheses
    // ------------------------------------------------------------------------------------------
    hypotheses: [
      {
        id: ids.hypotheses.t001TungstenBottleneck,
        name: 'T-001',
        statement: 'Tungsten becomes a fusion materials bottleneck.',
        status: 'active',
        createdAt: '2025-01-01T00:00:00Z',
        assessments: [
          {
            timestamp: SNAPSHOT,
            confidence: { value: 0.65 },
            supportingEvidenceIds: [
              ids.evidence.tungstenFleetDemandStudy2025,
              ids.evidence.planseeSupplyCommentary2026,
            ],
            contradictingEvidenceIds: [],
          },
        ],
      },
      {
        id: ids.hypotheses.t002RheniumBottleneck,
        name: 'T-002',
        statement: 'Rhenium becomes a meaningful bottleneck.',
        status: 'active',
        createdAt: '2025-01-01T00:00:00Z',
        assessments: [
          {
            timestamp: SNAPSHOT,
            confidence: { value: 0.35 },
            supportingEvidenceIds: [
              ids.evidence.rheniumProduction2024,
              ids.evidence.tungstenIrradiationPaper,
            ],
            contradictingEvidenceIds: [],
            rationale: 'Lower conviction than the primary tungsten bottleneck.',
          },
        ],
      },
      {
        id: ids.hypotheses.t003TritiumSelfSufficiency,
        name: 'T-003',
        statement: 'Tritium self-sufficiency is a major reactor-design constraint.',
        status: 'active',
        createdAt: '2025-01-01T00:00:00Z',
        assessments: [
          {
            timestamp: SNAPSHOT,
            confidence: { value: 0.82 },
            supportingEvidenceIds: [
              ids.evidence.cfetrBlanketNeutronicsPaper,
              ids.evidence.tritiumFuelCycleResearch,
            ],
            contradictingEvidenceIds: [],
            rationale: 'Source estimate range ~0.75-0.90; 0.82 recorded as the point estimate.',
          },
        ],
      },
      {
        id: ids.hypotheses.t008TritiumConstrainsGrowth,
        name: 'T-008',
        statement: 'Tritium availability may constrain industry growth.',
        status: 'active',
        createdAt: '2025-01-01T00:00:00Z',
        assessments: [
          {
            timestamp: SNAPSHOT,
            confidence: { value: 0.85 },
            supportingEvidenceIds: [ids.evidence.tritiumFuelCycleResearch],
            contradictingEvidenceIds: [],
          },
        ],
      },
      {
        id: ids.hypotheses.t009HighTbrStrategicValue,
        name: 'T-009',
        statement: 'High-TBR reactors have strategic value because of tritium surplus.',
        status: 'active',
        createdAt: '2025-01-01T00:00:00Z',
        assessments: [
          {
            timestamp: SNAPSHOT,
            confidence: { value: 0.65 },
            supportingEvidenceIds: [ids.evidence.flareFirstLightTbr],
            contradictingEvidenceIds: [],
          },
        ],
      },
      {
        id: ids.hypotheses.h016RawHtsScarcity,
        name: 'H016',
        statement:
          'Raw HTS scarcity may become a bottleneck but is not necessarily the ultimate bottleneck.',
        status: 'active',
        createdAt: '2026-01-01T00:00:00Z',
        assessments: [
          {
            timestamp: SNAPSHOT,
            confidence: { value: 0.55 },
            supportingEvidenceIds: [ids.evidence.sparcHtsDelivery, ids.evidence.arcHtsEstimate],
            contradictingEvidenceIds: [],
          },
        ],
      },
      {
        id: ids.hypotheses.h018QualifiedConductorBottleneck,
        name: 'H018',
        statement:
          'Qualified high-field conductor manufacturing is a bigger bottleneck than raw tape supply.',
        status: 'active',
        createdAt: '2026-01-01T00:00:00Z',
        assessments: [
          {
            timestamp: SNAPSHOT,
            confidence: { value: 0.85 },
            supportingEvidenceIds: [ids.evidence.cfsMagnetTests2025, ids.evidence.arcHtsEstimate],
            contradictingEvidenceIds: [],
            rationale: 'Higher conviction than H016.',
          },
        ],
      },
      {
        id: ids.hypotheses.h019TfMajorityOfArcHts,
        name: 'H019',
        statement: 'TF consumes the majority of ARC HTS.',
        status: 'active',
        createdAt: '2026-01-01T00:00:00Z',
        assessments: [
          {
            timestamp: SNAPSHOT,
            confidence: { value: 0.55 },
            supportingEvidenceIds: [ids.evidence.arcHtsEstimate],
            contradictingEvidenceIds: [],
            rationale:
              'Uncertainty is high because the V3A TF/PF/CS split is not publicly finalized.',
          },
        ],
      },
      {
        id: ids.hypotheses.h020ValueMigratesDownstream,
        name: 'H020',
        statement: 'Value migrates downstream from raw tape toward conductor/magnet integration.',
        status: 'active',
        createdAt: '2026-01-01T00:00:00Z',
        assessments: [
          {
            timestamp: SNAPSHOT,
            confidence: { value: 0.85 },
            supportingEvidenceIds: [
              ids.evidence.cfsMagnetTests2025,
              ids.evidence.cfsTypeOneLicense,
            ],
            contradictingEvidenceIds: [],
          },
        ],
      },
      {
        id: ids.hypotheses.h021KaMMoreMeaningfulThanKm,
        name: 'H021',
        statement: 'Qualified kA*m is a more economically meaningful unit than raw km of HTS tape.',
        status: 'active',
        createdAt: '2026-01-01T00:00:00Z',
        assessments: [
          {
            timestamp: SNAPSHOT,
            confidence: { value: 0.9 },
            supportingEvidenceIds: [ids.evidence.arcHtsEstimate],
            contradictingEvidenceIds: [],
          },
        ],
      },
      {
        id: ids.hypotheses.h022CfsCapturesDownstreamShare,
        name: 'H022',
        statement:
          'CFS captures a larger share of downstream HTS value than raw-tape suppliers do.',
        status: 'active',
        createdAt: '2026-01-01T00:00:00Z',
        assessments: [
          {
            timestamp: SNAPSHOT,
            confidence: { value: 0.85 },
            supportingEvidenceIds: [
              ids.evidence.cfsTypeOneLicense,
              ids.evidence.cfsRealtaAgreement,
            ],
            contradictingEvidenceIds: [],
          },
        ],
      },
      {
        id: ids.hypotheses.h023MagnetManufacturingBottleneck,
        name: 'H023',
        statement: 'Magnet manufacturing is a commercialization bottleneck.',
        status: 'active',
        createdAt: '2026-01-01T00:00:00Z',
        assessments: [
          {
            timestamp: SNAPSHOT,
            confidence: { value: 0.82 },
            supportingEvidenceIds: [ids.evidence.sparcMagnetSpecs],
            contradictingEvidenceIds: [],
          },
        ],
      },
      {
        id: ids.hypotheses.h024IntegrationCapturesMoreValue,
        name: 'H024',
        statement: 'Integrated magnet manufacturing captures more value than raw tape production.',
        status: 'active',
        createdAt: '2026-01-01T00:00:00Z',
        assessments: [
          {
            timestamp: SNAPSHOT,
            confidence: { value: 0.88 },
            supportingEvidenceIds: [ids.evidence.cfsMagnetTests2025],
            contradictingEvidenceIds: [],
          },
        ],
      },
      {
        id: ids.hypotheses.h026LearningCurvesReduceCosts,
        name: 'H026',
        statement: 'Learning curves materially reduce magnet/conductor costs over time.',
        status: 'active',
        createdAt: '2026-01-01T00:00:00Z',
        assessments: [
          {
            timestamp: SNAPSHOT,
            confidence: { value: 0.8 },
            supportingEvidenceIds: [ids.evidence.sparcMagnetSpecs],
            contradictingEvidenceIds: [],
            rationale:
              'SPARC pancake-winding cycle time fell from ~30 days to a ~1/day target/achievement.',
          },
        ],
      },
      {
        id: ids.hypotheses.h032,
        name: 'H032',
        statement: 'Vacuum-vessel fabrication is a major commercial bottleneck.',
        status: 'active',
        createdAt: '2024-01-01T00:00:00Z',
        assessments: [
          {
            timestamp: '2024-12-31T23:59:59Z',
            confidence: { value: 0.75 },
            supportingEvidenceIds: [ids.evidence.walterTostoVessel],
            contradictingEvidenceIds: [],
            rationale: 'Only one vessel fabricator has demonstrated qualification-track progress.',
          },
          {
            timestamp: '2025-12-31T23:59:59Z',
            confidence: { value: 0.85 },
            supportingEvidenceIds: [ids.evidence.walterTostoVessel],
            contradictingEvidenceIds: [],
            rationale: 'Qualification achieved; no second fabricator has emerged.',
          },
          {
            timestamp: '2026-12-31T23:59:59Z',
            confidence: { value: 0.94 },
            supportingEvidenceIds: [ids.evidence.walterTostoVessel],
            contradictingEvidenceIds: [],
            rationale: 'No competing vessel fabricator has qualified after two additional years.',
          },
        ],
        falsifiers: [
          {
            description: 'A second, independently qualified vacuum-vessel fabricator emerges.',
            evidenceIds: [],
          },
        ],
      },
      {
        id: ids.hypotheses.h033,
        name: 'H033',
        statement: 'Vessel qualification creates switching costs.',
        status: 'active',
        createdAt: '2025-01-01T00:00:00Z',
        assessments: [
          {
            timestamp: '2025-12-31T23:59:59Z',
            confidence: { value: 0.8 },
            supportingEvidenceIds: [ids.evidence.walterTostoVessel],
            contradictingEvidenceIds: [],
            rationale:
              'Qualification represents a multi-year, capital-intensive process few competitors have replicated.',
          },
          {
            timestamp: '2026-12-31T23:59:59Z',
            confidence: { value: 0.92 },
            supportingEvidenceIds: [ids.evidence.walterTostoVessel],
            contradictingEvidenceIds: [],
            rationale: 'CFS has not re-qualified an alternate vessel fabricator.',
          },
        ],
        falsifiers: [
          {
            description:
              'SPARC re-bids vessel-adjacent work to a new entrant without measurable switching cost.',
            evidenceIds: [],
          },
        ],
      },
      {
        id: ids.hypotheses.h034,
        name: 'H034',
        statement:
          'SPARC suppliers have informational/procurement advantages for later commercial orders.',
        status: 'active',
        createdAt: '2025-01-01T00:00:00Z',
        assessments: [
          {
            timestamp: '2025-12-31T23:59:59Z',
            confidence: { value: 0.6 },
            supportingEvidenceIds: [ids.evidence.walterTostoVessel],
            contradictingEvidenceIds: [],
            rationale:
              'Demonstration-scale suppliers plausibly carry forward institutional knowledge.',
          },
          {
            timestamp: '2026-12-31T23:59:59Z',
            confidence: { value: 0.75 },
            supportingEvidenceIds: [ids.evidence.walterTostoVessel],
            contradictingEvidenceIds: [],
            rationale:
              'Continued reliance on the same qualified suppliers through the demonstration program.',
          },
        ],
        falsifiers: [
          {
            description:
              'A supplier with no SPARC history wins a comparable commercial contract on equal footing.',
            evidenceIds: [],
          },
        ],
      },

      // ELMT / Schwabmünchen hypotheses — single current assessment each, dated to the
      // announcement snapshot (no historical trajectory is evidenced for these yet).
      {
        id: ids.hypotheses.hElmt001,
        name: 'H-ELMT-001',
        statement:
          "Schwabmünchen materially increases ELMT's tungsten/molybdenum manufacturing capacity.",
        status: 'active',
        createdAt: SNAPSHOT,
        assessments: [
          {
            timestamp: SNAPSHOT,
            confidence: { value: 0.8 },
            supportingEvidenceIds: [ids.evidence.elmtAmsOsramAcquisition],
            contradictingEvidenceIds: [],
          },
        ],
      },
      {
        id: ids.hypotheses.hElmt002,
        name: 'H-ELMT-002',
        statement:
          'Schwabmünchen provides ELMT with vertically integrated refractory-metals manufacturing capabilities that complement its existing U.S. operations.',
        status: 'active',
        createdAt: SNAPSHOT,
        assessments: [
          {
            timestamp: SNAPSHOT,
            confidence: { value: 0.85 },
            supportingEvidenceIds: [
              ids.evidence.elmtAmsOsramAcquisition,
              ids.evidence.osramHistoricalMaterialsDocumentation,
            ],
            contradictingEvidenceIds: [],
          },
        ],
      },
      {
        id: ids.hypotheses.hElmt003,
        name: 'H-ELMT-003',
        statement:
          'The acquisition provides ELMT with meaningful European tungsten manufacturing capability.',
        status: 'active',
        createdAt: SNAPSHOT,
        assessments: [
          {
            timestamp: SNAPSHOT,
            confidence: { value: 0.9 },
            supportingEvidenceIds: [ids.evidence.elmtAmsOsramAcquisition],
            contradictingEvidenceIds: [],
          },
        ],
      },
      {
        id: ids.hypotheses.hElmt004,
        name: 'H-ELMT-004',
        statement:
          'The Schwabmünchen operation possesses pre-existing technical expertise relevant to fusion materials.',
        status: 'active',
        createdAt: SNAPSHOT,
        assessments: [
          {
            timestamp: SNAPSHOT,
            confidence: { value: 0.75 },
            supportingEvidenceIds: [ids.evidence.schwabmunchenFusionResearchPublication],
            contradictingEvidenceIds: [],
          },
        ],
      },
      {
        id: ids.hypotheses.hElmt005,
        name: 'H-ELMT-005',
        statement:
          "The Schwabmünchen operation's existing capabilities could potentially be adapted for commercial fusion-material production.",
        status: 'active',
        createdAt: SNAPSHOT,
        assessments: [
          {
            timestamp: SNAPSHOT,
            confidence: { value: 0.6 },
            supportingEvidenceIds: [
              ids.evidence.osramHistoricalMaterialsDocumentation,
              ids.evidence.schwabmunchenFusionResearchPublication,
            ],
            contradictingEvidenceIds: [],
            rationale:
              'This is an inference and should remain explicitly labeled as such (source_type: INFERENCE).',
          },
        ],
      },
      {
        id: ids.hypotheses.hElmt006,
        name: 'H-ELMT-006',
        statement: 'ELMT could obtain qualification for at least one fusion-material application.',
        status: 'active',
        createdAt: SNAPSHOT,
        assessments: [
          {
            timestamp: SNAPSHOT,
            confidence: { value: 0.4 },
            supportingEvidenceIds: [ids.evidence.schwabmunchenFusionResearchPublication],
            contradictingEvidenceIds: [],
            rationale:
              'Intentionally conservative because qualification evidence is currently insufficient.',
          },
        ],
      },
      {
        id: ids.hypotheses.hElmt007,
        name: 'H-ELMT-007',
        statement: "The acquisition increases ELMT's long-term exposure to fusion-material demand.",
        status: 'active',
        createdAt: SNAPSHOT,
        assessments: [
          {
            timestamp: SNAPSHOT,
            confidence: { value: 0.7 },
            supportingEvidenceIds: [ids.evidence.elmtAmsOsramAcquisition],
            contradictingEvidenceIds: [],
          },
        ],
      },
      {
        id: ids.hypotheses.hElmt008,
        name: 'H-ELMT-008',
        statement:
          'The acquisition could eventually allow ELMT to participate in recurring tungsten replacement demand from commercial fusion reactors.',
        status: 'active',
        createdAt: SNAPSHOT,
        assessments: [
          {
            timestamp: SNAPSHOT,
            confidence: { value: 0.3 },
            supportingEvidenceIds: [ids.evidence.elmtAmsOsramAcquisition],
            contradictingEvidenceIds: [],
            rationale: 'Highly speculative until qualification and customer evidence exists.',
          },
        ],
      },
    ],

    // ------------------------------------------------------------------------------------------
    // Assumptions
    // ------------------------------------------------------------------------------------------
    assumptions: [
      {
        id: ids.assumptions.supplierMarketSharePersistence,
        name: 'Supplier market-share persistence',
        description:
          'Assumes Walter Tosto and Fujikura retain their current qualified-supplier status and market share for the projection horizon.',
        value: 0.6,
        recordedAt: '2026-01-01T00:00:00Z',
        confidence: { value: 0.5 },
      },
      {
        id: ids.assumptions.uniformFirstWallThickness,
        name: 'Uniform first-wall thickness',
        description:
          'Assumes a uniform first-wall thickness across the full reactor surface, with no allowance for structural reinforcement or penetrations.',
        value: { value: 0.005, unit: 'm' },
        recordedAt: '2026-01-01T00:00:00Z',
      },
      {
        id: ids.assumptions.tritiumSupplyConstrained,
        name: 'Tritium supply remains constrained',
        description:
          'Assumes tritium supply remains constrained through the projection horizon, limiting near-term reactor deployment pace.',
        value: true,
        recordedAt: '2026-01-01T00:00:00Z',
      },
      {
        id: ids.assumptions.htsTapePrice,
        name: 'Illustrative HTS tape price',
        description:
          'Illustrative raw HTS tape cost used for cost-sensitivity purposes only, not a forecast of actual procurement spend or supplier revenue.',
        value: { value: 22.5, unit: 'USD/m', uncertainty: { type: 'range', lower: 15, upper: 30 } },
        recordedAt: SNAPSHOT,
      },
      {
        id: ids.assumptions.tfCaseUnitCost,
        name: 'Illustrative TF case unit cost',
        description: 'Illustrative TF case cost, not an observed contract price.',
        value: {
          value: 2_000_000,
          unit: 'USD',
          uncertainty: { type: 'range', lower: 1_000_000, upper: 4_000_000 },
        },
        recordedAt: SNAPSHOT,
        confidence: { value: 0.3, basis: 'OUR_ESTIMATE / LOW_CONFIDENCE' },
      },
      {
        id: ids.assumptions.elmtIncrementalEbitMargin,
        name: 'ELMT incremental EBITDA margin',
        description:
          'Illustrative incremental EBITDA margin used only for a valuation sensitivity calculation, not a forecast.',
        value: 0.25,
        recordedAt: SNAPSHOT,
      },
    ],

    // ------------------------------------------------------------------------------------------
    // Variables
    // ------------------------------------------------------------------------------------------
    variables: [
      {
        id: ids.variables.reactorsDeployed,
        name: 'Reactors deployed',
        value: 2,
        origin: 'estimated',
        recordedAt: '2026-01-01T00:00:00Z',
      },
      {
        id: ids.variables.supplierMarketShare,
        name: 'Supplier market share',
        value: 0.6,
        origin: 'estimated',
        recordedAt: '2026-01-01T00:00:00Z',
      },
      {
        id: ids.variables.replacementCount,
        name: 'Replacement count',
        value: 3,
        origin: 'assumed',
        recordedAt: '2026-01-01T00:00:00Z',
      },
      {
        id: ids.variables.fusionRevenue,
        name: 'Fusion revenue',
        value: null,
        origin: 'derived',
        recordedAt: '2026-01-01T00:00:00Z',
        metadata: {
          note: 'Not computed. research-core does not implement a formula execution engine.',
        },
      },
      {
        id: ids.variables.arcFirstWallArea,
        name: 'ARC first-wall surface area',
        value: { value: 257, unit: 'm2' },
        origin: 'estimated',
        confidence: { value: 0.6 },
        recordedAt: '2026-01-01T00:00:00Z',
      },
      {
        id: ids.variables.arcFirstWallThickness,
        name: 'ARC first-wall thickness',
        value: { value: 0.005, unit: 'm' },
        origin: 'assumed',
        recordedAt: '2026-01-01T00:00:00Z',
      },
      {
        id: ids.variables.tungstenDensity,
        name: 'Tungsten density',
        value: { value: 19.25, unit: 'tonnes/m3' },
        origin: 'observed',
        recordedAt: '2026-01-01T00:00:00Z',
      },
      {
        id: ids.variables.arcTungstenVolume,
        name: 'ARC first-wall tungsten volume',
        value: { value: 1.285, unit: 'm3' },
        origin: 'derived',
        recordedAt: '2026-01-01T00:00:00Z',
      },
      {
        id: ids.variables.tungstenMass,
        name: 'ARC first-wall tungsten mass',
        value: {
          value: 24.7,
          unit: 'tonnes',
          uncertainty: {
            type: 'qualitative',
            description:
              'Derived from an approximate first-wall geometry and reference tungsten density — a proxy estimate, not an official ARC bill of materials. Excludes divertor, armor, shielding, joints, structural material, manufacturing scrap, replacement inventory, tungsten carbide, and non-planar geometry.',
          },
        },
        origin: 'derived',
        confidence: { value: 0.5, basis: 'geometric proxy estimate' },
        recordedAt: '2026-01-01T00:00:00Z',
      },
      {
        id: ids.variables.elmtPrototypeTungstenEstimate,
        name: "ELMT's disclosed prototype tungsten estimate",
        value: { value: 5, unit: 'tonnes' },
        origin: 'estimated',
        confidence: { value: 0.3, basis: 'preliminary, ELMT-disclosed prototype figure' },
        recordedAt: '2024-06-01T00:00:00Z',
        metadata: {
          note: 'ELMT-disclosed preliminary prototype estimate — not a verified commercial bill of materials.',
        },
      },
      {
        id: ids.variables.arcHtsLength,
        name: 'ARC estimated total REBCO length',
        value: {
          value: 20000,
          unit: 'km',
          uncertainty: { type: 'range', lower: 15000, upper: 20000 },
        },
        origin: 'estimated',
        confidence: { value: 0.4 },
        recordedAt: '2026-01-01T00:00:00Z',
      },
      {
        id: ids.variables.sparcHtsLength,
        name: 'SPARC historical REBCO length (per TF coil benchmark)',
        value: { value: 270, unit: 'km' },
        origin: 'observed',
        recordedAt: '2026-01-01T00:00:00Z',
      },
      {
        id: ids.variables.tfCaseCount,
        name: 'SPARC TF case count',
        value: 18,
        origin: 'observed',
        recordedAt: '2025-01-01T00:00:00Z',
      },
      {
        id: ids.variables.tfCaseUnitCostVar,
        name: 'TF case unit cost (illustrative)',
        value: { value: 2_000_000, unit: 'USD' },
        origin: 'assumed',
        confidence: { value: 0.3, basis: 'OUR_ESTIMATE / LOW_CONFIDENCE' },
        recordedAt: SNAPSHOT,
      },
      {
        id: ids.variables.tfCaseTotalCost,
        name: 'TF case total cost (illustrative, 18 cases)',
        value: null,
        origin: 'derived',
        recordedAt: SNAPSHOT,
        metadata: { note: 'Not computed — see calc-tf-case-total-cost.' },
      },
      {
        id: ids.variables.sparcVesselMass,
        name: 'SPARC vacuum vessel mass',
        value: { value: 96, unit: 'tonnes' },
        origin: 'observed',
        recordedAt: '2024-01-01T00:00:00Z',
      },
      {
        id: ids.variables.sparcVesselContractValue,
        name: 'SPARC vacuum vessel contract value',
        value: {
          value: 37_500_000,
          unit: 'EUR',
          uncertainty: { type: 'range', lower: 35_000_000, upper: 40_000_000 },
        },
        origin: 'observed',
        recordedAt: '2024-01-01T00:00:00Z',
      },
      {
        id: ids.variables.arcVesselHistoricalCostIntensity,
        name: 'Historical ARC vessel fabrication cost intensity (2015 Inconel design)',
        value: { value: 1.06, unit: 'USD_million/tonne' },
        origin: 'observed',
        recordedAt: '2015-01-01T00:00:00Z',
        metadata: {
          note: 'Historical engineering model — do not use as current ARC pricing without adjustment.',
        },
      },
      {
        id: ids.variables.elmtMarketCapSnapshot,
        name: 'ELMT market cap (point-in-time)',
        value: { value: 511_000_000, unit: 'USD' },
        origin: 'observed',
        recordedAt: SNAPSHOT,
        metadata: {
          note: 'Point-in-time market observation — must not be reused outside its observation date.',
        },
      },
      {
        id: ids.variables.elmtIncrementalEbitMargin,
        name: 'ELMT incremental EBITDA margin (illustrative)',
        value: 0.25,
        origin: 'assumed',
        recordedAt: SNAPSHOT,
      },
      {
        id: ids.variables.elmtValuationMultiple,
        name: 'ELMT illustrative incremental EBITDA multiple',
        value: 15,
        origin: 'assumed',
        recordedAt: SNAPSHOT,
      },
      {
        id: ids.variables.elmtContentPerReactorLow,
        name: 'ELMT content per reactor (low case)',
        value: { value: 5_000_000, unit: 'USD' },
        origin: 'estimated',
        recordedAt: SNAPSHOT,
      },
      {
        id: ids.variables.elmtContentPerReactorHigh,
        name: 'ELMT content per reactor (high case)',
        value: { value: 9_000_000, unit: 'USD' },
        origin: 'estimated',
        recordedAt: SNAPSHOT,
      },
      {
        id: ids.variables.elmtFusionRevenueTarget,
        name: 'ELMT illustrative fusion revenue required for a 3x value outcome',
        value: null,
        origin: 'derived',
        recordedAt: SNAPSHOT,
        metadata: {
          note: 'Not computed — see calc-elmt-fusion-revenue-target. Illustrative sensitivity figure discussed: ~$272M/year.',
        },
      },
    ],

    // ------------------------------------------------------------------------------------------
    // Models
    // ------------------------------------------------------------------------------------------
    models: [
      {
        id: ids.models.fusionRevenue,
        name: 'Fusion Revenue Model',
        description:
          'Fusion Revenue = Reactors Deployed x Component Content per Reactor x Supplier Market Share x Replacement Count',
        variableIds: [
          ids.variables.reactorsDeployed,
          ids.variables.tungstenMass,
          ids.variables.supplierMarketShare,
          ids.variables.replacementCount,
          ids.variables.fusionRevenue,
        ],
        assumptionIds: [ids.assumptions.supplierMarketSharePersistence],
        calculations: [
          {
            id: ids.calculations.fusionRevenue,
            name: 'Fusion Revenue',
            formula:
              'Fusion Revenue = Reactors Deployed x Component Content per Reactor x Supplier Market Share x Replacement Count',
            inputVariableIds: [
              ids.variables.reactorsDeployed,
              ids.variables.tungstenMass,
              ids.variables.supplierMarketShare,
              ids.variables.replacementCount,
            ],
            outputVariableId: ids.variables.fusionRevenue,
            assumptionIds: [ids.assumptions.supplierMarketSharePersistence],
          },
        ],
        outputVariableIds: [ids.variables.fusionRevenue],
        createdAt: '2026-01-01T00:00:00Z',
        evidenceIds: [ids.evidence.walterTostoVessel, ids.evidence.fujikuraHts],
      },
      {
        id: ids.models.arcTungstenEstimate,
        name: 'ARC First-Wall Tungsten Estimate',
        description:
          'Rough proxy calculation: first-wall surface area x thickness = volume; volume x tungsten density = mass.',
        variableIds: [
          ids.variables.arcFirstWallArea,
          ids.variables.arcFirstWallThickness,
          ids.variables.tungstenDensity,
          ids.variables.arcTungstenVolume,
          ids.variables.tungstenMass,
        ],
        assumptionIds: [ids.assumptions.uniformFirstWallThickness],
        calculations: [
          {
            id: ids.calculations.tungstenVolume,
            name: 'Tungsten volume',
            formula: 'Volume = First-Wall Area x First-Wall Thickness',
            inputVariableIds: [ids.variables.arcFirstWallArea, ids.variables.arcFirstWallThickness],
            outputVariableId: ids.variables.arcTungstenVolume,
            assumptionIds: [ids.assumptions.uniformFirstWallThickness],
          },
          {
            id: ids.calculations.tungstenMass,
            name: 'Tungsten mass',
            formula: 'Tungsten Mass = Volume x Tungsten Density',
            inputVariableIds: [ids.variables.arcTungstenVolume, ids.variables.tungstenDensity],
            outputVariableId: ids.variables.tungstenMass,
          },
        ],
        outputVariableIds: [ids.variables.tungstenMass],
        createdAt: '2026-01-01T00:00:00Z',
      },
      {
        id: ids.models.elmtValuationSensitivity,
        name: 'ELMT Valuation Sensitivity Model',
        description:
          'Illustrative sensitivity: if ELMT were valued at ~3x current equity value and investors required ~15x incremental EBITDA at a ~25% incremental margin, how much annual fusion revenue would that require? These are illustrative sensitivity calculations, not forecasts.',
        variableIds: [
          ids.variables.elmtMarketCapSnapshot,
          ids.variables.elmtIncrementalEbitMargin,
          ids.variables.elmtValuationMultiple,
          ids.variables.elmtContentPerReactorLow,
          ids.variables.elmtContentPerReactorHigh,
          ids.variables.elmtFusionRevenueTarget,
        ],
        assumptionIds: [ids.assumptions.elmtIncrementalEbitMargin],
        calculations: [
          {
            id: ids.calculations.elmtFusionRevenueTarget,
            name: 'ELMT illustrative fusion revenue target',
            formula:
              'Required Fusion Revenue = (Current Market Cap x 3 x (1/15)) / Incremental EBITDA Margin',
            inputVariableIds: [
              ids.variables.elmtMarketCapSnapshot,
              ids.variables.elmtValuationMultiple,
              ids.variables.elmtIncrementalEbitMargin,
            ],
            outputVariableId: ids.variables.elmtFusionRevenueTarget,
            assumptionIds: [ids.assumptions.elmtIncrementalEbitMargin],
          },
        ],
        outputVariableIds: [ids.variables.elmtFusionRevenueTarget],
        createdAt: SNAPSHOT,
        evidenceIds: [ids.evidence.elmtFinancials],
      },
    ],

    // ------------------------------------------------------------------------------------------
    // Scenarios
    // ------------------------------------------------------------------------------------------
    scenarios: [
      {
        id: ids.scenarios.highDemandConstrainedTritium,
        name: 'High-demand / constrained tritium',
        description:
          'Reactor demand accelerates, but tritium supply remains the binding constraint on near-term deployment pace.',
        assumptionIds: [
          ids.assumptions.tritiumSupplyConstrained,
          ids.assumptions.supplierMarketSharePersistence,
        ],
        variableOverrides: { [ids.variables.reactorsDeployed]: 1 },
        eventIds: [ids.events.tritiumSupplyConstraintPersists],
        recordedAt: '2026-01-01T00:00:00Z',
      },
      {
        id: ids.scenarios.fusionBull,
        name: 'Fusion Bull',
        description:
          'Faster commercialization, successful pilot plants, high reactor deployment, strong component demand, rapid supplier scale-up.',
        assumptionIds: [ids.assumptions.supplierMarketSharePersistence],
        variableOverrides: {},
        eventIds: [],
        recordedAt: SNAPSHOT,
      },
      {
        id: ids.scenarios.fusionDelay,
        name: 'Fusion Delay',
        description: 'Projects slip, revenue timing shifts later, valuations compress.',
        assumptionIds: [],
        variableOverrides: {},
        eventIds: [],
        recordedAt: SNAPSHOT,
      },
      {
        id: ids.scenarios.materialsBottleneck,
        name: 'Materials Bottleneck',
        description:
          'Tungsten or other structural material limits deployment; qualified suppliers gain pricing power.',
        assumptionIds: [],
        variableOverrides: {},
        eventIds: [],
        recordedAt: SNAPSHOT,
      },
      {
        id: ids.scenarios.htsBreakthrough,
        name: 'HTS Breakthrough',
        description: 'Lower conductor cost, faster magnet deployment, increased HTS demand.',
        assumptionIds: [ids.assumptions.htsTapePrice],
        variableOverrides: {},
        eventIds: [],
        recordedAt: SNAPSHOT,
      },
      {
        id: ids.scenarios.tritiumBottleneck,
        name: 'Tritium Bottleneck',
        description: 'Startup-inventory and extraction constraints delay deployment.',
        assumptionIds: [ids.assumptions.tritiumSupplyConstrained],
        variableOverrides: {},
        eventIds: [],
        recordedAt: SNAPSHOT,
      },
      {
        id: ids.scenarios.fusionFalseDawn,
        name: 'Fusion False Dawn',
        description:
          'Impressive technical milestones, poor economics, commercialization fails to scale.',
        assumptionIds: [],
        variableOverrides: {},
        eventIds: [],
        recordedAt: SNAPSHOT,
      },
      {
        id: ids.scenarios.supplierWinner,
        name: 'Supplier Winner',
        description:
          'One supplier captures a disproportionate share; qualification/capacity creates a durable moat.',
        assumptionIds: [ids.assumptions.supplierMarketSharePersistence],
        variableOverrides: {},
        eventIds: [],
        recordedAt: SNAPSHOT,
      },
      {
        id: ids.scenarios.commodityTrap,
        name: 'Commodity Trap',
        description:
          'Commodity demand rises, but suppliers fail to capture meaningful economic value from it.',
        assumptionIds: [],
        variableOverrides: {},
        eventIds: [],
        recordedAt: SNAPSHOT,
      },
    ],

    // ------------------------------------------------------------------------------------------
    // Events
    // ------------------------------------------------------------------------------------------
    events: [
      {
        id: ids.events.walterTostoProductionContract,
        // Not knowable until 2029 — see information-leak.test.ts.
        timestamp: '2029-03-01T00:00:00Z',
        type: 'SUPPLIER_WON_PRODUCTION_CONTRACT',
        entityIds: [ids.entities.walterTosto, ids.entities.sparc],
        payload: { contractType: 'production' },
        evidenceIds: [ids.evidence.walterTostoProductionContract],
      },
      {
        id: ids.events.tritiumSupplyConstraintPersists,
        timestamp: '2026-01-01T00:00:00Z',
        type: 'TRITIUM_SUPPLY_CONSTRAINT_PERSISTS',
        entityIds: [ids.entities.tritium],
        payload: {},
        evidenceIds: [],
      },
      {
        id: ids.events.elmtAmsOsramAcquisitionAnnounced,
        // Not knowable before September 8, 2026 — see information-leak.test.ts.
        timestamp: SNAPSHOT,
        type: 'ACQUISITION_ANNOUNCED',
        entityIds: [ids.entities.elmt, ids.entities.amsOsram],
        payload: { expectedClosing: 'Q1 2027' },
        evidenceIds: [ids.evidence.elmtAmsOsramAcquisition],
      },
      {
        id: ids.events.vitzroNextechHanwhaContractAwarded,
        // Not knowable before August 6, 2026 — see information-leak.test.ts.
        timestamp: '2026-08-06T00:00:00Z',
        type: 'AEROSPACE_CONTRACT_AWARDED',
        entityIds: [ids.entities.vitzroNextech],
        payload: {},
        evidenceIds: [ids.evidence.vitzroNextechHanwhaContract],
      },
    ],

    // ------------------------------------------------------------------------------------------
    // Research questions (spec §17)
    // ------------------------------------------------------------------------------------------
    questions: ELMT_RESEARCH_QUESTIONS.map((entry, index) => ({
      id: `question-rq-elmt-${String(index + 1).padStart(3, '0')}`,
      code: `RQ-ELMT-${String(index + 1).padStart(3, '0')}`,
      question: entry.question,
      status: 'open' as const,
      createdAt: SNAPSHOT,
      relatedEntityIds: entry.relatedEntityIds,
    })),
  };
}
