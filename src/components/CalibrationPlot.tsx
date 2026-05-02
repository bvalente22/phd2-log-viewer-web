import { useMemo } from 'react';
import Plot from 'react-plotly.js';
import type { Data, Layout, Shape } from 'plotly.js';
import { useLogStore } from '../state/logStore';
import type { Calibration, CalibrationEntry, CalDirection } from '../parser';

const RA_COLOR = '#60a5fa';
const RA_DARK = '#1d4ed8';
const DEC_COLOR = '#f87171';
const DEC_DARK = '#991b1b';

const COLORS: Record<CalDirection, string> = {
  WEST: RA_COLOR,
  EAST: RA_DARK,
  NORTH: DEC_COLOR,
  SOUTH: DEC_DARK,
  BACKLASH: DEC_DARK,
};

const LETTER: Record<CalDirection, string> = {
  WEST: 'W', EAST: 'E', NORTH: 'N', SOUTH: 'S', BACKLASH: 'B',
};

function findRange(entries: CalibrationEntry[], dir: CalDirection): [number, number] | null {
  let first = -1, last = -1;
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].direction === dir) {
      if (first < 0) first = i;
      last = i;
    }
  }
  return first >= 0 && last > first ? [first, last] : null;
}

function buildTraces(cal: Calibration): Data[] {
  const groups = new Map<CalDirection, CalibrationEntry[]>();
  for (const e of cal.entries) {
    if (!groups.has(e.direction)) groups.set(e.direction, []);
    groups.get(e.direction)!.push(e);
  }

  const traces: Data[] = [];
  for (const [dir, items] of groups) {
    traces.push({
      x: items.map((e) => e.dx),
      y: items.map((e) => e.dy),
      type: 'scatter',
      mode: 'text+markers',
      name: `${dir} (${items.length})`,
      marker: { color: COLORS[dir], size: 10, line: { color: '#0f172a', width: 1 } },
      text: items.map((e) => `${LETTER[dir]}${e.step}`),
      textposition: 'top right',
      textfont: { color: COLORS[dir], size: 10 },
      customdata: items.map((e) => [dir, e.step]),
      hovertemplate: '%{customdata[0]} step %{customdata[1]}<br>dx=%{x:.3f} · dy=%{y:.3f}<extra></extra>',
    } as Data);
  }
  return traces;
}

function buildAxisShapes(cal: Calibration): Partial<Shape>[] {
  const shapes: Partial<Shape>[] = [];
  const ws = findRange(cal.entries, 'WEST');
  if (ws) {
    const a = cal.entries[ws[0]], b = cal.entries[ws[1]];
    shapes.push({
      type: 'line', xref: 'x', yref: 'y',
      x0: a.dx, y0: a.dy, x1: b.dx, y1: b.dy,
      line: { color: RA_COLOR, width: 2 },
    });
  }
  const ns = findRange(cal.entries, 'NORTH');
  if (ns) {
    const a = cal.entries[ns[0]], b = cal.entries[ns[1]];
    shapes.push({
      type: 'line', xref: 'x', yref: 'y',
      x0: a.dx, y0: a.dy, x1: b.dx, y1: b.dy,
      line: { color: DEC_COLOR, width: 2 },
    });
  }
  // Reference circles at 5,10,15,20,25 px (matches LogViewFrame.cpp:1389-1397).
  for (const r of [5, 10, 15, 20, 25]) {
    shapes.push({
      type: 'circle', xref: 'x', yref: 'y',
      x0: -r, y0: -r, x1: r, y1: r,
      line: { color: 'rgba(148,163,184,0.25)', width: 1, dash: 'dot' },
    });
  }
  // Origin crosshair (matches LogViewFrame.cpp:1377-1379).
  shapes.push({
    type: 'line', xref: 'x', yref: 'y',
    x0: -1.5, y0: 0, x1: 1.5, y1: 0,
    line: { color: '#94a3b8', width: 1.5 },
  });
  shapes.push({
    type: 'line', xref: 'x', yref: 'y',
    x0: 0, y0: -1.5, x1: 0, y1: 1.5,
    line: { color: '#94a3b8', width: 1.5 },
  });
  return shapes;
}

