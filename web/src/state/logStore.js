import { create } from 'zustand';
import { parseLog } from '../parser';
import { putRecent } from '../storage/recents';
export const useLogStore = create((set) => ({
    log: null,
    meta: null,
    selectedSection: 0,
    loading: false,
    error: null,
    loadFromText: async (text, name, opts) => {
        set({ loading: true, error: null });
        try {
            const log = parseLog(text);
            let recentId = null;
            if (opts?.persist !== false) {
                recentId = await putRecent({ name, size: text.length, text });
            }
            set({
                log,
                meta: { name, size: text.length, recentId },
                selectedSection: log.sections.length > 0 ? 0 : -1,
                loading: false,
            });
        }
        catch (e) {
            set({ loading: false, error: e instanceof Error ? e.message : String(e) });
        }
    },
    selectSection: (i) => set({ selectedSection: i }),
    clear: () => set({ log: null, meta: null, selectedSection: 0, error: null }),
}));
