import { create } from 'zustand';
import type { BltSequence } from '../parser/parseBlt';
import { parseDebugLogFile } from '../parser/parseBlt';
import { putBltCache, getBltCache, clearBltCache } from '../storage/bltCache';

/**
 * Backlash Analyzer state. Loaded debug-log results are cached per
 * guide-log filename so reopening the same guide log restores the
 * analysis instantly without re-parsing the (40 MB) debug file.
 */
interface BltState {
  /** Guide log filename the current sequences belong to. Empty means no
   *  guide log has been associated yet (e.g. the modal is sitting on a
   *  Calibration section before a guide log has been opened). */
  guideLogName: string;
  /** Filename of the loaded debug log, if any. */
  debugLogName: string | null;
  /** Size of the debug log in bytes, just for display. */
  debugLogSize: number;
  /** Parsed BLT sequences. */
  sequences: BltSequence[];
  /** Index into `sequences` of the currently-displayed run. -1 = none. */
  selectedIndex: number;
  /** True while parseDebugLogFile is running. */
  loading: boolean;
  /** Last error message, or null. */
  error: string | null;
}

interface BltActions {
  /** Set the guide log this BLT analysis belongs to. Called when the
   *  parent app opens a guide log. Loads the cached BLT result for the
   *  new guide log if any, else clears state to "drop a debug log". */
  bindToGuideLog: (guideLogName: string) => Promise<void>;
  /** Parse a debug log file dropped or picked by the user. Caches the
   *  result against the bound guide log. */
  loadDebugLog: (file: File) => Promise<void>;
  /** Drop the cached BLT analysis for the bound guide log. */
  clearCurrent: () => Promise<void>;
  /** Pick which sequence to display. */
  setSelectedIndex: (idx: number) => void;
  /** Direct setter — used when restoring state without round-tripping
   *  through IndexedDB (e.g. unit tests). */
  setError: (msg: string | null) => void;
}

export const useBltStore = create<BltState & BltActions>((set, get) => ({
  guideLogName: '',
  debugLogName: null,
  debugLogSize: 0,
  sequences: [],
  selectedIndex: -1,
  loading: false,
  error: null,

  bindToGuideLog: async (guideLogName) => {
    if (get().guideLogName === guideLogName) return;
    // Reset state immediately so the UI doesn't flash the previous log's
    // results while we wait on IDB.
    set({
      guideLogName,
      debugLogName: null,
      debugLogSize: 0,
      sequences: [],
      selectedIndex: -1,
      error: null,
    });
    if (!guideLogName) return;
    const cached = await getBltCache(guideLogName);
    if (!cached) return;
    // Binding may have changed while IDB was reading — bail if so.
    if (get().guideLogName !== guideLogName) return;
    set({
      debugLogName: cached.debugLogName,
      debugLogSize: cached.debugLogSize,
      sequences: cached.sequences,
      selectedIndex: cached.sequences.length > 0 ? 0 : -1,
    });
  },

  loadDebugLog: async (file) => {
    const guideLogName = get().guideLogName;
    set({ loading: true, error: null });
    try {
      const sequences = await parseDebugLogFile(file);
      // Cache against the bound guide log, if any.
      if (guideLogName) {
        await putBltCache({
          guideLogName,
          debugLogName: file.name,
          debugLogSize: file.size,
          sequences,
        });
      }
      set({
        debugLogName: file.name,
        debugLogSize: file.size,
        sequences,
        selectedIndex: sequences.length > 0 ? 0 : -1,
        loading: false,
        error: sequences.length === 0 ? 'noSequences' : null,
      });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : 'parseFailed',
      });
    }
  },

  clearCurrent: async () => {
    const guideLogName = get().guideLogName;
    if (guideLogName) await clearBltCache(guideLogName);
    set({
      debugLogName: null,
      debugLogSize: 0,
      sequences: [],
      selectedIndex: -1,
      error: null,
    });
  },

  setSelectedIndex: (idx) => {
    const { sequences } = get();
    if (idx < 0 || idx >= sequences.length) return;
    set({ selectedIndex: idx });
  },

  setError: (msg) => set({ error: msg }),
}));
