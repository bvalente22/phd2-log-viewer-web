import { useId, useMemo, useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import Plot from 'react-plotly.js';
import type { Data, Layout } from 'plotly.js';
import type { SpikeRun } from '../parser/spikeAnalysis';
import { alignedEventIndices } from '../parser/spikeAnalysis';
import { useChartGestures } from './useChartGestures';
import { useAnalysisStore } from '../state/analysisStore';
import { useViewStore } from '../state/viewStore';
import { themeOf } from '../themes';

const RA_COLOR = '#60a5fa';
const DEC_COLOR = '#f87171';
const SPIKE_MARKER = '#f59e0b';        // amber — pops against both blue and red
// Aligned-event highlight — a brighter cyan that contrasts hard
// against the amber default so the user can see at a glance which
// events the periodogram peak under their cursor was built from.
const ALIGNED_MARKER = '#22d3ee';
const THRESHOLD_LINE = 'rgba(245, 158, 11, 0.55)';

interface SpikeChartProps {
  run: SpikeRun;
  scaleMode: 'PIXELS' | 'ARCSEC';
}

const formatClock = (startsMs: number | null, dt: number): string => {
  if (startsMs === null) return '—';
  const t = new Date(startsMs + dt * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:${pad(t.getUTCSeconds())}`;
};

/**
 * Timeline chart for spike mode. Renders the drift-corrected RA (or
 * Dec) series with:
 *   - the trace itself in the per-axis color (sky for RA, rose for Dec)
 *   - dashed horizontal lines at ±threshold (k * sigma_robust above and
 *     below the median) so the user can see the cutoff visually
 *   - amber dots on the samples that exceeded the threshold
 *
 * Hover readout mirrors the DriftChart's: time + clock + Y. Drag-pan X
 * persistence routes through the same `driftXRangeView` field on the
 * analysis store as DriftChart, so switching tabs (or just re-rendering
 * on hover) preserves the pan.
 */
export function SpikeChart({ run, scaleMode }: SpikeChartProps) {
  const { t: tChart } = useTranslation('chart');
  const { t } = useTranslation('analysis');
  const plotId = useId().replace(/:/g, '_');
  const [hover, setHover] = useState<string | null>(null);
  const themeId = useViewStore((s) => s.theme);
  const driftXRangeView = useAnalysisStore((s) =>
    s.state === 'open' ? s.driftXRangeView : null,
  );
  const setDriftXRange = useAnalysisStore((s) => s.setDriftXRange);
  // Hovered period from the periodogram. When non-null we render a
  // second marker layer in cyan over the events that align with that
  // period — the user gets a direct visual link from "this peak in
  // the periodogram" to "these spike events on the timeline".
  const hoverPeriod = useAnalysisStore((s) =>
    s.state === 'open' ? s.spikeHoverPeriod : null,
  );

  const k = scaleMode === 'ARCSEC' ? run.pixelScale : 1;
  const unit = scaleMode === 'ARCSEC' ? '″' : 'px';
  const traceColor = run.axis === 'ra' ? RA_COLOR : DEC_COLOR;

  const traces = useMemo<Data[]>(() => {
    const ts = Array.from(run.t);
    const vs = Array.from(run.values).map((v) => v * k);
    const out: Data[] = [
      {
        x: ts, y: vs,
        type: 'scattergl', mode: 'lines',
        name: run.axis === 'ra' ? 'RA' : 'Dec',
        line: { color: traceColor, width: 1.5 },
      } as Data,
    ];
    // Spike markers — overlay scatter at the spike sample positions.
    const spikeXs: number[] = [];
    const spikeYs: number[] = [];
    for (let i = 0; i < run.spikeMask.length; i++) {
      if (run.spikeMask[i] === 1) {
        spikeXs.push(run.t[i]);
        spikeYs.push(run.values[i] * k);
      }
    }
    if (spikeXs.length > 0) {
      out.push({
        x: spikeXs, y: spikeYs,
        type: 'scattergl', mode: 'markers',
        name: t('spike.markers'),
        marker: { color: SPIKE_MARKER, size: 8, line: { width: 1, color: 'rgba(0,0,0,0.4)' } },
        hovertemplate: `${t('spike.spikeHover')}<br>t=%{x:.1f}s · y=%{y:.3f}${unit}<extra></extra>`,
      } as Data);
    }
    // Overlay layer: events that phase-align with the hovered
    // periodogram peak. Drawn as larger cyan ring markers so the
    // user can see "these are the events the peak under your
    // cursor was built from". Only present when the user is
    // hovering the periodogram in spike mode.
    if (hoverPeriod !== null && run.events.length > 0) {
      const aligned = alignedEventIndices(run.events, hoverPeriod);
      if (aligned.length > 0) {
        out.push({
          x: aligned.map((i) => run.events[i].t),
          y: aligned.map((i) => run.events[i].value * k),
          type: 'scattergl', mode: 'markers',
          name: t('spike.alignedHighlight', { count: aligned.length, period: hoverPeriod.toFixed(1) }),
          marker: {
            color: 'rgba(34, 211, 238, 0.0)',           // hollow center
            size: 14,
            line: { width: 2.5, color: ALIGNED_MARKER }, // ring
          },
          hovertemplate: `${t('spike.alignedHover', { period: hoverPeriod.toFixed(1) })}<br>t=%{x:.1f}s · y=%{y:.3f}${unit}<extra></extra>`,
        } as Data);
      }
    }
    return out;
  }, [run, k, t, traceColor, unit, hoverPeriod]);

  const yRange = useMemo<[number, number]>(() => {
    // Stretch enough to show both the thresholds and the spike peaks
    // even when the trace y values are tiny.
    const m = run.median * k;
    const t = run.threshold * k;
    const lo = Math.min(run.valueMin * k, m - t * 1.2);
    const hi = Math.max(run.valueMax * k, m + t * 1.2);
    const pad = (hi - lo) * 0.05;
    return [lo - pad, hi + pad];
  }, [run, k]);

  const xExtent = useMemo<[number, number]>(() => {
    if (run.t.length < 2) return [0, 1];
    return [run.t[0], run.t[run.t.length - 1]];
  }, [run]);

  useChartGestures(plotId, {}, { enableModifierSelect: false });

  // Capture x-range changes (from useChartGestures or scroll-zoom) into
  // the store so hover-induced re-renders don't snap pan back. Same
  // pattern as DriftChart.
  const onRelayout = useCallback((ev: Readonly<Record<string, unknown>>) => {
    let lo: number | undefined;
    let hi: number | undefined;
    const x0 = ev['xaxis.range[0]'];
    const x1 = ev['xaxis.range[1]'];
    const xrange = ev['xaxis.range'];
    if (typeof x0 === 'number' && typeof x1 === 'number') {
      lo = x0; hi = x1;
    } else if (Array.isArray(xrange) && xrange.length >= 2) {
      const a = xrange[0]; const b = xrange[1];
      if (typeof a === 'number' && typeof b === 'number') { lo = a; hi = b; }
    }
    if (lo !== undefined && hi !== undefined && Number.isFinite(lo) && Number.isFinite(hi)) {
      setDriftXRange([lo, hi]);
    } else if (ev['xaxis.autorange'] === true) {
      setDriftXRange(null);
    }
  }, [setDriftXRange]);

  const onHover = useCallback((ev: { points?: Array<{ x?: number; y?: number }> }) => {
    const x = ev.points?.[0]?.x;
    const y = ev.points?.[0]?.y;
    if (typeof x !== 'number' || typeof y !== 'number') return;
    const yPx = scaleMode === 'ARCSEC' ? y / run.pixelScale : y;
    const yArc = scaleMode === 'ARCSEC' ? y : y * run.pixelScale;
    setHover(
      `Time: ${x.toFixed(1)}s  ${formatClock(run.starts, x)}    Y: ${yArc.toFixed(2)}″ (${yPx.toFixed(2)}px)`
    );
  }, [run, scaleMode]);

  // Quiet the unused-variable warning for `unit` when scaleMode is PIXELS.
  useEffect(() => { void unit; }, [unit]);

  const tc = themeOf(themeId).plot;
  const layout: Partial<Layout> = {
    autosize: true,
    margin: { l: 60, r: 30, t: 10, b: 30 },
    paper_bgcolor: tc.paper,
    plot_bgcolor: tc.plot,
    font: { color: tc.font, size: 11 },
    xaxis: {
      title: { text: tChart('axes.time') }, gridcolor: tc.grid, zerolinecolor: tc.zeroline,
      fixedrange: false,
      range: driftXRangeView ?? xExtent,
    },
    yaxis: {
      title: { text: unit }, gridcolor: tc.grid, zerolinecolor: tc.zerolineStrong,
      zerolinewidth: 1, fixedrange: true, range: yRange,
    },
    showlegend: true,
    legend: { orientation: 'h', y: 1.1 },
    dragmode: false,
    hovermode: 'x',
    // Threshold lines as Plotly shapes — drawn relative to the data
    // y-coordinate so they scale with the user's chosen units (px/arcsec).
    shapes: [
      {
        type: 'line', xref: 'paper', yref: 'y',
        x0: 0, x1: 1,
        y0: (run.median + run.threshold) * k, y1: (run.median + run.threshold) * k,
        line: { color: THRESHOLD_LINE, width: 1, dash: 'dash' },
      },
      {
        type: 'line', xref: 'paper', yref: 'y',
        x0: 0, x1: 1,
        y0: (run.median - run.threshold) * k, y1: (run.median - run.threshold) * k,
        line: { color: THRESHOLD_LINE, width: 1, dash: 'dash' },
      },
    ],
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1">
        <Plot
          divId={plotId}
          data={traces}
          layout={layout}
          config={{ displayModeBar: false, responsive: true, scrollZoom: true, doubleClick: false }}
          style={{ width: '100%', height: '100%' }}
          useResizeHandler
          onHover={onHover as never}
          onUnhover={() => setHover(null)}
          onRelayout={onRelayout as never}
        />
      </div>
      <div className="border-t border-slate-800 bg-slate-900/40 px-3 py-1 font-mono text-[11px] text-slate-300 min-h-[24px]">
        {hover ?? ' '}
      </div>
    </div>
  );
}
