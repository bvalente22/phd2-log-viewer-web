import { useId, useMemo, useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import Plot from 'react-plotly.js';
// @ts-expect-error -- no types for the dist bundle; we only call relayout.
import Plotly from 'plotly.js/dist/plotly';
import type { Data, Layout } from 'plotly.js';
import type { GARun } from '../parser/analyze';
import { useAnalysisStore, type AnalysisKind } from '../state/analysisStore';
import { alignedEventIndices } from '../parser/spikeAnalysis';
import { useChartGestures } from './useChartGestures';
import { useViewStore } from '../state/viewStore';
import { themeOf } from '../themes';
import type { Spline } from '../parser/spline';

const DENSE_POINTS = 1500;

/**
 * Resample an FFT periodogram onto a dense log-spaced X grid using the
 * smoothing Akima spline. Mirrors AnalysisWin.cpp:1131-1143 where
 * `PaintFFT` evaluates `s_fftpos.Eval(x)` (which delegates to
 * `ga.ffts.Eval(p)`) once per chart pixel — the source of the desktop's
 * visibly smooth periodogram curve. We resample to a fixed N rather than
 * per-pixel because the chart is HTML-canvas-rasterized: 1500 points
 * across a typical 1000-3000 px chart gives sub-pixel spacing without
 * caring about the actual rendered width.
 */
function denseSpline(periods: Float64Array, spline: Spline): { x: number[]; y: number[] } {
  if (periods.length < 2) {
    const xs = Array.from(periods);
    return { x: xs, y: xs.map((p) => spline.at(p)) };
  }
  const pMin = Math.max(periods[0], 1e-6);
  const pMax = Math.max(periods[periods.length - 1], pMin * 10);
  const logMin = Math.log10(pMin);
  const logMax = Math.log10(pMax);
  const x = new Array<number>(DENSE_POINTS);
  const y = new Array<number>(DENSE_POINTS);
  for (let i = 0; i < DENSE_POINTS; i++) {
    const p = Math.pow(10, logMin + (i / (DENSE_POINTS - 1)) * (logMax - logMin));
    x[i] = p;
    y[i] = spline.at(p);
  }
  return { x, y };
}

/**
 * Decade-by-decade tick positions for a log axis showing periods in
 * seconds — mirrors `StartP` / `IncrP` at AnalysisWin.cpp:1065-1074:
 *   IncrP(p) = 10^floor(log10(p))
 *   StartP(p) = ceil(p/IncrP) * IncrP
 * which yields the label set 7, 8, 9, 10, 20, 30, ..., 90, 100, 200, ...
 * Plotly's default log-axis labels show only the mantissa ("2" between
 * "10" and "100" really means 20) — visually confusing for users
 * reading period-in-seconds. Explicit tickvals/ticktext makes every
 * label the actual period value.
 */
function buildLogTickLabels(periodMin: number, periodMax: number): {
  tickvals: number[];
  ticktext: string[];
} {
  const tickvals: number[] = [];
  const ticktext: string[] = [];
  const lo = Math.max(periodMin, 1e-6);
  const hi = Math.max(periodMax, lo * 10);
  const startDecade = Math.floor(Math.log10(lo));
  const endDecade = Math.ceil(Math.log10(hi));
  for (let d = startDecade; d <= endDecade; d++) {
    const base = Math.pow(10, d);
    for (let n = 1; n < 10; n++) {
      const v = n * base;
      tickvals.push(v);
      ticktext.push(formatPeriodLabel(v));
    }
  }
  return { tickvals, ticktext };
}

function formatPeriodLabel(p: number): string {
  if (p >= 100) return String(Math.round(p));
  if (p >= 10) return String(Math.round(p));
  if (p >= 1) return p.toFixed(0);
  if (p >= 0.1) return p.toFixed(1);
  return p.toFixed(2);
}

const PEAK_PX = 8;
// Per-kind colors so the residual / raw-RA traces stay identifiable
// even when the active/inactive state flips on a mode-tab click. Lime
// for residual error (the original FFT color), pink for raw RA — high
// contrast pair on every theme background.
const COLOR_RESIDUAL = '#a3e635';
const COLOR_RAW_RA = '#f472b6';
const COLOR_UNGUIDED = COLOR_RESIDUAL; // unguided has no comparison mode
// Spike mode uses amber to match the SpikeChart marker color and the
// analysis-modal banner accent — visual continuity across the modal.
const COLOR_SPIKE = '#f59e0b';
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
  /** When non-null, the periodogram Y-axis is fixed at [0, yMaxLockPx*k]
   *  in display units. The store records the lock value in raw pixel units
   *  so toggling between ARCSEC ↔ PIXELS doesn't shift the visible range. */
  yMaxLockPx: number | null;
  /** Current rendered Y-axis max (raw pixel units), driven by user
   *  gestures and persisted in the analysisStore so mode swaps don't
   *  reset the zoom. Null = fall back to Plotly autorange. */
  yMaxViewPx: number | null;
  /** Top-N peak periods to mark beneath the chart with numbered chips
   *  (rank 1 = highest amplitude). Order is preserved so the chips read
   *  1, 2, 3 corresponding to the cards rendered by the modal. The chips
   *  inherit the chart's x axis so log-scale zoom/pan keeps them aligned
   *  to their data positions without extra bookkeeping. */
  topPeaks: ReadonlyArray<{ period: number }>;
}

