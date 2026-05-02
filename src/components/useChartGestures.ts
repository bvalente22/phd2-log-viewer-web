import { useEffect } from 'react';
// @ts-expect-error -- no types for the dist bundle; we only call relayout.
import Plotly from 'plotly.js/dist/plotly';

interface PlotDiv extends HTMLDivElement {
  _fullLayout?: {
    xaxis?: { _offset: number; _length: number; range: [number, number] };
    yaxis?: { _offset: number; _length: number; range: [number, number] };
  };
}

const INCLUDE_FILL = 'rgba(34, 197, 94, 0.18)';
const INCLUDE_BORDER = 'rgba(34, 197, 94, 0.7)';
const EXCLUDE_FILL = 'rgba(251, 146, 60, 0.18)';
const EXCLUDE_BORDER = 'rgba(251, 146, 60, 0.7)';

export interface ChartGestureCallbacks {
  /** Called when the user shift-drags a horizontal range. Frames passed are mount-frame numbers. */
  onIncludeRange?: (frameLo: number, frameHi: number) => void;
  /** Called when the user ctrl/cmd-drags a horizontal range. */
  onExcludeRange?: (frameLo: number, frameHi: number) => void;
  /** Called whenever the X or Y range changes (drag-pan, Y-zoom). */
  onRangeChange?: (axis: 'x' | 'y', range: [number, number]) => void;
  /** Provides frames + dt-mapping for the include/exclude callbacks. */
  rangeContext?: () => { frames: number[]; dts: number[] } | null;
}

export interface ChartGestureOptions {
  enableModifierSelect?: boolean; // default true
  hideRangeSliderDuringDrag?: boolean; // default false
}

/**
 * Drag-driven chart gestures shared between the main GuideGraph and the
 * Analysis modal's two charts:
 *   - Plain drag = X pan + continuous Y zoom anchored on the cursor's data Y.
 *   - Shift+drag = horizontal include selection (callback only).
 *   - Ctrl/Cmd+drag = horizontal exclude selection (callback only).
 *   - Wheel zoom is provided by Plotly's built-in scrollZoom; not handled here.
 *
 * rAF-throttles relayouts and (optionally) hides an attached rangeslider
 * during the drag for performance.
 */
