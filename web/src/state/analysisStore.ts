import { create } from 'zustand';
import type { GARun } from '../parser/analyze';
import { analyzeSpikes, type SpikeAxis, type SpikeRun } from '../parser/spikeAnalysis';
import type { GuideSession } from '../parser/types';

export type AnalysisKind = 'all' | 'all-raw-ra' | 'unguided' | 'spike';

interface ClosedState {
  state: 'closed';
}

/**
 * Source params kept around for spike-mode recompute. The k slider and
 * RA/Dec axis switch both need to re-run analyzeSpikes on the same
 * underlying data, so we hold the session ref + range + mask. Lazy-
 * filled when the user enters spike mode for the first time so we don't
 * pay the analyze cost for users who never open the spike tab.
 */
interface SpikeSource {
  session: GuideSession;
  range: { begin: number; end: number };
  mask: Uint8Array | undefined;
}

interface OpenState {
  state: 'open';
  /** The active mode's GA-style analysis result. Stays populated even
   *  while spike mode is active so a subsequent return to residual /
   *  raw-RA doesn't pay a re-compute. */
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
   * units `GARun.fftAmplitude` is stored in). Null = unlocked. Number =
   * locked at this max — the chart pins its Y range to [0, yMaxLockPx*k]
   * regardless of mode swaps or ARCSEC↔PIXELS rescales. Stored in pixel
   * units so we can apply the active scale factor at render time without
   * losing precision.
   */
  yMaxLockPx: number | null;
  /**
   * The current rendered Y-axis max, in raw pixel-amplitude units. Tracks
   * whatever Plotly is showing — autorange's chosen max on first settle,
   * the user's drag-zoom value after a manual gesture, etc. Persisted in
   * the store (rather than left to Plotly's internal state) so mode swaps
   * via the tabs don't reset to autorange — the user's zoom carries
   * across the swap, which is the whole point of the comparison view.
   * When `yMaxLockPx` is non-null, the lock takes precedence and updates
   * to this field are ignored.
   */
  yMaxViewPx: number | null;
  /**
   * Drift chart's current X-axis range (seconds). Tracked here so hover-
   * induced React re-renders can feed it back into the layout instead of
   * clobbering the user's pan with the original autorange-derived
   * `xExtent`. Null = fall back to data-derived default.
   */
  driftXRangeView: [number, number] | null;
  /**
   * Periodogram's current X-axis range in **log10 space** (Plotly's
   * native unit for log-scale axes). Tracked for the same reason the
   * drift X is tracked — hover re-renders must not snap pan back to the
   * data-derived default. Persists across mode swaps too.
   */
  periodXRangeViewLog: [number, number] | null;
  /**
   * Top-N peaks summary excludes any period above this threshold (seconds).
   * Default 600s — typical PE periods are well below 10 minutes; longer
   * "peaks" are usually drift artifacts that would dominate the summary
   * if not filtered.
   */
  maxPeriodSec: number;
  /**
   * Spike Analysis state. Populated lazily when the user first switches
   * to kind='spike'. The source ref is kept so the k slider and RA/Dec
   * axis switch can re-run analyzeSpikes against the same data.
   */
  spikeSource: SpikeSource | null;
  spikeRun: SpikeRun | null;
  /** Active axis for spike analysis. */
  spikeAxis: SpikeAxis;
  /** Sigma multiplier (k). UI exposes a slider over [1, 6]. */
  spikeK: number;
  /**
   * Optional minimum-period filter for the top-3 spike periods list,
   * in seconds. Useful for excluding PHD2's algorithmic-echo peak (~10-
   * 20s) so the user-facing top-3 surfaces only meaningful periodic
   * behavior. Null = no filter.
   */
  spikeMinPeriodSec: number | null;
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
    /** Source params for the spike recompute path. Required to enable
     *  the spike tab; optional to allow callers (e.g. unguided runs) to
     *  open the modal without spike support. */
    spikeSource?: SpikeSource;
  }) => void;
  close: () => void;
  setShowRa: (b: boolean) => void;
  setShowDec: (b: boolean) => void;
  setScaleMode: (m: 'PIXELS' | 'ARCSEC') => void;
  setMaxPeriodSec: (s: number) => void;
  /**
   * Switch between any two modes. 'all' ↔ 'all-raw-ra' swaps the
   * precomputed garun pair; switching INTO 'spike' lazily computes the
   * SpikeRun (or reuses an existing one). Switching back to 'all' from
   * 'spike' is a free state change — the GA garun stays around.
   */
  setKind: (kind: AnalysisKind) => void;
  /**
   * Toggle the periodogram Y-axis lock. Pass the current observed max
   * amplitude (in pixel units, across both visible traces) as a fallback
   * — used only when the user toggles ON without ever having interacted
   * with the chart, in which case `yMaxViewPx` is null and we fall back
   * to the data max.
   */
  toggleYLock: (fallbackMaxPx: number) => void;
  /**
   * Capture the current rendered Y-axis max into `yMaxViewPx`. Called
   * by the periodogram on every plotly_relayout that touches the y range
   * (autorange settles, drag-zoom from useChartGestures, etc.). No-op
   * when `yMaxLockPx` is non-null — the lock pins the value and we don't
   * want autorange or stray events to overwrite the locked zoom.
   */
  setYMaxView: (maxPx: number | null) => void;
  /**
   * Drop the user's manual zoom and return the periodogram to autorange.
   * Useful as a "reset zoom" affordance once the user has dragged the
   * Y axis around. No-op when locked (the lock pins the value).
   */
  resetYZoom: () => void;
  /** Update the drift chart's tracked X range (seconds). */
  setDriftXRange: (range: [number, number] | null) => void;
  /** Update the periodogram's tracked X range (log10 space). */
  setPeriodXRangeLog: (range: [number, number] | null) => void;
  /** Switch which axis spike analysis is computed against. Triggers a
   *  re-run of analyzeSpikes against the saved source. */
  setSpikeAxis: (axis: SpikeAxis) => void;
  /** Update the sigma multiplier and re-run analyzeSpikes. */
  setSpikeK: (k: number) => void;
  /** Optional minimum-period filter for the top-3 list. Null clears it. */
  setSpikeMinPeriod: (sec: number | null) => void;
}

