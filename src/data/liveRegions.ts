import type {
  ClimateConditions,
  GridAlert,
  GridEdge,
  GridNode,
  GridTopology,
  LiveNodeForecastSeries,
  LiveRegionDefinition,
  LiveRegionStreamPayload,
} from '../types/grid';
import { LIVE_REGIONS, OPEN_METEO_CONFIG } from '../constants';
import { computeEdgeStatus, computeNodeStatus, roundTo } from '../engine/quantumGridEngine';

export function getLiveRegionById(regionId: string): LiveRegionDefinition | undefined {
  return LIVE_REGIONS.find((r) => r.id === regionId);
}

/**
 * Constructs a strictly allowlisted Open-Meteo 15-minute multi-coordinate API URL.
 */
export function buildOpenMeteoUrl(region: LiveRegionDefinition): string {
  const lats = region.nodes.map((n) => n.lat.toFixed(4)).join(',');
  const lons = region.nodes.map((n) => n.lon.toFixed(4)).join(',');
  const url = new URL(OPEN_METEO_CONFIG.baseUrl);
  url.searchParams.set('latitude', lats);
  url.searchParams.set('longitude', lons);
  url.searchParams.set('minutely_15', OPEN_METEO_CONFIG.minutely15Variables);
  url.searchParams.set('forecast_days', OPEN_METEO_CONFIG.forecastDays);
  url.searchParams.set('timezone', OPEN_METEO_CONFIG.timezone);
  return url.toString();
}

function sanitizeNumberArray(raw: unknown, fallbackLen: number, fallbackVal: number): number[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return Array.from({ length: fallbackLen }, () => fallbackVal);
  }
  return raw.map((v) => (typeof v === 'number' && Number.isFinite(v) ? roundTo(v, 2) : fallbackVal));
}

function getFallbackTimezoneForRegion(regionId: string): string {
  switch (regionId) {
    case 'karnataka-rural-8':
      return 'Asia/Kolkata';
    case 'texas-ercot-10':
      return 'America/Chicago';
    case 'california-valley-8':
      return 'America/Los_Angeles';
    case 'bavaria-alpine-8':
      return 'Europe/Berlin';
    case 'kyushu-smart-9':
      return 'Asia/Tokyo';
    default:
      return 'UTC';
  }
}

export function findCurrentSlotIndex(timestamps: string[], timezone: string = 'UTC', now: Date = new Date()): number {
  if (timestamps.length === 0) return 0;

  let localDate = '';
  let targetMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    const year = get('year');
    const month = get('month');
    const day = get('day');
    const hour = Number(get('hour')) % 24;
    const minute = Number(get('minute'));
    if (year && month && day && Number.isFinite(hour) && Number.isFinite(minute)) {
      localDate = `${year}-${month}-${day}`;
      targetMinutes = hour * 60 + minute;
    }
  } catch {
    // Fallback to UTC if an unknown timezone string is received
    localDate = now.toISOString().slice(0, 10);
    targetMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  }

  let bestIdx = 0;
  let bestDiff = Infinity;

  timestamps.forEach((ts, idx) => {
    const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(ts);
    if (!match) return;
    const tsDate = match[1];
    const mins = Number(match[2]) * 60 + Number(match[3]);
    // Prefer matching the exact local calendar date when present in the forecast array
    const datePenalty = localDate && tsDate !== localDate ? 24 * 60 : 0;
    const diff = datePenalty + Math.abs(mins - targetMinutes);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIdx = idx;
    }
  });
  return bestIdx;
}

/**
 * Parses Open-Meteo's multi-coordinate response array into a validated LiveRegionStreamPayload.
 */
