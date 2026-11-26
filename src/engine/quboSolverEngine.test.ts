import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CORE_QUANTUM_SOLVERS,
  IBM_HARDWARE_PROFILES,
  NOMINAL_CLIMATE_CONDITIONS,
} from '../constants';
import {
  buildFullMicrogridQuboProblem,
  buildMicrogridQubo,
  generateMicrogridTopology,
  runAllSolversSuite,
} from './quboSolverEngine';
import {
  allocateStatevector,
  applyCostUnitary,
  applyXMixer,
  computeExactSpectrum,
  evaluateIsingFromBits,
  evaluateQuboBits,
  maskToBits,
  quboToIsing,
  setPlusState,
} from './realQuantumSolvers';

test('QUBO to Ising Hamiltonian H_C mapping is mathematically exact across all 2^N bitstrings', () => {
  const topo = generateMicrogridTopology(8, 0.45, NOMINAL_CLIMATE_CONDITIONS);
  const { problem } = buildFullMicrogridQuboProblem(topo, NOMINAL_CLIMATE_CONDITIONS, [
    'thermal_limits',
    'voltage_stability',
    'renewable_intermittency',
  ]);
  const ising = quboToIsing(problem);
  const spec = computeExactSpectrum(problem);

  for (let mask = 0; mask < spec.dim; mask++) {
    const bits = maskToBits(mask, problem.n);
    const eQubo = evaluateQuboBits(problem, bits);
    const eIsing = evaluateIsingFromBits(ising, bits);
    assert.ok(
      Math.abs(eQubo - spec.energies[mask]) < 1e-9,
      `Exact DP spectrum mismatch on mask ${mask}: ${eQubo} vs ${spec.energies[mask]}`
    );
    assert.ok(
      Math.abs(eQubo - eIsing) < 1e-9,
      `QUBO vs Ising H_C mismatch on mask ${mask}: ${eQubo} vs ${eIsing}`
    );
  }
});

test('Statevector QAOA unitaries U_C(gamma) and X-mixer U_M(beta) strictly preserve norm ||ψ||^2 = 1', () => {
  const topo = generateMicrogridTopology(7, 0.4, NOMINAL_CLIMATE_CONDITIONS);
  const { problem } = buildFullMicrogridQuboProblem(topo, NOMINAL_CLIMATE_CONDITIONS, ['thermal_limits']);
  const spec = computeExactSpectrum(problem);
  const sv = allocateStatevector(problem.n);
  setPlusState(sv);

  applyCostUnitary(sv, spec.energies, 0.63);
  applyXMixer(sv, 0.41);
  applyCostUnitary(sv, spec.energies, 0.92);
  applyXMixer(sv, 0.27);

  let normSq = 0;
  for (let s = 0; s < sv.dim; s++) {
    normSq += sv.re[s] * sv.re[s] + sv.im[s] * sv.im[s];
  }
  assert.ok(Math.abs(normSq - 1.0) < 1e-12, `Statevector norm violated: ${normSq}`);
});

test('generateMicrogridTopology supports 6–12 rural microgrid nodes and scales cleanly up to 50 nodes', () => {
  const small = generateMicrogridTopology(8, 0.35, NOMINAL_CLIMATE_CONDITIONS);
  assert.equal(small.nodes.length, 8);
  assert.ok(small.edges.length >= 8);

  const maxScale = generateMicrogridTopology(50, 0.4, NOMINAL_CLIMATE_CONDITIONS);
  assert.equal(maxScale.nodes.length, 50);
  assert.ok(maxScale.edges.length > small.edges.length);

  const belowMin = generateMicrogridTopology(2, 0.2, NOMINAL_CLIMATE_CONDITIONS);
  assert.equal(belowMin.nodes.length, 6);
  const aboveMax = generateMicrogridTopology(99, 0.5, NOMINAL_CLIMATE_CONDITIONS);
  assert.equal(aboveMax.nodes.length, 50);
});

