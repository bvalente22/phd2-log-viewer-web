import { useMemo, useCallback, useRef, useEffect, useId } from 'react';
import Plot from 'react-plotly.js';
// Use the prebuilt dist to avoid pulling plotly's source modules (which require
// the `buffer/` polyfill not available in the browser bundle path).
// @ts-expect-error -- no types for the dist bundle; we only call relayout.
import Plotly from 'plotly.js/dist/plotly';
import type { Data, Layout, Shape } from 'plotly.js';
import { useLogStore } from '../state/logStore';
import { useViewStore } from '../state/viewStore';
import type { GuideSession } from '../parser';

const RA_COLOR = '#60a5fa';
const DEC_COLOR = '#f87171';
const PULSE_RA = '#3b82f6';
const PULSE_DEC = '#dc2626';
const MASS_COLOR = '#facc15';
const SNR_COLOR = '#e2e8f0';

const INCLUDE_FILL = 'rgba(34, 197, 94, 0.18)';
const INCLUDE_BORDER = 'rgba(34, 197, 94, 0.7)';
const EXCLUDE_FILL = 'rgba(251, 146, 60, 0.18)';
const EXCLUDE_BORDER = 'rgba(251, 146, 60, 0.7)';

type Traces = ReturnType<typeof useViewStore.getState>['traces'];
type ScaleMode = ReturnType<typeof useViewStore.getState>['scaleMode'];

interface PlotDiv extends HTMLDivElement {
  _fullLayout?: {
    xaxis?: { _offset: number; _length: number; range: [number, number] };
    yaxis?: { _offset: number; _length: number; range: [number, number] };
  };
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

  // Mass/SNR live in the bottom half of the chart (matches LogViewFrame.cpp:1678-1719:
  // each scaled to (height/2)/max_value, anchored to the bottom edge).
  // Half-height in data-space is yMax (since y range is [-yMax, yMax]).
  // Offset by -yMax so the value 0 sits at the bottom of the chart.
  let maxMass = 0;
  for (const e of visibleEntries) if (e.mass > maxMass) maxMass = e.mass;
  let maxSnr = 0;
  for (const e of visibleEntries) if (e.snr > maxSnr) maxSnr = e.snr;
  const massScale = maxMass > 0 ? yMax / maxMass : 0;
  const snrScale = maxSnr > 0 ? yMax / maxSnr : 0;

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
      y: visibleEntries.map((e) => -yMax + e.mass * massScale),
      customdata: visibleEntries.map((e) => e.mass),
      type: 'scattergl', mode: 'lines',
      name: 'Mass', line: { color: MASS_COLOR, width: 1 },
      hovertemplate: 'Mass: %{customdata}<extra></extra>',
    } as Data);
  }
  if (traces.snr) {
    out.push({
      x: t,
      y: visibleEntries.map((e) => -yMax + e.snr * snrScale),
      customdata: visibleEntries.map((e) => e.snr),
      type: 'scattergl', mode: 'lines',
      name: 'SNR', line: { color: SNR_COLOR, width: 1 },
      hovertemplate: 'SNR: %{customdata:.1f}<extra></extra>',
    } as Data);
  }
  return out;
}

