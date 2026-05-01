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
      name: dir,
      marker: { color: COLORS[dir], size: 10, line: { color: '#0f172a', width: 1 } },
      text: items.map((e) => `${LETTER[dir]}${e.step}`),
      textposition: 'top right',
      textfont: { color: COLORS[dir], size: 10 },
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
  // Reference circles at 5,10,15,20,25 px
  for (const r of [5, 10, 15, 20, 25]) {
    shapes.push({
      type: 'circle', xref: 'x', yref: 'y',
      x0: -r, y0: -r, x1: r, y1: r,
      line: { color: 'rgba(148,163,184,0.25)', width: 1, dash: 'dot' },
    });
  }
  return shapes;
}

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

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-slate-800 px-3 py-1 text-xs text-slate-400">
        <span>Calibration · {data.cal.device}</span>
        <span>{data.cal.entries.length} steps</span>
        <span className="text-slate-500">{data.cal.date}</span>
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
