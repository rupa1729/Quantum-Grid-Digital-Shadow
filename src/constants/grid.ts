import type { BackendRuntimeStatus, NavTab, NodeRole } from '../types/grid';

export const GRID_THRESHOLDS = {
  nodeUtilizationAlarming: 0.9,
  nodeUtilizationWarning: 0.75,
  voltageMinAlarmingPU: 0.94,
  voltageMaxAlarmingPU: 1.06,
  voltageMinWarningPU: 0.96,
  voltageMaxWarningPU: 1.04,
  temperatureAlarmingC: 85,
  temperatureWarningC: 72,
  edgeUtilizationAlarming: 0.9,
  edgeUtilizationWarning: 0.75,
} as const;

export const NODE_QUICK_PRESETS: readonly { label: string; nodes: number; density: number }[] = [
  { label: '6N', nodes: 6, density: 0.4 },
  { label: '8N', nodes: 8, density: 0.36 },
  { label: '12N', nodes: 12, density: 0.35 },
  { label: '24N', nodes: 24, density: 0.3 },
  { label: '36N', nodes: 36, density: 0.28 },
  { label: '50N', nodes: 50, density: 0.24 },
];

export const DENSITY_BENCHMARK_LEVELS: readonly { d: number; label: string }[] = [
  { d: 0.2, label: '0.20 (Radial)' },
  { d: 0.35, label: '0.35 (Ring)' },
  { d: 0.5, label: '0.50 (Meshed)' },
  { d: 0.65, label: '0.65 (Coupled)' },
  { d: 0.8, label: '0.80 (Dense)' },
];

export const MICROGRID_ROLE_CYCLE: readonly NodeRole[] = [
  'renewable',
  'load',
  'substation',
  'generator',
  'transformer',
  'load',
  'renewable',
];

export const MICROGRID_ASSET_LABELS: Record<NodeRole, readonly string[]> = {
  renewable: ['Solar PV Array', 'Wind Micro-Turbine', 'Agri-PV Feeder', 'Hybrid Wind-PV'],
  generator: ['BESS Battery Bank', 'Biomass Micro-Gen', 'LiFePO4 Storage', 'Flywheel Reserve'],
  substation: ['Village Substation', 'Feeder Tie Bus', 'Rural Collector'],
  transformer: ['Step-Up Trf', 'Phase Balancer', 'Distribution Trf'],
  load: ['Irrigation Pumps', 'Cold Storage Load', 'Community Clinic', 'Village Feeder'],
};

export const MICROGRID_CLUSTERS: readonly { id: string; name: string; color: string }[] = [
  { id: 'solar-north', name: 'North Solar-Wind Cluster', color: '#16A34A' },
  { id: 'bess-central', name: 'Central Battery & Tie Hub', color: '#0F62FE' },
  { id: 'agri-south', name: 'South Rural Load Feeder', color: '#D97706' },
];

export const SYNTHETIC_GRID_REGIONS: readonly string[] = [
  'North Basin',
  'Central Core',
  'East Valley',
  'South Coast',
  'West Plains',
];

export const PAGE_TITLES: Record<NavTab, { breadcrumb: string; title: string }> = {
  overview: {
    breadcrumb: 'Digital Q-Grid Twin / Overview',
    title: 'Grid Optimization & Live Telemetry',
  },
  diagnostics: {
    breadcrumb: 'Digital Q-Grid Twin / Diagnostics',
    title: 'Individual Node Diagnostics',
  },
  kernels: {
    breadcrumb: 'Digital Q-Grid Twin / Quantum Kernels & QA',
    title: 'Quantum Circuits, QA Validation & Model Benchmarks',
  },
  explore: {
    breadcrumb: 'Digital Q-Grid Twin / Explore Lab',
    title: 'Dataset Upload & IBM Qiskit Comparison Lab',
  },
  impact: {
    breadcrumb: 'Digital Q-Grid Twin / Impact',
    title: 'Business Value & Constraint Impact',
  },
};

export const OPEN_METEO_CONFIG = {
  baseUrl: 'https://api.open-meteo.com/v1/forecast',
  minutely15Variables: 'shortwave_radiation,wind_speed_80m,temperature_2m',
  forecastDays: '1',
  timezone: 'auto',
  cacheTtlMs: 5 * 60 * 1000,
} as const;

export const OFFLINE_BACKEND_STATUS: BackendRuntimeStatus = {
  mode: 'offline',
  backendConnected: false,
  ibmTokenConfigured: false,
  activeJob: null,
  customTemplate: {
    id: 'Custom Algorithm (Template)',
    version: '1.0.0',
    filePath: 'server/algorithmTemplate.ts',
    isImplemented: false,
    notes:
      'Backend offline — running in local browser engine mode. Start server.ts to connect live API routes.',
  },
  liveRunsCount: 0,
};

export const BACKEND_RESPONSE_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'QGridOptimizationResponse',
  type: 'object',
  required: [
    'schema_version',
    'job_id',
    'timestamp_utc',
    'dataset',
    'external_environment',
    'quantum_solver',
    'classical_baseline',
    'comparison_delta',
    'nodes',
    'edges',
  ],
  properties: {
    schema_version: { type: 'string', const: '1.0.0' },
    job_id: { type: 'string' },
    timestamp_utc: { type: 'string', format: 'date-time' },
    dataset: { type: 'object' },
    external_environment: { type: 'object' },
    quantum_solver: { type: 'object' },
    classical_baseline: { type: 'object' },
    comparison_delta: { type: 'object' },
    nodes: { type: 'array' },
    edges: { type: 'array' },
  },
} as const;

export const THEME_STORAGE_KEY = 'qgrid-theme';