const fmt = (n: number, d = 2) => Number.isFinite(n) ? n.toFixed(d) : '—';
const fmtAngle = (rad: number) => `${fmt((rad * 180) / Math.PI, 1)}°`;

export function CalibrationPlot() {
  const log = useLogStore((s) => s.log);
  const sectionIdx = useLogStore((s) => s.selectedSection);

  const data = useMemo(() => {
    if (!log || sectionIdx < 0) return null;
    const sec = log.sections[sectionIdx];
    if (!sec || sec.type !== 'CALIBRATION') return null;
    const cal = log.calibrations[sec.idx];
    return {
      cal,
      traces: buildTraces(cal),
      shapes: buildAxisShapes(cal),
    };
  }, [log, sectionIdx]);

  if (!data) return null;

  // Auto-range: pick widest extent and add some padding
  const xs = data.cal.entries.map((e) => e.dx);
  const ys = data.cal.entries.map((e) => e.dy);
  const maxAbs = Math.max(5, ...xs.map(Math.abs), ...ys.map(Math.abs)) * 1.15;

  const layout: Partial<Layout> = {
    autosize: true,
    margin: { l: 50, r: 30, t: 30, b: 40 },
    paper_bgcolor: '#0f172a',
    plot_bgcolor: '#0f172a',
    font: { color: '#cbd5e1', size: 11 },
    xaxis: {
      title: { text: 'dx (px)' },
      gridcolor: '#1e293b', zerolinecolor: '#475569',
      range: [-maxAbs, maxAbs],
      scaleanchor: 'y', scaleratio: 1,
    },
    yaxis: {
      title: { text: 'dy (px)' },
      gridcolor: '#1e293b', zerolinecolor: '#475569',
      range: [-maxAbs, maxAbs],
    },
    shapes: data.shapes,
    showlegend: true,
    legend: { orientation: 'h', y: 1.08 },
    dragmode: 'pan',
  };

  // The parser keeps the calibration header lines as raw text; pull rate/angle
  // out of them on the fly. Lines look like:
  //   Mount = "Name", xAngle = 0.0, xRate = 5.0, yAngle = 1.5708, yRate = 5.0
  const mountLine = data.cal.hdr.find((l) => l.startsWith('Mount = ') || l.startsWith('AO = ')) ?? '';
  const pullAfter = (key: string): number | null => {
    const i = mountLine.indexOf(key);
    if (i < 0) return null;
    const tail = mountLine.slice(i + key.length);
    const v = parseFloat(tail);
    return Number.isFinite(v) ? v : null;
  };
  const xRate = pullAfter(', xRate = ');
  const yRate = pullAfter(', yRate = ');
  const xAngle = pullAfter(', xAngle = ');
  const yAngle = pullAfter(', yAngle = ');

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-800 px-3 py-1 text-xs text-slate-400">
        <span>Calibration · {data.cal.device}</span>
        <span>{data.cal.entries.length} steps</span>
        <span className="text-slate-500">{data.cal.date}</span>
        {xRate !== null && (
          <span>xRate <span className="font-mono text-slate-200">{fmt(xRate)}</span> px/s</span>
        )}
        {yRate !== null && (
          <span>yRate <span className="font-mono text-slate-200">{fmt(yRate)}</span> px/s</span>
        )}
        {xAngle !== null && (
          <span>xAngle <span className="font-mono text-slate-200">{fmtAngle(xAngle)}</span></span>
        )}
        {yAngle !== null && (
          <span>yAngle <span className="font-mono text-slate-200">{fmtAngle(yAngle)}</span></span>
        )}
      </div>
      <div className="flex-1">
        <Plot
          data={data.traces}
          layout={layout}
          config={{ displaylogo: false, responsive: true }}
          style={{ width: '100%', height: '100%' }}
          useResizeHandler
        />
      </div>
    </div>
  );
}