test('buildMicrogridQubo constructs symmetric QUBO, exact Ising H_C/H_M, and exact 2^N ground state for N <= 12', () => {
  const topo = generateMicrogridTopology(10, 0.45, NOMINAL_CLIMATE_CONDITIONS);
  const simHw = IBM_HARDWARE_PROFILES['aer_simulator (statevector)'];
  const qpuHw = IBM_HARDWARE_PROFILES['ibm_brisbane (127q)'];

  const simQubo = buildMicrogridQubo(
    topo,
    NOMINAL_CLIMATE_CONDITIONS,
    ['thermal_limits', 'voltage_stability', 'renewable_intermittency'],
    simHw,
    2
  );

  assert.equal(simQubo.nodeCount, 10);
  assert.equal(simQubo.matrixPreviewSize, 10);
  assert.equal(simQubo.exactGroundState, true);
  assert.ok(simQubo.isingSummary?.includes('H_C'));
  assert.ok(simQubo.mixerSummary?.includes('H_M'));
  assert.ok(simQubo.quboEnergyGround <= simQubo.quboEnergyGreedy + 1e-6);
  for (let i = 0; i < 10; i++) {
    for (let j = i + 1; j < 10; j++) {
      assert.equal(simQubo.matrix[i][j], simQubo.matrix[j][i], 'QUBO matrix must be symmetric');
    }
  }
  assert.equal(simQubo.hardwareFit.nativeSingleChip, true);
  assert.equal(simQubo.hardwareFit.swapOverheadRatio, 1.0);

  const qpuQubo = buildMicrogridQubo(
    topo,
    NOMINAL_CLIMATE_CONDITIONS,
    ['thermal_limits', 'voltage_stability'],
    qpuHw,
    2
  );
  assert.ok(qpuQubo.hardwareFit.swapOverheadRatio > 1.0, 'Heavy-Hex QPU incurs SWAP routing overhead');
  assert.ok(
    simQubo.hardwareFit.estimatedFidelityPct > qpuQubo.hardwareFit.estimatedFidelityPct,
    'IBM Aer simulator should achieve higher fidelity than noisy Eagle QPU'
  );
});

test('runAllSolversSuite runs all 9 real quantum/Ising solvers + Greedy & SA and genuinely reflects hardware noise', () => {
  const topo = generateMicrogridTopology(8, 0.45, NOMINAL_CLIMATE_CONDITIONS);
  const simHw = IBM_HARDWARE_PROFILES['aer_simulator (statevector)'];
  const noisyHw = {
    ...IBM_HARDWARE_PROFILES['ibm_brisbane (127q)'],
    twoQubitErrorRate: 0.025,
    readoutErrorRate: 0.04,
  };

  const idealSuite = runAllSolversSuite({
    topology: topo,
    climate: NOMINAL_CLIMATE_CONDITIONS,
    constraints: ['thermal_limits', 'voltage_stability', 'renewable_intermittency'],
    hardware: simHw,
    layersP: 3,
    optimizer: 'COBYLA',
    shots: 2048,
    selectedAlgorithm: 'CVaR-QAOA',
  });

  const algos = new Set(idealSuite.benchmarks.map((b) => b.algorithm));
  for (const required of CORE_QUANTUM_SOLVERS) {
    assert.ok(algos.has(required), `Missing required solver: ${required}`);
  }
  assert.ok(algos.has('Greedy Dispatch'));
  assert.ok(algos.has('Simulated Annealing'));

  // All achieved energies must be >= exact 2^N ground energy
  for (const b of idealSuite.benchmarks) {
    assert.ok(b.approxRatio >= 0 && b.approxRatio <= 1, `Invalid approxRatio for ${b.algorithm}: ${b.approxRatio}`);
    assert.ok(
      (b.achievedEnergy ?? 0) >= idealSuite.qubo.quboEnergyGround - 0.05,
      `${b.algorithm} energy ${b.achievedEnergy} cannot beat exact ground state ${idealSuite.qubo.quboEnergyGround}`
    );
    assert.ok(b.runtimeMs > 0, `Runtime must be positive for ${b.algorithm}`);
  }

  // Noise must genuinely degrade deep gate-model QAOA fidelity and measured expectation
  const noisySuite = runAllSolversSuite({
    topology: topo,
    climate: NOMINAL_CLIMATE_CONDITIONS,
    constraints: ['thermal_limits', 'voltage_stability', 'renewable_intermittency'],
    hardware: noisyHw,
    layersP: 3,
    optimizer: 'COBYLA',
    shots: 2048,
    selectedAlgorithm: 'QAOA',
  });
  const idealQaoa = idealSuite.benchmarks.find((b) => b.algorithm === 'QAOA')!;
  const noisyQaoa = noisySuite.benchmarks.find((b) => b.algorithm === 'QAOA')!;
  assert.ok(idealQaoa.fidelityPct > noisyQaoa.fidelityPct, 'Noisy QPU must genuinely lower QAOA fidelity');
  assert.ok(idealQaoa.approxRatio > noisyQaoa.approxRatio, 'High QPU noise must genuinely degrade QAOA expectation');

  assert.equal(idealSuite.densityConvergence.length, 5);
  assert.equal(idealSuite.optimizerTrajectory.length, 15);
  assert.ok(idealSuite.qiskitSamplerCode.includes('SamplerV2'));
  assert.ok(idealSuite.qiskitSamplerCode.includes('H_C'));
});

