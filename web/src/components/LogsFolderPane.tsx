import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLogStore } from '../state/logStore';

/**
 * Sidebar pane that lets the user load a new guide log via drag-and-drop or
 * a file picker — same behaviour as the home-page drop zone, but sized to
 * fit the sidebar above the section list. Loading a log here goes through
 * `useLogStore.loadFromText`, the same path as picking from Recents, so the
 * rest of the UI refreshes the same way.
 */
export function LogsFolderPane() {
  const { t } = useTranslation('common');
  const { t: tSections } = useTranslation('sections');
  const loadFromText = useLogStore((s) => s.loadFromText);
  const loading = useLogStore((s) => s.loading);
  const error = useLogStore((s) => s.error);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(true);
  const [dragOver, setDragOver] = useState(false);

  const handleFile = useCallback(async (file: File) => {
    const text = await file.text();
    await loadFromText(text, file.name);
  }, [loadFromText]);

  return (
    <div className="border-b border-slate-800">
      <button
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-start text-xs uppercase tracking-wide text-slate-400 hover:bg-slate-800"
        onClick={() => setOpen((v) => !v)}
        title={open ? tSections('openLog.hide') : tSections('openLog.show')}
      >
        <span className="flex-1 truncate">{tSections('openLog.title')}</span>
        <span className="text-slate-500">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="px-3 py-3">
          <div
            title={t('dropZone.tooltip')}
            className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-3 text-center transition-colors ${
              dragOver ? 'border-sky-400 bg-sky-950/30' : 'border-slate-600'
            }`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const f = e.dataTransfer.files?.[0];
              if (f) void handleFile(f);
            }}
          >
            <p className="mb-2 text-xs text-slate-300">{t('dropZone.title')}</p>
            <button
              className="rounded bg-sky-600 px-3 py-1 text-xs hover:bg-sky-500"
              onClick={() => inputRef.current?.click()}
              title={t('dropZone.pickFileTooltip')}
            >
              {t('dropZone.pickFile')}
            </button>
            <input
              ref={inputRef}
              type="file"
              accept=".log,.txt,text/plain"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
                e.target.value = '';
              }}
            />
            {loading && <p className="mt-2 text-xs text-slate-400">{t('dropZone.parsing')}</p>}
            {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
