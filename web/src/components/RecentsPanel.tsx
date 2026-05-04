import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { listRecents, getRecent, deleteRecent } from '../storage/recents';
import type { RecentMeta } from '../storage/recents';
import { useLogStore } from '../state/logStore';

export function RecentsPanel() {
  const { t } = useTranslation('sections');
  const [items, setItems] = useState<RecentMeta[]>([]);
  const loadFromText = useLogStore((s) => s.loadFromText);

  const refresh = async () => setItems(await listRecents());

  useEffect(() => { void refresh(); }, []);

  if (items.length === 0) return null;

  return (
    <div className="border-t border-slate-800 p-3">
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">{t('recents.title')}</h3>
      <ul className="space-y-1">
        {items.map((r) => (
          <li key={r.id} className="flex items-center justify-between text-sm">
            <button
              className="flex-1 truncate text-start text-slate-200 hover:text-sky-300"
              onClick={async () => {
                const rec = await getRecent(r.id);
                if (rec) await loadFromText(rec.text, rec.name, { persist: false });
              }}
            >
              {r.name}
            </button>
            <button
              className="ms-2 text-slate-500 hover:text-red-400"
              onClick={async () => { await deleteRecent(r.id); await refresh(); }}
              title={t('recents.remove')}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
