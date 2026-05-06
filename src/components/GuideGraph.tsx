import { useMemo, useCallback, useRef, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Plot from 'react-plotly.js';
// Use the prebuilt dist to avoid pulling plotly's source modules (which require
// the `buffer/` polyfill not available in the browser bundle path).
// @ts-expect-error -- no types for the dist bundle; we only call relayout.
import Plotly from 'plotly.js/dist/plotly';
import type { Data, Layout, Shape, Annotations } from 'plotly.js';
import { useLogStore } from '../state/logStore';
import { useViewStore } from '../state/viewStore';
import type { GuideSession } from '../parser';
import { useChartGestures } from './useChartGestures';
import { layoutInlineEvents } from './eventLayout';
import { computeSettlingMask } from '../parser/settling';
import { themeOf } from '../themes';

const RA_COLOR = '#60a5fa';
const DEC_COLOR = '#f87171';
const PULSE_RA = '#3b82f6';
const PULSE_DEC = '#dc2626';
// Mass and SNR colors are theme-aware — see themes.ts (`traceMass`,
// `traceSnr`). They're injected into buildTraces by GuideGraph at
// render time. RA / Dec / pulse colors stay constant since they're
// already saturated enough to read on every theme background.

// Plotly config never changes per render — hoisting it as a stable module
// reference avoids a `Plotly.react` reconcile pass each time React rerenders
// (e.g. on hover, where only an overlay state changes).
const PLOT_CONFIG = {
  displayModeBar: false,
  responsive: true,
  scrollZoom: true,
  doubleClick: false as const,
};

type Traces = ReturnType<typeof useViewStore.getState>['traces'];
type ScaleMode = ReturnType<typeof useViewStore.getState>['scaleMode'];

/**
 * Per-section pan/zoom state. Module-level (not a useRef) so the map
 * survives GuideGraph unmount/remount, which happens whenever the user
 * switches between guiding and calibration sections (the latter is rendered
 * by a different component). Cleared by `resetSectionViews` when a new log
 * is loaded.
 */
const sectionViews = new Map<number, { x?: [number, number]; y?: [number, number] }>();
let sectionViewsLogToken: unknown = null;
let lockedYView: [number, number] | null = null;

const ensureViewsForLog = (token: unknown) => {
  if (sectionViewsLogToken !== token) {
    sectionViews.clear();
    lockedYView = null;
    sectionViewsLogToken = token;
  }
};

interface PlotDiv extends HTMLDivElement {
  _fullLayout?: {
    xaxis?: { _offset: number; _length: number; range: [number, number] };
    yaxis?: { _offset: number; _length: number; range: [number, number] };
  };
}

interface PlotlyHoverEvent {
  points?: Array<{ x?: number }>;
}

/**
 * Format a guide entry as a single-line readout. Mirrors the row info
 * format from LogViewFrame.cpp:1124, which is what the desktop puts in
 * its status bar when you mouse over a frame.
 */
function formatRowInfo(e: GuideSession['entries'][number]): string {
  const sat = e.err === 1 ? ' SAT' : '';
  const info = e.info ? ` ${e.info}` : '';
  return [
    `Frame ${e.frame}`,
    `t=${e.dt.toFixed(2)}s`,
    `(x,y)=(${e.dx.toFixed(2)}, ${e.dy.toFixed(2)})`,
    `(RA,Dec)=(${e.raraw.toFixed(2)}, ${e.decraw.toFixed(2)})`,
    `guide=(${e.raguide.toFixed(2)}, ${e.decguide.toFixed(2)})`,
    `corr=(${e.radur}, ${e.decdur})`,
    `m=${e.mass}`,
    `SNR=${e.snr.toFixed(1)}`,
  ].join(' · ') + sat + info;
}

/** Locate the nearest entry by `dt` to the hovered x value. */
function findClosestEntry(entries: GuideSession['entries'], dt: number): GuideSession['entries'][number] | null {
  if (entries.length === 0) return null;
  let lo = 0, hi = entries.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (entries[mid].dt < dt) lo = mid + 1;
    else hi = mid;
  }
  const a = entries[Math.max(0, lo - 1)];
  const b = entries[lo];
  return Math.abs(a.dt - dt) < Math.abs(b.dt - dt) ? a : b;
}

/**
 * Pull the (x, y) value pair to plot for a given entry.
 *
 * Mirrors the desktop app's coord switch in `LogViewFrame.cpp:1731-1750`:
 *   val_x = radec ? raraw : dx
 *   val_y = radec ? -decraw : dy
 * The Dec negation is what makes "north up" on the chart while keeping
 * the raw PHD2 values in the log unchanged.
 */
const valuePair = (
  e: GuideSession['entries'][number],
  coordMode: ReturnType<typeof useViewStore.getState>['coordMode'],
): { x: number; y: number } => {
  if (coordMode === 'RA_DEC') return { x: e.raraw, y: -e.decraw };
  return { x: e.dx, y: e.dy };
};

