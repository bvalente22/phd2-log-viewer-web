import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLogStore } from '../state/logStore';
import { useAnnotationStore } from '../state/annotationStore';
import { useDebugPresenceStore } from '../state/debugLogPresenceStore';
import { DebugBadge } from './DebugBadge';
import { setStashedDebugLog, rememberDebugLogHandle, readDroppedFiles, canPickFileHandle } from '../storage/debugLogAccess';

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
  const meta = useLogStore((s) => s.meta);
  // Subscribe to the open log's annotation so the strip refreshes the instant
  // the modal saves/clears (save/clearCurrentInModal update `current` for the
  // matching key).
  const annotation = useAnnotationStore((s) => s.current);
  const openEditor = useAnnotationStore((s) => s.openEditor);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(true);
  const [dragOver, setDragOver] = useState(false);

  const friendlyName = annotation?.friendlyName ?? null;
  const notes = annotation?.notes ?? null;

  // Does the open log have a companion debug log available? → "D" badge.
  const debugHashes = useDebugPresenceStore((s) => s.hashes);
  const hasDebug = meta?.hash ? debugHashes.has(meta.hash) : false;
  // Load persisted debug-log presence once on mount (handles remembered from
  // previous sessions); drag-both refreshes it again via processFiles.
  useEffect(() => { void useDebugPresenceStore.getState().refresh(); }, []);

  // Accept one OR more files: the guide log, optionally with its debug log.
  // Dragging both in at once makes the debug log available so double-clicking a
  // sample (and Backlash) opens it directly — the most reliable path, since the
  // browser can't see a dropped file's parent folder to auto-find the sibling.
  // `debugHandle` (drag only, Chromium) persists a link to it across sessions.
  // Guide log only → nothing stashed (auto-find / pick fallback).
  const processFiles = useCallback(async (
    files: File[], debugHandle: FileSystemFileHandle | null,
  ) => {
    if (files.length === 0) return;
    const guide = files.find((f) => /GuideLog/i.test(f.name)) ?? files[0];
    const debug = files.find((f) => /DebugLog/i.test(f.name) && f !== guide) ?? null;
    const text = await guide.text();
    await loadFromText(text, guide.name);
    const hash = useLogStore.getState().meta?.hash;
    if (debug && hash) {
      setStashedDebugLog(hash, debug); // this session
      if (debugHandle) await rememberDebugLogHandle(hash, debugHandle, debug.name); // across sessions
      void useDebugPresenceStore.getState().refresh(); // light up the "D" badge
    }
  }, [loadFromText]);

  // Drop: capture the files synchronously (the DataTransfer is neutered the
  // moment this handler yields at an await) before collecting the debug handle.
  const handleDrop = useCallback(async (e: React.DragEvent) => {
    const { files, debugHandle } = await readDroppedFiles(e.dataTransfer);
    await processFiles(files, debugHandle);
  }, [processFiles]);

  // "Pick file": prefer the File System Access picker (Chromium) so selecting
  // the guide log AND its debug log together yields a durable debug-log HANDLE —
  // processFiles persists it by guide-log hash, so the double-click-to-debug
  // jump still works after reopening the guide log from Recents in a later
  // session. Falls back to the plain multi-file <input> (bytes only, no handle)
  // where the API is missing.
  const handlePick = useCallback(async () => {
    if (!canPickFileHandle) { inputRef.current?.click(); return; }
    let handles: FileSystemFileHandle[];
    try {
      handles = await window.showOpenFilePicker({
        multiple: true,
        types: [{ description: 'PHD2 guide / debug log', accept: { 'text/plain': ['.txt', '.log'] } }],
      });
    } catch {
      return; // user cancelled the picker
    }
    const files = await Promise.all(handles.map((h) => h.getFile()));
    const debugHandle = handles.find((h) => /DebugLog/i.test(h.name)) ?? null;
    await processFiles(files, debugHandle);
  }, [processFiles]);

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
          {/* Current-log strip: friendly name (or filename + name cue) plus a
              2-line notes preview. Whole strip is the edit affordance — clicking
              opens the same AnnotationModal in edit mode. Lives above the drop
              zone; only shown while a log is open. */}
          {meta?.hash && (
            <button
              type="button"
              onClick={() => void openEditor(meta.hash, meta.name)}
              title={friendlyName ? t('annotations.editTooltip') : t('annotations.nameTooltip')}
              className="mb-3 flex w-full items-start gap-2 rounded-md border border-slate-700 bg-slate-800/40 px-2.5 py-2 text-start hover:bg-slate-800"
            >
              <span className="min-w-0 flex-1">
                {friendlyName ? (
                  <>
                    <span className="block truncate text-sm text-slate-200">{friendlyName}</span>
                    <span className="block truncate text-[11px] text-slate-500">{meta.name}</span>
                  </>
                ) : (
                  <>
                    <span className="block truncate text-sm text-slate-300">{meta.name}</span>
                    <span className="block text-[11px] text-sky-400">✎ {t('annotations.nameThisLog')}</span>
                  </>
                )}
                {notes && (
                  // No `block` here — line-clamp-2 sets display:-webkit-box;
                  // adding `block` would override it and defeat the clamp.
                  <span className="mt-1 line-clamp-2 text-[11px] leading-snug text-slate-400">
                    {notes}
                  </span>
                )}
              </span>
              {/* "D" badge: this log has a companion debug log available. */}
              {hasDebug && <DebugBadge />}
              {/* Blue pencil, no background of its own (the strip is the button). */}
              <span className="text-sm text-sky-400" aria-hidden="true">✎</span>
            </button>
          )}
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
              void handleDrop(e);
            }}
          >
            <p className="mb-2 text-xs text-slate-300">{t('dropZone.title')}</p>
            <button
              className="rounded bg-sky-600 px-3 py-1 text-xs hover:bg-sky-500"
              onClick={() => void handlePick()}
              title={t('dropZone.pickFileTooltip')}
            >
              {t('dropZone.pickFile')}
            </button>
            <input
              ref={inputRef}
              type="file"
              accept=".log,.txt,text/plain"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = '';
                void processFiles(files, null);
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
