import type {
  ClassicalAlgorithm,
  ClassicalOptimizer,
  CouplingTopology,
  HardwareCapabilities,
  QiskitBackend,
  QuantumAlgorithm,
} from '../types/grid';

export const QISKIT_BACKENDS: readonly QiskitBackend[] = [
  'aer_simulator (statevector)',
  'ibm_torino (133q)',
  'ibm_fez (156q)',
  'ibm_brisbane (127q)',
  'ibm_kyoto (127q)',
  'ibm_osaka (127q)',
];

export const CORE_QUANTUM_SOLVERS: QuantumAlgorithm[] = [
  'QAOA',
  'VQA',
  'Ising Machine',
  'CVaR-QAOA',
  'BF-DCQO',
  'QE-MCMC',
  'QITE',
  'VarQITE',
  'GAS',
];

export const EXPLORE_QUANTUM_ALGORITHMS: QuantumAlgorithm[] = [
  ...CORE_QUANTUM_SOLVERS,
  'Custom Algorithm (Template)',
];

export const ALL_QUANTUM_ALGORITHMS: readonly QuantumAlgorithm[] = [
  ...CORE_QUANTUM_SOLVERS,
  'VQE',
  'Quantum Kernel SVM',
  'Grover-Adaptive',
  'Custom Algorithm (Template)',
];

export const CORE_CLASSICAL_BASELINES: ClassicalAlgorithm[] = [
  'Simulated Annealing',
  'Greedy Dispatch',
  'MILP (HiGHS)',
];

export const ALL_CLASSICAL_ALGORITHMS: readonly ClassicalAlgorithm[] = [
  'Greedy Dispatch',
  'Simulated Annealing',
  'MILP (HiGHS)',
  'Dijkstra Optimal Flow',
];

export const CLASSICAL_OPTIMIZERS: ClassicalOptimizer[] = [
  'COBYLA',
  'SPSA',
  'Powell',
  'NELDER_MEAD',
];

export const COUPLING_TOPOLOGIES: readonly CouplingTopology[] = [
  'all_to_all',
  'heavy_hex',
  'grid_2d',
];

export const SHOT_OPTIONS: readonly number[] = [1024, 4096, 8192];

export const ANSATZ_LAYER_OPTIONS: readonly number[] = [1, 2, 3, 4, 5, 6];

export const IBM_HARDWARE_PROFILES: Record<QiskitBackend, HardwareCapabilities> = {
  'aer_simulator (statevector)': {
    backendId: 'aer_simulator (statevector)',
    label: 'IBM Qiskit Aer Simulator (SamplerV2)',
    maxQubits: 50,
    couplingTopology: 'all_to_all',
    twoQubitErrorRate: 0.0004,
    readoutErrorRate: 0.001,
    t1Us: 500,
    t2Us: 400,
    maxDepthBudget: 320,
  },
  'ibm_torino (133q)': {
    backendId: 'ibm_torino (133q)',
    label: 'IBM Heron r1 — 133q QPU',
    maxQubits: 133,
    couplingTopology: 'heavy_hex',
    twoQubitErrorRate: 0.0036,
    readoutErrorRate: 0.011,
    t1Us: 195,
    t2Us: 148,
    maxDepthBudget: 140,
  },
  'ibm_fez (156q)': {
    backendId: 'ibm_fez (156q)',
    label: 'IBM Heron r2 — 156q QPU',
    maxQubits: 156,
    couplingTopology: 'heavy_hex',
    twoQubitErrorRate: 0.0029,
    readoutErrorRate: 0.009,
    t1Us: 225,
    t2Us: 175,
    maxDepthBudget: 165,
  },
  'ibm_brisbane (127q)': {
    backendId: 'ibm_brisbane (127q)',
    label: 'IBM Eagle r3 — 127q QPU',
    maxQubits: 127,
    couplingTopology: 'heavy_hex',
    twoQubitErrorRate: 0.0074,
    readoutErrorRate: 0.016,
    t1Us: 210,
    t2Us: 125,
    maxDepthBudget: 110,
  },
  'ibm_kyoto (127q)': {
    backendId: 'ibm_kyoto (127q)',
    label: 'IBM Eagle r3 — 127q QPU',
    maxQubits: 127,
    couplingTopology: 'heavy_hex',
    twoQubitErrorRate: 0.0085,
    readoutErrorRate: 0.019,
    t1Us: 190,
    t2Us: 112,
    maxDepthBudget: 95,
  },
  'ibm_osaka (127q)': {
    backendId: 'ibm_osaka (127q)',
    label: 'IBM Eagle r3 — 127q QPU',
    maxQubits: 127,
    couplingTopology: 'heavy_hex',
    twoQubitErrorRate: 0.0081,
    readoutErrorRate: 0.018,
    t1Us: 198,
    t2Us: 118,
    maxDepthBudget: 100,
  },
};

export const SOLVER_METADATA: Record<
  string,
  { category: 'quantum' | 'ising' | 'classical'; familyTag: string; notes: string }
> = {
  'CVaR-QAOA': {
    category: 'quantum',
    familyTag: 'Tail-Risk QAOA (α=0.25)',
    notes: 'Exact statevector QAOA minimizing lowest-25% energy tail; filters out noisy high-energy shot outliers',
  },
  'BF-DCQO': {
    category: 'quantum',
    familyTag: 'Bias-Field Counterdiabatic',
    notes: '3-round longitudinal bias-field feedback with shallow first-order counterdiabatic RY gauge rotations',
  },
  QAOA: {
    category: 'quantum',
    familyTag: 'Standard X-Mixer Ansatz',
    notes: 'Exact alternating U_C(γ)=exp(−iγH_C) and U_M(β)=∏RX(2β) tuned via selected classical optimizer',
  },
  'Ising Machine': {
    category: 'ising',
    familyTag: 'Ballistic Sim. Bifurcation',
    notes: 'Direct symplectic bSB spin dynamics on exact Ising (h, J); native all-to-all scaling up to 50 nodes',
  },
  VarQITE: {
    category: 'quantum',
    familyTag: 'Variational Imag. Time',
    notes: 'Natural-gradient imaginary-time parameter evolution on parameterized RY + cost-mixer circuit',
  },
  'QE-MCMC': {
    category: 'quantum',
    familyTag: 'Quantum-Enhanced MCMC',
    notes: 'Metropolis-Hastings chain using real Trotterized quantum evolution U(t)|x⟩ as proposal distribution',
  },
  QITE: {
    category: 'quantum',
    familyTag: 'Exact Imag. Time Evol.',
    notes: 'Direct exp(−τH_C) projection; very accurate on ideal Aer simulator, deep Pauli blocks suffer on noisy QPU',
  },
  VQA: {
    category: 'quantum',
    familyTag: 'Hardware-Efficient RY-CX',
    notes: 'Linear-chain RY-CX ansatz with zero SWAP routing overhead; limited expressivity on dense graphs',
  },
  GAS: {
    category: 'quantum',
    familyTag: 'Grover Adaptive Search',
    notes: 'Threshold phase-flip oracle + Grover diffuser; strong on ideal sim, deep oracle degrades under QPU noise',
  },
  'Simulated Annealing': {
    category: 'classical',
    familyTag: 'Classical Metropolis SA',
    notes: 'Multi-restart geometric cooling Metropolis-Hastings directly on full N×N microgrid QUBO',
  },
  'Greedy Dispatch': {
    category: 'classical',
    familyTag: 'Classical Myopic Baseline',
    notes: 'Single-pass linear priority dispatch with no backtracking; traps in local optima on coupled feeders',
  },
};
