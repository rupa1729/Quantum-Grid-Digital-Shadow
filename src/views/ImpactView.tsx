import { useMemo, useState } from 'react';
import { Briefcase, Filter, Leaf, RotateCcw, ShieldCheck, TrendingUp, Zap } from 'lucide-react';
import type {
  AccuracyTimelinePoint,
  ClimateConditions,
  ConstraintId,
  ConstraintPerformanceRow,
  ExploreRunResult,
  GridTopology,
  QiskitBackend,
} from '../types/grid';
import { CONSTRAINT_CATALOG, CONSTRAINT_IDS } from '../constants';
import {
  applyClimateFactors,
  computeBusinessImpactMetrics,
  computeImpactSummary,
  runExploreComparison,
} from '../engine/quantumGridEngine';
import { D3AccuracyTrendChart } from '../components/D3Charts';

interface ImpactViewProps {
  timeline: AccuracyTimelinePoint[];
  constraintRows: ConstraintPerformanceRow[];
  topology: GridTopology;
  climate: ClimateConditions;
  activeBackend: QiskitBackend;
  latestExplore: ExploreRunResult | null;
  isDark: boolean;
}

export function ImpactView({
  timeline,
  constraintRows,
  topology,
  climate,
  activeBackend,
  latestExplore,
  isDark,
}: ImpactViewProps) {
  const [selectedConstraints, setSelectedConstraints] = useState<ConstraintId[]>([]);
  const [scaleFilter, setScaleFilter] = useState<'all' | 'small' | 'medium' | 'regional'>('all');
  const [maxLatencyMs, setMaxLatencyMs] = useState<number>(600);

  const impact = useMemo(
    () =>
      computeImpactSummary(
        timeline,
        constraintRows,
        selectedConstraints,
        scaleFilter,
        maxLatencyMs
      ),
    [timeline, constraintRows, selectedConstraints, scaleFilter, maxLatencyMs]
  );

  const effectiveConstraints =
    selectedConstraints.length > 0 ? selectedConstraints : CONSTRAINT_IDS;

  const climateTopology = useMemo(
    () => applyClimateFactors(topology, climate),
    [topology, climate]
  );

  const activeRun = useMemo(() => {
    if (
      latestExplore &&
      selectedConstraints.length === 0 &&
      scaleFilter === 'all'
    ) {
      return latestExplore;
    }
    return runExploreComparison({
      topology,
      quantumAlgorithm: latestExplore?.quantumAlgorithm ?? 'QAOA',
      classicalAlgorithm: latestExplore?.classicalAlgorithm ?? 'MILP (HiGHS)',
      backend: activeBackend,
      shots: latestExplore?.shots ?? 4096,
      constraints: effectiveConstraints,
      climate,
      partitionQubits: latestExplore?.partitionQubits ?? 6,
    });
  }, [latestExplore, selectedConstraints.length, scaleFilter, topology, activeBackend, effectiveConstraints, climate]);

  const rawBusinessImpact = useMemo(
    () => computeBusinessImpactMetrics(activeRun, climateTopology),
    [activeRun, climateTopology]
  );

  // Scale economic projection smoothly when user narrows Grid Topology Scale
  const scaleMultiplier =
    scaleFilter === 'small' ? 0.65 : scaleFilter === 'regional' ? 1.85 : 1.0;

  const businessImpact = useMemo(() => {
    const scale = (v: number) => Number((v * scaleMultiplier).toFixed(2));
    return {
      ...rawBusinessImpact,
      totalAnnualValueM: scale(rawBusinessImpact.totalAnnualValueM),
      annualLossSavingsM: scale(rawBusinessImpact.annualLossSavingsM),
      annualOutageAvoidanceM: scale(rawBusinessImpact.annualOutageAvoidanceM),
      annualCo2AvoidedTons: Math.round(rawBusinessImpact.annualCo2AvoidedTons * scaleMultiplier),
      classicalCostsM: {
        lineLoss: scale(rawBusinessImpact.classicalCostsM.lineLoss),
        congestionRedispatch: scale(rawBusinessImpact.classicalCostsM.congestionRedispatch),
        renewableCurtailment: scale(rawBusinessImpact.classicalCostsM.renewableCurtailment),
        total: scale(rawBusinessImpact.classicalCostsM.total),
      },
      quantumCostsM: {
        lineLoss: scale(rawBusinessImpact.quantumCostsM.lineLoss),
        congestionRedispatch: scale(rawBusinessImpact.quantumCostsM.congestionRedispatch),
        renewableCurtailment: scale(rawBusinessImpact.quantumCostsM.renewableCurtailment),
        total: scale(rawBusinessImpact.quantumCostsM.total),
      },
    };
  }, [rawBusinessImpact, scaleMultiplier]);

  const maxCostTotal = Math.max(0.5, businessImpact.classicalCostsM.total);
  const pctOfMax = (val: number) => `${Math.max(4, Math.round((val / maxCostTotal) * 100))}%`;

  const busesToPlot = businessImpact.busComparison.slice(0, 20);
  const barChartW = 580;
  const barChartH = 195;
  const bPadL = 36;
  const bPadR = 12;
  const bPadT = 18;
  const bPadB = 26;
  const plotW = barChartW - bPadL - bPadR;
  const plotH = barChartH - bPadT - bPadB;
  const groupStep = plotW / Math.max(1, busesToPlot.length);
  const singleBarW = Math.max(4, Math.min(11, groupStep * 0.34));
  const barToY = (pct: number) => bPadT + (1 - Math.min(105, Math.max(0, pct)) / 105) * plotH;

  const toggleConstraint = (id: ConstraintId) => {
    setSelectedConstraints((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
  };

  const resetFilters = () => {
    setSelectedConstraints([]);
    setScaleFilter('all');
    setMaxLatencyMs(600);
  };

  return (
    <div className="space-y-6">
      {/* Constraint Narrowing Control Panel */}
      <section className="rounded-md border border-slate-200 dark:border-[#393939] bg-white dark:bg-[#262626] p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-[#393939]">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-[#0F62FE] dark:text-[#78A9FF]" aria-hidden="true" />
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-[#F4F4F4]">
                Constraint Narrowing & Impact Scope
              </h2>
              <p className="text-xs text-slate-500 dark:text-[#A8A8A8]">
                Isolate specific power-grid constraints, network scales, and latency ceilings to measure business ROI and Qiskit performance impact.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={resetFilters}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 dark:border-[#525252] bg-white dark:bg-[#161616] px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-[#E0E0E0] hover:bg-slate-50 dark:hover:bg-[#353535] whitespace-nowrap"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            Reset Scope
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Constraint Multi-Select Buttons */}
          <div className="lg:col-span-7">
            <div className="text-xs font-medium text-slate-700 dark:text-[#C6C6C6] mb-2">
              Narrow to Particular Constraints{' '}
              <span className="font-normal text-slate-500 dark:text-[#A8A8A8]">
                ({selectedConstraints.length === 0 ? 'All 5 active' : `${selectedConstraints.length} selected`})
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {CONSTRAINT_CATALOG.map((c) => {
                const isSelected = selectedConstraints.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => toggleConstraint(c.id)}
                    className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                      isSelected
                        ? 'border-[#0F62FE] bg-[#0F62FE] text-white'
                        : 'border-slate-300 dark:border-[#525252] bg-white dark:bg-[#161616] text-slate-700 dark:text-[#E0E0E0] hover:bg-slate-50 dark:hover:bg-[#353535]'
                    }`}
                  >
                    {c.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Grid Scale + Max Latency Budget */}
          <div className="lg:col-span-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="impact-scale-select" className="block text-xs font-medium text-slate-700 dark:text-[#C6C6C6] mb-1.5">
                Grid Topology Scale
              </label>
              <select
                id="impact-scale-select"
                value={scaleFilter}
                onChange={(e) => setScaleFilter(e.target.value as typeof scaleFilter)}
                className="w-full rounded-md border border-slate-300 dark:border-[#525252] bg-white dark:bg-[#161616] px-2.5 py-2 text-xs text-slate-800 dark:text-[#F4F4F4] focus:border-[#0F62FE] focus:outline-none"
              >
                <option value="all">All Grid Scales</option>
                <option value="small">Small Microgrid (≤12 Bus)</option>
                <option value="medium">Metro Grid (14–24 Bus)</option>
                <option value="regional">Regional 500kV Corridor</option>
              </select>
            </div>

            <div>
              <div className="flex items-center justify-between text-xs mb-1.5">
                <label htmlFor="impact-latency-slider" className="font-medium text-slate-700 dark:text-[#C6C6C6]">
                  Max Solver Latency
                </label>
                <span className="font-mono font-semibold text-slate-900 dark:text-[#F4F4F4] tabular-nums">
                  ≤ {maxLatencyMs} ms
                </span>
              </div>
              <input
                id="impact-latency-slider"
                type="range"
                min={260}
                max={600}
                step={20}
                value={maxLatencyMs}
                onChange={(e) => setMaxLatencyMs(Number(e.target.value))}
                className="w-full accent-[#0F62FE] mt-1"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Executive Business Value & Economic ROI (Unified Impact Hub) */}
      <section
        aria-label="Business value and economic impact"
        className="rounded-md border border-slate-200 dark:border-[#393939] bg-white dark:bg-[#262626] p-5 space-y-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-[#393939]">
          <div className="flex items-center gap-2">
            <Briefcase className="h-4 w-4 text-[#0F62FE] dark:text-[#78A9FF]" aria-hidden="true" />
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-[#F4F4F4]">
                Executive Business Value & Economic ROI
              </h2>
              <p className="text-xs text-slate-500 dark:text-[#A8A8A8]">
                {activeRun.datasetName} ({activeRun.nodeCount}N) · {activeRun.quantumAlgorithm} vs {activeRun.classicalAlgorithm} · {climate.ambientTempC}°C · {climate.peakTariffMultiplier.toFixed(2)}× peak tariff
              </p>
            </div>
          </div>
          <span className="rounded border border-slate-200 dark:border-[#525252] bg-slate-50 dark:bg-[#161616] px-2.5 py-1 text-[11px] font-mono text-slate-600 dark:text-[#C6C6C6]">
            {scaleFilter === 'all' ? 'Standard Baseline' : `Scale: ${scaleFilter}`} ({scaleMultiplier.toFixed(2)}×)
          </span>
        </div>

        {/* Executive Headline Value Banner */}
        <div className="rounded-md border border-[#16A34A]/30 dark:border-[#42BE65]/35 bg-emerald-50/70 dark:bg-[#1E1E1E] p-4 flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-0.5">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-[#15803D] dark:text-[#42BE65]">
              Projected Annual Utility Value Unlocked
            </div>
            <div className="flex flex-wrap items-baseline gap-2.5">
              <span className="text-3xl font-mono font-bold text-slate-900 dark:text-white tabular-nums">
                +${businessImpact.totalAnnualValueM.toFixed(2)}M
              </span>
              <span className="text-xs font-medium text-slate-600 dark:text-[#C6C6C6]">
                annual operating savings ·{' '}
                <span className="font-mono font-semibold text-[#15803D] dark:text-[#42BE65]">
                  −{businessImpact.costReductionPct}%
                </span>{' '}
                total dispatch cost
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-6 font-mono tabular-nums">
            <div>
              <div className="font-sans text-[11px] text-slate-500 dark:text-[#A8A8A8]">Avg Accuracy Gain</div>
              <div className="text-lg font-semibold text-[#0F62FE] dark:text-[#78A9FF]">
                +{impact.kpis.avgAccuracyGain.toFixed(2)}%
              </div>
            </div>
            <div className="h-8 w-px bg-slate-200 dark:bg-[#393939] hidden sm:block" aria-hidden="true" />
            <div>
              <div className="font-sans text-[11px] text-slate-500 dark:text-[#A8A8A8]">Congestion Relief</div>
              <div className="text-lg font-semibold text-slate-900 dark:text-[#F4F4F4]">
                {impact.kpis.avgCongestionRelief.toFixed(1)}%
              </div>
            </div>
          </div>
        </div>

        {/* 4 Unified Financial, Reliability, ESG & Speedup KPI Tiles */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 font-mono tabular-nums">
          <div className="rounded-md border border-slate-200 dark:border-[#393939] bg-slate-50/70 dark:bg-[#1E1E1E] p-4">
            <div className="flex items-center gap-1.5 font-sans text-xs font-medium text-slate-500 dark:text-[#A8A8A8]">
              <TrendingUp className="h-3.5 w-3.5 text-[#0F62FE] dark:text-[#78A9FF]" aria-hidden="true" />
              Line-Loss Savings
            </div>
            <div className="mt-1.5 text-2xl font-semibold text-slate-900 dark:text-[#F4F4F4]">
              ${businessImpact.annualLossSavingsM.toFixed(2)}M
              <span className="text-xs font-normal text-slate-500 dark:text-[#A8A8A8]">/yr</span>
            </div>
            <div className="mt-1 font-sans text-xs text-[#15803D] dark:text-[#42BE65]">
              {impact.kpis.totalLossReductionMWh.toLocaleString()} MWh avoided across scope
            </div>
          </div>

          <div className="rounded-md border border-slate-200 dark:border-[#393939] bg-slate-50/70 dark:bg-[#1E1E1E] p-4">
            <div className="flex items-center gap-1.5 font-sans text-xs font-medium text-slate-500 dark:text-[#A8A8A8]">
              <ShieldCheck className="h-3.5 w-3.5 text-[#16A34A] dark:text-[#42BE65]" aria-hidden="true" />
              N-1 Outage Risk Avoided
            </div>
            <div className="mt-1.5 text-2xl font-semibold text-slate-900 dark:text-[#F4F4F4]">
              ${businessImpact.annualOutageAvoidanceM.toFixed(2)}M
              <span className="text-xs font-normal text-slate-500 dark:text-[#A8A8A8]">/yr</span>
            </div>
            <div className="mt-1 font-sans text-xs text-slate-500 dark:text-[#A8A8A8]">
              Alarming buses: {businessImpact.beforeHealth.alarming} → {businessImpact.afterHealth.alarming}
            </div>
          </div>

          <div className="rounded-md border border-slate-200 dark:border-[#393939] bg-slate-50/70 dark:bg-[#1E1E1E] p-4">
            <div className="flex items-center gap-1.5 font-sans text-xs font-medium text-slate-500 dark:text-[#A8A8A8]">
              <Leaf className="h-3.5 w-3.5 text-[#16A34A] dark:text-[#42BE65]" aria-hidden="true" />
              CO₂e Emissions Avoided
            </div>
            <div className="mt-1.5 text-2xl font-semibold text-[#15803D] dark:text-[#42BE65]">
              {businessImpact.annualCo2AvoidedTons.toLocaleString()}{' '}
              <span className="text-xs font-normal text-slate-500 dark:text-[#A8A8A8]">t/yr</span>
            </div>
            <div className="mt-1 font-sans text-xs text-slate-500 dark:text-[#A8A8A8]">
              Annual dispatch ESG impact
            </div>
          </div>

          <div className="rounded-md border border-slate-200 dark:border-[#393939] bg-slate-50/70 dark:bg-[#1E1E1E] p-4">
            <div className="flex items-center gap-1.5 font-sans text-xs font-medium text-slate-500 dark:text-[#A8A8A8]">
              <Zap className="h-3.5 w-3.5 text-[#0F62FE] dark:text-[#78A9FF]" aria-hidden="true" />
              Clearing Speedup
            </div>
            <div className="mt-1.5 text-2xl font-semibold text-[#0F62FE] dark:text-[#78A9FF] whitespace-nowrap">
              {impact.kpis.avgSpeedup.toFixed(2)}×
            </div>
            <div className="mt-1 font-sans text-xs text-slate-500 dark:text-[#A8A8A8]">
              {activeRun.quantumMetrics.runtimeMs}ms vs {activeRun.classicalMetrics.runtimeMs}ms MILP
            </div>
          </div>
        </div>

        {/* Business Value Visuals: Cost Breakdown Waterfall + Bus-by-Bus Peak Relief */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-stretch">
          {/* Left: Annual Operating Cost Waterfall */}
          <div className="xl:col-span-5 rounded-md border border-slate-200 dark:border-[#393939] bg-slate-50/60 dark:bg-[#1E1E1E] p-4 flex flex-col justify-between space-y-4">
            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-900 dark:text-[#F4F4F4]">
                Annual Grid Operating Cost Breakdown ($M / year)
              </div>
              <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-600 dark:text-[#A8A8A8]">
                <span className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded-xs bg-[#0F62FE] dark:bg-[#78A9FF]" />
                  Line Loss
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded-xs bg-[#D97706] dark:bg-[#F1C21B]" />
                  Congestion & N-1
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded-xs bg-[#7C3AED] dark:bg-[#BE95FF]" />
                  DER Curtailment
                </span>
              </div>
            </div>

            <div className="space-y-4 text-xs">
              {/* Classical Row */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-medium text-slate-700 dark:text-[#C6C6C6]">
                    Classical ({activeRun.classicalAlgorithm})
                  </span>
                  <span className="font-mono font-semibold text-slate-800 dark:text-[#E0E0E0] tabular-nums">
                    ${businessImpact.classicalCostsM.total.toFixed(2)}M / yr
                  </span>
                </div>
                <div className="h-6 w-full rounded bg-slate-200 dark:bg-[#121212] overflow-hidden flex">
                  <div
                    style={{ width: pctOfMax(businessImpact.classicalCostsM.lineLoss) }}
                    className="h-full bg-[#64748B] dark:bg-[#6F6F6F] flex items-center justify-center text-[10px] font-mono text-white truncate px-1"
                    title={`Line Loss: $${businessImpact.classicalCostsM.lineLoss.toFixed(2)}M`}
                  >
                    {businessImpact.classicalCostsM.lineLoss / maxCostTotal >= 0.14
                      ? `$${businessImpact.classicalCostsM.lineLoss.toFixed(1)}M`
                      : ''}
                  </div>
                  <div
                    style={{ width: pctOfMax(businessImpact.classicalCostsM.congestionRedispatch) }}
                    className="h-full bg-[#D97706] dark:bg-[#F1C21B] flex items-center justify-center text-[10px] font-mono text-white dark:text-[#161616] font-semibold truncate px-1"
                    title={`Congestion & N-1: $${businessImpact.classicalCostsM.congestionRedispatch.toFixed(2)}M`}
                  >
                    {businessImpact.classicalCostsM.congestionRedispatch / maxCostTotal >= 0.12
                      ? `$${businessImpact.classicalCostsM.congestionRedispatch.toFixed(1)}M`
                      : ''}
                  </div>
                  <div
                    style={{ width: pctOfMax(businessImpact.classicalCostsM.renewableCurtailment) }}
                    className="h-full bg-[#7C3AED] dark:bg-[#BE95FF] flex items-center justify-center text-[10px] font-mono text-white dark:text-[#161616] font-semibold truncate px-1"
                    title={`DER Curtailment: $${businessImpact.classicalCostsM.renewableCurtailment.toFixed(2)}M`}
                  >
                    {businessImpact.classicalCostsM.renewableCurtailment / maxCostTotal >= 0.14
                      ? `$${businessImpact.classicalCostsM.renewableCurtailment.toFixed(1)}M`
                      : ''}
                  </div>
                </div>
              </div>

              {/* Quantum Row */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-semibold text-[#0F62FE] dark:text-[#78A9FF]">
                    IBM Qiskit ({activeRun.quantumAlgorithm})
                  </span>
                  <span className="font-mono font-semibold text-[#15803D] dark:text-[#42BE65] tabular-nums">
                    ${businessImpact.quantumCostsM.total.toFixed(2)}M / yr (Save ${businessImpact.totalAnnualValueM.toFixed(2)}M)
                  </span>
                </div>
                <div className="h-6 w-full rounded bg-slate-200 dark:bg-[#121212] overflow-hidden flex">
                  <div
                    style={{ width: pctOfMax(businessImpact.quantumCostsM.lineLoss) }}
                    className="h-full bg-[#0F62FE] dark:bg-[#4589FF] flex items-center justify-center text-[10px] font-mono text-white truncate px-1"
                    title={`Line Loss: $${businessImpact.quantumCostsM.lineLoss.toFixed(2)}M`}
                  >
                    {businessImpact.quantumCostsM.lineLoss / maxCostTotal >= 0.14
                      ? `$${businessImpact.quantumCostsM.lineLoss.toFixed(1)}M`
                      : ''}
                  </div>
                  <div
                    style={{ width: pctOfMax(businessImpact.quantumCostsM.congestionRedispatch) }}
                    className="h-full bg-[#D97706]/80 dark:bg-[#F1C21B]/85 flex items-center justify-center text-[10px] font-mono text-white dark:text-[#161616] font-semibold truncate px-1"
                    title={`Congestion & N-1: $${businessImpact.quantumCostsM.congestionRedispatch.toFixed(2)}M`}
                  >
                    {businessImpact.quantumCostsM.congestionRedispatch / maxCostTotal >= 0.12
                      ? `$${businessImpact.quantumCostsM.congestionRedispatch.toFixed(1)}M`
                      : ''}
                  </div>
                  <div
                    style={{ width: pctOfMax(businessImpact.quantumCostsM.renewableCurtailment) }}
                    className="h-full bg-[#7C3AED]/80 dark:bg-[#BE95FF]/85 flex items-center justify-center text-[10px] font-mono text-white dark:text-[#161616] font-semibold truncate px-1"
                    title={`DER Curtailment: $${businessImpact.quantumCostsM.renewableCurtailment.toFixed(2)}M`}
                  >
                    {businessImpact.quantumCostsM.renewableCurtailment / maxCostTotal >= 0.14
                      ? `$${businessImpact.quantumCostsM.renewableCurtailment.toFixed(1)}M`
                      : ''}
                  </div>
                </div>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-200 dark:border-[#393939] flex items-center justify-between text-[11px] font-mono text-slate-500 dark:text-[#A8A8A8] tabular-nums">
              <span>Continuous MW saved: −{(activeRun.classicalMetrics.lossMW - activeRun.quantumMetrics.lossMW).toFixed(2)} MW</span>
              <span className="text-[#15803D] dark:text-[#42BE65] font-semibold">
                {businessImpact.beforeHealth.healthy} → {businessImpact.afterHealth.healthy} healthy
              </span>
            </div>
          </div>

          {/* Right: Bus-by-Bus Overload Relief Chart */}
          <div className="xl:col-span-7 rounded-md border border-slate-200 dark:border-[#393939] bg-slate-50/60 dark:bg-[#121212] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2 text-[11px]">
              <span className="font-semibold text-slate-800 dark:text-[#F4F4F4]">
                Bus-by-Bus Peak Relief: Classical Baseline vs IBM Qiskit Dispatch (%)
              </span>
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center gap-1.5 text-slate-600 dark:text-[#A8A8A8]">
                  <span className="h-2.5 w-2.5 rounded-xs bg-slate-400 dark:bg-[#6F6F6F]" />
                  Before (Classical)
                </span>
                <span className="inline-flex items-center gap-1.5 text-[#0F62FE] dark:text-[#78A9FF] font-medium">
                  <span className="h-2.5 w-2.5 rounded-xs bg-[#0F62FE] dark:bg-[#4589FF]" />
                  After (Qiskit)
                </span>
                <span className="inline-flex items-center gap-1.5 text-[#DC2626] dark:text-[#FA4D56]">
                  <span className="h-0.5 w-3 bg-[#DC2626] dark:bg-[#FA4D56]" />
                  90% Alarm
                </span>
              </div>
            </div>

            <svg
              viewBox={`0 0 ${barChartW} ${barChartH}`}
              className="w-full h-[195px]"
              role="img"
              aria-label="Bus-by-bus utilization relief chart comparing Classical baseline vs IBM Qiskit dispatch"
            >
              {[0, 50, 75, 90, 100].map((tick) => {
                const y = barToY(tick);
                const isAlarm = tick === 90;
                const isWarn = tick === 75;
                return (
                  <g key={tick}>
                    <line
                      x1={bPadL}
                      y1={y}
                      x2={barChartW - bPadR}
                      y2={y}
                      stroke={
                        isAlarm
                          ? isDark
                            ? '#FA4D56'
                            : '#DC2626'
                          : isWarn
                          ? isDark
                            ? '#F1C21B'
                            : '#D97706'
                          : isDark
                          ? '#2A2A2A'
                          : '#E2E8F0'
                      }
                      strokeDasharray={isAlarm || isWarn ? '4 3' : undefined}
                      strokeOpacity={isAlarm || isWarn ? 0.75 : 1}
                      strokeWidth={isAlarm ? 1.2 : 1}
                    />
                    <text
                      x={bPadL - 5}
                      y={y + 3}
                      textAnchor="end"
                      fontSize="8.5"
                      fontFamily="IBM Plex Mono, monospace"
                      fill={
                        isAlarm
                          ? isDark
                            ? '#FA4D56'
                            : '#DC2626'
                          : isWarn
                          ? isDark
                            ? '#F1C21B'
                            : '#B45309'
                          : isDark
                          ? '#8D8D8D'
                          : '#64748B'
                      }
                    >
                      {tick}%
                    </text>
                  </g>
                );
              })}

              {busesToPlot.map((b, idx) => {
                const cx = bPadL + idx * groupStep + groupStep / 2;
                const cY = barToY(b.classicalUtilPct);
                const qY = barToY(b.quantumUtilPct);
                const baseY = barToY(0);
                const cFill =
                  b.classicalUtilPct >= 90
                    ? isDark
                      ? '#FA4D56'
                      : '#EF4444'
                    : b.classicalUtilPct >= 75
                    ? isDark
                      ? '#F1C21B'
                      : '#F59E0B'
                    : isDark
                    ? '#6F6F6F'
                    : '#94A3B8';
                const qFill =
                  b.quantumUtilPct >= 90
                    ? isDark
                      ? '#FA4D56'
                      : '#DC2626'
                    : b.quantumUtilPct < 75 && b.classicalUtilPct >= 75
                    ? isDark
                      ? '#42BE65'
                      : '#16A34A'
                    : isDark
                    ? '#4589FF'
                    : '#0F62FE';

                const showLabel = busesToPlot.length <= 14 || idx % 2 === 0;
                return (
                  <g key={b.id}>
                    <rect
                      x={cx - singleBarW - 1}
                      y={cY}
                      width={singleBarW}
                      height={Math.max(2, baseY - cY)}
                      rx={1.5}
                      fill={cFill}
                      fillOpacity={0.85}
                    >
                      <title>{`${b.id} (${b.name}) Classical: ${b.classicalUtilPct}%`}</title>
                    </rect>
                    <rect
                      x={cx + 1}
                      y={qY}
                      width={singleBarW}
                      height={Math.max(2, baseY - qY)}
                      rx={1.5}
                      fill={qFill}
                    >
                      <title>{`${b.id} (${b.name}) Qiskit: ${b.quantumUtilPct}%`}</title>
                    </rect>
                    {showLabel && (
                      <text
                        x={cx}
                        y={barChartH - 8}
                        textAnchor="middle"
                        fontSize="8.5"
                        fontFamily="IBM Plex Mono, monospace"
                        fill={isDark ? '#A8A8A8' : '#64748B'}
                      >
                        {b.id}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>
        </div>
      </section>

      {/* Full-Width Interactive Accuracy Trend Chart */}
      <section className="rounded-md border border-slate-200 dark:border-[#393939] bg-white dark:bg-[#262626] p-5">
        <div className="pb-3 border-b border-slate-200 dark:border-[#393939]">
          <h2 className="text-base font-semibold text-slate-900 dark:text-[#F4F4F4]">
            Accuracy Improvements Over Time
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-[#A8A8A8]">
            Hover across sprint iterations to inspect Quantum vs Classical convergence under your narrowed constraint set.
          </p>
        </div>
        <div className="mt-4">
          <D3AccuracyTrendChart data={impact.aggregatedTimeline} isDark={isDark} />
        </div>
      </section>

      {/* Complete Full-Width Constraint-Level Impact Breakdown (with embedded Quantum vs Classical Feasibility Bars) */}
      <section className="rounded-md border border-slate-200 dark:border-[#393939] bg-white dark:bg-[#262626] p-5">
        <div className="pb-3 border-b border-slate-200 dark:border-[#393939] flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-[#F4F4F4]">
              Constraint-Level Impact & Feasibility Breakdown
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-[#A8A8A8]">
              Showing {impact.filteredRows.length} constraint benchmark profiles matching current scope.
            </p>
          </div>
          <div className="flex items-center gap-4 text-xs text-slate-600 dark:text-[#A8A8A8]">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-xs bg-[#0F62FE] dark:bg-[#4589FF]" aria-hidden="true" />
              Qiskit Feasible %
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-xs bg-slate-400 dark:bg-[#6F6F6F]" aria-hidden="true" />
              Classical Feasible %
            </span>
          </div>
        </div>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-[#393939] text-[11px] font-semibold text-slate-500 dark:text-[#A8A8A8]">
                <th className="py-2.5 pr-4">Constraint Profile</th>
                <th className="py-2.5 pr-4">Scale</th>
                <th className="py-2.5 pr-5 min-w-[220px]">Constraint Feasibility (Q vs C)</th>
                <th className="py-2.5 pr-4 text-right">Accuracy Gain</th>
                <th className="py-2.5 pr-4 text-right">Loss Saved</th>
                <th className="py-2.5 pr-4 text-right">Speedup</th>
                <th className="py-2.5 text-right">Avg Latency</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-[#393939]">
              {impact.filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500 dark:text-[#A8A8A8]">
                    No constraint profiles match your active latency or scale limits. Click Reset Scope to view all.
                  </td>
                </tr>
              ) : (
                impact.filteredRows.map((row, idx) => (
                  <tr key={`${row.constraintId}-${row.scale}-${idx}`} className="hover:bg-slate-50 dark:hover:bg-[#353535]">
                    <td className="py-3 pr-4">
                      <div className="font-medium text-slate-900 dark:text-[#F4F4F4] whitespace-nowrap">{row.label}</div>
                      <div className="text-[11px] text-slate-500 dark:text-[#A8A8A8]">{row.description}</div>
                    </td>
                    <td className="py-3 pr-4 capitalize text-slate-600 dark:text-[#C6C6C6] whitespace-nowrap">
                      {row.scale}
                    </td>
                    <td className="py-3 pr-5">
                      <div className="space-y-1.5 font-mono text-[10px] tabular-nums">
                        <div className="flex items-center gap-2">
                          <div className="h-2 flex-1 rounded-full bg-slate-100 dark:bg-[#161616] overflow-hidden">
                            <div
                              className="h-full rounded-full bg-[#0F62FE] dark:bg-[#4589FF]"
                              style={{ width: `${Math.min(100, row.quantumFeasibilityPct)}%` }}
                            />
                          </div>
                          <span className="w-10 text-right font-semibold text-[#0F62FE] dark:text-[#78A9FF]">
                            {row.quantumFeasibilityPct.toFixed(1)}%
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="h-2 flex-1 rounded-full bg-slate-100 dark:bg-[#161616] overflow-hidden">
                            <div
                              className="h-full rounded-full bg-slate-400 dark:bg-[#6F6F6F]"
                              style={{ width: `${Math.min(100, row.classicalFeasibilityPct)}%` }}
                            />
                          </div>
                          <span className="w-10 text-right text-slate-500 dark:text-[#A8A8A8]">
                            {row.classicalFeasibilityPct.toFixed(1)}%
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 pr-4 text-right font-mono font-semibold text-[#15803D] dark:text-[#42BE65] tabular-nums">
                      +{row.accuracyDeltaPct.toFixed(1)}%
                    </td>
                    <td className="py-3 pr-4 text-right font-mono text-slate-800 dark:text-[#E0E0E0] tabular-nums whitespace-nowrap">
                      {row.lossReductionMWh.toFixed(1)} MWh
                    </td>
                    <td className="py-3 pr-4 text-right font-mono text-slate-800 dark:text-[#E0E0E0] tabular-nums">
                      {row.speedupFactor.toFixed(2)}×
                    </td>
                    <td className="py-3 text-right font-mono text-slate-600 dark:text-[#A8A8A8] tabular-nums whitespace-nowrap">
                      {row.avgLatencyMs} ms
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
