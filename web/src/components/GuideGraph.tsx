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

interface PlotSelectionEvent {
  range?: { x?: [number, number]; y?: [number, number] };
  points?: unknown[];
}

const RA_COLOR = '#60a5fa';
const DEC_COLOR = '#f87171';
const PULSE_RA = '#3b82f6';
const PULSE_DEC = '#dc2626';
const MASS_COLOR = '#a78bfa';
const SNR_COLOR = '#34d399';

type Traces = ReturnType<typeof useViewStore.getState>['traces'];
type ScaleMode = ReturnType<typeof useViewStore.getState>['scaleMode'];

function buildTraces(s: GuideSession, traces: Traces, scaleMode: ScaleMode): Data[] {
  const t = s.entries.map((e) => e.dt);
  const out: Data[] = [];
  const k = scaleMode === 'ARCSEC' ? s.pixelScale : 1;

  let maxErr = 0;
  for (const e of s.entries) {
    const a = Math.abs(e.raraw * k);
    const b = Math.abs(e.decraw * k);
    if (a > maxErr) maxErr = a;
    if (b > maxErr) maxErr = b;
  }
  let maxPulse = 0;
  for (const e of s.entries) {
    const a = Math.abs(e.radur);
    const b = Math.abs(e.decdur);
    if (a > maxPulse) maxPulse = a;
    if (b > maxPulse) maxPulse = b;
  }
  const pulseScale = maxPulse > 0 && maxErr > 0 ? (maxErr * 0.5) / maxPulse : 0;

  if (traces.ra) {
    out.push({
      x: t, y: s.entries.map((e) => e.raraw * k),
      type: 'scattergl', mode: 'lines',
      name: 'RA', line: { color: RA_COLOR, width: 1 },
    } as Data);
  }
  if (traces.dec) {
    out.push({
      x: t, y: s.entries.map((e) => e.decraw * k),
      type: 'scattergl', mode: 'lines',
      name: 'Dec', line: { color: DEC_COLOR, width: 1 },
    } as Data);
  }
  if (traces.raPulses) {
    out.push({
      x: t,
      y: s.entries.map((e) => e.radur * pulseScale),
      customdata: s.entries.map((e) => e.radur),
      type: 'bar',
      name: 'RA pulse',
      marker: { color: PULSE_RA, opacity: 0.55 },
      hovertemplate: 'RA pulse: %{customdata} ms<extra></extra>',
    } as Data);
  }
  if (traces.decPulses) {
    out.push({
      x: t,
      y: s.entries.map((e) => e.decdur * pulseScale),
      customdata: s.entries.map((e) => e.decdur),
      type: 'bar',
      name: 'Dec pulse',
      marker: { color: PULSE_DEC, opacity: 0.55 },
      hovertemplate: 'Dec pulse: %{customdata} ms<extra></extra>',
    } as Data);
  }
  if (traces.mass) {
    out.push({
      x: t, y: s.entries.map((e) => e.mass),
      type: 'scattergl', mode: 'lines',
      name: 'Mass', line: { color: MASS_COLOR, width: 1, dash: 'dot' },
      yaxis: 'y4',
    } as Data);
  }
  if (traces.snr) {
    out.push({
      x: t, y: s.entries.map((e) => e.snr),
      type: 'scattergl', mode: 'lines',
      name: 'SNR', line: { color: SNR_COLOR, width: 1, dash: 'dot' },
      yaxis: 'y5',
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
  const excludeRange = useViewStore((s) => s.excludeRange);
  const includeRange = useViewStore((s) => s.includeRange);

  const plotId = useId().replace(/:/g, '_');
  const yRangeRef = useRef<[number, number] | null>(null);
  const xRangeRef = useRef<[number, number] | null>(null);
  const shiftHeldRef = useRef(false);
  const ctrlHeldRef = useRef(false);
  const dragModeRef = useRef<'zoom' | 'select'>('zoom');

  // Reset the saved zoom when the section changes.
  useEffect(() => {
    xRangeRef.current = null;
    yRangeRef.current = null;
  }, [sectionIdx]);

  // Track Shift/Ctrl, and swap Plotly dragmode while one is held so that
  // shift/ctrl + drag does horizontal selection (for include/exclude) and
  // plain drag stays in zoom mode (for Y zoom).
  useEffect(() => {
    const setMode = (next: 'zoom' | 'select') => {
      if (dragModeRef.current === next) return;
      dragModeRef.current = next;
      const patch = next === 'select'
        ? { dragmode: 'select', selectdirection: 'h' }
        : { dragmode: 'zoom' };
      void Plotly.relayout(plotId, patch);
    };
    const sync = (e: KeyboardEvent | MouseEvent) => {
      shiftHeldRef.current = e.shiftKey;
      ctrlHeldRef.current = e.ctrlKey || ('metaKey' in e && e.metaKey);
      setMode(shiftHeldRef.current || ctrlHeldRef.current ? 'select' : 'zoom');
    };
    window.addEventListener('keydown', sync);
    window.addEventListener('keyup', sync);
    window.addEventListener('mousedown', sync, true);
    window.addEventListener('mouseup', sync, true);
    return () => {
      window.removeEventListener('keydown', sync);
      window.removeEventListener('keyup', sync);
      window.removeEventListener('mousedown', sync, true);
      window.removeEventListener('mouseup', sync, true);
    };
  }, [plotId]);

  // Custom mouse-wheel handler: zoom X around the cursor position. Plotly's
  // built-in scrollZoom would zoom both axes; we want X-only.
  useEffect(() => {
    const div = document.getElementById(plotId) as
      | (HTMLDivElement & { _fullLayout?: { xaxis?: { _offset: number; _length: number; range: [number, number] } } })
      | null;
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

  // Listen for the "reset zoom" event dispatched by the context menu.
  useEffect(() => {
    const onReset = () => {
      void Plotly.relayout(plotId, { 'xaxis.autorange': true, 'yaxis.autorange': true });
      xRangeRef.current = null;
      yRangeRef.current = null;
    };
    window.addEventListener('phd-reset-zoom', onReset);
    return () => window.removeEventListener('phd-reset-zoom', onReset);
  }, [plotId]);

  const data = useMemo(() => {
    if (!log || sectionIdx < 0) return null;
    const sec = log.sections[sectionIdx];
    if (!sec || sec.type !== 'GUIDING') return null;
    const session = log.sessions[sec.idx];
    const mask = exclusions.get(sec.idx);
    return {
      session,
      sessionIdx: sec.idx,
      traces: buildTraces(session, traces, scaleMode),
      shapes: buildShapes(session, mask),
    };
  }, [log, sectionIdx, exclusions, scaleMode, traces]);

  const onSelected = useCallback((ev: PlotSelectionEvent) => {
    if (!data) return;
    const xrange = ev?.range?.x;
    if (!xrange) return;
    if (!shiftHeldRef.current && !ctrlHeldRef.current) return;
    const action = shiftHeldRef.current ? includeRange : excludeRange;
    const [t0, t1] = xrange;
    const entries = data.session.entries;
    const lo = Math.min(t0, t1);
    const hi = Math.max(t0, t1);
    let firstFrame = -1, lastFrame = -1;
    for (const e of entries) {
      if (e.dt >= lo && e.dt <= hi) {
        if (firstFrame < 0) firstFrame = e.frame;
        lastFrame = e.frame;
      }
    }
    if (firstFrame < 0) return;
    action(
      data.sessionIdx,
      entries.length,
      firstFrame,
      lastFrame,
      entries.map((e) => e.frame),
    );
  }, [data, excludeRange, includeRange]);

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

  const session = data.session;
  const massVals = session.entries.map((e) => e.mass).filter((v) => v > 0);
  const snrVals = session.entries.map((e) => e.snr).filter((v) => v > 0);
  const massMax = massVals.length ? Math.max(...massVals) * 1.1 : 1;
  const snrMax = snrVals.length ? Math.max(...snrVals) * 1.1 : 1;

  const layout: Partial<Layout> = {
    autosize: true,
    margin: { l: 60, r: 60, t: 20, b: 40 },
    paper_bgcolor: '#0f172a',
    plot_bgcolor: '#0f172a',
    font: { color: '#cbd5e1', size: 11 },
    xaxis: {
      title: { text: 'time (s)' }, gridcolor: '#1e293b', zerolinecolor: '#334155',
      // Drag-zoom is locked to Y by setting xaxis.fixedrange. The custom
      // wheel handler above is what handles X zoom.
      fixedrange: true,
      ...(xRangeRef.current ? { range: xRangeRef.current } : { autorange: true }),
    },
    yaxis: {
      title: { text: yTitle }, gridcolor: '#1e293b',
      zerolinecolor: '#64748b', zerolinewidth: 1,
      fixedrange: false,
      ...(yRangeRef.current ? { range: yRangeRef.current } : { autorange: true }),
    },
    yaxis4: {
      overlaying: 'y', side: 'right',
      showgrid: false,
      title: { text: 'mass', standoff: 4, font: { color: MASS_COLOR } },
      tickfont: { color: MASS_COLOR },
      range: [0, massMax],
      fixedrange: true,
    },
    yaxis5: {
      overlaying: 'y', side: 'right', anchor: 'free', position: 1.0,
      showgrid: false,
      title: { text: 'SNR', standoff: 4, font: { color: SNR_COLOR } },
      tickfont: { color: SNR_COLOR },
      range: [0, snrMax],
      fixedrange: true,
    },
    shapes: data.shapes,
    showlegend: true,
    legend: { orientation: 'h', y: 1.1 },
    dragmode: dragModeRef.current,
    selectdirection: 'h',
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
      onSelected={onSelected as never}
      onRelayout={onRelayout as never}
    />
  );
}