function buildTraces(
  s: GuideSession,
  traces: Traces,
  scaleMode: ScaleMode,
  yMax: number,
  coordMode: ReturnType<typeof useViewStore.getState>['coordMode'],
  device: ReturnType<typeof useViewStore.getState>['device'],
  hasAo: boolean,
  massColor: string,
  snrColor: string,
): Data[] {
  // When AO data is present in the session, filter entries to the chosen
  // device. Mount-only sessions skip this filter (every entry is MOUNT).
  const visibleEntries = hasAo ? s.entries.filter((e) => e.mount === device) : s.entries;
  const t = visibleEntries.map((e) => e.dt);
  const out: Data[] = [];
  const k = scaleMode === 'ARCSEC' ? s.pixelScale : 1;

  let maxErr = 0;
  for (const e of visibleEntries) {
    const v = valuePair(e, coordMode);
    const a = Math.abs(v.x * k);
    const b = Math.abs(v.y * k);
    if (a > maxErr) maxErr = a;
    if (b > maxErr) maxErr = b;
  }
  let maxPulse = 0;
  for (const e of visibleEntries) {
    const a = Math.abs(e.radur);
    const b = Math.abs(e.decdur);
    if (a > maxPulse) maxPulse = a;
    if (b > maxPulse) maxPulse = b;
  }
  const pulseScale = maxPulse > 0 && maxErr > 0 ? (maxErr * 0.5) / maxPulse : 0;

  // Guide-star Mass and SNR live on a SECONDARY y-axis (yaxis2) pinned to
  // the top band of the chart. The desktop achieves the same effect by
  // computing a screen-space scale (LogViewFrame.cpp:1678-1719:
  // (height/2 - 10)/max_value, anchored to the bottom edge in pixels) so
  // user zoom/pan on the guiding axis can't shove the Mass/SNR overlays
  // through the RA/Dec traces. yaxis2 here is fixed-range [0, 1.05] with
  // its own `domain` in the layout (top ~30% of the chart), which is the
  // Plotly-native equivalent of "screen-anchored": the band's screen
  // position never moves, no matter what the user does to yaxis.
  //
  // We normalize each trace into [0, 1] using its own per-session max so
  // Mass and SNR are shape-comparable inside the band. They share the
  // band and may overlap each other, but neither overlaps the guiding
  // traces below.
  let maxMass = 0;
  for (const e of visibleEntries) if (e.mass > maxMass) maxMass = e.mass;
  let maxSnr = 0;
  for (const e of visibleEntries) if (e.snr > maxSnr) maxSnr = e.snr;

  const xName = coordMode === 'RA_DEC' ? 'RA' : 'dx';
  const yName = coordMode === 'RA_DEC' ? 'Dec' : 'dy';

  if (traces.ra) {
    out.push({
      x: t, y: visibleEntries.map((e) => valuePair(e, coordMode).x * k),
      type: 'scattergl', mode: 'lines',
      name: xName, line: { color: RA_COLOR, width: 1 },
    } as Data);
  }
  if (traces.dec) {
    out.push({
      x: t, y: visibleEntries.map((e) => valuePair(e, coordMode).y * k),
      type: 'scattergl', mode: 'lines',
      name: yName, line: { color: DEC_COLOR, width: 1 },
    } as Data);
  }
  if (traces.raPulses) {
    out.push({
      x: t,
      y: visibleEntries.map((e) => e.radur * pulseScale),
      customdata: visibleEntries.map((e) => e.radur),
      type: 'bar',
      name: 'RA pulse',
      marker: { color: PULSE_RA, opacity: 0.55 },
      hovertemplate: 'RA pulse: %{customdata} ms<extra></extra>',
    } as Data);
  }
  if (traces.decPulses) {
    out.push({
      x: t,
      y: visibleEntries.map((e) => e.decdur * pulseScale),
      customdata: visibleEntries.map((e) => e.decdur),
      type: 'bar',
      name: 'Dec pulse',
      marker: { color: PULSE_DEC, opacity: 0.55 },
      hovertemplate: 'Dec pulse: %{customdata} ms<extra></extra>',
    } as Data);
  }
  if (traces.mass) {
    out.push({
      x: t,
      y: visibleEntries.map((e) => (maxMass > 0 ? e.mass / maxMass : 0)),
      customdata: visibleEntries.map((e) => e.mass),
      type: 'scattergl', mode: 'lines',
      yaxis: 'y2',
      name: 'Mass', line: { color: massColor, width: 1 },
      hovertemplate: 'Mass: %{customdata}<extra></extra>',
    } as Data);
  }
  if (traces.snr) {
    out.push({
      x: t,
      y: visibleEntries.map((e) => (maxSnr > 0 ? e.snr / maxSnr : 0)),
      customdata: visibleEntries.map((e) => e.snr),
      type: 'scattergl', mode: 'lines',
      yaxis: 'y2',
      name: 'SNR', line: { color: snrColor, width: 1 },
      hovertemplate: 'SNR: %{customdata:.1f}<extra></extra>',
    } as Data);
  }

  // Invisible hover targets at the top of each info-event marker. Plotly
  // `shapes` don't fire hover events, so we add a thin scatter trace whose
  // markers are placed at the top of the chart and given a hovertemplate
  // that reveals the event text.
  if (s.infos.length > 0) {
    const infoX: number[] = [];
    const infoY: number[] = [];
    const infoText: string[] = [];
    for (const info of s.infos) {
      const entry = s.entries[info.idx];
      if (!entry) continue;
      infoX.push(entry.dt);
      // High Y so the markers sit near the top edge regardless of zoom.
      infoY.push(yMax * 0.95);
      const repeats = info.repeats > 1 ? ` ×${info.repeats}` : '';
      infoText.push(`${info.info}${repeats}`);
    }
    out.push({
      x: infoX, y: infoY, text: infoText,
      type: 'scatter', mode: 'markers',
      name: 'events',
      marker: { size: 14, color: 'rgba(0,0,0,0)' },
      hovertemplate: '<b>%{text}</b><extra></extra>',
      showlegend: false,
    } as Data);
  }

  return out;
}

