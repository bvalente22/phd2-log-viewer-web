import { useCallback, useEffect, useId, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import Plot from 'react-plotly.js';
import type { Data, Layout } from 'plotly.js';
import type { ManualSpikeRun } from '../parser/manualSpikeAnalysis';
import { useViewStore } from '../state/viewStore';
import { themeOf } from '../themes';
import { useChartGestures } from './useChartGestures';

const RA_COLOR = '#60a5fa';
const DEC_COLOR = '#f87171';
const SELECTED_COLOR = '#22d3ee'; // cyan — pops against blue/red
const SIGMA_LINE = 'rgba(245, 158, 11, 0.4)';

interface ManualSpikeChartProps {
  run: ManualSpikeRun;
  scaleMode: 'PIXELS' | 'ARCSEC';
  selectedIndices: ReadonlyArray<number>;
  onAddPoint: (index: number) => void;
  onRemovePoint: (index: number) => void;
}

/** Manual Spike chart. Renders the linearly-detrended axis trace plus
 *  cyan markers on every user-selected sample. Left-click on the chart
 *  adds the nearest sample to the selection; right-click removes the
 *  nearest currently-selected sample. Same drag/scroll gestures as the
 *  Simple tab (drag = X pan + Y zoom, scroll = X zoom only). */
export function ManualSpikeChart({
  run, scaleMode, selectedIndices, onAddPoint, onRemovePoint,
}: ManualSpikeChartProps) {
  const { t: tChart } = useTranslation('chart');
  const { t } = useTranslation('analysis');
  const themeId = useViewStore((s) => s.theme);
  const tc = themeOf(themeId).plot;
  const id = useId().replace(/:/g, '_');

  useChartGestures(id, {}, { enableModifierSelect: false });

  const k = scaleMode === 'ARCSEC' ? run.pixelScale : 1;
  const unit = scaleMode === 'ARCSEC' ? '″' : 'px';
  const traceColor = run.axis === 'ra' ? RA_COLOR : DEC_COLOR;

  /** Closest-point lookup. Plotly's onClick gives us the nearest data
   *  point from any visible trace; we use it for left-click. For
   *  right-click we need to do the lookup ourselves against the
   *  current selection set. */
  const findNearestSelectedIndex = useCallback((x: number, y: number): number | null => {
    if (selectedIndices.length === 0) return null;
    // Distance in pixel-equivalent units: use the data X span as the
    // X normalization so X distances dominate over Y (selected points
    // are spread along time).
    let best = -1;
    let bestDist = Infinity;
    for (const i of selectedIndices) {
      const dx = run.t[i] - x;
      const dy = (run.detrended[i] - run.median) * k - y;
      const d = dx * dx + dy * dy * 1e6; // weight Y so it's not ignored
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  }, [selectedIndices, run, k]);

  // Right-click handler — convert the click position to data coordinates
  // and remove the nearest selected sample. Plotly doesn't expose a
  // contextmenu event on its own, so we attach to the plot div directly.
  const plotDivRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const div = document.getElementById(id) as HTMLDivElement | null;
    plotDivRef.current = div;
    if (!div) return;
    const handler = (e: MouseEvent) => {
      e.preventDefault();
      // Plotly stores axes on _fullLayout; xaxis/yaxis have p2d().
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const layout = (div as any)._fullLayout;
      if (!layout) return;
      const xa = layout.xaxis;
      const ya = layout.yaxis;
      if (!xa || !ya) return;
      const rect = div.getBoundingClientRect();
      // Plotly's axis offsets are relative to the plot div; subtract
      // the div origin from the client click position.
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const dataX = xa.p2d(px - xa._offset);
      const dataY = ya.p2d(py - ya._offset);
      const idx = findNearestSelectedIndex(dataX, dataY);
      if (idx !== null) onRemovePoint(idx);
    };
    div.addEventListener('contextmenu', handler);
    return () => div.removeEventListener('contextmenu', handler);
  }, [id, findNearestSelectedIndex, onRemovePoint]);

  const traces = useMemo<Data[]>(() => {
    const ts = Array.from(run.t);
    const ys = Array.from(run.detrended).map((v) => (v - run.median) * k);
    const out: Data[] = [
      // Background trace (line).
      {
        x: ts, y: ys,
        type: 'scattergl', mode: 'lines',
        name: t('manualSpike.detrended'),
        line: { color: traceColor, width: 1 },
      } as Data,
      // Hidden marker overlay — invisible markers covering every
      // sample, so Plotly's onClick has a hit target on every point.
      // mode 'markers' with size 0 markers won't catch clicks; use
      // a small transparent marker.
      {
        x: ts, y: ys,
        type: 'scattergl', mode: 'markers',
        name: t('manualSpike.clickTarget'),
        marker: { color: 'rgba(0,0,0,0.001)', size: 8 },
        showlegend: false,
        hoverinfo: 'skip',
      } as Data,
    ];
    if (selectedIndices.length > 0) {
      const xs = selectedIndices.map((i) => run.t[i]);
      const yp = selectedIndices.map((i) => (run.detrended[i] - run.median) * k);
      out.push({
        x: xs, y: yp,
        type: 'scattergl', mode: 'markers',
        name: t('manualSpike.selected'),
        marker: {
          color: SELECTED_COLOR,
          size: 12,
          line: { width: 2, color: 'rgba(0,0,0,0.5)' },
        },
        hovertemplate: `${t('manualSpike.selectedHover')}<br>t=%{x:.1f}s · y=%{y:.3f}${unit}<extra></extra>`,
      } as Data);
    }
    return out;
  }, [run, k, t, traceColor, selectedIndices, unit]);

  const sigmaShapes = useMemo<NonNullable<Layout['shapes']>>(() => {
    const s = run.sigma * k;
    return [3, -3].map((m) => ({
      type: 'line', xref: 'paper', yref: 'y',
      x0: 0, x1: 1, y0: m * s, y1: m * s,
      line: { color: SIGMA_LINE, width: 1, dash: 'dot' },
    }));
  }, [run, k]);

  const layout: Partial<Layout> = {
    autosize: true,
    margin: { l: 60, r: 30, t: 20, b: 40 },
    paper_bgcolor: tc.paper,
    plot_bgcolor: tc.plot,
    font: { color: tc.font, size: 11 },
    xaxis: {
      title: { text: tChart('axes.time') },
      gridcolor: tc.grid,
      zerolinecolor: tc.zeroline,
      fixedrange: false,
    },
    yaxis: {
      title: { text: unit },
      gridcolor: tc.grid,
      zerolinecolor: tc.zerolineStrong,
      zerolinewidth: 1,
      // Same as Simple tab — disable scroll-zoom on Y so the wheel only
      // affects X. Drag-Y still works through useChartGestures.
      fixedrange: true,
    },
    showlegend: true,
    legend: { orientation: 'h', y: 1.18 },
    dragmode: false,
    hovermode: 'closest',
    shapes: sigmaShapes,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onClick = useCallback((ev: any) => {
    // Plotly's plotly_click — ev.points[0].pointIndex is the array
    // index into the trace's x/y data. The click-target overlay trace
    // has the same indexing as the main trace, so pointIndex is the
    // sample index regardless of which trace caught the click.
    const p = ev?.points?.[0];
    if (!p || typeof p.pointIndex !== 'number') return;
    onAddPoint(p.pointIndex);
  }, [onAddPoint]);

  return (
    <div className="h-full">
      <Plot
        divId={id}
        data={traces}
        layout={layout}
        config={{ displayModeBar: false, responsive: true, scrollZoom: true, doubleClick: false }}
        style={{ width: '100%', height: '100%' }}
        useResizeHandler
        onClick={onClick}
      />
    </div>
  );
}
