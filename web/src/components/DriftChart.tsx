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
import { themeOf, raDecColors } from '../themes';

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
  const swapRaDec = useViewStore((s) => s.swapRaDec);
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

  // Clock-time X axis (ms-since-epoch on a Plotly `type:'date'` axis) when the
  // run has a parseable wall-clock start — mirrors the main GuideGraph so the
  // analysis drift chart and the guide chart read the same times. Falls back to
  // elapsed seconds for unguided / unparseable logs.
  const startsMs = garun.starts;
  const useClockTime = startsMs !== null && Number.isFinite(startsMs);
  const toX = useCallback(
    (dt: number) => (useClockTime ? (startsMs as number) + dt * 1000 : dt),
    [useClockTime, startsMs],
  );

  const traces = useMemo<Data[]>(() => {
    const { ra: RA_COLOR, dec: DEC_COLOR } = raDecColors(swapRaDec);
    const out: Data[] = [];
    const x = Array.from(garun.t).map(toX);
    // Display convention: positive RA (east drift) plots BELOW the
    // centerline, positive Dec (north drift) plots ABOVE — the
    // astronomical "north up, east down" orientation. The desktop's
    // PaintDrift gets this from wxDC's Y-down coordinate system:
    //   y_screen = ymid + rac*scy   → positive rac → LARGER y → DOWN
    //   y_screen = ymid - decc*scy  → positive decc → SMALLER y → UP
    //   (AnalysisWin.cpp:1050,1059)
    // Plotly's Y axis goes UP, so to reproduce that visual we negate
    // RA and leave Dec alone (mirror image of the desktop's sign
    // pattern). A prior version of this code did the OPPOSITE — kept RA
    // as-is and negated Dec — which inverted both traces vs the
    // desktop reference; user-visible as the analysis drift chart
    // looking upside-down compared to the original.
    if (showRa) {
      out.push({
        x, y: Array.from(garun.rac).map((v) => -v * k),
        type: 'scattergl', mode: 'lines',
        name: 'RA', line: { color: RA_COLOR, width: 1.5 },
        // Values live in the readout strip below (onHover); hide the floating
        // popup but keep the plotly_hover event + cursor spike. Mirrors
        // GuideGraph's hoverinfo:'none' pattern.
        hoverinfo: 'none',
      } as Data);
    }
    if (showDec) {
      out.push({
        x,
        y: Array.from(garun.decc).map((v) => v * k),
        type: 'scattergl', mode: 'lines',
        name: 'Dec', line: { color: DEC_COLOR, width: 1.5 },
        hoverinfo: 'none',
      } as Data);
    }
    return out;
  }, [garun, showRa, showDec, k, toX, swapRaDec]);

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
    if (t.length < 2) return [toX(0), toX(1)];
    return [toX(t[0]), toX(t[t.length - 1])];
  }, [garun, toX]);

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
    // On a `type:'date'` axis Plotly emits range values as ISO strings
    // ("2026-06-05 23:51:53"); coerce both number and string forms to ms.
    const toMs = (v: unknown): number | null => {
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      if (typeof v === 'string') { const t = Date.parse(v); return Number.isFinite(t) ? t : null; }
      return null;
    };
    const x0 = toMs(ev['xaxis.range[0]']);
    const x1 = toMs(ev['xaxis.range[1]']);
    const xrange = ev['xaxis.range'];
    if (x0 !== null && x1 !== null) {
      lo = x0; hi = x1;
    } else if (Array.isArray(xrange) && xrange.length >= 2) {
      const a = toMs(xrange[0]); const b = toMs(xrange[1]);
      if (a !== null && b !== null) { lo = a; hi = b; }
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
    setHover(`Time: ${x.toFixed(2)}s  ${formatClock(garun.starts, x)}    Y: ${yArc.toFixed(2)}″ (${yPx.toFixed(2)}px)`);
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
      type: useClockTime ? 'date' : 'linear',
      tickformat: useClockTime ? '%H:%M' : undefined,
      fixedrange: false,
      // Tracked range wins over the data-derived default. Persists pan
      // across hover-induced re-renders and across mode swaps.
      range: driftXRangeView ?? xExtent,
      // Always-on vertical-cursor spike on hover. See PeriodogramChart's
      // matching block for the rationale (theme-aware contrast color,
      // `spikemode:'across'` for full-height, `spikesnap:'cursor'` for
      // pixel-accurate following).
      showspikes: true,
      spikemode: 'across',
      spikethickness: 1.5,
      spikedash: 'solid',
      spikecolor: tc.hoverSpike,
      spikesnap: 'cursor',
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
