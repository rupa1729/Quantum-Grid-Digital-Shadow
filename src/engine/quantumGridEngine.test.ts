import test from 'node:test';
import assert from 'node:assert/strict';
import { CLIMATE_PRESETS } from '../constants';
import {
  applyClimateFactors,
  computeBusinessImpactMetrics,
  computeEdgeStatus,
  computeGridSummary,
  computeImpactSummary,
  computeNodeStatus,
  generateScalableGridTopology,
  injectGridFault,
  parseUploadedDataset,
  rerouteSingleNodeViaQuantum,
  runExploreComparison,
  runQuantumGridOptimization,
  simulateQuantumCircuit,
  updateNodeLoadStress,
} from './quantumGridEngine';
import {
  ACCURACY_TIMELINE_DATA,
  CONSTRAINT_PERFORMANCE_ROWS,
  INITIAL_GRID_TOPOLOGY,
  SAMPLE_CSV_TEMPLATE,
} from '../data/seedData';

test('computeNodeStatus classifies healthy, warning, and alarming states accurately', () => {
  assert.equal(computeNodeStatus(100, 200, 1.0, 55), 'healthy');
  assert.equal(computeNodeStatus(160, 200, 0.99, 62), 'warning');
  assert.equal(computeNodeStatus(185, 200, 1.0, 62), 'alarming');
  assert.equal(computeNodeStatus(100, 200, 0.93, 60), 'alarming');
  assert.equal(computeNodeStatus(100, 200, 1.0, 86), 'alarming');
});

test('computeEdgeStatus classifies congestion thresholds accurately', () => {
  assert.equal(computeEdgeStatus(100, 200), 'healthy');
  assert.equal(computeEdgeStatus(160, 200), 'warning');
  assert.equal(computeEdgeStatus(185, 200), 'alarming');
});

test('fault injection increases grid stress and quantum optimization restores health', () => {
  const initialSummary = computeGridSummary(INITIAL_GRID_TOPOLOGY.nodes, INITIAL_GRID_TOPOLOGY.edges);
  assert.equal(initialSummary.totalNodes, 14);
  assert.ok(initialSummary.alarmingCount >= 1);
  assert.ok(initialSummary.warningCount >= 1);

  const faulted = injectGridFault(INITIAL_GRID_TOPOLOGY, 99);
  assert.ok(faulted.alerts.length >= 2);
  const faultSummary = computeGridSummary(faulted.topology.nodes, faulted.topology.edges);
  assert.ok(faultSummary.alarmingCount + faultSummary.warningCount >= initialSummary.alarmingCount + initialSummary.warningCount);

  const optimized = runQuantumGridOptimization(faulted.topology, 105);
  const optSummary = computeGridSummary(optimized.topology.nodes, optimized.topology.edges);
  assert.ok(optSummary.healthIndex > faultSummary.healthIndex);
  assert.equal(optSummary.alarmingCount, 0);
  assert.ok(optimized.lossReductionPct > 0);
});

test('single-node Qiskit reroute restores alarming node to healthy and stress slider updates status', () => {
  const rerouted = rerouteSingleNodeViaQuantum(INITIAL_GRID_TOPOLOGY, 'B05');
  const nodeAfter = rerouted.topology.nodes.find((n) => n.id === 'B05')!;
  assert.equal(nodeAfter.status, 'healthy');
  assert.ok(rerouted.alert?.severity === 'resolved');

  const stressed = updateNodeLoadStress(rerouted.topology, 'B05', 96);
  const nodeStressed = stressed.nodes.find((n) => n.id === 'B05')!;
  assert.equal(nodeStressed.status, 'alarming');
});

test('simulateQuantumCircuit preserves shot totals and reflects noise impact on fidelity', () => {
  const ideal = simulateQuantumCircuit({
    ansatz: 'QAOA',
    qubits: 6,
    layers: 2,
    shots: 4096,
    backend: 'aer_simulator (statevector)',
    enableNoise: false,
    seed: 77,
  });
  const noisy = simulateQuantumCircuit({
    ansatz: 'QAOA',
    qubits: 6,
    layers: 2,
    shots: 4096,
    backend: 'ibm_brisbane (127q)',
    enableNoise: true,
    seed: 77,
  });

  const totalTopShots = ideal.bitstrings.reduce((sum, b) => sum + b.counts, 0);
  assert.ok(totalTopShots > 0 && totalTopShots <= 4096, 'Top-8 measured bitstrings must be a valid subset of 4096 shots');
  assert.ok(ideal.fidelity > noisy.fidelity);
  assert.ok(ideal.gates.some((g) => g.type === 'RX'), 'QAOA circuit must use RX X-mixer gates');
  assert.ok(ideal.qiskitCode.includes('QuantumCircuit(6, 6)'));
});

