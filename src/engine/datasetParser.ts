import * as XLSX from 'xlsx';
import type {
  AssetType,
  GeoBounds,
  GridEdge,
  GridNode,
  GridTopology,
  HealthStatus,
  NodeRole,
} from '../types/grid';
import {
  ASSET_TYPE_ALIASES,
  ASSET_TYPE_TO_ROLE,
  DATASET_LIMITS,
  DATASET_SCHEMA_COLUMNS,
  GRID_THRESHOLDS,
  MICROGRID_CLUSTERS,
  VALID_NODE_ROLES,
} from '../constants';

export type DatasetParseResult =
  | { ok: true; topology: GridTopology; warnings: string[] }
  | { ok: false; error: string };

export interface DatasetCapabilitySummary {
  hasGeoCoords: boolean;
  hasAssetTypes: boolean;
  hasRenewableTelemetry: boolean;
  hasBatteryStorage: boolean;
  hasEconomicTariffs: boolean;
  hasPriorityWeights: boolean;
  hasEdgeImpedance: boolean;
  zoneCount: number;
  timestampCount: number;
}

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function roundTo(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

function normalizeHeaderKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function computeNodeStatusLocal(
  loadMW: number,
  capacityMW: number,
  voltagePU: number,
  temperatureC: number
): HealthStatus {
  const util = loadMW / Math.max(1, capacityMW);
  if (
    util >= GRID_THRESHOLDS.nodeUtilizationAlarming ||
    voltagePU < GRID_THRESHOLDS.voltageMinAlarmingPU ||
    voltagePU > GRID_THRESHOLDS.voltageMaxAlarmingPU ||
    temperatureC >= GRID_THRESHOLDS.temperatureAlarmingC
  ) {
    return 'alarming';
  }
  if (
    util >= GRID_THRESHOLDS.nodeUtilizationWarning ||
    voltagePU < GRID_THRESHOLDS.voltageMinWarningPU ||
    voltagePU > GRID_THRESHOLDS.voltageMaxWarningPU ||
    temperatureC >= GRID_THRESHOLDS.temperatureWarningC
  ) {
    return 'warning';
  }
  return 'healthy';
}

function computeEdgeStatusLocal(flowMW: number, limitMW: number): HealthStatus {
  const ratio = flowMW / Math.max(1, limitMW);
  if (ratio >= GRID_THRESHOLDS.edgeUtilizationAlarming) return 'alarming';
  if (ratio >= GRID_THRESHOLDS.edgeUtilizationWarning) return 'warning';
  return 'healthy';
}

function parseOptionalNumber(val: unknown): number | undefined {
  if (val === undefined || val === null) return undefined;
  if (typeof val === 'number') return Number.isFinite(val) ? val : undefined;
  const str = String(val).trim();
  if (!str) return undefined;
  const num = Number(str);
  return Number.isFinite(num) ? num : undefined;
}

function parseOptionalBoolean(val: unknown): boolean | undefined {
  if (val === undefined || val === null) return undefined;
  if (typeof val === 'boolean') return val;
  const str = String(val).trim().toLowerCase();
  if (!str) return undefined;
  if (str === 'true' || str === '1' || str === 'yes' || str === 'y') return true;
  if (str === 'false' || str === '0' || str === 'no' || str === 'n') return false;
  return undefined;
}

function parseOptionalString(val: unknown): string | undefined {
  if (val === undefined || val === null) return undefined;
  const str = String(val).trim();
  return str.length > 0 ? str : undefined;
}

function resolveRoleAndAssetType(
  rawRole: string | undefined,
  rawAssetType: string | undefined
): { role: NodeRole; assetType?: AssetType } {
  const cleanAsset = rawAssetType?.trim().toLowerCase().replace(/[\s-]+/g, '_');
  const cleanRole = rawRole?.trim().toLowerCase().replace(/[\s-]+/g, '_');

  const assetFromAssetCol = cleanAsset ? ASSET_TYPE_ALIASES[cleanAsset] : undefined;
  const assetFromRoleCol = cleanRole ? ASSET_TYPE_ALIASES[cleanRole] : undefined;
  const resolvedAsset = assetFromAssetCol ?? assetFromRoleCol;

  const explicitRole =
    cleanRole && VALID_NODE_ROLES.includes(cleanRole as NodeRole)
      ? (cleanRole as NodeRole)
      : undefined;

  const role: NodeRole =
    explicitRole ?? (resolvedAsset ? ASSET_TYPE_TO_ROLE[resolvedAsset] : 'substation');

  return { role, assetType: resolvedAsset };
}

/**
 * RFC-4180 compliant CSV line splitter supporting quoted cells and escaped quotes.
 */
function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      cells.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

function toNormalizedRecord(rawRow: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = Object.create(null);
  for (const [k, v] of Object.entries(rawRow)) {
    if (UNSAFE_KEYS.has(k)) continue;
    const normKey = normalizeHeaderKey(k);
    if (!normKey || UNSAFE_KEYS.has(normKey)) continue;
    normalized[normKey] = v;
  }
  return normalized;
}

function getField(row: Record<string, unknown>, aliases: readonly string[]): unknown {
  for (const alias of aliases) {
    if (row[alias] !== undefined && row[alias] !== '') {
      return row[alias];
    }
  }
  return undefined;
}

function buildRingEdgesLocal(nodes: GridNode[]): GridEdge[] {
  const edges: GridEdge[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    const b = nodes[(i + 1) % nodes.length];
    const limitMW = roundTo((a.capacityMW + b.capacityMW) * 0.56, 1);
    const flowMW = roundTo((a.loadMW + b.loadMW) * 0.46, 1);
    const resistanceOhm = roundTo(0.044 + (i % 4) * 0.008, 3);
    edges.push({
      id: `E-${i + 1}`,
      source: a.id,
      target: b.id,
      flowMW,
      limitMW,
      resistanceOhm,
      reactanceOhm: roundTo(resistanceOhm * 2.1, 3),
      lossMW: roundTo((flowMW * flowMW * resistanceOhm) / 1500, 2),
      status: computeEdgeStatusLocal(flowMW, limitMW),
      isQuantumPath: i % 3 !== 2,
      isClassicalPath: i % 2 === 0,
    });
  }
  return edges;
}

function applyGeoOrClusterLayout(
  nodes: GridNode[],
  explicitCoordMask: boolean[],
  datasetName: string
): GeoBounds | undefined {
  const geoNodes = nodes.filter(
    (nd) =>
      nd.lat !== undefined &&
      nd.lon !== undefined &&
      nd.lat >= -90 &&
      nd.lat <= 90 &&
      nd.lon >= -180 &&
      nd.lon <= 180
  );

  if (geoNodes.length >= DATASET_LIMITS.minNodes) {
    const lats = geoNodes.map((nd) => nd.lat!);
    const lons = geoNodes.map((nd) => nd.lon!);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);
    const latSpan = Math.max(0.01, maxLat - minLat);
    const lonSpan = Math.max(0.01, maxLon - minLon);

    for (let i = 0; i < nodes.length; i++) {
      const nd = nodes[i];
      if (!explicitCoordMask[i] && nd.lat !== undefined && nd.lon !== undefined) {
        const nx = (nd.lon - minLon) / lonSpan;
        const ny = (maxLat - nd.lat) / latSpan; // north-up
        nd.x = Math.round(90 + nx * 820);
        nd.y = Math.round(70 + ny * 420);
      }
    }

    const padLat = Math.max(0.02, latSpan * 0.14);
    const padLon = Math.max(0.02, lonSpan * 0.14);
    return {
      minLat: roundTo(minLat - padLat, 4),
      maxLat: roundTo(maxLat + padLat, 4),
      minLon: roundTo(minLon - padLon, 4),
      maxLon: roundTo(maxLon + padLon, 4),
      regionId: `uploaded-${datasetName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      regionLabel: nodes[0]?.region ?? datasetName,
      country: 'Uploaded Geo Dataset',
    };
  }

  // Scalable multi-zone layout so large topologies (15..500 nodes) never stack on a single ring
  const zones = Array.from(new Set(nodes.map((nd) => nd.zone ?? nd.region)));
  const zoneIndexMap = new Map(zones.map((z, idx) => [z, idx]));
  const total = nodes.length;
  const cols = Math.max(3, Math.ceil(Math.sqrt(total * 1.65)));
  const rows = Math.max(2, Math.ceil(total / cols));

  for (let i = 0; i < total; i++) {
    const nd = nodes[i];
    const zIdx = zoneIndexMap.get(nd.zone ?? nd.region) ?? 0;
    const cluster = MICROGRID_CLUSTERS[zIdx % MICROGRID_CLUSTERS.length];
    if (!nd.clusterId) nd.clusterId = nd.zone ?? cluster.id;
    if (!nd.clusterName) nd.clusterName = nd.zone ?? nd.region;
    if (!nd.clusterColor) nd.clusterColor = cluster.color;

    if (!explicitCoordMask[i]) {
      if (total <= 12) {
        const angle = (i / total) * Math.PI * 2 - Math.PI / 2;
        const rx = i % 2 === 0 ? 350 : 215;
        const ry = i % 2 === 0 ? 205 : 130;
        nd.x = Math.round(500 + Math.cos(angle) * rx);
        nd.y = Math.round(280 + Math.sin(angle) * ry);
      } else {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const stagger = (row % 2) * 18;
        nd.x = Math.round(80 + (col / Math.max(1, cols - 1)) * 820 + stagger);
        nd.y = Math.round(68 + (row / Math.max(1, rows - 1)) * 424);
      }
    }
  }

  return undefined;
}

function buildTopologyFromNormalizedRows(params: {
  rawNodeRows: Record<string, unknown>[];
  rawEdgeRows: Record<string, unknown>[];
  name: string;
  description?: string;
  sourceFormat: 'csv' | 'json' | 'xlsx';
}): DatasetParseResult {
  const { rawNodeRows, rawEdgeRows, name, description, sourceFormat } = params;
  const warnings: string[] = [];

  if (rawNodeRows.length < DATASET_LIMITS.minNodes) {
    return {
      ok: false,
      error: `Dataset must contain at least ${DATASET_LIMITS.minNodes} grid nodes (received ${rawNodeRows.length}).`,
    };
  }

  // Handle optional multi-timestamp time-series tables cleanly without duplicating node IDs
  const allTimestamps = Array.from(
    new Set(
      rawNodeRows
        .map((r) => parseOptionalString(getField(r, ['timestamp', 'time', 'datetime', 'slot'])))
        .filter((t): t is string => Boolean(t))
    )
  ).sort();

  let activeRows = rawNodeRows;
  let activeTimestamp: string | undefined;

  if (allTimestamps.length > 1) {
    activeTimestamp = allTimestamps[0];
    const filtered = rawNodeRows.filter(
      (r) => parseOptionalString(getField(r, ['timestamp', 'time', 'datetime', 'slot'])) === activeTimestamp
    );
    if (filtered.length >= DATASET_LIMITS.minNodes) {
      activeRows = filtered;
      warnings.push(
        `Detected ${allTimestamps.length} time steps; loaded snapshot "${activeTimestamp}" (${filtered.length} nodes).`
      );
    }
  } else if (allTimestamps.length === 1) {
    activeTimestamp = allTimestamps[0];
  }

  if (activeRows.length > DATASET_LIMITS.maxNodes) {
    return {
      ok: false,
      error: `Dataset exceeds the ${DATASET_LIMITS.maxNodes}-node scalability limit (${activeRows.length} rows provided).`,
    };
  }

  const nodes: GridNode[] = [];
  const explicitCoordMask: boolean[] = [];
  const pendingPairs: [string, string][] = [];
  const seenIds = new Set<string>();

  for (let idx = 0; idx < activeRows.length; idx++) {
    const row = activeRows[idx];
    const id = parseOptionalString(getField(row, ['id', 'nodeid', 'busid', 'bus']));
    const nodeName = parseOptionalString(getField(row, ['name', 'nodename', 'busname', 'label']));
    const loadMW = parseOptionalNumber(getField(row, ['loadmw', 'load', 'demandmw', 'demand', 'pmw']));
    const capacityMW = parseOptionalNumber(
      getField(row, ['capacitymw', 'capacity', 'ratedmw', 'maxmw', 'capmw'])
    );

    if (!id || !nodeName || loadMW === undefined || loadMW < 0 || capacityMW === undefined || capacityMW <= 0) {
      return {
        ok: false,
        error: `Invalid node record at row ${idx + 2}: id, name, loadMW (>= 0), and capacityMW (> 0) are required.`,
      };
    }

    if (seenIds.has(id)) {
      warnings.push(`Skipped duplicate node ID "${id}" at row ${idx + 2}.`);
      continue;
    }
    seenIds.add(id);

    const rawVoltage = parseOptionalNumber(getField(row, ['voltagepu', 'voltage', 'vpu']));
    const voltagePU =
      rawVoltage !== undefined
        ? Math.max(DATASET_LIMITS.minVoltagePU, Math.min(DATASET_LIMITS.maxVoltagePU, rawVoltage))
        : 1.0;

    const temperatureC = parseOptionalNumber(getField(row, ['temperaturec', 'tempc', 'temp'])) ?? 62;
    const ambientTempC = parseOptionalNumber(getField(row, ['ambienttempc', 'ambientc', 'airtempc']));
    const phaseAngleDeg =
      parseOptionalNumber(getField(row, ['phaseangledeg', 'phaseangle', 'angledeg'])) ??
      roundTo(-4.5 + idx * 0.75, 1);

    const { role, assetType } = resolveRoleAndAssetType(
      parseOptionalString(getField(row, ['role', 'noderole'])),
      parseOptionalString(getField(row, ['assettype', 'type', 'category', 'derType', 'dertype']))
    );

    const region =
      parseOptionalString(getField(row, ['region', 'area', 'territory'])) ?? 'Uploaded Grid';
    const zone = parseOptionalString(getField(row, ['zone', 'cluster', 'clusterid', 'sector']));
    const lat = parseOptionalNumber(getField(row, ['lat', 'latitude']));
    const lon = parseOptionalNumber(getField(row, ['lon', 'lng', 'longitude']));
    const explicitX = parseOptionalNumber(getField(row, ['x']));
    const explicitY = parseOptionalNumber(getField(row, ['y']));

    const solarWm2 = parseOptionalNumber(
      getField(row, ['solarwm2', 'irradiance', 'shortwaveradiation', 'ghi'])
    );
    const windSpeed80mMs = parseOptionalNumber(
      getField(row, ['windspeed80mms', 'windspeedms', 'windspeed', 'windms'])
    );
    const solarGenMW = parseOptionalNumber(getField(row, ['solargenmw', 'solarmw', 'pvgenmw']));
    const windGenMW = parseOptionalNumber(getField(row, ['windgenmw', 'windmw']));
    const batteryCapacityMWh = parseOptionalNumber(
      getField(row, ['batterycapacitymwh', 'storagecapacitymwh', 'bessmwh', 'batterymwh'])
    );
    const rawSoc = parseOptionalNumber(getField(row, ['batterysocpct', 'socpct', 'soc']));
    const batterySocPct =
      rawSoc !== undefined ? Math.max(0, Math.min(100, roundTo(rawSoc, 1))) : undefined;
    const maxChargeMW = parseOptionalNumber(getField(row, ['maxchargemw', 'chargemw']));
    const maxDischargeMW = parseOptionalNumber(getField(row, ['maxdischargemw', 'dischargemw']));
    const costPerMWh = parseOptionalNumber(
      getField(row, ['costpermwh', 'tariffpermwh', 'marginalcost', 'lcoe', 'cost'])
    );
    const rawPriority = parseOptionalNumber(
      getField(row, ['priorityweight', 'priority', 'criticality'])
    );
    const priorityWeight =
      rawPriority !== undefined
        ? Math.max(
            DATASET_LIMITS.minPriorityWeight,
            Math.min(DATASET_LIMITS.maxPriorityWeight, roundTo(rawPriority, 1))
          )
        : undefined;
    const curtailable = parseOptionalBoolean(
      getField(row, ['curtailable', 'flexible', 'sheddable'])
    );
    const timestamp = parseOptionalString(getField(row, ['timestamp', 'time', 'datetime', 'slot']));

    const hasExplicitXY = explicitX !== undefined && explicitY !== undefined;
    explicitCoordMask.push(hasExplicitXY);

    const clusterIdx = idx % MICROGRID_CLUSTERS.length;
    const cluster = MICROGRID_CLUSTERS[clusterIdx];

    nodes.push({
      id,
      name: nodeName,
      role,
      ...(assetType ? { assetType } : {}),
      region,
      ...(zone ? { zone } : {}),
      x: hasExplicitXY ? Math.round(explicitX) : 500,
      y: hasExplicitXY ? Math.round(explicitY) : 280,
      loadMW: roundTo(loadMW, 1),
      capacityMW: roundTo(capacityMW, 1),
      voltagePU: roundTo(voltagePU, 3),
      temperatureC: roundTo(temperatureC, 1),
      phaseAngleDeg: roundTo(phaseAngleDeg, 1),
      qubitIndex: idx % Math.min(16, Math.max(8, activeRows.length)),
      status: computeNodeStatusLocal(loadMW, capacityMW, voltagePU, temperatureC),
      quantumDispatchMW: roundTo(loadMW * 0.88, 1),
      classicalDispatchMW: roundTo(loadMW, 1),
      ...(lat !== undefined ? { lat: roundTo(lat, 5) } : {}),
      ...(lon !== undefined ? { lon: roundTo(lon, 5) } : {}),
      clusterId: zone ?? cluster.id,
      clusterName: zone ?? region,
      clusterColor: cluster.color,
      ...(solarWm2 !== undefined && solarWm2 >= 0 ? { solarWm2: roundTo(solarWm2, 1) } : {}),
      ...(windSpeed80mMs !== undefined && windSpeed80mMs >= 0
        ? { windSpeed80mMs: roundTo(windSpeed80mMs, 1) }
        : {}),
      ...(ambientTempC !== undefined ? { ambientTempC: roundTo(ambientTempC, 1) } : {}),
      ...(solarGenMW !== undefined && solarGenMW >= 0 ? { solarGenMW: roundTo(solarGenMW, 2) } : {}),
      ...(windGenMW !== undefined && windGenMW >= 0 ? { windGenMW: roundTo(windGenMW, 2) } : {}),
      ...(batteryCapacityMWh !== undefined && batteryCapacityMWh >= 0
        ? { batteryCapacityMWh: roundTo(batteryCapacityMWh, 2) }
        : {}),
      ...(batterySocPct !== undefined ? { batterySocPct } : {}),
      ...(maxChargeMW !== undefined && maxChargeMW >= 0
        ? { maxChargeMW: roundTo(maxChargeMW, 2) }
        : {}),
      ...(maxDischargeMW !== undefined && maxDischargeMW >= 0
        ? { maxDischargeMW: roundTo(maxDischargeMW, 2) }
        : {}),
      ...(costPerMWh !== undefined && costPerMWh >= 0 ? { costPerMWh: roundTo(costPerMWh, 2) } : {}),
      ...(priorityWeight !== undefined ? { priorityWeight } : {}),
      ...(curtailable !== undefined ? { curtailable } : {}),
      ...(timestamp ? { timestamp } : {}),
    });

    const rawConnections = parseOptionalString(
      getField(row, ['connections', 'neighbors', 'links', 'edges'])
    );
    if (rawConnections) {
      const targets = rawConnections
        .split(/[;|]/)
        .map((t) => t.trim())
        .filter(Boolean);
      for (const target of targets) {
        pendingPairs.push([id, target]);
      }
    }
  }

  if (nodes.length < DATASET_LIMITS.minNodes) {
    return {
      ok: false,
      error: `Dataset must contain at least ${DATASET_LIMITS.minNodes} unique valid grid nodes.`,
    };
  }

  const geoBounds = applyGeoOrClusterLayout(nodes, explicitCoordMask, name);
  const nodeById = new Map(nodes.map((nd) => [nd.id, nd]));
  const seenEdgeKeys = new Set<string>();
  const edges: GridEdge[] = [];

  // 1. Explicit edge rows (from JSON edges[] or Excel Edges/Feeders/Lines sheet)
  if (rawEdgeRows.length > DATASET_LIMITS.maxEdges) {
    return {
      ok: false,
      error: `Edge list exceeds ${DATASET_LIMITS.maxEdges} feeders (${rawEdgeRows.length} provided).`,
    };
  }

  for (let idx = 0; idx < rawEdgeRows.length; idx++) {
    const e = rawEdgeRows[idx];
    const source = parseOptionalString(getField(e, ['source', 'from', 'frombus', 'nodea']));
    const target = parseOptionalString(getField(e, ['target', 'to', 'tobus', 'nodeb']));
    if (!source || !target || !nodeById.has(source) || !nodeById.has(target) || source === target) {
      warnings.push(`Ignored edge row ${idx + 2} referencing unknown or self-loop nodes.`);
      continue;
    }
    const key = [source, target].sort().join('--');
    if (seenEdgeKeys.has(key)) continue;
    seenEdgeKeys.add(key);

    const srcNode = nodeById.get(source)!;
    const tgtNode = nodeById.get(target)!;
    const limitMW = Math.max(
      1,
      parseOptionalNumber(getField(e, ['limitmw', 'ratingmw', 'thermalratingmw', 'capacitymw'])) ??
        roundTo((srcNode.capacityMW + tgtNode.capacityMW) * 0.55, 1)
    );
    const flowMW = Math.max(
      0,
      parseOptionalNumber(getField(e, ['flowmw', 'flow', 'pmw'])) ??
        roundTo((srcNode.loadMW + tgtNode.loadMW) * 0.48, 1)
    );
    const resistanceOhm = Math.max(
      0.001,
      parseOptionalNumber(getField(e, ['resistanceohm', 'rohm', 'r'])) ??
        roundTo(0.042 + (edges.length % 5) * 0.009, 3)
    );
    const reactanceOhm = parseOptionalNumber(getField(e, ['reactanceohm', 'xohm', 'x']));
    const lengthKm = parseOptionalNumber(getField(e, ['lengthkm', 'distancekm', 'km']));
    const voltageKV = parseOptionalNumber(getField(e, ['voltagekv', 'kv', 'nominalkv']));
    const isBidirectional = parseOptionalBoolean(getField(e, ['isbidirectional', 'bidirectional']));
    const edgeId = parseOptionalString(getField(e, ['id', 'edgeid', 'lineid'])) ?? `E-${edges.length + 1}`;

    edges.push({
      id: edgeId,
      source,
      target,
      flowMW: roundTo(flowMW, 1),
      limitMW: roundTo(limitMW, 1),
      resistanceOhm: roundTo(resistanceOhm, 3),
      ...(reactanceOhm !== undefined && reactanceOhm >= 0
        ? { reactanceOhm: roundTo(reactanceOhm, 3) }
        : {}),
      ...(lengthKm !== undefined && lengthKm > 0 ? { lengthKm: roundTo(lengthKm, 2) } : {}),
      ...(voltageKV !== undefined && voltageKV > 0 ? { voltageKV: roundTo(voltageKV, 1) } : {}),
      ...(isBidirectional !== undefined ? { isBidirectional } : {}),
      lossMW: roundTo((flowMW * flowMW * resistanceOhm) / 1500, 2),
      status: computeEdgeStatusLocal(flowMW, limitMW),
      isQuantumPath: edges.length % 3 !== 2,
      isClassicalPath: edges.length % 2 === 0,
    });
  }

  // 2. Inline connections column on nodes (used when no explicit Edges sheet / edges[] array is provided)
  if (rawEdgeRows.length === 0) {
    for (const [src, tgt] of pendingPairs) {
      if (edges.length >= DATASET_LIMITS.maxEdges) break;
      if (!nodeById.has(src) || !nodeById.has(tgt) || src === tgt) continue;
      const key = [src, tgt].sort().join('--');
      if (seenEdgeKeys.has(key)) continue;
      seenEdgeKeys.add(key);

      const srcNode = nodeById.get(src)!;
      const tgtNode = nodeById.get(tgt)!;
      const limitMW = roundTo((srcNode.capacityMW + tgtNode.capacityMW) * 0.55, 1);
      const flowMW = roundTo((srcNode.loadMW + tgtNode.loadMW) * 0.48, 1);
      const resistanceOhm = roundTo(0.042 + (edges.length % 5) * 0.009, 3);
      edges.push({
        id: `E-${edges.length + 1}`,
        source: src,
        target: tgt,
        flowMW,
        limitMW,
        resistanceOhm,
        reactanceOhm: roundTo(resistanceOhm * 2.1, 3),
        lossMW: roundTo((flowMW * flowMW * resistanceOhm) / 1500, 2),
        status: computeEdgeStatusLocal(flowMW, limitMW),
        isQuantumPath: edges.length % 3 !== 2,
        isClassicalPath: edges.length % 2 === 0,
      });
    }
  }

  const finalEdges = edges.length > 0 ? edges : buildRingEdgesLocal(nodes);

  return {
    ok: true,
    warnings,
    topology: {
      id: `custom-${sourceFormat}-${Date.now()}`,
      name,
      description:
        description ??
        `Uploaded ${sourceFormat.toUpperCase()} grid topology (${nodes.length} nodes, ${finalEdges.length} feeders).`,
      nodes,
      edges: finalEdges,
      ...(geoBounds ? { geoBounds } : {}),
      sourceFormat,
      ...(allTimestamps.length > 0 ? { availableTimestamps: allTimestamps } : {}),
      ...(activeTimestamp ? { activeTimestamp } : {}),
    },
  };
}

/**
 * Parses CSV or JSON text into a validated GridTopology with full support
 * for extended microgrid/utility variables, asset types, and scalability.
 */
export function parseUploadedDataset(rawText: string, fileName: string): DatasetParseResult {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return {
      ok: false,
      error: 'Uploaded file is empty. Provide a valid CSV, JSON, or Excel (.xlsx) grid topology.',
    };
  }

  const cleanBaseName = fileName.replace(/\.(csv|json|xlsx|xls)$/i, '') || 'Uploaded Grid';

  if (fileName.toLowerCase().endsWith('.json') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      if (!Array.isArray(parsed.nodes) || parsed.nodes.length < DATASET_LIMITS.minNodes) {
        return {
          ok: false,
          error: `JSON dataset must contain a "nodes" array with at least ${DATASET_LIMITS.minNodes} grid nodes.`,
        };
      }
      const rawNodeRows = (parsed.nodes as Record<string, unknown>[]).map((r) =>
        toNormalizedRecord(r)
      );
      const rawEdgeRows = Array.isArray(parsed.edges)
        ? (parsed.edges as Record<string, unknown>[]).map((e) => toNormalizedRecord(e))
        : [];

      return buildTopologyFromNormalizedRows({
        rawNodeRows,
        rawEdgeRows,
        name: parseOptionalString(parsed.name) ?? cleanBaseName,
        description: parseOptionalString(parsed.description),
        sourceFormat: 'json',
      });
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Invalid JSON structure.',
      };
    }
  }

  const lines = trimmed.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < DATASET_LIMITS.minNodes + 1) {
    return {
      ok: false,
      error: `CSV dataset must include a header row plus at least ${DATASET_LIMITS.minNodes} grid node rows.`,
    };
  }

  const headers = parseCsvLine(lines[0]).map(normalizeHeaderKey);
  const hasId = headers.some((h) => ['id', 'nodeid', 'busid', 'bus'].includes(h));
  const hasName = headers.some((h) => ['name', 'nodename', 'busname', 'label'].includes(h));
  const hasLoad = headers.some((h) => ['loadmw', 'load', 'demandmw', 'demand', 'pmw'].includes(h));
  const hasCap = headers.some((h) =>
    ['capacitymw', 'capacity', 'ratedmw', 'maxmw', 'capmw'].includes(h)
  );

  if (!hasId || !hasName || !hasLoad || !hasCap) {
    return {
      ok: false,
      error:
        'CSV missing required columns. Required headers: id, name, loadMW, capacityMW (optional: assetType, role, region, zone, lat, lon, voltagePU, temperatureC, solarGenMW, windGenMW, batteryCapacityMWh, batterySocPct, costPerMWh, priorityWeight, curtailable, timestamp, connections).',
    };
  }

  const rawNodeRows: Record<string, unknown>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const row: Record<string, unknown> = Object.create(null);
    for (let c = 0; c < headers.length; c++) {
      const h = headers[c];
      if (!h || UNSAFE_KEYS.has(h)) continue;
      row[h] = cells[c] ?? '';
    }
    rawNodeRows.push(row);
  }

  return buildTopologyFromNormalizedRows({
    rawNodeRows,
    rawEdgeRows: [],
    name: cleanBaseName,
    sourceFormat: 'csv',
  });
}

/**
 * Parses an Excel workbook (.xlsx / .xls) ArrayBuffer or Uint8Array.
 * Supports single-sheet node tables and scalable multi-sheet workbooks
 * with separate "Nodes" and "Edges"/"Feeders"/"Lines" sheets.
 */
export function parseUploadedWorkbook(
  data: ArrayBuffer | Uint8Array,
  fileName: string
): DatasetParseResult {
  try {
    const workbook = XLSX.read(data, { type: 'array' });
    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
      return { ok: false, error: 'Excel workbook contains no sheets.' };
    }

    const findSheet = (candidates: string[]) =>
      workbook.SheetNames.find((s) => candidates.includes(s.trim().toLowerCase()));

    const nodesSheetName =
      findSheet(['nodes', 'buses', 'microgrid', 'grid', 'assets']) ?? workbook.SheetNames[0];
    const edgesSheetName = findSheet(['edges', 'feeders', 'lines', 'branches', 'links']);
    const metaSheetName = findSheet(['metadata', 'meta', 'info']);

    const nodesSheet = workbook.Sheets[nodesSheetName];
    const rawNodesRaw = XLSX.utils.sheet_to_json<Record<string, unknown>>(nodesSheet, {
      defval: '',
    });
    const rawNodeRows = rawNodesRaw.map((r) => toNormalizedRecord(r));

    const rawEdgeRows = edgesSheetName
      ? XLSX.utils
          .sheet_to_json<Record<string, unknown>>(workbook.Sheets[edgesSheetName], { defval: '' })
          .map((r) => toNormalizedRecord(r))
      : [];

    let metaName: string | undefined;
    let metaDesc: string | undefined;
    if (metaSheetName) {
      const metaRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
        workbook.Sheets[metaSheetName],
        { defval: '' }
      );
      for (const m of metaRows) {
        const norm = toNormalizedRecord(m);
        const key = parseOptionalString(norm.key ?? norm.field)?.toLowerCase();
        const val = parseOptionalString(norm.value);
        if (key === 'name' && val) metaName = val;
        if (key === 'description' && val) metaDesc = val;
      }
    }

    const cleanBaseName = fileName.replace(/\.(xlsx|xls)$/i, '') || 'Uploaded Excel Grid';

    return buildTopologyFromNormalizedRows({
      rawNodeRows,
      rawEdgeRows,
      name: metaName ?? cleanBaseName,
      description: metaDesc,
      sourceFormat: 'xlsx',
    });
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? `Failed to parse Excel workbook: ${err.message}`
          : 'Failed to parse Excel workbook.',
    };
  }
}

export function summarizeDatasetCapabilities(topology: GridTopology): DatasetCapabilitySummary {
  const zones = new Set(topology.nodes.map((n) => n.zone ?? n.region).filter(Boolean));
  return {
    hasGeoCoords: topology.nodes.some((n) => n.lat !== undefined && n.lon !== undefined),
    hasAssetTypes: topology.nodes.some((n) => n.assetType !== undefined),
    hasRenewableTelemetry: topology.nodes.some(
      (n) =>
        n.solarGenMW !== undefined ||
        n.windGenMW !== undefined ||
        n.solarWm2 !== undefined ||
        n.windSpeed80mMs !== undefined
    ),
    hasBatteryStorage: topology.nodes.some(
      (n) => n.batterySocPct !== undefined || n.batteryCapacityMWh !== undefined
    ),
    hasEconomicTariffs: topology.nodes.some((n) => n.costPerMWh !== undefined),
    hasPriorityWeights: topology.nodes.some((n) => n.priorityWeight !== undefined),
    hasEdgeImpedance: topology.edges.some(
      (e) => e.reactanceOhm !== undefined || e.voltageKV !== undefined
    ),
    zoneCount: zones.size,
    timestampCount: topology.availableTimestamps?.length ?? 0,
  };
}

interface SampleNodeRow {
  id: string;
  name: string;
  role: NodeRole;
  assetType: AssetType;
  region: string;
  zone: string;
  lat: number;
  lon: number;
  loadMW: number;
  capacityMW: number;
  voltagePU: number;
  temperatureC: number;
  ambientTempC: number;
  solarWm2: number;
  windSpeed80mMs: number;
  solarGenMW: number;
  windGenMW: number;
  batteryCapacityMWh: number;
  batterySocPct: number;
  maxChargeMW: number;
  maxDischargeMW: number;
  costPerMWh: number;
  priorityWeight: number;
  curtailable: boolean;
  timestamp: string;
  connections: string;
}

interface SampleEdgeRow {
  id: string;
  source: string;
  target: string;
  flowMW: number;
  limitMW: number;
  resistanceOhm: number;
  reactanceOhm: number;
  lengthKm: number;
  voltageKV: number;
  isBidirectional: boolean;
}

export const SAMPLE_EXTENDED_NODES: readonly SampleNodeRow[] = [
  {
    id: 'K01',
    name: 'Devanahalli Solar Park',
    role: 'renewable',
    assetType: 'solar_pv',
    region: 'Rural Karnataka',
    zone: 'Z1-North',
    lat: 13.12,
    lon: 77.61,
    loadMW: 118.4,
    capacityMW: 185,
    voltagePU: 1.014,
    temperatureC: 51.2,
    ambientTempC: 31.4,
    solarWm2: 815,
    windSpeed80mMs: 4.2,
    solarGenMW: 148.5,
    windGenMW: 0,
    batteryCapacityMWh: 0,
    batterySocPct: 0,
    maxChargeMW: 0,
    maxDischargeMW: 0,
    costPerMWh: 22,
    priorityWeight: 3,
    curtailable: true,
    timestamp: '2026-11-25T12:00',
    connections: 'K03;K04;K05',
  },
  {
    id: 'K02',
    name: 'Hoskote Wind Ridge',
    role: 'renewable',
    assetType: 'wind_turbine',
    region: 'Rural Karnataka',
    zone: 'Z1-North',
    lat: 13.08,
    lon: 77.7,
    loadMW: 96.2,
    capacityMW: 170,
    voltagePU: 1.008,
    temperatureC: 48.6,
    ambientTempC: 29.8,
    solarWm2: 740,
    windSpeed80mMs: 11.8,
    solarGenMW: 0,
    windGenMW: 126.4,
    batteryCapacityMWh: 0,
    batterySocPct: 0,
    maxChargeMW: 0,
    maxDischargeMW: 0,
    costPerMWh: 28,
    priorityWeight: 3,
    curtailable: true,
    timestamp: '2026-11-25T12:00',
    connections: 'K04;K06',
  },
  {
    id: 'K03',
    name: 'Yelahanka BESS Storage',
    role: 'generator',
    assetType: 'battery_storage',
    region: 'Rural Karnataka',
    zone: 'Z1-North',
    lat: 13.05,
    lon: 77.55,
    loadMW: 112.0,
    capacityMW: 200,
    voltagePU: 1.012,
    temperatureC: 46.8,
    ambientTempC: 30.2,
    solarWm2: 780,
    windSpeed80mMs: 5.1,
    solarGenMW: 12.0,
    windGenMW: 0,
    batteryCapacityMWh: 420,
    batterySocPct: 78,
    maxChargeMW: 95,
    maxDischargeMW: 120,
    costPerMWh: 44,
    priorityWeight: 4,
    curtailable: false,
    timestamp: '2026-11-25T12:00',
    connections: 'K05;K07',
  },
  {
    id: 'K04',
    name: 'Bengaluru Tie Substation',
    role: 'substation',
    assetType: 'substation',
    region: 'Rural Karnataka',
    zone: 'Z2-Core',
    lat: 13.02,
    lon: 77.64,
    loadMW: 188.5,
    capacityMW: 205,
    voltagePU: 0.933,
    temperatureC: 87.9,
    ambientTempC: 33.1,
    solarWm2: 790,
    windSpeed80mMs: 4.8,
    solarGenMW: 0,
    windGenMW: 0,
    batteryCapacityMWh: 0,
    batterySocPct: 0,
    maxChargeMW: 0,
    maxDischargeMW: 0,
    costPerMWh: 62,
    priorityWeight: 4,
    curtailable: false,
    timestamp: '2026-11-25T12:00',
    connections: 'K05;K06;K08',
  },
  {
    id: 'K05',
    name: 'Nelamangala Step-Down',
    role: 'transformer',
    assetType: 'transformer',
    region: 'Rural Karnataka',
    zone: 'Z2-Core',
    lat: 12.97,
    lon: 77.59,
    loadMW: 146.0,
    capacityMW: 190,
    voltagePU: 0.961,
    temperatureC: 73.4,
    ambientTempC: 32.5,
    solarWm2: 765,
    windSpeed80mMs: 4.4,
    solarGenMW: 0,
    windGenMW: 0,
    batteryCapacityMWh: 0,
    batterySocPct: 0,
    maxChargeMW: 0,
    maxDischargeMW: 0,
    costPerMWh: 58,
    priorityWeight: 3,
    curtailable: false,
    timestamp: '2026-11-25T12:00',
    connections: 'K07;K09',
  },
  {
    id: 'K06',
    name: 'Kolar District Clinic & Water',
    role: 'load',
    assetType: 'critical_load',
    region: 'Rural Karnataka',
    zone: 'Z2-Core',
    lat: 12.95,
    lon: 77.68,
    loadMW: 162.4,
    capacityMW: 175,
    voltagePU: 0.929,
    temperatureC: 88.8,
    ambientTempC: 33.4,
    solarWm2: 805,
    windSpeed80mMs: 5.0,
    solarGenMW: 14.0,
    windGenMW: 0,
    batteryCapacityMWh: 40,
    batterySocPct: 62,
    maxChargeMW: 12,
    maxDischargeMW: 15,
    costPerMWh: 85,
    priorityWeight: 5,
    curtailable: false,
    timestamp: '2026-11-25T12:00',
    connections: 'K08;K10',
  },
  {
    id: 'K07',
    name: 'Ramanagara Agri-Pump Feeder',
    role: 'load',
    assetType: 'agricultural_load',
    region: 'Rural Karnataka',
    zone: 'Z3-South',
    lat: 12.91,
    lon: 77.52,
    loadMW: 134.8,
    capacityMW: 175,
    voltagePU: 0.957,
    temperatureC: 74.6,
    ambientTempC: 32.2,
    solarWm2: 795,
    windSpeed80mMs: 3.9,
    solarGenMW: 18.5,
    windGenMW: 0,
    batteryCapacityMWh: 0,
    batterySocPct: 0,
    maxChargeMW: 0,
    maxDischargeMW: 0,
    costPerMWh: 54,
    priorityWeight: 2,
    curtailable: true,
    timestamp: '2026-11-25T12:00',
    connections: 'K09;K10',
  },
  {
    id: 'K08',
    name: 'Anekal Micro-Hydro & Bio Hub',
    role: 'generator',
    assetType: 'hydro',
    region: 'Rural Karnataka',
    zone: 'Z3-South',
    lat: 12.88,
    lon: 77.66,
    loadMW: 92.5,
    capacityMW: 180,
    voltagePU: 1.01,
    temperatureC: 52.1,
    ambientTempC: 30.8,
    solarWm2: 750,
    windSpeed80mMs: 4.5,
    solarGenMW: 0,
    windGenMW: 0,
    batteryCapacityMWh: 0,
    batterySocPct: 0,
    maxChargeMW: 0,
    maxDischargeMW: 0,
    costPerMWh: 38,
    priorityWeight: 3,
    curtailable: false,
    timestamp: '2026-11-25T12:00',
    connections: 'K10',
  },
  {
    id: 'K09',
    name: 'Channapatna Village & EV Hub',
    role: 'load',
    assetType: 'ev_charging',
    region: 'Rural Karnataka',
    zone: 'Z3-South',
    lat: 12.88,
    lon: 77.48,
    loadMW: 128.0,
    capacityMW: 165,
    voltagePU: 0.968,
    temperatureC: 69.2,
    ambientTempC: 31.7,
    solarWm2: 770,
    windSpeed80mMs: 4.1,
    solarGenMW: 22.0,
    windGenMW: 0,
    batteryCapacityMWh: 60,
    batterySocPct: 48,
    maxChargeMW: 24,
    maxDischargeMW: 20,
    costPerMWh: 64,
    priorityWeight: 2,
    curtailable: true,
    timestamp: '2026-11-25T12:00',
    connections: 'K10',
  },
  {
    id: 'K10',
    name: 'Mandya Diesel Peaker Backup',
    role: 'generator',
    assetType: 'diesel_backup',
    region: 'Rural Karnataka',
    zone: 'Z3-South',
    lat: 12.86,
    lon: 77.58,
    loadMW: 74.0,
    capacityMW: 160,
    voltagePU: 1.004,
    temperatureC: 61.5,
    ambientTempC: 32.0,
    solarWm2: 760,
    windSpeed80mMs: 4.0,
    solarGenMW: 0,
    windGenMW: 0,
    batteryCapacityMWh: 0,
    batterySocPct: 0,
    maxChargeMW: 0,
    maxDischargeMW: 0,
    costPerMWh: 172,
    priorityWeight: 1,
    curtailable: true,
    timestamp: '2026-11-25T12:00',
    connections: 'K01',
  },
];

export const SAMPLE_EXTENDED_EDGES: readonly SampleEdgeRow[] = [
  { id: 'L01', source: 'K01', target: 'K03', flowMW: 118, limitMW: 185, resistanceOhm: 0.038, reactanceOhm: 0.082, lengthKm: 8.4, voltageKV: 33, isBidirectional: true },
  { id: 'L02', source: 'K01', target: 'K04', flowMW: 166, limitMW: 180, resistanceOhm: 0.062, reactanceOhm: 0.131, lengthKm: 12.2, voltageKV: 33, isBidirectional: true },
  { id: 'L03', source: 'K01', target: 'K05', flowMW: 112, limitMW: 175, resistanceOhm: 0.044, reactanceOhm: 0.094, lengthKm: 10.6, voltageKV: 33, isBidirectional: true },
  { id: 'L04', source: 'K02', target: 'K04', flowMW: 148, limitMW: 175, resistanceOhm: 0.056, reactanceOhm: 0.118, lengthKm: 9.8, voltageKV: 33, isBidirectional: true },
  { id: 'L05', source: 'K02', target: 'K06', flowMW: 154, limitMW: 165, resistanceOhm: 0.068, reactanceOhm: 0.142, lengthKm: 14.1, voltageKV: 33, isBidirectional: true },
  { id: 'L06', source: 'K03', target: 'K05', flowMW: 122, limitMW: 190, resistanceOhm: 0.041, reactanceOhm: 0.086, lengthKm: 7.5, voltageKV: 33, isBidirectional: true },
  { id: 'L07', source: 'K03', target: 'K07', flowMW: 108, limitMW: 170, resistanceOhm: 0.049, reactanceOhm: 0.104, lengthKm: 11.4, voltageKV: 33, isBidirectional: true },
  { id: 'L08', source: 'K04', target: 'K05', flowMW: 164, limitMW: 185, resistanceOhm: 0.058, reactanceOhm: 0.122, lengthKm: 6.9, voltageKV: 33, isBidirectional: true },
  { id: 'L09', source: 'K04', target: 'K06', flowMW: 178, limitMW: 185, resistanceOhm: 0.072, reactanceOhm: 0.149, lengthKm: 9.2, voltageKV: 33, isBidirectional: true },
  { id: 'L10', source: 'K04', target: 'K08', flowMW: 132, limitMW: 180, resistanceOhm: 0.046, reactanceOhm: 0.097, lengthKm: 13.5, voltageKV: 33, isBidirectional: true },
  { id: 'L11', source: 'K05', target: 'K07', flowMW: 138, limitMW: 175, resistanceOhm: 0.052, reactanceOhm: 0.109, lengthKm: 8.8, voltageKV: 33, isBidirectional: false },
  { id: 'L12', source: 'K05', target: 'K09', flowMW: 124, limitMW: 165, resistanceOhm: 0.054, reactanceOhm: 0.114, lengthKm: 12.7, voltageKV: 33, isBidirectional: true },
  { id: 'L13', source: 'K06', target: 'K08', flowMW: 116, limitMW: 170, resistanceOhm: 0.043, reactanceOhm: 0.091, lengthKm: 8.1, voltageKV: 33, isBidirectional: true },
  { id: 'L14', source: 'K07', target: 'K10', flowMW: 104, limitMW: 165, resistanceOhm: 0.048, reactanceOhm: 0.102, lengthKm: 9.4, voltageKV: 33, isBidirectional: true },
  { id: 'L15', source: 'K08', target: 'K10', flowMW: 92, limitMW: 170, resistanceOhm: 0.042, reactanceOhm: 0.088, lengthKm: 7.8, voltageKV: 33, isBidirectional: true },
  { id: 'L16', source: 'K09', target: 'K10', flowMW: 98, limitMW: 160, resistanceOhm: 0.047, reactanceOhm: 0.099, lengthKm: 10.3, voltageKV: 33, isBidirectional: true },
];

export function buildSampleMicrogridCsv(): string {
  const headers = Object.keys(SAMPLE_EXTENDED_NODES[0]) as (keyof SampleNodeRow)[];
  const rows = SAMPLE_EXTENDED_NODES.map((node) =>
    headers
      .map((h) => {
        const val = String(node[h]);
        return val.includes(',') ? `"${val}"` : val;
      })
      .join(',')
  );
  return [headers.join(','), ...rows].join('\n');
}

export function buildSampleMicrogridWorkbookBytes(): Uint8Array {
  const wb = XLSX.utils.book_new();

  const nodesSheet = XLSX.utils.json_to_sheet([...SAMPLE_EXTENDED_NODES]);
  XLSX.utils.book_append_sheet(wb, nodesSheet, 'Nodes');

  const edgesSheet = XLSX.utils.json_to_sheet([...SAMPLE_EXTENDED_EDGES]);
  XLSX.utils.book_append_sheet(wb, edgesSheet, 'Edges');

  const metaSheet = XLSX.utils.json_to_sheet([
    { key: 'name', value: 'Rural Karnataka 10-Bus Multi-Asset Microgrid' },
    {
      key: 'description',
      value:
        'Scalable multi-zone microgrid with solar PV, wind, BESS storage, micro-hydro, diesel peaker, critical clinic, agricultural pumps, and EV hub.',
    },
  ]);
  XLSX.utils.book_append_sheet(wb, metaSheet, 'Metadata');

  const guideSheet = XLSX.utils.json_to_sheet(
    DATASET_SCHEMA_COLUMNS.map((c) => ({
      Sheet: c.sheet,
      Column: c.column,
      Required: c.required ? 'Yes' : 'Optional',
      Type: c.type,
      'Units / Allowed Values': c.unitOrValues,
      Description: c.description,
    }))
  );
  XLSX.utils.book_append_sheet(wb, guideSheet, 'Schema_Guide');

  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new Uint8Array(out);
}