const DITHER_BORDER = 'rgba(168, 85, 247, 0.7)';
const INFO_BORDER = 'rgba(250, 204, 21, 0.55)';

/**
 * Convert laid-out events into Plotly annotation specs. yref:'paper' keeps
 * the labels glued to the bottom of the plot regardless of Y zoom; yshift
 * stacks higher rows upward (row=0 is the bottom row). Border color matches
 * the existing dotted line for that event so the visual link is obvious.
 *
 * 14 px row spacing is intentional: the desktop used 16 px against a larger
 * DC font; the web font is 10 px, so 14 px keeps rows compact with ~4 px of
 * breathing room.
 */
function buildEventAnnotations(
  laidOut: ReturnType<typeof layoutInlineEvents>,
  bgcolor: string,
  fgcolor: string,
): Partial<Annotations>[] {
  return laidOut.map((ev) => ({
    x: ev.timeSec,
    xref: 'x',
    y: 0,
    yref: 'paper',
    yanchor: 'bottom',
    xanchor: 'left',
    yshift: ev.row * 14,
    text: ev.text,
    showarrow: false,
    bgcolor,
    bordercolor: ev.isDither ? DITHER_BORDER : INFO_BORDER,
    borderwidth: 1,
    borderpad: 2,
    font: { size: 10, color: fgcolor },
  }));
}

/**
 * Build the four horizontal dotted lines that mark the mount's RA / Dec
 * correction limits — `maxDur` (max correction duration, milliseconds) and
 * `minMo` (minimum motion threshold, pixels). Mirrors LogViewFrame.cpp:1554-1595:
 *   y_maxDur = ±(maxDur * rate / 1000)   pixels of mount displacement
 *   y_minMo  = ±minMo                    already in pixels
 * Both are then scaled into the chart's data Y units (arc-sec when
 * `scaleMode === 'ARCSEC'`, raw pixels otherwise) by multiplying by `k`.
 * Each pair is only emitted when the corresponding header value is > 0;
 * sessions with one limit unset (e.g. only minMo configured) get just
 * two lines instead of four. xref:'paper' makes the lines span the full
 * chart width regardless of x-zoom, matching the desktop's `0..fullw`.
 */
function pushLimitLines(
  shapes: Partial<Shape>[],
  axis: 'ra' | 'dec',
  s: GuideSession,
  k: number,
): void {
  const lim = axis === 'ra' ? s.mount.xlim : s.mount.ylim;
  const rate = axis === 'ra' ? s.mount.xRate : s.mount.yRate;
  const color = axis === 'ra' ? RA_COLOR : DEC_COLOR;
  const dataMax = lim.maxDur > 0 ? (lim.maxDur * rate / 1000) * k : 0;
  const dataMin = lim.minMo > 0 ? lim.minMo * k : 0;
  const pushPair = (yAbs: number) => {
    for (const y of [yAbs, -yAbs]) {
      shapes.push({
        type: 'line',
        xref: 'paper', x0: 0, x1: 1,
        yref: 'y', y0: y, y1: y,
        line: { color, width: 1, dash: 'dot' },
      });
    }
  };
  if (dataMax > 0) pushPair(dataMax);
  if (dataMin > 0) pushPair(dataMin);
}

