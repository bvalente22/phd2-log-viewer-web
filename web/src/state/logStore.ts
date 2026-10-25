import { create } from 'zustand';
import type { GuideLog } from '../parser';
// parseLogAsync runs parseLog in a Web Worker so a multi-MB log doesn't
// block the main thread (sidebar, language picker, drop zone all stay
// interactive while parsing). Falls back to a synchronous parse when the
// Worker API isn't available (e.g. vitest jsdom).
import { parseLogAsync } from '../parser/parseLog.client';
import { putRecent } from '../storage/recents';
import { hashLogText } from '../storage/annotations';
import {
  getSectionFilters, putSectionFilters, type SectionFiltersRecord,
} from '../storage/sectionFilters';
import { useAnnotationStore } from './annotationStore';
import { usePrimaryPeriodStore } from './primaryPeriodStore';
import { useImagingSettingsStore } from './imagingSettingsStore';
import { useViewStore, type SettlingPolicy } from './viewStore';

export interface LogMeta {
  name: string;
  size: number;
  recentId: string | null;
  hash: string;
}

interface LogState {
  log: GuideLog | null;
  meta: LogMeta | null;
  selectedSection: number;
  loading: boolean;
  error: string | null;
  loadFromText: (text: string, name: string, opts?: { persist?: boolean }) => Promise<void>;
  selectSection: (i: number) => void;
  clear: () => void;
}

export const useLogStore = create<LogState>((set) => ({
  log: null,
  meta: null,
  selectedSection: 0,
  loading: false,
  error: null,
  loadFromText: async (text, name, opts) => {
    set({ loading: true, error: null });
    try {
      const log = await parseLogAsync(text);
      const hash = hashLogText(text);
      let recentId: string | null = null;
      if (opts?.persist !== false) {
        recentId = await putRecent({ name, size: text.length, text, hash });
      }
      const saved = await getSectionFilters(hash);
      const restored = restoreFilters(log, saved);
      // Swap in this log's per-session exclusion masks (its saved ones, or
      // none) in the same synchronous block as `set({ log })`. They're keyed by
      // sessionIdx (0,1,2…), so a stale mask would collide with the new log's
      // same-index session — and a length mismatch silently breaks manual
      // exclude/include drags until a context-menu item rebuilds it. Doing it
      // here rather than before the awaits above also means the outgoing log is
      // never shown with emptied masks, which would be saved back over its
      // filters.
      withoutFilterSaves(() => {
        useViewStore.getState().restoreExclusions(restored.exclusions, restored.settlingPolicy);
        set({
          log,
          meta: { name, size: text.length, recentId, hash },
          selectedSection: restored.selectedSection,
          loading: false,
        });
      });
      // Load the saved annotation, or fire the first-open prompt for an
      // unseen log. Fire-and-forget: the UI reacts to annotationStore.
      void useAnnotationStore.getState().loadForLog(hash, name);
      // Load this log's persisted Primary period (one value per log); a
      // different log has no record so Analysis recomputes it from scratch.
      void usePrimaryPeriodStore.getState().loadForLog(hash);
      void useImagingSettingsStore.getState().loadForLog(hash);
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },
  selectSection: (i) => set({ selectedSection: i }),
  clear: () => {
    usePrimaryPeriodStore.getState().clear();
    useImagingSettingsStore.getState().clear();
    // Closing the log must not save its emptied masks over its stored filters.
    withoutFilterSaves(() => {
      useViewStore.getState().clearExclusions();
      set({ log: null, meta: null, selectedSection: 0, error: null });
    });
  },
}));

// ---- Per-log filter persistence --------------------------------------------
// Each change to a guiding section's exclusions / settling policy, or to the
// selected section, is written (debounced) to the open log's `filters:` sidecar
// so the log reopens where it left off. The hash and state are captured when
// the change happens, so a save still pending when the next log loads lands on
// the log it belongs to.

const FILTER_SAVE_DEBOUNCE_MS = 300;

/** Saved filters → viewStore Maps + selection, dropping anything that doesn't
 *  fit this log (wrong-length mask, unknown session, out-of-range section). */
function restoreFilters(log: GuideLog, rec: SectionFiltersRecord | undefined) {
  const exclusions = new Map<number, Uint8Array>();
  const settlingPolicy = new Map<number, SettlingPolicy>();
  for (const [idx, mask] of rec?.masks ?? []) {
    const session = log.sessions[idx];
    // ArrayBuffer.isView, not `instanceof`: a structured-clone read can hand
    // back a typed array from another realm. Copied so the store owns a plain
    // Uint8Array either way.
    if (session && ArrayBuffer.isView(mask) && mask.length === session.entries.length) {
      exclusions.set(idx, new Uint8Array(mask));
    }
  }
  for (const [idx, policy] of rec?.policies ?? []) {
    if (log.sessions[idx] && (policy === 'desktop' || policy === 'web')) settlingPolicy.set(idx, policy);
  }
  const sel = rec?.selectedSection;
  const selectedSection = typeof sel === 'number' && sel >= 0 && sel < log.sections.length
    ? sel
    : log.sections.length > 0 ? 0 : -1;
  return { exclusions, settlingPolicy, selectedSection };
}

let suppressFilterSaves = false;
let pendingFilterSave: { hash: string; timer: ReturnType<typeof setTimeout>; run: () => Promise<void> } | null = null;

/** Run store updates that restore or discard filters without saving them back. */
function withoutFilterSaves(fn: () => void) {
  suppressFilterSaves = true;
  try { fn(); } finally { suppressFilterSaves = false; }
}

function scheduleFilterSave() {
  if (suppressFilterSaves) return;
  const { meta, selectedSection } = useLogStore.getState();
  if (!meta) return;
  const { exclusions, settlingPolicy } = useViewStore.getState();
  const rec = {
    key: meta.hash,
    selectedSection,
    masks: [...exclusions],
    policies: [...settlingPolicy],
  };
  // A pending save for a different log is flushed now rather than dropped.
  if (pendingFilterSave) {
    clearTimeout(pendingFilterSave.timer);
    if (pendingFilterSave.hash !== meta.hash) void pendingFilterSave.run();
  }
  const run = async () => {
    if (pendingFilterSave?.run === run) pendingFilterSave = null;
    await putSectionFilters(rec);
  };
  pendingFilterSave = { hash: meta.hash, timer: setTimeout(run, FILTER_SAVE_DEBOUNCE_MS), run };
}

/** Write any debounced filter save immediately (page hide; tests). */
export async function flushSectionFilterSave(): Promise<void> {
  const p = pendingFilterSave;
  if (!p) return;
  clearTimeout(p.timer);
  await p.run();
}

useViewStore.subscribe((s, prev) => {
  if (s.exclusions !== prev.exclusions || s.settlingPolicy !== prev.settlingPolicy) scheduleFilterSave();
});
useLogStore.subscribe((s, prev) => {
  // A meta change is a log load/close, which restores rather than edits.
  if (s.selectedSection !== prev.selectedSection && s.meta === prev.meta) scheduleFilterSave();
});
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => { void flushSectionFilterSave(); });
}
