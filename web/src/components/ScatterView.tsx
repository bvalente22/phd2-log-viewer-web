import { useMemo } from 'react';
import Plot from 'react-plotly.js';
import type { Data, Layout, Shape } from 'plotly.js';
import { useLogStore } from '../state/logStore';
import { useViewStore } from '../state/viewStore';
import { calcStats } from '../parser';
import type { GuideSession } from '../parser';
import { themeOf } from '../themes';

const RA_COLOR = '#60a5fa';
const DEC_COLOR = '#f87171';

function ellipseShape(s: GuideSession, mask: Uint8Array | undefined, k: number): Partial<Shape>[] {
  const stats = calcStats(s, mask);
  const e = stats.ellipse;
  if (!e || !Number.isFinite(e.lx) || !Number.isFinite(e.ly) || e.lx === 0) return [];
  // Mean of the included population.
  const meanRa = stats.meanRa * k;
  const meanDec = stats.meanDec * k;
  const lx = e.lx * k;
  const ly = e.ly * k;
  // Plotly's `circle`/`ellipse` shape draws an axis-aligned ellipse from a
  // bounding box. We don't have a way to rotate it natively, so emit a path.
  const cos = Math.cos(e.theta);
  const sin = Math.sin(e.theta);
  const N = 64;
  const pts: string[] = [];
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * 2 * Math.PI;
    const x = lx * Math.cos(t);
    const y = ly * Math.sin(t);
    const rx = meanRa + x * cos - y * sin;
    const ry = meanDec + x * sin + y * cos;
    pts.push(`${i === 0 ? 'M' : 'L'}${rx},${ry}`);
  }
  return [
    {
      type: 'path', xref: 'x', yref: 'y',
      path: pts.join(' ') + 'Z',
      line: { color: '#a3e635', width: 1.5, dash: 'dash' },
      fillcolor: 'rgba(163, 230, 53, 0.06)',
    } as Partial<Shape>,
  ];
}

export function ScatterView() {
  const log = useLogStore((s) => s.log);
  const sectionIdx = useLogStore((s) => s.selectedSection);
  const exclusions = useViewStore((s) => s.exclusions);
  const scaleMode = useViewStore((s) => s.scaleMode);
  const themeId = useViewStore((s) => s.theme);
  const device = useViewStore((s) => s.device);

  const data = useMemo(() => {
    if (!log || sectionIdx < 0) return null;
    const sec = log.sections[sectionIdx];
    if (!sec || sec.type !== 'GUIDING') return null;
    const session = log.sessions[sec.idx];
    const mask = exclusions.get(sec.idx);
    const k = scaleMode === 'ARCSEC' ? session.pixelScale : 1;
    // For sessions with AO data, only show frames from the selected device.
    // Mount-only sessions have no AO entries, so the filter passes everything.
    const hasAo = session.entries.some((e) => e.mount === 'AO');

    const incX: number[] = [];
    const incY: number[] = [];
    const incFrame: number[] = [];
    const incTime: number[] = [];
    const exX: number[] = [];
    const exY: number[] = [];

    for (let i = 0; i < session.entries.length; i++) {
      const e = session.entries[i];
      if (hasAo && e.mount !== device) continue;
      // Scatter view always uses RA/Dec axes (matches the desktop). The Dec
      // negation here matches LogViewFrame.cpp's chart convention where
      // positive Dec = up.
      const x = e.raraw * k;
      const y = -e.decraw * k;
      const isExcluded = !e.included || mask?.[i] === 1;
      if (isExcluded) {
        exX.push(x);
        exY.push(y);
      } else {
        incX.push(x);
        incY.push(y);
        incFrame.push(e.frame);
        incTime.push(e.dt);
      }
    }

    const traces: Data[] = [
      {
        x: incX, y: incY,
        type: 'scattergl', mode: 'markers',
        name: `Included (${incX.length})`,
        marker: {
          color: incTime,
          colorscale: [[0, RA_COLOR], [1, DEC_COLOR]],
          showscale: false,
          size: 5,
          opacity: 0.65,
        },
        customdata: incFrame.map((f, i) => [f, incTime[i]]),
        hovertemplate: 'frame %{customdata[0]} · t=%{customdata[1]:.2f}s<br>RA=%{x:.2f} · Dec=%{y:.2f}<extra></extra>',
      } as Data,
    ];
    if (exX.length > 0) {
      traces.push({
        x: exX, y: exY,
        type: 'scattergl', mode: 'markers',
        name: `Excluded (${exX.length})`,
        marker: { color: 'rgba(148, 163, 184, 0.35)', size: 4, symbol: 'x' },
        hoverinfo: 'skip',
      } as Data);
    }

    // Range that covers all points symmetrically.
    let maxAbs = 0;
    for (const v of [...incX, ...incY, ...exX, ...exY]) {
      if (Math.abs(v) > maxAbs) maxAbs = Math.abs(v);
    }
    const range = (maxAbs > 0 ? maxAbs : 1) * 1.1;

    const shapes = [
      // Crosshair through origin.
      { type: 'line', xref: 'x', yref: 'y', x0: -range, x1: range, y0: 0, y1: 0,
        line: { color: 'rgba(148, 163, 184, 0.3)', width: 1 } } as Partial<Shape>,
      { type: 'line', xref: 'x', yref: 'y', x0: 0, x1: 0, y0: -range, y1: range,
        line: { color: 'rgba(148, 163, 184, 0.3)', width: 1 } } as Partial<Shape>,
      ...ellipseShape(session, mask, k),
    ];

    return { traces, shapes, range, k };
  }, [log, sectionIdx, exclusions, scaleMode, device]);

  if (!data) {
    return <div className="flex h-full items-center justify-center text-slate-500">Select a guiding section.</div>;
  }

  const unit = scaleMode === 'ARCSEC' ? 'arc-sec' : 'pixels';
  const tc = themeOf(themeId).plot;
  const layout: Partial<Layout> = {
    autosize: true,
    margin: { l: 60, r: 30, t: 20, b: 50 },
    paper_bgcolor: tc.paper,
    plot_bgcolor: tc.plot,
    font: { color: tc.font, size: 11 },
    xaxis: {
      title: { text: `RA (${unit})` }, gridcolor: tc.grid, zerolinecolor: tc.zerolineStrong,
      range: [-data.range, data.range],
      scaleanchor: 'y', scaleratio: 1,
    },
    yaxis: {
      title: { text: `Dec (${unit})` }, gridcolor: tc.grid, zerolinecolor: tc.zerolineStrong,
      range: [-data.range, data.range],
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
      config={{ displayModeBar: false, responsive: true, scrollZoom: true }}
      style={{ width: '100%', height: '100%' }}
      useResizeHandler
    />
  );
}
