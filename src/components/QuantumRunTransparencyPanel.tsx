import { useState } from 'react';
import {
  ArrowRight,
  Check,
  Code2,
  Copy,
  Cpu,
  Download,
  FlaskConical,
  Layers,
  Loader2,
  Table2,
} from 'lucide-react';
import type {
  GridTopology,
  QiskitBackend,
  QuantumAlgorithm,
  QuantumOptimizationReport,
} from '../types/grid';
import { StatusIndicator } from './StatusIndicator';

interface QuantumRunTransparencyPanelProps {
  report: QuantumOptimizationReport | null;
  topology: GridTopology;
  activeBackend: QiskitBackend;
  algorithm: QuantumAlgorithm;
  layersP: number;
  shots: number;
  isRunning: boolean;
  onInspectNode: (nodeId: string) => void;
}

export function QuantumRunTransparencyPanel({
  report,
  topology,
  algorithm,
  layersP,
  shots,
  isRunning,
  onInspectNode,
}: QuantumRunTransparencyPanelProps) {
  const [activeSubTab, setActiveSubTab] = useState<'buses' | 'shots' | 'circuit'>('buses');
  const [codeFormat, setCodeFormat] = useState<'qasm' | 'qiskit'>('qasm');
  const [copied, setCopied] = useState(false);

  const handleCopyCode = async () => {
    if (!report) return;
    const text = codeFormat === 'qasm' ? report.openQasm3 : report.qiskitCode;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard may be unavailable in restricted contexts
    }
  };

  const handleExportReportJson = () => {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], {
      type: 'application/json;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `quantum_simulator_audit_${report.jobId}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (!report) {
    return (
      <section
        aria-label="Quantum simulator output"
        data-testid="quantum-transparency-ready"
        className="rounded-md border border-dashed border-slate-300 dark:border-[#525252] bg-white/70 dark:bg-[#262626]/60 px-5 py-6"
      >
        <div className="flex flex-col items-center justify-center text-center gap-1.5">
          {isRunning ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin text-[#0F62FE] dark:text-[#78A9FF]" aria-hidden="true" />
              <div className="text-xs font-medium text-slate-800 dark:text-[#F4F4F4]">
                Running {algorithm} (p={layersP}, {shots.toLocaleString()} shots) on {topology.name}...
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-[#E0E0E0]">
                <Cpu className="h-3.5 w-3.5 text-slate-400 dark:text-[#8D8D8D]" aria-hidden="true" />
                Quantum Simulator Output
              </div>
              <p className="text-xs text-slate-500 dark:text-[#A8A8A8]">
                Simulation results for {topology.name} will appear here after running the quantum simulator.
              </p>
            </>
          )}
        </div>
      </section>
    );
  }

  const gainVsGreedy = Number(
    (report.quantumResult.accuracyPct - report.classicalBaseline.accuracyPct).toFixed(1)
  );
  const gainVsSa = Number(
    (report.quantumResult.accuracyPct - report.annealingBaseline.accuracyPct).toFixed(1)
  );
  const activeBusCount = report.nodeDecisions.filter((d) => d.quantumBit === 1).length;
  const maxShotProb = Math.max(
    0.01,
    ...report.quantumResult.topBitstrings.map((b) => b.probability)
  );

  return (
    <section
      aria-label="Quantum simulator output"
      data-testid="quantum-transparency-panel"
      className="rounded-md border border-[#0F62FE]/35 dark:border-[#4589FF]/40 bg-white dark:bg-[#262626] p-5 space-y-5"
    >
      {/* Header & Honest Execution Provenance */}
      <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-slate-200 dark:border-[#393939]">
        <div className="space-y-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <FlaskConical className="h-4 w-4 text-[#0F62FE] dark:text-[#78A9FF] shrink-0" aria-hidden="true" />
            <h2 className="text-base font-semibold text-slate-900 dark:text-[#F4F4F4]">
              Quantum Simulator Output
            </h2>
            <span className="rounded border border-[#0F62FE]/30 dark:border-[#78A9FF]/35 bg-[#0F62FE]/8 dark:bg-[#0F62FE]/20 px-2 py-0.5 text-[11px] font-mono font-medium text-[#0F62FE] dark:text-[#78A9FF]">
              {report.executionEngineLabel}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-[#A8A8A8] font-mono tabular-nums">
            Job {report.jobId} · Executed on{' '}
            {report.executionLocation === 'server_api'
              ? 'Backend Server (/api/optimize-grid)'
              : 'Browser Local Engine'}{' '}
            · {report.algorithm} ({report.optimizer}, p={report.layersP}, {report.shots.toLocaleString()} shots) ·{' '}
            {report.runtimeMs} ms wall time
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <span
            className={`rounded border px-2 py-1 text-[11px] font-mono ${
              report.backendNoiseEnabled
                ? 'border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-[#F1C21B]'
                : 'border-emerald-300 dark:border-emerald-800/60 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-[#42BE65]'
            }`}
          >
            {report.backendNoiseEnabled
              ? `Simulated Noise (${report.backend.split(' ')[0]}: ε2Q=${(report.noiseProfile.twoQubitErrorRate * 100).toFixed(2)}%, εRO=${(report.noiseProfile.readoutErrorRate * 100).toFixed(1)}%, T2=${report.noiseProfile.t2Us}µs)`
              : `Ideal Noiseless Statevector (${report.backend.split(' ')[0]})`}
          </span>

          <button
            type="button"
            onClick={handleExportReportJson}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 dark:border-[#525252] bg-white dark:bg-[#161616] px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-[#E0E0E0] hover:bg-slate-50 dark:hover:bg-[#353535] transition-colors whitespace-nowrap"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            Export Audit JSON
          </button>
        </div>
      </div>

      {/* 4 Crisp Real Value Verification Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5">
        {/* Card 1: Measured Quantum State & QUBO Energy */}
        <div className="rounded-md border border-slate-200 dark:border-[#393939] bg-slate-50/70 dark:bg-[#1E1E1E] p-3.5 space-y-1.5">
          <div className="text-[11px] font-medium text-slate-500 dark:text-[#A8A8A8]">
            Measured Bitstring & QUBO Energy
          </div>
          <div className="text-base font-mono font-semibold text-[#0F62FE] dark:text-[#78A9FF] truncate" title={report.quantumResult.optimalBitstring}>
            {report.quantumResult.optimalBitstring}
          </div>
          <div className="text-xs font-mono text-slate-700 dark:text-[#E0E0E0] tabular-nums space-y-0.5">
            <div>
              Achieved E: <span className="font-semibold">{report.quantumResult.achievedQuboEnergy}</span> · ⟨H_C⟩:{' '}
              {report.quantumResult.expectationQuboEnergy}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-[#A8A8A8]">
              {report.quboSummary.exactGroundStateKnown ? 'Exact Ground E_min' : 'Ref E_min'}:{' '}
              {report.quboSummary.exactGroundEnergy} · r = {report.quantumResult.approxRatio} ({report.quantumResult.accuracyPct}%)
            </div>
          </div>
        </div>

        {/* Card 2: Head-to-Head Same-QUBO Baselines */}
        <div className="rounded-md border border-slate-200 dark:border-[#393939] bg-slate-50/70 dark:bg-[#1E1E1E] p-3.5 space-y-1.5">
          <div className="text-[11px] font-medium text-slate-500 dark:text-[#A8A8A8]">
            Same-QUBO Solver Comparison
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-mono font-semibold text-slate-900 dark:text-[#F4F4F4] tabular-nums">
              {report.quantumResult.accuracyPct}%
            </span>
            <span
              className={`text-xs font-mono font-medium tabular-nums ${
                gainVsGreedy >= 0
                  ? 'text-[#15803D] dark:text-[#42BE65]'
                  : 'text-[#B45309] dark:text-[#F1C21B]'
              }`}
            >
              {gainVsGreedy >= 0 ? `+${gainVsGreedy}%` : `${gainVsGreedy}%`} vs Greedy
            </span>
          </div>
          <div className="text-[11px] font-mono text-slate-600 dark:text-[#C6C6C6] tabular-nums space-y-0.5">
            <div>
              Greedy: {report.classicalBaseline.accuracyPct}% (E={report.classicalBaseline.achievedQuboEnergy})
            </div>
            <div>
              Sim. Annealing: {report.annealingBaseline.accuracyPct}% (E={report.annealingBaseline.achievedQuboEnergy}, Δ
              {gainVsSa >= 0 ? `+${gainVsSa}` : gainVsSa}%)
            </div>
          </div>
        </div>

        {/* Card 3: Physical Grid Before -> After */}
        <div className="rounded-md border border-slate-200 dark:border-[#393939] bg-slate-50/70 dark:bg-[#1E1E1E] p-3.5 space-y-1.5">
          <div className="text-[11px] font-medium text-slate-500 dark:text-[#A8A8A8]">
            Physical Grid Delta (Before → After)
          </div>
          <div className="flex items-baseline gap-2 font-mono tabular-nums">
            <span className="text-sm text-slate-500 dark:text-[#A8A8A8]">
              {report.beforeSummary.totalLossMW}
            </span>
            <ArrowRight className="h-3 w-3 text-slate-400 shrink-0" aria-hidden="true" />
            <span className="text-lg font-semibold text-[#15803D] dark:text-[#42BE65]">
              {report.afterSummary.totalLossMW} MW
            </span>
            <span className="text-xs text-[#15803D] dark:text-[#42BE65]">
              ({report.lossReductionPct >= 0 ? `−${report.lossReductionPct}%` : `+${Math.abs(report.lossReductionPct)}%`})
            </span>
          </div>
          <div className="text-[11px] font-mono text-slate-600 dark:text-[#C6C6C6] tabular-nums space-y-0.5">
            <div>
              Health: {report.beforeSummary.healthIndex}% → {report.afterSummary.healthIndex}% ({report.afterSummary.healthyCount}G/{report.afterSummary.warningCount}Y/{report.afterSummary.alarmingCount}R)
            </div>
            <div>
              Avg Voltage: {report.beforeSummary.avgVoltagePU} → {report.afterSummary.avgVoltagePU} p.u.
            </div>
          </div>
        </div>

        {/* Card 4: Circuit & Microgrid Economics */}
        <div className="rounded-md border border-slate-200 dark:border-[#393939] bg-slate-50/70 dark:bg-[#1E1E1E] p-3.5 space-y-1.5">
          <div className="text-[11px] font-medium text-slate-500 dark:text-[#A8A8A8]">
            Circuit Telemetry & Dispatch KPIs
          </div>
          <div className="text-sm font-mono font-semibold text-slate-900 dark:text-[#F4F4F4] tabular-nums">
            {report.qubits}q · 2^{report.partitionBlockSize ?? report.qubits} ({report.stateSpaceDim.toLocaleString()}) · Depth {report.circuitDepth}
          </div>
          <div className="text-[11px] font-mono text-slate-600 dark:text-[#C6C6C6] tabular-nums space-y-0.5">
            <div>
              2Q Gates: {report.twoQubitGates} · Fidelity: {report.fidelityPct}% · {report.iterations} iters
            </div>
            <div>
              Demand {report.quantumResult.demandMetPct}% · Ren. {report.quantumResult.renewableUtilPct}% · Save $
              {report.quantumResult.costSavedDailyUsd.toLocaleString()}/d
            </div>
          </div>
        </div>
      </div>

      {/* Transparency Sub-Tab Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-[#393939] pb-2.5">
        <div
          role="tablist"
          aria-label="Quantum audit inspection views"
          className="inline-flex items-center rounded-md border border-slate-200 dark:border-[#525252] bg-slate-50 dark:bg-[#161616] p-0.5"
        >
          {(
            [
              {
                id: 'buses',
                label: `Bus-by-Bus Qubit Decisions (${activeBusCount}/${report.qubits} Active)`,
                icon: Table2,
              },
              {
                id: 'shots',
                label: `Shot Histogram & Angles (${report.shots.toLocaleString()} shots)`,
                icon: Layers,
              },
              {
                id: 'circuit',
                label: 'OpenQASM 3.0 & Qiskit Circuit',
                icon: Code2,
              },
            ] as const
          ).map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeSubTab === tab.id}
                onClick={() => setActiveSubTab(tab.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                  activeSubTab === tab.id
                    ? 'bg-white dark:bg-[#353535] text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-[#A8A8A8] hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="text-[11px] font-mono text-slate-500 dark:text-[#A8A8A8] tabular-nums">
          QUBO: {report.quboSummary.linearTerms} linear + {report.quboSummary.quadraticTerms} couplings · Ising offset C₀ ={' '}
          {report.quboSummary.isingOffset}
        </div>
      </div>

      {/* Sub-Tab 1: Bus-by-Bus Qubit Mapping Table */}
      {activeSubTab === 'buses' && (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-[#393939] text-[11px] font-semibold text-slate-500 dark:text-[#A8A8A8]">
                <th className="py-2 pr-3">Qubit</th>
                <th className="py-2 pr-3">Bus</th>
                <th className="py-2 pr-3 text-right">Q_ii</th>
                <th className="py-2 pr-3 text-right">Ising h_i</th>
                <th className="py-2 pr-3">Quantum Bit x_i</th>
                <th className="py-2 pr-3 text-center">Greedy c_i</th>
                <th className="py-2 pr-3 text-right">Load (MW)</th>
                <th className="py-2 pr-3 text-right">Voltage (p.u.)</th>
                <th className="py-2 pr-3 text-right">Temp (°C)</th>
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-[#393939] text-xs">
              {report.nodeDecisions.map((row) => (
                <tr
                  key={row.nodeId}
                  className="hover:bg-slate-50/80 dark:hover:bg-[#353535] transition-colors"
                >
                  <td className="py-2 pr-3 font-mono text-slate-500 dark:text-[#A8A8A8] tabular-nums">
                    q[{row.qubitIndex}]
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => onInspectNode(row.nodeId)}
                      className="font-medium text-slate-900 dark:text-[#F4F4F4] hover:text-[#0F62FE] dark:hover:text-[#78A9FF] hover:underline text-left"
                    >
                      <span className="font-mono text-slate-500 dark:text-[#A8A8A8] mr-1.5">{row.nodeId}</span>
                      {row.nodeName}
                    </button>
                  </td>
                  <td className="py-2 pr-3 text-right font-mono tabular-nums text-slate-700 dark:text-[#C6C6C6]">
                    {row.quboLinearQii.toFixed(2)}
                  </td>
                  <td className="py-2 pr-3 text-right font-mono tabular-nums text-slate-600 dark:text-[#A8A8A8]">
                    {row.isingFieldHi.toFixed(3)}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    <span
                      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[11px] font-medium ${
                        row.quantumBit === 1
                          ? 'bg-[#0F62FE]/12 dark:bg-[#0F62FE]/25 text-[#0F62FE] dark:text-[#78A9FF]'
                          : 'bg-slate-100 dark:bg-[#353535] text-slate-600 dark:text-[#C6C6C6]'
                      }`}
                    >
                      x={row.quantumBit} · {row.quantumBit === 1 ? 'Active Dispatch' : 'Passive / Tie'}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-center font-mono tabular-nums text-slate-600 dark:text-[#A8A8A8]">
                    {row.classicalBit}
                  </td>
                  <td className="py-2 pr-3 text-right font-mono tabular-nums whitespace-nowrap text-slate-800 dark:text-[#E0E0E0]">
                    <span className="text-slate-400 dark:text-[#8D8D8D]">{row.beforeLoadMW}</span> →{' '}
                    <span className="font-semibold">{row.afterLoadMW}</span>
                  </td>
                  <td className="py-2 pr-3 text-right font-mono tabular-nums whitespace-nowrap text-slate-700 dark:text-[#C6C6C6]">
                    <span className="text-slate-400 dark:text-[#8D8D8D]">{row.beforeVoltagePU}</span> →{' '}
                    {row.afterVoltagePU}
                  </td>
                  <td className="py-2 pr-3 text-right font-mono tabular-nums whitespace-nowrap text-slate-700 dark:text-[#C6C6C6]">
                    <span className="text-slate-400 dark:text-[#8D8D8D]">{row.beforeTempC}</span> →{' '}
                    {row.afterTempC}
                  </td>
                  <td className="py-2 whitespace-nowrap">
                    <div className="inline-flex items-center gap-1.5">
                      <StatusIndicator status={row.beforeStatus} compact />
                      {row.beforeStatus !== row.afterStatus && (
                        <>
                          <ArrowRight className="h-3 w-3 text-slate-400" aria-hidden="true" />
                          <StatusIndicator status={row.afterStatus} compact />
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Sub-Tab 2: Shot Histogram, Variational Angles & QUBO Penalties */}
      {activeSubTab === 'shots' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-7 space-y-2.5">
            <div className="text-xs font-semibold text-slate-900 dark:text-[#F4F4F4]">
              Top Measured Bitstrings ({report.shots.toLocaleString()} Born-Rule Shots)
            </div>
            {report.quantumResult.topBitstrings.length === 0 ? (
              <div className="rounded border border-slate-200 dark:border-[#393939] p-4 text-xs text-slate-500 dark:text-[#A8A8A8]">
                No shot histogram captured for this solver mode.
              </div>
            ) : (
              <div className="space-y-2">
                {report.quantumResult.topBitstrings.map((entry, idx) => (
                  <div
                    key={`${entry.bitstring}-${idx}`}
                    className="rounded border border-slate-200 dark:border-[#393939] bg-slate-50/70 dark:bg-[#1E1E1E] px-3 py-2 space-y-1"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono tabular-nums">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-900 dark:text-[#F4F4F4]">
                          {entry.bitstring}
                        </span>
                        {entry.isOptimal && (
                          <span className="rounded bg-emerald-100 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-800 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800 dark:text-[#42BE65]">
                            Ground / Best
                          </span>
                        )}
                      </div>
                      <div className="text-slate-600 dark:text-[#C6C6C6]">
                        {entry.counts.toLocaleString()} shots ({(entry.probability * 100).toFixed(1)}%) · E ={' '}
                        <span className="font-semibold text-slate-900 dark:text-[#F4F4F4]">{entry.energyCost}</span>
                      </div>
                    </div>
                    <div className="h-1.5 w-full rounded bg-slate-200 dark:bg-[#353535] overflow-hidden">
                      <div
                        className={`h-full rounded ${
                          entry.isOptimal
                            ? 'bg-[#16A34A] dark:bg-[#42BE65]'
                            : 'bg-[#0F62FE] dark:bg-[#78A9FF]'
                        }`}
                        style={{
                          width: `${Math.max(4, Math.min(100, (entry.probability / maxShotProb) * 100))}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="lg:col-span-5 space-y-4">
            <div className="rounded-md border border-slate-200 dark:border-[#393939] bg-slate-50/70 dark:bg-[#1E1E1E] p-3.5 space-y-2">
              <div className="text-xs font-semibold text-slate-900 dark:text-[#F4F4F4]">
                Optimized Variational Parameters ({report.optimizer})
              </div>
              <div className="flex flex-wrap gap-1.5 font-mono text-[11px] tabular-nums">
                {report.quantumResult.optimalAngles.map((angle, idx) => {
                  const isGamma = idx < report.layersP;
                  const label =
                    report.algorithm === 'VQA' || report.algorithm === 'VQE'
                      ? `θ${idx + 1}`
                      : isGamma
                      ? `γ${idx + 1}`
                      : `β${idx - report.layersP + 1}`;
                  return (
                    <span
                      key={idx}
                      className="rounded border border-slate-200 dark:border-[#525252] bg-white dark:bg-[#161616] px-2 py-1 text-slate-700 dark:text-[#E0E0E0]"
                    >
                      {label} = {angle.toFixed(4)}
                    </span>
                  );
                })}
              </div>
            </div>

            <div className="rounded-md border border-slate-200 dark:border-[#393939] bg-slate-50/70 dark:bg-[#1E1E1E] p-3.5 space-y-2">
              <div className="text-xs font-semibold text-slate-900 dark:text-[#F4F4F4]">
                QUBO & Ising Hamiltonian Formulation
              </div>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs font-mono tabular-nums">
                <dt className="text-slate-500 dark:text-[#A8A8A8]">λ_balance</dt>
                <dd className="text-right text-slate-900 dark:text-[#F4F4F4]">
                  {report.quboSummary.penalties.demandBalance}
                </dd>
                <dt className="text-slate-500 dark:text-[#A8A8A8]">λ_thermal</dt>
                <dd className="text-right text-slate-900 dark:text-[#F4F4F4]">
                  {report.quboSummary.penalties.thermalOverload}
                </dd>
                <dt className="text-slate-500 dark:text-[#A8A8A8]">λ_renewable</dt>
                <dd className="text-right text-slate-900 dark:text-[#F4F4F4]">
                  {report.quboSummary.penalties.renewableCurtailment}
                </dd>
                <dt className="text-slate-500 dark:text-[#A8A8A8]">λ_voltage/SoC</dt>
                <dd className="text-right text-slate-900 dark:text-[#F4F4F4]">
                  {report.quboSummary.penalties.batterySoc}
                </dd>
                <dt className="text-slate-500 dark:text-[#A8A8A8]">Ising Scale σ_H</dt>
                <dd className="text-right text-slate-900 dark:text-[#F4F4F4]">
                  {report.quboSummary.energyScale}
                </dd>
                <dt className="text-slate-500 dark:text-[#A8A8A8]">Energy Range</dt>
                <dd className="text-right text-slate-900 dark:text-[#F4F4F4]">
                  [{report.quboSummary.exactGroundEnergy}, {report.quboSummary.worstEnergy}]
                </dd>
                {report.quboSummary.exactOptimalBitstring && (
                  <>
                    <dt className="text-slate-500 dark:text-[#A8A8A8]">Exact Ground |x*⟩</dt>
                    <dd className="text-right text-[#15803D] dark:text-[#42BE65] truncate">
                      {report.quboSummary.exactOptimalBitstring}
                    </dd>
                  </>
                )}
              </dl>
            </div>
          </div>
        </div>
      )}

      {/* Sub-Tab 3: OpenQASM 3.0 & Qiskit Python Circuit */}
      {activeSubTab === 'circuit' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex items-center rounded-md border border-slate-200 dark:border-[#525252] bg-slate-50 dark:bg-[#161616] p-0.5">
              <button
                type="button"
                onClick={() => setCodeFormat('qasm')}
                className={`px-2.5 py-1 text-xs font-medium rounded ${
                  codeFormat === 'qasm'
                    ? 'bg-white dark:bg-[#353535] text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-[#A8A8A8]'
                }`}
              >
                OpenQASM 3.0
              </button>
              <button
                type="button"
                onClick={() => setCodeFormat('qiskit')}
                className={`px-2.5 py-1 text-xs font-medium rounded ${
                  codeFormat === 'qiskit'
                    ? 'bg-white dark:bg-[#353535] text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-[#A8A8A8]'
                }`}
              >
                Qiskit Python
              </button>
            </div>

            <button
              type="button"
              onClick={() => void handleCopyCode()}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 dark:border-[#525252] bg-white dark:bg-[#161616] px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-[#E0E0E0] hover:bg-slate-50 dark:hover:bg-[#353535]"
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5 text-[#16A34A] dark:text-[#42BE65]" aria-hidden="true" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                  Copy {codeFormat === 'qasm' ? 'OpenQASM 3.0' : 'Qiskit Code'}
                </>
              )}
            </button>
          </div>

          <pre className="max-h-72 overflow-auto rounded-md border border-slate-200 dark:border-[#393939] bg-slate-950 text-slate-100 p-3.5 text-[11px] font-mono leading-relaxed">
            <code>{codeFormat === 'qasm' ? report.openQasm3 : report.qiskitCode}</code>
          </pre>
        </div>
      )}
    </section>
  );
}