test('parseUploadedDataset validates CSV and JSON datasets and rejects invalid inputs', () => {
  const csvResult = parseUploadedDataset(SAMPLE_CSV_TEMPLATE, 'sample_grid.csv');
  assert.equal(csvResult.ok, true);
  if (csvResult.ok) {
    assert.equal(csvResult.topology.nodes.length, 10);
    assert.ok(csvResult.topology.edges.length >= 10);
  }

  const invalidCsv = parseUploadedDataset('foo,bar\n1,2\n3,4\n5,6', 'broken.csv');
  assert.equal(invalidCsv.ok, false);

  const emptyResult = parseUploadedDataset('   ', 'empty.csv');
  assert.equal(emptyResult.ok, false);

  const jsonPayload = JSON.stringify({
    name: 'Test JSON Grid',
    nodes: [
      { id: 'A', name: 'Gen A', role: 'generator', loadMW: 90, capacityMW: 150, voltagePU: 1.01, temperatureC: 55 },
      { id: 'B', name: 'Sub B', role: 'substation', loadMW: 140, capacityMW: 150, voltagePU: 0.93, temperatureC: 88 },
      { id: 'C', name: 'Load C', role: 'load', loadMW: 110, capacityMW: 140, voltagePU: 0.96, temperatureC: 74 },
    ],
    edges: [
      { source: 'A', target: 'B', flowMW: 120, limitMW: 140 },
      { source: 'B', target: 'C', flowMW: 105, limitMW: 135 },
    ],
  });
  const jsonResult = parseUploadedDataset(jsonPayload, 'test.json');
  assert.equal(jsonResult.ok, true);
  if (jsonResult.ok) {
    assert.equal(jsonResult.topology.nodes[1].status, 'alarming');
  }
});

test('runExploreComparison produces higher quantum accuracy, lower loss, and valid backend schema', () => {
  const heatwave = CLIMATE_PRESETS.find((p) => p.id === 'heatwave')!.conditions;
  const scaled = generateScalableGridTopology(24, heatwave);
  assert.equal(scaled.nodes.length, 24);
  assert.ok(scaled.edges.length >= 24);

  const result = runExploreComparison({
    topology: scaled,
    quantumAlgorithm: 'QAOA',
    classicalAlgorithm: 'MILP (HiGHS)',
    backend: 'aer_simulator (statevector)',
    shots: 2048,
    partitionQubits: 6,
    climate: heatwave,
    constraints: ['thermal_limits', 'n_minus_1'],
  });
  assert.ok(result.quantumMetrics.accuracyPct >= 0 && result.quantumMetrics.accuracyPct <= 100);
  assert.ok(result.classicalMetrics.accuracyPct >= 0 && result.classicalMetrics.accuracyPct <= 100);
  assert.ok(result.quantumMetrics.lossMW > 0 && result.classicalMetrics.lossMW > 0);
  assert.ok(result.quantumMetrics.runtimeMs > 0 && result.classicalMetrics.runtimeMs > 0);
  assert.equal(result.backendPayload.schema_version, '1.0.0');
  assert.equal(result.backendPayload.nodes.length, 24);
  assert.equal(result.backendPayload.external_environment.ambientTempC, 42);
});

test('applyClimateFactors derates transmission line limits during heatwave vs coastal wind cooling', () => {
  const heatwave = CLIMATE_PRESETS.find((p) => p.id === 'heatwave')!.conditions;
  const wind = CLIMATE_PRESETS.find((p) => p.id === 'coastal-wind')!.conditions;

  const hotGrid = applyClimateFactors(INITIAL_GRID_TOPOLOGY, heatwave);
  const coolGrid = applyClimateFactors(INITIAL_GRID_TOPOLOGY, wind);

  assert.ok(hotGrid.edges[0].limitMW < coolGrid.edges[0].limitMW);
  assert.ok(hotGrid.nodes[0].temperatureC > coolGrid.nodes[0].temperatureC);
});

test('computeImpactSummary dynamically narrows results by selected constraints and scale', () => {
  const all = computeImpactSummary(ACCURACY_TIMELINE_DATA, CONSTRAINT_PERFORMANCE_ROWS, [], 'all', 600);
  const narrowed = computeImpactSummary(
    ACCURACY_TIMELINE_DATA,
    CONSTRAINT_PERFORMANCE_ROWS,
    ['n_minus_1'],
    'regional',
    500
  );

  assert.ok(all.filteredRows.length > narrowed.filteredRows.length);
  assert.equal(narrowed.filteredRows.length, 1);
  assert.equal(narrowed.filteredRows[0].constraintId, 'n_minus_1');
  assert.ok(narrowed.kpis.avgAccuracyGain > all.kpis.avgAccuracyGain);
  assert.equal(narrowed.aggregatedTimeline.length, 8);
});

test('computeBusinessImpactMetrics produces positive utility ROI, cost waterfall savings, and bus relief', () => {
  const heatwave = CLIMATE_PRESETS.find((p) => p.id === 'heatwave')!.conditions;
  const before = applyClimateFactors(INITIAL_GRID_TOPOLOGY, heatwave);
  const run = runExploreComparison({
    topology: INITIAL_GRID_TOPOLOGY,
    quantumAlgorithm: 'QAOA',
    classicalAlgorithm: 'MILP (HiGHS)',
    backend: 'ibm_brisbane (127q)',
    shots: 4096,
    partitionQubits: 6,
    climate: heatwave,
    constraints: ['thermal_limits', 'voltage_stability', 'n_minus_1'],
  });

  const biz = computeBusinessImpactMetrics(run, before);
  assert.ok(biz.totalAnnualValueM >= 0);
  assert.ok(biz.quantumCostsM.total > 0 && biz.classicalCostsM.total > 0);
  assert.equal(biz.busComparison.length, INITIAL_GRID_TOPOLOGY.nodes.length);
  assert.ok(biz.afterHealth.alarming <= biz.beforeHealth.alarming);
});

