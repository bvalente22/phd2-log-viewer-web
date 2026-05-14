import { useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import Plot from 'react-plotly.js';
import type { Data, Layout } from 'plotly.js';
import type { BltSequence } from '../parser/parseBlt';
import { useViewStore } from '../state/viewStore';
import { themeOf } from '../themes';
import { useChartGestures } from './useChartGestures';

/** App-palette colors for the BLT chart. The original C# tool uses
 *  red/green; we pick amber/cyan to avoid colliding with this app's
 *  RA-blue / Dec-red conventions used elsewhere. */
const NORTH_COLOR = '#fbbf24'; // amber-400
const SOUTH_COLOR = '#22d3ee'; // cyan-400
const PHASE_DIVIDER = 'rgba(148, 163, 184, 0.45)'; // slate-400 @ 45%

interface BltChartProps {
  sequence: BltSequence;
}

/** Dec offset vs step index for a single BLT run. Two traces:
 *  - North: amber dots+lines on X = 1..northCount
 *  - South: cyan dots+lines on X = northCount..northCount+southCount-1
 *  Plus a vertical dashed separator at the north→south transition. */
export function BltChart({ sequence }: BltChartProps) {
  const { t } = useTranslation('blt');
  const themeId = useViewStore((s) => s.theme);
  const tc = themeOf(themeId).plot;
  const id = useId().replace(/:/g, '_');

  // Match the other analysis charts: drag pans X + zooms Y (centered),
  // middle-wheel zooms X. No include/exclude editing on this tab.
  useChartGestures(id, {}, { enableModifierSelect: false });

  const traces = useMemo<Data[]>(() => {
    const nc = sequence.northPoints.length;
    const sc = sequence.southPoints.length;
    const northX = Array.from({ length: nc }, (_, i) => i + 1);
    const southX = Array.from({ length: sc }, (_, i) => i + nc); // continues from northX[end]
    return [
      {
        x: northX,
        y: Array.from(sequence.northPoints),
        type: 'scattergl', mode: 'lines+markers',
        name: t('north'),
        line: { color: NORTH_COLOR, width: 1.5 },
        marker: { color: NORTH_COLOR, size: 7 },
      } as Data,
      {
        x: southX,
        y: Array.from(sequence.southPoints),
        type: 'scattergl', mode: 'lines+markers',
        name: t('south'),
        line: { color: SOUTH_COLOR, width: 1.5 },
        marker: { color: SOUTH_COLOR, size: 7 },
      } as Data,
    ];
  }, [sequence, t]);

  const yRange = useMemo<[number, number] | undefined>(() => {
    const all = [...sequence.northPoints, ...sequence.southPoints];
    if (all.length === 0) return undefined;
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of all) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    // Spec says +2 headroom on top.
    return [lo, hi + 2];
  }, [sequence]);

  const phaseDivider = useMemo<NonNullable<Layout['shapes']>>(() => {
    const nc = sequence.northPoints.length;
    if (nc < 2) return [];
    return [
      {
        type: 'line', xref: 'x', yref: 'paper',
        x0: nc, x1: nc, y0: 0, y1: 1,
        line: { color: PHASE_DIVIDER, width: 1, dash: 'dot' },
      },
    ];
  }, [sequence]);

  const layout: Partial<Layout> = {
    autosize: true,
    margin: { l: 60, r: 30, t: 20, b: 40 },
    paper_bgcolor: tc.paper,
    plot_bgcolor: tc.plot,
    font: { color: tc.font, size: 11 },
    // Re-keyed per sequence so switching runs in the left list resets the
    // auto-fit y-range; within a single run, pan/zoom state is preserved
    // across re-renders (e.g. theme changes).
    uirevision: `blt-${sequence.timestamp || sequence.northPoints.length}`,
    xaxis: {
      title: { text: t('xAxis') },
      gridcolor: tc.grid,
      zerolinecolor: tc.zeroline,
      fixedrange: false,
      // Always-on vertical-cursor spike on hover (theme-aware color).
      showspikes: true,
      spikemode: 'across',
      spikethickness: 1.5,
      spikedash: 'solid',
      spikecolor: tc.hoverSpike,
      spikesnap: 'cursor',
    },
    yaxis: {
      title: { text: t('yAxis') },
      gridcolor: tc.grid,
      zerolinecolor: tc.zerolineStrong,
      zerolinewidth: 1,
      range: yRange,
      // fixedrange disables Plotly's built-in scroll-zoom on Y so the
      // middle-wheel only zooms X. useChartGestures still drives drag-Y
      // zoom via Plotly.relayout, which bypasses fixedrange.
      fixedrange: true,
    },
    showlegend: true,
    legend: { orientation: 'h', y: 1.18 },
    dragmode: false,
    // `hovermode:'x'` activates the xaxis spike line on hover (without
    // it, `showspikes:true` is a no-op).
    hovermode: 'x',
    shapes: phaseDivider,
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
