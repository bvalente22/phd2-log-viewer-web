import { create } from 'zustand';
import {
  getAnnotation, putAnnotation, markSeen, toMountType, DEFAULT_MOUNT_TYPE,
  type Annotation, type MountType,
} from '../storage/annotations';
import { getImagingSettings, putImagingSettings } from '../storage/imagingSettings';
import { useImagingSettingsStore } from './imagingSettingsStore';
import { dateFromFilename } from '../parser/filename';

/** Notes hard cap — see the design spec (≈32k). */
export const NOTES_MAXLEN = 32768;

type Modal =
  | null
  | {
      mode: 'edit' | 'first-open';
      key: string;
      filename: string;
      name: string;   // draft friendly name
      notes: string;  // draft notes
      /**
       * Draft mount type. Always a valid MountType (defaults to GEM).
       */
      mountType: MountType;
      /** Draft "mount has high-resolution encoders" flag. */
      hasEncoders: boolean;
      /**
       * Draft worm period and image scale are held as raw TEXT, not numbers, so
       * the user can type freely ("7.", "", "1.2") without the buffer fighting
       * them mid-keystroke. Parsed + validated on save; invalid or blank commits
       * as 0 ("unknown").
       */
      wormPeriodText: string;
      /**
       * Draft imaging scale (arcsec/pixel) as text. NOTE: this does NOT live on
       * the annotation record — it reads and writes the existing per-log
       * `imaging:` sidecar (storage/imagingSettings.ts) that the Image Impact
       * panel already owns, so a value typed here and one typed there are the
       * same stored number rather than two that can silently disagree.
       */
      imagingScaleText: string;
      /**
       * The scale as first read, so save can tell an actual edit from an
       * untouched field. Without it, opening the dialog and pressing Save would
       * write an `imaging:` record for a log that never had one.
       */
      imagingScaleOriginalText: string;
      /** Seeing FWHM carried through untouched so saving scale can't clobber it. */
      seeingFwhm: number;
    };

/** Text → stored number. Blank / invalid / ≤0 all mean "unknown" (0). Rounded to 2dp. */
export function parseAttrNumber(text: string): number {
  const v = parseFloat(text);
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Math.round(v * 100) / 100;
}

/** Stored number → text for the input. 0 ("unknown") shows as blank, not "0". */
const attrText = (v: number | undefined): string =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? String(Math.round(v * 100) / 100) : '';

interface AnnotationState {
  /** Annotation for the currently-loaded log (null if unseen/none). */
  current: Annotation | null;
  currentKey: string | null;
  /** Modal draft state, or null when no modal is open. */
  modal: Modal;
  /** Bumped on every persisted change so list views (RecentsDropdown) refetch. */
  revision: number;

  /** Called when a log loads. Sets `current`, or opens the first-open prompt. */
  loadForLog: (key: string, filename: string) => Promise<void>;
  /** Open the full editor for any log (e.g. from the file-list pencil). */
  openEditor: (key: string, filename: string) => Promise<void>;
  /** First-open prompt → expand into the full editor (keeps drafts). */
  expandToNotes: () => void;
  setDraftName: (s: string) => void;
  setDraftNotes: (s: string) => void;
  setDraftMountType: (m: MountType) => void;
  setDraftHasEncoders: (b: boolean) => void;
  setDraftWormPeriod: (s: string) => void;
  setDraftImagingScale: (s: string) => void;
  /** Persist the current modal drafts. */
  save: () => Promise<void>;
  /**
   * Set just the worm period on a log's annotation, outside the modal. Backs the
   * "also set this as the mount worm period?" prompt raised after an inline
   * Primary-period edit.
   */
  setWormPeriodForLog: (key: string, filename: string, sec: number) => Promise<Annotation>;
  /** Delete button — blank name + notes, keep the seen record (no re-prompt). */
  clearCurrentInModal: () => Promise<void>;
  /** Skip the first-open prompt — record "seen" so it never re-prompts. */
  skipFirstOpen: () => Promise<void>;
  /** Close without persisting (edit mode only). */
  close: () => void;
}

