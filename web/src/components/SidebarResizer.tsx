import { useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useViewStore,
  SIDEBAR_MIN,
  SIDEBAR_MAX,
  SIDEBAR_DEFAULT,
} from '../state/viewStore';

/**
 * Drag handle on the sidebar/main boundary (rendered right of the collapse
 * bar) that resizes the expanded sidebar. Uses pointer capture so the drag
 * keeps tracking when the cursor leaves the thin strip or the window. The
 * store clamps the width to [SIDEBAR_MIN, SIDEBAR_MAX]; double-click resets
 * to SIDEBAR_DEFAULT. Only mount this when the sidebar is expanded.
 */
export function SidebarResizer() {
  const { t } = useTranslation('common');
  const width = useViewStore((s) => s.sidebarWidth);
  const setWidth = useViewStore((s) => s.setSidebarWidth);
  // Drag origin captured on pointerdown; null when not dragging.
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      drag.current = { startX: e.clientX, startWidth: width };
      // setPointerCapture throws if the pointer isn't active (e.g. synthetic
      // events); the drag still works without capture, so don't let it abort.
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* no active pointer — proceed without capture */
      }
      // Suppress text selection across the whole page during the drag.
      document.body.style.userSelect = 'none';
    },
    [width],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const d = drag.current;
      if (!d) return;
      setWidth(d.startWidth + (e.clientX - d.startX));
    },
    [setWidth],
  );

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    document.body.style.userSelect = '';
  }, []);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={width}
      aria-valuemin={SIDEBAR_MIN}
      aria-valuemax={SIDEBAR_MAX}
      title={t('sidebar.resizeTooltip')}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={() => setWidth(SIDEBAR_DEFAULT)}
      className="w-1.5 flex-shrink-0 cursor-col-resize bg-slate-800 transition-colors hover:bg-sky-600/60"
    />
  );
}
