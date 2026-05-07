import { create } from 'zustand';
import type { GARun } from '../parser/analyze';

export type AnalysisKind = 'all' | 'all-raw-ra' | 'unguided';

interface ClosedState {
  state: 'closed';
}

interface OpenState {
  state: 'open';
  /** The active mode's analysis result. */
  garun: GARun;
  /**
   * The other switchable mode's analysis result, kept around so the
   * periodogram can render both at once and the mode tab can swap them
   * instantly. Null for kind === 'unguided' (no comparison) and when
   * the caller didn't provide a counterpart at open() time.
   */
  garunOther: GARun | null;
  kind: AnalysisKind;
  showRa: boolean;
  showDec: boolean;
  /** Modal-local override of the global scale mode. */
  scaleMode: 'PIXELS' | 'ARCSEC';
  /**
   * Periodogram Y-axis lock value, in raw pixel-amplitude units (the same
   * units `GARun.fftAmplitude` is stored in). Null = unlocked, periodogram
   * uses Plotly autorange. Number = locked at this max so subsequent
   * data swaps (mode switch via the tabs, ARCSEC ↔ PIXELS rescale) keep
   * the same Y range — the lock is *the* mechanism for comparing peak
   * amplitudes across modes at the same scale. Stored in pixel units so
   * we can apply the active scale factor at render time without losing
   * precision.
   */
  yMaxLockPx: number | null;
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
    /** Optional counterpart run; required for the in-modal mode tabs and
     *  the dual-trace periodogram to work. Pass null / omit for 'unguided'. */
    garunOther?: GARun | null;
    kind: AnalysisKind;
    initialScaleMode: 'PIXELS' | 'ARCSEC';
  }) => void;
  close: () => void;
  setShowRa: (b: boolean) => void;
  setShowDec: (b: boolean) => void;
  setScaleMode: (m: 'PIXELS' | 'ARCSEC') => void;
  setMaxPeriodSec: (s: number) => void;
  /**
   * Switch between 'all' and 'all-raw-ra'. Swaps the active garun with
   * the precomputed counterpart — instant, no re-run. No-ops when
   * `garunOther` is null (e.g. unguided runs) or the requested kind
   * matches the current one.
   */
  setKind: (kind: AnalysisKind) => void;
  /**
   * Toggle the periodogram Y-axis lock. Pass the current observed max
   * amplitude (in pixel units, across both visible traces) when turning
   * the lock ON; the value is ignored when the lock is currently ON
   * (next call clears it).
   */
  toggleYLock: (currentMaxPx: number) => void;
}

const DEFAULT_MAX_PERIOD_SEC = 600;

/**
 * Tracks whether the Analysis modal is open and what GARun result it's
 * showing. Not persisted — closing forgets the state. Modal toolbar
 * controls (showRa, showDec, scaleMode, maxPeriodSec, yMaxLockPx) live
 * here so reopening starts from the global defaults again.
 */
export const useAnalysisStore = create<AnalysisStateUnion & Actions>((set, get) => ({
  state: 'closed',
  open: ({ garun, garunOther, kind, initialScaleMode }) =>
    set({
      state: 'open',
      garun,
      garunOther: garunOther ?? null,
      kind,
      showRa: true,
      showDec: true,
      scaleMode: initialScaleMode,
      yMaxLockPx: null,
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
    if (!cur.garunOther) return;
    if (kind !== 'all' && kind !== 'all-raw-ra') return;
    // The precomputed counterpart IS the requested kind's garun.
    set({ ...cur, garun: cur.garunOther, garunOther: cur.garun, kind });
  },
  toggleYLock: (currentMaxPx) => {
    const cur = get();
    if (cur.state !== 'open') return;
    set({ ...cur, yMaxLockPx: cur.yMaxLockPx === null ? currentMaxPx : null });
  },
}));
