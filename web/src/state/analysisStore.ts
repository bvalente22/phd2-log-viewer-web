import { create } from 'zustand';
import type { GARun } from '../parser/analyze';

export type AnalysisKind = 'all' | 'all-raw-ra' | 'unguided';

interface ClosedState {
  state: 'closed';
}

interface OpenState {
  state: 'open';
  garun: GARun;
  kind: AnalysisKind;
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
  open: (p: { garun: GARun; kind: AnalysisKind; initialScaleMode: 'PIXELS' | 'ARCSEC' }) => void;
  close: () => void;
  setShowRa: (b: boolean) => void;
  setShowDec: (b: boolean) => void;
  setScaleMode: (m: 'PIXELS' | 'ARCSEC') => void;
  setMaxPeriodSec: (s: number) => void;
}

const DEFAULT_MAX_PERIOD_SEC = 600;

/**
 * Tracks whether the Analysis modal is open and what GARun result it's
 * showing. Not persisted — closing forgets the state. Modal toolbar
 * controls (showRa, showDec, scaleMode, maxPeriodSec) live here so reopening
 * the modal starts from the global defaults again.
 */
export const useAnalysisStore = create<AnalysisStateUnion & Actions>((set) => ({
  state: 'closed',
  open: ({ garun, kind, initialScaleMode }) =>
    set({
      state: 'open',
      garun,
      kind,
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
}));
