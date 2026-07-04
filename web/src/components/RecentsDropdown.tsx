import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RECENT_VISIBLE } from '../storage/recents';
import type { RecentMeta } from '../storage/recents';
import { useLogStore } from '../state/logStore';
import { useRecentsStore } from '../state/recentsStore';
import { useAnnotationStore } from '../state/annotationStore';
import { useDebugPresenceStore } from '../state/debugLogPresenceStore';
import { useRecentAnnotations } from './useRecentAnnotations';
import { DebugBadge } from './DebugBadge';

export function RecentsDropdown() {
  const { t } = useTranslation('sections');
  const { t: tc } = useTranslation('common');
  const items = useRecentsStore((s) => s.items);
  const refresh = useRecentsStore((s) => s.refresh);
  const openRecentById = useRecentsStore((s) => s.open);
  const removeRecentById = useRecentsStore((s) => s.remove);
  const clearAllRecents = useRecentsStore((s) => s.clearAll);
  const openHistory = useRecentsStore((s) => s.openHistory);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  // Current log's name (for the "(current)" marker) and hash (so the list
  // refreshes — and re-orders — as soon as a different log becomes current).
  const currentName = useLogStore((s) => s.meta?.name);
  const currentHash = useLogStore((s) => s.meta?.hash);
  const openEditor = useAnnotationStore((s) => s.openEditor);
  // Re-fetch whenever any annotation is persisted (revision) — the friendly
  // names shown here come from the annotation store.
  const revision = useAnnotationStore((s) => s.revision);
  const annos = useRecentAnnotations(items);
  // Guide-log hashes with an available companion debug log → "D" badge.
  const debugHashes = useDebugPresenceStore((s) => s.hashes);

  // Keep the shared list current: on mount, when a different log loads, and
  // whenever an annotation changes (a rename should re-sort by friendly name).
  useEffect(() => {
    void refresh();
    void useDebugPresenceStore.getState().refresh();
  }, [refresh, revision, currentHash]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [open]);

  const openRecent = async (id: string, name: string) => {
    const res = await openRecentById(id);
    if (res === 'missing') {
      // Record was evicted (e.g. browser reclaimed storage). Offer to prune it.
      if (window.confirm(t('recents.notFoundConfirm', { name }))) {
        await removeRecentById(id);
      }
      return;
    }
    setOpen(false);
  };

  const removeRecent = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await removeRecentById(id);
  };

  const editAnno = (r: RecentMeta, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!r.hash) return;
    void openEditor(r.hash, r.name);
  };

  const clearAll = async () => {
    if (!window.confirm(t('recents.clearAllConfirm', { count: items.length }))) return;
    await clearAllRecents();
    setOpen(false);
  };

  const visible = items.slice(0, RECENT_VISIBLE);
  const overflow = items.length - visible.length;

  return (
    // Distinct from the section list below: this is a self-contained "open a
    // different log" control, not part of the current log's section listing.
    // A heavier top/bottom border, a tinted background, and a leading history
    // icon set it apart so the two groups don't read as one continuous list.
    <div ref={ref} className="relative border-y-2 border-slate-700 bg-slate-900/50">
      <button
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-start text-xs uppercase tracking-wide text-slate-300 hover:bg-slate-800"
        onClick={() => setOpen((v) => !v)}
        title={open ? t('recents.hideTooltip') : t('recents.showTooltip')}
      >
        <span className="flex items-center gap-2">
          {/* History/clock glyph marks this as the "recently opened" picker. */}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 text-slate-400" aria-hidden>
            <path d="M3 3v5h5" />
            <path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" />
            <path d="M12 7v5l3 2" />
          </svg>
          <span>{t('recents.dropdownLabel', { count: items.length })}</span>
        </span>
        <span className="text-slate-500">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="absolute start-0 end-0 top-full z-30 max-h-96 overflow-y-auto border border-slate-700 bg-slate-900 shadow-lg">
          {items.length === 0 ? (
            <div className="px-3 py-2 text-xs text-slate-500">{t('recents.empty')}</div>
          ) : (
            <ul>
              {visible.map((r) => {
                const isCurrent = r.name === currentName;
                const anno = annos[r.id];
                const hasName = !!anno?.friendlyName;
                const hasNotes = !!anno?.notes;
                return (
                  <li
                    key={r.id}
                    className={`flex items-center gap-1 border-b border-slate-800 last:border-b-0 ${
                      isCurrent ? 'bg-slate-800/60' : ''
                    }`}
                  >
                    <button
                      className="flex min-w-0 flex-1 flex-col items-start px-3 py-2 text-start hover:bg-slate-800"
                      onClick={() => void openRecent(r.id, r.name)}
                      title={t('recents.reopenTooltip', { name: r.name })}
                    >
                      {hasName ? (
                        <>
                          <span className="w-full truncate text-sm text-slate-200">
                            {anno!.friendlyName}
                            {isCurrent && <span className="ms-2 text-xs text-sky-400">{t('recents.current')}</span>}
                          </span>
                          <span className="w-full truncate text-[11px] text-slate-500">{r.name}</span>
                        </>
                      ) : (
                        <span className="w-full truncate text-sm text-slate-300">
                          {r.name}
                          {isCurrent && <span className="ms-2 text-xs text-sky-400">{t('recents.current')}</span>}
                        </span>
                      )}
                    </button>
                    {/* "D" badge: this guide log has a companion debug log available. */}
                    {r.hash && debugHashes.has(r.hash) && (
                      <span className="px-0.5"><DebugBadge /></span>
                    )}
                    {/* Annotate affordance: a note glyph when notes exist (even
                        without a name), otherwise a pencil to add a name. */}
                    {r.hash && (
                      <button
                        className="px-1.5 text-slate-500 hover:text-sky-400"
                        onClick={(e) => editAnno(r, e)}
                        title={hasNotes ? tc('annotations.notesIndicatorTooltip')
                          : hasName ? tc('annotations.editTooltip')
                          : tc('annotations.nameTooltip')}
                        aria-label={tc('annotations.editTooltip')}
                      >
                        {hasNotes ? '🗒' : '✎'}
                      </button>
                    )}
                    <button
                      className="px-2 text-slate-500 hover:text-red-400"
                      onClick={(e) => void removeRecent(r.id, e)}
                      title={t('recents.removeTooltip', { name: r.name })}
                    >
                      ×
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {/* "More…" opens the full history window when there are older logs
              beyond the inline list. */}
          {overflow > 0 && (
            <button
              className="w-full border-t border-slate-700 px-3 py-2 text-start text-xs text-sky-400 hover:bg-slate-800 hover:text-sky-300"
              onClick={() => { openHistory(); setOpen(false); }}
              title={t('recents.moreTooltip')}
            >
              {t('recents.more', { count: overflow })}
            </button>
          )}
          <button
            className="w-full border-t border-slate-700 px-3 py-2 text-start text-xs text-slate-400 hover:bg-slate-800 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={items.length === 0}
            onClick={() => void clearAll()}
            title={t('recents.clearAllTooltip')}
          >
            {t('recents.clearAll')}
          </button>
        </div>
      )}
    </div>
  );
}
