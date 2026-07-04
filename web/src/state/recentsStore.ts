import { create } from 'zustand';
import {
  listRecents, getRecent, deleteRecent, touchRecent,
  type RecentMeta,
} from '../storage/recents';
import { useLogStore } from './logStore';

/**
 * Shared source of truth for the recents/history list so the sidebar dropdown
 * and the "More…" history window never drift out of sync. Both read `items`
 * (newest-first) and mutate through the same actions, and every action calls
 * `refresh()` at the end so a change in one view is reflected in the other.
 *
 * Records store the full log text, so opening a stored entry doesn't touch the
 * original file. A `'missing'` result only happens when the underlying record
 * was evicted (e.g. by the browser reclaiming IndexedDB space) — the caller
 * surfaces that to the user with an option to prune the dangling entry.
 */
interface RecentsState {
  items: RecentMeta[];
  /** Whether the "More…" history window is open. */
  historyOpen: boolean;
  refresh: () => Promise<void>;
  /**
   * Load a stored recent by id. On success moves it to the top of the list and
   * returns 'ok'; returns 'missing' (without pruning) when the record is gone
   * so the caller can offer to remove it.
   */
  open: (id: string) => Promise<'ok' | 'missing'>;
  remove: (id: string) => Promise<void>;
  clearAll: () => Promise<void>;
  openHistory: () => void;
  closeHistory: () => void;
}

export const useRecentsStore = create<RecentsState>((set, get) => ({
  items: [],
  historyOpen: false,

  refresh: async () => {
    const items = await listRecents();
    set({ items });
  },

  open: async (id) => {
    const rec = await getRecent(id);
    if (!rec) return 'missing';
    await touchRecent(id);
    await useLogStore.getState().loadFromText(rec.text, rec.name, { persist: false });
    await get().refresh();
    return 'ok';
  },

  remove: async (id) => {
    await deleteRecent(id);
    await get().refresh();
  },

  clearAll: async () => {
    for (const r of get().items) await deleteRecent(r.id);
    await get().refresh();
  },

  openHistory: () => set({ historyOpen: true }),
  closeHistory: () => set({ historyOpen: false }),
}));