function buildShapes(s: GuideSession, mask: Uint8Array | undefined): Partial<Shape>[] {
  const shapes: Partial<Shape>[] = [];

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
  const log = useLogStore((s) => s.log);
  const sectionIdx = useLogStore((s) => s.selectedSection);
  const exclusions = useViewStore((s) => s.exclusions);
  const scaleMode = useViewStore((s) => s.scaleMode);
  const traces = useViewStore((s) => s.traces);
  const coordMode = useViewStore((s) => s.coordMode);
  const device = useViewStore((s) => s.device);
  const scaleLocked = useViewStore((s) => s.scaleLocked);
  const excludeRange = useViewStore((s) => s.excludeRange);
  const includeRange = useViewStore((s) => s.includeRange);

  const plotId = useId().replace(/:/g, '_');
  const yRangeRef = useRef<[number, number] | null>(null);
  const xRangeRef = useRef<[number, number] | null>(null);

  // Latest values used by the long-lived event handlers.
  const dataRef = useRef<{ session: GuideSession; sessionIdx: number } | null>(null);
  const includeRangeRef = useRef(includeRange);
  const excludeRangeRef = useRef(excludeRange);
  useEffect(() => { includeRangeRef.current = includeRange; }, [includeRange]);
  useEffect(() => { excludeRangeRef.current = excludeRange; }, [excludeRange]);

  // Reset zoom on section change. When the user has the vertical scale lock
  // enabled (matches the desktop "lock vertical scale" feature), preserve the
  // y range so they can compare nights at the same scale.
  useEffect(() => {
    xRangeRef.current = null;
    if (!scaleLocked) yRangeRef.current = null;
  }, [sectionIdx, scaleLocked]);

  const data = useMemo(() => {
    if (!log || sectionIdx < 0) return null;
    const sec = log.sections[sectionIdx];
    if (!sec || sec.type !== 'GUIDING') return null;
    const session = log.sessions[sec.idx];
    const mask = exclusions.get(sec.idx);
    const hasAo = session.entries.some((e) => e.mount === 'AO');

    // Compute initial Y range so we know mass/snr scaling. We sample only the
    // entries that will actually be visible (filtered by device when AO is
    // present) and using the active coord mode.
    const visible = hasAo ? session.entries.filter((e) => e.mount === device) : session.entries;
    let maxErr = 0;
    const k = scaleMode === 'ARCSEC' ? session.pixelScale : 1;
    for (const e of visible) {
      const v = valuePair(e, coordMode);
      const a = Math.abs(v.x * k);
      const b = Math.abs(v.y * k);
      if (a > maxErr) maxErr = a;
      if (b > maxErr) maxErr = b;
    }
    const yMax = maxErr > 0 ? maxErr * 1.1 : 1;

    return {
      session,
      sessionIdx: sec.idx,
      hasAo,
      yMax,
      traces: buildTraces(session, traces, scaleMode, yMax, coordMode, device, hasAo),
      shapes: buildShapes(session, mask),
    };
  }, [log, sectionIdx, exclusions, scaleMode, traces, coordMode, device]);

  useEffect(() => {
    dataRef.current = data ? { session: data.session, sessionIdx: data.sessionIdx } : null;
  }, [data]);

  // Custom mouse-wheel: X zoom around cursor.
  useEffect(() => {
    const div = document.getElementById(plotId) as PlotDiv | null;
    if (!div) return;
    const onWheel = (e: WheelEvent) => {
      const xa = div._fullLayout?.xaxis;
      if (!xa) return;
      e.preventDefault();
      const rect = div.getBoundingClientRect();
      const px = e.clientX - rect.left - xa._offset;
      const xFrac = Math.min(1, Math.max(0, px / xa._length));
      const [x0, x1] = xa.range;
      const cursorX = x0 + xFrac * (x1 - x0);
      const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
      const newSpan = (x1 - x0) * factor;
      const newX0 = cursorX - xFrac * newSpan;
      const newX1 = newX0 + newSpan;
      void Plotly.relayout(plotId, { 'xaxis.range': [newX0, newX1] });
      xRangeRef.current = [newX0, newX1];
    };
    div.addEventListener('wheel', onWheel, { passive: false });
    return () => div.removeEventListener('wheel', onWheel);
  }, [plotId]);

  // Reset zoom event from context menu.
  useEffect(() => {
    const onReset = () => {
      void Plotly.relayout(plotId, { 'xaxis.autorange': true, 'yaxis.autorange': true });
      xRangeRef.current = null;
      yRangeRef.current = null;
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
      void Plotly.relayout(plotId, { 'yaxis.range': [-half, half] });
      yRangeRef.current = [-half, half];
    };
    window.addEventListener('phd-recenter-y', onRecenter);
    return () => window.removeEventListener('phd-recenter-y', onRecenter);
  }, [plotId]);

  // All custom drag gestures (Y zoom, include/exclude). Plotly's dragmode is
  // disabled — we own the drag entirely so there's no race between modifier
  // detection and Plotly's internal state.
  useEffect(() => {
    const div = document.getElementById(plotId) as PlotDiv | null;
    if (!div) return;
    div.style.position = 'relative';

    // Selection overlay band (shown for shift/ctrl drags).
    const overlay = document.createElement('div');
    overlay.style.cssText = [
      'position:absolute',
      'top:0',
      'bottom:0',
      'pointer-events:none',
      'display:none',
      'z-index:5',
      'border-style:solid',
      'border-width:1px',
    ].join(';');
    div.appendChild(overlay);

    const isInPlotArea = (e: MouseEvent): boolean => {
      const t = e.target as HTMLElement | null;
      return !!t?.closest('.nsewdrag, .bglayer, .draglayer');
    };

    type DragKind = 'Y_ZOOM' | 'X_INCLUDE' | 'X_EXCLUDE' | null;
    let kind: DragKind = null;
    let startClientY = 0;
    let startYRange: [number, number] = [0, 0];
    let yAnchor = 0;
    let yAnchorFrac = 0.5;
    let xStartFrac = 0;

    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      if (!isInPlotArea(e)) return;
      const xa = div._fullLayout?.xaxis;
      const ya = div._fullLayout?.yaxis;
      if (!xa || !ya) return;
      const rect = div.getBoundingClientRect();

      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        kind = e.shiftKey ? 'X_INCLUDE' : 'X_EXCLUDE';
        const px = e.clientX - rect.left - xa._offset;
        xStartFrac = Math.min(1, Math.max(0, px / xa._length));
        const isInclude = kind === 'X_INCLUDE';
        overlay.style.display = 'block';
        overlay.style.left = (xa._offset + xStartFrac * xa._length) + 'px';
        overlay.style.width = '0px';
        overlay.style.background = isInclude ? INCLUDE_FILL : EXCLUDE_FILL;
        overlay.style.borderColor = isInclude ? INCLUDE_BORDER : EXCLUDE_BORDER;
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      kind = 'Y_ZOOM';
      const py = e.clientY - rect.top - ya._offset;
      const frac = Math.min(1, Math.max(0, 1 - py / ya._length));
      const [y0, y1] = ya.range;
      yAnchor = y0 + frac * (y1 - y0);
      yAnchorFrac = frac;
      startClientY = e.clientY;
      startYRange = [y0, y1];
      e.preventDefault();
    };

    const onMove = (e: MouseEvent) => {
      if (!kind) return;
      const xa = div._fullLayout?.xaxis;
      if (!xa) return;

      if (kind === 'Y_ZOOM') {
        const dy = e.clientY - startClientY;
        const factor = Math.exp(dy / 200);
        const oldSpan = startYRange[1] - startYRange[0];
        const newSpan = oldSpan * factor;
        const newY0 = yAnchor - yAnchorFrac * newSpan;
        const newY1 = newY0 + newSpan;
        void Plotly.relayout(plotId, { 'yaxis.range': [newY0, newY1] });
        yRangeRef.current = [newY0, newY1];
        return;
      }

      // X selection: update the overlay width.
      const rect = div.getBoundingClientRect();
      const curPx = e.clientX - rect.left - xa._offset;
      const curFrac = Math.min(1, Math.max(0, curPx / xa._length));
      const a = Math.min(xStartFrac, curFrac);
      const b = Math.max(xStartFrac, curFrac);
      overlay.style.left = (xa._offset + a * xa._length) + 'px';
      overlay.style.width = ((b - a) * xa._length) + 'px';
    };

    const onUp = (e: MouseEvent) => {
      if (!kind) return;
      const xa = div._fullLayout?.xaxis;

      if (kind !== 'Y_ZOOM' && xa) {
        overlay.style.display = 'none';
        const rect = div.getBoundingClientRect();
        const endPx = e.clientX - rect.left - xa._offset;
        const endFrac = Math.min(1, Math.max(0, endPx / xa._length));
        const a = Math.min(xStartFrac, endFrac);
        const b = Math.max(xStartFrac, endFrac);
        if (b - a >= 0.005) {
          const [x0, x1] = xa.range;
          const tA = x0 + a * (x1 - x0);
          const tB = x0 + b * (x1 - x0);
          const ctx = dataRef.current;
          if (ctx) {
            const entries = ctx.session.entries;
            let firstFrame = -1, lastFrame = -1;
            for (const en of entries) {
              if (en.dt >= tA && en.dt <= tB) {
                if (firstFrame < 0) firstFrame = en.frame;
                lastFrame = en.frame;
              }
            }
            if (firstFrame >= 0) {
              const action = kind === 'X_INCLUDE' ? includeRangeRef.current : excludeRangeRef.current;
              action(
                ctx.sessionIdx,
                entries.length,
                firstFrame,
                lastFrame,
                entries.map((en) => en.frame),
              );
            }
          }
        }
      }

      kind = null;
    };

    div.addEventListener('mousedown', onDown, true);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp, true);
    return () => {
      div.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp, true);
      overlay.remove();
    };
  }, [plotId]);

  const onRelayout = useCallback((ev: Readonly<Record<string, unknown>>) => {
    const xr0 = ev['xaxis.range[0]'];
    const xr1 = ev['xaxis.range[1]'];
    if (typeof xr0 === 'number' && typeof xr1 === 'number') {
      xRangeRef.current = [xr0, xr1];
    }
    const yr0 = ev['yaxis.range[0]'];
    const yr1 = ev['yaxis.range[1]'];
    if (typeof yr0 === 'number' && typeof yr1 === 'number') {
      yRangeRef.current = [yr0, yr1];
    }
    if (ev['xaxis.autorange'] === true) xRangeRef.current = null;
    if (ev['yaxis.autorange'] === true) yRangeRef.current = null;
  }, []);

  if (!data) {
    return <div className="flex h-full items-center justify-center text-slate-500">Select a guiding section.</div>;
  }

  const yTitle = scaleMode === 'ARCSEC' ? 'arc-sec' : 'pixels';

  const layout: Partial<Layout> = {
    autosize: true,
    margin: { l: 60, r: 60, t: 20, b: 40 },
    paper_bgcolor: '#0f172a',
    plot_bgcolor: '#0f172a',
    font: { color: '#cbd5e1', size: 11 },
    xaxis: {
      title: { text: 'time (s)' }, gridcolor: '#1e293b', zerolinecolor: '#334155',
      fixedrange: true,
      ...(xRangeRef.current ? { range: xRangeRef.current } : { autorange: true }),
    },
    yaxis: {
      title: { text: yTitle }, gridcolor: '#1e293b',
      zerolinecolor: '#64748b', zerolinewidth: 1,
      fixedrange: true,
      ...(yRangeRef.current
        ? { range: yRangeRef.current }
        : { range: [-data.yMax, data.yMax] }),
    },
    shapes: data.shapes,
    showlegend: true,
    legend: { orientation: 'h', y: 1.1 },
    dragmode: false,
    barmode: 'overlay',
  };

  return (
    <Plot
      divId={plotId}
      data={data.traces}
      layout={layout}
      config={{ displayModeBar: false, responsive: true, scrollZoom: false, doubleClick: false }}
      style={{ width: '100%', height: '100%' }}
      useResizeHandler
      onRelayout={onRelayout as never}
    />
  );
}
