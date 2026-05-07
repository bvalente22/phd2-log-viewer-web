import { useId, useMemo, useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import Plot from 'react-plotly.js';
// @ts-expect-error -- no types for the dist bundle; we only call relayout.
import Plotly from 'plotly.js/dist/plotly';
import type { Data, Layout, Shape } from 'plotly.js';
import type { GARun } from '../parser/analyze';
import type { AnalysisKind } from '../state/analysisStore';
import { useChartGestures } from './useChartGestures';
import { useViewStore } from '../state/viewStore';
import { themeOf } from '../themes';

const PEAK_PX = 8;
// Per-kind colors so the residual / raw-RA traces stay identifiable
// even when the active/inactive state flips on a mode-tab click. Lime
// for residual error (the original FFT color), pink for raw RA — high
// contrast pair on every theme background.
const COLOR_RESIDUAL = '#a3e635';
const COLOR_RAW_RA = '#f472b6';
const COLOR_UNGUIDED = COLOR_RESIDUAL; // unguided has no comparison mode
const CURSOR_COLOR = 'rgba(250, 204, 21, 0.7)';
const INACTIVE_OPACITY = 0.28;

interface PlotDiv extends HTMLDivElement {
  _fullLayout?: {
    xaxis?: { _offset: number; _length: number; range: [number, number]; type?: string };
  };
}

interface PeriodogramChartProps {
  garun: GARun;
  /** Counterpart run (the inactive mode). Rendered at reduced opacity
   *  underneath the active trace so amplitudes can be compared at a
   *  glance. Null for 'unguided' or when no counterpart is provided. */
  garunOther: GARun | null;
  kind: AnalysisKind;
  scaleMode: 'PIXELS' | 'ARCSEC';
  /** When non-null, the periodogram Y-axis is fixed at [0, yMaxLockPx*k*1.05]
   *  in display units. The store records the lock value in raw pixel units
   *  so toggling between ARCSEC ↔ PIXELS doesn't shift the visible range. */
  yMaxLockPx: number | null;
}

/** Pick the per-kind color for a periodogram trace. */
const colorFor = (kind: AnalysisKind): string => {
  if (kind === 'all') return COLOR_RESIDUAL;
  if (kind === 'all-raw-ra') return COLOR_RAW_RA;
  return COLOR_UNGUIDED;
};

/** Opposite of an AnalysisKind for the dual-trace render. Returns null
 *  for kinds that don't have a counterpart. */
const otherKindOf = (kind: AnalysisKind): AnalysisKind | null => {
  if (kind === 'all') return 'all-raw-ra';
  if (kind === 'all-raw-ra') return 'all';
  return null;
};

/**
 * Periodogram (period vs. amplitude). Mirrors PaintFFT in
 * AnalysisWin.cpp:1076-1182 plus the OnMove peak-snap logic at lines
 * 853-918. The hover readout is the periodic-error report — period,
 * amplitude (″/px), peak-to-peak, RMS — that the desktop puts in its
 * status bar. A dashed vertical cursor line snaps to the same peak so
 * the user sees exactly which period they're reading.
 *
 * When `garunOther` is present, the chart shows TWO traces overlapping —
 * the active mode at full opacity, the counterpart faded — so the user
 * can compare residual-error vs raw-RA peaks at the same scale.
 * Hover snap-to-peak still operates on the active trace only.
 */
export function PeriodogramChart({ garun, garunOther, kind, scaleMode, yMaxLockPx }: PeriodogramChartProps) {
  const { t } = useTranslation('analysis');
  const { t: tChart } = useTranslation('chart');
  const plotId = useId().replace(/:/g, '_');
  const [hover, setHover] = useState<string | null>(null);
  const themeId = useViewStore((s) => s.theme);

  const k = scaleMode === 'ARCSEC' ? garun.pixelScale : 1;
  const unit = scaleMode === 'ARCSEC' ? '″' : 'px';

  const labelOf = useCallback((k0: AnalysisKind): string => {
    if (k0 === 'all') return t('mode.selected');
    if (k0 === 'all-raw-ra') return t('mode.rawRa');
    return t('mode.unguided');
  }, [t]);

  const traces = useMemo<Data[]>(() => {
    const out: Data[] = [];
    // Inactive (counterpart) drawn first so the active trace overlays it.
    const otherKind = otherKindOf(kind);
    if (garunOther && otherKind) {
      out.push({
        x: Array.from(garunOther.fftPeriod),
        y: Array.from(garunOther.fftAmplitude).map((v) => v * k),
        type: 'scatter', mode: 'lines',
        name: labelOf(otherKind),
        line: { color: colorFor(otherKind), width: 1.25 },
        opacity: INACTIVE_OPACITY,
        // No fill on the inactive trace — overlapping fills would obscure
        // both. The thin colored line at low opacity is enough to read.
        // hoveron 'fills' would also expand the hover region we don't want.
        hoverinfo: 'skip',
      } as Data);
    }
    out.push({
      x: Array.from(garun.fftPeriod),
      y: Array.from(garun.fftAmplitude).map((v) => v * k),
      type: 'scatter', mode: 'lines',
      name: labelOf(kind),
      line: { color: colorFor(kind), width: 1.5 },
      fill: 'tozeroy',
      fillcolor: kind === 'all-raw-ra'
        ? 'rgba(244, 114, 182, 0.10)'
        : 'rgba(163, 230, 53, 0.10)',
    } as Data);
    return out;
  }, [garun, garunOther, kind, k, labelOf]);

  // Plotly's xaxis.type:'log' wants the range in log10 space. Always provide
  // an explicit range to avoid the autorange-vs-first-scroll bug we saw in
  // the main GuideGraph (commit 414354a) — Plotly's `_fullLayout.xaxis._offset`
  // can be 0 immediately after autorange settles, which breaks scroll-zoom's
  // cursor anchoring on the very first wheel event.
  const xLogRange = useMemo<[number, number]>(() => {
    const periods = garun.fftPeriod;
    if (periods.length < 2) return [0, 1]; // 10^0 .. 10^1
    const min = Math.max(periods[0], 1e-6);
    const max = Math.max(periods[periods.length - 1], min * 10);
    return [Math.log10(min), Math.log10(max)];
  }, [garun]);

  useChartGestures(plotId, {}, { enableModifierSelect: false });

  /**
   * Find the closest local-max peak in the periodogram within ±PEAK_PX of the
   * cursor's screen position. Mirrors AnalysisWin.cpp:864-907.
   */
  const snapToPeak = useCallback((cursorPeriod: number): { period: number; amplitude: number } => {
    const div = document.getElementById(plotId) as PlotDiv | null;
    const xa = div?._fullLayout?.xaxis;
    if (!xa || !xa._length) {
      return { period: cursorPeriod, amplitude: garun.fftSpline.at(cursorPeriod) };
    }
    const periods = garun.fftPeriod;
    const amps = garun.fftAmplitude;
    const isLog = xa.type === 'log';
    const toPx = (p: number): number => {
      if (isLog) {
        const r0 = Math.pow(10, xa.range[0]);
        const r1 = Math.pow(10, xa.range[1]);
        return ((Math.log10(p) - Math.log10(r0)) / (Math.log10(r1) - Math.log10(r0))) * xa._length;
      }
      return ((p - xa.range[0]) / (xa.range[1] - xa.range[0])) * xa._length;
    };
    const cursorPx = toPx(cursorPeriod);
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 1; i < periods.length - 1; i++) {
      const px = toPx(periods[i]);
      if (Math.abs(px - cursorPx) > PEAK_PX) continue;
      if (amps[i] > amps[i - 1] && amps[i] > amps[i + 1]) {
        const d = Math.abs(px - cursorPx);
        if (d < bestDist) { bestDist = d; bestIdx = i; }
      }
    }
    if (bestIdx >= 0) return { period: periods[bestIdx], amplitude: amps[bestIdx] };
    return { period: cursorPeriod, amplitude: garun.fftSpline.at(cursorPeriod) };
  }, [plotId, garun]);

  // Cursor line drawn via Plotly.relayout (bypasses React render).
  const drawCursor = useCallback((period: number) => {
    const shape: Partial<Shape> = {
      type: 'line', xref: 'x', yref: 'paper',
      x0: period, x1: period, y0: 0, y1: 1,
      line: { color: CURSOR_COLOR, width: 1, dash: 'dash' },
    };
    void Plotly.relayout(plotId, { shapes: [shape] });
  }, [plotId]);

  const clearCursor = useCallback(() => {
    void Plotly.relayout(plotId, { shapes: [] });
  }, [plotId]);

  const onHover = useCallback((ev: { points?: Array<{ x?: number }> }) => {
    const x = ev.points?.[0]?.x;
    if (typeof x !== 'number') return;
    const { period, amplitude } = snapToPeak(x);
    const aPx = amplitude;
    const aArc = amplitude * garun.pixelScale;
    const ppArc = 2 * aArc;
    const ppPx = 2 * aPx;
    const rmsArc = aArc / Math.SQRT2;
    const rmsPx = aPx / Math.SQRT2;
    setHover(
      `Period: ${period.toFixed(1)}s  Amplitude: ${aArc.toFixed(2)}″ (${aPx.toFixed(2)}px)  ` +
      `P-P: ${ppArc.toFixed(2)}″ (${ppPx.toFixed(2)}px)  ` +
      `RMS: ${rmsArc.toFixed(2)}″ (${rmsPx.toFixed(2)}px)`,
    );
    drawCursor(period);
  }, [garun, snapToPeak, drawCursor]);

  // Quiet the unused-variable warning for `unit/k` when scaleMode is PIXELS.
  useEffect(() => { void unit; void k; }, [unit, k]);

  const tc = themeOf(themeId).plot;
  // Y-axis: lock-aware. When yMaxLockPx is set, fix the range to the
  // locked max scaled into display units (with 5% headroom so peaks
  // don't kiss the top edge). Otherwise let Plotly autorange.
  const yAxisCfg: Partial<Layout['yaxis']> = yMaxLockPx !== null
    ? {
        range: [0, yMaxLockPx * k * 1.05],
        autorange: false,
      }
    : { autorange: true };
  const layout: Partial<Layout> = {
    autosize: true,
    margin: { l: 60, r: 30, t: 10, b: 40 },
    paper_bgcolor: tc.paper,
    plot_bgcolor: tc.plot,
    font: { color: tc.font, size: 11 },
    xaxis: {
      title: { text: tChart('axes.period') }, gridcolor: tc.grid, zerolinecolor: tc.zeroline,
      type: 'log', range: xLogRange, fixedrange: false,
    },
    yaxis: {
      title: { text: unit === '″' ? tChart('axes.amplitudeArcsec') : tChart('axes.amplitudePixels') },
      gridcolor: tc.grid, zerolinecolor: tc.zeroline,
      ...yAxisCfg,
      fixedrange: true,
    },
    showlegend: !!garunOther, // legend is meaningful when comparing two traces
    legend: {
      orientation: 'h', x: 0, y: 1.02, yanchor: 'bottom', xanchor: 'left',
      font: { size: 10 }, bgcolor: 'rgba(0,0,0,0)',
    },
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
        />
      </div>
      <div className="border-t border-slate-800 bg-slate-900/40 px-3 py-1 font-mono text-[11px] text-slate-300 min-h-[24px] whitespace-pre-wrap">
        {hover ?? ' '}
      </div>
    </div>
  );
}
