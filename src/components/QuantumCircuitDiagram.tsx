import { useState } from 'react';
import { Check, Code2, Copy } from 'lucide-react';
import type { QuantumCircuitResult } from '../types/grid';

interface QuantumCircuitDiagramProps {
  result: QuantumCircuitResult;
  isDark?: boolean;
}

const GATE_COLORS_LIGHT: Record<string, { fill: string; stroke: string; text: string }> = {
  H: { fill: '#DBEAFE', stroke: '#0F62FE', text: '#1E3A8A' },
  RX: { fill: '#FEF3C7', stroke: '#D97706', text: '#78350F' },
  RY: { fill: '#E0E7FF', stroke: '#4338CA', text: '#312E81' },
  RZ: { fill: '#E0F2FE', stroke: '#0284C7', text: '#0C4A6E' },
  RZZ: { fill: '#0F62FE', stroke: '#0F62FE', text: '#FFFFFF' },
  CX: { fill: '#0F62FE', stroke: '#0F62FE', text: '#FFFFFF' },
  M: { fill: '#0F172A', stroke: '#0F172A', text: '#FFFFFF' },
};

const GATE_COLORS_DARK: Record<string, { fill: string; stroke: string; text: string }> = {
  H: { fill: '#262626', stroke: '#78A9FF', text: '#F4F4F4' },
  RX: { fill: '#2B2416', stroke: '#F1C21B', text: '#F4F4F4' },
  RY: { fill: '#2B2B2B', stroke: '#BE95FF', text: '#F4F4F4' },
  RZ: { fill: '#262626', stroke: '#33B1FF', text: '#F4F4F4' },
  RZZ: { fill: '#0F62FE', stroke: '#4589FF', text: '#FFFFFF' },
  CX: { fill: '#0F62FE', stroke: '#4589FF', text: '#FFFFFF' },
  M: { fill: '#393939', stroke: '#8D8D8D', text: '#F4F4F4' },
};

export function QuantumCircuitDiagram({ result, isDark = false }: QuantumCircuitDiagramProps) {
  const [showCode, setShowCode] = useState(false);
  const [copied, setCopied] = useState(false);

  const qubits = result.config.qubits;
  const cols = result.depth;
  const colSpacing = 54;
  const rowSpacing = 38;
  const leftPad = 56;
  const topPad = 24;
  const svgWidth = Math.max(540, leftPad + cols * colSpacing + 36);
  const svgHeight = topPad + qubits * rowSpacing + 18;
  const gateColors = isDark ? GATE_COLORS_DARK : GATE_COLORS_LIGHT;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(result.qiskitCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-slate-500 dark:text-[#A8A8A8] font-mono tabular-nums">
          {result.config.ansatz} · {qubits} Qubits · Depth {result.depth} · {result.twoQubitGates} Entangling Gates
        </div>
        <button
          type="button"
          onClick={() => setShowCode((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 dark:border-[#525252] bg-white dark:bg-[#262626] px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-[#F4F4F4] hover:bg-slate-50 dark:hover:bg-[#353535] whitespace-nowrap"
        >
          <Code2 className="h-3.5 w-3.5" aria-hidden="true" />
          {showCode ? 'Hide Qiskit Code' : 'View Qiskit 1.x Code'}
        </button>
      </div>

      <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-[#393939] bg-[#F8FAFC] dark:bg-[#121212] p-3">
        <svg
          width={svgWidth}
          height={svgHeight}
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="block"
          role="img"
          aria-label={`Quantum circuit diagram with ${qubits} qubits and ${result.depth} layers`}
        >
          {/* Qubit wires */}
          {Array.from({ length: qubits }, (_, q) => {
            const y = topPad + q * rowSpacing;
            return (
              <g key={`wire-${q}`}>
                <text
                  x={12}
                  y={y + 4}
                  fontFamily='"IBM Plex Mono", monospace'
                  fontSize="11"
                  fontWeight="500"
                  fill={isDark ? '#A8A8A8' : '#475569'}
                >
                  q[{q}]
                </text>
                <line
                  x1={leftPad - 8}
                  y1={y}
                  x2={svgWidth - 18}
                  y2={y}
                  stroke={isDark ? '#525252' : '#CBD5E1'}
                  strokeWidth="1.5"
                />
              </g>
            );
          })}

          {/* Circuit Gates */}
          {result.gates.map((gate) => {
            const cx = leftPad + gate.column * colSpacing + 18;
            const cy = topPad + gate.qubit * rowSpacing;
            const palette = gateColors[gate.type];
            const accent = isDark ? '#4589FF' : '#0F62FE';

            if ((gate.type === 'CX' || gate.type === 'RZZ') && gate.targetQubit !== undefined) {
              const ty = topPad + gate.targetQubit * rowSpacing;
              return (
                <g key={gate.id}>
                  <line x1={cx} y1={cy} x2={cx} y2={ty} stroke={accent} strokeWidth="2" />
                  <circle cx={cx} cy={cy} r="5" fill={accent} />
                  {gate.type === 'CX' ? (
                    <g>
                      <circle cx={cx} cy={ty} r="9" fill={isDark ? '#161616' : '#FFFFFF'} stroke={accent} strokeWidth="2" />
                      <line x1={cx - 5} y1={ty} x2={cx + 5} y2={ty} stroke={accent} strokeWidth="1.8" />
                      <line x1={cx} y1={ty - 5} x2={cx} y2={ty + 5} stroke={accent} strokeWidth="1.8" />
                    </g>
                  ) : (
                    <g>
                      <circle cx={cx} cy={ty} r="5" fill={accent} />
                      <rect
                        x={cx - 14}
                        y={(cy + ty) / 2 - 8}
                        width="28"
                        height="16"
                        rx="3"
                        fill={accent}
                      />
                      <text
                        x={cx}
                        y={(cy + ty) / 2 + 3.5}
                        textAnchor="middle"
                        fontFamily='"IBM Plex Mono", monospace'
                        fontSize="8.5"
                        fontWeight="600"
                        fill="#FFFFFF"
                      >
                        ZZ
                      </text>
                    </g>
                  )}
                </g>
              );
            }

            return (
              <g key={gate.id}>
                <rect
                  x={cx - 14}
                  y={cy - 12}
                  width="28"
                  height="24"
                  rx="3"
                  fill={palette.fill}
                  stroke={palette.stroke}
                  strokeWidth="1.3"
                />
                <text
                  x={cx}
                  y={cy + 3.5}
                  textAnchor="middle"
                  fontFamily='"IBM Plex Mono", monospace'
                  fontSize="10"
                  fontWeight="600"
                  fill={palette.text}
                >
                  {gate.type === 'M' ? 'M' : gate.type}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {showCode && (
        <div className="rounded-md border border-slate-200 dark:border-[#393939] bg-[#121212] text-[#F4F4F4] overflow-hidden">
          <div className="flex items-center justify-between border-b border-[#393939] px-3 py-2 text-xs text-[#A8A8A8]">
            <span className="font-mono">qiskit_grid_optimizer.py</span>
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-[#C6C6C6] hover:bg-[#353535] hover:text-white"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-[#42BE65]" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <pre className="overflow-x-auto p-3.5 text-xs font-mono leading-relaxed text-[#E0E0E0]">
            <code>{result.qiskitCode}</code>
          </pre>
        </div>
      )}
    </div>
  );
}
