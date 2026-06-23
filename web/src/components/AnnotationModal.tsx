import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAnnotationStore, NOTES_MAXLEN } from '../state/annotationStore';

/**
 * Centered dialog for naming + annotating a log. One component serves two
 * modes (driven by annotationStore.modal.mode):
 *   - 'first-open': name-only prompt fired the first time an unseen log opens.
 *     Save / Skip; a "+ notes" link expands into the full editor. Dismissing
 *     (Escape / backdrop / Skip) records "seen" so it never re-prompts.
 *   - 'edit': full editor (name + ≥10-line notes textarea + Delete), opened
 *     from the file-list pencil/note icon or the header annotate button.
 * Renders nothing when annotationStore.modal is null.
 */
export function AnnotationModal() {
  const { t } = useTranslation('common');
  const modal = useAnnotationStore((s) => s.modal);
  const setDraftName = useAnnotationStore((s) => s.setDraftName);
  const setDraftNotes = useAnnotationStore((s) => s.setDraftNotes);
  const save = useAnnotationStore((s) => s.save);
  const clearCurrent = useAnnotationStore((s) => s.clearCurrentInModal);
  const skipFirstOpen = useAnnotationStore((s) => s.skipFirstOpen);
  const expandToNotes = useAnnotationStore((s) => s.expandToNotes);
  const close = useAnnotationStore((s) => s.close);

  // Dismiss semantics differ by mode: first-open records "seen" so it never
  // re-prompts; edit just closes without persisting.
  const dismiss = modal?.mode === 'first-open' ? skipFirstOpen : close;

  // On the first-open prompt the name is pre-filled with the date parsed from
  // the filename. Place the caret at the START of the field (rather than the
  // browser default of end / select-all) so the user can type a prefix in
  // front of the suggested date without first repositioning the cursor.
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (modal?.mode !== 'first-open') return;
    const el = nameInputRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(0, 0);
  }, [modal?.mode]);

  useEffect(() => {
    if (!modal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') void dismiss();
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void save();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modal?.mode]);

  if (!modal) return null;
  const isFirstOpen = modal.mode === 'first-open';
  const hasContent = modal.name.trim().length > 0 || modal.notes.length > 0;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50"
      onMouseDown={(e) => { if (e.target === e.currentTarget) void dismiss(); }}
    >
      <div className="w-[480px] max-w-[90vw] rounded-lg border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2.5">
          <h2 className="text-sm font-medium text-slate-100">
            {isFirstOpen ? t('annotations.firstOpenTitle') : t('annotations.editTitle')}
          </h2>
          <button
            className="text-slate-500 hover:text-slate-200"
            onClick={() => void dismiss()}
            title={t('annotations.close')}
            aria-label={t('annotations.close')}
          >
            ✕
          </button>
        </div>

        <div className="px-4 py-3">
          <label className="mb-1 block text-[10px] uppercase tracking-wide text-slate-500">
            {t('annotations.nameLabel')}
          </label>
          <input
            ref={nameInputRef}
            autoFocus
            className="w-full rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
            value={modal.name}
            placeholder={t('annotations.namePlaceholder')}
            onChange={(e) => setDraftName(e.target.value)}
            title={t('annotations.nameLabel')}
          />

          {modal.filename && (
            <p className="mt-1 truncate text-[11px] text-slate-600" title={modal.filename}>
              {modal.filename}
            </p>
          )}

          {!isFirstOpen && (
            <>
              <label className="mb-1 mt-3 block text-[10px] uppercase tracking-wide text-slate-500">
                {t('annotations.notesLabel')}
              </label>
              <textarea
                rows={10}
                maxLength={NOTES_MAXLEN}
                className="w-full resize-y rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs leading-relaxed text-slate-200 focus:border-sky-500 focus:outline-none"
                value={modal.notes}
                placeholder={t('annotations.notesPlaceholder')}
                onChange={(e) => setDraftNotes(e.target.value)}
                title={t('annotations.notesLabel')}
              />
              <p className="mt-0.5 text-right text-[10px] text-slate-600">
                {modal.notes.length.toLocaleString()} / {NOTES_MAXLEN.toLocaleString()}
              </p>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-slate-800 px-4 py-2.5">
          <button
            className="rounded bg-sky-600 px-3 py-1 text-xs font-medium text-white hover:bg-sky-500"
            onClick={() => void save()}
            title={t('annotations.save')}
          >
            {t('annotations.save')}
          </button>

          {isFirstOpen ? (
            <>
              <button
                className="rounded px-3 py-1 text-xs text-slate-400 hover:text-slate-200"
                onClick={() => void skipFirstOpen()}
                title={t('annotations.skip')}
              >
                {t('annotations.skip')}
              </button>
              <button
                className="ms-auto text-xs text-sky-400 hover:text-sky-300"
                onClick={() => expandToNotes()}
                title={t('annotations.addNotes')}
              >
                {t('annotations.addNotes')}
              </button>
            </>
          ) : (
            <button
              className="ms-auto rounded border border-red-900 px-3 py-1 text-xs text-red-400 hover:bg-red-950/40 disabled:cursor-not-allowed disabled:opacity-40"
              onClick={() => void clearCurrent()}
              disabled={!hasContent}
              title={t('annotations.delete')}
            >
              {t('annotations.delete')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
