import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSampleMicrogridCsv,
  buildSampleMicrogridWorkbookBytes,
  parseUploadedDataset,
  parseUploadedWorkbook,
  summarizeDatasetCapabilities,
} from './datasetParser';
import {
  buildFullMicrogridQuboProblem,
  evaluateMicrogridDispatchFromBits,
} from './quboSolverEngine';
import { NOMINAL_CLIMATE_CONDITIONS } from '../constants';

test('extended sample CSV parses all asset types, geo bounds, storage, tariffs, and priority weights', () => {
  const csv = buildSampleMicrogridCsv();
  const parsed = parseUploadedDataset(csv, 'rural_microgrid_extended.csv');
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  assert.equal(parsed.topology.nodes.length, 10);
  assert.ok(parsed.topology.edges.length >= 10);
  assert.ok(parsed.topology.geoBounds, 'geoBounds should be computed from lat/lon columns');

  const caps = summarizeDatasetCapabilities(parsed.topology);
  assert.equal(caps.hasGeoCoords, true);
  assert.equal(caps.hasAssetTypes, true);
  assert.equal(caps.hasRenewableTelemetry, true);
  assert.equal(caps.hasBatteryStorage, true);
  assert.equal(caps.hasEconomicTariffs, true);
  assert.equal(caps.hasPriorityWeights, true);
  assert.equal(caps.zoneCount, 3);

  const bess = parsed.topology.nodes.find((n) => n.id === 'K03');
  assert.equal(bess?.assetType, 'battery_storage');
  assert.equal(bess?.batterySocPct, 78);
  assert.equal(bess?.batteryCapacityMWh, 420);

  const clinic = parsed.topology.nodes.find((n) => n.id === 'K06');
  assert.equal(clinic?.assetType, 'critical_load');
  assert.equal(clinic?.priorityWeight, 5);
  assert.equal(clinic?.curtailable, false);
});

test('multi-sheet Excel (.xlsx) workbook round-trips Nodes, Edges, and Metadata with impedance data', () => {
  const bytes = buildSampleMicrogridWorkbookBytes();
  assert.ok(bytes.byteLength > 1000);

  const parsed = parseUploadedWorkbook(bytes, 'rural_karnataka.xlsx');
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  assert.equal(parsed.topology.sourceFormat, 'xlsx');
  assert.equal(parsed.topology.name, 'Rural Karnataka 10-Bus Multi-Asset Microgrid');
  assert.equal(parsed.topology.nodes.length, 10);
  assert.equal(parsed.topology.edges.length, 16);

  const l09 = parsed.topology.edges.find((e) => e.id === 'L09');
  assert.ok(l09);
  assert.equal(l09.reactanceOhm, 0.149);
  assert.equal(l09.voltageKV, 33);
  assert.equal(l09.lengthKm, 9.2);
  assert.equal(l09.isBidirectional, true);
});

test('scales cleanly to 60 multi-zone nodes and isolates multi-timestamp snapshots', () => {
  const rows: string[] = [
    'id,name,assetType,zone,loadMW,capacityMW,voltagePU,costPerMWh,priorityWeight,timestamp,connections',
  ];
  const types = [
    'solar_pv',
    'wind_turbine',
    'battery_storage',
    'substation',
    'critical_load',
    'industrial_load',
  ];

  for (const ts of ['2026-11-25T12:00', '2026-11-25T18:00']) {
    for (let i = 0; i < 60; i++) {
      const id = `N${String(i + 1).padStart(2, '0')}`;
      const nextId = `N${String(((i + 1) % 60) + 1).padStart(2, '0')}`;
      const crossId = `N${String(((i + 7) % 60) + 1).padStart(2, '0')}`;
      rows.push(
        `${id},Node ${i + 1},${types[i % types.length]},Z${(i % 4) + 1},${70 + (i % 45)},140,0.98,${25 + (i % 5) * 20},${(i % 5) + 1},${ts},${nextId};${crossId}`
      );
    }
  }

  const parsed = parseUploadedDataset(rows.join('\n'), 'scalable_60_node_timeseries.csv');
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  assert.equal(parsed.topology.nodes.length, 60);
  assert.equal(parsed.topology.availableTimestamps?.length, 2);
  assert.equal(parsed.topology.activeTimestamp, '2026-11-25T12:00');
  assert.ok(parsed.topology.edges.length >= 60);
  assert.equal(summarizeDatasetCapabilities(parsed.topology).zoneCount, 4);
});