export function parseOpenMeteoResponse(
  rawJson: unknown,
  region: LiveRegionDefinition
): LiveRegionStreamPayload | null {
  const items = Array.isArray(rawJson) ? rawJson : rawJson && typeof rawJson === 'object' ? [rawJson] : [];
  if (items.length === 0) return null;

  const first = items[0] as Record<string, unknown>;
  const firstMinutely = first?.minutely_15 as Record<string, unknown> | undefined;
  const rawTime = firstMinutely?.time;
  if (!Array.isArray(rawTime) || rawTime.length === 0) return null;

  const timestamps = rawTime.map((t) => String(t));
  const slotCount = timestamps.length;
  const timezone = typeof first.timezone === 'string' ? first.timezone : 'UTC';

  const nodeSeries: LiveNodeForecastSeries[] = region.nodes.map((node, idx) => {
    const entry = (items[idx] ?? items[0]) as Record<string, unknown>;
    const minutely = (entry?.minutely_15 ?? {}) as Record<string, unknown>;
    const elevationM =
      typeof entry?.elevation === 'number' && Number.isFinite(entry.elevation)
        ? Math.round(entry.elevation)
        : 250;

    return {
      nodeId: node.id,
      lat: node.lat,
      lon: node.lon,
      elevationM,
      shortwaveRadiationWm2: sanitizeNumberArray(minutely.shortwave_radiation, slotCount, 420),
      windSpeed80mMs: sanitizeNumberArray(minutely.wind_speed_80m, slotCount, 5.2),
      temperature2mC: sanitizeNumberArray(minutely.temperature_2m, slotCount, 26.0),
    };
  });

  return {
    regionId: region.id,
    regionName: region.name,
    country: region.country,
    source: 'open_meteo_live',
    apiProvider: 'Open-Meteo 15-Min Forecast API',
    fetchedAtUtc: new Date().toISOString(),
    timezone,
    timestamps,
    currentSlotIndex: findCurrentSlotIndex(timestamps, timezone),
    nodeSeries,
  };
}

/**
 * Deterministic diurnal weather fallback if Open-Meteo cannot be reached (never claims live status).
 */
