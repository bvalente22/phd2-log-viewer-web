import { create } from 'zustand';
import {
  getPrimaryPeriod, putPrimaryPeriod, type PrimaryPeriodRecord,
} from '../storage/primaryPeriod';

/**
 * Holds the Primary period for the currently-loaded guide log. One value per
 * log: the auto-detected dominant peak from the STRONGEST section analyzed so
 * far (`setAutoIfStronger` — a section that resolves more cycles of the worm
 * supersedes a weaker one's auto value), or the value the user typed
 * (`setEdited`, never auto-overwritten). `reset-to-auto` re-derives from the
 * current section (`setAuto`). `loadForLog` is called from logStore when a log
 * is opened, so a different log restores/clears the record and the AnalysisModal
 * effect knows the sidecar read has completed (`loadedHash`).
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
  /**
   * Store this section's auto-detected primary when it's a BETTER estimate than
   * what's stored: when nothing is stored, or the stored value is also `auto`
   * and this section resolved more cycles. Never overwrites a user `edited`
   * value. This is what makes a strong section supersede a weak one's auto.
   */
  setAutoIfStronger: (hash: string, value: number, cycles: number) => Promise<void>;
  setEdited: (hash: string, value: number) => Promise<void>;
  /** Reset-to-auto: explicitly overwrite with the current section's dominant peak. */
  setAuto: (hash: string, value: number, cycles: number) => Promise<void>;
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

  setAutoIfStronger: async (hash, value, cycles) => {
    const s = get();
    // Wait until the sidecar read for THIS hash has completed (so we don't write
    // before knowing what's stored).
    if (s.hash !== hash || s.loadedHash !== hash) return;
    const cur = s.record;
    // Keep a user edit; keep a stored auto value unless this section resolved
    // strictly more cycles (a better estimate).
    if (cur && (cur.source === 'edited' || cycles <= (cur.cycles ?? 0))) return;
    const rec = await putPrimaryPeriod({ key: hash, value, source: 'auto', cycles });
    if (get().hash !== hash) return;
    set({ record: rec });
  },

  setEdited: async (hash, value) => {
    const rec = await putPrimaryPeriod({ key: hash, value, source: 'edited' });
    if (get().hash !== hash) return;
    set({ record: rec, loadedHash: hash });
  },

  setAuto: async (hash, value, cycles) => {
    const rec = await putPrimaryPeriod({ key: hash, value, source: 'auto', cycles });
    if (get().hash !== hash) return;
    set({ record: rec, loadedHash: hash });
  },

  clear: () => set({ hash: null, record: null, loadedHash: null }),
}));
