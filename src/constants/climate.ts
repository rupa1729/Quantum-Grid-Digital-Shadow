import type { ClimateConditions, ConstraintId } from '../types/grid';

export const NOMINAL_CLIMATE_CONDITIONS: ClimateConditions = {
  locationName: 'Northeast Metro Corridor',
  ambientTempC: 26,
  windSpeedMs: 5.5,
  solarIrradianceWm2: 720,
  stormRiskPct: 12,
  peakTariffMultiplier: 1.0,
};

export const CLIMATE_PRESETS: { id: string; label: string; conditions: ClimateConditions }[] = [
  {
    id: 'nominal',
    label: 'Temperate Nominal (26°C)',
    conditions: NOMINAL_CLIMATE_CONDITIONS,
  },
  {
    id: 'heatwave',
    label: 'Summer Heatwave (42°C)',
    conditions: {
      locationName: 'Southwest Desert Grid',
      ambientTempC: 42,
      windSpeedMs: 2.1,
      solarIrradianceWm2: 940,
      stormRiskPct: 18,
      peakTariffMultiplier: 1.38,
    },
  },
  {
    id: 'coastal-wind',
    label: 'Coastal High-Wind Cooling',
    conditions: {
      locationName: 'North Sea Offshore Tie',
      ambientTempC: 16,
      windSpeedMs: 13.4,
      solarIrradianceWm2: 410,
      stormRiskPct: 28,
      peakTariffMultiplier: 0.92,
    },
  },
  {
    id: 'storm-drop',
    label: 'Storm Front & Solar Drop',
    conditions: {
      locationName: 'Gulf Coastal Interconnect',
      ambientTempC: 31,
      windSpeedMs: 16.0,
      solarIrradianceWm2: 180,
      stormRiskPct: 74,
      peakTariffMultiplier: 1.25,
    },
  },
];

export const CONSTRAINT_CATALOG: {
  id: ConstraintId;
  label: string;
  shortLabel: string;
  description: string;
}[] = [
  {
    id: 'thermal_limits',
    label: 'Thermal Line Limits',
    shortLabel: 'Thermal Limits',
    description: 'Enforces MVA conductor thermal ceilings and transformer winding temperature caps (< 85°C).',
  },
  {
    id: 'voltage_stability',
    label: 'Voltage Stability (±5%)',
    shortLabel: 'Voltage ±5%',
    description: 'Maintains bus voltage envelopes strictly within 0.95–1.05 p.u. across reactive dispatch.',
  },
  {
    id: 'n_minus_1',
    label: 'N-1 Contingency Resilience',
    shortLabel: 'N-1 Contingency',
    description: 'Guarantees zero cascading blackouts when any single primary transmission corridor trips.',
  },
  {
    id: 'renewable_intermittency',
    label: 'Renewable Intermittency',
    shortLabel: 'Renewable Ramp',
    description: 'Absorbs ±25% solar and wind ramp volatility through quantum-scheduled storage dispatch.',
  },
  {
    id: 'substation_capacity',
    label: 'Substation Capacity Cap',
    shortLabel: 'Substation Cap',
    description: 'Balances bay-level transformer loading below 82% utilization during peak metro surges.',
  },
];

export const CONSTRAINT_IDS: ConstraintId[] = CONSTRAINT_CATALOG.map((c) => c.id);
