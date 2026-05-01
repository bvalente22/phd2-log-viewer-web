import { useMemo, useCallback } from 'react';
import Plot from 'react-plotly.js';
import type { Data, Layout, Shape } from 'plotly.js';
import { useLogStore } from '../state/logStore';
import { useViewStore } from '../state/viewStore';
import type { GuideSession } from '../parser';

interface PlotSelectionEvent {
  range?: { x?: [number, number] };
  points?: unknown[];
}

const RA_COLOR = '#60a5fa';
const DEC_COLOR = '#f87171';
const PULSE_RA = '#3b82f6';
const PULSE_DEC = '#dc2626';
const MASS_COLOR = '#a78bfa';
const SNR_COLOR = '#34d399';

function buildTraces(s: GuideSession, mask: Uint8Array | undefined, traces: ReturnType<typeof useViewStore.getState>['traces']): Data[] {
  const t = s.entries.map((e) => e.dt);
  const out: Data[] = [];

  const masked = (i: number) => mask?.[i] === 1;
  const gateNum = (vals: number[]) => vals.map((v, i) => (masked(i) ? null : v));

  if (traces.ra) {
    out.push({
      x: t, y: gateNum(s.entries.map((e) => e.raraw)),
      type: 'scattergl', mode: 'lines',
      name: 'RA', line: { color: RA_COLOR, width: 1 },
    } as Data);
  }
  if (traces.dec) {
    out.push({
      x: t, y: gateNum(s.entries.map((e) => e.decraw)),
      type: 'scattergl', mode: 'lines',
      name: 'Dec', line: { color: DEC_COLOR, width: 1 },
    } as Data);
  }
  if (traces.raPulses) {
    out.push({
      x: t, y: gateNum(s.entries.map((e) => e.radur)),
      type: 'bar',
      name: 'RA pulse',
      marker: { color: PULSE_RA, opacity: 0.5 },
      yaxis: 'y3',
    } as Data);
  }
  if (traces.decPulses) {
    out.push({
      x: t, y: gateNum(s.entries.map((e) => e.decdur)),
      type: 'bar',
      name: 'Dec pulse',
      marker: { color: PULSE_DEC, opacity: 0.5 },
      yaxis: 'y3',
    } as Data);
  }
  if (traces.mass) {
    out.push({
      x: t, y: gateNum(s.entries.map((e) => e.mass)),
      type: 'scattergl', mode: 'lines',
      name: 'Mass', line: { color: MASS_COLOR, width: 1, dash: 'dot' },
      yaxis: 'y4',
    } as Data);
  }
  if (traces.snr) {
    out.push({
      x: t, y: gateNum(s.entries.map((e) => e.snr)),
      type: 'scattergl', mode: 'lines',
      name: 'SNR', line: { color: SNR_COLOR, width: 1, dash: 'dot' },
      yaxis: 'y4',
    } as Data);
  }
  return out;
}

function buildShapes(s: GuideSession, mask: Uint8Array | undefined): Partial<Shape>[] {
  const shapes: Partial<Shape>[] = [];

  // exclusion overlay rectangles first (so info markers draw on top)
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
          fillcolor: 'rgba(251, 146, 60, 0.20)',
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
  const verticalMode = useViewStore((s) => s.verticalMode);
  const traces = useViewStore((s) => s.traces);
  const excludeRange = useViewStore((s) => s.excludeRange);
  const includeAll = useViewStore((s) => s.includeAll);

  const data = useMemo(() => {
    if (!log || sectionIdx < 0) return null;
    const sec = log.sections[sectionIdx];
    if (!sec || sec.type !== 'GUIDING') return null;
    const session = log.sessions[sec.idx];
    const mask = exclusions.get(sec.idx);
    return {
      session,
      sessionIdx: sec.idx,
      traces: buildTraces(session, mask, traces),
      shapes: buildShapes(session, mask),
    };
  }, [log, sectionIdx, exclusions, traces]);

  const onSelected = useCallback((ev: PlotSelectionEvent) => {
    if (!data) return;
    const xrange = ev?.range?.x;
    if (!xrange) return;
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
    excludeRange(
      data.sessionIdx,
      entries.length,
      firstFrame,
      lastFrame,
      entries.map((e) => e.frame),
    );
  }, [data, excludeRange]);

  const onDoubleClick = useCallback(() => {
    if (!data) return;
    includeAll(data.sessionIdx, data.session.entries.length);
  }, [data, includeAll]);

  if (!data) {
    return <div className="flex h-full items-center justify-center text-slate-500">Select a guiding section.</div>;
  }

  const layout: Partial<Layout> = {
    autosize: true,
    margin: { l: 50, r: 60, t: 20, b: 40 },
    paper_bgcolor: '#0f172a',
    plot_bgcolor: '#0f172a',
    font: { color: '#cbd5e1', size: 11 },
    xaxis: { title: { text: 'time (s)' }, gridcolor: '#1e293b', zerolinecolor: '#334155' },
    yaxis: {
      title: { text: 'pixels' }, gridcolor: '#1e293b', zerolinecolor: '#334155',
      fixedrange: verticalMode === 'PAN',
      domain: [0, 1],
    },
    yaxis2: {
      title: { text: 'arc-sec' }, overlaying: 'y', side: 'right',
      showgrid: false,
    },
    yaxis3: {
      overlaying: 'y', side: 'right', position: 0.97,
      showgrid: false, showticklabels: false, title: { text: '' },
    },
    yaxis4: {
      overlaying: 'y', side: 'right', anchor: 'free', position: 1.0,
      showgrid: false, showticklabels: false, title: { text: '' },
    },
    shapes: data.shapes,
    showlegend: true,
    legend: { orientation: 'h', y: 1.1 },
    dragmode: 'select',
    selectdirection: 'h',
  };

  return (
    <Plot
      data={data.traces}
      layout={layout}
      config={{ displaylogo: false, responsive: true, scrollZoom: true }}
      style={{ width: '100%', height: '100%' }}
      useResizeHandler
      onSelected={onSelected as never}
      onDoubleClick={onDoubleClick}
    />
  );
}
