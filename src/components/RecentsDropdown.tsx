import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { listRecents, getRecent, deleteRecent } from '../storage/recents';
import type { RecentMeta } from '../storage/recents';
import { useLogStore } from '../state/logStore';

export function RecentsDropdown() {
  const { t } = useTranslation('sections');
  const [items, setItems] = useState<RecentMeta[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const loadFromText = useLogStore((s) => s.loadFromText);
  const currentName = useLogStore((s) => s.meta?.name);

  const refresh = async () => setItems(await listRecents());

  useEffect(() => { void refresh(); }, []);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [open]);

  const openRecent = async (id: string) => {
    const rec = await getRecent(id);
    if (rec) {
      await loadFromText(rec.text, rec.name, { persist: false });
      setOpen(false);
    }
  };

  const removeRecent = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await deleteRecent(id);
    await refresh();
  };

  const clearAll = async () => {
    for (const r of items) await deleteRecent(r.id);
    await refresh();
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative border-b border-slate-800">
      <button
        className="flex w-full items-center justify-between px-3 py-2 text-start text-xs uppercase tracking-wide text-slate-400 hover:bg-slate-800"
        onClick={() => setOpen((v) => !v)}
        title={open ? t('recents.hideTooltip') : t('recents.showTooltip')}
      >
        <span>{t('recents.dropdownLabel', { count: items.length })}</span>
        <span className="text-slate-500">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="absolute start-0 end-0 top-full z-30 max-h-96 overflow-y-auto border border-slate-700 bg-slate-900 shadow-lg">
          {items.length === 0 ? (
            <div className="px-3 py-2 text-xs text-slate-500">{t('recents.empty')}</div>
          ) : (
            <ul>
              {items.map((r) => {
                const isCurrent = r.name === currentName;
                return (
                  <li
                    key={r.id}
                    className={`flex items-center gap-1 border-b border-slate-800 last:border-b-0 ${
                      isCurrent ? 'bg-slate-800/60' : ''
                    }`}
                  >
                    <button
                      className="flex-1 truncate px-3 py-2 text-start text-sm text-slate-200 hover:bg-slate-800"
                      onClick={() => void openRecent(r.id)}
                      title={t('recents.reopenTooltip', { name: r.name })}
                    >
                      {r.name}
                      {isCurrent && <span className="ms-2 text-xs text-sky-400">{t('recents.current')}</span>}
                    </button>
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