/** Pick the per-kind color for a periodogram trace. */
const colorFor = (kind: AnalysisKind): string => {
  if (kind === 'all') return COLOR_RESIDUAL;
  if (kind === 'all-raw-ra') return COLOR_RAW_RA;
  if (kind === 'spike') return COLOR_SPIKE;
  return COLOR_UNGUIDED;
};

/** Opposite of an AnalysisKind for the dual-trace render. Returns null
 *  for kinds that don't have a counterpart (unguided, spike). */
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
export function PeriodogramChart({ garun, garunOther, kind, scaleMode, yMaxLockPx, yMaxViewPx, topPeaks }: PeriodogramChartProps) {
  const { t } = useTranslation('analysis');
  const { t: tChart } = useTranslation('chart');
  const plotId = useId().replace(/:/g, '_');
  const [hover, setHover] = useState<string | null>(null);
  const themeId = useViewStore((s) => s.theme);
  const setYMaxView = useAnalysisStore((s) => s.setYMaxView);
  // Spike-mode hover broadcasting: in spike mode the periodogram lives
  // alongside a spike chart that wants to highlight the spike events
  // aligned with whatever period the user is hovering. We push the
  // hovered period into the analysis store and pull the spike-run
  // events back out so we can compute the alignment count for the
  // hover-readout text.
  const setSpikeHoverPeriod = useAnalysisStore((s) => s.setSpikeHoverPeriod);
  const spikeRun = useAnalysisStore((s) => (s.state === 'open' ? s.spikeRun : null));
  // Periodogram X is log-scale; we track the user's pan in log10 space
  // (Plotly's native unit for log axes) so re-applies match exactly.
  // Like the Y-view tracking and the drift X tracking, this prevents
  // hover-induced React re-renders from snapping the user's pan back
  // to the data-derived default.
  const periodXRangeViewLog = useAnalysisStore((s) =>
    s.state === 'open' ? s.periodXRangeViewLog : null,
  );
  const setPeriodXRangeLog = useAnalysisStore((s) => s.setPeriodXRangeLog);

  const k = scaleMode === 'ARCSEC' ? garun.pixelScale : 1;
  const unit = scaleMode === 'ARCSEC' ? '″' : 'px';

  const labelOf = useCallback((k0: AnalysisKind): string => {
    if (k0 === 'all') return t('mode.selected');
    if (k0 === 'all-raw-ra') return t('mode.rawRa');
    if (k0 === 'spike') return t('mode.spike');
    return t('mode.unguided');
  }, [t]);

  const traces = useMemo<Data[]>(() => {
    const out: Data[] = [];
    // Inactive (counterpart) drawn first so the active trace overlays it.
    const otherKind = otherKindOf(kind);
    if (garunOther && otherKind) {
      const dense = denseSpline(garunOther.fftPeriod, garunOther.fftSpline);
      out.push({
        x: dense.x,
        y: dense.y.map((v) => v * k),
        type: 'scatter', mode: 'lines',
        name: labelOf(otherKind),
        line: { color: colorFor(otherKind), width: 1.25 },
        opacity: INACTIVE_OPACITY,
        // No fill on the inactive trace — overlapping fills would obscure
        // both. The thin colored line at low opacity is enough to read.
        // hoveron 'fills' would also expand the hover region we don't want.
        // Hover for this trace is suppressed: the active trace's
        // hovertemplate (below) embeds the counterpart's value via
        // customdata, so a single popup is enough — a second popup from
        // this trace would just duplicate or stack visually.
        hoverinfo: 'skip',
      } as Data);
    }
    // Plot the Akima-spline-interpolated curve, not the raw FFT bins. The
    // original desktop renders one Y per chart pixel by evaluating
    // `ga.ffts.Eval(p)` at each pixel's period (AnalysisWin.cpp:1136-1143),
    // which is what gives its periodogram the visibly smoother shape vs.
    // a straight-line polyline through the discrete bin samples. Our spline
    // is the same Akima fit (analyze.ts builds `fftSpline` from the bins).
    // 1500 log-spaced points across the full period range gives sub-pixel
    // resolution at chart widths up to ~3000 px without measurable cost.
    const dense = denseSpline(garun.fftPeriod, garun.fftSpline);
    // Bundle the counterpart amplitude (in current display units) as
    // customdata so the active trace's near-cursor popup can show BOTH
    // Raw RA and Residual error in a single labeled block. Evaluating
    // the other spline on the active trace's x grid keeps the two arrays
    // index-aligned regardless of differences in the underlying
    // fftPeriod ranges.
    const u = scaleMode === 'ARCSEC' ? '″' : 'pix';
    const otherY = garunOther
      ? dense.x.map((px) => garunOther.fftSpline.at(px) * k)
      : null;
    // For the all / all-raw-ra pair, build a fixed-order template so the
    // popup always reads "Raw RA / Residual error" regardless of which
    // tab is active. Pick %{y} vs %{customdata} per slot depending on
    // which kind is currently the active trace.
    let activeHoverTemplate: string;
    if (otherY && (kind === 'all' || kind === 'all-raw-ra')) {
      const rawRaTok = kind === 'all-raw-ra' ? '%{y:.2f}' : '%{customdata:.2f}';
      const resTok = kind === 'all' ? '%{y:.2f}' : '%{customdata:.2f}';
      activeHoverTemplate =
        `Period: %{x:.2f}s<br>` +
        `${t('mode.rawRa')}: ${rawRaTok}${u}<br>` +
        `${t('mode.selected')}: ${resTok}${u}` +
        `<extra></extra>`;
    } else {
      // Single-trace modes (unguided, spike): just period + the trace's
      // own amplitude. Spike's specialized "magnitude / aligned events"
      // text still appears in the bottom strip via onHover below.
      activeHoverTemplate =
        `Period: %{x:.2f}s<br>` +
        `${labelOf(kind)}: %{y:.2f}${u}` +
        `<extra></extra>`;
    }
    out.push({
      x: dense.x,
      y: dense.y.map((v) => v * k),
      type: 'scatter', mode: 'lines',
      name: labelOf(kind),
      line: { color: colorFor(kind), width: 1.5 },
      fill: 'tozeroy',
      fillcolor: kind === 'all-raw-ra'
        ? 'rgba(244, 114, 182, 0.10)'
        : kind === 'spike'
        ? 'rgba(245, 158, 11, 0.10)'
        : 'rgba(163, 230, 53, 0.10)',
      customdata: otherY ?? undefined,
      hovertemplate: activeHoverTemplate,
    } as Data);
    return out;
  }, [garun, garunOther, kind, k, scaleMode, labelOf, t]);

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

  useChartGestures(plotId, {}, {
    enableModifierSelect: false,
    // Periodogram amplitude is always >= 0 — bottom-anchored zoom
    // keeps y0 at 0 and scales only the upper bound, which matches the
    // user's mental model ("zoom into the peaks, leave the baseline").
    yZoomAnchor: 'bottom',
    // When the lock is on, drag must not move the Y axis; X pan still
    // works. Without this gate, drag would issue a Plotly.relayout that
    // briefly fights the locked range until the next React re-render.
    disableYZoom: yMaxLockPx !== null,
  });

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

  // Vertical-cursor line is provided natively by Plotly's
  // `xaxis.showspikes` (configured below). It follows the cursor across
  // every chart pixel without paying the cost of a `Plotly.relayout({
  // shapes: [...] })` per hover event, so the prior `drawCursor` /
  // `clearCursor` helpers — which used to issue one relayout per
  // `plotly_hover` — are gone. The hover readout below still uses the
  // snap-to-peak period in its text, matching the desktop's behavior at
  // AnalysisWin.cpp:911-914.

  const onHover = useCallback((ev: { points?: Array<{ x?: number }> }) => {
    const x = ev.points?.[0]?.x;
    if (typeof x !== 'number') return;
    const { period, amplitude } = snapToPeak(x);
    const aPx = amplitude;
    const aArc = amplitude * garun.pixelScale;
    if (kind === 'spike' && spikeRun) {
      // Spike-mode readout: "Period · Spike magnitude · Aligned
      // events". P-P / RMS aren't meaningful for spike-magnitude
      // periodograms (the amplitude IS the typical event size, not
      // the half-amplitude of a sinusoid).
      const aligned = alignedEventIndices(spikeRun.events, period);
      let meanMag = 0;
      for (const i of aligned) meanMag += spikeRun.events[i].deviation;
      meanMag = aligned.length > 0 ? meanMag / aligned.length : 0;
      const meanArc = meanMag * spikeRun.pixelScale;
      setHover(
        `Period: ${period.toFixed(1)}s  ` +
        `Spike magnitude: ${meanArc.toFixed(2)}″ (${meanMag.toFixed(2)}px)  ` +
        `Aligned events: ${aligned.length}/${spikeRun.events.length}`,
      );
      setSpikeHoverPeriod(period);
    } else if (garunOther && (kind === 'all' || kind === 'all-raw-ra')) {
      // Residual ↔ Raw-RA pair: surface BOTH amplitudes at the snapped
      // period so the user can compare modes without flipping tabs. Raw
      // RA always listed first so the two values appear in the same
      // order regardless of which tab is active. Single-unit display
      // ("″" or "pix") tracks the scale toggle.
      const aOtherPx = garunOther.fftSpline.at(period);
      const rawRaPx = kind === 'all-raw-ra' ? aPx : aOtherPx;
      const residualPx = kind === 'all' ? aPx : aOtherPx;
      const rawRaDisp = scaleMode === 'ARCSEC' ? rawRaPx * garun.pixelScale : rawRaPx;
      const residualDisp = scaleMode === 'ARCSEC' ? residualPx * garun.pixelScale : residualPx;
      const u = scaleMode === 'ARCSEC' ? '″' : 'pix';
      setHover(
        `Period: ${period.toFixed(1)}s    ` +
        `${t('mode.rawRa')}: ${rawRaDisp.toFixed(2)}${u}    ` +
        `${t('mode.selected')}: ${residualDisp.toFixed(2)}${u}`,
      );
    } else {
      // Unguided / single-trace fallback. No counterpart to compare
      // against, so report amplitude + the desktop's derived P-P / RMS.
      const ppArc = 2 * aArc;
      const ppPx = 2 * aPx;
      const rmsArc = aArc / Math.SQRT2;
      const rmsPx = aPx / Math.SQRT2;
      setHover(
        `Period: ${period.toFixed(1)}s  Amplitude: ${aArc.toFixed(2)}″ (${aPx.toFixed(2)}px)  ` +
        `P-P: ${ppArc.toFixed(2)}″ (${ppPx.toFixed(2)}px)  ` +
        `RMS: ${rmsArc.toFixed(2)}″ (${rmsPx.toFixed(2)}px)`,
      );
    }
  }, [garun, garunOther, snapToPeak, kind, scaleMode, spikeRun, setSpikeHoverPeriod, t]);

  // Quiet the unused-variable warning for `unit/k` when scaleMode is PIXELS.
  useEffect(() => { void unit; void k; }, [unit, k]);

  // Capture every Plotly relayout that touches the axes. Plotly emits
  // ranges in two formats depending on the change source:
  //   - decomposed: 'yaxis.range[0]' / '[1]' (interactive zoom)
  //   - composed:   'yaxis.range' as [low, high] (programmatic
  //     Plotly.relayout — what useChartGestures uses)
  // Handle both for both axes. The /k normalization keeps Y stored in
  // canonical pixel units so it survives ARCSEC ↔ PIXELS toggles. X
  // is in log10 space, no scale factor.
  const onRelayout = useCallback((ev: Readonly<Record<string, unknown>>) => {
    // Y-axis (max only — periodogram is bottom-anchored at 0)
    let yMax: number | undefined;
    const yr1 = ev['yaxis.range[1]'];
    const yrange = ev['yaxis.range'];
    if (typeof yr1 === 'number') {
      yMax = yr1;
    } else if (Array.isArray(yrange) && yrange.length >= 2 && typeof yrange[1] === 'number') {
      yMax = yrange[1];
    }
    if (yMax !== undefined && Number.isFinite(yMax) && yMax > 0) {
      setYMaxView(yMax / k);
    } else if (ev['yaxis.autorange'] === true) {
      setYMaxView(null);
    }
    // X-axis (full range, log10 space)
    let xLo: number | undefined;
    let xHi: number | undefined;
    const x0 = ev['xaxis.range[0]'];
    const x1 = ev['xaxis.range[1]'];
    const xrange = ev['xaxis.range'];
    if (typeof x0 === 'number' && typeof x1 === 'number') {
      xLo = x0; xHi = x1;
    } else if (Array.isArray(xrange) && xrange.length >= 2) {
      const a = xrange[0]; const b = xrange[1];
      if (typeof a === 'number' && typeof b === 'number') { xLo = a; xHi = b; }
    }
    if (xLo !== undefined && xHi !== undefined && Number.isFinite(xLo) && Number.isFinite(xHi)) {
      setPeriodXRangeLog([xLo, xHi]);
    } else if (ev['xaxis.autorange'] === true) {
      setPeriodXRangeLog(null);
    }
  }, [k, setYMaxView, setPeriodXRangeLog]);

  // Decade-by-decade explicit tick labels — replace Plotly's default
  // log-axis minor-tick labels (which show only the mantissa "2" / "3"
  // between decades instead of the actual value "20" / "30"). Computed
  // once per garun since the period range only depends on the FFT
  // bounds — does NOT depend on zoom level, because each decade gets
  // every integer multiple labelled, and Plotly thins automatically when
  // labels would overlap.
  const periodTicks = useMemo(() => {
    if (garun.fftPeriod.length < 2) return { tickvals: [], ticktext: [] };
    return buildLogTickLabels(
      garun.fftPeriod[0],
      garun.fftPeriod[garun.fftPeriod.length - 1],
    );
  }, [garun]);

  // Pixel positions for the numbered "top 3 peaks" chips rendered as
  // HTML beneath the chart (see JSX below). Computed from Plotly's
  // internal xaxis layout (_offset/_length + l2p on the period) so the
  // chips track the log axis exactly through zoom, pan, and resize.
  // Recomputed on every relayout/resize event and after topPeaks change.
  const [markerXs, setMarkerXs] = useState<Array<{ x: number; rank: number }>>([]);
  const refreshMarkers = useCallback(() => {
    const div = document.getElementById(plotId) as PlotDiv | null;
    const xa = div?._fullLayout?.xaxis;
    if (!xa || !xa._length || !topPeaks) {
      setMarkerXs([]);
      return;
    }
    const isLog = xa.type === 'log';
    const next: Array<{ x: number; rank: number }> = [];
    for (let i = 0; i < topPeaks.length; i++) {
      const p = topPeaks[i].period;
      let px: number;
      if (isLog) {
        const r0 = Math.pow(10, xa.range[0]);
        const r1 = Math.pow(10, xa.range[1]);
        px = ((Math.log10(p) - Math.log10(r0)) / (Math.log10(r1) - Math.log10(r0))) * xa._length;
      } else {
        px = ((p - xa.range[0]) / (xa.range[1] - xa.range[0])) * xa._length;
      }
      // Drop chips that fell outside the current axis range (e.g. user
      // panned away from the peak). Includes the chip's own half-width.
      if (px < -16 || px > xa._length + 16) continue;
      next.push({ x: xa._offset + px, rank: i + 1 });
    }
    setMarkerXs(next);
  }, [plotId, topPeaks]);

  // Recompute on topPeaks change, on every Plotly relayout (zoom/pan),
  // and on container resize. The window-resize fallback covers cases
  // where ResizeObserver isn't available (rare in modern browsers but
  // still safer to listen).
  useEffect(() => {
    refreshMarkers();
    const div = document.getElementById(plotId);
    if (!div) return undefined;
    const onRel = () => refreshMarkers();
    // react-plotly translates plotly_relayout to a div event named the
    // same as the prop; listen on the div directly so we catch every
    // axis change including the bottom-anchored zoom from useChartGestures.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (div as any).on?.('plotly_relayout', onRel);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (div as any).on?.('plotly_afterplot', onRel);
    const ro = new ResizeObserver(onRel);
    ro.observe(div);
    window.addEventListener('resize', onRel);
    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (div as any).removeListener?.('plotly_relayout', onRel);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (div as any).removeListener?.('plotly_afterplot', onRel);
      ro.disconnect();
      window.removeEventListener('resize', onRel);
    };
  }, [plotId, refreshMarkers]);

  const tc = themeOf(themeId).plot;
  // Y-axis range source priority:
  //   1. yMaxLockPx (explicit user lock — pin it, no headroom needed,
  //      the value already came from a real rendered max).
  //   2. yMaxViewPx (most recent rendered max, captured via
  //      onRelayout above — preserves drag-zoom across mode swaps).
  //   3. fftAmpMax (initial paint — explicit [0, max*1.05] so the
  //      bottom is anchored at exactly 0, NOT at Plotly's autorange
  //      padding of a few units below zero. The bottom-anchored Y
  //      zoom gesture captures `startYRange[0]` on pointerdown, so
  //      autoranged starts at e.g. -8 would mean every first drag
  //      "snapped" the axis to [0, …] mid-drag — visible to the user
  //      as a reset jump. Using an explicit 0-based initial range
  //      eliminates that snap.
  // All three are in raw pixel units, so apply `k` to convert to the
  // active display unit at layout time.
  // Both traces share the Y axis; take the max of active + other so a
  // big counterpart isn't clipped on first paint.
  const initialFftMax = Math.max(garun.fftAmpMax, garunOther?.fftAmpMax ?? 0) * 1.05;
  const yMaxApplied = yMaxLockPx ?? yMaxViewPx ?? initialFftMax;
  const yAxisCfg: Partial<Layout['yaxis']> = { range: [0, yMaxApplied * k], autorange: false };
  const layout: Partial<Layout> = {
    autosize: true,
    // Swap top/bottom margins now that the X axis labels live at the top.
    // The bottom no longer needs room for tick labels; the top needs
    // enough space for tick labels + the (optional) legend strip below
    // them.
    margin: { l: 60, r: 30, t: 40, b: 10 },
    paper_bgcolor: tc.paper,
    plot_bgcolor: tc.plot,
    font: { color: tc.font, size: 11 },
    xaxis: {
      title: { text: tChart('axes.period'), standoff: 6 }, gridcolor: tc.grid, zerolinecolor: tc.zeroline,
      type: 'log',
      // Labels and title at the TOP of the chart, matching the original
      // PHD2 desktop's PaintFFT which draws tick labels at
      // `s_fftpos.y1 + 1` (just below the top edge — AnalysisWin.cpp:1093).
      // The desktop's drift chart does the same, so we keep both charts
      // consistent.
      side: 'top',
      // Tracked range wins over the data-derived default. Persists
      // pan across hover-induced re-renders and across mode swaps.
      // `autorange:false` is explicit alongside `range` so Plotly never
      // re-derives a padded range mid-drag (which would otherwise cause
      // the first drag to "snap" the X axis the same way the Y axis
      // did before the autorange→0-anchored fix below).
      range: periodXRangeViewLog ?? xLogRange,
      autorange: false,
      fixedrange: false,
      // Explicit ticks (see `buildLogTickLabels`) — show actual period
      // values at every decade subdivision instead of plotly's default
      // "2 3 4 ... 100" mantissa-only labels.
      tickmode: 'array',
      tickvals: periodTicks.tickvals,
      ticktext: periodTicks.ticktext,
      // Vertical-cursor spike on hover (theme-aware color for visibility
      // on every background). The custom snap-to-peak `drawCursor()`
      // shape painted from `onHover` would have layered on top of this,
      // so it was removed — the spike line provides the always-visible
      // cursor and the hover readout below still shows the
      // snap-to-peak period/amplitude.
      showspikes: true,
      spikemode: 'across',
      spikethickness: 1.5,
      spikedash: 'solid',
      spikecolor: tc.hoverSpike,
      spikesnap: 'cursor',
    },
    yaxis: {
      title: { text: unit === '″' ? tChart('axes.amplitudeArcsec') : tChart('axes.amplitudePixels') },
      gridcolor: tc.grid, zerolinecolor: tc.zeroline,
      ...yAxisCfg,
      // fixedrange disables ALL Plotly-native Y interactions (scroll,
      // pinch). Drag-Y is provided by useChartGestures with bottom
      // anchor; when the user locks, we additionally pass disableYZoom
      // so even that gesture is gated.
      fixedrange: true,
    },
    showlegend: !!garunOther, // legend is meaningful when comparing two traces
    // Legend moved to the BOTTOM of the chart now that the X axis labels
    // occupy the top. Without this the legend overlaps the new tick row.
    legend: {
      orientation: 'h', x: 0, y: -0.05, yanchor: 'top', xanchor: 'left',
      font: { size: 10 }, bgcolor: 'rgba(0,0,0,0)',
    },
    dragmode: false,
    hovermode: 'x',
  };

  return (
    <div className="flex h-full flex-col">
      <div className="relative flex-1">
        <Plot
          divId={plotId}
          data={traces}
          layout={layout}
          config={{ displayModeBar: false, responsive: true, scrollZoom: true, doubleClick: false }}
          style={{ width: '100%', height: '100%' }}
          useResizeHandler
          onHover={onHover as never}
          onUnhover={() => {
            setHover(null);
            // Spike line clears itself when Plotly's hover fades out.
            // Clear the broadcast so the spike chart drops its
            // highlight overlay. No-op outside spike mode.
            if (kind === 'spike') setSpikeHoverPeriod(null);
          }}
          onRelayout={onRelayout as never}
        />
      </div>
      {/* Numbered peak chips overlaid on a narrow strip directly below
          the chart, aligned to the periodogram's x axis. Positions
          come from refreshMarkers above which reads Plotly's internal
          xaxis._offset / _length / range so zoom + resize keep the
          chips on the right period. */}
      <div className="relative h-7 border-t border-slate-800 bg-slate-950/40">
        {markerXs.map((m) => (
          <div
            key={m.rank}
            className="absolute top-1 -translate-x-1/2"
            style={{ left: `${m.x}px` }}
            title={`Peak ${m.rank}`}
          >
            <span
              className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-cyan-600 px-1.5 text-[11px] font-semibold text-white shadow ring-1 ring-cyan-300"
            >
              {m.rank}
            </span>
          </div>
        ))}
      </div>
      <div className="border-t border-slate-800 bg-slate-900/40 px-3 py-1 font-mono text-[11px] text-slate-300 min-h-[24px] whitespace-pre-wrap">
        {hover ?? ' '}
      </div>
    </div>
  );
}
