import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDebugLogStore } from '../state/debugLogStore';
import { canGrantFolder, canPickFileHandle } from '../storage/debugLogAccess';

/**
 * In-app dialog for the debug-log feature. The log itself renders in a NEW
 * BROWSER TAB (debug-log-tab.html); this modal only appears when the sibling
 * debug log couldn't be found automatically and offers ways to provide it:
 * grant its folder, or pick / drag the file. (The most reliable path is to drag
 * the guide log AND its debug log together onto the open-log drop zone — then
 * this dialog never appears.)
 *
 * Backdrop dismiss is guarded to `e.target === e.currentTarget` so a bubbled
 * click — notably the programmatic `input.click()` — doesn't unmount the dialog
 * before the file handler runs.
 */
export function DebugLogViewer() {
  const { t } = useTranslation('analysis');
  const status = useDebugLogStore((s) => s.status);
  const errorKey = useDebugLogStore((s) => s.errorKey);
  const canPick = useDebugLogStore((s) => s.canPick);
  const dismiss = useDebugLogStore((s) => s.dismiss);
  const pickFile = useDebugLogStore((s) => s.pickFile);
  const pickViaHandle = useDebugLogStore((s) => s.pickViaHandle);
  const grantFolder = useDebugLogStore((s) => s.grantFolder);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    if (status !== 'error') return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') dismiss(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [status, dismiss]);

  if (status !== 'error') return null;

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
          <div className="mb-4 flex flex-col gap-2">
            {canGrantFolder && (
              <button
                onClick={() => void grantFolder()}
                className="rounded bg-sky-700 px-3 py-2 text-sm text-white ring-1 ring-sky-500 hover:bg-sky-600"
                title={t('debugViewer.openFolderTooltip')}
              >
                {t('debugViewer.openFolder')}
              </button>
            )}
            <div
              // Prefer the File System Access picker so the pick yields a
              // durable handle we persist by guide-log hash (survives reloads);
              // fall back to the one-shot <input> when it's unavailable.
              onClick={() => { if (canPickFileHandle) void pickViaHandle(); else fileInputRef.current?.click(); }}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const f = e.dataTransfer.files?.[0];
                if (f) void pickFile(f);
              }}
              title={t('debugViewer.dropZoneTooltip')}
              className={`cursor-pointer rounded-lg border-2 border-dashed px-4 py-5 text-center text-sm transition-colors ${
                dragOver
                  ? 'border-sky-400 bg-sky-500/10 text-sky-200'
                  : 'border-slate-600 text-slate-400 hover:border-slate-500 hover:bg-slate-800/40'
              }`}
            >
              {t('debugViewer.dropZone')}
            </div>
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
          // Capture the File BEFORE clearing the input — `e.target.value = ''`
          // empties the live FileList, so reading files[0] afterwards gives
          // nothing (the bug that made the click-to-pick path do nothing).
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void pickFile(f);
        }}
      />
    </div>
  );
}
