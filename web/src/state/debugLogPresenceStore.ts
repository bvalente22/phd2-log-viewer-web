import { create } from 'zustand';
import { getAllDebugLogHandleHashes } from '../storage/debugLogHandles';
import { getStashedDebugLogHashes } from '../storage/debugLogAccess';

/**
 * Tracks which guide logs have a companion debug log AVAILABLE — either a handle
 * remembered across sessions (drag-both, persisted) or one stashed this session.
 * Drives the "D" badge in the recents list and the current-log strip.
 *
 * `refresh()` rebuilds the set as (persisted handle hashes ∪ session-stash
 * hashes); call it on load and after a drag-both so the badge appears at once.
 */
interface DebugPresenceState {
  /** Guide-log content hashes with an available debug log. */
  hashes: Set<string>;
  refresh: () => Promise<void>;
}

export const useDebugPresenceStore = create<DebugPresenceState>((set) => ({
  hashes: new Set<string>(),
  refresh: async () => {
    const persisted = await getAllDebugLogHandleHashes();
    const stash = getStashedDebugLogHashes();
    set({ hashes: new Set<string>([...persisted, ...stash]) });
  },
}));
