export type HealthStatus = 'healthy' | 'warning' | 'alarming';

export type NodeRole = 'generator' | 'substation' | 'transformer' | 'load' | 'renewable';

export type AssetType =
  | 'solar_pv'
  | 'wind_turbine'
  | 'battery_storage'
  | 'hydro'
  | 'biomass'
  | 'diesel_backup'
  | 'thermal_plant'
  | 'substation'
  | 'transformer'
  | 'critical_load'
  | 'residential_load'
  | 'agricultural_load'
  | 'industrial_load'
  | 'ev_charging'
  | 'hybrid_der';

export type PathViewMode = 'quantum' | 'classical' | 'diff';

export type NavTab = 'overview' | 'diagnostics' | 'kernels' | 'explore' | 'impact';

export type GridViewMode = '3d' | '2d';

export type QuantumAlgorithm =
  | 'QAOA'
  | 'VQA'
  | 'Ising Machine'
  | 'CVaR-QAOA'
  | 'BF-DCQO'
  | 'QE-MCMC'
  | 'QITE'
  | 'VarQITE'
  | 'GAS'
  | 'VQE'
  | 'Quantum Kernel SVM'
  | 'Grover-Adaptive'
  | 'Custom Algorithm (Template)';

export type ClassicalAlgorithm =
  | 'Greedy Dispatch'
  | 'Simulated Annealing'
  | 'MILP (HiGHS)'
  | 'Dijkstra Optimal Flow';

export type QiskitBackend =
  | 'aer_simulator (statevector)'
  | 'ibm_torino (133q)'
  | 'ibm_fez (156q)'
  | 'ibm_brisbane (127q)'
  | 'ibm_kyoto (127q)'
  | 'ibm_osaka (127q)';

export type ClassicalOptimizer = 'COBYLA' | 'SPSA' | 'Powell' | 'NELDER_MEAD';

export type CouplingTopology = 'all_to_all' | 'heavy_hex' | 'grid_2d';

export interface HardwareCapabilities {
  backendId: QiskitBackend;
  label: string;
  maxQubits: number;
  couplingTopology: CouplingTopology;
  twoQubitErrorRate: number; // e.g. 0.0005 for Aer simulator, 0.0042 for Heron
  readoutErrorRate: number;
  t1Us: number;
  t2Us: number;
  maxDepthBudget: number;
}

export type ConstraintId =
  | 'thermal_limits'
  | 'voltage_stability'
  | 'n_minus_1'
  | 'renewable_intermittency'
  | 'substation_capacity';

export interface GridNode {
  id: string;
  name: string;
  role: NodeRole;
  assetType?: AssetType;
  region: string;
  zone?: string;
  x: number; // Normalized 0..1000 SVG coordinate
  y: number; // Normalized 0..560 SVG coordinate
  loadMW: number;
  capacityMW: number;
  voltagePU: number;
  temperatureC: number;
  phaseAngleDeg: number;
  qubitIndex: number;
  status: HealthStatus;
  quantumDispatchMW: number;
  classicalDispatchMW: number;
  // Optional real-world geo & live weather telemetry
  lat?: number;
  lon?: number;
  clusterId?: string;
  clusterName?: string;
  clusterColor?: string;
  solarWm2?: number;
  windSpeed80mMs?: number;
  ambientTempC?: number;
  // Extended renewable, storage, economic, and priority variables
  solarGenMW?: number;
  windGenMW?: number;
  batteryCapacityMWh?: number;
  batterySocPct?: number;
  maxChargeMW?: number;
  maxDischargeMW?: number;
  costPerMWh?: number;
  priorityWeight?: number; // 1 (deferrable) .. 5 (critical clinic/water/hospital)
  curtailable?: boolean;
  timestamp?: string;
}

export interface GridEdge {
  id: string;
  source: string;
  target: string;
  flowMW: number;
  limitMW: number;
  resistanceOhm: number;
  reactanceOhm?: number;
  lengthKm?: number;
  voltageKV?: number;
  isBidirectional?: boolean;
  lossMW: number;
  status: HealthStatus;
  isQuantumPath: boolean;
  isClassicalPath: boolean;
}

export interface GeoBounds {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
  regionId: string;
  regionLabel: string;
  country: string;
}

export interface GridTopology {
  id: string;
  name: string;
  description: string;
  nodes: GridNode[];
  edges: GridEdge[];
  geoBounds?: GeoBounds;
  sourceFormat?: 'csv' | 'json' | 'xlsx';
  availableTimestamps?: string[];
  activeTimestamp?: string;
}

