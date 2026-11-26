import { PulsingDot } from './components/PulsingDot';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Menu, Moon, Sun, Zap } from 'lucide-react';
import type {
  BackendRuntimeStatus,
  ClassicalAlgorithm,
  ClimateConditions,
  ConstraintId,
  ExploreRunResult,
  GridAlert,
  GridTopology,
  HistoricalLogEntry,
  KernelQARecord,
  LiveRegionStreamPayload,
  NavTab,
  QiskitBackend,
  QuantumAlgorithm,
  QuantumCircuitConfig,
} from './types/grid';
import {
  LIVE_REGIONS,
  NOMINAL_CLIMATE_CONDITIONS,
  OFFLINE_BACKEND_STATUS,
  PAGE_TITLES,
  THEME_STORAGE_KEY,
} from './constants';
import {
  ACCURACY_TIMELINE_DATA,
  CONSTRAINT_PERFORMANCE_ROWS,
  INITIAL_ALERTS,
  INITIAL_GRID_TOPOLOGY,
  INITIAL_HISTORICAL_LOGS,
  INITIAL_KERNEL_QA_RECORDS,
} from './data/seedData';
import {
  buildFallbackStreamPayload,
  buildTopologyFromLiveSlot,
  getLiveRegionById,
} from './data/liveRegions';
import {
  applyClimateFactors,
  computeGridSummary,
  injectGridFault,
  rerouteSingleNodeViaQuantum,
  simulateQuantumCircuit,
  updateNodeLoadStress,
} from './engine/quantumGridEngine';
import {
  executeBenchmarkJob,
  executeGridOptimizationJob,
  fetchBackendStatus,
  fetchLiveRegionStream,
  fetchLiveRuns,
} from './services/backendApi';
import { Sidebar } from './components/Sidebar';
import {
  ThemePageTurnOverlay,
  type ThemeTurnDirection,
} from './components/ThemePageTurnOverlay';
import { OverviewView } from './views/OverviewView';
import { DiagnosticsView } from './views/DiagnosticsView';
import { KernelsQAView } from './views/KernelsQAView';
import { ExploreLabView } from './views/ExploreLabView';
import { ImpactView } from './views/ImpactView';

