import { useId, useMemo, useState, useCallback } from 'react';
import Plot from 'react-plotly.js';
import type { Data, Layout } from 'plotly.js';
import type { GARun } from '../parser/analyze';
import { useChartGestures } from './useChartGestures';

const RA_COLOR = '#60a5fa';
const DEC_COLOR = '#f87171';

interface PlotlyHoverEvent {
  points?: Array<{ x?: number; y?: number; curveNumber?: number }>;
}

interface DriftChartProps {
  garun: GARun;
  showRa: boolean;
  showDec: boolean;
  scaleMode: 'PIXELS' | 'ARCSEC';
}

const formatClock = (startsMs: number | null, dt: number): string => {
  if (startsMs === null) return '—';
  const t = new Date(startsMs + dt * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:${pad(t.getUTCSeconds())}`;
};

/**
 * Drift-corrected RA/Dec timeline. Mirrors PaintDrift in
 * AnalysisWin.cpp:936-1063: zero-centered Y axis, RA in sky-blue, Dec in
 * rose with the same display-time negation (positive Dec points up).
 */
export function DriftChart({ garun, showRa, showDec, scaleMode }: DriftChartProps) {
  const plotId = useId().replace(/:/g, '_');
  const [hover, setHover] = useState<string | null>(null);

  const k = scaleMode === 'ARCSEC' ? garun.pixelScale : 1;
  const unit = scaleMode === 'ARCSEC' ? '″' : 'px';

  const traces = useMemo<Data[]>(() => {
    const out: Data[] = [];
    const x = Array.from(garun.t);
    if (showRa) {
      out.push({
        x, y: Array.from(garun.rac).map((v) => v * k),
        type: 'scattergl', mode: 'lines',
        name: 'RA', line: { color: RA_COLOR, width: 1.5 },
      } as Data);
    }
    if (showDec) {
      out.push({
        x,
        // Display-time negation matches AnalysisWin.cpp:1059 (`ymid - decc[i]`).
        y: Array.from(garun.decc).map((v) => -v * k),
        type: 'scattergl', mode: 'lines',
        name: 'Dec', line: { color: DEC_COLOR, width: 1.5 },
      } as Data);
    }
    return out;
  }, [garun, showRa, showDec, k]);

  const yRange = useMemo<[number, number]>(() => {
    let max = 1e-9;
    for (const v of garun.rac) max = Math.max(max, Math.abs(v * k));
    for (const v of garun.decc) max = Math.max(max, Math.abs(v * k));
    return [-max * 1.1, max * 1.1];
  }, [garun, k]);

  useChartGestures(plotId, {}, { enableModifierSelect: false });

  const onHover = useCallback((ev: PlotlyHoverEvent) => {
    const x = ev.points?.[0]?.x;
    const y = ev.points?.[0]?.y;
    if (typeof x !== 'number' || typeof y !== 'number') return;
    const yPx = scaleMode === 'ARCSEC' ? y / garun.pixelScale : y;
    const yArc = scaleMode === 'ARCSEC' ? y : y * garun.pixelScale;
    setHover(`Time: ${x.toFixed(1)}s  ${formatClock(garun.starts, x)}    Y: ${yArc.toFixed(2)}″ (${yPx.toFixed(2)}px)`);
  }, [garun, scaleMode]);

  const layout: Partial<Layout> = {
    autosize: true,
    margin: { l: 60, r: 30, t: 10, b: 30 },
    paper_bgcolor: '#0f172a',
    plot_bgcolor: '#0f172a',
    font: { color: '#cbd5e1', size: 11 },
    xaxis: { title: { text: 'time (s)' }, gridcolor: '#1e293b', zerolinecolor: '#334155', fixedrange: false, autorange: true },
    yaxis: { title: { text: unit }, gridcolor: '#1e293b', zerolinecolor: '#64748b', zerolinewidth: 1, fixedrange: true, range: yRange },
    showlegend: true,
    legend: { orientation: 'h', y: 1.1 },
    dragmode: false,
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1">
        <Plot
          divId={plotId}
          data={traces}
          layout={layout}
          config={{ displayModeBar: false, responsive: true, scrollZoom: true, doubleClick: false }}
          style={{ width: '100%', height: '100%' }}
          useResizeHandler
          onHover={onHover as never}
          onUnhover={() => setHover(null)}
        />
      </div>
      <div className="border-t border-slate-800 bg-slate-900/40 px-3 py-1 font-mono text-[11px] text-slate-300 min-h-[24px]">
        {hover ?? ' '}
      </div>
    </div>
  );
}
