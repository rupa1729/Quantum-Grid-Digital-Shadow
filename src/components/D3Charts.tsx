import { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import type { BitstringCount, ConstraintPerformanceRow, KernelQARecord } from '../types/grid';

interface AccuracyPoint {
  iteration: number;
  dateLabel: string;
  quantumAccuracy: number;
  classicalAccuracy: number;
  lossSavingsMWh: number;
}

export function D3AccuracyTrendChart({
  data,
  isDark = false,
}: {
  data: AccuracyPoint[];
  isDark?: boolean;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hovered, setHovered] = useState<AccuracyPoint | null>(null);

  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    if (data.length === 0) return;

    const width = 760;
    const height = 290;
    const margin = { top: 20, right: 24, bottom: 38, left: 48 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const gridColor = isDark ? '#393939' : '#E2E8F0';
    const domainColor = isDark ? '#525252' : '#CBD5E1';
    const axisTextColor = isDark ? '#A8A8A8' : '#64748B';
    const quantumColor = isDark ? '#4589FF' : '#0F62FE';
    const classicalColor = isDark ? '#8D8D8D' : '#64748B';
    const pointBg = isDark ? '#161616' : '#FFFFFF';

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const x = d3
      .scalePoint<string>()
      .domain(data.map((d) => d.dateLabel))
      .range([0, innerW])
      .padding(0.2);

    const minVal = Math.max(
      70,
      Math.floor((d3.min(data, (d) => Math.min(d.classicalAccuracy, d.quantumAccuracy)) ?? 80) - 3)
    );
    const y = d3.scaleLinear().domain([minVal, 100]).range([innerH, 0]);

    g.append('g')
      .selectAll('line')
      .data(y.ticks(5))
      .join('line')
      .attr('x1', 0)
      .attr('x2', innerW)
      .attr('y1', (d) => y(d))
      .attr('y2', (d) => y(d))
      .attr('stroke', gridColor)
      .attr('stroke-width', 1);

    g.append('g')
      .attr('transform', `translate(0,${innerH})`)
      .call(d3.axisBottom(x).tickSize(0).tickPadding(10))
      .call((axis) => axis.select('.domain').attr('stroke', domainColor))
      .selectAll('text')
      .attr('font-family', '"IBM Plex Mono", monospace')
      .attr('font-size', '10px')
      .attr('fill', axisTextColor);

    g.append('g')
      .call(
        d3
          .axisLeft(y)
          .ticks(5)
          .tickFormat((d) => `${d}%`)
          .tickSize(0)
          .tickPadding(8)
      )
      .call((axis) => axis.select('.domain').remove())
      .selectAll('text')
      .attr('font-family', '"IBM Plex Mono", monospace')
      .attr('font-size', '10px')
      .attr('fill', axisTextColor);

    const areaGen = d3
      .area<AccuracyPoint>()
      .x((d) => x(d.dateLabel) ?? 0)
      .y0((d) => y(d.classicalAccuracy))
      .y1((d) => y(d.quantumAccuracy))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(data)
      .attr('d', areaGen)
      .attr('fill', quantumColor)
      .attr('fill-opacity', isDark ? 0.18 : 0.1);

    const classicalLine = d3
      .line<AccuracyPoint>()
      .x((d) => x(d.dateLabel) ?? 0)
      .y((d) => y(d.classicalAccuracy))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(data)
      .attr('d', classicalLine)
      .attr('fill', 'none')
      .attr('stroke', classicalColor)
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', '5 4');

    const quantumLine = d3
      .line<AccuracyPoint>()
      .x((d) => x(d.dateLabel) ?? 0)
      .y((d) => y(d.quantumAccuracy))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(data)
      .attr('d', quantumLine)
      .attr('fill', 'none')
      .attr('stroke', quantumColor)
      .attr('stroke-width', 2.5);

    const cols = g
      .selectAll('g.iter-col')
      .data(data)
      .join('g')
      .attr('class', 'iter-col cursor-crosshair');

    cols
      .append('circle')
      .attr('cx', (d) => x(d.dateLabel) ?? 0)
      .attr('cy', (d) => y(d.classicalAccuracy))
      .attr('r', 3.5)
      .attr('fill', pointBg)
      .attr('stroke', classicalColor)
      .attr('stroke-width', 2);

    cols
      .append('circle')
      .attr('cx', (d) => x(d.dateLabel) ?? 0)
      .attr('cy', (d) => y(d.quantumAccuracy))
      .attr('r', 4)
      .attr('fill', quantumColor)
      .attr('stroke', pointBg)
      .attr('stroke-width', 1.5);

    const stepW = innerW / Math.max(1, data.length);
    cols
      .append('rect')
      .attr('x', (d) => (x(d.dateLabel) ?? 0) - stepW / 2)
      .attr('y', 0)
      .attr('width', stepW)
      .attr('height', innerH)
      .attr('fill', 'transparent')
      .on('mouseenter', (_, d) => setHovered(d))
      .on('mouseleave', () => setHovered(null));
  }, [data, isDark]);

  if (data.length === 0) {
    return (
      <div className="flex h-[260px] items-center justify-center rounded-md border border-dashed border-slate-300 dark:border-[#525252] bg-slate-50 dark:bg-[#1E1E1E] text-sm text-slate-500 dark:text-[#A8A8A8]">
        No benchmark iterations match the active constraint filters. Widen latency or scale bounds.
      </div>
    );
  }

  const latest = hovered ?? data[data.length - 1];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-4 text-slate-600 dark:text-[#C6C6C6]">
          <span className="inline-flex items-center gap-1.5 font-medium text-slate-800 dark:text-[#F4F4F4]">
            <span className="inline-block h-0.5 w-4 bg-[#0F62FE] dark:bg-[#4589FF]" aria-hidden="true" />
            Qiskit Quantum Optimization
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4 border-t-2 border-dashed border-slate-500 dark:border-[#8D8D8D]" aria-hidden="true" />
            Classical Baseline
          </span>
        </div>
        <div className="flex items-center gap-3 font-mono tabular-nums text-slate-700 dark:text-[#C6C6C6]">
          <span className="text-slate-500 dark:text-[#A8A8A8]">{latest.dateLabel}</span>
          <span className="text-[#0F62FE] dark:text-[#78A9FF] font-semibold">
            Q: {latest.quantumAccuracy.toFixed(2)}%
          </span>
          <span>C: {latest.classicalAccuracy.toFixed(2)}%</span>
          <span className="text-[#15803D] dark:text-[#42BE65] font-semibold">
            +{(latest.quantumAccuracy - latest.classicalAccuracy).toFixed(2)}% gain
          </span>
        </div>
      </div>
      <svg
        ref={svgRef}
        viewBox="0 0 760 290"
        className="w-full h-auto"
        role="img"
        aria-label="Quantum versus Classical accuracy improvement over iterations"
      />
    </div>
  );
}

export function D3HistogramChart({
  bitstrings,
  isDark = false,
}: {
  bitstrings: BitstringCount[];
  isDark?: boolean;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl || bitstrings.length === 0) return;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const width = 520;
    const height = 240;
    const margin = { top: 18, right: 16, bottom: 58, left: 42 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const gridColor = isDark ? '#393939' : '#E2E8F0';
    const domainColor = isDark ? '#525252' : '#CBD5E1';
    const axisTextColor = isDark ? '#A8A8A8' : '#475569';
    const quantumColor = isDark ? '#4589FF' : '#0F62FE';
    const mutedBar = isDark ? '#525252' : '#94A3B8';

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const x = d3
      .scaleBand()
      .domain(bitstrings.map((b) => b.bitstring))
      .range([0, innerW])
      .padding(0.28);

    const maxProb = Math.min(1, (d3.max(bitstrings, (b) => b.probability) ?? 0.4) * 1.18);
    const y = d3.scaleLinear().domain([0, maxProb]).range([innerH, 0]);

    g.append('g')
      .selectAll('line')
      .data(y.ticks(4))
      .join('line')
      .attr('x1', 0)
      .attr('x2', innerW)
      .attr('y1', (d) => y(d))
      .attr('y2', (d) => y(d))
      .attr('stroke', gridColor);

    const needsTilt = (bitstrings[0]?.bitstring.length ?? 0) > 6;

    const xAxisText = g
      .append('g')
      .attr('transform', `translate(0,${innerH})`)
      .call(d3.axisBottom(x).tickSize(0).tickPadding(8))
      .call((a) => a.select('.domain').attr('stroke', domainColor))
      .selectAll('text')
      .attr('font-family', '"IBM Plex Mono", monospace')
      .attr('font-size', '9.5px')
      .attr('fill', axisTextColor);

    if (needsTilt) {
      xAxisText
        .attr('text-anchor', 'end')
        .attr('dx', '-0.35em')
        .attr('dy', '0.35em')
        .attr('transform', 'rotate(-28)');
    }

    g.append('g')
      .call(
        d3
          .axisLeft(y)
          .ticks(4)
          .tickFormat((d) => `${Math.round(Number(d) * 100)}%`)
          .tickSize(0)
          .tickPadding(6)
      )
      .call((a) => a.select('.domain').remove())
      .selectAll('text')
      .attr('font-family', '"IBM Plex Mono", monospace')
      .attr('font-size', '9.5px')
      .attr('fill', axisTextColor);

    g.selectAll('rect.hist-bar')
      .data(bitstrings)
      .join('rect')
      .attr('class', 'hist-bar')
      .attr('x', (d) => x(d.bitstring) ?? 0)
      .attr('y', (d) => y(d.probability))
      .attr('width', x.bandwidth())
      .attr('height', (d) => innerH - y(d.probability))
      .attr('rx', 2)
      .attr('fill', (d) => (d.isOptimal ? quantumColor : mutedBar));

    g.selectAll('text.bar-val')
      .data(bitstrings)
      .join('text')
      .attr('class', 'bar-val')
      .attr('x', (d) => (x(d.bitstring) ?? 0) + x.bandwidth() / 2)
      .attr('y', (d) => y(d.probability) - 5)
      .attr('text-anchor', 'middle')
      .attr('font-family', '"IBM Plex Mono", monospace')
      .attr('font-size', '9px')
      .attr('font-weight', (d) => (d.isOptimal ? '600' : '400'))
      .attr('fill', (d) => (d.isOptimal ? quantumColor : axisTextColor))
      .text((d) => `${(d.probability * 100).toFixed(1)}%`);
  }, [bitstrings, isDark]);

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 520 240"
      className="w-full h-auto"
      role="img"
      aria-label="Quantum circuit bitstring measurement probability histogram"
    />
  );
}