function buildShapes(
  s: GuideSession,
  mask: Uint8Array | undefined,
  traces: Traces,
  scaleMode: ScaleMode,
): Partial<Shape>[] {
  const shapes: Partial<Shape>[] = [];
  const k = scaleMode === 'ARCSEC' ? s.pixelScale : 1;

  if (traces.raLimits) pushLimitLines(shapes, 'ra', s, k);
  if (traces.decLimits) pushLimitLines(shapes, 'dec', s, k);

  if (mask) {
    let runStart = -1;
    for (let i = 0; i <= s.entries.length; i++) {
      const ex = i < s.entries.length && mask[i] === 1;
      if (ex && runStart < 0) runStart = i;
      else if (!ex && runStart >= 0) {
        shapes.push({
          type: 'rect', xref: 'x', yref: 'paper',
          x0: s.entries[runStart].dt, x1: s.entries[i - 1].dt,
          y0: 0, y1: 1,
          fillcolor: 'rgba(251, 146, 60, 0.18)',
          line: { color: 'rgba(251, 146, 60, 0.55)', width: 1 },
        });
        runStart = -1;
      }
    }
  }

  for (const info of s.infos) {
    const t = s.entries[info.idx]?.dt;
    if (t === undefined) continue;
    const isDither = info.info.startsWith('DITHER');
    shapes.push({
      type: 'line', xref: 'x', yref: 'paper',
      x0: t, x1: t, y0: 0, y1: 1,
      line: {
        color: isDither ? 'rgba(168, 85, 247, 0.7)' : 'rgba(250, 204, 21, 0.4)',
        width: 1,
        dash: 'dot',
      },
    });
  }

  return shapes;
}

