import { useMemo, useState } from 'react';
import {
  Activity,
  ArrowUpDown,
  Cpu,
  Gauge,
  GitBranch,
  ShieldAlert,
  Sliders,
  Thermometer,
  Zap,
} from 'lucide-react';
import type { GridNode, GridTopology, HealthStatus } from '../types/grid';
import { motion, useReducedMotion } from 'motion/react';
import { AnimatedText } from '../components/AnimatedNumber';
import { StatusIndicator } from '../components/StatusIndicator';

interface DiagnosticsViewProps {
  topology: GridTopology;
  selectedNodeId: string;
  isDark: boolean;
  onSelectNode: (nodeId: string) => void;
  onRerouteNode: (nodeId: string) => void;
  onAdjustNodeStress: (nodeId: string, utilizationPct: number) => void;
}

interface RoleFeatureSpec {
  roleTitle: string;
  assetClass: string;
  features: {
    label: string;
    value: string;
    detail: string;
    pct: number;
    tone: 'healthy' | 'warning' | 'alarming' | 'accent';
  }[];
  advisory: string;
}

function buildRoleSpecificDiagnostics(node: GridNode, neighborCount: number): RoleFeatureSpec {
  const utilPct = Math.round((node.loadMW / Math.max(1, node.capacityMW)) * 100);
  const reserveMW = Math.max(0, Math.round(node.capacityMW - node.loadMW));
  const thermalHeadroom = Number((85 - node.temperatureC).toFixed(1));
  const voltageMargin = Number(((node.voltagePU - 0.94) * 100).toFixed(1));
  const dispatchRelief = Number((node.classicalDispatchMW - node.quantumDispatchMW).toFixed(1));

  if (node.role === 'generator') {
    const rampRate = Math.round(node.capacityMW * 0.085);
    const mvarCap = Math.round(node.capacityMW * 0.34);
    const mvarUsed = Math.round(mvarCap * (utilPct / 100));
    return {
      roleTitle: 'Generation Unit Capability Profile',
      assetClass: 'Synchronous Bulk Generation Bus',
      features: [
        {
          label: 'Spinning Reserve Headroom',
          value: `${reserveMW} MW`,
          detail: `${100 - utilPct}% spare capacity available for N-1 pickup`,
          pct: Math.max(4, Math.min(100, 100 - utilPct)),
          tone: reserveMW < 35 ? 'alarming' : reserveMW < 65 ? 'warning' : 'healthy',
        },
        {
          label: 'Governor Ramp Rate',
          value: `${rampRate} MW/min`,
          detail: 'AGC frequency-regulation response envelope',
          pct: Math.min(100, Math.round((rampRate / 28) * 100)),
          tone: 'accent',
        },
        {
          label: 'Reactive MVAR Capability',
          value: `${mvarUsed} / ${mvarCap} MVAR`,
          detail: `Exciter stability at ${node.voltagePU.toFixed(3)} p.u. terminal`,
          pct: Math.min(100, Math.round((mvarUsed / Math.max(1, mvarCap)) * 100)),
          tone: utilPct >= 90 ? 'alarming' : utilPct >= 75 ? 'warning' : 'healthy',
        },
        {
          label: 'Stator Thermal Margin',
          value: `${thermalHeadroom >= 0 ? '+' : ''}${thermalHeadroom}°C`,
          detail: `Core at ${node.temperatureC.toFixed(1)}°C vs 85.0°C alarm limit`,
          pct: Math.max(5, Math.min(100, Math.round((node.temperatureC / 95) * 100))),
          tone: thermalHeadroom <= 0 ? 'alarming' : thermalHeadroom <= 10 ? 'warning' : 'healthy',
        },
      ],
      advisory:
        dispatchRelief > 0
          ? `QAOA schedules ${dispatchRelief} MW lower dispatch than classical AC-OPF to preserve spinning reserve and reduce tie-line I²R losses.`
          : 'Generator operating inside optimal economic dispatch curve with healthy spinning reserve.',
    };
  }

  if (node.role === 'substation') {
    const thdPct = Number((1.2 + (utilPct / 100) * 2.6).toFixed(2));
    const nMinus1Cap = Math.round(node.capacityMW * (neighborCount >= 3 ? 0.88 : 0.72));
    const transferOk = node.loadMW <= nMinus1Cap;
    return {
      roleTitle: 'High-Voltage Substation Capability Profile',
      assetClass: 'HV Intertie & Busbar Switching Station',
      features: [
        {
          label: 'N-1 Contingency Transfer Limit',
          value: `${nMinus1Cap} MW`,
          detail: transferOk
            ? `${nMinus1Cap - node.loadMW} MW safe post-fault headroom (${neighborCount} ties)`
            : `Exceeds N-1 limit by ${node.loadMW - nMinus1Cap} MW`,
          pct: Math.min(100, Math.round((node.loadMW / Math.max(1, nMinus1Cap)) * 100)),
          tone: !transferOk ? 'alarming' : utilPct >= 78 ? 'warning' : 'healthy',
        },
        {
          label: 'Busbar Breaker Loading',
          value: `${utilPct}% Rated`,
          detail: `${node.loadMW} / ${node.capacityMW} MW continuous throughput`,
          pct: Math.min(100, utilPct),
          tone: utilPct >= 90 ? 'alarming' : utilPct >= 75 ? 'warning' : 'healthy',
        },
        {
          label: 'Harmonic Distortion (THD)',
          value: `${thdPct}%`,
          detail: 'IEEE 519 HV threshold ≤ 3.0% nominal',
          pct: Math.min(100, Math.round((thdPct / 4.5) * 100)),
          tone: thdPct > 3.2 ? 'alarming' : thdPct > 2.6 ? 'warning' : 'healthy',
        },
        {
          label: 'Switchgear Thermal Headroom',
          value: `${thermalHeadroom >= 0 ? '+' : ''}${thermalHeadroom}°C`,
          detail: `Measured ${node.temperatureC.toFixed(1)}°C across busbar joints`,
          pct: Math.max(5, Math.min(100, Math.round((node.temperatureC / 95) * 100))),
          tone: thermalHeadroom <= 0 ? 'alarming' : thermalHeadroom <= 10 ? 'warning' : 'healthy',
        },
      ],
      advisory: !transferOk
        ? `Critical N-1 bottleneck: losing one adjacent tie pushes ${node.id} past thermal trip. Trigger Qiskit QAOA rerouting to shift ${Math.max(12, Math.abs(dispatchRelief))} MW onto parallel corridors.`
        : `Substation busbar maintains positive N-1 transfer margin across ${neighborCount} active transmission ties.`,
    };
  }

  if (node.role === 'transformer') {
    const tapStep = Math.max(-8, Math.min(8, Math.round((1.0 - node.voltagePU) * 120)));
    const oilCoolingPct = Math.max(12, Math.min(100, Math.round(115 - node.temperatureC)));
    const coreLossMW = Number((node.loadMW * 0.014).toFixed(2));
    return {
      roleTitle: 'Step-Down Transformer Capability Profile',
      assetClass: 'OLTC Power Transformer & Winding Bank',
      features: [
        {
          label: 'Winding Hot-Spot Thermal Load',
          value: `${node.temperatureC.toFixed(1)}°C`,
          detail: `${thermalHeadroom >= 0 ? `+${thermalHeadroom}°C` : `${thermalHeadroom}°C`} vs 85°C IEEE insulation knee`,
          pct: Math.min(100, Math.round((node.temperatureC / 95) * 100)),
          tone: node.temperatureC >= 85 ? 'alarming' : node.temperatureC >= 74 ? 'warning' : 'healthy',
        },
        {
          label: 'OLTC Tap Changer Position',
          value: `Tap ${tapStep >= 0 ? `+${tapStep}` : tapStep} / ±8`,
          detail: `Regulating secondary voltage at ${node.voltagePU.toFixed(3)} p.u.`,
          pct: Math.min(100, Math.round(((Math.abs(tapStep) + 1) / 9) * 100)),
          tone: Math.abs(tapStep) >= 6 ? 'warning' : 'accent',
        },
        {
          label: 'Oil-Forced Cooling Reserve',
          value: `${oilCoolingPct}%`,
          detail: 'Radiator pump & fan thermal dissipation margin',
          pct: oilCoolingPct,
          tone: oilCoolingPct < 30 ? 'alarming' : oilCoolingPct < 45 ? 'warning' : 'healthy',
        },
        {
          label: 'Core & Copper Loss Estimate',
          value: `${coreLossMW} MW`,
          detail: `Utilization ${utilPct}% of ${node.capacityMW} MVA bank rating`,
          pct: Math.min(100, utilPct),
          tone: utilPct >= 90 ? 'alarming' : utilPct >= 75 ? 'warning' : 'healthy',
        },
      ],
      advisory:
        node.temperatureC >= 75
          ? `Elevated winding temperature accelerates cellulose insulation aging. QAOA dispatch reduces through-flow by ${Math.max(8, Math.abs(dispatchRelief))} MW.`
          : 'Transformer bank operating within nominal thermal and OLTC tap regulation bounds.',
    };
  }

  if (node.role === 'renewable') {
    const forecastConf = Math.max(76, Math.min(97, Math.round(96 - (utilPct > 85 ? 10 : 4))));
    const curtailmentAvoidedMW = Number(Math.max(3.2, Math.abs(dispatchRelief) * 0.85).toFixed(1));
    const syntheticInertiaS = Number((2.4 + (reserveMW / Math.max(1, node.capacityMW)) * 2.1).toFixed(1));
    return {
      roleTitle: 'Renewable / Storage Inverter Profile',
      assetClass: 'Grid-Forming DER & Inverter Array',
      features: [
        {
          label: 'Inverter Dispatch Headroom',
          value: `${reserveMW} MW`,
          detail: `${utilPct}% active export of ${node.capacityMW} MW nameplate`,
          pct: Math.min(100, utilPct),
          tone: utilPct >= 90 ? 'warning' : 'healthy',
        },
        {
          label: 'Curtailment Avoided (QAOA)',
          value: `${curtailmentAvoidedMW} MW`,
          detail: 'Clean output absorbed via quantum corridor rebalancing',
          pct: Math.min(100, Math.round((curtailmentAvoidedMW / 32) * 100)),
          tone: 'accent',
        },
        {
          label: 'Short-Term Forecast Confidence',
          value: `${forecastConf}%`,
          detail: '15-min irradiance/wind telemetry certainty',
          pct: forecastConf,
          tone: forecastConf < 82 ? 'warning' : 'healthy',
        },
        {
          label: 'Synthetic Inertia Constant (H)',
          value: `${syntheticInertiaS} s`,
          detail: `Grid-forming ride-through at ${node.voltagePU.toFixed(3)} p.u.`,
          pct: Math.min(100, Math.round((syntheticInertiaS / 5) * 100)),
          tone: 'healthy',
        },
      ],
      advisory:
        'Quantum routing maximizes renewable injection without violating downstream thermal constraints, avoiding unnecessary inverter curtailment.',
    };
  }

  // Load Feeder
  const powerFactor = Number(Math.max(0.86, Math.min(0.99, 0.985 - Math.max(0, utilPct - 65) * 0.0025)).toFixed(3));
  const sheddableMW = Math.round(node.loadMW * 0.14);
  return {
    roleTitle: 'Distribution Load Feeder Profile',
    assetClass: 'Critical Urban / Industrial Load Bus',
    features: [
      {
        label: 'Statutory Voltage Floor Margin',
        value: `${voltageMargin >= 0 ? '+' : ''}${voltageMargin}%`,
        detail: `${node.voltagePU.toFixed(3)} p.u. vs 0.940 p.u. statutory floor`,
        pct: Math.max(6, Math.min(100, Math.round(((node.voltagePU - 0.9) / 0.14) * 100))),
        tone: node.voltagePU < 0.94 ? 'alarming' : node.voltagePU < 0.96 ? 'warning' : 'healthy',
      },
      {
        label: 'Feeder Power Factor (cos φ)',
        value: `${powerFactor}`,
        detail: powerFactor < 0.93 ? 'Reactive compensation recommended' : 'Optimal VAR balance',
        pct: Math.round(powerFactor * 100),
        tone: powerFactor < 0.91 ? 'alarming' : powerFactor < 0.94 ? 'warning' : 'healthy',
      },
      {
        label: 'Demand-Response Flexible Load',
        value: `${sheddableMW} MW`,
        detail: '14% deferrable peak load available before involuntary shedding',
        pct: Math.min(100, Math.round((sheddableMW / Math.max(1, node.capacityMW * 0.25)) * 100)),
        tone: 'accent',
      },
      {
        label: 'Feeder Cable Thermal Margin',
        value: `${thermalHeadroom >= 0 ? '+' : ''}${thermalHeadroom}°C`,
        detail: `Underground duct ${node.temperatureC.toFixed(1)}°C / 85.0°C ceiling`,
        pct: Math.min(100, Math.round((node.temperatureC / 95) * 100)),
        tone: thermalHeadroom <= 0 ? 'alarming' : thermalHeadroom <= 10 ? 'warning' : 'healthy',
      },
    ],
    advisory:
      node.status === 'alarming'
        ? `Voltage sag or overload breach detected on ${node.id}. Qiskit QAOA rerouting relieves ${Math.max(10, Math.abs(dispatchRelief))} MW and restores voltage above 0.96 p.u. without load shedding.`
        : 'Load bus operating inside statutory voltage and cable thermal compliance limits.',
  };
}

