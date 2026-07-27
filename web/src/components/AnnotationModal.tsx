import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAnnotationStore, NOTES_MAXLEN } from '../state/annotationStore';
import { MOUNT_TYPES } from '../storage/annotations';
import { MOUNT_CATALOG, groupByManufacturer } from '../parser/mountCatalog';
import { wrapTip } from '../i18n/format';

/**
 * Numeric attribute input (worm period, image scale). Free-text while typing —
 * validation happens on save, where blank/invalid/≤0 all normalize to 0
 * ("unknown"). `step="0.01"` matches the 2dp the store rounds to. Shows a
 * non-blocking hint when the current text can't parse, rather than rejecting
 * keystrokes, so a half-typed "1." never fights the user.
 */
function NumAttr({ label, unit, value, placeholder, title, onChange }: {
  label: string;
  unit: string;
  value: string;
  placeholder: string;
  title: string;
  onChange: (s: string) => void;
}) {
  const invalid = value.trim() !== '' && !(Number.isFinite(parseFloat(value)) && parseFloat(value) >= 0);
  return (
    <div className="min-w-0 flex-1">
      {/* Two lines are reserved so a one-line label ("Mount worm period") and a
          two-line one ("Imaging System Image Scale") still leave their inputs
          aligned on the same baseline when shown side by side. */}
      <label className="mb-1 flex min-h-[2.4em] items-end text-[10px] uppercase leading-tight tracking-wide text-slate-500">
        {label}
      </label>
      <div className="flex items-center gap-1">
        <input
          type="number"
          min={0}
          step="0.01"
          inputMode="decimal"
          className={`w-full min-w-0 rounded border bg-slate-950 px-2.5 py-1.5 text-sm text-slate-100 focus:outline-none ${
            invalid ? 'border-red-700 focus:border-red-500' : 'border-slate-700 focus:border-sky-500'
          }`}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          title={title}
        />
        <span className="flex-shrink-0 text-[11px] text-slate-500">{unit}</span>
      </div>
    </div>
  );
}

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
  const setDraftMountType = useAnnotationStore((s) => s.setDraftMountType);
  const setDraftHasEncoders = useAnnotationStore((s) => s.setDraftHasEncoders);
  const setDraftWormPeriod = useAnnotationStore((s) => s.setDraftWormPeriod);
  const setDraftImagingScale = useAnnotationStore((s) => s.setDraftImagingScale);
  const save = useAnnotationStore((s) => s.save);
  const clearCurrent = useAnnotationStore((s) => s.clearCurrentInModal);
  const skipFirstOpen = useAnnotationStore((s) => s.skipFirstOpen);
  const expandToNotes = useAnnotationStore((s) => s.expandToNotes);
  const close = useAnnotationStore((s) => s.close);

  // Dismiss semantics differ by mode: first-open records "seen" so it never
  // re-prompts; edit just closes without persisting.
  const dismiss = modal?.mode === 'first-open' ? skipFirstOpen : close;

  // Which catalog mount the user last picked, so the dropdown can keep showing
  // it. Local and unpersisted — see the lookup markup for why the selection
  // can't be re-derived from the saved period alone. Cleared when the dialog
  // reopens, and dropped below as soon as the period no longer matches the pick
  // (so hand-editing the number doesn't leave a stale model on screen).
  const [pickedMountKey, setPickedMountKey] = useState('');
  useEffect(() => { setPickedMountKey(''); }, [modal?.key, modal?.mode]);

  const wormText = modal?.wormPeriodText ?? '';
  const picked = MOUNT_CATALOG.find((m) => m.key === pickedMountKey);
  const selectedMountKey =
    picked && parseFloat(wormText) === picked.wormPeriodSec ? picked.key : '';

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
      {/* Edit mode is tall (name + attributes + a 10-row notes box), so the
          dialog is capped to the viewport and the BODY scrolls — keeping the
          title bar and the Save/Cancel row pinned and always reachable. */}
      <div className="flex max-h-[90vh] w-[480px] max-w-[90vw] flex-col rounded-lg border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="flex flex-shrink-0 items-center justify-between border-b border-slate-800 px-4 py-2.5">
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

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
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
              {/* ---- Setup attributes ---------------------------------------
                  Hardware facts about the rig that produced this log. Grouped
                  under their own rule so they read as configuration rather than
                  free-text annotation. Image scale is NOT stored on the
                  annotation — it reads/writes the same per-log `imaging:`
                  sidecar the Image Impact panel uses, so the two stay one
                  value. */}
              <div className="mt-4 border-t border-slate-800 pt-3">
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  {t('annotations.attrsHeading')}
                </div>

                <label className="mb-1 block text-[10px] uppercase tracking-wide text-slate-500">
                  {t('annotations.mountTypeLabel')}
                </label>
                <select
                  className="w-full rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                  value={modal.mountType}
                  onChange={(e) => setDraftMountType(e.target.value as typeof modal.mountType)}
                  title={wrapTip(t('annotations.mountTypeTooltip'))}
                >
                  {MOUNT_TYPES.map((m) => (
                    <option key={m} value={m}>{t(`annotations.mountType.${m}`)}</option>
                  ))}
                </select>

                {/* Mount lookup — a convenience picker, not a stored field.
                    Choosing a model fills the worm period below, which stays
                    freely editable afterwards. The selection is intentionally
                    NOT persisted: several mounts share a period (four Celestron
                    models are all 478.69 s), so a stored number can't be mapped
                    back to one model without guessing. */}
                {MOUNT_CATALOG.length > 0 && (
                  <div className="mt-3">
                    <label
                      className="mb-1 block text-[10px] uppercase tracking-wide text-slate-500"
                      htmlFor="mount-lookup"
                    >
                      {t('annotations.mountLookupLabel')}
                    </label>
                    <select
                      id="mount-lookup"
                      className="w-full rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                      value={selectedMountKey}
                      onChange={(e) => {
                        const hit = MOUNT_CATALOG.find((m) => m.key === e.target.value);
                        setPickedMountKey(hit ? hit.key : '');
                        if (hit) setDraftWormPeriod(String(hit.wormPeriodSec));
                      }}
                      title={wrapTip(t('annotations.mountLookupTooltip'))}
                    >
                      <option value="">{t('annotations.mountLookupPlaceholder')}</option>
                      {groupByManufacturer(MOUNT_CATALOG).map((g) => (
                        <optgroup key={g.manufacturer} label={g.manufacturer}>
                          {g.entries.map((m) => (
                            <option key={m.key} value={m.key}>
                              {m.model} — {m.wormPeriodSec} s
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </div>
                )}

                <div className="mt-3 flex items-start gap-3">
                  <NumAttr
                    label={t('annotations.wormPeriodLabel')}
                    unit={t('annotations.wormPeriodUnit')}
                    value={modal.wormPeriodText}
                    placeholder={t('annotations.unknownPlaceholder')}
                    title={wrapTip(t('annotations.wormPeriodTooltip'))}
                    onChange={setDraftWormPeriod}
                  />
                  <NumAttr
                    label={t('annotations.imagingScaleLabel')}
                    unit={t('annotations.imagingScaleUnit')}
                    value={modal.imagingScaleText}
                    placeholder={t('annotations.unknownPlaceholder')}
                    title={wrapTip(t('annotations.imagingScaleTooltip'))}
                    onChange={setDraftImagingScale}
                  />
                </div>

                <label
                  className="mt-3 flex cursor-pointer items-center gap-2 text-xs text-slate-300"
                  title={wrapTip(t('annotations.encodersTooltip'))}
                >
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 cursor-pointer accent-sky-600"
                    checked={modal.hasEncoders}
                    onChange={(e) => setDraftHasEncoders(e.target.checked)}
                  />
                  {t('annotations.encodersLabel')}
                </label>

                <p className="mt-2 text-[10px] leading-relaxed text-slate-600">
                  {t('annotations.attrsHint')}
                </p>
              </div>

              <label className="mb-1 mt-4 block text-[10px] uppercase tracking-wide text-slate-500">
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

        <div className="flex flex-shrink-0 items-center gap-2 border-t border-slate-800 px-4 py-2.5">
          {isFirstOpen ? (
            <>
              <button
                className="rounded bg-sky-600 px-3 py-1 text-xs font-medium text-white hover:bg-sky-500"
                onClick={() => void save()}
                title={t('annotations.save')}
              >
                {t('annotations.save')}
              </button>
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
            // Edit mode: Clear (blank the annotation) on the far left, then
            // Cancel + Save grouped on the right with Save rightmost.
            <>
              <button
                className="rounded border border-red-900 px-3 py-1 text-xs text-red-400 hover:bg-red-950/40 disabled:cursor-not-allowed disabled:opacity-40"
                onClick={() => void clearCurrent()}
                disabled={!hasContent}
                title={t('annotations.clearTooltip')}
              >
                {t('annotations.clear')}
              </button>
              <button
                className="ms-auto rounded px-3 py-1 text-xs text-slate-400 hover:text-slate-200"
                onClick={() => close()}
                title={t('annotations.cancelTooltip')}
              >
                {t('annotations.cancel')}
              </button>
              <button
                className="rounded bg-sky-600 px-3 py-1 text-xs font-medium text-white hover:bg-sky-500"
                onClick={() => void save()}
                title={t('annotations.save')}
              >
                {t('annotations.save')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
