import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useLogStore } from '../state/logStore';
import { useRecentsStore } from '../state/recentsStore';
import { useDebugPresenceStore } from '../state/debugLogPresenceStore';
import { useRecentAnnotations } from './useRecentAnnotations';
import { DebugBadge } from './DebugBadge';

/**
 * Full history window ("More…"), listing every stored log (up to MAX_STORED)
 * by friendly name, newest first. Each row opens the log; a missing/evicted
 * record prompts the user to remove it. Per-row × prunes a single entry, and
 * "Clear all history" at the bottom wipes the whole list. Renders nothing when
 * recentsStore.historyOpen is false.
 */
export function RecentLogsModal() {
  const { t } = useTranslation('sections');
  const historyOpen = useRecentsStore((s) => s.historyOpen);
  const close = useRecentsStore((s) => s.closeHistory);
  const items = useRecentsStore((s) => s.items);
  const refresh = useRecentsStore((s) => s.refresh);
  const openRecentById = useRecentsStore((s) => s.open);
  const removeRecentById = useRecentsStore((s) => s.remove);
  const clearAllRecents = useRecentsStore((s) => s.clearAll);
  const currentName = useLogStore((s) => s.meta?.name);
  const annos = useRecentAnnotations(items);
  const debugHashes = useDebugPresenceStore((s) => s.hashes);

  // Refresh the list each time the window opens so it reflects the latest
  // history (a log opened elsewhere, a rename, an eviction).
  useEffect(() => {
    if (historyOpen) void refresh();
  }, [historyOpen, refresh]);

  useEffect(() => {
    if (!historyOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [historyOpen, close]);

  if (!historyOpen) return null;

  const openRecent = async (id: string, name: string) => {
    const res = await openRecentById(id);
    if (res === 'missing') {
      if (window.confirm(t('recents.notFoundConfirm', { name }))) {
        await removeRecentById(id);
      }
      return;
    }
    close();
  };

  const clearAll = async () => {
    if (!window.confirm(t('recents.clearAllConfirm', { count: items.length }))) return;
    await clearAllRecents();
    close();
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50"
      onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      <div className="flex max-h-[80vh] w-[560px] max-w-[92vw] flex-col rounded-lg border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2.5">
          <h2 className="text-sm font-medium text-slate-100">
            {t('recents.historyTitle', { count: items.length })}
          </h2>
          <button
            className="text-slate-500 hover:text-slate-200"
            onClick={() => close()}
            title={t('recents.historyClose')}
            aria-label={t('recents.historyClose')}
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {items.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-slate-500">{t('recents.empty')}</div>
          ) : (
            <ul>
              {items.map((r) => {
                const isCurrent = r.name === currentName;
                const anno = annos[r.id];
                const hasName = !!anno?.friendlyName;
                return (
                  <li
                    key={r.id}
                    className={`flex items-center gap-1 border-b border-slate-800 last:border-b-0 ${
                      isCurrent ? 'bg-slate-800/60' : ''
                    }`}
                  >
                    <button
                      className="flex min-w-0 flex-1 flex-col items-start px-4 py-2 text-start hover:bg-slate-800"
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
                    {r.hash && debugHashes.has(r.hash) && (
                      <span className="px-0.5"><DebugBadge /></span>
                    )}
                    <button
                      className="px-3 text-slate-500 hover:text-red-400"
                      onClick={(e) => { e.stopPropagation(); void removeRecentById(r.id); }}
                      title={t('recents.removeTooltip', { name: r.name })}
                    >
                      ×
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="border-t border-slate-800 px-4 py-2.5">
          <button
            className="rounded border border-red-900 px-3 py-1 text-xs text-red-400 hover:bg-red-950/40 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={items.length === 0}
            onClick={() => void clearAll()}
            title={t('recents.clearAllTooltip')}
          >
            {t('recents.clearAll')}
          </button>
        </div>
      </div>
    </div>
  );
}
