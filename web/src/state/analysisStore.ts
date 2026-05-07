import { create } from 'zustand';
import { analyze, type GARun } from '../parser/analyze';
import type { GuideSession } from '../parser/types';

export type AnalysisKind = 'all' | 'all-raw-ra' | 'unguided';

interface ClosedState {
  state: 'closed';
}

/**
 * Source parameters retained from the call that opened the modal so the
 * user can switch between analysis modes ('all' ↔ 'all-raw-ra') in-place
 * without going back to the chart context menu. `null` for `unguided`
 * runs because that mode pinpoints a specific unguided window — there's
 * no equivalent "raw" version to flip into.
 */
interface AnalysisSource {
  session: GuideSession;
  range: { begin: number; end: number };
  mask: Uint8Array | undefined;
}

interface OpenState {
  state: 'open';
  garun: GARun;
  kind: AnalysisKind;
  source: AnalysisSource | null;
  showRa: boolean;
  showDec: boolean;
  /** Modal-local override of the global scale mode. */
  scaleMode: 'PIXELS' | 'ARCSEC';
  /**
   * Top-N peaks summary excludes any period above this threshold (seconds).
   * Default 600s — typical PE periods are well below 10 minutes; longer
   * "peaks" are usually drift artifacts that would dominate the summary
   * if not filtered.
   */
  maxPeriodSec: number;
}

type AnalysisStateUnion = ClosedState | OpenState;

interface Actions {
  open: (p: {
    garun: GARun;
    kind: AnalysisKind;
    initialScaleMode: 'PIXELS' | 'ARCSEC';
    /**
     * Source data for in-modal mode switching. Required for kind 'all' /
     * 'all-raw-ra' — without it the mode tabs won't work. Optional for
     * 'unguided' where the mode is fixed.
     */
    source?: AnalysisSource;
  }) => void;
  close: () => void;
  setShowRa: (b: boolean) => void;
  setShowDec: (b: boolean) => void;
  setScaleMode: (m: 'PIXELS' | 'ARCSEC') => void;
  setMaxPeriodSec: (s: number) => void;
  /**
   * Switch between 'all' and 'all-raw-ra' without leaving the modal. Re-
   * runs `analyze()` against the saved source and replaces `garun`.
   * No-ops when `source` is null (unguided runs) or when the requested
   * kind matches the current one.
   */
  setKind: (kind: AnalysisKind) => void;
}

const DEFAULT_MAX_PERIOD_SEC = 600;

/**
 * Tracks whether the Analysis modal is open and what GARun result it's
 * showing. Not persisted — closing forgets the state. Modal toolbar
 * controls (showRa, showDec, scaleMode, maxPeriodSec) live here so reopening
 * the modal starts from the global defaults again.
 */
export const useAnalysisStore = create<AnalysisStateUnion & Actions>((set, get) => ({
  state: 'closed',
  open: ({ garun, kind, initialScaleMode, source }) =>
    set({
      state: 'open',
      garun,
      kind,
      source: source ?? null,
      showRa: true,
      showDec: true,
      scaleMode: initialScaleMode,
      maxPeriodSec: DEFAULT_MAX_PERIOD_SEC,
    } as OpenState),
  close: () => set({ state: 'closed' } as ClosedState),
  setShowRa: (b) => set((s) => (s.state === 'open' ? { ...s, showRa: b } : s)),
  setShowDec: (b) => set((s) => (s.state === 'open' ? { ...s, showDec: b } : s)),
  setScaleMode: (m) => set((s) => (s.state === 'open' ? { ...s, scaleMode: m } : s)),
  setMaxPeriodSec: (sec) => set((s) => (s.state === 'open' ? { ...s, maxPeriodSec: sec } : s)),
  setKind: (kind) => {
    const cur = get();
    if (cur.state !== 'open') return;
    if (cur.kind === kind) return;
    if (!cur.source) return;
    // Only the 'all' ↔ 'all-raw-ra' transition is meaningful in-modal.
    // Switching to 'unguided' from here doesn't make sense and we don't
    // expose a tab for it; guard anyway.
    if (kind !== 'all' && kind !== 'all-raw-ra') return;
    try {
      const garun = analyze(cur.source.session, {
        range: cur.source.range,
        undoRaCorrections: kind === 'all-raw-ra',
        mask: cur.source.mask,
      });
      set({ ...cur, garun, kind });
    } catch (err) {
      // canAnalyze gated the original open() call, so this should be
      // unreachable in practice; surface for diagnosis if it ever isn't.
      // eslint-disable-next-line no-console
      console.error('analyze re-run on mode switch failed:', err);
    }
  },
}));
