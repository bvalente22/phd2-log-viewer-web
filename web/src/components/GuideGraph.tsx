import { useMemo } from 'react';
import Plot from 'react-plotly.js';
import type { Data, Layout, Shape } from 'plotly.js';
import { useLogStore } from '../state/logStore';
import { useViewStore } from '../state/viewStore';
import type { GuideSession } from '../parser';

function buildTraces(s: GuideSession, mask: Uint8Array | undefined): Data[] {
  const t = s.entries.map((e) => e.dt);
  const ra = s.entries.map((e, i) => (mask?.[i] ? null : e.raraw));
  const dec = s.entries.map((e, i) => (mask?.[i] ? null : e.decraw));
  return [
    {
      x: t, y: ra, type: 'scattergl', mode: 'lines',
      name: 'RA', line: { color: '#60a5fa', width: 1 },
    } as Data,
    {
      x: t, y: dec, type: 'scattergl', mode: 'lines',
      name: 'Dec', line: { color: '#f87171', width: 1 },
    } as Data,
  ];
}

function buildShapes(s: GuideSession, mask: Uint8Array | undefined): Partial<Shape>[] {
  const shapes: Partial<Shape>[] = [];

  for (const info of s.infos) {
    const t = s.entries[info.idx]?.dt;
    if (t === undefined) continue;
    shapes.push({
      type: 'line', xref: 'x', yref: 'paper',
      x0: t, x1: t, y0: 0, y1: 1,
      line: { color: 'rgba(250, 204, 21, 0.4)', width: 1, dash: 'dot' },
    });
  }

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
          fillcolor: 'rgba(148, 163, 184, 0.18)',
          line: { width: 0 },
        });
        runStart = -1;
      }
    }
  }

  return shapes;
}

export function GuideGraph() {
  const log = useLogStore((s) => s.log);
  const sectionIdx = useLogStore((s) => s.selectedSection);
  const exclusions = useViewStore((s) => s.exclusions);
  const verticalMode = useViewStore((s) => s.verticalMode);

  const data = useMemo(() => {
    if (!log || sectionIdx < 0) return null;
    const sec = log.sections[sectionIdx];
    if (!sec || sec.type !== 'GUIDING') return null;
    const session = log.sessions[sec.idx];
    const mask = exclusions.get(sec.idx);
    return {
      traces: buildTraces(session, mask),
      shapes: buildShapes(session, mask),
      pixelScale: session.pixelScale,
    };
  }, [log, sectionIdx, exclusions]);

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
    },
    yaxis2: {
      title: { text: 'arc-sec' }, overlaying: 'y', side: 'right',
      showgrid: false,
    },
    shapes: data.shapes,
    showlegend: true,
    legend: { orientation: 'h', y: 1.1 },
    dragmode: 'pan',
  };

  return (
    <Plot
      data={data.traces}
      layout={layout}
      config={{ displaylogo: false, responsive: true, scrollZoom: true }}
      style={{ width: '100%', height: '100%' }}
      useResizeHandler
    />
  );
}
