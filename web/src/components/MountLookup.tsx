import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MOUNT_CATALOG, groupByManufacturer, type MountCatalogEntry } from '../parser/mountCatalog';

/** Popup width in px, and the gap between the trigger and the panel. */
const PANEL_W = 300;
const GAP = 4;

interface MountLookupProps {
  /** Called with the chosen mount; the caller fills its own field. */
  onPick: (entry: MountCatalogEntry) => void;
}

/**
 * Compact worm-period lookup: a small chevron button that sits beside the worm
 * period input and pops up the mount catalog, grouped by manufacturer. Choosing
 * a model hands it to `onPick` and closes; the field it fills stays editable.
 *
 * The panel is FIXED-positioned against the trigger's viewport rect rather than
 * absolutely positioned in flow. The annotate dialog's body is an
 * `overflow-y-auto` scroll container, so an in-flow popup would be clipped at
 * the container edge (or drag the dialog's scrollbar around). Fixed positioning
 * escapes that, at the cost of having to reposition on scroll/resize — handled
 * below. Renders nothing when the catalog is empty.
 */
export function MountLookup({ onPick }: MountLookupProps) {
  const { t } = useTranslation('common');
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; maxH: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Place the panel under the trigger, flipping above it when the space below
  // is too tight to be usable. Recomputed on scroll/resize because a fixed
  // panel does not follow its anchor on its own.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const btn = btnRef.current;
      if (!btn) return;
      // Anchor to the whole field (input + unit + trigger), not the 20px button.
      // Aligning to the button alone right-aligns a 300px panel off a tiny
      // element, so it hangs left and spills outside the dialog looking
      // detached. Dropping it under the field it fills reads as belonging to it.
      const anchor = (btn.closest('[data-attr-field]') as HTMLElement | null) ?? btn;
      const a = anchor.getBoundingClientRect();
      const b = btn.getBoundingClientRect();
      const below = window.innerHeight - b.bottom - GAP * 2;
      const above = a.top - GAP * 2;
      const flip = below < 180 && above > below;
      const maxH = Math.max(120, Math.min(320, flip ? above : below));
      setPos({
        top: flip ? Math.max(GAP, a.top - GAP - maxH) : b.bottom + GAP,
        // Left-align to the field, then clamp so it stays on screen.
        left: Math.max(GAP, Math.min(a.left, window.innerWidth - PANEL_W - GAP)),
        maxH,
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true); // capture: catch the dialog's own scroller
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  // Dismiss on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || btnRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Escape closes the popup only. The parent dialog also listens for Escape on
  // window, so this runs in the CAPTURE phase and stops propagation — otherwise
  // one keypress would dismiss the whole annotate dialog along with the popup.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      setOpen(false);
      btnRef.current?.focus();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  if (MOUNT_CATALOG.length === 0) return null;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('annotations.mountLookupLabel')}
        title={t('annotations.mountLookupTooltip')}
        onClick={() => setOpen((v) => !v)}
        className={`flex h-[30px] w-5 flex-shrink-0 items-center justify-center rounded border text-[9px] leading-none transition-colors ${
          open
            ? 'border-sky-600 bg-sky-900/40 text-sky-300'
            : 'border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-600 hover:text-slate-200'
        }`}
      >
        ▾
      </button>

      {open && pos && (
        <div
          ref={panelRef}
          role="listbox"
          aria-label={t('annotations.mountLookupLabel')}
          style={{ top: pos.top, left: pos.left, width: PANEL_W, maxHeight: pos.maxH }}
          className="fixed z-[70] overflow-y-auto rounded-md border border-slate-700 bg-slate-900 py-1 shadow-2xl"
        >
          <div className="px-2.5 pb-1 pt-0.5 text-[9px] uppercase tracking-wide text-slate-500">
            {t('annotations.mountLookupHeading')}
          </div>
          {groupByManufacturer(MOUNT_CATALOG).map((g) => (
            <div key={g.manufacturer}>
              <div className="sticky top-0 bg-slate-950/95 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-sky-300/80">
                {g.manufacturer}
              </div>
              {g.entries.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => { onPick(m); setOpen(false); }}
                  className="flex w-full items-baseline justify-between gap-3 px-2.5 py-1 text-left text-xs text-slate-300 hover:bg-slate-800 hover:text-slate-100"
                >
                  <span className="min-w-0 truncate">{m.model}</span>
                  <span className="flex-shrink-0 font-mono text-[11px] text-slate-400">
                    {m.wormPeriodSec} s
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
