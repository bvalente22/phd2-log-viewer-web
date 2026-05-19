import { useCallback, useEffect, useId, useMemo } from 'react';
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
// Live threshold preview line — solid cyan so it visually ties to the
// (cyan) selected-point markers; thicker than the dotted ±3σ context
// lines so it reads as "the action you're about to take" rather than
// background reference.
const THRESHOLD_LINE = '#22d3ee';

/** Click vs drag threshold (pixels). pointerdown→up moves shorter than
 *  this count as a click; longer ones are part of a drag and go through
 *  useChartGestures only. */
const CLICK_PX_TOLERANCE = 5;

interface ManualSpikeChartProps {
  run: ManualSpikeRun;
  scaleMode: 'PIXELS' | 'ARCSEC';
  selectedIndices: ReadonlyArray<number>;
  onAddPoint: (index: number) => void;
  onRemovePoint: (index: number) => void;
  /** Live preview line for the auto-select slider (in arc-seconds; the
   *  chart converts to its current display unit). Null = no line. */
  thresholdLineArc: number | null;
}

/** Manual Spike chart. Renders the linearly-detrended axis trace plus
 *  cyan markers on every user-selected sample. Left-click on the chart
 *  adds the nearest sample to the selection; right-click removes the
 *  nearest currently-selected sample. Same drag/scroll gestures as the
 *  Simple tab (drag = X pan + Y zoom, scroll = X zoom only).
 *
 *  Click handling notes:
 *  - We can't use Plotly's `plotly_click` event because useChartGestures
 *    calls preventDefault on pointerdown to suppress Plotly's own drag
 *    handling — most browsers then suppress the synthesized click event,
 *    so Plotly's onClick never fires. Instead we track pointerdown→up
 *    distance ourselves and treat short ones as clicks.
 *  - Right-click goes through the contextmenu event (which still fires
 *    independently) with preventDefault to suppress the browser menu.
 *  - We also pin a stable `uirevision` on the layout so re-renders
 *    triggered by add/remove don't reset the user's pan/zoom. */