export function useChartGestures(
  plotId: string,
  callbacks: ChartGestureCallbacks,
  opts: ChartGestureOptions = {},
) {
  const enableModifierSelect = opts.enableModifierSelect ?? true;
  const hideSlider = opts.hideRangeSliderDuringDrag ?? false;

  useEffect(() => {
    const div = document.getElementById(plotId) as PlotDiv | null;
    if (!div) return;
    div.style.position = 'relative';

    const overlay = document.createElement('div');
    overlay.style.cssText = [
      'position:absolute',
      'top:0',
      'bottom:0',
      'pointer-events:none',
      'display:none',
      'z-index:5',
      'border-style:solid',
      'border-width:1px',
    ].join(';');
    div.appendChild(overlay);

    const isInPlotArea = (e: MouseEvent): boolean => {
      const t = e.target as HTMLElement | null;
      return !!t?.closest('.nsewdrag, .bglayer, .draglayer');
    };

    let rafId: number | null = null;
    let pendingPatch: Record<string, [number, number]> | null = null;
    const queueRelayout = (patch: Record<string, [number, number]>) => {
      pendingPatch = pendingPatch ? { ...pendingPatch, ...patch } : { ...patch };
      if (rafId == null) {
        rafId = requestAnimationFrame(() => {
          if (pendingPatch) void Plotly.relayout(plotId, pendingPatch);
          pendingPatch = null;
          rafId = null;
        });
      }
    };

    type DragKind = 'PAN_ZOOM' | 'X_INCLUDE' | 'X_EXCLUDE' | null;
    let kind: DragKind = null;
    let startClientX = 0;
    let startClientY = 0;
    let startYRange: [number, number] = [0, 0];
    let startXRange: [number, number] = [0, 0];
    let yAnchor = 0;
    let yAnchorFrac = 0.5;
    let xStartFrac = 0;
    let sliderHidden = false;

    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      if (!isInPlotArea(e)) return;
      const xa = div._fullLayout?.xaxis;
      const ya = div._fullLayout?.yaxis;
      if (!xa || !ya) return;
      const rect = div.getBoundingClientRect();

      if (enableModifierSelect && (e.shiftKey || e.ctrlKey || e.metaKey)) {
        kind = e.shiftKey ? 'X_INCLUDE' : 'X_EXCLUDE';
        const px = e.clientX - rect.left - xa._offset;
        xStartFrac = Math.min(1, Math.max(0, px / xa._length));
        const isInclude = kind === 'X_INCLUDE';
        overlay.style.display = 'block';
        overlay.style.left = (xa._offset + xStartFrac * xa._length) + 'px';
        overlay.style.width = '0px';
        overlay.style.background = isInclude ? INCLUDE_FILL : EXCLUDE_FILL;
        overlay.style.borderColor = isInclude ? INCLUDE_BORDER : EXCLUDE_BORDER;
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      kind = 'PAN_ZOOM';
      const py = e.clientY - rect.top - ya._offset;
      const frac = Math.min(1, Math.max(0, 1 - py / ya._length));
      const [y0, y1] = ya.range;
      yAnchor = y0 + frac * (y1 - y0);
      yAnchorFrac = frac;
      startClientX = e.clientX;
      startClientY = e.clientY;
      startYRange = [y0, y1];
      startXRange = [...xa.range] as [number, number];
      if (hideSlider) {
        void Plotly.relayout(plotId, { 'xaxis.rangeslider.visible': false });
        sliderHidden = true;
      }
      e.preventDefault();
    };

    const onMove = (e: MouseEvent) => {
      if (!kind) return;
      const xa = div._fullLayout?.xaxis;
      if (!xa) return;
      if (kind === 'PAN_ZOOM') {
        const dy = e.clientY - startClientY;
        const factor = Math.exp(dy / 200);
        const oldYSpan = startYRange[1] - startYRange[0];
        const newYSpan = oldYSpan * factor;
        const newY0 = yAnchor - yAnchorFrac * newYSpan;
        const newY1 = newY0 + newYSpan;
        const dx = e.clientX - startClientX;
        const xSpan = startXRange[1] - startXRange[0];
        const dxData = (dx / xa._length) * xSpan;
        const newX0 = startXRange[0] - dxData;
        const newX1 = startXRange[1] - dxData;
        queueRelayout({
          'yaxis.range': [newY0, newY1],
          'xaxis.range': [newX0, newX1],
        });
        callbacks.onRangeChange?.('x', [newX0, newX1]);
        callbacks.onRangeChange?.('y', [newY0, newY1]);
        return;
      }
      const rect = div.getBoundingClientRect();
      const curPx = e.clientX - rect.left - xa._offset;
      const curFrac = Math.min(1, Math.max(0, curPx / xa._length));
      const a = Math.min(xStartFrac, curFrac);
      const b = Math.max(xStartFrac, curFrac);
      overlay.style.left = (xa._offset + a * xa._length) + 'px';
      overlay.style.width = ((b - a) * xa._length) + 'px';
    };

    const onUp = (e: MouseEvent) => {
      if (!kind) return;
      const xa = div._fullLayout?.xaxis;

      if (kind !== 'PAN_ZOOM' && xa && callbacks.rangeContext) {
        overlay.style.display = 'none';
        const rect = div.getBoundingClientRect();
        const endPx = e.clientX - rect.left - xa._offset;
        const endFrac = Math.min(1, Math.max(0, endPx / xa._length));
        const a = Math.min(xStartFrac, endFrac);
        const b = Math.max(xStartFrac, endFrac);
        if (b - a >= 0.005) {
          const [x0, x1] = xa.range;
          const tA = x0 + a * (x1 - x0);
          const tB = x0 + b * (x1 - x0);
          const ctx = callbacks.rangeContext();
          if (ctx) {
            let firstFrame = -1, lastFrame = -1;
            for (let i = 0; i < ctx.dts.length; i++) {
              if (ctx.dts[i] >= tA && ctx.dts[i] <= tB) {
                if (firstFrame < 0) firstFrame = ctx.frames[i];
                lastFrame = ctx.frames[i];
              }
            }
            if (firstFrame >= 0) {
              if (kind === 'X_INCLUDE') callbacks.onIncludeRange?.(firstFrame, lastFrame);
              else callbacks.onExcludeRange?.(firstFrame, lastFrame);
            }
          }
        }
      }

      if (rafId != null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      const finalPatch: Record<string, unknown> = pendingPatch ?? {};
      pendingPatch = null;
      if (sliderHidden) {
        finalPatch['xaxis.rangeslider.visible'] = true;
        sliderHidden = false;
      }
      if (Object.keys(finalPatch).length > 0) {
        void Plotly.relayout(plotId, finalPatch);
      }

      kind = null;
    };

    div.addEventListener('mousedown', onDown, true);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp, true);
    return () => {
      div.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp, true);
      overlay.remove();
      if (rafId != null) cancelAnimationFrame(rafId);
    };
  }, [plotId, enableModifierSelect, hideSlider, callbacks]);
}
