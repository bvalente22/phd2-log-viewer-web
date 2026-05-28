import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Small click-to-open popover for the chart toolbar's secondary controls.
 * Hand-rolled (the app has no popover dependency, and adding one would trip
 * the auto-merge dependency policy): the panel floats over the chart,
 * anchored to the toolbar's right edge, and closes on Escape or an outside
 * pointerdown. `children` are the panel contents — the caller supplies the
 * grouped ToggleChips. The trigger stays mounted so its `ms-auto` position
 * is stable whether the panel is open or closed.
 */
export function ToolbarPopover({
  label,
  title,
  children,
}: {
  label: ReactNode;
  title?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={title}
        aria-haspopup="true"
        aria-expanded={open}
        className={`rounded border px-2 py-0.5 text-xs transition-colors ${
          open
            ? 'border-slate-600 bg-slate-700 text-slate-100'
            : 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700'
        }`}
      >
        {label}
      </button>
      {open && (
        <div
          role="group"
          className="absolute end-0 z-20 mt-1 flex w-max max-w-[min(90vw,34rem)] flex-wrap items-center gap-2 rounded border border-slate-700 bg-slate-900 p-3 text-xs shadow-lg"
        >
          {children}
        </div>
      )}
    </div>
  );
}
