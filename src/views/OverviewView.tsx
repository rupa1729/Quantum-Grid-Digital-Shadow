import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CloudSun,
  Download,
  Globe,
  Moon,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Zap,
} from 'lucide-react';
import type {
  ClimateConditions,
  GridAlert,
  GridSummary,
  GridTopology,
  GridViewMode,
  HealthStatus,
  HistoricalLogEntry,
  LiveRegionStreamPayload,
  NodeSizeMode,
  PathViewMode,
  QiskitBackend,
} from '../types/grid';
import { CLIMATE_PRESETS, LIVE_REGIONS } from '../constants';
import { D3GridVisualizer } from '../components/D3GridVisualizer';
import { ThreeGridVisualizer } from '../components/ThreeGridVisualizer';
import { AnimatedNumber } from '../components/AnimatedNumber';
import { PulsingDot } from '../components/PulsingDot';
import { StatusIndicator } from '../components/StatusIndicator';

interface OverviewViewProps {
  topology: GridTopology;
  summary: GridSummary;
  alerts: GridAlert[];
  logs: HistoricalLogEntry[];
  activeBackend: QiskitBackend;
  climate: ClimateConditions;
  onSelectClimate: (climate: ClimateConditions) => void;
  selectedRegionId: string;
  liveStreamPayload: LiveRegionStreamPayload | null;
  liveSlotIndex: number;
  isLiveStreaming: boolean;
  isLoadingRegion: boolean;
  onSelectRegion: (regionId: string) => void;
  onRefreshRegion: () => void;
  onSelectLiveSlot: (slotIndex: number) => void;
  onToggleLiveStream: () => void;
  isDark: boolean;
  lastOptimizationDelta: number | null;
  onInjectFault: () => void;
  onRunQuantumOptimize: () => void;
  onResetGrid: () => void;
  onInspectNode: (nodeId: string) => void;
}

