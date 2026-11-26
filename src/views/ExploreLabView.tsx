import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertCircle,
  BarChart3,
  Check,
  CheckCircle2,
  Copy,
  Cpu,
  Download,
  Grid3X3,
  Layers,
  Network,
  Pause,
  Play,
  Server,
  Upload,
} from 'lucide-react';
import type {
  BackendRuntimeStatus,
  ClassicalAlgorithm,
  ClassicalOptimizer,
  ClimateConditions,
  ConstraintId,
  CouplingTopology,
  ExploreRunResult,
  GridTopology,
  HardwareCapabilities,
  PathViewMode,
  QiskitBackend,
  QiskitJobExecutionResult,
  QiskitPubExecutionResult,
  QiskitRuntimeCapabilities,
  QuboSuiteResult,
  QuantumAlgorithm,
  SolverBenchmarkEntry,
} from '../types/grid';
import {
  ANSATZ_LAYER_OPTIONS,
  CLASSICAL_OPTIMIZERS,
  CONSTRAINT_CATALOG,
  CORE_CLASSICAL_BASELINES,
  EXPLORE_QUANTUM_ALGORITHMS,
  IBM_HARDWARE_PROFILES,
  NODE_QUICK_PRESETS,
  QISKIT_BACKENDS,
  SHOT_OPTIONS,
} from '../constants';
import {
  PRESET_TOPOLOGIES,
  SAMPLE_CSV_TEMPLATE,
} from '../data/seedData';
import {
  applyClimateFactors,
  buildSampleMicrogridWorkbookBytes,
  parseUploadedDataset,
  parseUploadedWorkbook,
  runExploreComparison,
  summarizeDatasetCapabilities,
} from '../engine/quantumGridEngine';
import {
  generateMicrogridTopology,
  runAllSolversSuite,
} from '../engine/quboSolverEngine';
import {
  executeQuboSolverSuite,
  fetchQiskitCapabilities,
  pollRealQiskitJob,
  submitBatchRealQiskitJob,
  submitRealQiskitJob,
} from '../services/backendApi';
import { D3GridVisualizer } from '../components/D3GridVisualizer';

interface ExploreLabViewProps {
  activeBackend: QiskitBackend;
  onBackendChange: (backend: QiskitBackend) => void;
  latestResult: ExploreRunResult | null;
  runHistory: ExploreRunResult[];
  backendStatus: BackendRuntimeStatus;
  isJobWorking: boolean;
  isDark: boolean;
  climate: ClimateConditions;
  onRunExploreBenchmark: (params: {
    topology: GridTopology;
    quantumAlgorithm: QuantumAlgorithm;
    classicalAlgorithm: ClassicalAlgorithm;
    backend: QiskitBackend;
    shots: number;
    constraints: ConstraintId[];
    climate: ClimateConditions;
    partitionQubits: number;
  }) => Promise<void> | void;
  onLoadIntoLiveMonitor: (topology: GridTopology) => void;
}