export function D3BenchmarkBarChart({
  records,
  isDark = false,
}: {
  records: KernelQARecord[];
  isDark?: boolean;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const topRecords = records.slice(0, 10);
  const dynamicHeight = Math.max(220, topRecords.length * 34 + 44);

  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl || topRecords.length === 0) return;

    const animateIn = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const width = 980;
    const height = dynamicHeight;
    const margin = { top: 12, right: 112, bottom: 28, left: 215 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const gridColor = isDark ? '#393939' : '#E2E8F0';
    const domainColor = isDark ? '#525252' : '#CBD5E1';
    const axisTextColor = isDark ? '#A8A8A8' : '#64748B';
    const labelColor = isDark ? '#E0E0E0' : '#334155';
    const valueColor = isDark ? '#F4F4F4' : '#0F172A';
    const subColor = isDark ? '#8D8D8D' : '#64748B';
    const quantumColor = isDark ? '#4589FF' : '#0F62FE';
    const classicalColor = isDark ? '#6F6F6F' : '#64748B';

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const y = d3
      .scaleBand()
      .domain(topRecords.map((r) => `${r.modelName} (${r.runId})`))
      .range([0, innerH])
      .padding(0.28);

    const x = d3.scaleLinear().domain([70, 100]).range([0, innerW]);

    g.append('g')
      .selectAll('line')
      .data(x.ticks(6))
      .join('line')
      .attr('x1', (d) => x(d))
      .attr('x2', (d) => x(d))
      .attr('y1', 0)
      .attr('y2', innerH)
      .attr('stroke', gridColor);

    g.append('g')
      .attr('transform', `translate(0,${innerH})`)
      .call(
        d3
          .axisBottom(x)
          .ticks(6)
          .tickFormat((d) => `${d}%`)
          .tickSize(0)
          .tickPadding(8)
      )
      .call((a) => a.select('.domain').attr('stroke', domainColor))
      .selectAll('text')
      .attr('font-family', '"IBM Plex Mono", monospace')
      .attr('font-size', '10.5px')
      .attr('fill', axisTextColor);

    g.append('g')
      .call(
        d3
          .axisLeft(y)
          .tickSize(0)
          .tickPadding(10)
          .tickFormat((d) => String(d).replace(/\s*\([^)]*\)$/, ''))
      )
      .call((a) => a.select('.domain').remove())
      .selectAll('text')
      .attr('font-family', '"IBM Plex Sans", sans-serif')
      .attr('font-size', '11.5px')
      .attr('font-weight', '500')
      .attr('fill', labelColor);

    const bars = g
      .selectAll<SVGRectElement, KernelQARecord>('rect.bench-bar')
      .data(topRecords)
      .join('rect')
      .attr('class', 'bench-bar')
      .attr('x', 0)
      .attr('y', (d) => y(`${d.modelName} (${d.runId})`) ?? 0)
      .attr('width', animateIn ? 4 : (d) => Math.max(4, x(d.accuracyPct)))
      .attr('height', y.bandwidth())
      .attr('rx', 3)
      .attr('fill', (d) => (d.solverType === 'quantum' ? quantumColor : classicalColor));

    if (animateIn) {
      bars
        .transition()
        .delay((_, i) => i * 70)
        .duration(800)
        .ease(d3.easeCubicOut)
        .attr('width', (d) => Math.max(4, x(d.accuracyPct)));
    }

    const vals = g
      .selectAll<SVGTextElement, KernelQARecord>('text.bench-val')
      .data(topRecords)
      .join('text')
      .attr('x', (d) => x(d.accuracyPct) + 8)
      .attr('y', (d) => (y(`${d.modelName} (${d.runId})`) ?? 0) + y.bandwidth() / 2 + 4)
      .attr('font-family', '"IBM Plex Mono", monospace')
      .attr('font-size', '11px')
      .attr('font-weight', '600')
      .attr('fill', valueColor)
      .text((d) => `${(animateIn ? 0 : d.accuracyPct).toFixed(1)}%`);

    if (animateIn) {
      vals
        .transition()
        .delay((_, i) => i * 70)
        .duration(800)
        .ease(d3.easeCubicOut)
        .textTween((d) => {
          const interp = d3.interpolateNumber(0, d.accuracyPct);
          return (t) => `${interp(t).toFixed(1)}%`;
        });
    }

    g.selectAll('text.bench-ms')
      .data(topRecords)
      .join('text')
      .attr('x', (d) => x(d.accuracyPct) + 52)
      .attr('y', (d) => (y(`${d.modelName} (${d.runId})`) ?? 0) + y.bandwidth() / 2 + 4)
      .attr('font-family', '"IBM Plex Mono", monospace')
      .attr('font-size', '10px')
      .attr('fill', subColor)
      .text((d) => `· ${d.runtimeMs}ms`);
  }, [records, isDark, dynamicHeight]);

  if (topRecords.length === 0) {
    return (
      <div className="flex h-[180px] items-center justify-center rounded-md border border-dashed border-slate-300 dark:border-[#525252] bg-slate-50 dark:bg-[#1E1E1E] text-xs text-slate-500 dark:text-[#A8A8A8]">
        No benchmark models match the active filters.
      </div>
    );
  }

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 980 ${dynamicHeight}`}
      className="w-full h-auto"
      role="img"
      aria-label="Quantum and classical model accuracy benchmark comparison"
    />
  );
}

export function D3ConstraintComparisonChart({
  rows,
  isDark = false,
}: {
  rows: ConstraintPerformanceRow[];
  isDark?: boolean;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();
    if (rows.length === 0) return;

    const width = 560;
    const height = Math.max(190, rows.length * 48 + 44);
    const margin = { top: 14, right: 44, bottom: 28, left: 168 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const gridColor = isDark ? '#393939' : '#E2E8F0';
    const domainColor = isDark ? '#525252' : '#CBD5E1';
    const axisTextColor = isDark ? '#A8A8A8' : '#64748B';
    const labelColor = isDark ? '#E0E0E0' : '#334155';
    const quantumColor = isDark ? '#4589FF' : '#0F62FE';
    const classicalBar = isDark ? '#6F6F6F' : '#94A3B8';

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const y0 = d3
      .scaleBand()
      .domain(rows.map((r) => r.label))
      .range([0, innerH])
      .padding(0.28);

    const x = d3.scaleLinear().domain([70, 100]).range([0, innerW]);

    g.append('g')
      .selectAll('line')
      .data(x.ticks(4))
      .join('line')
      .attr('x1', (d) => x(d))
      .attr('x2', (d) => x(d))
      .attr('y1', 0)
      .attr('y2', innerH)
      .attr('stroke', gridColor);

    g.append('g')
      .attr('transform', `translate(0,${innerH})`)
      .call(
        d3
          .axisBottom(x)
          .ticks(4)
          .tickFormat((d) => `${d}%`)
          .tickSize(0)
          .tickPadding(6)
      )
      .call((a) => a.select('.domain').attr('stroke', domainColor))
      .selectAll('text')
      .attr('font-family', '"IBM Plex Mono", monospace')
      .attr('font-size', '9.5px')
      .attr('fill', axisTextColor);

    g.append('g')
      .call(d3.axisLeft(y0).tickSize(0).tickPadding(8))
      .call((a) => a.select('.domain').remove())
      .selectAll('text')
      .attr('font-family', '"IBM Plex Sans", sans-serif')
      .attr('font-size', '10.5px')
      .attr('fill', labelColor);

    const barH = Math.min(14, Math.max(9, (y0.bandwidth() - 4) / 2));
    const rowGroups = g
      .selectAll('g.c-row')
      .data(rows)
      .join('g')
      .attr('transform', (d) => {
        const topOffset = (y0.bandwidth() - (barH * 2 + 4)) / 2;
        return `translate(0,${(y0(d.label) ?? 0) + topOffset})`;
      });

    rowGroups
      .append('rect')
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', (d) => Math.max(4, x(d.quantumFeasibilityPct)))
      .attr('height', barH)
      .attr('rx', 2)
      .attr('fill', quantumColor);

    rowGroups
      .append('text')
      .attr('x', (d) => x(d.quantumFeasibilityPct) + 5)
      .attr('y', barH - 2)
      .attr('font-family', '"IBM Plex Mono", monospace')
      .attr('font-size', '9.5px')
      .attr('font-weight', '600')
      .attr('fill', quantumColor)
      .text((d) => `${d.quantumFeasibilityPct.toFixed(1)}%`);

    rowGroups
      .append('rect')
      .attr('x', 0)
      .attr('y', barH + 4)
      .attr('width', (d) => Math.max(4, x(d.classicalFeasibilityPct)))
      .attr('height', barH)
      .attr('rx', 2)
      .attr('fill', classicalBar);

    rowGroups
      .append('text')
      .attr('x', (d) => x(d.classicalFeasibilityPct) + 5)
      .attr('y', barH * 2 + 2)
      .attr('font-family', '"IBM Plex Mono", monospace')
      .attr('font-size', '9.5px')
      .attr('fill', axisTextColor)
      .text((d) => `${d.classicalFeasibilityPct.toFixed(1)}%`);
  }, [rows, isDark]);

  if (rows.length === 0) {
    return (
      <div className="flex h-[210px] items-center justify-center rounded-md border border-dashed border-slate-300 dark:border-[#525252] bg-slate-50 dark:bg-[#1E1E1E] text-sm text-slate-500 dark:text-[#A8A8A8]">
        No constraints match your current filters.
      </div>
    );
  }

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 560 ${Math.max(190, rows.length * 48 + 44)}`}
      className="w-full h-auto"
      role="img"
      aria-label="Constraint satisfaction feasibility rate comparing Quantum and Classical solvers"
    />
  );
}