export function DiagnosticsView({
  topology,
  selectedNodeId,
  isDark,
  onSelectNode,
  onRerouteNode,
  onAdjustNodeStress,
}: DiagnosticsViewProps) {
  const [statusFilter, setStatusFilter] = useState<'all' | HealthStatus>('all');
  const [hoverHour, setHoverHour] = useState<number | null>(null);
  const reduceMotion = useReducedMotion();
  const [sortBy, setSortBy] = useState<'utilization' | 'temperature' | 'voltage'>('utilization');

  const selectedNode = useMemo(
    () => topology.nodes.find((n) => n.id === selectedNodeId) ?? topology.nodes[0],
    [topology.nodes, selectedNodeId]
  );

  const nodeMap = useMemo(() => new Map(topology.nodes.map((n) => [n.id, n])), [topology.nodes]);

  const connectedEdges = useMemo(() => {
    if (!selectedNode) return [];
    return topology.edges.filter(
      (e) => e.source === selectedNode.id || e.target === selectedNode.id
    );
  }, [topology.edges, selectedNode]);

  const filteredNodes = useMemo(() => {
    const list =
      statusFilter === 'all'
        ? [...topology.nodes]
        : topology.nodes.filter((n) => n.status === statusFilter);

    return list.sort((a, b) => {
      if (sortBy === 'temperature') return b.temperatureC - a.temperatureC;
      if (sortBy === 'voltage') return a.voltagePU - b.voltagePU;
      return b.loadMW / b.capacityMW - a.loadMW / a.capacityMW;
    });
  }, [topology.nodes, statusFilter, sortBy]);

  const roleDiagnostics = useMemo(
    () => (selectedNode ? buildRoleSpecificDiagnostics(selectedNode, connectedEdges.length) : null),
    [selectedNode, connectedEdges.length]
  );

  // Deterministic 24-hour load capability envelope for the selected bus (Classical vs QAOA)
  const hourlyEnvelope = useMemo(() => {
    if (!selectedNode) return [];
    const baseRatio = selectedNode.loadMW / Math.max(1, selectedNode.capacityMW);
    const qRatio = selectedNode.quantumDispatchMW / Math.max(1, selectedNode.loadMW);
    const curveShape = [
      0.72, 0.68, 0.65, 0.64, 0.67, 0.75, 0.84, 0.92,
      0.96, 0.94, 0.91, 0.93, 0.95, 0.97, 1.0, 1.02,
      1.04, 1.01, 0.96, 0.92, 0.87, 0.82, 0.78, 0.74,
    ];
    return curveShape.map((mult, hr) => {
      const classicalMW = Math.round(
        Math.min(selectedNode.capacityMW * 1.08, selectedNode.capacityMW * baseRatio * mult)
      );
      const quantumMW = Math.round(
        Math.min(selectedNode.capacityMW * 0.86, classicalMW * Math.min(0.96, Math.max(0.78, qRatio)))
      );
      return {
        hour: `${String(hr).padStart(2, '0')}:00`,
        classicalMW,
        quantumMW,
      };
    });
  }, [selectedNode]);

  if (!selectedNode || !roleDiagnostics) return null;

  const utilizationPct = Math.round((selectedNode.loadMW / Math.max(1, selectedNode.capacityMW)) * 100);
  const dispatchDeltaMW = Number(
    (selectedNode.classicalDispatchMW - selectedNode.quantumDispatchMW).toFixed(1)
  );
  const qubitPenaltyZ = Number(
    (
      (utilizationPct / 100) * 1.4 +
      Math.max(0, (selectedNode.temperatureC - 70) / 25) +
      Math.max(0, (0.96 - selectedNode.voltagePU) * 12)
    ).toFixed(2)
  );

  const statusColor = (status: HealthStatus) =>
    status === 'alarming'
      ? isDark
        ? '#FA4D56'
        : '#DC2626'
      : status === 'warning'
      ? isDark
        ? '#F1C21B'
        : '#D97706'
      : isDark
      ? '#42BE65'
      : '#16A34A';

  const toneBarClass = (tone: RoleFeatureSpec['features'][number]['tone']) => {
    if (tone === 'alarming') return 'bg-[#DC2626] dark:bg-[#FA4D56]';
    if (tone === 'warning') return 'bg-[#D97706] dark:bg-[#F1C21B]';
    if (tone === 'accent') return 'bg-[#0F62FE] dark:bg-[#78A9FF]';
    return 'bg-[#16A34A] dark:bg-[#42BE65]';
  };

  // Ego-Subgraph coordinates (Selected bus centered, direct neighbors arranged radially)
  const egoW = 680;
  const egoH = 310;
  const centerX = egoW / 2;
  const centerY = egoH / 2;
  const radiusX = 248;
  const radiusY = 114;

  // 24h Envelope SVG scales
  const chartW = 560;
  const chartH = 190;
  const padL = 42;
  const padR = 16;
  const padT = 18;
  const padB = 26;
  const maxY = Math.max(selectedNode.capacityMW * 1.12, 100);
  const toX = (idx: number) => padL + (idx / 23) * (chartW - padL - padR);
  const toY = (mw: number) => padT + (1 - mw / maxY) * (chartH - padT - padB);
  const classicalPath = hourlyEnvelope
    .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${toX(i).toFixed(1)} ${toY(pt.classicalMW).toFixed(1)}`)
    .join(' ');
  const quantumPath = hourlyEnvelope
    .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${toX(i).toFixed(1)} ${toY(pt.quantumMW).toFixed(1)}`)
    .join(' ');
  const capY = toY(selectedNode.capacityMW);
  const alarmY = toY(selectedNode.capacityMW * 0.9);

  return (
    <div className="space-y-6">
      {/* Quick Single-Bus Switcher Strip (replaces redundant full-grid map) */}
      <section className="rounded-md border border-slate-200 dark:border-[#393939] bg-white dark:bg-[#262626] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200 dark:border-[#393939]">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-[#F4F4F4]">
              Select Bus for Deep-Dive Diagnostics ({topology.nodes.length} Buses in {topology.name})
            </h2>
            <p className="text-xs text-slate-500 dark:text-[#A8A8A8]">
              Focused single-node hardware capabilities, 1-hop neighborhood flow, and qubit Hamiltonian couplings.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-[#A8A8A8]">
              <ArrowUpDown className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
              <select
                aria-label="Sort buses by metric"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                className="rounded-md border border-slate-300 dark:border-[#525252] bg-white dark:bg-[#161616] px-2.5 py-1 text-xs text-slate-800 dark:text-[#E0E0E0] focus:border-[#0F62FE] focus:outline-none"
              >
                <option value="utilization">Sort: Utilization %</option>
                <option value="temperature">Sort: Temperature °C</option>
                <option value="voltage">Sort: Lowest Voltage</option>
              </select>
            </div>
            <div className="inline-flex items-center rounded-md border border-slate-200 dark:border-[#525252] bg-slate-50 dark:bg-[#161616] p-0.5">
              {(['all', 'alarming', 'warning', 'healthy'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStatusFilter(st)}
                  className={`px-2.5 py-1 text-xs font-medium rounded capitalize whitespace-nowrap ${
                    statusFilter === st
                      ? 'bg-white dark:bg-[#353535] text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-[#A8A8A8] hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2" role="listbox" aria-label="Grid bus selector">
          {filteredNodes.map((node) => {
            const isSel = node.id === selectedNode.id;
            const util = Math.round((node.loadMW / Math.max(1, node.capacityMW)) * 100);
            return (
              <button
                key={node.id}
                type="button"
                role="option"
                aria-selected={isSel}
                onClick={() => onSelectNode(node.id)}
                className={`inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs transition-colors whitespace-nowrap ${
                  isSel
                    ? 'border-[#0F62FE] bg-[#0F62FE]/10 dark:bg-[#353535] text-slate-900 dark:text-white font-semibold'
                    : 'border-slate-200 dark:border-[#525252] bg-slate-50/70 dark:bg-[#161616] text-slate-700 dark:text-[#C6C6C6] hover:bg-slate-100 dark:hover:bg-[#353535]'
                }`}
              >
                <span
                  className="h-2 w-2 rounded-full shrink-0"
                  style={{ backgroundColor: statusColor(node.status) }}
                  aria-hidden="true"
                />
                <span className="font-mono font-semibold">{node.id}</span>
                <span className="max-w-[130px] truncate">{node.name}</span>
                <span className="font-mono text-[10px] text-slate-500 dark:text-[#A8A8A8] tabular-nums">
                  {util}%
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Main Single-Node Deep-Dive Workspace */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* LEFT (7 cols): Node-Specific Capability Profile + Local 1-Hop Ego-Subgraph + 24h Capability Envelope */}
        <div className="xl:col-span-7 space-y-6">
          {/* 1. Role-Specific Hardware & Capability Diagnostics */}
          <section className="card-interactive rounded-md border border-slate-200 dark:border-[#393939] bg-white dark:bg-[#262626] p-5 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-slate-200 dark:border-[#393939]">
              <div>
                <div className="flex items-center gap-2 text-[11px] font-mono text-slate-500 dark:text-[#A8A8A8]">
                  <span>{selectedNode.id}</span>
                  <span>·</span>
                  <span className="uppercase">{selectedNode.role}</span>
                  <span>·</span>
                  <span>{roleDiagnostics.assetClass}</span>
                </div>
                <h2 className="mt-0.5 text-base font-semibold text-slate-900 dark:text-[#F4F4F4]">
                  {selectedNode.name} — {roleDiagnostics.roleTitle}
                </h2>
              </div>
              <StatusIndicator status={selectedNode.status} badgeStyle />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {roleDiagnostics.features.map((feat) => (
                <div
                  key={feat.label}
                  className="card-interactive rounded-md border border-slate-200 dark:border-[#393939] bg-slate-50/70 dark:bg-[#1E1E1E] p-3.5 space-y-2"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-xs font-medium text-slate-700 dark:text-[#C6C6C6]">
                      {feat.label}
                    </span>
                    <span className="text-sm font-mono font-semibold text-slate-900 dark:text-[#F4F4F4] tabular-nums whitespace-nowrap">
                      <AnimatedText text={feat.value} />
                    </span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-slate-200 dark:bg-[#393939] overflow-hidden">
                    <motion.div
                      key={`${selectedNode.id}-${feat.label}`}
                      className={`h-full rounded-full ${toneBarClass(feat.tone)}`}
                      initial={{ width: reduceMotion ? `${Math.max(4, Math.min(100, feat.pct))}%` : '0%' }}
                      animate={{ width: `${Math.max(4, Math.min(100, feat.pct))}%` }}
                      transition={{ duration: 0.9, ease: 'easeOut' }}
                    />
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-[#A8A8A8]">
                    {feat.detail}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-start gap-2.5 rounded-md border border-[#0F62FE]/25 dark:border-[#525252] bg-[#0F62FE]/[0.04] dark:bg-[#1E1E1E] px-3.5 py-2.5 text-xs text-slate-700 dark:text-[#E0E0E0]">
              <ShieldAlert className="h-4 w-4 text-[#0F62FE] dark:text-[#78A9FF] shrink-0 mt-0.5" aria-hidden="true" />
              <span>{roleDiagnostics.advisory}</span>
            </div>
          </section>

          {/* 2. Local 1-Hop Ego-Topology (Focused ONLY on selected node & direct neighbors) */}
          <section className="card-interactive rounded-md border border-slate-200 dark:border-[#393939] bg-white dark:bg-[#262626] p-5">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200 dark:border-[#393939]">
              <div className="flex items-center gap-2">
                <GitBranch className="h-4 w-4 text-[#0F62FE] dark:text-[#78A9FF]" aria-hidden="true" />
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-[#F4F4F4]">
                    Local 1-Hop Neighborhood & Corridor Flows ({selectedNode.id})
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-[#A8A8A8]">
                    Isolated direct ties connected to {selectedNode.name}. Click any neighbor bus to step to its diagnostics.
                  </p>
                </div>
              </div>
              <span className="text-[11px] font-mono text-slate-500 dark:text-[#A8A8A8]">
                {connectedEdges.length} direct ties
              </span>
            </div>

            <div className="mt-3 rounded-md border border-slate-200 dark:border-[#393939] bg-[#F8FAFC] dark:bg-[#121212] p-2">
              <svg
                viewBox={`0 0 ${egoW} ${egoH}`}
                className="w-full h-[285px]"
                role="img"
                aria-label={`Local 1-hop neighborhood diagram for ${selectedNode.name}`}
              >
                {/* Radial tie lines */}
                {connectedEdges.map((edge, idx) => {
                  const angle =
                    connectedEdges.length === 1
                      ? 0
                      : -Math.PI / 2 + (idx / connectedEdges.length) * Math.PI * 2;
                  const nx = centerX + Math.cos(angle) * radiusX;
                  const ny = centerY + Math.sin(angle) * radiusY;
                  const midX = centerX + (nx - centerX) * 0.51;
                  const midY = centerY + (ny - centerY) * 0.51;
                  const edgeColor = edge.isQuantumPath
                    ? isDark
                      ? '#78A9FF'
                      : '#0F62FE'
                    : statusColor(edge.status);
                  const flowPct = Math.round((edge.flowMW / Math.max(1, edge.limitMW)) * 100);

                  return (
                    <g key={edge.id}>
                      <line
                        x1={centerX}
                        y1={centerY}
                        x2={nx}
                        y2={ny}
                        stroke={edgeColor}
                        strokeWidth={edge.isQuantumPath ? 3 : 2}
                        strokeDasharray={edge.isQuantumPath ? undefined : '5 4'}
                        strokeOpacity={0.9}
                      />
                      <rect
                        x={midX - 42}
                        y={midY - 10}
                        width={84}
                        height={20}
                        rx={4}
                        fill={isDark ? '#262626' : '#FFFFFF'}
                        stroke={isDark ? '#525252' : '#CBD5E1'}
                        strokeWidth={1}
                      />
                      <text
                        x={midX}
                        y={midY + 3.5}
                        textAnchor="middle"
                        fontSize="9.5"
                        fontFamily="IBM Plex Mono, monospace"
                        fill={isDark ? '#F4F4F4' : '#0F172A'}
                      >
                        {edge.flowMW}MW ({flowPct}%)
                      </text>
                    </g>
                  );
                })}

                {/* Neighbor nodes */}
                {connectedEdges.map((edge, idx) => {
                  const peerId = edge.source === selectedNode.id ? edge.target : edge.source;
                  const peer = nodeMap.get(peerId);
                  if (!peer) return null;
                  const angle =
                    connectedEdges.length === 1
                      ? 0
                      : -Math.PI / 2 + (idx / connectedEdges.length) * Math.PI * 2;
                  const nx = centerX + Math.cos(angle) * radiusX;
                  const ny = centerY + Math.sin(angle) * radiusY;
                  const peerLabel =
                    peer.name.length > 19 ? `${peer.name.slice(0, 18)}…` : peer.name;

                  return (
                    <g
                      key={peer.id}
                      transform={`translate(${nx},${ny})`}
                      onClick={() => onSelectNode(peer.id)}
                      className="cursor-pointer"
                      role="button"
                      tabIndex={0}
                      aria-label={`Inspect neighbor ${peer.name}`}
                    >
                      <rect
                        x={-64}
                        y={-22}
                        width={128}
                        height={44}
                        rx={6}
                        fill={isDark ? '#262626' : '#FFFFFF'}
                        stroke={statusColor(peer.status)}
                        strokeWidth={2}
                      />
                      <text
                        y={-4}
                        textAnchor="middle"
                        fontSize="10.5"
                        fontWeight="600"
                        fontFamily="IBM Plex Mono, monospace"
                        fill={isDark ? '#F4F4F4' : '#0F172A'}
                      >
                        {peer.id} · q[{peer.qubitIndex}]
                      </text>
                      <text
                        y={12}
                        textAnchor="middle"
                        fontSize="9.5"
                        fontFamily="IBM Plex Sans, sans-serif"
                        fill={isDark ? '#A8A8A8' : '#475569'}
                      >
                        {peerLabel}
                      </text>
                    </g>
                  );
                })}

                {/* Center Selected Bus */}
                <g transform={`translate(${centerX},${centerY})`}>
                  <rect
                    x={-64}
                    y={-26}
                    width={128}
                    height={52}
                    rx={8}
                    fill={isDark ? '#161616' : '#FFFFFF'}
                    stroke={isDark ? '#78A9FF' : '#0F62FE'}
                    strokeWidth={2.5}
                  />
                  <rect
                    x={-64}
                    y={-26}
                    width={128}
                    height={5}
                    rx={2}
                    fill={statusColor(selectedNode.status)}
                  />
                  <text
                    y={-3}
                    textAnchor="middle"
                    fontSize="11.5"
                    fontWeight="700"
                    fontFamily="IBM Plex Mono, monospace"
                    fill={isDark ? '#FFFFFF' : '#0F172A'}
                  >
                    {selectedNode.id} · {utilizationPct}%
                  </text>
                  <text
                    y={14}
                    textAnchor="middle"
                    fontSize="10"
                    fontFamily="IBM Plex Sans, sans-serif"
                    fill={isDark ? '#C6C6C6' : '#334155'}
                  >
                    {selectedNode.name.slice(0, 18)}
                  </text>
                </g>
              </svg>
            </div>
          </section>

          {/* 3. 24-Hour Capability Envelope: Qiskit QAOA vs Classical Dispatch */}
          <section className="rounded-md border border-slate-200 dark:border-[#393939] bg-white dark:bg-[#262626] p-5">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200 dark:border-[#393939]">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-[#0F62FE] dark:text-[#78A9FF]" aria-hidden="true" />
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-[#F4F4F4]">
                    24-Hour Node Capability Envelope ({selectedNode.id})
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-[#A8A8A8]">
                    Projected daily load profile vs rated {selectedNode.capacityMW} MW ceiling showing QAOA peak shaving.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 text-[11px]">
                <span className="inline-flex items-center gap-1.5 text-[#0F62FE] dark:text-[#78A9FF] font-medium">
                  <span className="h-0.5 w-3.5 bg-[#0F62FE] dark:bg-[#78A9FF]" /> Qiskit QAOA
                </span>
                <span className="inline-flex items-center gap-1.5 text-slate-600 dark:text-[#A8A8A8] font-medium">
                  <span className="h-0.5 w-3.5 bg-slate-500 dark:bg-[#8D8D8D]" /> Classical
                </span>
                <span className="inline-flex items-center gap-1.5 text-[#DC2626] dark:text-[#FA4D56] font-medium">
                  <span className="h-0.5 w-3.5 bg-[#DC2626] dark:bg-[#FA4D56]" /> 90% Alarm
                </span>
              </div>
            </div>

            <div className="mt-3">
              <svg
                key={selectedNode.id}
                viewBox={`0 0 ${chartW} ${chartH}`}
                className="w-full h-[195px] touch-pan-y"
                onPointerMove={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const vx = ((e.clientX - rect.left) / rect.width) * chartW;
                  const idx = Math.round(((vx - padL) / (chartW - padL - padR)) * 23);
                  setHoverHour(Math.max(0, Math.min(23, idx)));
                }}
                onPointerLeave={() => setHoverHour(null)}
                role="img"
                aria-label={`24-hour capability envelope chart for ${selectedNode.name}`}
              >
                {/* Horizontal gridlines */}
                {[0, 0.25, 0.5, 0.75, 1].map((f) => {
                  const val = Math.round(maxY * f);
                  const y = toY(val);
                  return (
                    <g key={f}>
                      <line
                        x1={padL}
                        y1={y}
                        x2={chartW - padR}
                        y2={y}
                        stroke={isDark ? '#303030' : '#E2E8F0'}
                        strokeWidth={1}
                      />
                      <text
                        x={padL - 6}
                        y={y + 3}
                        textAnchor="end"
                        fontSize="9"
                        fontFamily="IBM Plex Mono, monospace"
                        fill={isDark ? '#8D8D8D' : '#64748B'}
                      >
                        {val}
                      </text>
                    </g>
                  );
                })}

                {/* Rated Capacity & 90% Alarm reference lines */}
                <line
                  x1={padL}
                  y1={capY}
                  x2={chartW - padR}
                  y2={capY}
                  stroke={isDark ? '#6F6F6F' : '#94A3B8'}
                  strokeDasharray="3 3"
                  strokeWidth={1.2}
                />
                <line
                  x1={padL}
                  y1={alarmY}
                  x2={chartW - padR}
                  y2={alarmY}
                  stroke={isDark ? '#FA4D56' : '#DC2626'}
                  strokeDasharray="4 4"
                  strokeWidth={1.3}
                />

                <defs>
                  <clipPath id="envelope-reveal">
                    <motion.rect
                      x={0}
                      y={0}
                      height={chartH}
                      initial={{ width: reduceMotion ? chartW : 0 }}
                      animate={{ width: chartW }}
                      transition={{ duration: 1.2, ease: 'easeInOut' }}
                    />
                  </clipPath>
                </defs>

                {/* Classical curve (dashed, revealed left-to-right with the same timing) */}
                <path
                  d={classicalPath}
                  fill="none"
                  stroke={isDark ? '#A8A8A8' : '#64748B'}
                  strokeWidth={2}
                  strokeDasharray="5 3"
                  clipPath="url(#envelope-reveal)"
                />

                {/* Quantum QAOA curve */}
                <motion.path
                  d={quantumPath}
                  fill="none"
                  stroke={isDark ? '#78A9FF' : '#0F62FE'}
                  strokeWidth={2.5}
                  initial={{ pathLength: reduceMotion ? 1 : 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 1.2, ease: 'easeInOut' }}
                />

                {/* Staggered data point reveal */}
                {hourlyEnvelope.map((pt, i) => (
                  <motion.circle
                    key={pt.hour}
                    cx={toX(i)}
                    cy={toY(pt.quantumMW)}
                    r={hoverHour === i ? 4 : 2}
                    fill={isDark ? '#78A9FF' : '#0F62FE'}
                    initial={{ opacity: reduceMotion ? 1 : 0 }}
                    animate={{ opacity: hoverHour === null || hoverHour === i ? 1 : 0.35 }}
                    transition={{ delay: reduceMotion ? 0 : (i / 23) * 1.2, duration: 0.25 }}
                  />
                ))}

                {/* Hover trace crosshair + floating readout */}
                {hoverHour !== null && hourlyEnvelope[hoverHour] && (() => {
                  const pt = hourlyEnvelope[hoverHour];
                  const x = toX(hoverHour);
                  const boxW = 112;
                  const boxX = x > chartW * 0.65 ? x - boxW - 8 : x + 8;
                  return (
                    <g pointerEvents="none">
                      <line
                        x1={x}
                        y1={padT}
                        x2={x}
                        y2={chartH - padB}
                        stroke={isDark ? '#8D8D8D' : '#94A3B8'}
                        strokeWidth={1}
                        strokeDasharray="2 3"
                      />
                      <circle cx={x} cy={toY(pt.classicalMW)} r={3.5} fill={isDark ? '#A8A8A8' : '#64748B'} />
                      <rect
                        x={boxX}
                        y={padT}
                        width={boxW}
                        height={50}
                        rx={4}
                        fill={isDark ? '#262626' : '#FFFFFF'}
                        stroke={isDark ? '#525252' : '#CBD5E1'}
                      />
                      <text x={boxX + 8} y={padT + 14} fontSize="9" fontFamily="IBM Plex Mono, monospace" fill={isDark ? '#A8A8A8' : '#64748B'}>
                        {pt.hour}
                      </text>
                      <text x={boxX + 8} y={padT + 28} fontSize="10" fontFamily="IBM Plex Mono, monospace" fill={isDark ? '#78A9FF' : '#0F62FE'}>
                        QAOA {pt.quantumMW} MW
                      </text>
                      <text x={boxX + 8} y={padT + 42} fontSize="10" fontFamily="IBM Plex Mono, monospace" fill={isDark ? '#F4F4F4' : '#0F172A'}>
                        Classical {pt.classicalMW} MW
                      </text>
                    </g>
                  );
                })()}

                {/* X-axis labels */}
                {[0, 4, 8, 12, 16, 20, 23].map((hr) => (
                  <text
                    key={hr}
                    x={toX(hr)}
                    y={chartH - 6}
                    textAnchor="middle"
                    fontSize="9"
                    fontFamily="IBM Plex Mono, monospace"
                    fill={isDark ? '#8D8D8D' : '#64748B'}
                  >
                    {String(hr).padStart(2, '0')}h
                  </text>
                ))}
              </svg>
            </div>
          </section>
        </div>

        {/* RIGHT (5 cols): Live Node Telemetry Controls, Stress Testing, Qubit Coupling & Direct Ties */}
        <div className="xl:col-span-5 space-y-6">
          <div className="card-interactive rounded-md border border-slate-200 dark:border-[#393939] bg-white dark:bg-[#262626] p-5 space-y-5">
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-200 dark:border-[#393939]">
              <div>
                <div className="text-xs font-mono text-slate-500 dark:text-[#A8A8A8]">
                  {selectedNode.id} · {selectedNode.region} · Qubit q[{selectedNode.qubitIndex}]
                </div>
                <h2 className="mt-0.5 text-lg font-semibold text-slate-900 dark:text-[#F4F4F4]">
                  {selectedNode.name}
                </h2>
              </div>
              <StatusIndicator status={selectedNode.status} badgeStyle />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-md border border-slate-200 dark:border-[#393939] bg-slate-50/70 dark:bg-[#1E1E1E] p-3">
                <div className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-[#A8A8A8]">
                  <Gauge className="h-3 w-3" aria-hidden="true" />
                  Load Utilization
                </div>
                <div className="mt-1 text-lg font-mono font-semibold text-slate-900 dark:text-[#F4F4F4] tabular-nums">
                  {utilizationPct}%
                </div>
                <div className="text-[11px] font-mono text-slate-500 dark:text-[#A8A8A8] tabular-nums">
                  {selectedNode.loadMW} / {selectedNode.capacityMW} MW
                </div>
              </div>
              <div className="rounded-md border border-slate-200 dark:border-[#393939] bg-slate-50/70 dark:bg-[#1E1E1E] p-3">
                <div className="text-[11px] text-slate-500 dark:text-[#A8A8A8]">Bus Voltage</div>
                <div className="mt-1 text-lg font-mono font-semibold text-slate-900 dark:text-[#F4F4F4] tabular-nums">
                  {selectedNode.voltagePU.toFixed(3)} p.u.
                </div>
                <div className="text-[11px] font-mono text-slate-500 dark:text-[#A8A8A8] tabular-nums">
                  Phase {selectedNode.phaseAngleDeg}°
                </div>
              </div>
              <div className="rounded-md border border-slate-200 dark:border-[#393939] bg-slate-50/70 dark:bg-[#1E1E1E] p-3">
                <div className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-[#A8A8A8]">
                  <Thermometer className="h-3 w-3" aria-hidden="true" />
                  Thermal Reading
                </div>
                <div className="mt-1 text-lg font-mono font-semibold text-slate-900 dark:text-[#F4F4F4] tabular-nums">
                  {selectedNode.temperatureC.toFixed(1)} °C
                </div>
                <div className="text-[11px] text-slate-500 dark:text-[#A8A8A8]">Alarm ceiling 85.0 °C</div>
              </div>
              <div className="rounded-md border border-slate-200 dark:border-[#393939] bg-slate-50/70 dark:bg-[#1E1E1E] p-3">
                <div className="text-[11px] text-slate-500 dark:text-[#A8A8A8]">QAOA vs Classical</div>
                <div className="mt-1 text-lg font-mono font-semibold text-[#0F62FE] dark:text-[#78A9FF] tabular-nums">
                  {selectedNode.quantumDispatchMW} MW
                </div>
                <div className="text-[11px] font-mono text-slate-500 dark:text-[#A8A8A8] tabular-nums">
                  Classical: {selectedNode.classicalDispatchMW} MW
                </div>
              </div>
            </div>

            {/* Live Node Stress Simulator */}
            <div className="border-t border-slate-200 dark:border-[#393939] pt-4 space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <label
                  htmlFor="node-stress-slider"
                  className="inline-flex items-center gap-1.5 font-medium text-slate-700 dark:text-[#E0E0E0]"
                >
                  <Sliders className="h-3.5 w-3.5 text-slate-500 dark:text-[#A8A8A8]" aria-hidden="true" />
                  Simulate {selectedNode.id} Load Stress
                </label>
                <span className="font-mono font-semibold text-slate-900 dark:text-[#F4F4F4] tabular-nums">
                  {utilizationPct}% capacity
                </span>
              </div>
              <input
                id="node-stress-slider"
                type="range"
                min={25}
                max={99}
                value={utilizationPct}
                onChange={(e) => onAdjustNodeStress(selectedNode.id, Number(e.target.value))}
                className="w-full accent-[#0F62FE]"
              />
              <div className="flex justify-between text-[11px] font-mono text-slate-500 dark:text-[#A8A8A8]">
                <span>25% Healthy</span>
                <span>75% Warning</span>
                <span>90%+ Alarming</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => onRerouteNode(selectedNode.id)}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md bg-[#0F62FE] px-4 py-2 text-xs font-medium text-white hover:bg-[#0353E9] transition-colors whitespace-nowrap"
              >
                <Zap className="h-3.5 w-3.5" aria-hidden="true" />
                Reroute {selectedNode.id} via Qiskit QAOA
              </button>
              <button
                type="button"
                onClick={() => onAdjustNodeStress(selectedNode.id, 58)}
                className="rounded-md border border-slate-300 dark:border-[#525252] bg-white dark:bg-[#161616] px-3 py-2 text-xs font-medium text-slate-700 dark:text-[#E0E0E0] hover:bg-slate-50 dark:hover:bg-[#353535] whitespace-nowrap"
              >
                Set Nominal
              </button>
            </div>

            {/* Qubit Register & QUBO Hamiltonian Mapping */}
            <div className="border-t border-slate-200 dark:border-[#393939] pt-4 space-y-2.5">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-800 dark:text-[#E0E0E0]">
                <span className="inline-flex items-center gap-1.5">
                  <Cpu className="h-3.5 w-3.5 text-[#0F62FE] dark:text-[#78A9FF]" aria-hidden="true" />
                  Qubit Register q[{selectedNode.qubitIndex}] Hamiltonian Terms
                </span>
                <span className="font-mono text-[11px] text-[#0F62FE] dark:text-[#78A9FF]">
                  h_Z = {qubitPenaltyZ}
                </span>
              </div>
              <div className="rounded-md border border-slate-200 dark:border-[#393939] bg-slate-50/70 dark:bg-[#1E1E1E] p-3 text-xs space-y-1.5 font-mono">
                <div className="flex justify-between text-[11px]">
                  <span className="text-slate-500 dark:text-[#A8A8A8]">Local Dispatch Relief (Q − C)</span>
                  <span className="font-semibold text-[#15803D] dark:text-[#42BE65]">
                    {dispatchDeltaMW >= 0 ? `−${dispatchDeltaMW}` : `+${Math.abs(dispatchDeltaMW)}`} MW
                  </span>
                </div>
                <div className="flex justify-between text-[11px]">
                  <span className="text-slate-500 dark:text-[#A8A8A8]">Coupled Neighbor Qubits</span>
                  <span className="text-slate-800 dark:text-[#E0E0E0]">
                    {connectedEdges
                      .map((e) => {
                        const peer = nodeMap.get(e.source === selectedNode.id ? e.target : e.source);
                        return peer ? `q[${peer.qubitIndex}]` : '';
                      })
                      .filter(Boolean)
                      .join(', ') || 'None'}
                  </span>
                </div>
              </div>
            </div>

            {/* Direct Corridors */}
            <div className="border-t border-slate-200 dark:border-[#393939] pt-4">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-800 dark:text-[#E0E0E0] mb-2">
                <span>Connected Corridors ({connectedEdges.length})</span>
                <span className="font-mono font-normal text-[11px] text-slate-500 dark:text-[#A8A8A8]">
                  Click peer to jump
                </span>
              </div>
              <div className="divide-y divide-slate-100 dark:divide-[#393939] text-xs">
                {connectedEdges.map((edge) => {
                  const peerId = edge.source === selectedNode.id ? edge.target : edge.source;
                  return (
                    <div key={edge.id} className="py-2 flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => onSelectNode(peerId)}
                        className="font-mono font-medium text-[#0F62FE] dark:text-[#78A9FF] hover:underline"
                      >
                        {edge.id} → {peerId}
                      </button>
                      <div className="font-mono tabular-nums text-slate-600 dark:text-[#A8A8A8]">
                        {edge.flowMW}/{edge.limitMW} MW · Loss {edge.lossMW} MW
                      </div>
                      <StatusIndicator status={edge.status} compact />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
