import { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import type { GridEdge, GridNode, GridTopology, NodeSizeMode, PathViewMode } from '../types/grid';
import { StatusIndicator } from './StatusIndicator';

interface D3GridVisualizerProps {
  topology: GridTopology;
  pathMode: PathViewMode;
  isPlaying: boolean;
  isDark?: boolean;
  nodeSizeMode?: NodeSizeMode;
  selectedNodeId?: string | null;
  onSelectNode?: (nodeId: string) => void;
  heightClass?: string;
}

const STATUS_COLORS_LIGHT = {
  healthy: { fill: '#16A34A', soft: '#DCFCE7', stroke: '#15803D' },
  warning: { fill: '#D97706', soft: '#FEF3C7', stroke: '#B45309' },
  alarming: { fill: '#DC2626', soft: '#FEE2E2', stroke: '#B91C1C' },
} as const;

const STATUS_COLORS_DARK = {
  healthy: { fill: '#42BE65', soft: '#12291A', stroke: '#42BE65' },
  warning: { fill: '#F1C21B', soft: '#2C240B', stroke: '#F1C21B' },
  alarming: { fill: '#FA4D56', soft: '#311214', stroke: '#FA4D56' },
} as const;

const ROLE_ABBR: Record<GridNode['role'], string> = {
  generator: 'GEN',
  substation: 'SUB',
  transformer: 'TRF',
  load: 'BUS',
  renewable: 'REN',
};

export function D3GridVisualizer({
  topology,
  pathMode,
  isPlaying,
  isDark = false,
  nodeSizeMode = 'standard',
  selectedNodeId = null,
  onSelectNode,
  heightClass = 'h-[440px]',
}: D3GridVisualizerProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const zoomBehaviorRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [hoveredNode, setHoveredNode] = useState<{
    node: GridNode;
    xPct: number;
    yPct: number;
  } | null>(null);
  const [hoveredEdge, setHoveredEdge] = useState<{
    edge: GridEdge;
    xPct: number;
    yPct: number;
  } | null>(null);

  useEffect(() => {
    const svgElement = svgRef.current;
    if (!svgElement) return;

    const svg = d3.select(svgElement);
    svg.selectAll('*').remove();

    const width = 1000;
    const height = 560;
    const statusPalette = isDark ? STATUS_COLORS_DARK : STATUS_COLORS_LIGHT;
    const bgCanvas = isDark ? '#121212' : '#F8FAFC';
    const gridStroke = isDark ? '#262626' : '#E2E8F0';
    const quantumAccent = isDark ? '#78A9FF' : '#0F62FE';
    const classicalAccent = isDark ? '#8D8D8D' : '#475569';
    const nodeCoreBg = isDark ? '#1C1C1C' : '#FFFFFF';
    const primaryLabelColor = isDark ? '#F4F4F4' : '#0F172A';
    const secondaryLabelColor = isDark ? '#C6C6C6' : '#334155';
    const denseGrid = topology.nodes.length >= 20;

    const defs = svg.append('defs');
    const patternId = `grid-coord-pattern-${isDark ? 'dark' : 'light'}-${topology.id}`;
    const pattern = defs
      .append('pattern')
      .attr('id', patternId)
      .attr('width', 40)
      .attr('height', 40)
      .attr('patternUnits', 'userSpaceOnUse');

    pattern
      .append('path')
      .attr('d', 'M 40 0 L 0 0 0 40')
      .attr('fill', 'none')
      .attr('stroke', gridStroke)
      .attr('stroke-width', 0.75);

    svg.append('rect').attr('width', width).attr('height', height).attr('fill', bgCanvas);

    const rootG = svg.append('g').attr('class', 'grid-root-layer');

    rootG
      .append('rect')
      .attr('x', -400)
      .attr('y', -300)
      .attr('width', width + 800)
      .attr('height', height + 600)
      .attr('fill', `url(#${patternId})`);

    const nodeMap = new Map(topology.nodes.map((n) => [n.id, n]));

    // Edge Layer
    const edgesG = rootG.append('g').attr('class', 'edges-layer');

    const edgeGroups = edgesG
      .selectAll('g.grid-edge')
      .data(topology.edges, (d) => (d as GridEdge).id)
      .join('g')
      .attr('class', 'grid-edge cursor-pointer');

    edgeGroups.each(function (edge) {
      const src = nodeMap.get(edge.source);
      const tgt = nodeMap.get(edge.target);
      if (!src || !tgt) return;

      const g = d3.select(this);
      const isHighlightedQuantum = pathMode === 'quantum' && edge.isQuantumPath;
      const isHighlightedClassical = pathMode === 'classical' && edge.isClassicalPath;
      const isDiffQuantumOnly = pathMode === 'diff' && edge.isQuantumPath && !edge.isClassicalPath;
      const isDiffClassicalOnly = pathMode === 'diff' && edge.isClassicalPath && !edge.isQuantumPath;

      const healthColor = statusPalette[edge.status].fill;
      let strokeColor: string = healthColor;
      let strokeWidth = edge.status === 'alarming' ? 3.5 : edge.status === 'warning' ? 2.8 : 2.2;
      let strokeOpacity = 0.85;

      if (pathMode === 'quantum') {
        strokeOpacity = edge.isQuantumPath ? 0.95 : 0.25;
        if (edge.isQuantumPath && edge.status === 'healthy') {
          strokeColor = quantumAccent;
          strokeWidth = 3.1;
        }
      } else if (pathMode === 'classical') {
        strokeOpacity = edge.isClassicalPath ? 0.95 : 0.25;
        if (edge.isClassicalPath && edge.status === 'healthy') {
          strokeColor = classicalAccent;
          strokeWidth = 2.8;
        }
      } else if (pathMode === 'diff') {
        if (isDiffQuantumOnly) {
          strokeColor = quantumAccent;
          strokeWidth = 3.4;
          strokeOpacity = 0.95;
        } else if (isDiffClassicalOnly) {
          strokeColor = classicalAccent;
          strokeWidth = 2.6;
          strokeOpacity = 0.85;
        } else {
          strokeOpacity = 0.55;
        }
      }

      g.append('line')
        .attr('x1', src.x)
        .attr('y1', src.y)
        .attr('x2', tgt.x)
        .attr('y2', tgt.y)
        .attr('stroke', 'transparent')
        .attr('stroke-width', 14);

      g.append('line')
        .attr('x1', src.x)
        .attr('y1', src.y)
        .attr('x2', tgt.x)
        .attr('y2', tgt.y)
        .attr('stroke', strokeColor)
        .attr('stroke-width', denseGrid ? strokeWidth * 0.82 : strokeWidth)
        .attr('stroke-opacity', strokeOpacity)
        .attr('stroke-linecap', 'round')
        .attr('stroke-dasharray', isDiffClassicalOnly ? '6 5' : null);

      const shouldAnimate =
        isPlaying &&
        (isHighlightedQuantum ||
          isHighlightedClassical ||
          isDiffQuantumOnly ||
          edge.status === 'alarming');

      if (shouldAnimate) {
        g.append('line')
          .attr('x1', src.x)
          .attr('y1', src.y)
          .attr('x2', tgt.x)
          .attr('y2', tgt.y)
          .attr('stroke', edge.status === 'alarming' ? '#FEE2E2' : '#FFFFFF')
          .attr('stroke-width', 1.7)
          .attr('stroke-dasharray', '4 14')
          .attr('stroke-linecap', 'round')
          .attr('class', 'edge-flow-animated')
          .attr('pointer-events', 'none');
      }

      g.on('mouseenter', () => {
        const midX = (src.x + tgt.x) / 2;
        const midY = (src.y + tgt.y) / 2;
        setHoveredNode(null);
        setHoveredEdge({
          edge,
          xPct: Math.min(86, Math.max(14, (midX / width) * 100)),
          yPct: Math.min(86, Math.max(12, (midY / height) * 100)),
        });
      }).on('mouseleave', () => {
        setHoveredEdge(null);
      });
    });

    // Node Layer
    const nodesG = rootG.append('g').attr('class', 'nodes-layer');

    const nodeGroups = nodesG
      .selectAll('g.grid-node')
      .data(topology.nodes, (d) => (d as GridNode).id)
      .join('g')
      .attr('class', 'grid-node cursor-pointer')
      .attr('data-node-id', (d) => d.id)
      .attr('transform', (d) => `translate(${d.x},${d.y})`)
      .attr('role', 'button')
      .attr('tabindex', 0)
      .attr('aria-label', (d) => `${d.name} (${d.status}, ${d.loadMW} MW)`);

    nodeGroups.each(function (node) {
      const g = d3.select(this);
      const colors = statusPalette[node.status];
      const isSelected = node.id === selectedNodeId;
      const baseRadius = node.role === 'generator' || node.role === 'substation' ? 21 : 18;
      let radius = baseRadius;
      if (nodeSizeMode === 'compact' || denseGrid) {
        radius = nodeSizeMode === 'compact' ? 14 : Math.max(14, baseRadius - 4);
      }
      if (nodeSizeMode === 'proportional') {
        const loadRatio = Math.min(1.25, Math.max(0.65, node.loadMW / 160));
        radius = Math.round(16 * loadRatio + 3);
      }

      if (isSelected) {
        g.append('circle')
          .attr('r', radius + 7)
          .attr('fill', 'none')
          .attr('stroke', quantumAccent)
          .attr('stroke-width', 2.5)
          .attr('stroke-dasharray', '4 3');
      }

      g.append('circle')
        .attr('r', radius + 3)
        .attr('fill', colors.soft)
        .attr('stroke', colors.stroke)
        .attr('stroke-width', node.status === 'alarming' ? 2.4 : 1.5);

      g.append('circle')
        .attr('r', radius - 2)
        .attr('fill', nodeCoreBg)
        .attr('stroke', colors.fill)
        .attr('stroke-width', 2.2);

      g.append('text')
        .attr('text-anchor', 'middle')
        .attr('dy', radius <= 15 ? '0.32em' : '-0.1em')
        .attr('font-family', '"IBM Plex Mono", monospace')
        .attr('font-size', radius <= 15 ? '9px' : '10.5px')
        .attr('font-weight', '600')
        .attr('fill', primaryLabelColor)
        .text(node.id);

      if (radius > 15) {
        g.append('text')
          .attr('text-anchor', 'middle')
          .attr('dy', '1.05em')
          .attr('font-family', '"IBM Plex Mono", monospace')
          .attr('font-size', '8px')
          .attr('font-weight', '500')
          .attr('fill', colors.stroke)
          .text(ROLE_ABBR[node.role]);
      }

      // Non-hue-only status marker shape
      const markerX = radius - 1;
      const markerY = -radius + 1;
      if (node.status === 'alarming') {
        g.append('rect')
          .attr('x', markerX - 4.5)
          .attr('y', markerY - 4.5)
          .attr('width', 9)
          .attr('height', 9)
          .attr('rx', 1.5)
          .attr('fill', colors.fill)
          .attr('stroke', nodeCoreBg)
          .attr('stroke-width', 1.4);
      } else if (node.status === 'warning') {
        g.append('polygon')
          .attr('points', `${markerX},${markerY - 5.5} ${markerX + 5.5},${markerY + 4.5} ${markerX - 5.5},${markerY + 4.5}`)
          .attr('fill', colors.fill)
          .attr('stroke', nodeCoreBg)
          .attr('stroke-width', 1.3);
      } else {
        g.append('circle')
          .attr('cx', markerX)
          .attr('cy', markerY)
          .attr('r', 4.2)
          .attr('fill', colors.fill)
          .attr('stroke', nodeCoreBg)
          .attr('stroke-width', 1.4);
      }

      if (!denseGrid || isSelected) {
        g.append('text')
          .attr('text-anchor', 'middle')
          .attr('y', radius + 16)
          .attr('font-family', '"IBM Plex Sans", sans-serif')
          .attr('font-size', '10.5px')
          .attr('font-weight', isSelected ? '600' : '500')
          .attr('fill', isSelected ? quantumAccent : secondaryLabelColor)
          .text(node.name);
      }
    });

    let leaveTimeout: number | null = null;

    nodeGroups
      .on('mouseenter', function (_, node) {
        if (leaveTimeout !== null) {
          window.clearTimeout(leaveTimeout);
          leaveTimeout = null;
        }
        d3.select(this).transition().duration(150).attr('transform', `translate(${node.x},${node.y}) scale(1.06)`);
        setHoveredEdge(null);
        setHoveredNode({
          node,
          xPct: Math.min(90, Math.max(10, (node.x / width) * 100)),
          yPct: Math.min(88, Math.max(10, (node.y / height) * 100)),
        });
      })
      .on('mouseleave', function (_, node) {
        d3.select(this).transition().duration(150).attr('transform', `translate(${node.x},${node.y}) scale(1)`);
        if (leaveTimeout !== null) window.clearTimeout(leaveTimeout);
        leaveTimeout = window.setTimeout(() => {
          leaveTimeout = null;
          setHoveredNode((prev) => (prev?.node.id === node.id ? null : prev));
        }, 220);
      })
      .on('click', (_, node) => {
        onSelectNode?.(node.id);
      })
      .on('keydown', (event: KeyboardEvent, node) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelectNode?.(node.id);
        }
      });

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.65, 2.2])
      .on('zoom', (event) => {
        rootG.attr('transform', event.transform.toString());
      });

    zoomBehaviorRef.current = zoom;
    svg.call(zoom);

    return () => {
      if (leaveTimeout !== null) window.clearTimeout(leaveTimeout);
      svg.on('.zoom', null);
    };
  }, [topology, pathMode, isPlaying, isDark, nodeSizeMode, selectedNodeId, onSelectNode]);

  const handleZoomIn = () => {
    if (!svgRef.current || !zoomBehaviorRef.current) return;
    d3.select(svgRef.current).transition().duration(180).call(zoomBehaviorRef.current.scaleBy, 1.25);
  };

  const handleZoomOut = () => {
    if (!svgRef.current || !zoomBehaviorRef.current) return;
    d3.select(svgRef.current).transition().duration(180).call(zoomBehaviorRef.current.scaleBy, 0.8);
  };

  const handleZoomReset = () => {
    if (!svgRef.current || !zoomBehaviorRef.current) return;
    d3.select(svgRef.current)
      .transition()
      .duration(200)
      .call(zoomBehaviorRef.current.transform, d3.zoomIdentity);
  };

  return (
    <div
      className="w-full overflow-hidden rounded-md border border-slate-200 dark:border-[#393939] bg-[#F8FAFC] dark:bg-[#121212]"
      data-testid="d3-grid-canvas"
    >
      <div className={`relative w-full ${heightClass}`}>
        <svg
          ref={svgRef}
          viewBox="0 0 1000 560"
          preserveAspectRatio="xMidYMid meet"
          className="h-full w-full cursor-crosshair select-none"
          role="img"
          aria-label={`Interactive D3 power grid topology for ${topology.name}`}
        />

        {/* Top-right Zoom Controls */}
        <div className="absolute top-3 right-3 flex items-center gap-1 rounded-md border border-slate-200 dark:border-[#525252] bg-white/95 dark:bg-[#262626]/95 p-1 shadow-xs">
          <button
            type="button"
            onClick={handleZoomIn}
            aria-label="Zoom in grid"
            className="rounded p-1.5 text-slate-600 dark:text-[#C6C6C6] hover:bg-slate-100 dark:hover:bg-[#353535] hover:text-slate-900 dark:hover:text-[#F4F4F4]"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={handleZoomOut}
            aria-label="Zoom out grid"
            className="rounded p-1.5 text-slate-600 dark:text-[#C6C6C6] hover:bg-slate-100 dark:hover:bg-[#353535] hover:text-slate-900 dark:hover:text-[#F4F4F4]"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={handleZoomReset}
            aria-label="Reset grid zoom"
            className="rounded p-1.5 text-slate-600 dark:text-[#C6C6C6] hover:bg-slate-100 dark:hover:bg-[#353535] hover:text-slate-900 dark:hover:text-[#F4F4F4]"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Node Hover Tooltip — smartly flips below top-row nodes & clamps edges so metrics never clip */}
        {hoveredNode && (() => {
          const openBelow = hoveredNode.yPct < 48;
          const horizTransform =
            hoveredNode.xPct < 24
              ? 'translateX(-8%)'
              : hoveredNode.xPct > 76
              ? 'translateX(-92%)'
              : 'translateX(-50%)';
          const vertTransform = openBelow ? 'translateY(18px)' : 'translateY(calc(-100% - 18px))';
          const utilPct = Math.round(
            (hoveredNode.node.loadMW / Math.max(1, hoveredNode.node.capacityMW)) * 100
          );
          return (
            <div
              data-testid="node-hover-tooltip"
              className="pointer-events-none absolute z-30 w-64 rounded-md border border-slate-300 dark:border-[#525252] bg-white dark:bg-[#262626] p-3 shadow-lg"
              style={{
                left: `${hoveredNode.xPct}%`,
                top: `${hoveredNode.yPct}%`,
                transform: `${horizTransform} ${vertTransform}`,
              }}
            >
              <div className="flex items-start justify-between gap-2 border-b border-slate-100 dark:border-[#393939] pb-2">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-900 dark:text-[#F4F4F4] truncate">
                    {hoveredNode.node.name}
                  </div>
                  <div className="text-[11px] font-mono text-slate-500 dark:text-[#A8A8A8]">
                    {hoveredNode.node.id} · q[{hoveredNode.node.qubitIndex}] · {hoveredNode.node.region}
                  </div>
                </div>
                <StatusIndicator status={hoveredNode.node.status} compact badgeStyle />
              </div>
              <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] font-mono tabular-nums">
                <div>
                  <span className="text-slate-500 dark:text-[#A8A8A8] block font-sans">Load / Cap</span>
                  <span className="font-semibold text-slate-900 dark:text-[#F4F4F4]">
                    {hoveredNode.node.loadMW} / {hoveredNode.node.capacityMW} MW ({utilPct}%)
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 dark:text-[#A8A8A8] block font-sans">Voltage / Angle</span>
                  <span className="font-semibold text-slate-900 dark:text-[#F4F4F4]">
                    {hoveredNode.node.voltagePU} p.u. · {hoveredNode.node.phaseAngleDeg}°
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 dark:text-[#A8A8A8] block font-sans">Thermal</span>
                  <span className="font-semibold text-slate-900 dark:text-[#F4F4F4]">
                    {hoveredNode.node.temperatureC}°C
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 dark:text-[#A8A8A8] block font-sans">QAOA / Classical</span>
                  <span className="font-semibold text-[#0F62FE] dark:text-[#78A9FF]">
                    {hoveredNode.node.quantumDispatchMW} / {hoveredNode.node.classicalDispatchMW} MW
                  </span>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Edge Hover Tooltip — smart vertical/horizontal placement */}
        {hoveredEdge && !hoveredNode && (() => {
          const openBelow = hoveredEdge.yPct < 45;
          const horizTransform =
            hoveredEdge.xPct < 24
              ? 'translateX(-8%)'
              : hoveredEdge.xPct > 76
              ? 'translateX(-92%)'
              : 'translateX(-50%)';
          const vertTransform = openBelow ? 'translateY(14px)' : 'translateY(calc(-100% - 14px))';
          return (
            <div
              className="pointer-events-none absolute z-30 w-56 rounded-md border border-slate-300 dark:border-[#525252] bg-white dark:bg-[#262626] p-2.5 shadow-lg"
              style={{
                left: `${hoveredEdge.xPct}%`,
                top: `${hoveredEdge.yPct}%`,
                transform: `${horizTransform} ${vertTransform}`,
              }}
            >
              <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-slate-100 dark:border-[#393939]">
                <span className="text-xs font-mono font-semibold text-slate-900 dark:text-[#F4F4F4]">
                  Line {hoveredEdge.edge.id} ({hoveredEdge.edge.source}→{hoveredEdge.edge.target})
                </span>
                <StatusIndicator status={hoveredEdge.edge.status} compact />
              </div>
              <div className="mt-1.5 space-y-1 text-[11px] font-mono tabular-nums text-slate-700 dark:text-[#C6C6C6]">
                <div className="flex justify-between">
                  <span className="font-sans text-slate-500 dark:text-[#A8A8A8]">Flow / Limit</span>
                  <span>
                    {hoveredEdge.edge.flowMW} / {hoveredEdge.edge.limitMW} MW
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="font-sans text-slate-500 dark:text-[#A8A8A8]">Line Loss</span>
                  <span>{hoveredEdge.edge.lossMW} MW</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-sans text-slate-500 dark:text-[#A8A8A8]">Routing</span>
                  <span className="text-[#0F62FE] dark:text-[#78A9FF]">
                    {hoveredEdge.edge.isQuantumPath && hoveredEdge.edge.isClassicalPath
                      ? 'Shared'
                      : hoveredEdge.edge.isQuantumPath
                      ? 'Qiskit Optimal'
                      : 'Classical Only'}
                  </span>
                </div>
              </div>
            </div>
          );
        })()}
      </div>

      {/* Dedicated Non-Overlapping Legend Strip */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-slate-200 dark:border-[#393939] bg-white dark:bg-[#1E1E1E] px-3.5 py-2 text-[11px] text-slate-600 dark:text-[#A8A8A8]">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="inline-flex items-center gap-1 font-medium text-[#15803D] dark:text-[#42BE65]">
            <span aria-hidden="true">●</span> Healthy (&lt;75%)
          </span>
          <span className="inline-flex items-center gap-1 font-medium text-[#B45309] dark:text-[#F1C21B]">
            <span aria-hidden="true">▲</span> Warning (75–89%)
          </span>
          <span className="inline-flex items-center gap-1 font-medium text-[#B91C1C] dark:text-[#FA4D56]">
            <span aria-hidden="true">■</span> Alarming (≥90%)
          </span>
        </div>
        <div className="flex items-center gap-x-4">
          <span className="inline-flex items-center gap-1.5 font-medium text-[#0F62FE] dark:text-[#78A9FF]">
            <span className="inline-block h-0.5 w-4 bg-[#0F62FE] dark:bg-[#78A9FF]" aria-hidden="true" />
            Qiskit Path
          </span>
          <span className="inline-flex items-center gap-1.5 font-medium text-slate-600 dark:text-[#A8A8A8]">
            <span className="inline-block h-0.5 w-4 border-t-2 border-dashed border-slate-500 dark:border-[#8D8D8D]" aria-hidden="true" />
            Classical Path
          </span>
        </div>
      </div>
    </div>
  );
}