export function OverviewView({
  topology,
  summary,
  alerts,
  logs,
  activeBackend,
  climate,
  onSelectClimate,
  selectedRegionId,
  liveStreamPayload,
  liveSlotIndex,
  isLiveStreaming,
  isLoadingRegion,
  onSelectRegion,
  onRefreshRegion,
  onSelectLiveSlot,
  onToggleLiveStream,
  isDark,
  lastOptimizationDelta,
  onInjectFault,
  onRunQuantumOptimize,
  onResetGrid,
  onInspectNode,
}: OverviewViewProps) {
  const [pathMode, setPathMode] = useState<PathViewMode>('quantum');
  const [viewMode, setViewMode] = useState<GridViewMode>('3d');
  const [nodeSizeMode, setNodeSizeMode] = useState<NodeSizeMode>('standard');
  const [isPlaying, setIsPlaying] = useState(true);
  const [alertFilter, setAlertFilter] = useState<'all' | 'alarming' | 'warning' | 'resolved'>('all');
  const [logStatusFilter, setLogStatusFilter] = useState<'all' | HealthStatus>('all');
  const [logSearch, setLogSearch] = useState('');

  const isLiveRegionActive = selectedRegionId !== 'synthetic-ieee14' && Boolean(liveStreamPayload);

  const activeClusters = useMemo(() => {
    const map = new Map<string, { id: string; name: string; color: string; count: number }>();
    for (const node of topology.nodes) {
      if (!node.clusterId || !node.clusterName) continue;
      const existing = map.get(node.clusterId);
      if (existing) {
        existing.count += 1;
      } else {
        map.set(node.clusterId, {
          id: node.clusterId,
          name: node.clusterName,
          color: node.clusterColor ?? '#0F62FE',
          count: 1,
        });
      }
    }
    return Array.from(map.values());
  }, [topology.nodes]);

  const activeSlotMeta = useMemo(() => {
    if (!liveStreamPayload || liveStreamPayload.timestamps.length === 0) {
      return { date: '', time: '13:30', utcRef: '' };
    }
    const raw = liveStreamPayload.timestamps[liveSlotIndex] ?? '';
    const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(raw);
    const utcMatch = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(liveStreamPayload.fetchedAtUtc ?? '');
    return {
      date: match ? match[1] : '',
      time: match ? match[2] : raw || '13:30',
      utcRef: utcMatch ? `${utcMatch[1]} ${utcMatch[2]} UTC` : '',
    };
  }, [liveStreamPayload, liveSlotIndex]);

  const filteredAlerts = useMemo(() => {
    if (alertFilter === 'all') return alerts;
    return alerts.filter((a) => a.severity === alertFilter);
  }, [alerts, alertFilter]);

  const filteredLogs = useMemo(() => {
    return logs.filter((entry) => {
      const matchStatus = logStatusFilter === 'all' || entry.status === logStatusFilter;
      const q = logSearch.trim().toLowerCase();
      const matchSearch =
        !q ||
        entry.solver.toLowerCase().includes(q) ||
        entry.datasetName.toLowerCase().includes(q) ||
        entry.timestamp.toLowerCase().includes(q);
      return matchStatus && matchSearch;
    });
  }, [logs, logStatusFilter, logSearch]);

  const latestLog = logs[0];
  const accuracyEdge = latestLog
    ? (latestLog.quantumAccuracy - latestLog.classicalAccuracy).toFixed(1)
    : '7.4';

  const handleExportLogsCsv = () => {
    const headers = [
      'Timestamp',
      'Iteration',
      'Solver',
      'Dataset',
      'HealthyNodes',
      'WarningNodes',
      'AlarmingNodes',
      'QuantumAccuracyPct',
      'ClassicalAccuracyPct',
      'TotalLossMW',
      'RuntimeMs',
      'Status',
    ];
    const rows = filteredLogs.map((l) =>
      [
        l.timestamp,
        l.iteration,
        `"${l.solver}"`,
        `"${l.datasetName}"`,
        l.healthyCount,
        l.warningCount,
        l.alarmingCount,
        l.quantumAccuracy,
        l.classicalAccuracy,
        l.totalLossMW,
        l.runtimeMs,
        l.status,
      ].join(',')
    );
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'qgrid_historical_logs.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Top KPI Strip */}
      <section aria-label="Grid summary metrics" className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="card-interactive rounded-md border border-slate-200 dark:border-[#393939] bg-white dark:bg-[#262626] p-4">
          <div className="text-xs font-medium text-slate-500 dark:text-[#A8A8A8]">Grid Health Index</div>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="text-2xl font-mono font-semibold text-slate-900 dark:text-[#F4F4F4] tabular-nums">
              <AnimatedNumber value={summary.healthIndex} decimals={Number.isInteger(summary.healthIndex) ? 0 : 1} suffix="%" />
            </span>
            <span className="text-xs font-mono text-slate-500 dark:text-[#A8A8A8] tabular-nums">
              {summary.healthyCount}G / {summary.warningCount}Y / {summary.alarmingCount}R
            </span>
          </div>
          <div className="mt-2 text-xs text-slate-500 dark:text-[#A8A8A8]">
            {summary.totalNodes} active buses · Avg {summary.avgVoltagePU} p.u.
          </div>
        </div>

        <div className="card-interactive rounded-md border border-slate-200 dark:border-[#393939] bg-white dark:bg-[#262626] p-4">
          <div className="text-xs font-medium text-slate-500 dark:text-[#A8A8A8]">
            Quantum vs Classical Gain
          </div>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="text-2xl font-mono font-semibold text-[#0F62FE] dark:text-[#78A9FF] tabular-nums">
              <AnimatedNumber value={Number(accuracyEdge)} decimals={1} prefix="+" suffix="%" />
            </span>
            <span className="text-xs text-slate-500 dark:text-[#A8A8A8]">dispatch accuracy</span>
          </div>
          <div className="mt-2 text-xs font-mono text-slate-500 dark:text-[#A8A8A8] tabular-nums">
            Q: {latestLog?.quantumAccuracy ?? 96.8}% · C: {latestLog?.classicalAccuracy ?? 89.4}%
          </div>
        </div>

        <div className="card-interactive rounded-md border border-slate-200 dark:border-[#393939] bg-white dark:bg-[#262626] p-4">
          <div className="text-xs font-medium text-slate-500 dark:text-[#A8A8A8]">
            Grid Load & Line Loss
          </div>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="text-2xl font-mono font-semibold text-slate-900 dark:text-[#F4F4F4] tabular-nums">
              <AnimatedNumber value={Number(summary.totalLoadMW)} decimals={Number.isInteger(Number(summary.totalLoadMW)) ? 0 : 1} />
            </span>
            <span className="text-xs font-mono text-slate-500 dark:text-[#A8A8A8]">MW</span>
          </div>
          <div className="mt-2 text-xs font-mono text-slate-500 dark:text-[#A8A8A8] tabular-nums">
            Loss {summary.totalLossMW} MW
            {lastOptimizationDelta !== null
              ? ` · −${lastOptimizationDelta}% last run`
              : ` · ${summary.congestionPct}% congested`}
          </div>
        </div>

        <div className="card-interactive rounded-md border border-slate-200 dark:border-[#393939] bg-white dark:bg-[#262626] p-4">
          <div className="text-xs font-medium text-slate-500 dark:text-[#A8A8A8]">
            Active Grid Alerts
          </div>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span
              className={`text-2xl font-mono font-semibold tabular-nums ${
                summary.alarmingCount > 0
                  ? 'text-[#DC2626] dark:text-[#FA4D56]'
                  : summary.warningCount > 0
                  ? 'text-[#D97706] dark:text-[#F1C21B]'
                  : 'text-[#16A34A] dark:text-[#42BE65]'
              }`}
            >
              <AnimatedNumber value={summary.alarmingCount + summary.warningCount} />
            </span>
            <span className="text-xs text-slate-500 dark:text-[#A8A8A8]">stressed buses</span>
          </div>
          <div className="mt-2 text-xs text-slate-500 dark:text-[#A8A8A8] font-mono truncate">
            {activeBackend}
          </div>
        </div>
      </section>

      {/* Real-World Open-Meteo Regional API & Live 15-Min Telemetry Stream Bar */}
      <section
        aria-label="Live regional telemetry source"
        className="rounded-md border border-slate-200 dark:border-[#393939] bg-white dark:bg-[#262626] px-4 py-3 space-y-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-900 dark:text-[#F4F4F4]">
              <Globe className="h-4 w-4 text-[#0F62FE] dark:text-[#78A9FF]" aria-hidden="true" />
              Grid Region
            </span>
            <select
              id="overview-region-select"
              aria-label="Select grid region"
              value={selectedRegionId}
              onChange={(e) => onSelectRegion(e.target.value)}
              className="rounded-md border border-slate-300 dark:border-[#525252] bg-white dark:bg-[#161616] px-2.5 py-1.5 text-xs font-medium text-slate-900 dark:text-[#F4F4F4] focus:border-[#0F62FE] focus:outline-none"
            >
              <optgroup label="Live Open-Meteo 15-Min Regional Clusters">
                {LIVE_REGIONS.map((region) => (
                  <option key={region.id} value={region.id}>
                    {region.name} — {region.country}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Synthetic Benchmark">
                <option value="synthetic-ieee14">IEEE 14-Bus Synthetic Baseline</option>
              </optgroup>
            </select>

            {isLiveRegionActive && liveStreamPayload && (
              <>
                <span
                  data-testid="live-api-source-badge"
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 dark:border-[#525252] bg-slate-50 dark:bg-[#161616] px-2 py-1 text-[11px] font-medium whitespace-nowrap"
                >
                  <span
                    className={`h-2 w-2 rounded-full ${
                      isLoadingRegion
                        ? 'bg-[#0F62FE] dark:bg-[#78A9FF]'
                        : liveStreamPayload.source === 'open_meteo_live'
                        ? 'bg-[#16A34A] dark:bg-[#42BE65]'
                        : 'bg-[#D97706] dark:bg-[#F1C21B]'
                    }`}
                    aria-hidden="true"
                  />
                  <span className="text-slate-700 dark:text-[#E0E0E0]">
                    {isLoadingRegion
                      ? 'Syncing Open-Meteo...'
                      : liveStreamPayload.source === 'open_meteo_live'
                      ? 'Open-Meteo Live'
                      : 'Cached Model'}
                  </span>
                </span>

                <button
                  type="button"
                  disabled={isLoadingRegion}
                  onClick={onRefreshRegion}
                  title="Refresh live 15-minute Open-Meteo forecast"
                  className="inline-flex items-center gap-1 rounded-md border border-slate-300 dark:border-[#525252] bg-white dark:bg-[#161616] px-2.5 py-1.5 text-[11px] font-medium text-slate-700 dark:text-[#E0E0E0] hover:bg-slate-50 dark:hover:bg-[#353535] disabled:opacity-60 transition-colors whitespace-nowrap"
                >
                  <RefreshCw className={`h-3 w-3 ${isLoadingRegion ? 'animate-spin' : ''}`} aria-hidden="true" />
                  Refresh API
                </button>
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className="inline-flex items-center gap-1.5 font-mono text-slate-600 dark:text-[#C6C6C6] tabular-nums">
              {climate.solarIrradianceWm2 <= 0 ? (
                <Moon className="h-3.5 w-3.5 text-[#0F62FE] dark:text-[#78A9FF]" aria-hidden="true" />
              ) : (
                <CloudSun className="h-3.5 w-3.5 text-[#0F62FE] dark:text-[#78A9FF]" aria-hidden="true" />
              )}
              {climate.ambientTempC}°C · Wind {climate.windSpeedMs} m/s · Solar {climate.solarIrradianceWm2} W/m²
            </span>

            {!isLiveRegionActive && (
              <div className="flex items-center gap-2">
                <label htmlFor="overview-climate-preset" className="text-xs text-slate-500 dark:text-[#A8A8A8] whitespace-nowrap">
                  Climate Profile
                </label>
                <select
                  id="overview-climate-preset"
                  value={climate.locationName}
                  onChange={(e) => {
                    const found = CLIMATE_PRESETS.find((p) => p.conditions.locationName === e.target.value);
                    if (found) onSelectClimate(found.conditions);
                  }}
                  className="rounded-md border border-slate-300 dark:border-[#525252] bg-white dark:bg-[#161616] px-2.5 py-1.5 text-xs text-slate-800 dark:text-[#E0E0E0] focus:border-[#0F62FE] focus:outline-none"
                >
                  {CLIMATE_PRESETS.map((p) => (
                    <option key={p.id} value={p.conditions.locationName}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>

        {/* 15-Minute Telemetry Timeline Stream & Geo Cluster Legend (shown for live Open-Meteo regions) */}
        {isLiveRegionActive && liveStreamPayload && (
          <div className="pt-2.5 border-t border-slate-200 dark:border-[#393939] space-y-2.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={onToggleLiveStream}
                data-testid="toggle-live-stream-btn"
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  isLiveStreaming
                    ? 'bg-[#0F62FE] text-white hover:bg-[#0353E9]'
                    : 'border border-slate-300 dark:border-[#525252] bg-white dark:bg-[#161616] text-slate-800 dark:text-[#F4F4F4] hover:bg-slate-50 dark:hover:bg-[#353535]'
                }`}
              >
                {isLiveStreaming ? (
                  <Pause className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <Play className="h-3.5 w-3.5 text-[#0F62FE] dark:text-[#78A9FF]" aria-hidden="true" />
                )}
                {isLiveStreaming ? 'Pause 24h Replay' : 'Replay 24h Forecast'}
              </button>

              <span className="font-mono text-xs font-semibold text-slate-900 dark:text-[#F4F4F4] tabular-nums whitespace-nowrap">
                {activeSlotMeta.date ? `${activeSlotMeta.date} · ` : ''}
                {activeSlotMeta.time}
                <span className="ml-1 font-normal text-[11px] text-slate-500 dark:text-[#A8A8A8]">
                  ({liveStreamPayload.timezone})
                </span>
              </span>

              {liveSlotIndex === liveStreamPayload.currentSlotIndex ? (
                <span className="inline-flex items-center gap-1 rounded border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/40 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300 whitespace-nowrap">
                  <PulsingDot variant="green" size="h-1.5 w-1.5" />
                  Live Now
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => onSelectLiveSlot(liveStreamPayload.currentSlotIndex)}
                  className="rounded border border-slate-300 dark:border-[#525252] bg-white dark:bg-[#161616] px-1.5 py-0.5 text-[10px] font-medium text-[#0F62FE] dark:text-[#78A9FF] hover:bg-slate-50 dark:hover:bg-[#353535] whitespace-nowrap"
                >
                  Jump to Now
                </button>
              )}

              <input
                type="range"
                min={0}
                max={Math.max(0, liveStreamPayload.timestamps.length - 1)}
                value={liveSlotIndex}
                onChange={(e) => onSelectLiveSlot(Number(e.target.value))}
                aria-label="15-minute Open-Meteo telemetry timeline"
                className="flex-1 min-w-[160px] accent-[#0F62FE] cursor-pointer"
              />

              <span className="text-[11px] font-mono text-slate-500 dark:text-[#A8A8A8] tabular-nums whitespace-nowrap">
                Slot {liveSlotIndex + 1}/{liveStreamPayload.timestamps.length}
              </span>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
              {activeClusters.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-slate-500 dark:text-[#A8A8A8] font-medium">Clusters:</span>
                  {activeClusters.map((c) => (
                    <span
                      key={c.id}
                      className="inline-flex items-center gap-1.5 rounded border border-slate-200 dark:border-[#525252] bg-slate-50 dark:bg-[#161616] px-2 py-0.5 text-slate-700 dark:text-[#E0E0E0] whitespace-nowrap"
                    >
                      <span
                        className="h-2 w-2 rounded-xs shrink-0"
                        style={{ backgroundColor: c.color }}
                        aria-hidden="true"
                      />
                      {c.name} ({c.count})
                    </span>
                  ))}
                </div>
              )}

              {activeSlotMeta.utcRef && (
                <span className="font-mono text-[11px] text-slate-500 dark:text-[#A8A8A8] tabular-nums whitespace-nowrap">
                  Synced {activeSlotMeta.utcRef} → {liveStreamPayload.timezone}
                </span>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Main Grid Topology + Real-Time Alerts Split */}
      <section className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <div className="xl:col-span-8 rounded-md border border-slate-200 dark:border-[#393939] bg-white dark:bg-[#262626] p-5">
          <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-slate-200 dark:border-[#393939]">
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-[#F4F4F4]">
                Live Grid Network Topology — {topology.name}
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-[#A8A8A8]">
                {topology.geoBounds
                  ? `GPS map ${topology.geoBounds.minLat.toFixed(2)}°–${topology.geoBounds.maxLat.toFixed(2)}°, ${topology.geoBounds.minLon.toFixed(2)}°–${topology.geoBounds.maxLon.toFixed(2)}° · Hover any node for live Open-Meteo solar/wind telemetry, click for Diagnostics.`
                  : 'Click any bus to open Node Diagnostics. Hover nodes or corridors for live telemetry.'}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div
                role="group"
                aria-label="Grid visualization dimension"
                className="inline-flex items-center rounded-md border border-slate-200 dark:border-[#525252] bg-slate-50 dark:bg-[#161616] p-0.5"
              >
                {(
                  [
                    { id: '3d', label: topology.geoBounds ? '3D Geo Map' : '3D Blocks' },
                    { id: '2d', label: '2D D3' },
                  ] as const
                ).map((dim) => (
                  <button
                    key={dim.id}
                    type="button"
                    onClick={() => setViewMode(dim.id)}
                    className={`px-2.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                      viewMode === dim.id
                        ? 'bg-[#0F62FE] text-white shadow-xs'
                        : 'text-slate-600 dark:text-[#A8A8A8] hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    {dim.label}
                  </button>
                ))}
              </div>

              <div
                role="group"
                aria-label="Grid path view mode"
                className="inline-flex items-center rounded-md border border-slate-200 dark:border-[#525252] bg-slate-50 dark:bg-[#161616] p-0.5"
              >
                {(
                  [
                    { id: 'quantum', label: 'Quantum Path' },
                    { id: 'classical', label: 'Classical Path' },
                    { id: 'diff', label: 'Q vs C Diff' },
                  ] as const
                ).map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => setPathMode(mode.id)}
                    className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                      pathMode === mode.id
                        ? 'bg-white dark:bg-[#353535] text-slate-900 dark:text-white shadow-xs'
                        : 'text-slate-600 dark:text-[#A8A8A8] hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Action Toolbar */}
          <div className="my-3.5 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onRunQuantumOptimize}
                className="inline-flex items-center gap-1.5 rounded-md bg-[#0F62FE] px-3.5 py-2 text-xs font-medium text-white hover:bg-[#0353E9] transition-colors whitespace-nowrap shrink-0"
              >
                <Zap className="h-3.5 w-3.5" aria-hidden="true" />
                Run Quantum Optimization
              </button>
              <button
                type="button"
                onClick={onInjectFault}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 dark:border-[#525252] bg-white dark:bg-[#161616] px-3 py-2 text-xs font-medium text-slate-700 dark:text-[#E0E0E0] hover:bg-slate-50 dark:hover:bg-[#353535] transition-colors whitespace-nowrap shrink-0"
              >
                <AlertTriangle className="h-3.5 w-3.5 text-[#D97706] dark:text-[#F1C21B]" aria-hidden="true" />
                Inject Grid Fault
              </button>
              <button
                type="button"
                onClick={onResetGrid}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 dark:border-[#525252] bg-white dark:bg-[#161616] px-3 py-2 text-xs font-medium text-slate-600 dark:text-[#C6C6C6] hover:bg-slate-50 dark:hover:bg-[#353535] transition-colors whitespace-nowrap shrink-0"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                Reset Topology
              </button>
            </div>

            <div className="flex items-center gap-2">
              <select
                aria-label="Node display size"
                value={nodeSizeMode}
                onChange={(e) => setNodeSizeMode(e.target.value as NodeSizeMode)}
                className="rounded-md border border-slate-200 dark:border-[#525252] bg-white dark:bg-[#161616] px-2.5 py-2 text-xs text-slate-700 dark:text-[#E0E0E0] focus:border-[#0F62FE] focus:outline-none"
              >
                <option value="standard">Nodes: Standard</option>
                <option value="compact">Nodes: Compact</option>
                <option value="proportional">Nodes: Load-Scaled</option>
              </select>

              <button
                type="button"
                onClick={() => setIsPlaying((p) => !p)}
                aria-label={isPlaying ? 'Pause animated grid flow' : 'Play animated grid flow'}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 dark:border-[#525252] bg-white dark:bg-[#161616] px-3 py-2 text-xs font-medium text-slate-700 dark:text-[#E0E0E0] hover:bg-slate-50 dark:hover:bg-[#353535] whitespace-nowrap shrink-0"
              >
                {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                {isPlaying ? 'Pause Flow' : 'Resume Flow'}
              </button>
            </div>
          </div>

          {viewMode === '3d' ? (
            <ThreeGridVisualizer
              topology={topology}
              pathMode={pathMode}
              isPlaying={isPlaying}
              isDark={isDark}
              nodeSizeMode={nodeSizeMode}
              onSelectNode={onInspectNode}
              heightClass="h-[430px]"
            />
          ) : (
            <D3GridVisualizer
              topology={topology}
              pathMode={pathMode}
              isPlaying={isPlaying}
              isDark={isDark}
              nodeSizeMode={nodeSizeMode}
              onSelectNode={onInspectNode}
              heightClass="h-[430px]"
            />
          )}
        </div>

        {/* Real-Time Alerts Panel */}
        <div className="xl:col-span-4 rounded-md border border-slate-200 dark:border-[#393939] bg-white dark:bg-[#262626] p-5">
          <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-200 dark:border-[#393939]">
            <h2 className="text-base font-semibold text-slate-900 dark:text-[#F4F4F4]">
              Real-Time Grid Alerts
            </h2>
            <span className="text-xs font-mono text-slate-500 dark:text-[#A8A8A8] tabular-nums">
              {filteredAlerts.length} events
            </span>
          </div>

          <div className="mt-3 flex items-center gap-1 rounded-md border border-slate-200 dark:border-[#525252] bg-slate-50 dark:bg-[#161616] p-0.5">
            {(['all', 'alarming', 'warning', 'resolved'] as const).map((sev) => (
              <button
                key={sev}
                type="button"
                onClick={() => setAlertFilter(sev)}
                className={`flex-1 py-1.5 text-xs font-medium rounded capitalize transition-colors whitespace-nowrap ${
                  alertFilter === sev
                    ? 'bg-white dark:bg-[#353535] text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-[#A8A8A8] hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {sev}
              </button>
            ))}
          </div>

          <div className="mt-3 divide-y divide-slate-100 dark:divide-[#393939] max-h-[435px] overflow-y-auto pr-1">
            {filteredAlerts.length === 0 ? (
              <div className="py-10 text-center text-xs text-slate-500 dark:text-[#A8A8A8]">
                No alerts in this category. All monitored buses are operating smoothly.
              </div>
            ) : (
              filteredAlerts.map((alert) => (
                <div key={alert.id} className="py-3 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <StatusIndicator status={alert.severity} compact badgeStyle />
                    <span className="text-[11px] font-mono text-slate-400 dark:text-[#8D8D8D] tabular-nums">
                      {alert.timestamp}
                    </span>
                  </div>
                  <div className="text-xs font-semibold text-slate-900 dark:text-[#F4F4F4]">
                    {alert.nodeId} · {alert.nodeName}
                  </div>
                  <p className="text-xs text-slate-600 dark:text-[#C6C6C6] leading-relaxed">
                    {alert.message}
                  </p>
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <span className="text-[11px] font-mono text-slate-500 dark:text-[#A8A8A8] tabular-nums">
                      {alert.metricSummary}
                    </span>
                    <button
                      type="button"
                      onClick={() => onInspectNode(alert.nodeId)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-[#0F62FE] dark:text-[#78A9FF] hover:underline whitespace-nowrap"
                    >
                      Inspect
                      <ArrowRight className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      {/* Historical Trend Logs */}
      <section className="rounded-md border border-slate-200 dark:border-[#393939] bg-white dark:bg-[#262626] p-5">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-[#393939]">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-[#F4F4F4]">
              Historical Optimization & Telemetry Logs
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-[#A8A8A8]">
              Long-term system trend ledger tracking classical vs quantum runs, thermal recovery, and line loss.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={logSearch}
                onChange={(e) => setLogSearch(e.target.value)}
                placeholder="Filter solver or dataset..."
                aria-label="Filter historical logs"
                className="w-52 rounded-md border border-slate-300 dark:border-[#525252] bg-white dark:bg-[#161616] pl-8 pr-3 py-1.5 text-xs text-slate-800 dark:text-[#E0E0E0] placeholder:text-slate-400 focus:border-[#0F62FE] focus:outline-none"
              />
            </div>

            <div className="inline-flex items-center rounded-md border border-slate-200 dark:border-[#525252] bg-slate-50 dark:bg-[#161616] p-0.5">
              {(['all', 'healthy', 'warning', 'alarming'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setLogStatusFilter(st)}
                  className={`px-2.5 py-1 text-xs font-medium rounded capitalize whitespace-nowrap ${
                    logStatusFilter === st
                      ? 'bg-white dark:bg-[#353535] text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-[#A8A8A8] hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={handleExportLogsCsv}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 dark:border-[#525252] bg-white dark:bg-[#161616] px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-[#E0E0E0] hover:bg-slate-50 dark:hover:bg-[#353535] whitespace-nowrap"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              Export CSV
            </button>
          </div>
        </div>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-[#393939] text-[11px] font-semibold text-slate-500 dark:text-[#A8A8A8]">
                <th className="py-2.5 pr-4">Time</th>
                <th className="py-2.5 pr-4">Solver / Circuit</th>
                <th className="py-2.5 pr-4">Dataset</th>
                <th className="py-2.5 pr-4">Grid Status</th>
                <th className="py-2.5 pr-4 text-right">Node Split (G/Y/R)</th>
                <th className="py-2.5 pr-4 text-right">Quantum Acc</th>
                <th className="py-2.5 pr-4 text-right">Classical Acc</th>
                <th className="py-2.5 pr-4 text-right">Loss (MW)</th>
                <th className="py-2.5 text-right">Runtime</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-[#393939] text-xs">
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-slate-500 dark:text-[#A8A8A8]">
                    No historical log entries match your current filter.
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => (
                  <tr
                    key={log.id}
                    className="hover:bg-slate-50/80 dark:hover:bg-[#353535] transition-colors"
                  >
                    <td className="py-2.5 pr-4 font-mono text-slate-500 dark:text-[#A8A8A8] tabular-nums whitespace-nowrap">
                      {log.timestamp}
                    </td>
                    <td className="py-2.5 pr-4 font-medium text-slate-900 dark:text-[#F4F4F4] whitespace-nowrap">
                      {log.solver}
                    </td>
                    <td className="py-2.5 pr-4 text-slate-600 dark:text-[#C6C6C6] whitespace-nowrap">
                      {log.datasetName}
                    </td>
                    <td className="py-2.5 pr-4 whitespace-nowrap">
                      <StatusIndicator status={log.status} compact />
                    </td>
                    <td className="py-2.5 pr-4 text-right font-mono tabular-nums whitespace-nowrap text-slate-700 dark:text-[#C6C6C6]">
                      <span className="text-[#15803D] dark:text-[#42BE65]">{log.healthyCount}</span> /{' '}
                      <span className="text-[#B45309] dark:text-[#F1C21B]">{log.warningCount}</span> /{' '}
                      <span className="text-[#B91C1C] dark:text-[#FA4D56]">{log.alarmingCount}</span>
                    </td>
                    <td className="py-2.5 pr-4 text-right font-mono font-semibold text-[#0F62FE] dark:text-[#78A9FF] tabular-nums">
                      {log.quantumAccuracy.toFixed(1)}%
                    </td>
                    <td className="py-2.5 pr-4 text-right font-mono text-slate-600 dark:text-[#A8A8A8] tabular-nums">
                      {log.classicalAccuracy.toFixed(1)}%
                    </td>
                    <td className="py-2.5 pr-4 text-right font-mono text-slate-800 dark:text-[#E0E0E0] tabular-nums">
                      {log.totalLossMW.toFixed(1)}
                    </td>
                    <td className="py-2.5 text-right font-mono text-slate-600 dark:text-[#A8A8A8] tabular-nums whitespace-nowrap">
                      {log.runtimeMs} ms
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