test('large 24-node microgrid runs real partitioned statevector decomposition and respects custom hardware caps', () => {
  const topo = generateMicrogridTopology(24, 0.35, NOMINAL_CLIMATE_CONDITIONS);
  const simHw = IBM_HARDWARE_PROFILES['aer_simulator (statevector)'];

  const smallChipSuite = runAllSolversSuite({
    topology: topo,
    climate: NOMINAL_CLIMATE_CONDITIONS,
    constraints: ['thermal_limits'],
    hardware: { ...simHw, maxQubits: 12, couplingTopology: 'heavy_hex' },
    layersP: 2,
    optimizer: 'SPSA',
    shots: 1024,
    selectedAlgorithm: 'QAOA',
  });

  assert.equal(smallChipSuite.qubo.hardwareFit.nativeSingleChip, false);
  assert.ok(smallChipSuite.qubo.hardwareFit.partitionsRequired >= 2);
  const qaoa = smallChipSuite.benchmarks.find((b) => b.algorithm === 'QAOA')!;
  assert.equal(qaoa.executionMode, 'partitioned_statevector');
  assert.ok(qaoa.approxRatio >= 0 && qaoa.approxRatio <= 1);
});

test('thermal penalty floor: near-limit feeders never make co-dispatching both endpoints cheaper than the best single endpoint', () => {
  const topo = generateMicrogridTopology(10, 0.5, NOMINAL_CLIMATE_CONDITIONS);
  const congested = {
    ...topo,
    edges: topo.edges.map((e) => ({ ...e, flowMW: e.limitMW * 0.97 })),
  };
  const { problem } = buildFullMicrogridQuboProblem(congested, NOMINAL_CLIMATE_CONDITIONS, ['thermal_limits']);
  assert.ok(problem.edges.length > 0);
  for (const e of problem.edges) {
    const both = problem.linear[e.i] + problem.linear[e.j] + e.qij;
    const bestSingle = Math.min(problem.linear[e.i], problem.linear[e.j]);
    assert.ok(
      both >= bestSingle - 1e-9,
      `Feeder (${e.i},${e.j}) co-dispatch energy ${both} beats best single endpoint ${bestSingle}`
    );
  }
});

test('runAllSolversSuite reports measurement-derived bestSampledRatio and groundStateProbability for quantum solvers', () => {
  const topo = generateMicrogridTopology(8, 0.45, NOMINAL_CLIMATE_CONDITIONS);
  const suite = runAllSolversSuite({
    topology: topo,
    climate: NOMINAL_CLIMATE_CONDITIONS,
    constraints: ['thermal_limits', 'voltage_stability'],
    hardware: IBM_HARDWARE_PROFILES['aer_simulator (statevector)'],
    layersP: 2,
    optimizer: 'COBYLA',
    shots: 2048,
    selectedAlgorithm: 'QAOA',
  });
  for (const b of suite.benchmarks) {
    assert.ok(b.bestSampledRatio !== undefined && b.bestSampledRatio >= 0 && b.bestSampledRatio <= 1, `${b.algorithm} bestSampledRatio`);
  }
  const qaoa = suite.benchmarks.find((b) => b.algorithm === 'QAOA')!;
  assert.ok(qaoa.groundStateProbability !== undefined);
  assert.ok(qaoa.groundStateProbability! >= 0 && qaoa.groundStateProbability! <= 1);
  const greedy = suite.benchmarks.find((b) => b.algorithm === 'Greedy Dispatch')!;
  assert.equal(greedy.groundStateProbability, undefined, 'Classical solvers have no measurement distribution');
});