export const useAnnotationStore = create<AnnotationState>((set, get) => ({
  current: null,
  currentKey: null,
  modal: null,
  revision: 0,

  loadForLog: async (key, filename) => {
    const existing = await getAnnotation(key);
    if (existing) {
      set({ current: existing, currentKey: key });
    } else {
      // First-open prompt stays name-only (see the design spec) — the new
      // hardware attributes are edit-mode fields, so no imaging read is needed
      // on this path.
      // Default the suggested friendly name to the log's date (YYYY-MM-DD)
      // rather than its verbose PHD2 filename; fall back to the filename when
      // the name carries no date. If the user cancels/skips, no name is saved
      // and every list view falls back to the filename anyway.
      set({
        current: null,
        currentKey: key,
        modal: {
          mode: 'first-open',
          key,
          filename,
          name: dateFromFilename(filename) ?? filename,
          notes: '',
          mountType: DEFAULT_MOUNT_TYPE,
          hasEncoders: false,
          wormPeriodText: '',
          imagingScaleText: '',
          imagingScaleOriginalText: '',
          seeingFwhm: 0,
        },
      });
    }
  },

  openEditor: async (key, filename) => {
    // Two sidecars back this dialog: `anno:` (name/notes/mount) and `imaging:`
    // (scale/seeing, shared with the Image Impact panel). Read both in parallel.
    const [existing, imaging] = await Promise.all([
      getAnnotation(key),
      getImagingSettings(key),
    ]);
    set({
      modal: {
        mode: 'edit',
        key,
        filename,
        name: existing?.friendlyName ?? '',
        notes: existing?.notes ?? '',
        mountType: toMountType(existing?.mountType),
        hasEncoders: existing?.hasEncoders === true,
        wormPeriodText: attrText(existing?.wormPeriodSec),
        imagingScaleText: attrText(imaging?.imagingScale),
        imagingScaleOriginalText: attrText(imaging?.imagingScale),
        seeingFwhm: imaging?.seeingFwhm ?? 0,
      },
    });
  },

  expandToNotes: () =>
    set((st) => (st.modal ? { modal: { ...st.modal, mode: 'edit' } } : st)),

  setDraftName: (s) =>
    set((st) => (st.modal ? { modal: { ...st.modal, name: s } } : st)),

  setDraftNotes: (s) =>
    set((st) => (st.modal ? { modal: { ...st.modal, notes: s.slice(0, NOTES_MAXLEN) } } : st)),

  setDraftMountType: (m) =>
    set((st) => (st.modal ? { modal: { ...st.modal, mountType: toMountType(m) } } : st)),

  setDraftHasEncoders: (b) =>
    set((st) => (st.modal ? { modal: { ...st.modal, hasEncoders: b === true } } : st)),

  setDraftWormPeriod: (s) =>
    set((st) => (st.modal ? { modal: { ...st.modal, wormPeriodText: s } } : st)),

  setDraftImagingScale: (s) =>
    set((st) => (st.modal ? { modal: { ...st.modal, imagingScaleText: s } } : st)),

  save: async () => {
    const st = get();
    if (!st.modal) return;
    const m = st.modal;
    const name = m.name.trim();
    const rec = await putAnnotation({
      key: m.key,
      filename: m.filename,
      friendlyName: name.length ? name : null,
      notes: m.notes.length ? m.notes : null,
      mountType: m.mountType,
      hasEncoders: m.hasEncoders,
      wormPeriodSec: parseAttrNumber(m.wormPeriodText),
    });

    // Imaging scale lives in the shared `imaging:` sidecar, not on the
    // annotation. Only write when it actually changed, so opening the dialog and
    // hitting Save can't stamp a record over a log that never had one. Seeing
    // FWHM is carried through from the read so we never clobber the Image Impact
    // panel's other value.
    const scale = parseAttrNumber(m.imagingScaleText);
    const prevScale = parseAttrNumber(m.imagingScaleOriginalText);
    if (scale !== prevScale) {
      await putImagingSettings({ key: m.key, imagingScale: scale, seeingFwhm: m.seeingFwhm });
      // Keep the live Image Impact panel in step when it's the same log.
      const imgStore = useImagingSettingsStore.getState();
      if (imgStore.hash === m.key) await imgStore.loadForLog(m.key);
    }

    set((s2) => ({
      modal: null,
      revision: s2.revision + 1,
      current: s2.currentKey === rec.key ? rec : s2.current,
    }));
  },

  /**
   * Persist a worm period straight onto the log's annotation without opening the
   * dialog. Used by the "also set this as the mount worm period?" prompt after
   * an inline Primary-period edit.
   */
  setWormPeriodForLog: async (key, filename, sec) => {
    const rec = await putAnnotation({ key, filename, wormPeriodSec: sec });
    set((s2) => ({
      revision: s2.revision + 1,
      current: s2.currentKey === rec.key ? rec : s2.current,
    }));
    return rec;
  },

  clearCurrentInModal: async () => {
    const st = get();
    if (!st.modal) return;
    const rec = await putAnnotation({
      key: st.modal.key,
      filename: st.modal.filename,
      friendlyName: null,
      notes: null,
    });
    set((s2) => ({
      modal: null,
      revision: s2.revision + 1,
      current: s2.currentKey === rec.key ? rec : s2.current,
    }));
  },

  skipFirstOpen: async () => {
    const st = get();
    if (!st.modal) return;
    await markSeen(st.modal.key, st.modal.filename);
    set((s2) => ({ modal: null, revision: s2.revision + 1 }));
  },

  close: () => set({ modal: null }),
}));
