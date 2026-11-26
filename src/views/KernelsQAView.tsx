import { AnimatedNumber } from '../components/AnimatedNumber';
import { InfoTooltip } from '../components/InfoTooltip';
import { useMemo, useState } from 'react';
import { Play } from 'lucide-react';
import type {
  KernelQARecord,
  QiskitBackend,
  QuantumCircuitConfig,
  QuantumCircuitResult,
} from '../types/grid';
import { D3BenchmarkBarChart, D3HistogramChart } from '../components/D3Charts';
import { QuantumCircuitDiagram } from '../components/QuantumCircuitDiagram';
import { StatusIndicator } from '../components/StatusIndicator';

interface KernelsQAViewProps {
  activeBackend: QiskitBackend;
  circuitResult: QuantumCircuitResult;
  qaRecords: KernelQARecord[];
  isDark: boolean;
  onExecuteCircuit: (config: QuantumCircuitConfig) => void;
}

export function KernelsQAView({
  activeBackend,
  circuitResult,
  qaRecords,
  isDark,
  onExecuteCircuit,
}: KernelsQAViewProps) {
  const [ansatz, setAnsatz] = useState<QuantumCircuitConfig['ansatz']>(circuitResult.config.ansatz);
  const [qubits, setQubits] = useState<number>(circuitResult.config.qubits);
  const [layers, setLayers] = useState<number>(circuitResult.config.layers);
  const [shots, setShots] = useState<number>(circuitResult.config.shots);
  const [enableNoise, setEnableNoise] = useState<boolean>(circuitResult.config.enableNoise);

  const [qaStatusFilter, setQaStatusFilter] = useState<'all' | 'pass' | 'warning' | 'fail'>('all');
  const [solverFilter, setSolverFilter] = useState<'all' | 'quantum' | 'classical'>('all');

  const filteredQA = useMemo(() => {
    return qaRecords.filter((rec) => {
      const matchQa = qaStatusFilter === 'all' || rec.qaStatus === qaStatusFilter;
      const matchSolver = solverFilter === 'all' || rec.solverType === solverFilter;
      return matchQa && matchSolver;
    });
  }, [qaRecords, qaStatusFilter, solverFilter]);

  const qaStats = useMemo(() => {
    const passCount = qaRecords.filter((r) => r.qaStatus === 'pass').length;
    const quantumRecs = qaRecords.filter((r) => r.solverType === 'quantum');
    const classicalRecs = qaRecords.filter((r) => r.solverType === 'classical');
    const avgQuantumAcc =
      quantumRecs.length > 0
        ? quantumRecs.reduce((s, r) => s + r.accuracyPct, 0) / quantumRecs.length
        : 0;
    const avgClassicalAcc =
      classicalRecs.length > 0
        ? classicalRecs.reduce((s, r) => s + r.accuracyPct, 0) / classicalRecs.length
        : 0;
    const bestAlignment = Math.max(...qaRecords.map((r) => r.kernelAlignment), 0);

    return {
      passRate: qaRecords.length > 0 ? ((passCount / qaRecords.length) * 100).toFixed(1) : '0.0',
      avgQuantumAcc: avgQuantumAcc.toFixed(1),
      avgClassicalAcc: avgClassicalAcc.toFixed(1),
      bestAlignment: bestAlignment.toFixed(3),
    };
  }, [qaRecords]);

  const handleRun = () => {
    onExecuteCircuit({
      ansatz,
      qubits,
      layers,
      shots,
      backend: activeBackend,
      enableNoise,
      seed: Date.now() % 10000,
    });
  };

  return (
    <div className="space-y-6">
      {/* QA Validation KPI Strip */}
      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="card-interactive rounded-md border border-slate-200 dark:border-[#393939] bg-white dark:bg-[#262626] p-4">
          <div className="text-xs font-medium text-slate-500 dark:text-[#A8A8A8]">
            QA Validation Pass Rate
          </div>
          <div className="mt-1.5 text-2xl font-mono font-semibold text-[#15803D] dark:text-[#42BE65] tabular-nums">
            <AnimatedNumber value={Number(qaStats.passRate)} decimals={1} suffix="%" />
          </div>
          <div className="mt-1.5 text-xs text-slate-500 dark:text-[#A8A8A8]">
            {qaRecords.length} benchmark iterations logged
          </div>
        </div>

        <div className="card-interactive rounded-md border border-slate-200 dark:border-[#393939] bg-white dark:bg-[#262626] p-4">
          <div className="text-xs font-medium text-slate-500 dark:text-[#A8A8A8]">
            Peak Kernel Alignment
          </div>
          <div className="mt-1.5 text-2xl font-mono font-semibold text-[#0F62FE] dark:text-[#78A9FF] tabular-nums">
            <AnimatedNumber value={Number(qaStats.bestAlignment)} decimals={3} />
          </div>
          <div className="mt-1.5 text-xs text-slate-500 dark:text-[#A8A8A8]">
            ZZFeatureMap target Gram matrix
          </div>
        </div>

        <div className="card-interactive rounded-md border border-slate-200 dark:border-[#393939] bg-white dark:bg-[#262626] p-4">
          <div className="text-xs font-medium text-slate-500 dark:text-[#A8A8A8]">
            Quantum vs Classical Mean
          </div>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="text-2xl font-mono font-semibold text-slate-900 dark:text-[#F4F4F4] tabular-nums">
              <AnimatedNumber value={Number(qaStats.avgQuantumAcc)} decimals={1} suffix="%" />
            </span>
            <span className="text-xs font-mono text-slate-500 dark:text-[#A8A8A8] tabular-nums">
              vs {qaStats.avgClassicalAcc}%
            </span>
          </div>
          <div className="mt-1.5 text-xs text-slate-500 dark:text-[#A8A8A8]">
            Cross-dataset validation mean
          </div>
        </div>

        <div className="card-interactive rounded-md border border-slate-200 dark:border-[#393939] bg-white dark:bg-[#262626] p-4">
          <div className="text-xs font-medium text-slate-500 dark:text-[#A8A8A8]">
            Active Circuit Fidelity
          </div>
          <div className="mt-1.5 text-2xl font-mono font-semibold text-slate-900 dark:text-[#F4F4F4] tabular-nums">
            <AnimatedNumber value={circuitResult.fidelity * 100} decimals={2} suffix="%" />
          </div>
          <div className="mt-1.5 text-xs font-mono text-slate-500 dark:text-[#A8A8A8] tabular-nums">
            Approx Ratio {circuitResult.approximationRatio.toFixed(3)} · {circuitResult.executionMs} ms
          </div>
        </div>
      </section>

      {/* Interactive Quantum Circuit Simulator + Measurement Histogram */}
      <section className="rounded-md border border-slate-200 dark:border-[#393939] bg-white dark:bg-[#262626] p-5 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-slate-200 dark:border-[#393939]">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-[#F4F4F4]">
              Qiskit Quantum Circuit Simulator
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-[#A8A8A8]">
              Execute parameterized QAOA, VQE, or ZZFeatureMap kernel circuits and inspect eigenstate sampling fidelity.
            </p>
          </div>
          <button
            type="button"
            onClick={handleRun}
            className="inline-flex items-center gap-1.5 rounded-md bg-[#0F62FE] px-4 py-2 text-xs font-medium text-white hover:bg-[#0353E9] transition-colors whitespace-nowrap shrink-0"
          >
            <Play className="h-3.5 w-3.5" aria-hidden="true" />
            Execute Circuit Simulation
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div>
            <label
              htmlFor="ansatz-select"
              className="block text-xs font-medium text-slate-600 dark:text-[#A8A8A8] mb-1"
            >
              Ansatz / Kernel
              <InfoTooltip text="QUBO is the grid load-balancing problem rewritten as yes/no choices that a quantum computer can score; QAOA is a circuit that searches for the best choices." />
            </label>
            <select
              id="ansatz-select"
              value={ansatz}
              onChange={(e) => setAnsatz(e.target.value as QuantumCircuitConfig['ansatz'])}
              className="w-full rounded-md border border-slate-300 dark:border-[#525252] bg-white dark:bg-[#161616] px-2.5 py-2 text-xs text-slate-800 dark:text-[#E0E0E0] focus:border-[#0F62FE] focus:outline-none"
            >
              <option value="QAOA">QAOA (Grid QUBO)</option>
              <option value="ZZFeatureMap Kernel">ZZFeatureMap Kernel</option>
              <option value="VQE RealAmplitudes">VQE RealAmplitudes</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="qubits-select"
              className="block text-xs font-medium text-slate-600 dark:text-[#A8A8A8] mb-1"
            >
              Qubit Register
            </label>
            <select
              id="qubits-select"
              value={qubits}
              onChange={(e) => setQubits(Number(e.target.value))}
              className="w-full rounded-md border border-slate-300 dark:border-[#525252] bg-white dark:bg-[#161616] px-2.5 py-2 text-xs font-mono text-slate-800 dark:text-[#E0E0E0] focus:border-[#0F62FE] focus:outline-none"
            >
              {[4, 5, 6, 7, 8].map((q) => (
                <option key={q} value={q}>
                  {q} Qubits
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="layers-select"
              className="block text-xs font-medium text-slate-600 dark:text-[#A8A8A8] mb-1"
            >
              Circuit Depth (p)
              <InfoTooltip text="How many times the quantum circuit repeats its steps. More layers can give better answers but run slower and noisier." />
            </label>
            <select
              id="layers-select"
              value={layers}
              onChange={(e) => setLayers(Number(e.target.value))}
              className="w-full rounded-md border border-slate-300 dark:border-[#525252] bg-white dark:bg-[#161616] px-2.5 py-2 text-xs font-mono text-slate-800 dark:text-[#E0E0E0] focus:border-[#0F62FE] focus:outline-none"
            >
              {[1, 2, 3, 4].map((p) => (
                <option key={p} value={p}>
                  p = {p} layer{p > 1 ? 's' : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="shots-select"
              className="block text-xs font-medium text-slate-600 dark:text-[#A8A8A8] mb-1"
            >
              Sampling Shots
            </label>
            <select
              id="shots-select"
              value={shots}
              onChange={(e) => setShots(Number(e.target.value))}
              className="w-full rounded-md border border-slate-300 dark:border-[#525252] bg-white dark:bg-[#161616] px-2.5 py-2 text-xs font-mono text-slate-800 dark:text-[#E0E0E0] focus:border-[#0F62FE] focus:outline-none"
            >
              <option value={1024}>1,024 shots</option>
              <option value={4096}>4,096 shots</option>
              <option value={8192}>8,192 shots</option>
            </select>
          </div>

          <div className="flex items-end">
            <label className="flex w-full items-center justify-between rounded-md border border-slate-300 dark:border-[#525252] bg-slate-50 dark:bg-[#161616] px-3 py-2 text-xs font-medium text-slate-700 dark:text-[#E0E0E0] cursor-pointer">
              <span>Hardware Noise</span>
              <input
                type="checkbox"
                checked={enableNoise}
                onChange={(e) => setEnableNoise(e.target.checked)}
                className="h-4 w-4 accent-[#0F62FE]"
              />
            </label>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          <div className="xl:col-span-7">
            <QuantumCircuitDiagram result={circuitResult} isDark={isDark} />
          </div>
          <div className="xl:col-span-5 rounded-md border border-slate-200 dark:border-[#393939] bg-slate-50/50 dark:bg-[#1E1E1E] p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-slate-900 dark:text-[#F4F4F4]">
                Measured Dispatch Eigenstates ({circuitResult.config.shots.toLocaleString()} shots)
              </h3>
              <span className="text-[11px] font-mono text-[#0F62FE] dark:text-[#78A9FF]">
                Optimal: {circuitResult.bitstrings[0]?.bitstring}
              </span>
            </div>
            <D3HistogramChart bitstrings={circuitResult.bitstrings} isDark={isDark} />
            <div className="mt-2 flex items-center justify-between border-t border-slate-200 dark:border-[#393939] pt-2.5 text-[11px] font-mono tabular-nums text-slate-600 dark:text-[#A8A8A8]">
              <span>Quantum Ratio: {circuitResult.approximationRatio.toFixed(4)}</span>
              <span>Classical Baseline: {circuitResult.classicalBaselineRatio.toFixed(4)}</span>
            </div>
          </div>
        </div>
      </section>

      {/* Full-Width Model Benchmarking & QA Validation Suite (Complete View — Zero Half-Split) */}
      <section className="rounded-md border border-slate-200 dark:border-[#393939] bg-white dark:bg-[#262626] p-5 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-200 dark:border-[#393939]">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-[#F4F4F4]">
              Model Benchmarking & QA Validation Suite
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-[#A8A8A8]">
              Complete cross-iteration accuracy comparison and QA validation ledger ({filteredQA.length} of {qaRecords.length} benchmark runs shown).
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-md border border-slate-200 dark:border-[#525252] bg-slate-50 dark:bg-[#161616] p-0.5">
              {(['all', 'quantum', 'classical'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSolverFilter(s)}
                  className={`px-2.5 py-1 text-xs font-medium rounded capitalize whitespace-nowrap ${
                    solverFilter === s
                      ? 'bg-white dark:bg-[#353535] text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-[#A8A8A8] hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
            <div className="inline-flex rounded-md border border-slate-200 dark:border-[#525252] bg-slate-50 dark:bg-[#161616] p-0.5">
              {(['all', 'pass', 'warning', 'fail'] as const).map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => setQaStatusFilter(q)}
                  className={`px-2.5 py-1 text-xs font-medium rounded capitalize whitespace-nowrap ${
                    qaStatusFilter === q
                      ? 'bg-white dark:bg-[#353535] text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-[#A8A8A8] hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Full-Width Accuracy Benchmark Bar Chart */}
        <div className="rounded-md border border-slate-200 dark:border-[#393939] bg-slate-50/50 dark:bg-[#1E1E1E] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3 text-xs">
            <span className="font-semibold text-slate-800 dark:text-[#F4F4F4]">
              Accuracy & Runtime Comparison Across Benchmarked Models
            </span>
            <div className="flex items-center gap-5 text-slate-600 dark:text-[#A8A8A8]">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-xs bg-[#0F62FE] dark:bg-[#4589FF]" aria-hidden="true" />
                Quantum Kernel / Variational
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-xs bg-slate-500 dark:bg-[#6F6F6F]" aria-hidden="true" />
                Classical Solver
              </span>
            </div>
          </div>
          <D3BenchmarkBarChart records={filteredQA} isDark={isDark} />
        </div>

        {/* Full-Width QA Validation Logs Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-[#393939] text-[11px] font-semibold text-slate-500 dark:text-[#A8A8A8]">
                <th className="py-2.5 pr-4">Run ID</th>
                <th className="py-2.5 pr-4">Model / Kernel</th>
                <th className="py-2.5 pr-4">Dataset</th>
                <th className="py-2.5 pr-4">QA Status</th>
                <th className="py-2.5 pr-4 text-right">Alignment</th>
                <th className="py-2.5 pr-4 text-right">Accuracy</th>
                <th className="py-2.5 pr-4 text-right">Shot Var</th>
                <th className="py-2.5 text-right">Runtime</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-[#393939] text-xs">
              {filteredQA.map((rec) => (
                <tr key={rec.id} className="hover:bg-slate-50/80 dark:hover:bg-[#353535]">
                  <td className="py-2.5 pr-4 font-mono text-slate-500 dark:text-[#A8A8A8] whitespace-nowrap">
                    {rec.runId}
                  </td>
                  <td className="py-2.5 pr-4">
                    <div className="font-medium text-slate-900 dark:text-[#F4F4F4] whitespace-nowrap">
                      {rec.modelName}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-[#A8A8A8] whitespace-nowrap">
                      {rec.kernelOrAnsatz}
                    </div>
                  </td>
                  <td className="py-2.5 pr-4 text-slate-600 dark:text-[#C6C6C6] whitespace-nowrap">
                    {rec.datasetName}
                  </td>
                  <td className="py-2.5 pr-4 whitespace-nowrap">
                    <StatusIndicator status={rec.qaStatus} compact badgeStyle />
                  </td>
                  <td className="py-2.5 pr-4 text-right font-mono tabular-nums text-slate-800 dark:text-[#E0E0E0]">
                    {rec.kernelAlignment.toFixed(3)}
                  </td>
                  <td
                    className={`py-2.5 pr-4 text-right font-mono font-semibold tabular-nums ${
                      rec.solverType === 'quantum'
                        ? 'text-[#0F62FE] dark:text-[#78A9FF]'
                        : 'text-slate-700 dark:text-[#C6C6C6]'
                    }`}
                  >
                    {rec.accuracyPct.toFixed(1)}%
                  </td>
                  <td className="py-2.5 pr-4 text-right font-mono tabular-nums text-slate-600 dark:text-[#A8A8A8]">
                    {rec.shotVariance === 0 ? '—' : rec.shotVariance.toFixed(4)}
                  </td>
                  <td className="py-2.5 text-right font-mono tabular-nums text-slate-600 dark:text-[#A8A8A8] whitespace-nowrap">
                    {rec.runtimeMs} ms
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
