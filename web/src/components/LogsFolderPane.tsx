import { useEffect, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useFolderStore } from '../state/folderStore';
import { useLogStore } from '../state/logStore';

/**
 * Sidebar pane that lists every PHD2 guide log inside the user's chosen
 * folder, sorted newest-first by parsed date+time. Persistent — folder
 * handle survives reloads via IndexedDB; user re-grants permission once
 * per session via the "Reconnect" button.
 *
 * Visible states match folderStore's state machine:
 *   - unsupported     → show the explanatory stub (Firefox / Safari)
 *   - no-folder       → "Choose folder" button
 *   - needs-permission → "Reconnect" button
 *   - listing         → header chips + scrollable list of rows
 */
export function LogsFolderPane() {
  const { t } = useTranslation('sections');
  const folder = useFolderStore();
  const currentName = useLogStore((s) => s.meta?.name);
  const [open, setOpen] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Close the overflow menu when clicking outside it.
  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [menuOpen]);

  const folderName =
    folder.state === 'needs-permission' || folder.state === 'listing'
      ? folder.folderName
      : null;
  const recordCount = folder.state === 'listing' ? folder.records.length : null;

  return (
    <div className="border-b border-slate-800">
      <button
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-start text-xs uppercase tracking-wide text-slate-400 hover:bg-slate-800"
        onClick={() => setOpen((v) => !v)}
        title={open ? t('folder.hide') : t('folder.show')}
      >
        <span className="flex-1 truncate">
          {t('folder.title')}
          {folderName && <span className="ms-1 text-slate-300">· {folderName}</span>}
          {recordCount !== null && <span className="ms-1 text-slate-500">· {t('folder.logsCount', { count: recordCount })}</span>}
        </span>
        {folder.state === 'listing' && (
          <span className="flex items-center gap-1">
            <span
              role="button"
              tabIndex={0}
              className="rounded px-1 text-slate-500 hover:bg-slate-700 hover:text-slate-200"
              title={t('folder.refresh')}
              onClick={(e) => { e.stopPropagation(); void folder.refresh(); }}
              onKeyDown={(e) => { if (e.key === 'Enter') void folder.refresh(); }}
            >↻</span>
            <span
              ref={menuRef}
              role="button"
              tabIndex={0}
              className="relative rounded px-1 text-slate-500 hover:bg-slate-700 hover:text-slate-200"
              title={t('folder.menu')}
              onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
            >
              ⋯
              {menuOpen && (
                <div
                  className="absolute end-0 top-full z-30 mt-1 w-44 rounded border border-slate-700 bg-slate-900 shadow-lg"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    className="block w-full px-3 py-2 text-start text-xs text-slate-200 hover:bg-slate-800"
                    onClick={() => { setMenuOpen(false); void folder.pickFolder(); }}
                    title={t('folder.changeTooltip')}
                  >
                    {t('folder.change')}
                  </button>
                  <button
                    className="block w-full px-3 py-2 text-start text-xs text-slate-400 hover:bg-slate-800 hover:text-red-400"
                    onClick={() => { setMenuOpen(false); void folder.forgetFolder(); }}
                    title={t('folder.forgetTooltip')}
                  >
                    {t('folder.forget')}
                  </button>
                </div>
              )}
            </span>
          </span>
        )}
        <span className="text-slate-500">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div>
          {folder.state === 'unsupported' && (
            <div className="px-3 py-3 text-xs text-slate-400">
              {t('folder.unsupported')}
            </div>
          )}
          {folder.state === 'no-folder' && (
            <div className="flex flex-col gap-2 px-3 py-3 text-xs text-slate-400">
              <button
                className="rounded bg-sky-700 px-3 py-1 text-sm text-white hover:bg-sky-600"
                onClick={() => void folder.pickFolder()}
                title={t('folder.chooseTooltip')}
              >
                {t('folder.choose')}
              </button>
              <span>
                {/* `pickHint` uses a <1> placeholder so the translated sentence can re-position the
                    monospace path span — see locales/README.md for placeholder rules. */}
                <Trans
                  ns="sections"
                  i18nKey="folder.pickHint"
                  values={{ path: 'Documents\\PHD2' }}
                  components={{ 1: <span className="font-mono text-slate-300" /> }}
                />
              </span>
            </div>
          )}
          {folder.state === 'needs-permission' && (
            <div className="flex flex-col gap-2 px-3 py-3 text-xs text-slate-400">
              <button
                className="rounded bg-sky-700 px-3 py-1 text-sm text-white hover:bg-sky-600"
                onClick={() => void folder.reconnect()}
                title={t('folder.reconnectTooltip')}
              >
                {t('folder.reconnect')}
              </button>
              <span>{t('folder.reconnectHint')}</span>
            </div>
          )}
          {folder.state === 'error' && (
            <div className="flex flex-col gap-2 px-3 py-3 text-xs text-red-400">
              <span>{folder.message}</span>
              <button
                className="self-start rounded bg-slate-800 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700"
                onClick={() => void folder.pickFolder()}
              >
                {t('folder.choose')}
              </button>
            </div>
          )}
          {folder.state === 'listing' && (
            <ul className="max-h-72 overflow-y-auto">
              {folder.records.map((r) => {
                const isCurrent = r.filename === currentName;
                return (
                  <li
                    key={r.filename}
                    className={`border-b border-slate-800 last:border-b-0 ${
                      isCurrent ? 'bg-slate-800/60' : ''
                    }`}
                  >
                    <button
                      className="block w-full truncate px-3 py-2 text-start text-sm text-slate-200 hover:bg-slate-800"
                      onClick={() => void folder.openRecord(r)}
                      title={t('folder.openTooltip', { name: r.filename })}
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{r.dateLabel}</span>
                        {isCurrent && <span className="text-xs text-sky-400">{t('folder.current')}</span>}
                      </div>
                      <div className="truncate text-xs text-slate-500">{r.filename}</div>
                    </button>
                  </li>
                );
              })}
              {folder.records.length === 0 && (
                <li className="px-3 py-3 text-xs text-slate-500">
                  {t('folder.noLogs')}
                </li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