export interface GridSummary {
  totalNodes: number;
  healthyCount: number;
  warningCount: number;
  alarmingCount: number;
  healthIndex: number;
  totalLoadMW: number;
  totalCapacityMW: number;
  totalLossMW: number;
  avgVoltagePU: number;
  congestionPct: number;
}

export interface GridAlert {
  id: string;
  timestamp: string;
  nodeId: string;
  nodeName: string;
  severity: 'warning' | 'alarming' | 'resolved';
  message: string;
  metricSummary: string;
}

export interface HistoricalLogEntry {
  id: string;
  timestamp: string;
  iteration: number;
  solver: string;
  datasetName: string;
  healthyCount: number;
  warningCount: number;
  alarmingCount: number;
  quantumAccuracy: number;
  classicalAccuracy: number;
  totalLossMW: number;
  runtimeMs: number;
  status: HealthStatus;
}

export interface CircuitGate {
  id: string;
  type: 'H' | 'RX' | 'RY' | 'RZ' | 'CX' | 'RZZ' | 'M';
  qubit: number;
  targetQubit?: number;
  column: number;
  paramLabel?: string;
}

export interface QuantumCircuitConfig {
  ansatz: 'QAOA' | 'VQE RealAmplitudes' | 'ZZFeatureMap Kernel';
  qubits: number;
  layers: number;
  shots: number;
  backend: QiskitBackend;
  enableNoise: boolean;
  seed?: number;
}

export interface BitstringCount {
  bitstring: string;
  probability: number;
  counts: number;
  energyCost: number;
  isOptimal: boolean;
}

export interface QuantumCircuitResult {
  config: QuantumCircuitConfig;
  gates: CircuitGate[];
  depth: number;
  twoQubitGates: number;
  fidelity: number;
  approximationRatio: number;
  classicalBaselineRatio: number;
  executionMs: number;
  bitstrings: BitstringCount[];
  convergenceHistory: { step: number; quantumCost: number; classicalCost: number }[];
  qiskitCode: string;
}

export interface KernelQARecord {
  id: string;
  runId: string;
  timestamp: string;
  modelName: string;
  solverType: 'quantum' | 'classical';
  kernelOrAnsatz: string;
  datasetName: string;
  iteration: number;
  qaStatus: 'pass' | 'warning' | 'fail';
  kernelAlignment: number;
  accuracyPct: number;
  lossReductionPct: number;
  shotVariance: number;
  gateCount: number;
  runtimeMs: number;
}

export type NodeSizeMode = 'compact' | 'standard' | 'proportional';

export interface ClimateConditions {
  locationName: string;
  ambientTempC: number; // Affects IEEE-738 conductor thermal derating
  windSpeedMs: number; // Convective cooling & wind output
  solarIrradianceWm2: number; // Solar generation availability
  stormRiskPct: number; // N-1 outage risk multiplier
  peakTariffMultiplier: number; // Non-climate market/demand stress factor
}

export interface BackendOptimizationPayload {
  schema_version: string;
  job_id: string;
  timestamp_utc: string;
  dataset: {
    name: string;
    node_count: number;
    edge_count: number;
    constraints_applied: ConstraintId[];
  };
  external_environment: ClimateConditions;
  quantum_solver: {
    algorithm: QuantumAlgorithm;
    backend: QiskitBackend;
    shots: number;
    qubits_per_partition: number;
    circuit_depth: number;
    fidelity: number;
    approximation_ratio: number;
    optimal_bitstring: string;
    metrics: {
      accuracy_pct: number;
      total_loss_mw: number;
      runtime_ms: number;
      constraint_feasibility_pct: number;
      grid_health_index: number;
    };
  };
  classical_baseline: {
    algorithm: ClassicalAlgorithm;
    metrics: {
      accuracy_pct: number;
      total_loss_mw: number;
      runtime_ms: number;
      constraint_feasibility_pct: number;
      grid_health_index: number;
    };
  };
  comparison_delta: {
    accuracy_gain_pct: number;
    loss_saved_mw: number;
    speedup_factor: number;
  };
  nodes: {
    id: string;
    name: string;
    role: NodeRole;
    status: HealthStatus;
    load_mw: number;
    capacity_mw: number;
    voltage_pu: number;
    temperature_c: number;
    quantum_dispatch_mw: number;
    classical_dispatch_mw: number;
    qubit_index: number;
  }[];
  edges: {
    id: string;
    source: string;
    target: string;
    flow_mw: number;
    effective_limit_mw: number;
    loss_mw: number;
    status: HealthStatus;
    selected_by_quantum: boolean;
    selected_by_classical: boolean;
  }[];
}

