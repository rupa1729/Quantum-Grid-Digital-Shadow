import test from 'node:test';
import assert from 'node:assert/strict';
import { LIVE_REGIONS } from '../constants';
import {
  buildFallbackStreamPayload,
  buildOpenMeteoUrl,
  buildTopologyFromLiveSlot,
  findCurrentSlotIndex,
  getLiveRegionById,
  parseOpenMeteoResponse,
  projectLatLonToCanvas,
} from './liveRegions';

test('rural Karnataka cluster matches exact 8 user coordinates', () => {
  const karnataka = getLiveRegionById('karnataka-rural-8');
  assert.ok(karnataka);
  assert.equal(karnataka.nodes.length, 8);
  assert.deepEqual(
    karnataka.nodes.map((n) => n.lat),
    [12.97, 13.02, 12.91, 13.08, 12.88, 13.12, 12.95, 13.05]
  );
  assert.deepEqual(
    karnataka.nodes.map((n) => n.lon),
    [77.59, 77.64, 77.52, 77.70, 77.48, 77.61, 77.68, 77.55]
  );
});

test('buildOpenMeteoUrl targets only api.open-meteo.com with minutely_15 parameters', () => {
  const region = LIVE_REGIONS[0];
  const url = new URL(buildOpenMeteoUrl(region));
  assert.equal(url.origin, 'https://api.open-meteo.com');
  assert.equal(url.pathname, '/v1/forecast');
  assert.equal(
    url.searchParams.get('minutely_15'),
    'shortwave_radiation,wind_speed_80m,temperature_2m'
  );
  assert.equal(url.searchParams.get('latitude')?.split(',').length, 8);
  assert.equal(url.searchParams.get('longitude')?.split(',').length, 8);
});

test('parseOpenMeteoResponse parses multi-coordinate array payload accurately', () => {
  const region = LIVE_REGIONS[0];
  const mockApi = region.nodes.map((n, idx) => ({
    latitude: n.lat,
    longitude: n.lon,
    elevation: 890 + idx * 10,
    timezone: 'Asia/Kolkata',
    minutely_15: {
      time: ['2026-11-25T12:00', '2026-11-25T12:15', '2026-11-25T12:30'],
      shortwave_radiation: [780 + idx * 5, 810, 825],
      wind_speed_80m: [6.2, 6.5, 6.8],
      temperature_2m: [29.4, 29.8, 30.1],
    },
  }));

  const parsed = parseOpenMeteoResponse(mockApi, region);
  assert.ok(parsed);
  assert.equal(parsed.source, 'open_meteo_live');
  assert.equal(parsed.timezone, 'Asia/Kolkata');
  assert.equal(parsed.timestamps.length, 3);
  assert.equal(parsed.nodeSeries.length, 8);
  assert.equal(parsed.nodeSeries[0].shortwaveRadiationWm2[0], 780);
  assert.equal(parsed.nodeSeries[2].shortwaveRadiationWm2[0], 790);
});

test('projectLatLonToCanvas keeps north-up ordering and stays within bounds', () => {
  const region = LIVE_REGIONS[0];
  const { coords, bounds } = projectLatLonToCanvas(region.nodes);
  const northMost = coords.get('K06')!; // lat 13.12
  const southMost = coords.get('K05')!; // lat 12.88
  const eastMost = coords.get('K04')!; // lon 77.70
  const westMost = coords.get('K05')!; // lon 77.48

  assert.ok(northMost.y < southMost.y, 'Higher latitude should project further North (smaller y)');
  assert.ok(eastMost.x > westMost.x, 'Higher longitude should project further East (larger x)');
  assert.equal(bounds.minLat, 12.88);
  assert.equal(bounds.maxLat, 13.12);
});

test('buildTopologyFromLiveSlot maps real telemetry into geo-clustered GridTopology', () => {
  const region = LIVE_REGIONS[0];
  const fallback = buildFallbackStreamPayload(region);
  const { topology, climate } = buildTopologyFromLiveSlot(region, fallback, 54);

  assert.equal(topology.nodes.length, 8);
  assert.ok(topology.geoBounds);
  assert.equal(topology.geoBounds?.regionId, 'karnataka-rural-8');
  assert.ok(topology.nodes.every((n) => typeof n.lat === 'number' && typeof n.lon === 'number'));
  assert.ok(topology.nodes.every((n) => typeof n.clusterId === 'string' && typeof n.solarWm2 === 'number'));
  assert.ok(climate.ambientTempC > 0);
  assert.ok(climate.solarIrradianceWm2 > 0);
});

test('findCurrentSlotIndex locks to Asia/Kolkata local nighttime slot with 0 W/m2 solar irradiance', () => {
  const timestamps: string[] = [];
  for (let i = 0; i < 96; i++) {
    const h = String(Math.floor(i / 4)).padStart(2, '0');
    const m = String((i % 4) * 15).padStart(2, '0');
    timestamps.push(`2026-11-26T${h}:${m}`);
  }
  // 2026-11-25T20:20:00Z == 2026-11-26 01:50 Asia/Kolkata (IST = UTC+5:30)
  const istNightInstant = new Date('2026-11-25T20:20:00Z');
  const idx = findCurrentSlotIndex(timestamps, 'Asia/Kolkata', istNightInstant);
  assert.equal(timestamps[idx], '2026-11-26T01:45');

  const region = LIVE_REGIONS[0];
  const fallback = buildFallbackStreamPayload(region);
  const { climate } = buildTopologyFromLiveSlot(region, fallback, idx);
  assert.equal(climate.solarIrradianceWm2, 0, 'Nighttime 01:45 IST slot must have 0 W/m² solar irradiance');
});