export function ManualSpikeChart({
  run, scaleMode, selectedIndices, onAddPoint, onRemovePoint, thresholdLineArc,
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

  /** Convert a click event to data coordinates and find the nearest
   *  sample. Distance is computed in PIXEL space (Plotly's `l2p` and
   *  `p2d` round-trip) so X/Y are weighted equally regardless of the
   *  user's current zoom. `candidates` is either the full sample range
   *  (left-click — add the nearest data point) or the current selection
   *  (right-click — remove the nearest selected point). */
  const findNearest = useCallback((
    e: MouseEvent,
    candidates: 'all' | 'selected',
  ): number | null => {
    const div = document.getElementById(id) as HTMLDivElement | null;
    if (!div) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const layout = (div as any)._fullLayout;
    const xa = layout?.xaxis;
    const ya = layout?.yaxis;
    if (!xa || !ya) return null;
    const rect = div.getBoundingClientRect();
    // Click position in plot-area pixels (relative to the plot box origin).
    const clickPxX = e.clientX - rect.left - xa._offset;
    const clickPxY = e.clientY - rect.top - ya._offset;

    const indices: number[] = candidates === 'all'
      ? Array.from({ length: run.t.length }, (_, i) => i)
      : Array.from(selectedIndices);
    if (indices.length === 0) return null;

    let best = -1;
    let bestDist = Infinity;
    for (const i of indices) {
      const samplePxX = xa.l2p(run.t[i]);
      const samplePxY = ya.l2p((run.detrended[i] - run.median) * k);
      const dx = samplePxX - clickPxX;
      const dy = samplePxY - clickPxY;
      const d = dx * dx + dy * dy;
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  }, [id, run, k, selectedIndices]);

  /** Pointerdown→up tracking: short pointerups count as clicks. The
   *  contextmenu event handles right-click independently. We listen on
   *  the plot div with capture=true so we see events even though
   *  useChartGestures has called stopPropagation (stopPropagation
   *  doesn't stop other listeners on the same element, only propagation
   *  to other elements). */
  useEffect(() => {
    const div = document.getElementById(id) as HTMLDivElement | null;
    if (!div) return;
    let downX = 0;
    let downY = 0;
    let downBtn = -1;
    let downActive = false;

    const onDown = (e: PointerEvent) => {
      downX = e.clientX;
      downY = e.clientY;
      downBtn = e.button;
      downActive = true;
    };
    const onUp = (e: PointerEvent) => {
      if (!downActive) return;
      downActive = false;
      if (e.button !== downBtn) return;
      const dx = e.clientX - downX;
      const dy = e.clientY - downY;
      if (dx * dx + dy * dy > CLICK_PX_TOLERANCE * CLICK_PX_TOLERANCE) return;
      // Short pointerup at the same button — treat as a click.
      if (e.button === 0) {
        const idx = findNearest(e, 'all');
        if (idx !== null) onAddPoint(idx);
      }
      // Right-click is handled by the contextmenu event below; we don't
      // remove from the selection here because the contextmenu handler
      // owns preventDefault for the browser menu.
    };
    const onCancel = () => {
      downActive = false;
    };

    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const idx = findNearest(e, 'selected');
      if (idx !== null) onRemovePoint(idx);
    };

    div.addEventListener('pointerdown', onDown, true);
    div.addEventListener('pointerup', onUp, true);
    div.addEventListener('pointercancel', onCancel, true);
    div.addEventListener('contextmenu', onContextMenu, true);
    return () => {
      div.removeEventListener('pointerdown', onDown, true);
      div.removeEventListener('pointerup', onUp, true);
      div.removeEventListener('pointercancel', onCancel, true);
      div.removeEventListener('contextmenu', onContextMenu, true);
    };
  }, [id, findNearest, onAddPoint, onRemovePoint]);

  const traces = useMemo<Data[]>(() => {
    const ts = Array.from(run.t);
    const ys = Array.from(run.detrended).map((v) => (v - run.median) * k);
    const out: Data[] = [
      {
        x: ts, y: ys,
        type: 'scattergl', mode: 'lines',
        name: t('manualSpike.detrended'),
        line: { color: traceColor, width: 1 },
        hovertemplate: `t=%{x:.2f}s · y=%{y:.2f}${unit}<extra></extra>`,
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
        hovertemplate: `${t('manualSpike.selectedHover')}<br>t=%{x:.2f}s · y=%{y:.2f}${unit}<extra></extra>`,
      } as Data);
    }
    return out;
  }, [run, k, t, traceColor, selectedIndices, unit]);

  const shapes = useMemo<NonNullable<Layout['shapes']>>(() => {
    const s = run.sigma * k;
    const out: NonNullable<Layout['shapes']> = [3, -3].map((m) => ({
      type: 'line', xref: 'paper', yref: 'y',
      x0: 0, x1: 1, y0: m * s, y1: m * s,
      line: { color: SIGMA_LINE, width: 1, dash: 'dot' },
    }));
    if (thresholdLineArc !== null && Number.isFinite(thresholdLineArc)) {
      // Slider value is always arc-sec. In PIXELS scale, convert to px.
      const y = scaleMode === 'ARCSEC' ? thresholdLineArc : thresholdLineArc / run.pixelScale;
      out.push({
        type: 'line', xref: 'paper', yref: 'y',
        x0: 0, x1: 1, y0: y, y1: y,
        line: { color: THRESHOLD_LINE, width: 2, dash: 'dash' },
      });
    }
    return out;
  }, [run, k, scaleMode, thresholdLineArc]);

  const layout: Partial<Layout> = {
    autosize: true,
    margin: { l: 60, r: 30, t: 20, b: 40 },
    paper_bgcolor: tc.paper,
    plot_bgcolor: tc.plot,
    font: { color: tc.font, size: 11 },
    // uirevision pinned to the axis (and scaleMode, since scale changes
    // re-derive the y values) so add/remove re-renders preserve the
    // user's pan/zoom. Switching axes intentionally clears the zoom
    // (different value range altogether).
    uirevision: `manual-${run.axis}-${scaleMode}`,
    xaxis: {
      title: { text: tChart('axes.time') },
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
      title: { text: unit },
      gridcolor: tc.grid,
      zerolinecolor: tc.zerolineStrong,
      zerolinewidth: 1,
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