export interface ExploreRunResult {
  id: string;
  timestamp: string;
  datasetName: string;
  nodeCount: number;
  edgeCount: number;
  quantumAlgorithm: QuantumAlgorithm;
  classicalAlgorithm: ClassicalAlgorithm;
  backend: QiskitBackend;
  shots: number;
  partitionQubits: number;
  constraints: ConstraintId[];
  climate: ClimateConditions;
  quantumMetrics: {
    accuracyPct: number;
    lossMW: number;
    runtimeMs: number;
    feasibleConstraintsPct: number;
    healthIndex: number;
    circuitDepth: number;
  };
  classicalMetrics: {
    accuracyPct: number;
    lossMW: number;
    runtimeMs: number;
    feasibleConstraintsPct: number;
    healthIndex: number;
  };
  topology: GridTopology;
  circuitResult: QuantumCircuitResult;
  backendPayload: BackendOptimizationPayload;
  executionSource?: 'ibm_simulator' | 'custom_template' | 'offline_local';
}

export type ExecutionStatusMode = 'offline' | 'ibm_simulator' | 'ibm_quantum_live' | 'working';

export interface BackendRuntimeStatus {
  mode: ExecutionStatusMode;
  backendConnected: boolean;
  ibmTokenConfigured: boolean;
  activeJob: {
    jobId: string;
    algorithm: string;
    backend: QiskitBackend;
    startedAt: string;
    status: 'working' | 'completed';
  } | null;
  customTemplate: {
    id: string;
    version: string;
    filePath: string;
    isImplemented: boolean;
    notes: string;
  };
  liveRunsCount: number;
}

export interface AccuracyTimelinePoint {
  iteration: number;
  dateLabel: string;
  scale: 'small' | 'medium' | 'regional';
  constraintId: ConstraintId;
  quantumAccuracy: number;
  classicalAccuracy: number;
  lossSavingsMWh: number;
  latencyMs: number;
}

export interface ConstraintPerformanceRow {
  constraintId: ConstraintId;
  label: string;
  description: string;
  scale: 'small' | 'medium' | 'regional';
  quantumFeasibilityPct: number;
  classicalFeasibilityPct: number;
  accuracyDeltaPct: number;
  lossReductionMWh: number;
  congestionReliefPct: number;
  speedupFactor: number;
  co2AvoidedTons: number;
  avgLatencyMs: number;
}

export interface LiveRegionNodeSpec {
  id: string;
  name: string;
  role: NodeRole;
  clusterId: string;
  clusterName: string;
  clusterColor: string;
  lat: number;
  lon: number;
  baseLoadMW: number;
  capacityMW: number;
  qubitIndex: number;
}

export interface LiveRegionEdgeSpec {
  id: string;
  source: string;
  target: string;
  limitMW: number;
  resistanceOhm: number;
  isQuantumPrimary: boolean;
  isClassicalPrimary: boolean;
}

export interface LiveRegionDefinition {
  id: string;
  name: string;
  country: string;
  description: string;
  tariffMultiplier: number;
  nodes: LiveRegionNodeSpec[];
  edges: LiveRegionEdgeSpec[];
}

export interface LiveNodeForecastSeries {
  nodeId: string;
  lat: number;
  lon: number;
  elevationM: number;
  shortwaveRadiationWm2: number[];
  windSpeed80mMs: number[];
  temperature2mC: number[];
}

export interface LiveRegionStreamPayload {
  regionId: string;
  regionName: string;
  country: string;
  source: 'open_meteo_live' | 'fallback_model';
  apiProvider: string;
  fetchedAtUtc: string;
  timezone: string;
  timestamps: string[];
  currentSlotIndex: number;
  nodeSeries: LiveNodeForecastSeries[];
}

export interface QuboHardwareFit {
  nativeSingleChip: boolean;
  partitionsRequired: number;
  swapOverheadRatio: number;
  estimatedDepth: number;
  estimatedFidelityPct: number;
  verdict: string;
}

export interface QuboFormulation {
  nodeCount: number;
  edgeCount: number;
  graphDensity: number;
  matrixPreviewSize: number;
  matrix: number[][];
  nodeLabels: string[];
  linearTermsCount: number;
  quadraticTermsCount: number;
  penalties: {
    demandBalance: number;
    thermalOverload: number;
    renewableCurtailment: number;
    batterySoc: number;
  };
  hamiltonianSummary: string;
  isingSummary?: string;
  mixerSummary?: string;
  isingOffset?: number;
  exactGroundState?: boolean;
  optimalBitstringExact?: string;
  quboEnergyGround: number;
  quboEnergyGreedy: number;
  quboEnergyQuantum: number;
  hardwareFit: QuboHardwareFit;
}