export function buildFallbackStreamPayload(region: LiveRegionDefinition): LiveRegionStreamPayload {
  const fallbackTimezone = getFallbackTimezoneForRegion(region.id);
  let today = new Date().toISOString().slice(0, 10);
  try {
    today = new Intl.DateTimeFormat('en-CA', {
      timeZone: fallbackTimezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    // keep UTC fallback
  }
  const timestamps: string[] = [];
  for (let i = 0; i < 96; i++) {
    const h = String(Math.floor(i / 4)).padStart(2, '0');
    const m = String((i % 4) * 15).padStart(2, '0');
    timestamps.push(`${today}T${h}:${m}`);
  }

  const baseTemp =
    region.id === 'karnataka-rural-8'
      ? 28
      : region.id === 'texas-ercot-10'
      ? 31
      : region.id === 'california-valley-8'
      ? 33
      : region.id === 'bavaria-alpine-8'
      ? 16
      : 23;

  const nodeSeries: LiveNodeForecastSeries[] = region.nodes.map((node, nodeIdx) => {
    const shortwaveRadiationWm2: number[] = [];
    const windSpeed80mMs: number[] = [];
    const temperature2mC: number[] = [];

    for (let s = 0; s < 96; s++) {
      const hour = s / 4;
      const sunAngle = Math.max(0, Math.sin(((hour - 6) / 12) * Math.PI));
      const cloudWave = 0.85 + 0.15 * Math.sin(s * 0.25 + nodeIdx * 1.1);
      const solar = roundTo(sunAngle * 920 * cloudWave, 1);
      const wind = roundTo(4.2 + 3.8 * Math.sin((hour + nodeIdx) * 0.32) + (region.id === 'texas-ercot-10' ? 4.5 : 1.2), 1);
      const temp = roundTo(baseTemp - 4.5 * Math.cos(((hour - 4) / 24) * Math.PI * 2) + (nodeIdx % 3) * 0.6, 1);

      shortwaveRadiationWm2.push(Math.max(0, solar));
      windSpeed80mMs.push(Math.max(0.8, wind));
      temperature2mC.push(temp);
    }

    return {
      nodeId: node.id,
      lat: node.lat,
      lon: node.lon,
      elevationM: 320 + nodeIdx * 28,
      shortwaveRadiationWm2,
      windSpeed80mMs,
      temperature2mC,
    };
  });

  return {
    regionId: region.id,
    regionName: region.name,
    country: region.country,
    source: 'fallback_model',
    apiProvider: 'Cached Diurnal Model (Open-Meteo Unreachable)',
    fetchedAtUtc: new Date().toISOString(),
    timezone: fallbackTimezone,
    timestamps,
    currentSlotIndex: findCurrentSlotIndex(timestamps, fallbackTimezone),
    nodeSeries,
  };
}

/**
 * Projects real geographic lat/lon coordinates into normalized 0..1000 x 0..560 canvas space
 * while preserving North-up orientation and preventing overlapping footprints.
 */
export function projectLatLonToCanvas(
  nodes: { id: string; lat: number; lon: number }[]
): {
  coords: Map<string, { x: number; y: number }>;
  bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number };
} {
  const lats = nodes.map((n) => n.lat);
  const lons = nodes.map((n) => n.lon);
  const rawMinLat = Math.min(...lats);
  const rawMaxLat = Math.max(...lats);
  const rawMinLon = Math.min(...lons);
  const rawMaxLon = Math.max(...lons);

  const latSpan = Math.max(0.02, rawMaxLat - rawMinLat);
  const lonSpan = Math.max(0.02, rawMaxLon - rawMinLon);

  const padX = 120;
  const padY = 95;
  const usableW = 1000 - padX * 2;
  const usableH = 560 - padY * 2;

  const coords = new Map<string, { x: number; y: number }>();
  for (const n of nodes) {
    const normLon = (n.lon - rawMinLon) / lonSpan;
    const normLat = (n.lat - rawMinLat) / latSpan;
    const x = Math.round(padX + normLon * usableW);
    // North = top (smaller y -> negative Z in Three.js)
    const y = Math.round(padY + (1 - normLat) * usableH);
    coords.set(n.id, { x, y });
  }

  return {
    coords,
    bounds: {
      minLat: roundTo(rawMinLat, 4),
      maxLat: roundTo(rawMaxLat, 4),
      minLon: roundTo(rawMinLon, 4),
      maxLon: roundTo(rawMaxLon, 4),
    },
  };
}

/**
 * Converts a live Open-Meteo 15-minute slot into a complete GridTopology, regional ClimateConditions,
 * and real-time operational GridAlerts.
 */
export function buildTopologyFromLiveSlot(
  region: LiveRegionDefinition,
  payload: LiveRegionStreamPayload,
  slotIndex: number
): {
  topology: GridTopology;
  climate: ClimateConditions;
  alerts: GridAlert[];
  slotTimestamp: string;
} {
  const safeSlot = Math.max(0, Math.min(Math.max(0, payload.timestamps.length - 1), slotIndex));
  const slotTimestamp = payload.timestamps[safeSlot] ?? new Date().toISOString().slice(0, 16);
  const timeMatch = /T(\d{2}):(\d{2})/.exec(slotTimestamp);
  const hourFloat = timeMatch ? Number(timeMatch[1]) + Number(timeMatch[2]) / 60 : 13.5;
  const shortTime = timeMatch ? `${timeMatch[1]}:${timeMatch[2]}` : '13:30';

  const { coords, bounds } = projectLatLonToCanvas(region.nodes);
  const seriesById = new Map(payload.nodeSeries.map((s) => [s.nodeId, s]));

  // Diurnal demand curve (morning ramp + afternoon cooling/industrial peak + evening peak)
  const diurnalDemandFactor =
    0.84 +
    0.16 * Math.sin(((hourFloat - 7) / 14) * Math.PI) +
    (hourFloat >= 17 && hourFloat <= 21 ? 0.14 : 0);

  let tempSum = 0;
  let windSum = 0;
  let solarSum = 0;

  const nodes: GridNode[] = region.nodes.map((spec, idx) => {
    const series = seriesById.get(spec.id);
    const solar = series?.shortwaveRadiationWm2[safeSlot] ?? 420;
    const wind = series?.windSpeed80mMs[safeSlot] ?? 5.5;
    const ambientTemp = series?.temperature2mC[safeSlot] ?? 27.0;

    tempSum += ambientTemp;
    windSum += wind;
    solarSum += solar;

    const pos = coords.get(spec.id) ?? { x: 200 + idx * 80, y: 260 };

    // Physics coupling: high ambient heat raises cooling demand & conductor temp; wind cools lines
    const heatDemandBoost = Math.max(0, ambientTemp - 24) * 0.011;
    const solarFactor = Math.min(1, solar / 850);
    const windFactor = Math.min(1, wind / 14);

    let effectiveLoad = spec.baseLoadMW * diurnalDemandFactor * (1 + heatDemandBoost);
    if (spec.role === 'renewable') {
      // High solar/wind increases renewable injection load through local inverter bus
      effectiveLoad = spec.baseLoadMW * (0.68 + solarFactor * 0.34 + windFactor * 0.24);
    } else if (spec.role === 'load') {
      // Load buses surge under high temperature and when midday solar dips
      effectiveLoad = spec.baseLoadMW * (diurnalDemandFactor + heatDemandBoost * 1.35 + (solar < 120 ? 0.06 : 0));
    } else if (spec.role === 'substation') {
      effectiveLoad = spec.baseLoadMW * (diurnalDemandFactor + heatDemandBoost * 1.15);
    }

    const loadMW = Math.round(Math.max(38, Math.min(spec.capacityMW * 0.99, effectiveLoad)));
    const util = loadMW / spec.capacityMW;

    // Conductor temperature = ambient + I^2R thermal rise - convective wind cooling
    const conductorTemp = roundTo(
      ambientTemp + util * 56 - Math.min(14, wind * 0.95),
      1
    );
    const voltagePU = roundTo(
      Math.max(0.918, Math.min(1.032, 1.028 - util * 0.095 - (util > 0.88 ? 0.014 : 0))),
      3
    );
    const phaseAngleDeg = roundTo(-1.2 - idx * 0.9 - util * 4.2, 1);

    return {
      id: spec.id,
      name: spec.name,
      role: spec.role,
      region: spec.clusterName,
      x: pos.x,
      y: pos.y,
      loadMW,
      capacityMW: spec.capacityMW,
      voltagePU,
      temperatureC: conductorTemp,
      phaseAngleDeg,
      qubitIndex: spec.qubitIndex,
      status: computeNodeStatus(loadMW, spec.capacityMW, voltagePU, conductorTemp),
      quantumDispatchMW: roundTo(loadMW * 0.86, 1),
      classicalDispatchMW: roundTo(loadMW * 1.03, 1),
      lat: spec.lat,
      lon: spec.lon,
      clusterId: spec.clusterId,
      clusterName: spec.clusterName,
      clusterColor: spec.clusterColor,
      solarWm2: roundTo(solar, 0),
      windSpeed80mMs: roundTo(wind, 1),
      ambientTempC: roundTo(ambientTemp, 1),
    };
  });

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const avgTemp = roundTo(tempSum / Math.max(1, nodes.length), 1);
  const avgWind = roundTo(windSum / Math.max(1, nodes.length), 1);
  const avgSolar = roundTo(solarSum / Math.max(1, nodes.length), 0);

  // IEEE-738 dynamic line rating derating from live ambient temp & 80m wind cooling
  const thermalDerate = Math.max(0.74, Math.min(1.16, 1 - (avgTemp - 25) * 0.0085 + (avgWind - 5) * 0.01));

  const edges: GridEdge[] = region.edges.map((spec) => {
    const src = nodeMap.get(spec.source);
    const tgt = nodeMap.get(spec.target);
    const avgLoad = src && tgt ? (src.loadMW + tgt.loadMW) / 2 : 120;
    const effectiveLimit = Math.max(70, Math.round(spec.limitMW * thermalDerate));
    const flowMW = Math.round(Math.min(effectiveLimit * 0.99, avgLoad * 0.92));
    const lossMW = roundTo((flowMW * flowMW * spec.resistanceOhm) / 1500, 2);

    return {
      id: spec.id,
      source: spec.source,
      target: spec.target,
      flowMW,
      limitMW: effectiveLimit,
      resistanceOhm: spec.resistanceOhm,
      lossMW,
      status: computeEdgeStatus(flowMW, effectiveLimit),
      isQuantumPath: spec.isQuantumPrimary,
      isClassicalPath: spec.isClassicalPrimary,
    };
  });

  const stormRiskPct = Math.round(
    Math.max(5, Math.min(85, avgWind * 3.2 + (avgSolar < 150 && hourFloat > 9 && hourFloat < 16 ? 24 : 6)))
  );

  const climate: ClimateConditions = {
    locationName: `${region.name} (${region.country})`,
    ambientTempC: avgTemp,
    windSpeedMs: avgWind,
    solarIrradianceWm2: avgSolar,
    stormRiskPct,
    peakTariffMultiplier: region.tariffMultiplier,
  };

  const alerts: GridAlert[] = nodes
    .filter((n) => n.status !== 'healthy')
    .sort((a, b) => (a.status === 'alarming' ? -1 : 1) - (b.status === 'alarming' ? -1 : 1))
    .map((n) => ({
      id: `live-alert-${region.id}-${n.id}-${safeSlot}`,
      timestamp: `${shortTime}:00`,
      nodeId: n.id,
      nodeName: n.name,
      severity: n.status === 'alarming' ? 'alarming' : 'warning',
      message:
        n.status === 'alarming'
          ? `Live Open-Meteo slot (${shortTime}): ${n.ambientTempC}°C ambient pushed bus to ${Math.round((n.loadMW / n.capacityMW) * 100)}% loading (${n.temperatureC}°C conductor).`
          : `Cluster "${n.clusterName}" elevated load (${Math.round((n.loadMW / n.capacityMW) * 100)}%) · Solar ${n.solarWm2} W/m² · Wind ${n.windSpeed80mMs} m/s.`,
      metricSummary: `${n.loadMW} MW · ${n.voltagePU} p.u. · ${n.temperatureC}°C`,
    }));

  const topology: GridTopology = {
    id: region.id,
    name: region.name,
    description: region.description,
    nodes,
    edges,
    geoBounds: {
      ...bounds,
      regionId: region.id,
      regionLabel: region.name,
      country: region.country,
    },
  };

  return { topology, climate, alerts, slotTimestamp };
}