const INITIAL_LIVE_REGION = LIVE_REGIONS[0];
const INITIAL_LIVE_PAYLOAD = buildFallbackStreamPayload(INITIAL_LIVE_REGION);
const INITIAL_LIVE_SNAPSHOT = buildTopologyFromLiveSlot(
  INITIAL_LIVE_REGION,
  INITIAL_LIVE_PAYLOAD,
  INITIAL_LIVE_PAYLOAD.currentSlotIndex
);

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('overview');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [isDark, setIsDark] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(THEME_STORAGE_KEY) === 'dark';
    } catch {
      return false;
    }
  });
  const [themeTurnDirection, setThemeTurnDirection] = useState<ThemeTurnDirection>('idle');
  const pendingThemeRef = useRef<boolean | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, isDark ? 'dark' : 'light');
    } catch {
      // Ignore storage failures in sandboxed contexts
    }
  }, [isDark]);

  const [selectedRegionId, setSelectedRegionId] = useState<string>(INITIAL_LIVE_REGION.id);
  const [liveStreamPayload, setLiveStreamPayload] = useState<LiveRegionStreamPayload | null>(
    INITIAL_LIVE_PAYLOAD
  );
  const [liveSlotIndex, setLiveSlotIndex] = useState<number>(INITIAL_LIVE_PAYLOAD.currentSlotIndex);
  const [isLiveStreaming, setIsLiveStreaming] = useState<boolean>(false);
  const [isLoadingRegion, setIsLoadingRegion] = useState<boolean>(false);
  const regionReqCounterRef = useRef(0);

  const [baseTopology, setBaseTopology] = useState<GridTopology>(INITIAL_LIVE_SNAPSHOT.topology);
  const [climate, setClimate] = useState<ClimateConditions>(INITIAL_LIVE_SNAPSHOT.climate);
  const [topology, setTopology] = useState<GridTopology>(INITIAL_LIVE_SNAPSHOT.topology);
  const [selectedNodeId, setSelectedNodeId] = useState<string>(
    INITIAL_LIVE_SNAPSHOT.topology.nodes[0]?.id ?? 'K01'
  );
  const [alerts, setAlerts] = useState<GridAlert[]>(
    INITIAL_LIVE_SNAPSHOT.alerts.length > 0 ? INITIAL_LIVE_SNAPSHOT.alerts : INITIAL_ALERTS
  );
  const [logs, setLogs] = useState<HistoricalLogEntry[]>(INITIAL_HISTORICAL_LOGS);
  const [qaRecords, setQaRecords] = useState<KernelQARecord[]>(INITIAL_KERNEL_QA_RECORDS);
  const [activeBackend, setActiveBackend] = useState<QiskitBackend>('aer_simulator (statevector)');
  const [lastOptimizationDelta, setLastOptimizationDelta] = useState<number | null>(null);
  const [faultCounter, setFaultCounter] = useState(1);

  const [circuitResult, setCircuitResult] = useState(() =>
    simulateQuantumCircuit({
      ansatz: 'QAOA',
      qubits: 6,
      layers: 2,
      shots: 4096,
      backend: 'aer_simulator (statevector)',
      enableNoise: false,
      seed: 2026,
    })
  );

  const [exploreHistory, setExploreHistory] = useState<ExploreRunResult[]>([]);
  const [latestExplore, setLatestExplore] = useState<ExploreRunResult | null>(null);
  const [backendStatus, setBackendStatus] = useState<BackendRuntimeStatus>(OFFLINE_BACKEND_STATUS);
  const [isJobWorking, setIsJobWorking] = useState(false);

  const loadLiveRegion = useCallback(async (regionId: string, forceRefresh: boolean) => {
    const region = getLiveRegionById(regionId);
    if (!region) return;

    const reqId = ++regionReqCounterRef.current;
    setIsLoadingRegion(true);

    try {
      const fetched = await fetchLiveRegionStream(regionId, forceRefresh);
      if (reqId !== regionReqCounterRef.current) return;
      const payload = fetched ?? buildFallbackStreamPayload(region);

      const snapshot = buildTopologyFromLiveSlot(region, payload, payload.currentSlotIndex);
      setLiveStreamPayload(payload);
      setLiveSlotIndex(payload.currentSlotIndex);
      setBaseTopology(snapshot.topology);
      setTopology(snapshot.topology);
      setClimate(snapshot.climate);
      setLastOptimizationDelta(null);
      setIsLiveStreaming(false);
      setAlerts(snapshot.alerts.length > 0 ? snapshot.alerts : INITIAL_ALERTS);
      setSelectedNodeId((prev) =>
        snapshot.topology.nodes.some((n) => n.id === prev)
          ? prev
          : snapshot.topology.nodes[0]?.id ?? 'K01'
      );

      const nextSummary = computeGridSummary(snapshot.topology.nodes, snapshot.topology.edges);
      setLogs((prev) => [
        {
          id: `log-live-${region.id}-${Date.now()}`,
          timestamp: new Date().toLocaleTimeString('en-US', { hour12: false }),
          iteration: (prev[0]?.iteration ?? 12) + 1,
          solver:
            payload.source === 'open_meteo_live'
              ? 'Open-Meteo Live 15m Feed'
              : 'Diurnal Climate Sync',
          datasetName: region.name,
          healthyCount: nextSummary.healthyCount,
          warningCount: nextSummary.warningCount,
          alarmingCount: nextSummary.alarmingCount,
          quantumAccuracy: 97.4,
          classicalAccuracy: 89.2,
          totalLossMW: nextSummary.totalLossMW,
          runtimeMs: 145,
          status:
            nextSummary.alarmingCount > 0
              ? 'alarming'
              : nextSummary.warningCount > 0
              ? 'warning'
              : 'healthy',
        },
        ...prev.slice(0, 29),
      ]);
    } finally {
      if (reqId === regionReqCounterRef.current) {
        setIsLoadingRegion(false);
      }
    }
  }, []);

  useEffect(() => {
    let active = true;
    const hydrateBackend = async () => {
      const [status, liveRuns] = await Promise.all([fetchBackendStatus(), fetchLiveRuns()]);
      if (!active) return;
      setBackendStatus(status);
      if (liveRuns.length > 0) {
        setExploreHistory((prev) => {
          const existingIds = new Set(prev.map((r) => r.id));
          const merged = [...liveRuns.filter((r) => !existingIds.has(r.id)), ...prev];
          return merged;
        });
        setLatestExplore((prev) => prev ?? liveRuns[0]);
      }
    };
    void hydrateBackend();
    void loadLiveRegion(INITIAL_LIVE_REGION.id, false);
    return () => {
      active = false;
    };
  }, [loadLiveRegion]);

  // 15-minute live telemetry stream player
  useEffect(() => {
    if (!isLiveStreaming || !liveStreamPayload || selectedRegionId === 'synthetic-ieee14') {
      return;
    }
    const region = getLiveRegionById(selectedRegionId);
    if (!region || liveStreamPayload.timestamps.length === 0) return;

    const timer = window.setInterval(() => {
      setLiveSlotIndex((prev) => {
        const nextSlot = (prev + 1) % liveStreamPayload.timestamps.length;
        const snapshot = buildTopologyFromLiveSlot(region, liveStreamPayload, nextSlot);
        setBaseTopology(snapshot.topology);
        setTopology(snapshot.topology);
        setClimate(snapshot.climate);
        if (snapshot.alerts.length > 0) {
          setAlerts(snapshot.alerts);
        }
        return nextSlot;
      });
    }, 1400);

    return () => window.clearInterval(timer);
  }, [isLiveStreaming, liveStreamPayload, selectedRegionId]);

  const summary = useMemo(
    () => computeGridSummary(topology.nodes, topology.edges),
    [topology]
  );

  const handleToggleTheme = useCallback(() => {
    if (themeTurnDirection !== 'idle') return;
    const nextDark = !isDark;
    const reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reducedMotion) {
      setIsDark(nextDark);
      return;
    }

    pendingThemeRef.current = nextDark;
    setThemeTurnDirection(nextDark ? 'closing' : 'opening');
  }, [isDark, themeTurnDirection]);

  const handleCommitThemeTurn = useCallback(() => {
    if (pendingThemeRef.current !== null) {
      setIsDark(pendingThemeRef.current);
      pendingThemeRef.current = null;
    }
  }, []);

  const handleCompleteThemeTurn = useCallback(() => {
    setThemeTurnDirection('idle');
  }, []);

  const handleSelectRegion = (regionId: string) => {
    setSelectedRegionId(regionId);
    if (regionId === 'synthetic-ieee14') {
      regionReqCounterRef.current += 1;
      setIsLoadingRegion(false);
      setIsLiveStreaming(false);
      setLiveStreamPayload(null);
      setBaseTopology(INITIAL_GRID_TOPOLOGY);
      setClimate(NOMINAL_CLIMATE_CONDITIONS);
      setTopology(INITIAL_GRID_TOPOLOGY);
      setAlerts(INITIAL_ALERTS);
      setLastOptimizationDelta(null);
      setSelectedNodeId('B05');
      return;
    }
    void loadLiveRegion(regionId, false);
  };

  const handleRefreshRegion = () => {
    if (selectedRegionId === 'synthetic-ieee14') return;
    void loadLiveRegion(selectedRegionId, true);
  };

  const handleSelectLiveSlot = (slotIndex: number) => {
    const region = getLiveRegionById(selectedRegionId);
    if (!region || !liveStreamPayload) return;
    const clamped = Math.max(0, Math.min(liveStreamPayload.timestamps.length - 1, slotIndex));
    setLiveSlotIndex(clamped);
    const snapshot = buildTopologyFromLiveSlot(region, liveStreamPayload, clamped);
    setBaseTopology(snapshot.topology);
    setTopology(snapshot.topology);
    setClimate(snapshot.climate);
    setLastOptimizationDelta(null);
    if (snapshot.alerts.length > 0) {
      setAlerts(snapshot.alerts);
    }
  };

  const handleToggleLiveStream = () => {
    if (selectedRegionId === 'synthetic-ieee14' || !liveStreamPayload) return;
    setIsLiveStreaming((prev) => !prev);
  };

  const handleSelectClimate = (nextClimate: ClimateConditions) => {
    setClimate(nextClimate);
    const adjusted = applyClimateFactors(baseTopology, nextClimate);
    setTopology(adjusted);
  };

  const handleInjectFault = () => {
    setIsLiveStreaming(false);
    const seed = 42 + faultCounter * 19;
    setFaultCounter((c) => c + 1);
    const { topology: nextTopo, alerts: newAlerts } = injectGridFault(topology, seed);
    const nextSummary = computeGridSummary(nextTopo.nodes, nextTopo.edges);
    setTopology(nextTopo);
    setAlerts((prev) => [...newAlerts, ...prev].slice(0, 24));
    setLogs((prev) => [
      {
        id: `log-fault-${Date.now()}`,
        timestamp: new Date().toLocaleTimeString('en-US', { hour12: false }),
        iteration: (prev[0]?.iteration ?? 12) + 1,
        solver: 'Unmitigated Fault Event',
        datasetName: nextTopo.name,
        healthyCount: nextSummary.healthyCount,
        warningCount: nextSummary.warningCount,
        alarmingCount: nextSummary.alarmingCount,
        quantumAccuracy: 96.4,
        classicalAccuracy: 85.2,
        totalLossMW: nextSummary.totalLossMW,
        runtimeMs: 412,
        status: nextSummary.alarmingCount > 0 ? 'alarming' : 'warning',
      },
      ...prev,
    ]);
  };

  const handleRunQuantumOptimize = async () => {
    setIsLiveStreaming(false);
    const seed = 100 + logs.length * 17;
    setIsJobWorking(true);
    setBackendStatus((prev) => ({
      ...prev,
      mode: 'working',
      activeJob: {
        jobId: `job-opt-${Date.now()}`,
        algorithm: 'QAOA p=3 Grid Dispatch',
        backend: activeBackend,
        startedAt: new Date().toISOString(),
        status: 'working',
      },
    }));

    try {
      const {
        topology: nextTopo,
        lossReductionPct,
        resolvedAlerts,
        status: nextStatus,
      } = await executeGridOptimizationJob({
        topology,
        backend: activeBackend,
        seed,
      });

      const nextSummary = computeGridSummary(nextTopo.nodes, nextTopo.edges);
      setTopology(nextTopo);
      setLastOptimizationDelta(lossReductionPct);
      setBackendStatus(nextStatus);

      if (resolvedAlerts.length > 0) {
        setAlerts((prev) => [...resolvedAlerts, ...prev].slice(0, 24));
      }

      setCircuitResult(
        simulateQuantumCircuit({
          ansatz: 'QAOA',
          qubits: Math.min(8, Math.max(4, Math.ceil(nextTopo.nodes.length / 2))),
          layers: 3,
          shots: 4096,
          backend: activeBackend,
          enableNoise: !activeBackend.includes('aer_simulator'),
          seed,
        })
      );

      setLogs((prev) => [
        {
          id: `log-opt-${Date.now()}`,
          timestamp: new Date().toLocaleTimeString('en-US', { hour12: false }),
          iteration: (prev[0]?.iteration ?? 12) + 1,
          solver: `QAOA p=3 (${activeBackend.split(' ')[0]})`,
          datasetName: nextTopo.name,
          healthyCount: nextSummary.healthyCount,
          warningCount: nextSummary.warningCount,
          alarmingCount: nextSummary.alarmingCount,
          quantumAccuracy: 97.6,
          classicalAccuracy: 89.8,
          totalLossMW: nextSummary.totalLossMW,
          runtimeMs: 328,
          status:
            nextSummary.alarmingCount > 0
              ? 'alarming'
              : nextSummary.warningCount > 0
              ? 'warning'
              : 'healthy',
        },
        ...prev,
      ]);
    } finally {
      setIsJobWorking(false);
    }
  };

  const handleResetGrid = () => {
    setIsLiveStreaming(false);
    const activeRegion = getLiveRegionById(selectedRegionId);
    if (activeRegion && liveStreamPayload) {
      const snapshot = buildTopologyFromLiveSlot(
        activeRegion,
        liveStreamPayload,
        liveStreamPayload.currentSlotIndex
      );
      setLiveSlotIndex(liveStreamPayload.currentSlotIndex);
      setBaseTopology(snapshot.topology);
      setTopology(snapshot.topology);
      setClimate(snapshot.climate);
      setAlerts(snapshot.alerts.length > 0 ? snapshot.alerts : INITIAL_ALERTS);
      setLastOptimizationDelta(null);
      setSelectedNodeId(snapshot.topology.nodes[0]?.id ?? 'K01');
      return;
    }

    setBaseTopology(INITIAL_GRID_TOPOLOGY);
    setClimate(NOMINAL_CLIMATE_CONDITIONS);
    setTopology(INITIAL_GRID_TOPOLOGY);
    setAlerts(INITIAL_ALERTS);
    setLastOptimizationDelta(null);
    setSelectedNodeId('B05');
  };

  const handleInspectNode = (nodeId: string) => {
    setSelectedNodeId(nodeId);
    setActiveTab('diagnostics');
  };

  const handleRerouteNode = (nodeId: string) => {
    const { topology: nextTopo, alert } = rerouteSingleNodeViaQuantum(topology, nodeId);
    setTopology(nextTopo);
    if (alert) {
      setAlerts((prev) => [alert, ...prev].slice(0, 24));
    }
  };

  const handleAdjustNodeStress = (nodeId: string, utilizationPct: number) => {
    setTopology((prev) => updateNodeLoadStress(prev, nodeId, utilizationPct));
  };

  const handleExecuteCircuit = (config: QuantumCircuitConfig) => {
    const nextRes = simulateQuantumCircuit(config);
    setCircuitResult(nextRes);
    const qaStatus =
      nextRes.fidelity >= 0.9 ? 'pass' : nextRes.fidelity >= 0.82 ? 'warning' : 'fail';
    const newRec: KernelQARecord = {
      id: `qa-sim-${Date.now()}`,
      runId: `QFF-2026-0${qaRecords.length + 34}`,
      timestamp: new Date().toLocaleTimeString('en-US', { hour12: false }),
      modelName: `${config.ansatz} (q=${config.qubits}, p=${config.layers})`,
      solverType: 'quantum',
      kernelOrAnsatz: `${config.backend.split(' ')[0]} · ${config.shots} shots`,
      datasetName: topology.name,
      iteration: 7,
      qaStatus,
      kernelAlignment: Number(Math.min(0.99, nextRes.fidelity * 0.995).toFixed(3)),
      accuracyPct: Number((nextRes.approximationRatio * 100).toFixed(1)),
      lossReductionPct: Number((14 + config.layers * 1.9).toFixed(1)),
      shotVariance: Number((1 / Math.sqrt(config.shots)).toFixed(4)),
      gateCount: nextRes.gates.length,
      runtimeMs: nextRes.executionMs,
    };
    setQaRecords((prev) => [newRec, ...prev]);
  };

  const handleRunExploreBenchmark = async (params: {
    topology: GridTopology;
    quantumAlgorithm: QuantumAlgorithm;
    classicalAlgorithm: ClassicalAlgorithm;
    backend: QiskitBackend;
    shots: number;
    constraints: ConstraintId[];
    climate: ClimateConditions;
    partitionQubits: number;
  }) => {
    setIsJobWorking(true);
    setBackendStatus((prev) => ({
      ...prev,
      mode: 'working',
      activeJob: {
        jobId: `job-exp-${Date.now()}`,
        algorithm: params.quantumAlgorithm,
        backend: params.backend,
        startedAt: new Date().toISOString(),
        status: 'working',
      },
    }));

    try {
      const { result, status: nextStatus } = await executeBenchmarkJob(params);
      setBackendStatus(nextStatus);
      setLatestExplore(result);
      setExploreHistory((prev) => [result, ...prev]);
      setCircuitResult(result.circuitResult);

      const newQa: KernelQARecord = {
        id: `qa-exp-${Date.now()}`,
        runId: `QFF-EXP-${exploreHistory.length + 101}`,
        timestamp: result.timestamp,
        modelName: `${result.quantumAlgorithm} (${result.datasetName.slice(0, 14)})`,
        solverType: 'quantum',
        kernelOrAnsatz: `${result.backend.split(' ')[0]} · ${result.shots} shots`,
        datasetName: result.datasetName,
        iteration: 7,
        qaStatus: result.quantumMetrics.accuracyPct >= 93 ? 'pass' : 'warning',
        kernelAlignment: Number(Math.min(0.985, result.circuitResult.fidelity * 0.99).toFixed(3)),
        accuracyPct: result.quantumMetrics.accuracyPct,
        lossReductionPct: Number(
          (
            ((result.classicalMetrics.lossMW - result.quantumMetrics.lossMW) /
              Math.max(1, result.classicalMetrics.lossMW)) *
            100
          ).toFixed(1)
        ),
        shotVariance: Number((1 / Math.sqrt(result.shots)).toFixed(4)),
        gateCount: result.circuitResult.gates.length,
        runtimeMs: result.quantumMetrics.runtimeMs,
      };
      setQaRecords((prev) => [newQa, ...prev]);

      const expSummary = computeGridSummary(result.topology.nodes, result.topology.edges);
      setLogs((prev) => [
        {
          id: `log-exp-${Date.now()}`,
          timestamp: result.timestamp,
          iteration: (prev[0]?.iteration ?? 12) + 1,
          solver: `${result.quantumAlgorithm} vs ${result.classicalAlgorithm}`,
          datasetName: result.datasetName,
          healthyCount: expSummary.healthyCount,
          warningCount: expSummary.warningCount,
          alarmingCount: expSummary.alarmingCount,
          quantumAccuracy: result.quantumMetrics.accuracyPct,
          classicalAccuracy: result.classicalMetrics.accuracyPct,
          totalLossMW: result.quantumMetrics.lossMW,
          runtimeMs: result.quantumMetrics.runtimeMs,
          status:
            expSummary.alarmingCount > 0
              ? 'alarming'
              : expSummary.warningCount > 0
              ? 'warning'
              : 'healthy',
        },
        ...prev,
      ]);
    } finally {
      setIsJobWorking(false);
    }
  };

  const handleLoadIntoLiveMonitor = (nextTopo: GridTopology) => {
    regionReqCounterRef.current += 1;
    setIsLiveStreaming(false);
    setIsLoadingRegion(false);
    setSelectedRegionId('synthetic-ieee14');
    setLiveStreamPayload(null);
    setBaseTopology(nextTopo);
    setTopology(nextTopo);
    setSelectedNodeId(nextTopo.nodes[0]?.id ?? 'B01');
    setActiveTab('overview');
  };

  const pageMeta = PAGE_TITLES[activeTab];

  const headerStatusMeta =
    backendStatus.mode === 'working'
      ? {
          label: 'Working on Job',
          dotClass: 'bg-[#F1C21B]',
          textClass: 'text-amber-700 dark:text-[#F1C21B]',
        }
      : backendStatus.mode === 'ibm_quantum_live'
      ? {
          label: 'IBM Quantum Live',
          dotClass: 'bg-[#42BE65]',
          textClass: 'text-[#15803D] dark:text-[#42BE65]',
        }
      : backendStatus.mode === 'ibm_simulator'
      ? {
          label: 'IBM Simulator',
          dotClass: 'bg-[#0F62FE] dark:bg-[#78A9FF]',
          textClass: 'text-[#0F62FE] dark:text-[#78A9FF]',
        }
      : {
          label: 'Offline Mode',
          dotClass: 'bg-slate-400 dark:bg-[#8D8D8D]',
          textClass: 'text-slate-600 dark:text-[#A8A8A8]',
        };

  return (
    <div className="min-h-screen flex bg-[#F8FAFC] dark:bg-[#161616] text-slate-900 dark:text-[#F4F4F4] transition-colors">
      <Sidebar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        summary={summary}
        activeBackend={activeBackend}
        onBackendChange={setActiveBackend}
        backendStatus={backendStatus}
        isDark={isDark}
        onToggleTheme={handleToggleTheme}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Clean Contextual Top Bar (IBM Carbon UI Shell #161616) */}
        <header className="sticky top-0 z-30 h-16 border-b border-slate-200 dark:border-[#393939] bg-white/95 dark:bg-[#161616]/95 backdrop-blur-xs px-4 sm:px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
              className="lg:hidden rounded-md p-2 text-slate-600 dark:text-[#C6C6C6] hover:bg-slate-100 dark:hover:bg-[#262626] hover:text-slate-900 dark:hover:text-[#F4F4F4]"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <div className="text-[11px] font-medium text-slate-500 dark:text-[#A8A8A8] truncate">
                {pageMeta.breadcrumb}
              </div>
              <h1 className="text-base sm:text-lg font-semibold text-slate-900 dark:text-[#F4F4F4] leading-tight truncate" title={pageMeta.title}>
                {pageMeta.title}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <div
              data-testid="header-engine-status"
              className="hidden md:inline-flex items-center gap-1.5 rounded-md border border-slate-200 dark:border-[#525252] bg-slate-50 dark:bg-[#262626] px-2.5 py-1.5 text-[11px] font-medium whitespace-nowrap"
            >
              {backendStatus.mode === 'ibm_quantum_live' ? (
                <PulsingDot variant="green" />
              ) : (
                <span className={`h-2 w-2 rounded-full ${headerStatusMeta.dotClass}`} aria-hidden="true" />
              )}
              <span className={headerStatusMeta.textClass}>{headerStatusMeta.label}</span>
            </div>
            <div className="hidden min-[1700px]:flex items-center gap-2 text-xs text-slate-500 dark:text-[#A8A8A8] whitespace-nowrap">
              <span>{topology.name}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono text-slate-700 dark:text-[#E0E0E0]">{activeBackend}</span>
            </div>
            <button
              type="button"
              onClick={handleToggleTheme}
              aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
              title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
              className="inline-flex items-center justify-center rounded-md border border-slate-300 dark:border-[#525252] bg-white dark:bg-[#262626] p-2 text-slate-700 dark:text-[#F4F4F4] hover:bg-slate-100 dark:hover:bg-[#353535] transition-colors shrink-0"
            >
              {isDark ? (
                <Sun className="h-4 w-4 text-[#F1C21B]" aria-hidden="true" />
              ) : (
                <Moon className="h-4 w-4 text-slate-600" aria-hidden="true" />
              )}
            </button>
            <button
              type="button"
              disabled={isJobWorking}
              onClick={() => void handleRunQuantumOptimize()}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#0F62FE] px-3.5 py-2 text-xs font-medium text-white hover:bg-[#0353E9] disabled:opacity-60 transition-colors whitespace-nowrap shrink-0"
            >
              <Zap className="h-3.5 w-3.5" aria-hidden="true" />
              {isJobWorking ? 'Working...' : 'Optimize Grid'}
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 max-w-[1600px] w-full mx-auto">
          {activeTab === 'overview' && (
            <OverviewView
              topology={topology}
              summary={summary}
              alerts={alerts}
              logs={logs}
              activeBackend={activeBackend}
              climate={climate}
              onSelectClimate={handleSelectClimate}
              selectedRegionId={selectedRegionId}
              liveStreamPayload={liveStreamPayload}
              liveSlotIndex={liveSlotIndex}
              isLiveStreaming={isLiveStreaming}
              isLoadingRegion={isLoadingRegion}
              onSelectRegion={handleSelectRegion}
              onRefreshRegion={handleRefreshRegion}
              onSelectLiveSlot={handleSelectLiveSlot}
              onToggleLiveStream={handleToggleLiveStream}
              isDark={isDark}
              lastOptimizationDelta={lastOptimizationDelta}
              onInjectFault={handleInjectFault}
              onRunQuantumOptimize={() => void handleRunQuantumOptimize()}
              onResetGrid={handleResetGrid}
              onInspectNode={handleInspectNode}
            />
          )}

          {activeTab === 'diagnostics' && (
            <DiagnosticsView
              topology={topology}
              selectedNodeId={selectedNodeId}
              isDark={isDark}
              onSelectNode={setSelectedNodeId}
              onRerouteNode={handleRerouteNode}
              onAdjustNodeStress={handleAdjustNodeStress}
            />
          )}

          {activeTab === 'kernels' && (
            <KernelsQAView
              activeBackend={activeBackend}
              circuitResult={circuitResult}
              qaRecords={qaRecords}
              isDark={isDark}
              onExecuteCircuit={handleExecuteCircuit}
            />
          )}

          {activeTab === 'explore' && (
            <ExploreLabView
              activeBackend={activeBackend}
              onBackendChange={setActiveBackend}
              latestResult={latestExplore}
              runHistory={exploreHistory}
              backendStatus={backendStatus}
              isJobWorking={isJobWorking}
              isDark={isDark}
              climate={climate}
              onRunExploreBenchmark={handleRunExploreBenchmark}
              onLoadIntoLiveMonitor={handleLoadIntoLiveMonitor}
            />
          )}

          {activeTab === 'impact' && (
            <ImpactView
              timeline={ACCURACY_TIMELINE_DATA}
              constraintRows={CONSTRAINT_PERFORMANCE_ROWS}
              topology={topology}
              climate={climate}
              activeBackend={activeBackend}
              latestExplore={latestExplore}
              isDark={isDark}
            />
          )}
        </main>
      </div>

      <ThemePageTurnOverlay
        direction={themeTurnDirection}
        onCommitTheme={handleCommitThemeTurn}
        onComplete={handleCompleteThemeTurn}
      />
    </div>
  );
}