export interface SolverBenchmarkEntry {
  algorithm: QuantumAlgorithm | ClassicalAlgorithm;
  category: 'quantum' | 'ising' | 'classical';
  familyTag: string;
  approxRatio: number;
  achievedEnergy?: number;
  expectationEnergy?: number;
  executionMode?:
    | 'exact_statevector'
    | 'partitioned_statevector'
    | 'ising_dynamics'
    | 'classical_qubo'
    | 'ibm_qpu_hardware';
  qiskitJobId?: string;
  qiskitBackendName?: string;
  demandMetPct: number;
  renewableUtilPct: number;
  costSavedDailyUsd: number;
  costSavedPct: number;
  lossMW: number;
  runtimeMs: number;
  circuitDepth: number;
  twoQubitGates: number;
  fidelityPct: number;
  convergedIterations: number;
  optimalBitstring: string;
  isSupportedAtScale: boolean;
  notes: string;
}

export interface DensityConvergencePoint {
  density: number;
  label: string;
  qaoaP1: number;
  qaoaP2: number;
  qaoaP4: number;
  cvarQaoa: number;
  bfDcqo: number;
  isingMachine: number;
  simulatedAnnealing: number;
  greedy: number;
}

export interface OptimizerTrajectoryPoint {
  iteration: number;
  qaoa: number;
  cvarQaoa: number;
  bfDcqo: number;
  varQite: number;
  simulatedAnnealing: number;
  greedy: number;
}

export interface QuboSuiteResult {
  nodeCount: number;
  edgeCount: number;
  graphDensity: number;
  layersP: number;
  optimizer: ClassicalOptimizer;
  shots: number;
  hardware: HardwareCapabilities;
  qubo: QuboFormulation;
  benchmarks: SolverBenchmarkEntry[];
  densityConvergence: DensityConvergencePoint[];
  optimizerTrajectory: OptimizerTrajectoryPoint[];
  qiskitSamplerCode: string;
}

export interface QiskitBackendInfo {
  name: string;
  qubits: number;
  status: string;
  pendingJobs: number;
  simulator: boolean;
}

export interface QiskitRuntimeCapabilities {
  ibmCloudRestConfigured: boolean;
  ibmInstanceConfigured: boolean;
  ibmRegion: string;
  qiskitServiceUrlConfigured: boolean;
  localPythonQiskitAvailable: boolean;
  localQiskitVersion: string | null;
  localAerAvailable: boolean;
  localIbmRuntimeAvailable: boolean;
  activeMode: 'ibm_cloud_rest' | 'qiskit_python_service' | 'qiskit_local_python' | 'unconfigured';
  liveBackends: QiskitBackendInfo[];
  setupHint: string;
}

export interface QiskitPubExecutionResult {
  pubIndex: number;
  algorithm: QuantumAlgorithm;
  layersP: number;
  transpiledDepth: number;
  twoQubitGateCount: number;
  openQasm3: string;
  optimalBitstring?: string;
  achievedQuboEnergy?: number;
  expectationQuboEnergy?: number;
  approxRatio?: number;
  fidelityPct?: number;
  demandMetPct?: number;
  renewableUtilPct?: number;
  lossMW?: number;
  costSavedDailyUsd?: number;
  costSavedPct?: number;
  topBitstrings?: BitstringCount[];
}

export interface QiskitJobExecutionResult {
  executionEngine: 'ibm_cloud_rest' | 'qiskit_python_service' | 'qiskit_local_python';
  jobId: string;
  backendName: string;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  submittedAtUtc: string;
  algorithm: QuantumAlgorithm;
  isBatch?: boolean;
  qubits: number;
  layersP: number;
  shots: number;
  transpiledDepth: number;
  twoQubitGateCount: number;
  openQasm3: string;
  optimalBitstring?: string;
  achievedQuboEnergy?: number;
  expectationQuboEnergy?: number;
  approxRatio?: number;
  fidelityPct?: number;
  demandMetPct?: number;
  renewableUtilPct?: number;
  lossMW?: number;
  costSavedDailyUsd?: number;
  costSavedPct?: number;
  runtimeMs?: number;
  topBitstrings?: BitstringCount[];
  optimalAngles?: number[];
  pubResults?: QiskitPubExecutionResult[];
  errorMessage?: string;
}

