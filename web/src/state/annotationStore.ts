import { create } from 'zustand';
import {
  getAnnotation, putAnnotation, markSeen, type Annotation,
} from '../storage/annotations';
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
    };

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
  /** Persist the current modal drafts. */
  save: () => Promise<void>;
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
        },
      });
    }
  },

  openEditor: async (key, filename) => {
    const existing = await getAnnotation(key);
    set({
      modal: {
        mode: 'edit',
        key,
        filename,
        name: existing?.friendlyName ?? '',
        notes: existing?.notes ?? '',
      },
    });
  },

  expandToNotes: () =>
    set((st) => (st.modal ? { modal: { ...st.modal, mode: 'edit' } } : st)),

  setDraftName: (s) =>
    set((st) => (st.modal ? { modal: { ...st.modal, name: s } } : st)),

  setDraftNotes: (s) =>
    set((st) => (st.modal ? { modal: { ...st.modal, notes: s.slice(0, NOTES_MAXLEN) } } : st)),

  save: async () => {
    const st = get();
    if (!st.modal) return;
    const name = st.modal.name.trim();
    const rec = await putAnnotation({
      key: st.modal.key,
      filename: st.modal.filename,
      friendlyName: name.length ? name : null,
      notes: st.modal.notes.length ? st.modal.notes : null,
    });
    set((s2) => ({
      modal: null,
      revision: s2.revision + 1,
      current: s2.currentKey === rec.key ? rec : s2.current,
    }));
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