export function GuideGraph() {
  const { t: tSections } = useTranslation('sections');
  const { t: tChart } = useTranslation('chart');
  const log = useLogStore((s) => s.log);
  const sectionIdx = useLogStore((s) => s.selectedSection);
  const exclusions = useViewStore((s) => s.exclusions);
  const setMask = useViewStore((s) => s.setMask);
  const scaleMode = useViewStore((s) => s.scaleMode);
  const traces = useViewStore((s) => s.traces);
  const coordMode = useViewStore((s) => s.coordMode);
  const device = useViewStore((s) => s.device);
  const scaleLocked = useViewStore((s) => s.scaleLocked);
  const autoScaleY = useViewStore((s) => s.autoScaleY);
  const showRangeSlider = useViewStore((s) => s.showRangeSlider);
  const themeId = useViewStore((s) => s.theme);
  const excludeRange = useViewStore((s) => s.excludeRange);
  const includeRange = useViewStore((s) => s.includeRange);

  const plotId = useId().replace(/:/g, '_');
  // Reset the module-level per-section view map when the loaded log changes
  // — views from a prior log shouldn't leak into a freshly-opened one.
  ensureViewsForLog(log);
  const [hoverInfo, setHoverInfo] = useState<string | null>(null);

  // Latest values used by the long-lived event handlers.
  const dataRef = useRef<{ session: GuideSession; sessionIdx: number } | null>(null);
  const measureTextPxRef = useRef<((text: string) => number) | null>(null);
  if (!measureTextPxRef.current) {
    const cache = new Map<string, number>();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.font = '10px sans-serif';
    measureTextPxRef.current = (text: string) => {
      const cached = cache.get(text);
      if (cached !== undefined) return cached;
      const w = ctx ? ctx.measureText(text).width : text.length * 6;
      cache.set(text, w);
      return w;
    };
  }

  const refreshAnnotationsRef = useRef<() => void>(() => {});

  const includeRangeRef = useRef(includeRange);
  const excludeRangeRef = useRef(excludeRange);
  useEffect(() => { includeRangeRef.current = includeRange; }, [includeRange]);
  useEffect(() => { excludeRangeRef.current = excludeRange; }, [excludeRange]);

  // Switching sections does NOT clear viewsRef anymore — that map is what
  // gives each section its own remembered pan/zoom view.
  // Toggling auto-Y is an explicit "re-fit Y" action across all sections:
  // wipe every section's saved Y range (and the global locked Y) so the new
  // default (robust percentile vs. raw max) takes effect everywhere.
  useEffect(() => {
    for (const [k, v] of sectionViews) {
      sectionViews.set(k, { x: v.x }); // drop y, keep x
    }
    lockedYView = null;
  }, [autoScaleY]);

  // Toggling scale-lock on snapshots the current section's Y range as the
  // global lock; toggling off clears the global ref so per-section Y views
  // take over again.
  useEffect(() => {
    if (scaleLocked) {
      const v = sectionViews.get(sectionIdx);
      lockedYView = v?.y ?? null;
    } else {
      lockedYView = null;
    }
    // Intentionally not depending on sectionIdx — we only want this snapshot
    // when the user toggles the lock button, not on every navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scaleLocked]);

  const data = useMemo(() => {
    if (!log || sectionIdx < 0) return null;
    const sec = log.sections[sectionIdx];
    if (!sec || sec.type !== 'GUIDING') return null;
    const session = log.sessions[sec.idx];
    const mask = exclusions.get(sec.idx);
    const hasAo = session.entries.some((e) => e.mount === 'AO');
    // Compute the natural X extent from the entries themselves rather than
    // relying on Plotly's autorange. We pass this as the layout's xaxis.range
    // so Plotly always has an explicit, stable X range to scroll-zoom from.
    // (When the xaxis is in autorange mode, Plotly's first scrollZoom event
    // can occasionally anchor the zoom on x=0 rather than the cursor — the
    // bug that "jumps to the start of the data".)
    const xExtent: [number, number] = session.entries.length >= 2
      ? [session.entries[0].dt, session.entries[session.entries.length - 1].dt]
      : [0, 1];

    // Compute initial Y range so we know mass/snr scaling. We sample only the
    // entries that will actually be visible (filtered by device when AO is
    // present) and using the active coord mode.
    const visible = hasAo ? session.entries.filter((e) => e.mount === device) : session.entries;
    const k = scaleMode === 'ARCSEC' ? session.pixelScale : 1;

    let yMax: number;
    if (autoScaleY) {
      // Robust percentile-based extent. Take |x| and |y| of visible entries,
      // sort them, and use the 99th percentile multiplied by 1.5. This pins
      // the visible range to where the typical guiding lives (often <2"),
      // while letting dithers and lost-stars draw off-screen — they're still
      // there and exclude/include works on them, they just don't dominate
      // the scale.
      const absVals: number[] = [];
      for (const e of visible) {
        const v = valuePair(e, coordMode);
        const a = Math.abs(v.x * k);
        const b = Math.abs(v.y * k);
        if (Number.isFinite(a)) absVals.push(a);
        if (Number.isFinite(b)) absVals.push(b);
      }
      if (absVals.length === 0) {
        yMax = 1;
      } else {
        absVals.sort((p, q) => p - q);
        const idx = Math.floor(absVals.length * 0.99);
        const p99 = absVals[Math.min(idx, absVals.length - 1)];
        // Floor at 1" / 1px so a near-perfectly-flat session still has a
        // visible range, and use 1.5× headroom so the trace breathes.
        yMax = Math.max(p99 * 1.5, 1);
      }
    } else {
      let maxErr = 0;
      for (const e of visible) {
        const v = valuePair(e, coordMode);
        const a = Math.abs(v.x * k);
        const b = Math.abs(v.y * k);
        if (a > maxErr) maxErr = a;
        if (b > maxErr) maxErr = b;
      }
      yMax = maxErr > 0 ? maxErr * 1.1 : 1;
    }

    const eventInputs: { timeSec: number; text: string; isDither: boolean }[] = [];
    if (traces.events) {
      for (const info of session.infos) {
        const entry = session.entries[info.idx];
        if (!entry) continue;
        const text = info.repeats > 1 ? `${info.info} ×${info.repeats}` : info.info;
        eventInputs.push({
          timeSec: entry.dt,
          text,
          isDither: info.info.startsWith('DITHER'),
        });
      }
    }

    return {
      session,
      sessionIdx: sec.idx,
      hasAo,
      yMax,
      xExtent,
      traces: buildTraces(session, traces, scaleMode, yMax, coordMode, device, hasAo, themeOf(themeId).plot.traceMass, themeOf(themeId).plot.traceSnr),
      shapes: buildShapes(session, mask, traces, scaleMode),
      eventInputs,
    };
  }, [log, sectionIdx, exclusions, scaleMode, traces, coordMode, device, autoScaleY, themeId]);

  useEffect(() => {
    dataRef.current = data ? { session: data.session, sessionIdx: data.sessionIdx } : null;
  }, [data]);

  // First-time-viewing default: auto-exclude dithers and settling windows so
  // routine guiding stats aren't dominated by post-dither recovery frames.
  // Only applies when no mask exists yet for this section — once the user
  // touches the exclusions (Include all, manual ranges, etc.) an entry is
  // recorded and we leave it alone.
  useEffect(() => {
    if (!data) return;
    if (exclusions.has(data.sessionIdx)) return;
    const mask = computeSettlingMask(data.session);
    let any = false;
    for (let i = 0; i < mask.length; i++) if (mask[i]) { any = true; break; }
    setMask(data.sessionIdx, any ? mask : new Uint8Array(data.session.entries.length));
  }, [data, exclusions, setMask]);

  const initialAnnotations = useMemo<Partial<Annotations>[]>(() => {
    if (!data || data.eventInputs.length === 0) return [];
    const measure = measureTextPxRef.current!;
    // Use the natural span of the data for first paint. The relayout
    // handler below recomputes once the chart actually has a real width.
    const span = Math.max(1e-6, data.xExtent[1] - data.xExtent[0]);
    // Assume a ~1000 px chart for first paint; relayout will correct it.
    const pxPerSecond = 1000 / span;
    const laid = layoutInlineEvents(data.eventInputs, pxPerSecond, measure);
    const tc = themeOf(themeId).plot;
    return buildEventAnnotations(laid, tc.annotationBg, tc.annotationFg);
  }, [data, themeId]);

  useEffect(() => {
    refreshAnnotationsRef.current = () => {
      const ctx = dataRef.current;
      if (!ctx) return;
      // Plotly attaches `_fullLayout` to the div once it has finished its
      // initial render. Calling relayout before that crashes (the div has
      // no plot to update). The `annotations` already passed via the React
      // layout prop covers the pre-init case, so we just skip until ready.
      const div = document.getElementById(plotId) as PlotDiv | null;
      if (!div?._fullLayout) return;
      if (!data || data.eventInputs.length === 0) return;
      const xa = div._fullLayout.xaxis;
      const widthPx = xa?._length ?? div.clientWidth ?? 1000;
      const range = xa?.range ?? data.xExtent;
      const span = Math.max(1e-6, range[1] - range[0]);
      const pxPerSecond = widthPx / span;
      const measure = measureTextPxRef.current!;
      const laid = layoutInlineEvents(data.eventInputs, pxPerSecond, measure);
      const tc = themeOf(themeId).plot;
      void Plotly.relayout(plotId, { annotations: buildEventAnnotations(laid, tc.annotationBg, tc.annotationFg) });
    };
  }, [data, plotId, themeId]);

  // Mouse-wheel X zoom is handled by Plotly's built-in scrollZoom (config),
  // constrained to the X axis by setting yaxis.fixedrange:true on the layout.
  // Plotly already does cursor-anchored zoom correctly across all browsers,
  // so we don't roll our own — earlier custom-handler attempts broke on the
  // first scroll because `_fullLayout.xaxis._offset` could be transiently
  // missing right after autorange completed.

  // Reset zoom event from context menu — clears only the current section's
  // saved view, leaving every other section's view alone.
  useEffect(() => {
    const onReset = () => {
      void Plotly.relayout(plotId, { 'xaxis.autorange': true, 'yaxis.autorange': true });
      const idx = dataRef.current?.sessionIdx;
      if (idx !== undefined) sectionViews.delete(idx);
    };
    window.addEventListener('phd-reset-zoom', onReset);
    return () => window.removeEventListener('phd-reset-zoom', onReset);
  }, [plotId]);

  // Recenter Y around 0 without changing zoom.
  useEffect(() => {
    const onRecenter = () => {
      const div = document.getElementById(plotId) as PlotDiv | null;
      const r = div?._fullLayout?.yaxis?.range;
      if (!r) return;
      const half = (r[1] - r[0]) / 2;
      const newRange: [number, number] = [-half, half];
      void Plotly.relayout(plotId, { 'yaxis.range': newRange });
      const idx = dataRef.current?.sessionIdx;
      if (idx !== undefined) {
        const cur = sectionViews.get(idx) ?? {};
        sectionViews.set(idx, { ...cur, y: newRange });
      }
      if (scaleLocked) lockedYView = newRange;
    };
    window.addEventListener('phd-recenter-y', onRecenter);
    return () => window.removeEventListener('phd-recenter-y', onRecenter);
  }, [plotId, scaleLocked]);

  // PNG export. Plotly's downloadImage triggers a browser save with the
  // current chart rendered at the requested size; we use 2x the visible
  // dimensions for a high-DPI screenshot.
  useEffect(() => {
    const onExport = (ev: Event) => {
      const div = document.getElementById(plotId) as PlotDiv | null;
      if (!div) return;
      const detail = (ev as CustomEvent<{ filename?: string }>).detail || {};
      const baseName = detail.filename || 'phd2-log';
      void Plotly.downloadImage(div, {
        format: 'png',
        width: (div.clientWidth || 1200) * 2,
        height: (div.clientHeight || 600) * 2,
        filename: baseName,
      });
    };
    window.addEventListener('phd-export-png', onExport);
    return () => window.removeEventListener('phd-export-png', onExport);
  }, [plotId]);

  useChartGestures(
    plotId,
    {
      onIncludeRange: (lo, hi) => {
        const ctx = dataRef.current;
        if (!ctx) return;
        includeRangeRef.current(
          ctx.sessionIdx,
          ctx.session.entries.length,
          lo,
          hi,
          ctx.session.entries.map((e) => e.frame),
        );
      },
      onExcludeRange: (lo, hi) => {
        const ctx = dataRef.current;
        if (!ctx) return;
        excludeRangeRef.current(
          ctx.sessionIdx,
          ctx.session.entries.length,
          lo,
          hi,
          ctx.session.entries.map((e) => e.frame),
        );
      },
      onRangeChange: (axis, range) => {
        const idx = dataRef.current?.sessionIdx;
        if (idx === undefined) return;
        const cur = sectionViews.get(idx) ?? {};
        if (axis === 'x') sectionViews.set(idx, { ...cur, x: range });
        else {
          sectionViews.set(idx, { ...cur, y: range });
          if (scaleLocked) lockedYView = range;
        }
      },
      rangeContext: () => {
        const ctx = dataRef.current;
        if (!ctx) return null;
        const entries = ctx.session.entries;
        return {
          frames: entries.map((e) => e.frame),
          dts: entries.map((e) => e.dt),
        };
      },
    },
    // Don't hide the rangeslider during drag — toggling its visibility
    // changes the plot area's pixel height, which makes the chart "jump"
    // taller mid-drag and snap back on release. Better to keep it pinned.
    { enableModifierSelect: true, hideRangeSliderDuringDrag: false },
  );

  // Plotly's plotly_hover event fires with the nearest point on the topmost
  // trace. We use just its x (= time in seconds) and look up the actual
  // GuideEntry, so the readout shows ALL fields, not just the trace value.
  //
  // Plotly can fire hover events well above 60Hz on a fast mousemove. Each
  // setHoverInfo call re-renders GuideGraph, so we batch through rAF: at
  // most one commit per frame, with the latest value winning. The pending
  // text and the rAF id live in refs so the effect-friendly closure doesn't
  // need to re-bind the listener.
  const hoverRafRef = useRef<number | null>(null);
  const pendingHoverRef = useRef<string | null>(null);
  const onHover = useCallback((ev: PlotlyHoverEvent) => {
    if (!data) return;
    const x = ev.points?.[0]?.x;
    if (typeof x !== 'number') return;
    const entry = findClosestEntry(data.session.entries, x);
    if (!entry) return;
    pendingHoverRef.current = formatRowInfo(entry);
    if (hoverRafRef.current == null) {
      hoverRafRef.current = requestAnimationFrame(() => {
        hoverRafRef.current = null;
        setHoverInfo(pendingHoverRef.current);
      });
    }
  }, [data]);

  const onUnhover = useCallback(() => {
    if (hoverRafRef.current != null) {
      cancelAnimationFrame(hoverRafRef.current);
      hoverRafRef.current = null;
    }
    pendingHoverRef.current = null;
    setHoverInfo(null);
  }, []);

  // Cancel any in-flight rAF on unmount so a late callback can't fire
  // setHoverInfo on an unmounted component.
  useEffect(() => () => {
    if (hoverRafRef.current != null) cancelAnimationFrame(hoverRafRef.current);
  }, []);

  // Plotly fires plotly_relayout for any user-driven range change (scroll
  // zoom, drag-zoom, etc.). Persist the new range into the per-section view
  // so the next time we revisit this section the same view is restored.
  const onRelayout = useCallback((ev: Readonly<Record<string, unknown>>) => {
    const idx = dataRef.current?.sessionIdx;
    if (idx === undefined) return;
    const cur = sectionViews.get(idx) ?? {};
    const next = { ...cur };

    const xr0 = ev['xaxis.range[0]'];
    const xr1 = ev['xaxis.range[1]'];
    if (typeof xr0 === 'number' && typeof xr1 === 'number') {
      next.x = [xr0, xr1];
    }
    const yr0 = ev['yaxis.range[0]'];
    const yr1 = ev['yaxis.range[1]'];
    if (typeof yr0 === 'number' && typeof yr1 === 'number') {
      next.y = [yr0, yr1];
      if (scaleLocked) lockedYView = [yr0, yr1];
    }
    if (ev['xaxis.autorange'] === true) next.x = undefined;
    if (ev['yaxis.autorange'] === true) {
      next.y = undefined;
      if (scaleLocked) lockedYView = null;
    }
    sectionViews.set(idx, next);

    // Inline-event labels stack by screen pixels, so the row layout depends
    // on the current x-zoom. Re-derive annotations only when an x-axis range
    // actually changed — never on an annotations-only relayout, which we
    // ourselves trigger and would cause an infinite recursion.
    const xRangeChanged =
      typeof ev['xaxis.range[0]'] === 'number' ||
      typeof ev['xaxis.range[1]'] === 'number' ||
      ev['xaxis.autorange'] === true;
    if (xRangeChanged) refreshAnnotationsRef.current?.();
  }, [scaleLocked]);

  // After the chart mounts and its real pixel width is available, redo the
  // annotation layout so the row spacing reflects the actual chart size
  // (initialAnnotations used a 1000 px guess to avoid a flash of empty).
  useEffect(() => {
    const id = requestAnimationFrame(() => refreshAnnotationsRef.current?.());
    return () => cancelAnimationFrame(id);
  }, [data, traces.events]);

  // Compute yTitle outside the early-return so the memo below can reference
  // it without being skipped when data is null (hooks must run unconditionally).
  const yTitle = scaleMode === 'ARCSEC' ? tChart('axes.arcsec') : tChart('axes.pixels');

  // Memoizing the layout matters: GuideGraph re-renders on every hover
  // (hoverInfo state) and on any viewStore change, but the layout only
  // legitimately depends on the inputs below. Without this memo react-plotly.js
  // re-diffs the layout on every hover event and may issue a Plotly.react
  // call, which is the dominant cost at ~60 hovers/sec during a drag. The
  // mutable section-views map is read on each rebuild — we don't include it
  // in deps because drag-driven range changes go straight to Plotly via
  // queueRelayout, so a stale React-side layout isn't an issue.
  const layout = useMemo<Partial<Layout> | null>(() => {
    if (!data) return null;
    // Split-domain layout: when Mass or SNR is enabled, reserve the top
    // ~30% of the chart for guide-star traces (yaxis2) and confine the
    // guiding traces (yaxis) to the bottom 65%, leaving a 5% gap as a
    // visual divider. When neither is on, yaxis takes the full chart so
    // RA/Dec/pulses get the maximum vertical resolution.
    const showStarBand = traces.mass || traces.snr;
    const guideDomain: [number, number] = showStarBand ? [0, 0.65] : [0, 1];
    const starDomain: [number, number] = [0.7, 1];
    const tc = themeOf(themeId).plot;
    return {
      autosize: true,
      margin: { l: 60, r: 60, t: 20, b: 40 },
      paper_bgcolor: tc.paper,
      plot_bgcolor: tc.plot,
      font: { color: tc.font, size: 11 },
      xaxis: {
        title: { text: tChart('axes.time') }, gridcolor: tc.grid, zerolinecolor: tc.zeroline,
        // X is unfixed so Plotly's built-in scrollZoom (config below) can zoom
        // it via the wheel; Plotly handles cursor-anchored zoom correctly. Drag
        // gestures are owned by our custom handlers (Plotly dragmode:false),
        // so leaving fixedrange:false here does not enable any unwanted drag.
        // We always provide an *explicit* range (this section's saved view, or
        // the data extent on first visit) so Plotly never sees autorange:true
        // and the first wheel event can't anchor on a stale 0 offset.
        fixedrange: false,
        range: sectionViews.get(data.sessionIdx)?.x ?? data.xExtent,
        // Compact range-slider thumbnail beneath the chart shows the full
        // session at a glance and lets the user drag to scrub a window.
        // Off by default: with many traces visible, the slider has to
        // re-render its own thumbnail on every relayout (every drag tick),
        // which dominates frame time. The toolbar has a "range slider"
        // toggle to bring it back when you actually want a navigator.
        rangeslider: {
          visible: showRangeSlider,
          thickness: 0.06,
          bgcolor: tc.paper,
          bordercolor: tc.grid,
          borderwidth: 1,
        },
      },
      yaxis: {
        title: { text: yTitle }, gridcolor: tc.grid,
        zerolinecolor: tc.zerolineStrong, zerolinewidth: 1,
        // Y stays fixed so scrollZoom only ever affects X. Our drag handler
        // calls Plotly.relayout({yaxis.range:...}) directly, which bypasses
        // fixedrange.
        fixedrange: true,
        // Y range source: scale-locked global > per-section saved Y > the
        // computed default (auto-Y percentile or raw min/max of this session).
        range: (scaleLocked && lockedYView)
          ? lockedYView
          : sectionViews.get(data.sessionIdx)?.y ?? [-data.yMax, data.yMax],
        domain: guideDomain,
      },
      // Secondary y-axis for guide-star Mass/SNR. Pinned to the top
      // ~30% of the chart via `domain`, with a fixed [0, 1.05] range
      // (traces are normalized to [0, 1] in buildTraces, with a hair of
      // headroom above 1.0 so the peaks aren't clipped right at the
      // border). The user can't pan/zoom this axis — its job is to be a
      // stable, zoom-independent shelf for the guide-star overlays. Tick
      // labels / grid lines are hidden because the absolute values
      // aren't meaningful here (only the trace shape matters within the
      // session); the legend entries identify the lines by color.
      yaxis2: {
        domain: starDomain,
        range: [0, 1.05],
        fixedrange: true,
        showticklabels: false,
        showgrid: false,
        zeroline: false,
        showline: false,
        ticks: '',
        anchor: 'x',
        side: 'right',
      },
      shapes: data.shapes,
      annotations: initialAnnotations,
      showlegend: true,
      legend: { orientation: 'h', y: 1.1 },
      dragmode: false,
      barmode: 'overlay',
      // uirevision keeps Plotly's UI-side caches stable across our
      // re-renders that don't change the data shape — anything keyed to
      // sessionIdx is the right granularity (a new section = new chart).
      uirevision: data.sessionIdx,
    };
  }, [data, showRangeSlider, scaleLocked, initialAnnotations, tChart, yTitle, traces.mass, traces.snr, themeId]);

  if (!data || !layout) {
    return <div className="flex h-full items-center justify-center text-slate-500">{tSections('list.selectGuiding')}</div>;
  }

  return (
    <div className="relative h-full w-full">
      <Plot
        divId={plotId}
        data={data.traces}
        layout={layout}
        config={PLOT_CONFIG}
        style={{ width: '100%', height: '100%' }}
        useResizeHandler
        onRelayout={onRelayout as never}
        onHover={onHover as never}
        onUnhover={onUnhover}
      />
      {hoverInfo && (
        <div
          className="pointer-events-none absolute bottom-1 start-2 end-2 truncate rounded border border-slate-700/70 bg-slate-900/85 px-2 py-1 font-mono text-[11px] text-slate-200 shadow"
          title="Frame info under the cursor (matches the desktop's status bar). Press Esc / move the mouse off the chart to clear."
        >
          {hoverInfo}
        </div>
      )}
    </div>
  );
}