export function ExploreLabView({
  activeBackend,
  onBackendChange,
  latestResult,
  runHistory,
  backendStatus,
  isJobWorking,
  isDark,
  climate,
  onRunExploreBenchmark,
  onLoadIntoLiveMonitor,
}: ExploreLabViewProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Microgrid scale (6-12 core challenge up to 50 max nodes) & graph density
  const [customNodeCount, setCustomNodeCount] = useState<number>(12);
  const [targetDensity, setTargetDensity] = useState<number>(0.35);
  const [selectedTopology, setSelectedTopology] = useState<GridTopology>(() =>
    generateMicrogridTopology(12, 0.35, climate)
  );

  // Solver & QAOA tuning parameters
  const [quantumAlgorithm, setQuantumAlgorithm] = useState<QuantumAlgorithm>('CVaR-QAOA');
  const [classicalAlgorithm, setClassicalAlgorithm] = useState<ClassicalAlgorithm>('Simulated Annealing');
  const [layersP, setLayersP] = useState<number>(3);
  const [optimizer, setOptimizer] = useState<ClassicalOptimizer>('COBYLA');
  const [shots, setShots] = useState<number>(4096);
  const [constraints, setConstraints] = useState<ConstraintId[]>([
    'thermal_limits',
    'voltage_stability',
    'renewable_intermittency',
  ]);

  // Editable IBM Simulator / QPU Hardware Capabilities
  const [hardware, setHardware] = useState<HardwareCapabilities>(
    () => IBM_HARDWARE_PROFILES[activeBackend]
  );

  useEffect(() => {
    setHardware(IBM_HARDWARE_PROFILES[activeBackend]);
  }, [activeBackend]);

  // Studio tabs & interaction state
  const [studioTab, setStudioTab] = useState<'solvers' | 'qubo' | 'convergence' | 'simulation'>('solvers');
  const [simCompareMode, setSimCompareMode] = useState<'after' | 'before' | 'diff'>('after');
  const [simAnimateFlow, setSimAnimateFlow] = useState(true);
  const [simSelectedNodeId, setSimSelectedNodeId] = useState<string | null>(null);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pastedText, setPastedText] = useState(SAMPLE_CSV_TEMPLATE);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccessMsg, setUploadSuccessMsg] = useState<string | null>(null);

  const [isRunningSuite, setIsRunningSuite] = useState(false);
  const [liveSuiteResult, setLiveSuiteResult] = useState<QuboSuiteResult | null>(null);
  const [suiteSourceLabel, setSuiteSourceLabel] = useState<'API Statevector' | 'Local Statevector'>('Local Statevector');

  const [qiskitCaps, setQiskitCaps] = useState<QiskitRuntimeCapabilities | null>(null);
  const [selectedLiveIbmBackend, setSelectedLiveIbmBackend] = useState<string>('');
  const [isExecutingQiskit, setIsExecutingQiskit] = useState(false);
  const [isExecutingBatchQiskit, setIsExecutingBatchQiskit] = useState(false);
  const [isPollingQiskit, setIsPollingQiskit] = useState(false);
  const [qiskitJobResult, setQiskitJobResult] = useState<QiskitJobExecutionResult | null>(null);
  const [qiskitJobError, setQiskitJobError] = useState<string | null>(null);
  const [showOpenQasm, setShowOpenQasm] = useState(false);
  const [selectedPubQasmIdx, setSelectedPubQasmIdx] = useState<number>(0);
  const [qpuOverlay, setQpuOverlay] = useState<{
    topologyKey: string;
    jobId: string;
    backendName: string;
    byAlgorithm: Partial<Record<QuantumAlgorithm, QiskitPubExecutionResult>>;
  } | null>(null);

  const [copiedCode, setCopiedCode] = useState(false);

  const currentTopologyKey = `${selectedTopology.id}:${selectedTopology.nodes.length}:${selectedTopology.edges.length}`;

  useEffect(() => {
    let active = true;
    const probe = async () => {
      const caps = await fetchQiskitCapabilities();
      if (active && caps) {
        setQiskitCaps(caps);
        if (caps.liveBackends.length > 0) {
          setSelectedLiveIbmBackend((prev) =>
            prev && caps.liveBackends.some((b) => b.name === prev)
              ? prev
              : caps.liveBackends[0].name
          );
        }
      }
    };
    void probe();
    return () => {
      active = false;
    };
  }, []);

  const applyCompletedQiskitJobToOverlay = (job: QiskitJobExecutionResult, topologyKey: string) => {
    if (job.status !== 'COMPLETED') return;
    const byAlgorithm: Partial<Record<QuantumAlgorithm, QiskitPubExecutionResult>> = {};
    if (job.pubResults && job.pubResults.length > 0) {
      for (const pub of job.pubResults) {
        if (pub.optimalBitstring) {
          byAlgorithm[pub.algorithm] = pub;
        }
      }
    } else if (job.optimalBitstring) {
      byAlgorithm[job.algorithm] = {
        pubIndex: 0,
        algorithm: job.algorithm,
        layersP: job.layersP,
        transpiledDepth: job.transpiledDepth,
        twoQubitGateCount: job.twoQubitGateCount,
        openQasm3: job.openQasm3,
        optimalBitstring: job.optimalBitstring,
        achievedQuboEnergy: job.achievedQuboEnergy,
        expectationQuboEnergy: job.expectationQuboEnergy,
        approxRatio: job.approxRatio,
        fidelityPct: job.fidelityPct,
        demandMetPct: job.demandMetPct,
        renewableUtilPct: job.renewableUtilPct,
        lossMW: job.lossMW,
        costSavedDailyUsd: job.costSavedDailyUsd,
        costSavedPct: job.costSavedPct,
        topBitstrings: job.topBitstrings,
      };
    }
    if (Object.keys(byAlgorithm).length > 0) {
      setQpuOverlay({
        topologyKey,
        jobId: job.jobId,
        backendName: job.backendName,
        byAlgorithm,
      });
    }
  };

  // Auto-poll IBM Quantum job status every 4s while QUEUED or RUNNING
  useEffect(() => {
    if (
      !qiskitJobResult ||
      (qiskitJobResult.status !== 'QUEUED' && qiskitJobResult.status !== 'RUNNING')
    ) {
      return;
    }
    let cancelled = false;
    const timer = setInterval(async () => {
      if (cancelled) return;
      const res = await pollRealQiskitJob(qiskitJobResult.jobId);
      if (cancelled) return;
      if (res.ok) {
        setQiskitJobResult(res.job);
        if (res.job.status === 'COMPLETED') {
          applyCompletedQiskitJobToOverlay(res.job, currentTopologyKey);
        }
      }
    }, 4000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [qiskitJobResult?.jobId, qiskitJobResult?.status, currentTopologyKey]);

  const previewSuite = useMemo(
    () =>
      runAllSolversSuite({
        topology: selectedTopology,
        climate,
        constraints,
        hardware,
        layersP,
        optimizer,
        shots,
        selectedAlgorithm: quantumAlgorithm,
      }),
    [selectedTopology, climate, constraints, hardware, layersP, optimizer, shots, quantumAlgorithm]
  );

  const isLiveSuiteCurrent =
    liveSuiteResult !== null &&
    liveSuiteResult.nodeCount === selectedTopology.nodes.length &&
    liveSuiteResult.edgeCount === selectedTopology.edges.length &&
    liveSuiteResult.layersP === layersP &&
    liveSuiteResult.optimizer === optimizer &&
    liveSuiteResult.shots === shots &&
    liveSuiteResult.hardware.backendId === hardware.backendId &&
    liveSuiteResult.hardware.maxQubits === hardware.maxQubits &&
    liveSuiteResult.hardware.twoQubitErrorRate === hardware.twoQubitErrorRate &&
    liveSuiteResult.hardware.couplingTopology === hardware.couplingTopology;

  const activeSuite = isLiveSuiteCurrent ? liveSuiteResult : previewSuite;

  const climatePreviewTopology = useMemo(
    () => applyClimateFactors(selectedTopology, climate),
    [selectedTopology, climate]
  );

  const livePreviewRun = useMemo(
    () =>
      runExploreComparison({
        topology: selectedTopology,
        quantumAlgorithm,
        classicalAlgorithm,
        backend: activeBackend,
        shots,
        constraints,
        climate,
        partitionQubits: Math.min(12, Math.max(4, Math.min(hardware.maxQubits, selectedTopology.nodes.length))),
      }),
    [selectedTopology, quantumAlgorithm, classicalAlgorithm, activeBackend, shots, constraints, climate, hardware.maxQubits]
  );

  const activeRun =
    latestResult &&
    latestResult.datasetName === selectedTopology.name &&
    latestResult.quantumAlgorithm === quantumAlgorithm
      ? latestResult
      : livePreviewRun;

  const activeQpuOverlay =
    qpuOverlay && qpuOverlay.topologyKey === currentTopologyKey ? qpuOverlay : null;

  const displayBenchmarks: SolverBenchmarkEntry[] = useMemo(() => {
    if (!activeQpuOverlay) return activeSuite.benchmarks;
    const merged = activeSuite.benchmarks.map((row) => {
      const hw = activeQpuOverlay.byAlgorithm[row.algorithm as QuantumAlgorithm];
      if (!hw || !hw.optimalBitstring) return row;
      return {
        ...row,
        approxRatio: hw.approxRatio ?? row.approxRatio,
        achievedEnergy: hw.achievedQuboEnergy ?? row.achievedEnergy,
        expectationEnergy: hw.expectationQuboEnergy ?? row.expectationEnergy,
        executionMode: 'ibm_qpu_hardware' as const,
        qiskitJobId: activeQpuOverlay.jobId,
        qiskitBackendName: activeQpuOverlay.backendName,
        demandMetPct: hw.demandMetPct ?? row.demandMetPct,
        renewableUtilPct: hw.renewableUtilPct ?? row.renewableUtilPct,
        costSavedDailyUsd: hw.costSavedDailyUsd ?? row.costSavedDailyUsd,
        costSavedPct: hw.costSavedPct ?? row.costSavedPct,
        lossMW: hw.lossMW ?? row.lossMW,
        circuitDepth: hw.transpiledDepth > 0 ? hw.transpiledDepth : row.circuitDepth,
        twoQubitGates: hw.twoQubitGateCount > 0 ? hw.twoQubitGateCount : row.twoQubitGates,
        fidelityPct: hw.fidelityPct ?? row.fidelityPct,
        optimalBitstring: hw.optimalBitstring,
        notes: `Executed on real IBM QPU (${activeQpuOverlay.backendName} · Job ${activeQpuOverlay.jobId} · PUB #${hw.pubIndex + 1}, p=${hw.layersP}, ${hw.twoQubitGateCount} 2Q gates)`,
      };
    });
    return merged.sort((a, b) => b.approxRatio - a.approxRatio);
  }, [activeSuite.benchmarks, activeQpuOverlay]);

  const qpuOverlayCount = activeQpuOverlay ? Object.keys(activeQpuOverlay.byAlgorithm).length : 0;

  const selectedSolverRow = useMemo(() => {
    const direct = displayBenchmarks.find((b) => b.algorithm === quantumAlgorithm);
    return direct ?? displayBenchmarks[0];
  }, [displayBenchmarks, quantumAlgorithm]);

  const greedyRow = useMemo(
    () => displayBenchmarks.find((b) => b.algorithm === 'Greedy Dispatch'),
    [displayBenchmarks]
  );

  const saRow = useMemo(
    () => displayBenchmarks.find((b) => b.algorithm === 'Simulated Annealing'),
    [displayBenchmarks]
  );

  const handleGenerateMicrogrid = (nodes: number, density: number) => {
    setUploadError(null);
    const nextTopo = generateMicrogridTopology(nodes, density, climate);
    setCustomNodeCount(nodes);
    setTargetDensity(density);
    setSelectedTopology(nextTopo);
    setUploadSuccessMsg(
      `Generated ${nextTopo.nodes.length}-node rural microgrid (${nextTopo.edges.length} feeders, density ρ=${density.toFixed(2)}).`
    );
  };

  const formatUploadSummary = (topology: GridTopology, warnings: string[]) => {
    const cap = summarizeDatasetCapabilities(topology);
    const features: string[] = [];
    if (cap.hasAssetTypes) features.push('asset types');
    if (cap.hasGeoCoords) features.push('lat/lon 3D geo');
    if (cap.hasRenewableTelemetry) features.push('solar/wind');
    if (cap.hasBatteryStorage) features.push('battery SoC');
    if (cap.hasEconomicTariffs) features.push('$/MWh tariffs');
    if (cap.hasPriorityWeights) features.push('load priority');
    if (cap.hasEdgeImpedance) features.push('R/X impedance');
    if (cap.zoneCount > 1) features.push(`${cap.zoneCount} zones`);
    if (cap.timestampCount > 1) features.push(`${cap.timestampCount} time slots`);

    const featureText = features.length > 0 ? ` · Detected: ${features.join(', ')}` : '';
    const warnText = warnings.length > 0 ? ` (${warnings[0]})` : '';
    return `Loaded "${topology.name}" (${topology.nodes.length} nodes, ${topology.edges.length} feeders)${featureText}${warnText}.`;
  };

  const handleFileSelected = async (file: File) => {
    setUploadError(null);
    setUploadSuccessMsg(null);
    const lowerName = file.name.toLowerCase();
    const isExcel = lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls');

    const parsed = isExcel
      ? parseUploadedWorkbook(await file.arrayBuffer(), file.name)
      : parseUploadedDataset(await file.text(), file.name);

    if (!parsed.ok) {
      setUploadError(parsed.error);
      return;
    }
    setSelectedTopology(parsed.topology);
    setCustomNodeCount(Math.max(6, Math.min(50, parsed.topology.nodes.length)));
    setUploadSuccessMsg(formatUploadSummary(parsed.topology, parsed.warnings));
  };

  const handleParsePasted = () => {
    setUploadError(null);
    setUploadSuccessMsg(null);
    const parsed = parseUploadedDataset(pastedText, 'custom_microgrid.csv');
    if (!parsed.ok) {
      setUploadError(parsed.error);
      return;
    }
    setSelectedTopology(parsed.topology);
    setCustomNodeCount(Math.max(6, Math.min(50, parsed.topology.nodes.length)));
    setUploadSuccessMsg(formatUploadSummary(parsed.topology, parsed.warnings));
    setPasteOpen(false);
  };

  const handleDownloadSample = () => {
    const blob = new Blob([SAMPLE_CSV_TEMPLATE], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'rural_microgrid_extended_sample.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadSampleExcel = () => {
    const bytes = buildSampleMicrogridWorkbookBytes();
    const blob = new Blob([bytes.buffer as ArrayBuffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'rural_microgrid_multi_sheet_template.xlsx';
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleConstraint = (id: ConstraintId) => {
    setConstraints((prev) =>
      prev.includes(id) ? (prev.length > 1 ? prev.filter((c) => c !== id) : prev) : [...prev, id]
    );
  };

  const handleRunAllSolvers = async () => {
    setIsRunningSuite(true);
    try {
      const [{ suite, source }] = await Promise.all([
        executeQuboSolverSuite({
          topology: selectedTopology,
          climate,
          constraints,
          backend: activeBackend,
          hardware,
          layersP,
          optimizer,
          shots,
          selectedAlgorithm: quantumAlgorithm,
        }),
        Promise.resolve(
          onRunExploreBenchmark({
            topology: selectedTopology,
            quantumAlgorithm,
            classicalAlgorithm,
            backend: activeBackend,
            shots,
            constraints,
            climate,
            partitionQubits: Math.min(12, Math.max(4, Math.min(hardware.maxQubits, selectedTopology.nodes.length))),
          })
        ),
      ]);
      setLiveSuiteResult(suite);
      setSuiteSourceLabel(source === 'ibm_simulator_api' ? 'API Statevector' : 'Local Statevector');
    } finally {
      setIsRunningSuite(false);
    }
  };

  const handleExecuteRealQiskit = async () => {
    setIsExecutingQiskit(true);
    setQiskitJobError(null);
    setSelectedPubQasmIdx(0);
    try {
      const res = await submitRealQiskitJob({
        topology: selectedTopology,
        climate,
        constraints,
        backend: activeBackend,
        targetBackendName: selectedLiveIbmBackend || undefined,
        algorithm: quantumAlgorithm,
        optimizer,
        layersP,
        shots,
      });
      if (!res.ok) {
        setQiskitJobError(res.error);
        if (res.capabilities) setQiskitCaps(res.capabilities);
        return;
      }
      setQiskitJobResult(res.job);
      if (res.job.status === 'COMPLETED') {
        applyCompletedQiskitJobToOverlay(res.job, currentTopologyKey);
      }
    } finally {
      setIsExecutingQiskit(false);
    }
  };

  const handleExecuteBatchRealQiskit = async () => {
    setIsExecutingBatchQiskit(true);
    setQiskitJobError(null);
    setSelectedPubQasmIdx(0);
    try {
      const res = await submitBatchRealQiskitJob({
        topology: selectedTopology,
        climate,
        constraints,
        backend: activeBackend,
        targetBackendName: selectedLiveIbmBackend || undefined,
        layersP,
        shots,
      });
      if (!res.ok) {
        setQiskitJobError(res.error);
        if (res.capabilities) setQiskitCaps(res.capabilities);
        return;
      }
      setQiskitJobResult(res.job);
      if (res.job.status === 'COMPLETED') {
        applyCompletedQiskitJobToOverlay(res.job, currentTopologyKey);
      }
    } finally {
      setIsExecutingBatchQiskit(false);
    }
  };

  const handlePollQiskitJob = async () => {
    if (!qiskitJobResult) return;
    setIsPollingQiskit(true);
    setQiskitJobError(null);
    try {
      const res = await pollRealQiskitJob(qiskitJobResult.jobId);
      if (!res.ok) {
        setQiskitJobError(res.error);
        return;
      }
      setQiskitJobResult(res.job);
      if (res.job.status === 'COMPLETED') {
        applyCompletedQiskitJobToOverlay(res.job, currentTopologyKey);
      }
    } finally {
      setIsPollingQiskit(false);
    }
  };

  const handleCopyCode = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 1800);
    } catch {
      setCopiedCode(false);
    }
  };

  const simTopology = simCompareMode === 'before' ? climatePreviewTopology : activeRun.topology;
  const simPathMode: PathViewMode =
    simCompareMode === 'before' ? 'classical' : simCompareMode === 'diff' ? 'diff' : 'quantum';

  // Color scale for QUBO Matrix Heatmap cells
  const maxAbsQ = useMemo(() => {
    let maxVal = 1;
    for (const row of activeSuite.qubo.matrix) {
      for (const v of row) {
        if (Math.abs(v) > maxVal) maxVal = Math.abs(v);
      }
    }
    return maxVal;
  }, [activeSuite.qubo.matrix]);

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* LEFT PANEL: 6–50 Node Microgrid Sizing, QAOA/9-Solver Config & IBM Hardware Capabilities */}
        <div className="xl:col-span-5 rounded-md border border-slate-200 dark:border-[#393939] bg-white dark:bg-[#262626] p-5 space-y-5">
          <div className="pb-3 border-b border-slate-200 dark:border-[#393939]">
            <h2 className="text-base font-semibold text-slate-900 dark:text-[#F4F4F4]">
              Rural Microgrid QUBO & IBM Simulator Lab
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-[#A8A8A8]">
              Formulate 6–12 node rural microgrid load balancing (scalable to 50 nodes) as a QUBO and benchmark all 9 quantum/Ising solvers with IBM hardware capabilities.
            </p>
          </div>

          {/* 1. Microgrid Scale (6–50 Nodes) & Graph Density */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-[#C6C6C6]">
                <Network className="h-3.5 w-3.5 text-[#0F62FE] dark:text-[#78A9FF]" aria-hidden="true" />
                Microgrid Scale (6–50 Nodes) & Density
              </span>
              <span className="font-mono text-[11px] font-semibold text-slate-900 dark:text-[#F4F4F4] tabular-nums">
                {selectedTopology.nodes.length}N · {selectedTopology.edges.length}E · ρ={activeSuite.graphDensity.toFixed(2)}
              </span>
            </div>

            {/* Quick Scale Presets */}
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
              {NODE_QUICK_PRESETS.map((preset) => {
                const isSelected = customNodeCount === preset.nodes && selectedTopology.nodes.length === preset.nodes;
                return (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => handleGenerateMicrogrid(preset.nodes, preset.density)}
                    className={`rounded-md border px-2 py-1.5 text-[11px] font-mono font-medium transition-colors whitespace-nowrap ${
                      isSelected
                        ? 'border-[#0F62FE] bg-[#0F62FE] text-white'
                        : 'border-slate-200 dark:border-[#525252] bg-white dark:bg-[#161616] text-slate-700 dark:text-[#E0E0E0] hover:bg-slate-50 dark:hover:bg-[#353535]'
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>

            <div className="rounded-md border border-slate-200 dark:border-[#525252] bg-slate-50/70 dark:bg-[#1E1E1E] p-3 space-y-3">
              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <label htmlFor="explore-node-count" className="text-slate-600 dark:text-[#C6C6C6]">
                    Microgrid Node Count (6–12 Core · Max 50)
                  </label>
                  <span className="font-mono font-semibold text-slate-900 dark:text-[#F4F4F4] tabular-nums">
                    {customNodeCount} nodes
                  </span>
                </div>
                <input
                  id="explore-node-count"
                  type="range"
                  min={6}
                  max={50}
                  step={1}
                  value={customNodeCount}
                  onChange={(e) => setCustomNodeCount(Number(e.target.value))}
                  className="w-full accent-[#0F62FE]"
                />
              </div>

              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <label htmlFor="explore-graph-density" className="text-slate-600 dark:text-[#C6C6C6]">
                    Graph Edge Density (ρ)
                  </label>
                  <span className="font-mono font-semibold text-slate-900 dark:text-[#F4F4F4] tabular-nums">
                    {targetDensity.toFixed(2)} ({targetDensity <= 0.3 ? 'Sparse Radial' : targetDensity <= 0.55 ? 'Meshed Ring' : 'Dense Interconnect'})
                  </span>
                </div>
                <input
                  id="explore-graph-density"
                  type="range"
                  min={0.2}
                  max={0.8}
                  step={0.05}
                  value={targetDensity}
                  onChange={(e) => setTargetDensity(Number(e.target.value))}
                  className="w-full accent-[#0F62FE]"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => handleGenerateMicrogrid(customNodeCount, targetDensity)}
                  className="rounded-md bg-slate-900 dark:bg-[#353535] border border-slate-700 dark:border-[#6F6F6F] px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 dark:hover:bg-[#474747] whitespace-nowrap"
                >
                  Apply {customNodeCount}N (ρ={targetDensity.toFixed(2)})
                </button>
                <button
                  type="button"
                  onClick={() => setUploadOpen((v) => !v)}
                  className="inline-flex items-center gap-1 text-xs font-medium text-[#0F62FE] dark:text-[#78A9FF] hover:underline whitespace-nowrap"
                >
                  <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                  {uploadOpen ? 'Hide Upload / Presets' : 'Upload CSV / Excel / JSON'}
                </button>
              </div>
            </div>

            {uploadOpen && (
              <div className="rounded-md border border-slate-200 dark:border-[#525252] bg-slate-50/70 dark:bg-[#1E1E1E] p-3 space-y-3">
                <div className="grid grid-cols-1 gap-1.5">
                  {PRESET_TOPOLOGIES.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => {
                        setSelectedTopology(preset);
                        setCustomNodeCount(Math.max(6, Math.min(50, preset.nodes.length)));
                        setUploadError(null);
                        setUploadSuccessMsg(`Loaded preset "${preset.name}".`);
                      }}
                      className="flex items-center justify-between rounded border border-slate-200 dark:border-[#525252] bg-white dark:bg-[#161616] px-2.5 py-1.5 text-left text-xs text-slate-700 dark:text-[#E0E0E0] hover:bg-slate-50 dark:hover:bg-[#353535]"
                    >
                      <span className="truncate">{preset.name}</span>
                      <span className="font-mono text-[11px] text-slate-500 dark:text-[#A8A8A8]">
                        {preset.nodes.length}N · {preset.edges.length}E
                      </span>
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-200 dark:border-[#393939]">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.json,.xlsx,.xls,text/csv,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                    aria-label="Upload grid dataset CSV, Excel, or JSON file"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void handleFileSelected(file);
                      e.target.value = '';
                    }}
                    className="sr-only"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="rounded border border-slate-300 dark:border-[#525252] bg-white dark:bg-[#262626] px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-[#E0E0E0] hover:bg-slate-100 dark:hover:bg-[#353535]"
                  >
                    Browse CSV / XLSX / JSON
                  </button>
                  <button
                    type="button"
                    onClick={() => setPasteOpen((v) => !v)}
                    className="text-xs font-medium text-[#0F62FE] dark:text-[#78A9FF] hover:underline"
                  >
                    {pasteOpen ? 'Close Editor' : 'Paste CSV/JSON'}
                  </button>
                  <div className="ml-auto flex items-center gap-2.5">
                    <button
                      type="button"
                      onClick={handleDownloadSample}
                      className="inline-flex items-center gap-1 text-xs text-slate-600 dark:text-[#A8A8A8] hover:text-slate-900 dark:hover:text-white"
                    >
                      <Download className="h-3 w-3" aria-hidden="true" />
                      CSV Template
                    </button>
                    <button
                      type="button"
                      onClick={handleDownloadSampleExcel}
                      className="inline-flex items-center gap-1 text-xs font-medium text-[#0F62FE] dark:text-[#78A9FF] hover:underline"
                    >
                      <Download className="h-3 w-3" aria-hidden="true" />
                      Excel (.xlsx)
                    </button>
                  </div>
                </div>

                {pasteOpen && (
                  <div className="space-y-2">
                    <textarea
                      rows={5}
                      value={pastedText}
                      onChange={(e) => setPastedText(e.target.value)}
                      className="w-full rounded border border-slate-300 dark:border-[#525252] bg-white dark:bg-[#121212] p-2 font-mono text-[11px] text-slate-800 dark:text-[#E0E0E0]"
                    />
                    <button
                      type="button"
                      onClick={handleParsePasted}
                      className="rounded bg-[#0F62FE] px-3 py-1 text-xs font-medium text-white hover:bg-[#0353E9]"
                    >
                      Validate & Load
                    </button>
                  </div>
                )}
              </div>
            )}

            {uploadError && (
              <div role="alert" className="flex items-start gap-2 rounded-md border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 p-2.5 text-xs text-red-800 dark:text-red-300">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
                <span>{uploadError}</span>
              </div>
            )}
            {uploadSuccessMsg && (
              <div role="status" className="flex items-start gap-2 rounded-md border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/40 p-2.5 text-xs text-emerald-800 dark:text-emerald-300">
                <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
                <span>{uploadSuccessMsg}</span>
              </div>
            )}
          </div>

          {/* 2. QAOA / 9-Algorithm Solver & Classical Optimizer Controls */}
          <div className="border-t border-slate-200 dark:border-[#393939] pt-4 space-y-3">
            <div className="flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-[#C6C6C6]">
              <Layers className="h-3.5 w-3.5 text-[#0F62FE] dark:text-[#78A9FF]" aria-hidden="true" />
              <span>Quantum / Ising Algorithm, Layers (p) & Classical Optimizer</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="explore-q-algo" className="block text-[11px] font-medium text-slate-600 dark:text-[#A8A8A8] mb-1">
                  Primary Quantum / Ising Solver
                </label>
                <select
                  id="explore-q-algo"
                  value={quantumAlgorithm}
                  onChange={(e) => setQuantumAlgorithm(e.target.value as QuantumAlgorithm)}
                  className="w-full rounded-md border border-slate-300 dark:border-[#525252] bg-white dark:bg-[#161616] px-2.5 py-2 text-xs text-slate-800 dark:text-[#F4F4F4] focus:border-[#0F62FE] focus:outline-none"
                >
                  {EXPLORE_QUANTUM_ALGORITHMS.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="explore-c-algo" className="block text-[11px] font-medium text-slate-600 dark:text-[#A8A8A8] mb-1">
                  Classical Baseline
                </label>
                <select
                  id="explore-c-algo"
                  value={classicalAlgorithm}
                  onChange={(e) => setClassicalAlgorithm(e.target.value as ClassicalAlgorithm)}
                  className="w-full rounded-md border border-slate-300 dark:border-[#525252] bg-white dark:bg-[#161616] px-2.5 py-2 text-xs text-slate-800 dark:text-[#F4F4F4] focus:border-[#0F62FE] focus:outline-none"
                >
                  {CORE_CLASSICAL_BASELINES.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="explore-layers-p" className="block text-[11px] font-medium text-slate-600 dark:text-[#A8A8A8] mb-1">
                  Ansatz Layers (p)
                </label>
                <select
                  id="explore-layers-p"
                  value={layersP}
                  onChange={(e) => setLayersP(Number(e.target.value))}
                  className="w-full rounded-md border border-slate-300 dark:border-[#525252] bg-white dark:bg-[#161616] px-2.5 py-2 text-xs font-mono text-slate-800 dark:text-[#F4F4F4] focus:border-[#0F62FE] focus:outline-none"
                >
                  {ANSATZ_LAYER_OPTIONS.map((p) => (
                    <option key={p} value={p}>
                      p = {p} layer{p > 1 ? 's' : ''} ({p * 2} params)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="explore-optimizer" className="block text-[11px] font-medium text-slate-600 dark:text-[#A8A8A8] mb-1">
                  Classical Optimizer
                </label>
                <select
                  id="explore-optimizer"
                  value={optimizer}
                  onChange={(e) => setOptimizer(e.target.value as ClassicalOptimizer)}
                  className="w-full rounded-md border border-slate-300 dark:border-[#525252] bg-white dark:bg-[#161616] px-2.5 py-2 text-xs font-mono text-slate-800 dark:text-[#F4F4F4] focus:border-[#0F62FE] focus:outline-none"
                >
                  {CLASSICAL_OPTIMIZERS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* 3. IBM Simulator First & Hardware Capabilities Input */}
          <div className="border-t border-slate-200 dark:border-[#393939] pt-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-[#C6C6C6]">
                <Cpu className="h-3.5 w-3.5 text-[#0F62FE] dark:text-[#78A9FF]" aria-hidden="true" />
                IBM Simulator & Hardware Capabilities
              </span>
              <span className="text-[11px] font-mono text-slate-500 dark:text-[#A8A8A8]">
                SamplerV2
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="explore-backend" className="block text-[11px] font-medium text-slate-600 dark:text-[#A8A8A8] mb-1">
                  IBM Backend (Simulator First)
                </label>
                <select
                  id="explore-backend"
                  value={activeBackend}
                  onChange={(e) => onBackendChange(e.target.value as QiskitBackend)}
                  className="w-full rounded-md border border-slate-300 dark:border-[#525252] bg-white dark:bg-[#161616] px-2.5 py-2 text-xs font-mono text-slate-800 dark:text-[#F4F4F4] focus:border-[#0F62FE] focus:outline-none"
                >
                  {QISKIT_BACKENDS.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="explore-shots" className="block text-[11px] font-medium text-slate-600 dark:text-[#A8A8A8] mb-1">
                  Sampler Shots
                </label>
                <select
                  id="explore-shots"
                  value={shots}
                  onChange={(e) => setShots(Number(e.target.value))}
                  className="w-full rounded-md border border-slate-300 dark:border-[#525252] bg-white dark:bg-[#161616] px-2.5 py-2 text-xs font-mono text-slate-800 dark:text-[#F4F4F4] focus:border-[#0F62FE] focus:outline-none"
                >
                  {SHOT_OPTIONS.map((shotOpt) => (
                    <option key={shotOpt} value={shotOpt}>
                      {shotOpt.toLocaleString()} shots
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Editable Hardware Capabilities Inputs */}
            <div className="rounded-md border border-slate-200 dark:border-[#525252] bg-slate-50/70 dark:bg-[#1E1E1E] p-3 space-y-2.5">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs">
                <div>
                  <label htmlFor="hw-max-qubits" className="block text-[10px] text-slate-500 dark:text-[#A8A8A8] mb-0.5">
                    Max Qubits
                  </label>
                  <input
                    id="hw-max-qubits"
                    type="number"
                    min={6}
                    max={256}
                    value={hardware.maxQubits}
                    onChange={(e) =>
                      setHardware((h) => ({ ...h, maxQubits: Math.max(6, Math.min(256, Number(e.target.value) || 6)) }))
                    }
                    className="w-full rounded border border-slate-300 dark:border-[#525252] bg-white dark:bg-[#161616] px-2 py-1 font-mono text-xs text-slate-900 dark:text-[#F4F4F4]"
                  />
                </div>
                <div>
                  <label htmlFor="hw-coupling" className="block text-[10px] text-slate-500 dark:text-[#A8A8A8] mb-0.5">
                    Coupling Map
                  </label>
                  <select
                    id="hw-coupling"
                    value={hardware.couplingTopology}
                    onChange={(e) =>
                      setHardware((h) => ({ ...h, couplingTopology: e.target.value as CouplingTopology }))
                    }
                    className="w-full rounded border border-slate-300 dark:border-[#525252] bg-white dark:bg-[#161616] px-1.5 py-1 font-mono text-[11px] text-slate-900 dark:text-[#F4F4F4]"
                  >
                    <option value="all_to_all">All-to-All</option>
                    <option value="heavy_hex">Heavy-Hex</option>
                    <option value="grid_2d">2D Grid</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="hw-2q-err" className="block text-[10px] text-slate-500 dark:text-[#A8A8A8] mb-0.5">
                    2Q Error (%)
                  </label>
                  <input
                    id="hw-2q-err"
                    type="number"
                    min={0.01}
                    max={5}
                    step={0.05}
                    value={Number((hardware.twoQubitErrorRate * 100).toFixed(2))}
                    onChange={(e) =>
                      setHardware((h) => ({
                        ...h,
                        twoQubitErrorRate: Math.max(0.0001, Math.min(0.05, (Number(e.target.value) || 0.04) / 100)),
                      }))
                    }
                    className="w-full rounded border border-slate-300 dark:border-[#525252] bg-white dark:bg-[#161616] px-2 py-1 font-mono text-xs text-slate-900 dark:text-[#F4F4F4]"
                  />
                </div>
                <div>
                  <label htmlFor="hw-ro-err" className="block text-[10px] text-slate-500 dark:text-[#A8A8A8] mb-0.5">
                    Readout Err (%)
                  </label>
                  <input
                    id="hw-ro-err"
                    type="number"
                    min={0.05}
                    max={8}
                    step={0.1}
                    value={Number((hardware.readoutErrorRate * 100).toFixed(2))}
                    onChange={(e) =>
                      setHardware((h) => ({
                        ...h,
                        readoutErrorRate: Math.max(0.0005, Math.min(0.08, (Number(e.target.value) || 0.1) / 100)),
                      }))
                    }
                    className="w-full rounded border border-slate-300 dark:border-[#525252] bg-white dark:bg-[#161616] px-2 py-1 font-mono text-xs text-slate-900 dark:text-[#F4F4F4]"
                  />
                </div>
                <div>
                  <label htmlFor="hw-t2" className="block text-[10px] text-slate-500 dark:text-[#A8A8A8] mb-0.5">
                    Coherence T2 (µs)
                  </label>
                  <input
                    id="hw-t2"
                    type="number"
                    min={15}
                    max={1000}
                    step={10}
                    value={hardware.t2Us}
                    onChange={(e) =>
                      setHardware((h) => ({ ...h, t2Us: Math.max(15, Math.min(1000, Number(e.target.value) || 120)) }))
                    }
                    className="w-full rounded border border-slate-300 dark:border-[#525252] bg-white dark:bg-[#161616] px-2 py-1 font-mono text-xs text-slate-900 dark:text-[#F4F4F4]"
                  />
                </div>
                <div>
                  <label htmlFor="hw-depth" className="block text-[10px] text-slate-500 dark:text-[#A8A8A8] mb-0.5">
                    Max Depth
                  </label>
                  <input
                    id="hw-depth"
                    type="number"
                    min={20}
                    max={600}
                    step={10}
                    value={hardware.maxDepthBudget}
                    onChange={(e) =>
                      setHardware((h) => ({
                        ...h,
                        maxDepthBudget: Math.max(20, Math.min(600, Number(e.target.value) || 140)),
                      }))
                    }
                    className="w-full rounded border border-slate-300 dark:border-[#525252] bg-white dark:bg-[#161616] px-2 py-1 font-mono text-xs text-slate-900 dark:text-[#F4F4F4]"
                  />
                </div>
              </div>

              <div className="pt-2 border-t border-slate-200 dark:border-[#393939] flex items-center justify-between gap-2 text-[11px]">
                <span className="text-slate-600 dark:text-[#C6C6C6] leading-snug">
                  {activeSuite.qubo.hardwareFit.verdict}
                </span>
                <span className="font-mono font-semibold text-[#0F62FE] dark:text-[#78A9FF] whitespace-nowrap">
                  Fidelity ~{activeSuite.qubo.hardwareFit.estimatedFidelityPct}%
                </span>
              </div>
            </div>
          </div>

          {/* 4. QUBO Operational Constraints */}
          <div className="border-t border-slate-200 dark:border-[#393939] pt-4">
            <div className="text-xs font-medium text-slate-700 dark:text-[#C6C6C6] mb-2">
              QUBO Penalty Terms ({constraints.length} Active)
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {CONSTRAINT_CATALOG.map((c) => {
                const checked = constraints.includes(c.id);
                return (
                  <label
                    key={c.id}
                    className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs cursor-pointer transition-colors ${
                      checked
                        ? 'border-[#0F62FE] bg-[#0F62FE]/8 dark:bg-[#353535] text-slate-900 dark:text-white font-medium'
                        : 'border-slate-200 dark:border-[#525252] bg-white dark:bg-[#161616] text-slate-600 dark:text-[#A8A8A8]'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleConstraint(c.id)}
                      className="h-3.5 w-3.5 accent-[#0F62FE]"
                    />
                    <span className="truncate">{c.shortLabel}</span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Primary Actions */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              data-testid="run-all-solvers-btn"
              onClick={() => void handleRunAllSolvers()}
              disabled={isRunningSuite || isJobWorking}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md bg-[#0F62FE] px-4 py-2.5 text-xs font-medium text-white hover:bg-[#0353E9] disabled:opacity-60 transition-colors whitespace-nowrap"
            >
              <Play className="h-3.5 w-3.5" aria-hidden="true" />
              {isRunningSuite || isJobWorking
                ? 'Running IBM Simulator...'
                : 'Run All 9 Solvers + Baselines'}
            </button>
            <button
              type="button"
              onClick={() => onLoadIntoLiveMonitor(activeRun.topology)}
              className="rounded-md border border-slate-300 dark:border-[#525252] bg-white dark:bg-[#161616] px-3 py-2.5 text-xs font-medium text-slate-700 dark:text-[#E0E0E0] hover:bg-slate-50 dark:hover:bg-[#353535] whitespace-nowrap"
            >
              Send to 3D Map
            </button>
          </div>

          {/* 5. Real IBM Qiskit / QPU Job Execution Bridge */}
          <div className="border-t border-slate-200 dark:border-[#393939] pt-4 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-medium text-slate-800 dark:text-[#F4F4F4]">
                <Server className="h-3.5 w-3.5 text-[#0F62FE] dark:text-[#78A9FF]" aria-hidden="true" />
                <span>Real IBM Qiskit Job Execution</span>
              </div>
              <span className="font-mono text-[10px] font-medium text-slate-600 dark:text-[#A8A8A8]">
                {qiskitCaps?.activeMode === 'ibm_cloud_rest'
                  ? `IBM Cloud REST (${qiskitCaps.ibmRegion})`
                  : qiskitCaps?.activeMode === 'qiskit_python_service'
                  ? 'Python Qiskit Service'
                  : qiskitCaps?.activeMode === 'qiskit_local_python'
                  ? `Qiskit ${qiskitCaps.localQiskitVersion ?? ''} Local`
                  : 'Runtime Not Configured'}
              </span>
            </div>

            <div className="rounded-md border border-slate-200 dark:border-[#525252] bg-slate-50/70 dark:bg-[#1E1E1E] p-3 space-y-2.5">
              {qiskitCaps && qiskitCaps.liveBackends.length > 0 && (
                <div>
                  <label
                    htmlFor="explore-live-ibm-qpu"
                    className="block text-[11px] text-slate-600 dark:text-[#C6C6C6] mb-1"
                  >
                    Target Live IBM Quantum Processor
                  </label>
                  <select
                    id="explore-live-ibm-qpu"
                    value={selectedLiveIbmBackend}
                    onChange={(e) => setSelectedLiveIbmBackend(e.target.value)}
                    className="w-full rounded-md border border-slate-200 dark:border-[#525252] bg-white dark:bg-[#161616] px-2.5 py-1.5 font-mono text-xs text-slate-800 dark:text-[#F4F4F4] focus:border-[#0F62FE] focus:outline-none"
                  >
                    {qiskitCaps.liveBackends.map((b) => (
                      <option key={b.name} value={b.name}>
                        {b.name} ({b.qubits}q · {b.pendingJobs} queued · {b.status})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  data-testid="execute-batch-qiskit-btn"
                  onClick={() => void handleExecuteBatchRealQiskit()}
                  disabled={
                    isExecutingBatchQiskit ||
                    isExecutingQiskit ||
                    !qiskitCaps?.ibmCloudRestConfigured ||
                    !qiskitCaps?.ibmInstanceConfigured
                  }
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-slate-900 dark:bg-[#0F62FE] px-3 py-2 text-xs font-medium text-white hover:bg-slate-800 dark:hover:bg-[#0353E9] disabled:opacity-55 transition-colors whitespace-nowrap"
                >
                  <Layers className="h-3.5 w-3.5" aria-hidden="true" />
                  {isExecutingBatchQiskit
                    ? 'Submitting 5-Solver Multi-PUB Batch...'
                    : `Run All 5 Gate Solvers on ${selectedLiveIbmBackend || 'IBM QPU'}`}
                </button>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    data-testid="execute-real-qiskit-btn"
                    onClick={() => void handleExecuteRealQiskit()}
                    disabled={isExecutingQiskit || isExecutingBatchQiskit}
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-[#0F62FE] bg-white dark:bg-[#161616] px-3 py-1.5 text-xs font-medium text-[#0F62FE] dark:text-[#78A9FF] hover:bg-[#0F62FE]/8 dark:hover:bg-[#353535] disabled:opacity-60 transition-colors whitespace-nowrap"
                  >
                    <Cpu className="h-3.5 w-3.5" aria-hidden="true" />
                    {isExecutingQiskit
                      ? 'Submitting Single PUB...'
                      : `Run ${quantumAlgorithm} Only`}
                  </button>

                  {qiskitJobResult &&
                    (qiskitJobResult.status === 'QUEUED' || qiskitJobResult.status === 'RUNNING') && (
                      <button
                        type="button"
                        onClick={() => void handlePollQiskitJob()}
                        disabled={isPollingQiskit}
                        className="rounded-md border border-slate-300 dark:border-[#525252] bg-white dark:bg-[#262626] px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-[#E0E0E0] hover:bg-slate-100 dark:hover:bg-[#353535] disabled:opacity-60 whitespace-nowrap"
                      >
                        {isPollingQiskit ? 'Polling...' : 'Poll Now'}
                      </button>
                    )}
                </div>
              </div>

              <p className="text-[10px] leading-relaxed text-slate-500 dark:text-[#A8A8A8]">
                Multi-PUB batch packs QAOA, CVaR-QAOA, BF-DCQO, VQA &amp; VarQITE into one SamplerV2 job on real IBM hardware and updates the comparison table automatically.
              </p>

              {qiskitCaps &&
                (qiskitCaps.activeMode === 'unconfigured' ||
                  (qiskitCaps.ibmCloudRestConfigured && !qiskitCaps.ibmInstanceConfigured)) && (
                  <p className="text-[11px] leading-relaxed text-slate-600 dark:text-[#A8A8A8]">
                    {qiskitCaps.setupHint}
                  </p>
                )}

              {qiskitJobError && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/40 p-2 text-[11px] text-amber-900 dark:text-amber-300"
                >
                  <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{qiskitJobError}</span>
                </div>
              )}

              {qiskitJobResult && (
                <div className="rounded border border-slate-200 dark:border-[#525252] bg-white dark:bg-[#161616] p-2.5 space-y-2 text-[11px]">
                  <div className="flex flex-wrap items-center justify-between gap-1.5">
                    <span className="font-mono font-semibold text-slate-900 dark:text-[#F4F4F4]">
                      Job {qiskitJobResult.jobId}
                    </span>
                    <span
                      className={`font-mono font-semibold ${
                        qiskitJobResult.status === 'COMPLETED'
                          ? 'text-[#15803D] dark:text-[#42BE65]'
                          : qiskitJobResult.status === 'FAILED'
                          ? 'text-[#B91C1C] dark:text-[#FA4D56]'
                          : 'text-[#0F62FE] dark:text-[#78A9FF]'
                      }`}
                    >
                      {qiskitJobResult.status} · {qiskitJobResult.backendName}
                    </span>
                  </div>

                  {(qiskitJobResult.status === 'QUEUED' || qiskitJobResult.status === 'RUNNING') && (
                    <div className="text-[10px] text-slate-500 dark:text-[#A8A8A8]">
                      Auto-polling IBM Quantum every 4s{qiskitJobResult.isBatch ? ' (5 PUBs in queue)' : ''}...
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-1.5 font-mono text-[10px] text-slate-600 dark:text-[#C6C6C6]">
                    <div>
                      Qubits: <span className="text-slate-900 dark:text-[#F4F4F4]">{qiskitJobResult.qubits}q</span> · Depth:{' '}
                      <span className="text-slate-900 dark:text-[#F4F4F4]">{qiskitJobResult.transpiledDepth}</span>
                    </div>
                    <div>
                      2Q Gates: <span className="text-slate-900 dark:text-[#F4F4F4]">{qiskitJobResult.twoQubitGateCount}</span> · Shots:{' '}
                      <span className="text-slate-900 dark:text-[#F4F4F4]">{qiskitJobResult.shots}</span>
                    </div>
                    {qiskitJobResult.optimalBitstring && (
                      <div className="col-span-2">
                        Best ({qiskitJobResult.algorithm}):{' '}
                        <span className="text-slate-900 dark:text-[#F4F4F4]">{qiskitJobResult.optimalBitstring}</span> · E ={' '}
                        <span className="text-slate-900 dark:text-[#F4F4F4]">{qiskitJobResult.achievedQuboEnergy}</span>
                        {qiskitJobResult.demandMetPct !== undefined && (
                          <>
                            {' '}· Demand Met:{' '}
                            <span className="text-[#15803D] dark:text-[#42BE65]">{qiskitJobResult.demandMetPct}%</span>
                          </>
                        )}
                      </div>
                    )}
                    {qiskitJobResult.errorMessage && (
                      <div className="col-span-2 rounded border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 p-2 font-sans text-[11px] text-red-800 dark:text-red-300">
                        {qiskitJobResult.errorMessage}
                      </div>
                    )}
                  </div>

                  {qiskitJobResult.pubResults && qiskitJobResult.pubResults.length > 1 && (
                    <div className="border-t border-slate-200 dark:border-[#393939] pt-2 space-y-1">
                      <div className="text-[10px] font-semibold text-slate-600 dark:text-[#A8A8A8]">
                        Multi-PUB IBM QPU Breakdown ({qiskitJobResult.pubResults.length} Gate Solvers)
                      </div>
                      <div className="divide-y divide-slate-100 dark:divide-[#2E2E2E] font-mono text-[10px]">
                        {qiskitJobResult.pubResults.map((pub) => (
                          <div key={pub.algorithm} className="flex items-center justify-between py-1 gap-2">
                            <span className="font-semibold text-slate-800 dark:text-[#F4F4F4]">
                              {pub.algorithm}
                            </span>
                            <span className="text-slate-500 dark:text-[#A8A8A8]">
                              {pub.twoQubitGateCount} 2Q
                            </span>
                            {pub.approxRatio !== undefined ? (
                              <span className="text-[#15803D] dark:text-[#42BE65]">
                                r={pub.approxRatio.toFixed(3)} · {pub.demandMetPct}%
                              </span>
                            ) : (
                              <span className="text-slate-400">Queued</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {qiskitJobResult.openQasm3 && (
                    <div>
                      <button
                        type="button"
                        onClick={() => setShowOpenQasm((v) => !v)}
                        className="text-[11px] font-medium text-[#0F62FE] dark:text-[#78A9FF] hover:underline"
                      >
                        {showOpenQasm ? 'Hide OpenQASM 3.0 ISA Circuit' : 'View Submitted OpenQASM 3.0 ISA Circuit'}
                      </button>
                      {showOpenQasm && (
                        <div className="mt-1.5 space-y-1.5">
                          {qiskitJobResult.pubResults && qiskitJobResult.pubResults.length > 1 && (
                            <div className="flex flex-wrap gap-1">
                              {qiskitJobResult.pubResults.map((pub, idx) => (
                                <button
                                  key={pub.algorithm}
                                  type="button"
                                  onClick={() => setSelectedPubQasmIdx(idx)}
                                  className={`rounded px-1.5 py-0.5 font-mono text-[10px] border ${
                                    selectedPubQasmIdx === idx
                                      ? 'border-[#0F62FE] bg-[#0F62FE] text-white'
                                      : 'border-slate-300 dark:border-[#525252] bg-slate-50 dark:bg-[#262626] text-slate-700 dark:text-[#C6C6C6]'
                                  }`}
                                >
                                  {pub.algorithm}
                                </button>
                              ))}
                            </div>
                          )}
                          <pre className="max-h-40 overflow-auto rounded bg-slate-900 p-2 font-mono text-[10px] text-slate-100">
                            {qiskitJobResult.pubResults?.[selectedPubQasmIdx]?.openQasm3 ??
                              qiskitJobResult.openQasm3}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* RIGHT PANEL: Deployment Metrics + 4-Tab QUBO / 9-Solver / Convergence / Simulation Studio */}
        <div className="xl:col-span-7 space-y-6">
          {/* Top 4 Rural Microgrid Deployment Metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono tabular-nums">
            <div className="rounded-md border border-slate-200 dark:border-[#393939] bg-white dark:bg-[#262626] p-3.5">
              <div className="font-sans text-[11px] font-medium text-slate-500 dark:text-[#A8A8A8]">
                % Demand Met
              </div>
              <div className="mt-1 text-xl font-semibold text-[#15803D] dark:text-[#42BE65]">
                {selectedSolverRow.demandMetPct}%
              </div>
              <div className="mt-0.5 font-sans text-[11px] text-slate-500 dark:text-[#A8A8A8]">
                {greedyRow ? `vs ${greedyRow.demandMetPct}% Greedy` : 'Greedy baseline'}
              </div>
            </div>

            <div className="rounded-md border border-slate-200 dark:border-[#393939] bg-white dark:bg-[#262626] p-3.5">
              <div className="font-sans text-[11px] font-medium text-slate-500 dark:text-[#A8A8A8]">
                Cost Saved
              </div>
              <div
                className="mt-1 text-lg sm:text-xl font-semibold text-[#0F62FE] dark:text-[#78A9FF] truncate"
                title={`$${selectedSolverRow.costSavedDailyUsd.toLocaleString()}/day`}
              >
                {selectedSolverRow.costSavedDailyUsd >= 1_000_000
                  ? `$${(selectedSolverRow.costSavedDailyUsd / 1_000_000).toFixed(2)}M/d`
                  : `$${selectedSolverRow.costSavedDailyUsd.toLocaleString()}/d`}
              </div>
              <div className="mt-0.5 font-sans text-[11px] text-slate-500 dark:text-[#A8A8A8]">
                −{selectedSolverRow.costSavedPct}% diesel/import
              </div>
            </div>

            <div className="rounded-md border border-slate-200 dark:border-[#393939] bg-white dark:bg-[#262626] p-3.5">
              <div className="font-sans text-[11px] font-medium text-slate-500 dark:text-[#A8A8A8]">
                Clean Energy Used
              </div>
              <div className="mt-1 text-xl font-semibold text-slate-900 dark:text-[#F4F4F4]">
                {selectedSolverRow.renewableUtilPct}%
              </div>
              <div className="mt-0.5 font-sans text-[11px] text-slate-500 dark:text-[#A8A8A8]">
                {saRow ? `vs ${saRow.renewableUtilPct}% SA baseline` : 'SA baseline'}
              </div>
            </div>

            <div className="rounded-md border border-slate-200 dark:border-[#393939] bg-white dark:bg-[#262626] p-3.5">
              <div className="font-sans text-[11px] font-medium text-slate-500 dark:text-[#A8A8A8]">
                Approx Ratio · Fidelity
              </div>
              <div className="mt-1 text-xl font-semibold text-slate-900 dark:text-[#F4F4F4]">
                {selectedSolverRow.approxRatio.toFixed(3)}
              </div>
              <div className="mt-0.5 font-sans text-[11px] text-slate-500 dark:text-[#A8A8A8]">
                {selectedSolverRow.fidelityPct}% · {selectedSolverRow.algorithm}
              </div>
            </div>
          </div>

          {/* Main 4-Tab QUBO & Multi-Algorithm Studio Card */}
          <div className="rounded-md border border-slate-200 dark:border-[#393939] bg-white dark:bg-[#262626] p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-[#393939]">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-semibold text-slate-900 dark:text-[#F4F4F4]">
                    QUBO Benchmark & Convergence Studio
                  </h2>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-mono font-semibold ${
                      qpuOverlayCount > 0 || isLiveSuiteCurrent
                        ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-[#42BE65] border border-emerald-200 dark:border-emerald-900'
                        : 'bg-slate-100 dark:bg-[#161616] text-slate-600 dark:text-[#A8A8A8] border border-slate-200 dark:border-[#393939]'
                    }`}
                  >
                    {qpuOverlayCount > 0 && activeQpuOverlay
                      ? `IBM QPU Live · ${qpuOverlayCount} Gate Solver${qpuOverlayCount > 1 ? 's' : ''} (${activeQpuOverlay.backendName})`
                      : isLiveSuiteCurrent
                      ? suiteSourceLabel
                      : activeSuite.qubo.exactGroundState
                      ? 'Exact 2^N Statevector'
                      : 'Partitioned Statevector'}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-[#A8A8A8]">
                  {selectedTopology.nodes.length}N microgrid (ρ={activeSuite.graphDensity.toFixed(2)}) · p={layersP} · {optimizer} · {hardware.backendId}
                </p>
              </div>

              <div
                role="tablist"
                aria-label="QUBO studio views"
                className="inline-flex flex-wrap rounded-md border border-slate-200 dark:border-[#525252] bg-slate-50 dark:bg-[#161616] p-0.5"
              >
                {(
                  [
                    { id: 'solvers', label: 'All 9 Solvers', icon: Cpu },
                    { id: 'qubo', label: 'QUBO Formulation', icon: Grid3X3 },
                    { id: 'convergence', label: 'Convergence vs Density', icon: BarChart3 },
                    { id: 'simulation', label: 'Grid Simulation', icon: Activity },
                  ] as const
                ).map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      aria-selected={studioTab === tab.id}
                      onClick={() => setStudioTab(tab.id)}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded whitespace-nowrap transition-colors ${
                        studioTab === tab.id
                          ? 'bg-white dark:bg-[#353535] text-slate-900 dark:text-white shadow-xs'
                          : 'text-slate-600 dark:text-[#A8A8A8] hover:text-slate-900 dark:hover:text-[#F4F4F4]'
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* TAB 1: ALL 9 QUANTUM/ISING SOLVERS + GREEDY & SIMULATED ANNEALING BASELINES */}
            {studioTab === 'solvers' && (
              <div className="space-y-3">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-[#393939] text-[11px] font-semibold text-slate-500 dark:text-[#A8A8A8]">
                        <th className="py-2 pr-3">Algorithm</th>
                        <th className="py-2 pr-3 text-right">Approx Ratio</th>
                        <th className="py-2 pr-3 text-right">% Demand Met</th>
                        <th className="py-2 pr-3 text-right">Clean Energy</th>
                        <th className="py-2 pr-3 text-right">Cost Saved/d</th>
                        <th className="py-2 pr-3 text-right">Depth</th>
                        <th className="py-2 pr-3 text-right">Fidelity</th>
                        <th className="py-2 text-right">Runtime</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-[#393939] font-mono tabular-nums">
                      {displayBenchmarks.map((row) => {
                        const isSelected = row.algorithm === quantumAlgorithm;
                        const isClassical = row.category === 'classical';
                        const isRealQpu = row.executionMode === 'ibm_qpu_hardware';
                        return (
                          <tr
                            key={row.algorithm}
                            onClick={() => {
                              if (!isClassical) {
                                setQuantumAlgorithm(row.algorithm as QuantumAlgorithm);
                              } else {
                                setClassicalAlgorithm(row.algorithm as ClassicalAlgorithm);
                              }
                            }}
                            className={`cursor-pointer transition-colors ${
                              isSelected
                                ? 'bg-[#0F62FE]/10 dark:bg-[#0F62FE]/18'
                                : 'hover:bg-slate-50 dark:hover:bg-[#353535]'
                            }`}
                          >
                            <td className="py-2.5 pr-3 font-sans">
                              <div className="flex items-center gap-1.5">
                                <span
                                  className={`h-2 w-2 rounded-xs shrink-0 ${
                                    isRealQpu
                                      ? 'bg-[#15803D] dark:bg-[#42BE65]'
                                      : row.category === 'quantum'
                                      ? 'bg-[#0F62FE] dark:bg-[#78A9FF]'
                                      : row.category === 'ising'
                                      ? 'bg-[#16A34A] dark:bg-[#42BE65]'
                                      : 'bg-slate-400 dark:bg-[#8D8D8D]'
                                  }`}
                                  aria-hidden="true"
                                />
                                <span className="font-semibold text-slate-900 dark:text-[#F4F4F4] whitespace-nowrap">
                                  {row.algorithm}
                                </span>
                                {isRealQpu && (
                                  <span className="rounded border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/60 px-1 py-0.25 font-mono text-[9px] font-semibold text-emerald-700 dark:text-[#42BE65] whitespace-nowrap">
                                    IBM QPU
                                  </span>
                                )}
                              </div>
                              <div className="text-[10px] text-slate-500 dark:text-[#A8A8A8] pl-3.5">
                                {isRealQpu && row.qiskitBackendName
                                  ? `${row.qiskitBackendName} · ${row.twoQubitGates} 2Q ISA`
                                  : row.familyTag}
                              </div>
                            </td>
                            <td className="py-2.5 pr-3 text-right font-semibold text-[#0F62FE] dark:text-[#78A9FF]">
                              {row.approxRatio.toFixed(3)}
                            </td>
                            <td
                              className={`py-2.5 pr-3 text-right font-semibold ${
                                row.demandMetPct >= 95
                                  ? 'text-[#15803D] dark:text-[#42BE65]'
                                  : row.demandMetPct >= 90
                                  ? 'text-[#B45309] dark:text-[#F1C21B]'
                                  : 'text-[#B91C1C] dark:text-[#FA4D56]'
                              }`}
                            >
                              {row.demandMetPct.toFixed(1)}%
                            </td>
                            <td className="py-2.5 pr-3 text-right text-slate-700 dark:text-[#E0E0E0]">
                              {row.renewableUtilPct.toFixed(1)}%
                            </td>
                            <td className="py-2.5 pr-3 text-right text-[#15803D] dark:text-[#42BE65]">
                              ${row.costSavedDailyUsd.toLocaleString()}
                            </td>
                            <td className="py-2.5 pr-3 text-right text-slate-600 dark:text-[#C6C6C6]">
                              {row.circuitDepth > 0 ? row.circuitDepth : '—'}
                            </td>
                            <td className="py-2.5 pr-3 text-right text-slate-600 dark:text-[#C6C6C6]">
                              {row.fidelityPct.toFixed(1)}%
                            </td>
                            <td className="py-2.5 text-right text-slate-600 dark:text-[#A8A8A8] whitespace-nowrap">
                              {row.runtimeMs} ms
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Selected Solver Engineering Insight */}
                <div className="rounded-md border border-slate-200 dark:border-[#393939] bg-slate-50/70 dark:bg-[#1E1E1E] px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="text-slate-700 dark:text-[#E0E0E0]">
                    <span className="font-semibold text-[#0F62FE] dark:text-[#78A9FF]">{selectedSolverRow.algorithm}:</span>{' '}
                    {selectedSolverRow.notes}
                  </div>
                  <span className="font-mono text-[11px] text-slate-500 dark:text-[#A8A8A8] whitespace-nowrap">
                    State {selectedSolverRow.optimalBitstring} · E(x)={selectedSolverRow.achievedEnergy ?? '—'} · ⟨H_C⟩={selectedSolverRow.expectationEnergy ?? '—'} · {selectedSolverRow.twoQubitGates} 2Q
                  </span>
                </div>
              </div>
            )}

            {/* TAB 2: LIVE QUBO FORMULATION MATRIX & QISKIT SAMPLERV2 CODE */}
            {studioTab === 'qubo' && (
              <div className="space-y-4">
                <div className="rounded-md border border-slate-200 dark:border-[#393939] bg-slate-50/70 dark:bg-[#1E1E1E] p-3.5 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-900 dark:text-[#F4F4F4]">
                      Microgrid Load-Balancing QUBO, Problem Hamiltonian H_C & Mixer H_M
                    </span>
                    <span className="font-mono text-[11px] text-[#0F62FE] dark:text-[#78A9FF]">
                      {activeSuite.qubo.linearTermsCount} linear + {activeSuite.qubo.quadraticTermsCount} quadratic terms
                    </span>
                  </div>
                  <div className="rounded bg-white dark:bg-[#121212] border border-slate-200 dark:border-[#393939] px-3 py-2 font-mono text-[11px] text-slate-800 dark:text-[#E0E0E0] space-y-1 overflow-x-auto">
                    <div>{activeSuite.qubo.hamiltonianSummary}</div>
                    {activeSuite.qubo.isingSummary && (
                      <div className="text-[#0F62FE] dark:text-[#78A9FF]">{activeSuite.qubo.isingSummary}</div>
                    )}
                    {activeSuite.qubo.mixerSummary && (
                      <div className="text-[#B45309] dark:text-[#F1C21B]">{activeSuite.qubo.mixerSummary}</div>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 font-mono text-[11px] tabular-nums">
                    <div>
                      <span className="text-slate-500 dark:text-[#A8A8A8]">
                        {activeSuite.qubo.exactGroundState ? 'Exact 2^N Ground: ' : 'Best Reference: '}
                      </span>
                      <span className="font-semibold text-slate-900 dark:text-[#F4F4F4]">
                        {activeSuite.qubo.quboEnergyGround}
                        {activeSuite.qubo.optimalBitstringExact ? ` (${activeSuite.qubo.optimalBitstringExact})` : ''}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 dark:text-[#A8A8A8]">⟨H_C⟩ ({quantumAlgorithm}): </span>
                      <span className="font-semibold text-[#15803D] dark:text-[#42BE65]">{activeSuite.qubo.quboEnergyQuantum}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 dark:text-[#A8A8A8]">Greedy E(x): </span>
                      <span className="font-semibold text-[#B91C1C] dark:text-[#FA4D56]">{activeSuite.qubo.quboEnergyGreedy}</span>
                    </div>
                  </div>
                </div>

                {/* QUBO Matrix Q_ij Heatmap */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-700 dark:text-[#E0E0E0]">
                      QUBO Coupling Matrix Q ({activeSuite.qubo.matrixPreviewSize}×{activeSuite.qubo.matrixPreviewSize}
                      {activeSuite.nodeCount > 12 ? ` leading submatrix of ${activeSuite.nodeCount}×${activeSuite.nodeCount}` : ' full matrix'})
                    </span>
                    <div className="flex items-center gap-3 text-[11px] text-slate-500 dark:text-[#A8A8A8]">
                      <span className="inline-flex items-center gap-1">
                        <span className="h-2.5 w-2.5 rounded-xs bg-[#0F62FE]" /> Diagonal Reward (Qᵢᵢ &lt; 0)
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <span className="h-2.5 w-2.5 rounded-xs bg-[#D97706]" /> Feeder Coupling (Qᵢⱼ &gt; 0)
                      </span>
                    </div>
                  </div>

                  <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-[#393939] bg-[#121212] p-3">
                    <div
                      className="grid gap-1 mx-auto"
                      style={{
                        gridTemplateColumns: `36px repeat(${activeSuite.qubo.matrixPreviewSize}, minmax(30px, 1fr))`,
                      }}
                    >
                      <div />
                      {activeSuite.qubo.nodeLabels.map((lbl) => (
                        <div key={`col-${lbl}`} className="text-center font-mono text-[9px] text-[#A8A8A8]">
                          {lbl}
                        </div>
                      ))}

                      {activeSuite.qubo.matrix.map((row, rIdx) => (
                        <div key={`row-wrap-${rIdx}`} className="contents">
                          <div className="flex items-center font-mono text-[9px] text-[#A8A8A8]">
                            {activeSuite.qubo.nodeLabels[rIdx]}
                          </div>
                          {row.map((val, cIdx) => {
                            const intensity = Math.min(0.92, Math.abs(val) / maxAbsQ);
                            const bg =
                              val === 0
                                ? '#1B1B1B'
                                : val < 0
                                ? `rgba(15, 98, 254, ${0.22 + intensity * 0.7})`
                                : `rgba(217, 119, 6, ${0.22 + intensity * 0.72})`;
                            return (
                              <div
                                key={`${rIdx}-${cIdx}`}
                                title={`Q[${activeSuite.qubo.nodeLabels[rIdx]}, ${activeSuite.qubo.nodeLabels[cIdx]}] = ${val}`}
                                style={{ backgroundColor: bg }}
                                className="h-7 rounded-xs flex items-center justify-center font-mono text-[9px] text-[#F4F4F4] tabular-nums"
                              >
                                {val === 0 ? '·' : val.toFixed(1)}
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Qiskit SamplerV2 Code Snippet */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-700 dark:text-[#E0E0E0]">
                      Qiskit SamplerV2 Ansatz ({quantumAlgorithm} · p={layersP} · {optimizer})
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleCopyCode(activeSuite.qiskitSamplerCode)}
                      className="inline-flex items-center gap-1 rounded border border-slate-300 dark:border-[#525252] bg-white dark:bg-[#161616] px-2.5 py-1 text-[11px] font-medium text-slate-700 dark:text-[#E0E0E0] hover:bg-slate-50 dark:hover:bg-[#353535]"
                    >
                      {copiedCode ? <Check className="h-3 w-3 text-[#42BE65]" /> : <Copy className="h-3 w-3" />}
                      {copiedCode ? 'Copied' : 'Copy Python'}
                    </button>
                  </div>
                  <pre className="max-h-[210px] overflow-auto rounded-md border border-slate-200 dark:border-[#393939] bg-[#121212] p-3 font-mono text-[11px] leading-relaxed text-[#E0E0E0]">
                    {activeSuite.qiskitSamplerCode}
                  </pre>
                </div>
              </div>
            )}

            {/* TAB 3: CONVERGENCE VS GRAPH DENSITY + OPTIMIZER TRAJECTORY */}
            {studioTab === 'convergence' && (() => {
              const w = 560;
              const h = 195;
              const padL = 44;
              const padR = 44;
              const padT = 16;
              const padB = 28;
              const allValues = [
                ...activeSuite.densityConvergence.flatMap((pt) => [
                  pt.qaoaP4,
                  pt.cvarQaoa,
                  pt.bfDcqo,
                  pt.simulatedAnnealing,
                  pt.greedy,
                ]),
                ...activeSuite.optimizerTrajectory.flatMap((pt) => [
                  pt.qaoa,
                  pt.cvarQaoa,
                  pt.bfDcqo,
                  pt.simulatedAnnealing,
                  pt.greedy,
                ]),
              ];
              const observedMin = Math.min(...allValues, 0.65);
              const minY = Math.max(0.0, Math.min(0.6, Math.floor((observedMin - 0.05) * 10) / 10));
              const maxY = 1.0;
              const yTicks = [0, 1, 2, 3].map((k) => Number((minY + ((maxY - minY) * k) / 3).toFixed(2)));

              const dToX = (d: number) => padL + ((d - 0.2) / (0.8 - 0.2)) * (w - padL - padR);
              const vToY = (v: number) => {
                const clamped = Math.max(minY, Math.min(maxY, v));
                return padT + (1 - (clamped - minY) / Math.max(0.01, maxY - minY)) * (h - padT - padB);
              };

              const buildDensityPath = (getter: (pt: QuboSuiteResult['densityConvergence'][number]) => number) =>
                activeSuite.densityConvergence
                  .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${dToX(pt.density).toFixed(1)} ${vToY(getter(pt)).toFixed(1)}`)
                  .join(' ');

              const activeDClamped = Math.max(0.2, Math.min(0.8, activeSuite.graphDensity));

              const iToX = (iter: number) => padL + ((iter - 1) / 14) * (w - padL - padR);
              const buildIterPath = (getter: (pt: QuboSuiteResult['optimizerTrajectory'][number]) => number) =>
                activeSuite.optimizerTrajectory
                  .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${iToX(pt.iteration).toFixed(1)} ${vToY(getter(pt)).toFixed(1)}`)
                  .join(' ');

              return (
                <div className="space-y-4">
                  {/* Chart A: Convergence vs Graph Density */}
                  <div className="rounded-md border border-slate-200 dark:border-[#393939] bg-slate-50/60 dark:bg-[#121212] p-3.5 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                      <span className="font-semibold text-slate-800 dark:text-[#F4F4F4]">
                        Approximation Ratio vs Microgrid Graph Density (ρ = 0.20 → 0.80)
                      </span>
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="inline-flex items-center gap-1 text-[#0F62FE] dark:text-[#78A9FF]">
                          <span className="h-0.5 w-3 bg-[#0F62FE] dark:bg-[#78A9FF]" /> CVaR-QAOA
                        </span>
                        <span className="inline-flex items-center gap-1 text-[#15803D] dark:text-[#42BE65]">
                          <span className="h-0.5 w-3 bg-[#15803D] dark:bg-[#42BE65]" /> BF-DCQO
                        </span>
                        <span className="inline-flex items-center gap-1 text-[#7C3AED] dark:text-[#BE95FF]">
                          <span className="h-0.5 w-3 bg-[#7C3AED] dark:bg-[#BE95FF]" /> QAOA (p=4)
                        </span>
                        <span className="inline-flex items-center gap-1 text-[#D97706] dark:text-[#F1C21B]">
                          <span className="h-0.5 w-3 bg-[#D97706] dark:bg-[#F1C21B]" /> Sim. Annealing
                        </span>
                        <span className="inline-flex items-center gap-1 text-slate-500 dark:text-[#A8A8A8]">
                          <span className="h-0.5 w-3 bg-slate-500 dark:bg-[#8D8D8D]" /> Greedy
                        </span>
                      </div>
                    </div>

                    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-[195px]" role="img" aria-label="Convergence vs graph density chart">
                      {yTicks.map((v) => (
                        <g key={v}>
                          <line x1={padL} y1={vToY(v)} x2={w - padR} y2={vToY(v)} stroke={isDark ? '#2A2A2A' : '#E2E8F0'} strokeWidth={1} />
                          <text x={padL - 6} y={vToY(v) + 3} textAnchor="end" fontSize="9" fontFamily="IBM Plex Mono, monospace" fill={isDark ? '#8D8D8D' : '#64748B'}>
                            {v.toFixed(2)}
                          </text>
                        </g>
                      ))}

                      <line x1={dToX(activeDClamped)} y1={padT} x2={dToX(activeDClamped)} y2={h - padB} stroke={isDark ? '#42BE65' : '#16A34A'} strokeDasharray="4 3" strokeWidth={1.3} />
                      <text x={Math.min(w - 75, dToX(activeDClamped) + 4)} y={padT + 10} fontSize="9" fontFamily="IBM Plex Mono, monospace" fill={isDark ? '#42BE65' : '#15803D'}>
                        Active ρ={activeSuite.graphDensity.toFixed(2)}
                      </text>

                      <path d={buildDensityPath((p) => p.greedy)} fill="none" stroke={isDark ? '#8D8D8D' : '#64748B'} strokeWidth={1.8} strokeDasharray="4 3" />
                      <path d={buildDensityPath((p) => p.simulatedAnnealing)} fill="none" stroke={isDark ? '#F1C21B' : '#D97706'} strokeWidth={2} strokeDasharray="5 2" />
                      <path d={buildDensityPath((p) => p.qaoaP4)} fill="none" stroke={isDark ? '#BE95FF' : '#7C3AED'} strokeWidth={2} />
                      <path d={buildDensityPath((p) => p.bfDcqo)} fill="none" stroke={isDark ? '#42BE65' : '#15803D'} strokeWidth={2.2} />
                      <path d={buildDensityPath((p) => p.cvarQaoa)} fill="none" stroke={isDark ? '#78A9FF' : '#0F62FE'} strokeWidth={2.5} />

                      {activeSuite.densityConvergence.map((pt) => (
                        <g key={pt.density}>
                          <circle cx={dToX(pt.density)} cy={vToY(pt.cvarQaoa)} r={3} fill={isDark ? '#78A9FF' : '#0F62FE'} />
                          <circle cx={dToX(pt.density)} cy={vToY(pt.bfDcqo)} r={2.8} fill={isDark ? '#42BE65' : '#15803D'} />
                          <text x={dToX(pt.density)} y={h - 8} textAnchor="middle" fontSize="9" fontFamily="IBM Plex Mono, monospace" fill={isDark ? '#8D8D8D' : '#64748B'}>
                            {pt.label}
                          </text>
                        </g>
                      ))}
                    </svg>
                  </div>

                  {/* Chart B: Classical Optimizer Parameter Tuning Trajectory */}
                  <div className="rounded-md border border-slate-200 dark:border-[#393939] bg-slate-50/60 dark:bg-[#121212] p-3.5 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                      <span className="font-semibold text-slate-800 dark:text-[#F4F4F4]">
                        Classical Optimizer Convergence ({optimizer} · p={layersP} · {shots.toLocaleString()} shots)
                      </span>
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="inline-flex items-center gap-1 text-[#0F62FE] dark:text-[#78A9FF]">
                          <span className="h-0.5 w-3 bg-[#0F62FE] dark:bg-[#78A9FF]" /> CVaR-QAOA
                        </span>
                        <span className="inline-flex items-center gap-1 text-[#15803D] dark:text-[#42BE65]">
                          <span className="h-0.5 w-3 bg-[#15803D] dark:bg-[#42BE65]" /> BF-DCQO
                        </span>
                        <span className="inline-flex items-center gap-1 text-[#7C3AED] dark:text-[#BE95FF]">
                          <span className="h-0.5 w-3 bg-[#7C3AED] dark:bg-[#BE95FF]" /> QAOA
                        </span>
                        <span className="inline-flex items-center gap-1 text-[#D97706] dark:text-[#F1C21B]">
                          <span className="h-0.5 w-3 bg-[#D97706] dark:bg-[#F1C21B]" /> Sim. Annealing
                        </span>
                      </div>
                    </div>

                    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-[185px]" role="img" aria-label="Classical optimizer convergence trajectory">
                      {yTicks.map((v) => (
                        <g key={v}>
                          <line x1={padL} y1={vToY(v)} x2={w - padR} y2={vToY(v)} stroke={isDark ? '#2A2A2A' : '#E2E8F0'} strokeWidth={1} />
                          <text x={padL - 6} y={vToY(v) + 3} textAnchor="end" fontSize="9" fontFamily="IBM Plex Mono, monospace" fill={isDark ? '#8D8D8D' : '#64748B'}>
                            {v.toFixed(2)}
                          </text>
                        </g>
                      ))}

                      <path d={buildIterPath((p) => p.greedy)} fill="none" stroke={isDark ? '#8D8D8D' : '#64748B'} strokeWidth={1.5} strokeDasharray="3 3" />
                      <path d={buildIterPath((p) => p.simulatedAnnealing)} fill="none" stroke={isDark ? '#F1C21B' : '#D97706'} strokeWidth={1.8} strokeDasharray="5 2" />
                      <path d={buildIterPath((p) => p.qaoa)} fill="none" stroke={isDark ? '#BE95FF' : '#7C3AED'} strokeWidth={2} />
                      <path d={buildIterPath((p) => p.bfDcqo)} fill="none" stroke={isDark ? '#42BE65' : '#15803D'} strokeWidth={2.2} />
                      <path d={buildIterPath((p) => p.cvarQaoa)} fill="none" stroke={isDark ? '#78A9FF' : '#0F62FE'} strokeWidth={2.5} />

                      {[1, 5, 10, 15].map((it) => (
                        <text key={it} x={iToX(it)} y={h - 8} textAnchor="middle" fontSize="9" fontFamily="IBM Plex Mono, monospace" fill={isDark ? '#8D8D8D' : '#64748B'}>
                          Iter {it}
                        </text>
                      ))}
                    </svg>
                  </div>
                </div>
              );
            })()}

            {/* TAB 4: LIVE MICROGRID NETWORK SIMULATION (6–50 NODES) */}
            {studioTab === 'simulation' && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="inline-flex rounded-md border border-slate-200 dark:border-[#525252] bg-slate-50 dark:bg-[#161616] p-0.5">
                    {(
                      [
                        { id: 'after', label: `After: ${quantumAlgorithm}` },
                        { id: 'before', label: 'Before: Unbalanced Stress' },
                        { id: 'diff', label: 'Q vs C Diff' },
                      ] as const
                    ).map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setSimCompareMode(m.id)}
                        className={`px-2.5 py-1 text-xs font-medium rounded whitespace-nowrap ${
                          simCompareMode === m.id
                            ? 'bg-white dark:bg-[#353535] text-slate-900 dark:text-white shadow-xs'
                            : 'text-slate-600 dark:text-[#A8A8A8]'
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() => setSimAnimateFlow((v) => !v)}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-300 dark:border-[#525252] bg-white dark:bg-[#161616] px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-[#E0E0E0]"
                  >
                    {simAnimateFlow ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                    {simAnimateFlow ? 'Pause Flow' : 'Resume Flow'}
                  </button>
                </div>

                <D3GridVisualizer
                  topology={simTopology}
                  pathMode={simPathMode}
                  nodeSizeMode={simTopology.nodes.length > 18 ? 'compact' : 'standard'}
                  selectedNodeId={simSelectedNodeId}
                  onSelectNode={(id) => setSimSelectedNodeId(id)}
                  isPlaying={simAnimateFlow}
                  isDark={isDark}
                  heightClass="h-[360px]"
                />
              </div>
            )}
          </div>

          {/* Compact Backend API Endpoint Indicator */}
          <div className="rounded-md border border-slate-200 dark:border-[#393939] bg-white dark:bg-[#262626] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2">
                <Server className="h-4 w-4 text-[#0F62FE] dark:text-[#78A9FF]" aria-hidden="true" />
                <span className="font-semibold text-slate-900 dark:text-[#F4F4F4]">
                  {backendStatus.backendConnected ? 'Express IBM Simulator API Active' : 'Local Statevector Engine'}
                </span>
              </div>
              <span className="font-mono text-[11px] text-slate-500 dark:text-[#A8A8A8]">
                POST /api/qubo-suite · POST /api/optimize
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Session Dataset Experiment History */}
      {runHistory.length > 0 && (
        <section className="rounded-md border border-slate-200 dark:border-[#393939] bg-white dark:bg-[#262626] p-5">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-[#F4F4F4] pb-3 border-b border-slate-200 dark:border-[#393939]">
            Live & Session Dataset Benchmarks ({runHistory.length})
          </h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-[#393939] text-[11px] font-semibold text-slate-500 dark:text-[#A8A8A8]">
                  <th className="py-2 pr-4">Time</th>
                  <th className="py-2 pr-4">Microgrid Dataset</th>
                  <th className="py-2 pr-4">Solver vs Baseline</th>
                  <th className="py-2 pr-4 text-right">Quantum Acc</th>
                  <th className="py-2 pr-4 text-right">Classical Acc</th>
                  <th className="py-2 pr-4 text-right">Loss Saved</th>
                  <th className="py-2 text-right">Runtime (Q / C)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-[#393939] font-mono tabular-nums">
                {runHistory.map((run) => (
                  <tr key={run.id} className="hover:bg-slate-50 dark:hover:bg-[#353535]">
                    <td className="py-2 pr-4 text-slate-500 dark:text-[#A8A8A8]">{run.timestamp}</td>
                    <td className="py-2 pr-4 font-sans font-medium text-slate-900 dark:text-[#F4F4F4]">
                      {run.datasetName} ({run.nodeCount}N)
                    </td>
                    <td className="py-2 pr-4 font-sans text-slate-600 dark:text-[#C6C6C6]">
                      {run.quantumAlgorithm} vs {run.classicalAlgorithm}
                    </td>
                    <td className="py-2 pr-4 text-right font-semibold text-[#0F62FE] dark:text-[#78A9FF]">
                      {run.quantumMetrics.accuracyPct}%
                    </td>
                    <td className="py-2 pr-4 text-right text-slate-600 dark:text-[#A8A8A8]">
                      {run.classicalMetrics.accuracyPct}%
                    </td>
                    <td className="py-2 pr-4 text-right text-[#15803D] dark:text-[#42BE65]">
                      −{(run.classicalMetrics.lossMW - run.quantumMetrics.lossMW).toFixed(2)} MW
                    </td>
                    <td className="py-2 text-right text-slate-600 dark:text-[#C6C6C6]">
                      {run.quantumMetrics.runtimeMs} / {run.classicalMetrics.runtimeMs} ms
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
