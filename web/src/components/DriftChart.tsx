import { useId, useMemo, useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import Plot from 'react-plotly.js';
// @ts-expect-error -- no types for the dist bundle; we only call relayout.
import Plotly from 'plotly.js/dist/plotly';
import type { Data, Layout, Shape } from 'plotly.js';
import type { GARun } from '../parser/analyze';
import { useChartGestures } from './useChartGestures';
import { useAnalysisStore } from '../state/analysisStore';
import { useViewStore } from '../state/viewStore';
import { themeOf } from '../themes';

const RA_COLOR = '#60a5fa';
const DEC_COLOR = '#f87171';
const CURSOR_COLOR = 'rgba(250, 204, 21, 0.7)';

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
 *
 * On hover, a dashed vertical cursor line follows the mouse so the user
 * can read off the time/Y readout in the strip below without losing
 * track of where they're pointing.
 */
export function DriftChart({ garun, showRa, showDec, scaleMode }: DriftChartProps) {
  const { t: tChart } = useTranslation('chart');
  const plotId = useId().replace(/:/g, '_');
  const [hover, setHover] = useState<string | null>(null);
  const themeId = useViewStore((s) => s.theme);
  // X range tracking persists drag-pans across hover-induced re-renders.
  // Without this, every plotly_hover triggers setHover → React re-render
  // → Plotly.react sees `xaxis.range = xExtent` (the data-derived
  // default below) → snaps the user's pan back. Plotly's plotly_relayout
  // is the canonical source of truth — we mirror it into the store.
  const driftXRangeView = useAnalysisStore((s) =>
    s.state === 'open' ? s.driftXRangeView : null,
  );
  const setDriftXRange = useAnalysisStore((s) => s.setDriftXRange);

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

  // Always provide an explicit X range to Plotly. With autorange:true a brief
  // window after the layout pass exposes a stale `_offset = 0`, which causes
  // the first scroll-zoom to anchor at x=0 (the same first-scroll bug we
  // fixed in the main GuideGraph; see commit 414354a).
  const xExtent = useMemo<[number, number]>(() => {
    const t = garun.t;
    if (t.length < 2) return [0, 1];
    return [t[0], t[t.length - 1]];
  }, [garun]);

  useChartGestures(plotId, {}, { enableModifierSelect: false });

  // Hovered X cursor: drawn as a dashed vertical Plotly shape. We push it via
  // Plotly.relayout (not React state) so continuous hover doesn't trigger a
  // full chart re-render.
  useEffect(() => {
    const onUnhoverPage = () => {
      void Plotly.relayout(plotId, { shapes: [] });
    };
    window.addEventListener('mouseleave', onUnhoverPage);
    return () => window.removeEventListener('mouseleave', onUnhoverPage);
  }, [plotId]);

  const drawCursor = useCallback((x: number) => {
    const shape: Partial<Shape> = {
      type: 'line', xref: 'x', yref: 'paper',
      x0: x, x1: x, y0: 0, y1: 1,
      line: { color: CURSOR_COLOR, width: 1, dash: 'dash' },
    };
    void Plotly.relayout(plotId, { shapes: [shape] });
  }, [plotId]);

  const clearCursor = useCallback(() => {
    void Plotly.relayout(plotId, { shapes: [] });
  }, [plotId]);

  // Capture every Plotly relayout that touches xaxis. Plotly emits the
  // range in two formats depending on origin:
  //   - decomposed: 'xaxis.range[0]' / '[1]' (interactive zoom)
  //   - composed:   'xaxis.range' as [low, high] (programmatic relayout,
  //     which is what useChartGestures uses)
  // Handle both so drag-pan lands in the store.
  const onRelayout = useCallback((ev: Readonly<Record<string, unknown>>) => {
    let lo: number | undefined;
    let hi: number | undefined;
    const x0 = ev['xaxis.range[0]'];
    const x1 = ev['xaxis.range[1]'];
    const xrange = ev['xaxis.range'];
    if (typeof x0 === 'number' && typeof x1 === 'number') {
      lo = x0; hi = x1;
    } else if (Array.isArray(xrange) && xrange.length >= 2) {
      const a = xrange[0]; const b = xrange[1];
      if (typeof a === 'number' && typeof b === 'number') { lo = a; hi = b; }
    }
    if (lo !== undefined && hi !== undefined && Number.isFinite(lo) && Number.isFinite(hi)) {
      setDriftXRange([lo, hi]);
    } else if (ev['xaxis.autorange'] === true) {
      setDriftXRange(null);
    }
  }, [setDriftXRange]);

  const onHover = useCallback((ev: PlotlyHoverEvent) => {
    const x = ev.points?.[0]?.x;
    const y = ev.points?.[0]?.y;
    if (typeof x !== 'number' || typeof y !== 'number') return;
    const yPx = scaleMode === 'ARCSEC' ? y / garun.pixelScale : y;
    const yArc = scaleMode === 'ARCSEC' ? y : y * garun.pixelScale;
    setHover(`Time: ${x.toFixed(1)}s  ${formatClock(garun.starts, x)}    Y: ${yArc.toFixed(2)}″ (${yPx.toFixed(2)}px)`);
    drawCursor(x);
  }, [garun, scaleMode, drawCursor]);

  const tc = themeOf(themeId).plot;
  const layout: Partial<Layout> = {
    autosize: true,
    margin: { l: 60, r: 30, t: 10, b: 30 },
    paper_bgcolor: tc.paper,
    plot_bgcolor: tc.plot,
    font: { color: tc.font, size: 11 },
    xaxis: {
      title: { text: tChart('axes.time') }, gridcolor: tc.grid, zerolinecolor: tc.zeroline,
      fixedrange: false,
      // Tracked range wins over the data-derived default. Persists pan
      // across hover-induced re-renders and across mode swaps.
      range: driftXRangeView ?? xExtent,
    },
    yaxis: { title: { text: unit }, gridcolor: tc.grid, zerolinecolor: tc.zerolineStrong, zerolinewidth: 1, fixedrange: true, range: yRange },
    showlegend: true,
    legend: { orientation: 'h', y: 1.1 },
    dragmode: false,
    hovermode: 'x',
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
          onUnhover={() => { setHover(null); clearCursor(); }}
          onRelayout={onRelayout as never}
        />
      </div>
      <div className="border-t border-slate-800 bg-slate-900/40 px-3 py-1 font-mono text-[11px] text-slate-300 min-h-[24px]">
        {hover ?? ' '}
      </div>
    </div>
  );
}
