import { useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import Plot from 'react-plotly.js';
import type { Data, Layout } from 'plotly.js';
import type { SimpleSpikeRun } from '../parser/simpleSpikeAnalysis';
import { useViewStore } from '../state/viewStore';
import { themeOf } from '../themes';
import { useChartGestures } from './useChartGestures';

const RA_COLOR = '#60a5fa';
const DEC_COLOR = '#f87171';
const SPIKE_COLOR = '#f59e0b';
const THRESHOLD_LINE = 'rgba(245, 158, 11, 0.55)';

interface SimpleSpikeChartProps {
  run: SimpleSpikeRun;
  scaleMode: 'PIXELS' | 'ARCSEC';
}

/** Single-pane chart for the Simple Spikes tab. Shows the linearly-
 *  detrended axis trace plus amber dots on every sample whose |deviation|
 *  exceeds the 3σ threshold (with the user's direction filter applied).
 *  Dashed amber lines mark ±threshold so the cutoff is visible. */
export function SimpleSpikeChart({ run, scaleMode }: SimpleSpikeChartProps) {
  const { t: tChart } = useTranslation('chart');
  const { t } = useTranslation('analysis');
  const themeId = useViewStore((s) => s.theme);
  const tc = themeOf(themeId).plot;
  const id = useId().replace(/:/g, '_');

  // Same drag interface as the other charts — drag pans X and zooms Y
  // simultaneously; scroll-wheel zooms X. enableModifierSelect=false
  // because there's no include/exclude editing on this tab.
  useChartGestures(id, {}, { enableModifierSelect: false });

  const k = scaleMode === 'ARCSEC' ? run.pixelScale : 1;
  const unit = scaleMode === 'ARCSEC' ? '″' : 'px';
  const traceColor = run.axis === 'ra' ? RA_COLOR : DEC_COLOR;

  const traces = useMemo<Data[]>(() => {
    const ts = Array.from(run.t);
    // Plot detrended − median so the chart is centered on the
    // threshold lines (which are drawn at ±threshold from zero).
    const ys = Array.from(run.detrended).map((v) => (v - run.median) * k);
    const out: Data[] = [
      {
        x: ts, y: ys,
        type: 'scattergl', mode: 'lines',
        name: t('simpleSpike.detrended'),
        line: { color: traceColor, width: 1 },
      } as Data,
    ];
    if (run.spikeIndices.length > 0) {
      const xs = run.spikeIndices.map((i) => run.t[i]);
      const yp = run.spikeIndices.map((i) => (run.detrended[i] - run.median) * k);
      out.push({
        x: xs, y: yp,
        type: 'scattergl', mode: 'markers',
        name: t('simpleSpike.markers'),
        marker: {
          color: SPIKE_COLOR,
          size: 8,
          line: { width: 1, color: 'rgba(0,0,0,0.4)' },
        },
      } as Data);
    }
    return out;
  }, [run, k, t, traceColor]);

  const shapes = useMemo<NonNullable<Layout['shapes']>>(() => {
    const thr = run.threshold * k;
    return [
      {
        type: 'line', xref: 'paper', yref: 'y',
        x0: 0, x1: 1, y0: thr, y1: thr,
        line: { color: THRESHOLD_LINE, width: 1, dash: 'dash' },
      },
      {
        type: 'line', xref: 'paper', yref: 'y',
        x0: 0, x1: 1, y0: -thr, y1: -thr,
        line: { color: THRESHOLD_LINE, width: 1, dash: 'dash' },
      },
    ];
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
      // fixedrange disables Plotly's built-in scroll-zoom on Y so the
      // middle-wheel only zooms X. useChartGestures still drives drag-Y
      // zoom via Plotly.relayout, which bypasses fixedrange.
      fixedrange: true,
    },
    showlegend: true,
    legend: { orientation: 'h', y: 1.18 },
    dragmode: false,
    hovermode: 'x',
    shapes,
  };

  return (
    <div className="h-full">
      <Plot
        divId={id}
        data={traces}
        layout={layout}
        config={{ displayModeBar: false, responsive: true, scrollZoom: true, doubleClick: false }}
        style={{ width: '100%', height: '100%' }}
        useResizeHandler
      />
    </div>
  );
}