test('extended QUBO terms genuinely respond to battery SoC, marginal cost tariffs, priority weight, and reactance', () => {
  const bytes = buildSampleMicrogridWorkbookBytes();
  const parsed = parseUploadedWorkbook(bytes, 'test.xlsx');
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  const baseTopo = parsed.topology;
  const constraints = ['thermal_limits', 'voltage_stability', 'renewable_intermittency'] as const;
  const baseQubo = buildFullMicrogridQuboProblem(
    baseTopo,
    NOMINAL_CLIMATE_CONDITIONS,
    [...constraints]
  );

  // Clone and degrade BESS SoC from 78% -> 8%, raise critical clinic priority? No, lower clinic priority 5 -> 1,
  // and increase feeder reactance on L09
  const modifiedTopo = {
    ...baseTopo,
    nodes: baseTopo.nodes.map((nd) => {
      if (nd.id === 'K03') return { ...nd, batterySocPct: 8 };
      if (nd.id === 'K06') return { ...nd, priorityWeight: 1 };
      return nd;
    }),
    edges: baseTopo.edges.map((e) =>
      e.id === 'L09' ? { ...e, reactanceOhm: 0.42 } : e
    ),
  };

  const modQubo = buildFullMicrogridQuboProblem(
    modifiedTopo,
    NOMINAL_CLIMATE_CONDITIONS,
    [...constraints]
  );

  const bessIdx = baseTopo.nodes.findIndex((n) => n.id === 'K03');
  const clinicIdx = baseTopo.nodes.findIndex((n) => n.id === 'K06');
  const solarIdx = baseTopo.nodes.findIndex((n) => n.id === 'K01');
  const dieselIdx = baseTopo.nodes.findIndex((n) => n.id === 'K10');

  // Healthy BESS (78% SoC) must be rewarded more strongly (more negative Q_ii) than depleted BESS (8% SoC)
  assert.ok(
    baseQubo.problem.linear[bessIdx] < modQubo.problem.linear[bessIdx],
    'High-SoC battery should receive stronger negative QUBO reward than depleted battery'
  );
  // Critical load (priority 5) must be rewarded more strongly than deferrable load (priority 1)
  assert.ok(
    baseQubo.problem.linear[clinicIdx] < modQubo.problem.linear[clinicIdx],
    'Higher priority load should receive stronger QUBO protection bias'
  );
  // Cheap solar ($22/MWh) must have strongly lower linear QUBO energy than expensive diesel ($172/MWh)
  assert.ok(
    baseQubo.problem.linear[solarIdx] < baseQubo.problem.linear[dieselIdx],
    'Low-cost solar should have stronger QUBO dispatch preference than expensive diesel peaker'
  );

  // Higher feeder reactance X_ij must increase quadratic coupling Q_ij on L09 (K04-K06)
  const k04Idx = baseTopo.nodes.findIndex((n) => n.id === 'K04');
  const baseEdge = baseQubo.problem.edges.find(
    (e) => (e.i === k04Idx && e.j === clinicIdx) || (e.i === clinicIdx && e.j === k04Idx)
  );
  const modEdge = modQubo.problem.edges.find(
    (e) => (e.i === k04Idx && e.j === clinicIdx) || (e.i === clinicIdx && e.j === k04Idx)
  );
  assert.ok(baseEdge && modEdge && modEdge.qij > baseEdge.qij);

  // Dispatch evaluation uses per-node tariffs & produces positive daily cost savings
  const activeBits = new Uint8Array(baseTopo.nodes.length).fill(1);
  activeBits[dieselIdx] = 0; // avoid expensive diesel
  const metrics = evaluateMicrogridDispatchFromBits(
    baseTopo,
    activeBits,
    NOMINAL_CLIMATE_CONDITIONS
  );
  assert.ok(metrics.costSavedDailyUsd > 0);
  assert.ok(metrics.demandMetPct > 80);
});
