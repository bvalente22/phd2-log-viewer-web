import { create } from 'zustand';
import type { GuideLog } from '../parser';
// parseLogAsync runs parseLog in a Web Worker so a multi-MB log doesn't
// block the main thread (sidebar, language picker, drop zone all stay
// interactive while parsing). Falls back to a synchronous parse when the
// Worker API isn't available (e.g. vitest jsdom).
import { parseLogAsync } from '../parser/parseLog.client';
import { putRecent } from '../storage/recents';
import { hashLogText } from '../storage/annotations';
import { useAnnotationStore } from './annotationStore';
import { usePrimaryPeriodStore } from './primaryPeriodStore';
import { useImagingSettingsStore } from './imagingSettingsStore';
import { useViewStore } from './viewStore';

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
      // Drop the previous log's per-session exclusion masks. They're keyed by
      // sessionIdx (0,1,2…), so without this a stale mask collides with the
      // new log's same-index session — and a length mismatch silently breaks
      // manual exclude/include drags until a context-menu item rebuilds it.
      useViewStore.getState().clearExclusions();
      let recentId: string | null = null;
      if (opts?.persist !== false) {
        recentId = await putRecent({ name, size: text.length, text, hash });
      }
      set({
        log,
        meta: { name, size: text.length, recentId, hash },
        selectedSection: log.sections.length > 0 ? 0 : -1,
        loading: false,
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
    useViewStore.getState().clearExclusions();
    set({ log: null, meta: null, selectedSection: 0, error: null });
  },
}));
