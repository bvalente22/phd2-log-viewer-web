import { create } from 'zustand';
import {
  getPrimaryPeriod, putPrimaryPeriod, type PrimaryPeriodRecord,
} from '../storage/primaryPeriod';

/**
 * Holds the Primary period for the currently-loaded guide log. One value per
 * log: the auto-detected dominant peak the first time the log is analyzed
 * (`initAuto`, written once when none is stored), or the value the user typed
 * (`setEdited`). `reset-to-auto` re-derives from the current section
 * (`setAuto`). `loadForLog` is called from logStore when a log is opened, so a
 * different log restores/clears the record and the AnalysisModal init effect
 * knows the sidecar read has completed (`loadedHash`).
 */
interface PrimaryPeriodState {
  /** Hash of the log this store currently tracks. */
  hash: string | null;
  /** The loaded/edited record, or null when the log has no stored value yet. */
  record: PrimaryPeriodRecord | null;
  /** Hash whose sidecar read has completed — gates initAuto against the
   *  load/init race (don't write an auto value before we know none is stored). */
  loadedHash: string | null;
}

interface PrimaryPeriodActions {
  loadForLog: (hash: string) => Promise<void>;
  /** Write {auto} ONLY when none is stored yet (first-section init). */
  initAuto: (hash: string, value: number) => Promise<void>;
  setEdited: (hash: string, value: number) => Promise<void>;
  /** Reset-to-auto: always overwrite with a freshly-computed dominant peak. */
  setAuto: (hash: string, value: number) => Promise<void>;
  clear: () => void;
}

export const usePrimaryPeriodStore = create<PrimaryPeriodState & PrimaryPeriodActions>((set, get) => ({
  hash: null,
  record: null,
  loadedHash: null,

  loadForLog: async (hash) => {
    set({ hash, record: null, loadedHash: null });
    const rec = await getPrimaryPeriod(hash);
    // Ignore a stale read if the active log changed while IDB was reading.
    if (get().hash !== hash) return;
    set({ record: rec ?? null, loadedHash: hash });
  },

  initAuto: async (hash, value) => {
    const s = get();
    // Only when the read for THIS hash finished and found nothing — never
    // clobber a stored value, and never write before the read completes.
    if (s.hash !== hash || s.loadedHash !== hash || s.record != null) return;
    const rec = await putPrimaryPeriod({ key: hash, value, source: 'auto' });
    if (get().hash !== hash) return;
    set({ record: rec });
  },

  setEdited: async (hash, value) => {
    const rec = await putPrimaryPeriod({ key: hash, value, source: 'edited' });
    if (get().hash !== hash) return;
    set({ record: rec, loadedHash: hash });
  },

  setAuto: async (hash, value) => {
    const rec = await putPrimaryPeriod({ key: hash, value, source: 'auto' });
    if (get().hash !== hash) return;
    set({ record: rec, loadedHash: hash });
  },

  clear: () => set({ hash: null, record: null, loadedHash: null }),
}));
