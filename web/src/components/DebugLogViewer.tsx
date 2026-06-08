import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDebugLogStore } from '../state/debugLogStore';

/**
 * In-app dialog for the debug-log feature. The log itself renders in a NEW
 * BROWSER TAB (see debugLogTab.ts + public/debug-log-tab.html); this modal only
 * handles the cases that need the app window: the sibling debug log couldn't be
 * auto-found (offer a drag-or-click pick), the picked file isn't a debug log, or
 * the sample has no timestamp.
 *
 * Backdrop dismiss is guarded to `e.target === e.currentTarget` so a bubbled
 * click — notably the programmatic `input.click()` from the drop zone — doesn't
 * unmount the dialog before the file's `change`/`drop` handler runs.
 */
export function DebugLogViewer() {
  const { t } = useTranslation('analysis');
  const status = useDebugLogStore((s) => s.status);
  const errorKey = useDebugLogStore((s) => s.errorKey);
  const canPick = useDebugLogStore((s) => s.canPick);
  const dismiss = useDebugLogStore((s) => s.dismiss);
  const pickFile = useDebugLogStore((s) => s.pickFile);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    if (status !== 'error') return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') dismiss(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [status, dismiss]);

  if (status !== 'error') return null;

  const take = (files: FileList | null | undefined) => {
    const f = files?.[0];
    if (f) void pickFile(f);
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) dismiss(); }}
    >
      <div className="w-full max-w-md rounded-lg border border-slate-700 bg-slate-900 p-5 shadow-xl">
        <div className="mb-2 text-sm font-semibold uppercase tracking-wide text-sky-300">
          {t('debugViewer.title')}
        </div>
        <div className="mb-4 text-sm leading-relaxed text-slate-300">
          {t(`debugViewer.error.${errorKey}`)}
        </div>

        {canPick && (
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); take(e.dataTransfer.files); }}
            title={t('debugViewer.dropZoneTooltip')}
            className={`mb-4 cursor-pointer rounded-lg border-2 border-dashed px-4 py-6 text-center text-sm transition-colors ${
              dragOver
                ? 'border-sky-400 bg-sky-500/10 text-sky-200'
                : 'border-slate-600 text-slate-400 hover:border-slate-500 hover:bg-slate-800/40'
            }`}
          >
            {t('debugViewer.dropZone')}
          </div>
        )}

        <div className="flex justify-end">
          <button
            onClick={dismiss}
            className="rounded bg-slate-800 px-3 py-1.5 text-sm text-slate-200 ring-1 ring-slate-700 hover:bg-slate-700"
          >
            {t('debugViewer.close')}
          </button>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".txt,.log,text/plain"
        className="hidden"
        onChange={(e) => {
          const files = e.target.files;
          e.target.value = '';
          take(files);
        }}
      />
    </div>
  );
}