const DEFAULT_MAX_PERIOD_SEC = 600;
const DEFAULT_SPIKE_K = 3;

/**
 * Tracks whether the Analysis modal is open and what GARun result it's
 * showing. Not persisted — closing forgets the state. Modal toolbar
 * controls (showRa, showDec, scaleMode, maxPeriodSec, yMaxLockPx) live
 * here so reopening starts from the global defaults again.
 */
export const useAnalysisStore = create<AnalysisStateUnion & Actions>((set, get) => ({
  state: 'closed',
  open: ({ garun, garunOther, kind, initialScaleMode, spikeSource }) =>
    set({
      state: 'open',
      garun,
      garunOther: garunOther ?? null,
      kind,
      showRa: true,
      showDec: true,
      scaleMode: initialScaleMode,
      yMaxLockPx: null,
      yMaxViewPx: null,
      driftXRangeView: null,
      periodXRangeViewLog: null,
      maxPeriodSec: DEFAULT_MAX_PERIOD_SEC,
      spikeSource: spikeSource ?? null,
      spikeRun: null,
      spikeAxis: 'ra',
      spikeK: DEFAULT_SPIKE_K,
      spikeMinPeriodSec: null,
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
    // 'all' ↔ 'all-raw-ra': O(1) swap of the precomputed garun pair.
    if (kind === 'all' || kind === 'all-raw-ra') {
      if (!cur.garunOther) return;
      // Only swap if the requested kind is the counterpart; otherwise the
      // garun fields would get out of sync with `kind`.
      const swapEligible = (cur.kind === 'all' && kind === 'all-raw-ra')
        || (cur.kind === 'all-raw-ra' && kind === 'all');
      if (!swapEligible) {
        // From 'spike' or 'unguided' back to a precomputed kind — only
        // valid if the existing garun matches the requested kind. Compare
        // by undoRaCorrections flag.
        if (kind === 'all' && cur.garun.undoRaCorrections === false) {
          set({ ...cur, kind });
        } else if (kind === 'all-raw-ra' && cur.garun.undoRaCorrections === true) {
          set({ ...cur, kind });
        } else if (cur.garunOther && (
          (kind === 'all' && cur.garunOther.undoRaCorrections === false)
          || (kind === 'all-raw-ra' && cur.garunOther.undoRaCorrections === true)
        )) {
          set({ ...cur, garun: cur.garunOther, garunOther: cur.garun, kind });
        }
        return;
      }
      set({ ...cur, garun: cur.garunOther, garunOther: cur.garun, kind });
      return;
    }
    // 'spike': lazily compute SpikeRun if not already cached.
    if (kind === 'spike') {
      if (!cur.spikeSource) return; // caller didn't provide source
      const run = analyzeSpikes(cur.spikeSource.session, {
        range: cur.spikeSource.range,
        mask: cur.spikeSource.mask,
        axis: cur.spikeAxis,
        k: cur.spikeK,
      });
      set({ ...cur, kind, spikeRun: run });
      return;
    }
    // 'unguided' isn't reachable from setKind — it's set at open() time.
  },
  toggleYLock: (fallbackMaxPx) => {
    const cur = get();
    if (cur.state !== 'open') return;
    if (cur.yMaxLockPx !== null) {
      // Already locked → release. Leave yMaxViewPx alone so the chart
      // returns to whatever the user was zoomed to before the lock.
      set({ ...cur, yMaxLockPx: null });
    } else {
      // Lock at the user's current zoom if known, otherwise at the data
      // max passed in by the modal. Either gives the user a stable
      // baseline for cross-mode comparison.
      set({ ...cur, yMaxLockPx: cur.yMaxViewPx ?? fallbackMaxPx });
    }
  },
  setYMaxView: (maxPx) => {
    const cur = get();
    if (cur.state !== 'open') return;
    if (cur.yMaxLockPx !== null) return; // lock pins the value; ignore.
    if (cur.yMaxViewPx === maxPx) return; // no-op
    set({ ...cur, yMaxViewPx: maxPx });
  },
  resetYZoom: () => {
    const cur = get();
    if (cur.state !== 'open') return;
    if (cur.yMaxLockPx !== null) return;
    if (cur.yMaxViewPx === null) return;
    set({ ...cur, yMaxViewPx: null });
  },
  setDriftXRange: (range) => {
    const cur = get();
    if (cur.state !== 'open') return;
    set({ ...cur, driftXRangeView: range });
  },
  setPeriodXRangeLog: (range) => {
    const cur = get();
    if (cur.state !== 'open') return;
    set({ ...cur, periodXRangeViewLog: range });
  },
  setSpikeAxis: (axis) => {
    const cur = get();
    if (cur.state !== 'open') return;
    if (cur.spikeAxis === axis) return;
    if (!cur.spikeSource) {
      set({ ...cur, spikeAxis: axis });
      return;
    }
    const run = analyzeSpikes(cur.spikeSource.session, {
      range: cur.spikeSource.range,
      mask: cur.spikeSource.mask,
      axis,
      k: cur.spikeK,
    });
    // Reset Y-axis tracking on axis flip — the value scale (RA vs Dec)
    // can differ wildly and the previous zoom would be meaningless.
    set({ ...cur, spikeAxis: axis, spikeRun: run, yMaxLockPx: null, yMaxViewPx: null, periodXRangeViewLog: null });
  },
  setSpikeK: (k) => {
    const cur = get();
    if (cur.state !== 'open') return;
    if (cur.spikeK === k) return;
    if (!cur.spikeSource) {
      set({ ...cur, spikeK: k });
      return;
    }
    const run = analyzeSpikes(cur.spikeSource.session, {
      range: cur.spikeSource.range,
      mask: cur.spikeSource.mask,
      axis: cur.spikeAxis,
      k,
    });
    set({ ...cur, spikeK: k, spikeRun: run });
  },
  setSpikeMinPeriod: (sec) => {
    const cur = get();
    if (cur.state !== 'open') return;
    set({ ...cur, spikeMinPeriodSec: sec });
  },
}));
