import { create } from 'zustand';
import type { GuideLog } from '../parser';
// parseLogAsync runs parseLog in a Web Worker so a multi-MB log doesn't
// block the main thread (sidebar, language picker, drop zone all stay
// interactive while parsing). Falls back to a synchronous parse when the
// Worker API isn't available (e.g. vitest jsdom).
import { parseLogAsync } from '../parser/parseLog.client';
import { putRecent } from '../storage/recents';

export interface LogMeta {
  name: string;
  size: number;
  recentId: string | null;
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
      let recentId: string | null = null;
      if (opts?.persist !== false) {
        recentId = await putRecent({ name, size: text.length, text });
      }
      set({
        log,
        meta: { name, size: text.length, recentId },
        selectedSection: log.sections.length > 0 ? 0 : -1,
        loading: false,
      });
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },
  selectSection: (i) => set({ selectedSection: i }),
  clear: () => set({ log: null, meta: null, selectedSection: 0, error: null }),
}));
