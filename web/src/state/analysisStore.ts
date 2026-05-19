import { create } from 'zustand';
import { analyze, type GARun } from '../parser/analyze';
import { analyzeSpikes, type SpikeAxis, type SpikeDirection, type SpikeRun } from '../parser/spikeAnalysis';
import {
  analyzeBursts,
  defaultBurstOptions,
  type BurstAnalysisOptions,
  type BurstRun,
} from '../parser/burstAnalysis';
import {
  analyzeSimpleSpikes,
  type SimpleSpikeAxis,
  type SimpleSpikeDirection,
  type SimpleSpikeRun,
} from '../parser/simpleSpikeAnalysis';
import {
  analyzeManualSpikes,
  type ManualSpikeAxis,
  type ManualSpikeRun,
} from '../parser/manualSpikeAnalysis';
import type { GuideSession } from '../parser/types';

export type AnalysisKind = 'all' | 'all-raw-ra' | 'unguided' | 'spike' | 'burst' | 'simple-spike' | 'manual-spike';

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
   * When true, the FFT (`garun` + `garunOther`) is computed on every
   * `included` frame regardless of the auto-applied dither/settling
   * mask — matching the original desktop's behavior where the
   * Exclude-dithers/settling action was manual, never auto. Defaults
   * to true so the FFT output matches what the desktop produces out
   * of the box; flip it off to apply the section's exclusion mask
   * (auto-detected dithers + any user ctrl-drag exclusions) to the
   * FFT input.
   *
   * Toggling this in-modal re-runs `analyze()` for both garun + the
   * counterpart so the user can compare the masked vs. unmasked FFT
   * without leaving the modal. The Spike / Burst / Manual Spike tabs
   * keep using the original mask — they're web-only features without
   * a desktop reference to match.
   */
  useAllFramesForFFT: boolean;
  /**
   * Mask captured at open time (or null when none was provided). Held
   * alongside `useAllFramesForFFT` so toggling back from "All frames"
   * can restore the originally-active exclusions without round-tripping
   * through the view store. Never mutated after open().
   */
  originalMask: Uint8Array | undefined;
  /**
   * Spike Analysis state. Populated lazily when the user first switches
   * to kind='spike'. The source ref is kept so the k slider and RA/Dec
   * axis switch can re-run analyzeSpikes against the same data.
   */
  spikeSource: SpikeSource | null;
  spikeRun: SpikeRun | null;
  /** Active axis for spike analysis. */
  spikeAxis: SpikeAxis;
  /** Direction filter — 'both' (default), 'positive' (above median), or
   *  'negative' (below median). One-sided periodics show up cleaner
   *  when the opposite direction's events aren't muddying the fold. */
  spikeDirection: SpikeDirection;
  /** Sigma multiplier (k). UI exposes a slider over [1, 6]. */
  spikeK: number;
  /**
   * Minimum-period filter for the top-3 spike periods list, in
   * seconds. Default 8s — drops Nyquist-floor noise and bin-bleed
   * without hiding the algorithmic-echo (which sits around 10-20s
   * and is sometimes the real periodic signal the user wants to see).
   * Null = no filter.
   */
  spikeMinPeriodSec: number | null;
  /**
   * Period (in seconds) currently hovered on the periodogram in spike
   * mode. Used by SpikeChart to highlight the spike events that align
   * with this period — visualizes which events contribute to the peak
   * under the cursor. Null when no hover is active.
   */
  spikeHoverPeriod: number | null;

  /**
   * Burst Analysis state. The burst tab is a heavier signal-analysis
   * workbench (resample → detrend → energy → envelope → ACF + FFT +
   * peak-spacing → ranked candidates with harmonic flagging). Source
   * ref is kept so every knob change can re-run the pipeline against
   * the same data. Lazy-populated when the user first switches to
   * kind='burst'.
   */
  burstSource: SpikeSource | null;
  burstRun: BurstRun | null;
  burstOpts: BurstAnalysisOptions | null;
  /** True while autoAdjustBurstOpts is iterating. The Auto-adjust button
   *  uses this to disable itself + show a "tuning" indicator. The
   *  individual sliders stay enabled so the user can interrupt by
   *  dragging anything (the next setBurstOpts call clears the flag
   *  is not done here — it's a simple "best effort" loop without an
   *  explicit cancel signal because total runtime is < ~2 s). */
  burstAutoAdjusting: boolean;
  /**
   * Highest displayed-percent confidence the running auto-adjust search
   * has ever observed (or null when no run has started yet on this
   * modal open). Updated live during the search so the toolbar can
   * show progress. Reset to null at the start of each new run; it is
   * NOT cleared on stop, so the user can still see the high-water mark
   * after halting until they kick off another run.
   */
  burstAutoBestPct: number | null;
  /**
   * Set on stop when the auto-adjust search has a global best that
   * differs from the configuration the search ended at. Holds both so
   * the UI can render a "restore best vs keep current" dialog. The
   * confidence values are pre-formatted percent integers for display.
   * Cleared when the user resolves the dialog or clicks Auto adjust
   * again.
   */
  burstPendingSettle: {
    bestOpts: BurstAnalysisOptions;
    bestPct: number;
    currentPct: number;
  } | null;

  /** Simple Spikes tab state. Stripped-down spike analyzer: detrend →
   *  3σ threshold → FFT of sparse spike series → period + mean amplitude.
   *  Same source ref as the spike/burst tabs (drift-corrected RA or Dec
   *  for the modal's range). Lazily computed on first switch. */
  simpleSpikeRun: SimpleSpikeRun | null;
  simpleSpikeAxis: SimpleSpikeAxis;
  simpleSpikeDirection: SimpleSpikeDirection;

  /** Manual Spike tab state. Same detrend pipeline as Simple Spikes,
   *  but no automatic threshold detection — the user clicks samples
   *  to mark them as spikes and the displayed mean period / mean
   *  amplitude updates from those selections. */
  manualSpikeRun: ManualSpikeRun | null;
  manualSpikeAxis: ManualSpikeAxis;
  /** Per-axis selection sets. Switching the axis dropdown does NOT
   *  clear them — when the user comes back to the original axis, the
   *  picks they made are still there. The Reset button and modal close
   *  are the only ways to clear; both wipe BOTH axes. */
  manualSpikeSelections: { ra: number[]; dec: number[] };
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
  /**
   * Toggle whether the FFT analyses (`garun` + `garunOther`) use all
   * `included` frames, ignoring the auto-applied dither/settling
   * exclusion mask. When ON, the FFT matches what the original desktop
   * would compute (no auto-mask). When OFF, the original mask captured
   * at open time is used. Re-runs `analyze()` for both GARuns.
   */
  setUseAllFramesForFFT: (useAll: boolean) => void;
  /** Switch which axis spike analysis is computed against. Triggers a
   *  re-run of analyzeSpikes against the saved source. */
  setSpikeAxis: (axis: SpikeAxis) => void;
  /** Switch the direction filter (both/positive/negative). Triggers a
   *  re-run since the spike-event set changes. */
  setSpikeDirection: (dir: SpikeDirection) => void;
  /** Update the sigma multiplier and re-run analyzeSpikes. */
  setSpikeK: (k: number) => void;
  /** Optional minimum-period filter for the top-3 list. Null clears it. */
  setSpikeMinPeriod: (sec: number | null) => void;
  /** Set the hovered periodogram period (or null to clear). The spike
   *  chart subscribes to this and re-renders aligned events
   *  highlighted whenever it's non-null. */
  setSpikeHoverPeriod: (sec: number | null) => void;

  /** Patch the burst options and re-run analyzeBursts. Pass any subset
   *  of BurstAnalysisOptions; existing fields are preserved. */
  setBurstOpts: (patch: Partial<BurstAnalysisOptions>) => void;
  /** Reset every burst knob to its default value and re-run. Useful
   *  after the user has tuned far from a sensible baseline. */
  resetBurstOpts: () => void;
  /** Hill-climb the numeric burst knobs (HP, smooth, prominence,
   *  threshold, min-spacing) to maximize the top candidate's
   *  confidence. Updates the store after each parameter so the UI
   *  shows the sliders animating through the search. Stops early once
   *  any candidate hits the 'strong' rating threshold (≥ 0.7). */
  autoAdjustBurstOpts: () => Promise<void>;
  /** Resolve the post-stop settle dialog. `keepBest=true` applies the
   *  best opts the search saw; `false` keeps the current configuration.
   *  Either way clears `burstPendingSettle`. */
  resolveBurstPendingSettle: (keepBest: boolean) => void;

  /** Switch the Simple Spikes axis and re-run analyzeSimpleSpikes. */
  setSimpleSpikeAxis: (axis: SimpleSpikeAxis) => void;
  /** Switch the Simple Spikes direction filter and re-run. */
  setSimpleSpikeDirection: (dir: SimpleSpikeDirection) => void;

  /** Switch the Manual Spike axis. Clears existing selections because
   *  indices into the previous axis's array are no longer meaningful. */
  setManualSpikeAxis: (axis: ManualSpikeAxis) => void;
  /** Add a sample index to the Manual Spike selection set (no-op if
   *  already present). */
  addManualSpikePoint: (index: number) => void;
  /** Remove a sample index from the Manual Spike selection set. */
  removeManualSpikePoint: (index: number) => void;
  /** Clear the entire Manual Spike selection set. */
  resetManualSpikePoints: () => void;
  /** Replace the active-axis Manual Spike selection with every sample
   *  whose detrended Y crosses the given threshold (in arc-seconds).
   *  Positive `thresholdArc` selects samples at or above the line on
   *  the positive side of the median; negative selects samples at or
   *  below on the negative side. */
  selectManualSpikePointsByThreshold: (thresholdArc: number) => void;
}

const DEFAULT_MAX_PERIOD_SEC = 600;
const DEFAULT_SPIKE_K = 3;
// Default minimum period for the spike top-3 filter. 8s drops Nyquist-
// adjacent noise (typical PHD2 cadence is 1-3s) without hiding the
// algorithmic-echo at ~10-20s, which the user might genuinely want to
// see. They can tune this to ~30s if they want to exclude the echo.
const DEFAULT_SPIKE_MIN_PERIOD_SEC = 8;

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
      // Default OFF (auto-mask): the modal opens with the section's
      // auto-derived dither/settling mask applied. AnalysisButton /
      // ContextMenu pass `garun` already analyzed WITH the mask to
      // match this default. Flipping the toolbar toggle ON re-runs
      // analyze() with mask:undefined (full "all frames" view).
      useAllFramesForFFT: false,
      originalMask: spikeSource?.mask,
      spikeSource: spikeSource ?? null,
      spikeRun: null,
      spikeAxis: 'ra',
      spikeDirection: 'both',
      spikeK: DEFAULT_SPIKE_K,
      spikeMinPeriodSec: DEFAULT_SPIKE_MIN_PERIOD_SEC,
      spikeHoverPeriod: null,
      // Burst tab uses the same source as the spike tab — both run on
      // the drift-corrected series for the user's selected range.
      burstSource: spikeSource ?? null,
      burstRun: null,
      burstOpts: null,
      burstAutoAdjusting: false,
      burstAutoBestPct: null,
      burstPendingSettle: null,
      simpleSpikeRun: null,
      simpleSpikeAxis: 'ra',
      simpleSpikeDirection: 'both',
      manualSpikeRun: null,
      manualSpikeAxis: 'ra',
      manualSpikeSelections: { ra: [], dec: [] },
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
        direction: cur.spikeDirection,
      });
      set({ ...cur, kind, spikeRun: run });
      return;
    }
    // 'burst': lazily compute BurstRun on first open of the tab. Knob
    // changes after this go through setBurstOpts. We reuse the cached
    // burstOpts when present so re-entering the tab doesn't reset the
    // user's tuning.
    if (kind === 'burst') {
      if (!cur.burstSource) return; // caller didn't provide source
      const opts = cur.burstOpts ?? defaultBurstOptions(cur.burstSource.range);
      const run = analyzeBursts(cur.burstSource.session, {
        ...opts,
        range: cur.burstSource.range,
        mask: cur.burstSource.mask,
      });
      set({ ...cur, kind, burstOpts: opts, burstRun: run });
      return;
    }
    // 'simple-spike': stripped-down analyzer; lazy-compute on first open,
    // re-run on axis/direction change.
    if (kind === 'simple-spike') {
      if (!cur.spikeSource) return; // reuse the spike source ref
      const run = analyzeSimpleSpikes(cur.spikeSource.session, {
        range: cur.spikeSource.range,
        mask: cur.spikeSource.mask,
        axis: cur.simpleSpikeAxis,
        direction: cur.simpleSpikeDirection,
      });
      set({ ...cur, kind, simpleSpikeRun: run });
      return;
    }
    // 'manual-spike': same detrend as Simple Spikes, no detection. The
    // selections array is preserved across the lazy compute, so re-
    // entering the tab keeps the user's picks intact.
    if (kind === 'manual-spike') {
      if (!cur.spikeSource) return;
      const run = analyzeManualSpikes(cur.spikeSource.session, {
        range: cur.spikeSource.range,
        mask: cur.spikeSource.mask,
        axis: cur.manualSpikeAxis,
      });
      set({ ...cur, kind, manualSpikeRun: run });
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
  setUseAllFramesForFFT: (useAll) => {
    const cur = get();
    if (cur.state !== 'open') return;
    if (cur.useAllFramesForFFT === useAll) return;
    if (!cur.spikeSource) {
      // No source ref → can't re-analyze. Update the flag only.
      set({ ...cur, useAllFramesForFFT: useAll });
      return;
    }
    const { session, range } = cur.spikeSource;
    // Effective mask: undefined when bypassing, original when restoring.
    const mask = useAll ? undefined : cur.originalMask;
    // Keep the active kind's `undoRaCorrections` so the toggle doesn't
    // also swap Raw RA ↔ Residual. Recompute both GARuns with the new
    // mask so the in-modal tab swap stays instant.
    const undoActive = cur.garun.undoRaCorrections;
    const newGarun = analyze(session, { range, undoRaCorrections: undoActive, mask });
    const newOther = cur.garunOther
      ? analyze(session, { range, undoRaCorrections: !undoActive, mask })
      : null;
    // Drop tracked X / Y ranges — they were measured against the old
    // periodogram extent, which can shift substantially when bins
    // appear/disappear with the mask change. Plotly will recompute the
    // default range from the new garun data on next render.
    set({
      ...cur,
      useAllFramesForFFT: useAll,
      garun: newGarun,
      garunOther: newOther,
      yMaxViewPx: null,
      periodXRangeViewLog: null,
    });
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
      direction: cur.spikeDirection,
    });
    // Reset Y-axis tracking on axis flip — the value scale (RA vs Dec)
    // can differ wildly and the previous zoom would be meaningless.
    set({ ...cur, spikeAxis: axis, spikeRun: run, yMaxLockPx: null, yMaxViewPx: null, periodXRangeViewLog: null });
  },
  setSpikeDirection: (dir) => {
    const cur = get();
    if (cur.state !== 'open') return;
    if (cur.spikeDirection === dir) return;
    if (!cur.spikeSource) {
      set({ ...cur, spikeDirection: dir });
      return;
    }
    const run = analyzeSpikes(cur.spikeSource.session, {
      range: cur.spikeSource.range,
      mask: cur.spikeSource.mask,
      axis: cur.spikeAxis,
      k: cur.spikeK,
      direction: dir,
    });
    set({ ...cur, spikeDirection: dir, spikeRun: run });
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
      direction: cur.spikeDirection,
    });
    set({ ...cur, spikeK: k, spikeRun: run });
  },
  setSpikeMinPeriod: (sec) => {
    const cur = get();
    if (cur.state !== 'open') return;
    set({ ...cur, spikeMinPeriodSec: sec });
  },
  setSpikeHoverPeriod: (sec) => {
    const cur = get();
    if (cur.state !== 'open') return;
    if (cur.spikeHoverPeriod === sec) return; // no-op
    set({ ...cur, spikeHoverPeriod: sec });
  },
  setBurstOpts: (patch) => {
    const cur = get();
    if (cur.state !== 'open') return;
    if (!cur.burstSource) return;
    const base = cur.burstOpts ?? defaultBurstOptions(cur.burstSource.range);
    const opts: BurstAnalysisOptions = {
      ...base,
      ...patch,
      // Always use the source's range/mask — patch isn't allowed to
      // override scope.
      range: cur.burstSource.range,
      mask: cur.burstSource.mask,
    };
    const run = analyzeBursts(cur.burstSource.session, opts);
    set({ ...cur, burstOpts: opts, burstRun: run });
  },
  resetBurstOpts: () => {
    const cur = get();
    if (cur.state !== 'open') return;
    if (!cur.burstSource) return;
    const opts = defaultBurstOptions(cur.burstSource.range);
    const run = analyzeBursts(cur.burstSource.session, {
      ...opts,
      mask: cur.burstSource.mask,
    });
    set({ ...cur, burstOpts: opts, burstRun: run });
  },
  autoAdjustBurstOpts: async () => {
    const initial = get();
    if (initial.state !== 'open' || !initial.burstSource) return;
    // Toggle behavior: a second click while running asks for a stop.
    // Clearing the flag is enough — the running loop polls it before
    // every step and exits cleanly, then offers the user a choice
    // between the global-best opts and the current opts via the
    // settle dialog (set on the burstPendingSettle field).
    if (initial.burstAutoAdjusting) {
      set({ ...initial, burstAutoAdjusting: false });
      return;
    }
    const src = initial.burstSource;

    // Starting a new run — clear any leftover settle dialog, reset the
    // running-best indicator so the user sees fresh progress, and start
    // tuning. (Reset is disabled while running, so the only way
    // burstPendingSettle persists is if the user dismissed without
    // clicking either button, e.g. by switching tabs.)
    set({
      ...initial,
      burstAutoAdjusting: true,
      burstAutoBestPct: null,
      burstPendingSettle: null,
    });

    let opts: BurstAnalysisOptions = initial.burstOpts ?? defaultBurstOptions(src.range);

    // Apply a patch: write through to the store (so the slider visibly
    // moves), recompute the analysis, and pause briefly so the user
    // can register the change. Returns the top candidate's confidence
    // (0..1). The single source of truth — every step of the search
    // goes through this so the visualization is always honest.
    const STEP_MS = 45;
    const SETTLE_MS = 140;
    const apply = async (
      patch: Partial<BurstAnalysisOptions>,
      pauseMs = STEP_MS,
    ): Promise<number> => {
      opts = {
        ...opts,
        ...patch,
        range: src.range,
        mask: src.mask,
      };
      const run = analyzeBursts(src.session, opts);
      const after = get();
      if (after.state !== 'open') return 0;
      set({ ...after, burstOpts: opts, burstRun: run });
      await new Promise((r) => setTimeout(r, pauseMs));
      return run.candidates[0]?.confidence ?? 0;
    };

    // Polled by the search loop. The user toggling the button clears
    // burstAutoAdjusting in the click handler, so the next loop check
    // sees it false and exits gracefully.
    const isStopped = (): boolean => {
      const s = get();
      return s.state !== 'open' || !s.burstAutoAdjusting;
    };

    const currentConfidence = (): number => {
      const run = analyzeBursts(src.session, { ...opts, range: src.range, mask: src.mask });
      return run.candidates[0]?.confidence ?? 0;
    };

    // Global best tracking. Updated whenever apply() returns a higher
    // confidence than we've seen this run. The SA loop reads this for
    // its Metropolis comparison and revert path.
    let bestOpts: BurstAnalysisOptions = { ...opts };
    let bestConf = currentConfidence();

    // Track the global best across the run. Visible improvements
    // (where the displayed % ticks up) also publish to the store via
    // burstAutoBestPct so the toolbar can show progress. There's no
    // pause anymore — the post-stop settle dialog gives the user the
    // option to restore the best, so the search can keep running
    // continuously and let the user halt when they're satisfied.
    const noteIfImproved = (newConf: number) => {
      if (newConf <= bestConf) return;
      const oldPct = Math.round(bestConf * 100);
      const newPct = Math.round(newConf * 100);
      bestConf = newConf;
      bestOpts = { ...opts };
      if (newPct <= oldPct) return;
      const after = get();
      if (after.state === 'open' && after.burstAutoBestPct !== newPct) {
        set({ ...after, burstAutoBestPct: newPct });
      }
    };

    // ---------- Phase 1: warm-up coordinate descent ----------
    // Quick single-axis sweeps in order of typical impact. Anchors the
    // search in a sensible region before the multi-axis SA refines it.
    const sweep = async <K extends keyof BurstAnalysisOptions>(
      key: K,
      candidates: BurstAnalysisOptions[K][],
    ) => {
      if (isStopped()) return;
      const startVal = opts[key];
      const startConf = await apply({ [key]: startVal } as Partial<BurstAnalysisOptions>);
      let bestVal = startVal;
      let bestSweepConf = startConf;
      noteIfImproved(startConf);
      for (const v of candidates) {
        if (isStopped()) return;
        if (v === bestVal) continue;
        const conf = await apply({ [key]: v } as Partial<BurstAnalysisOptions>);
        noteIfImproved(conf);
        if (conf > bestSweepConf + 0.01) {
          bestSweepConf = conf;
          bestVal = v;
        }
        if (bestSweepConf >= 0.7) break;
      }
      if (opts[key] !== bestVal && !isStopped()) {
        await apply({ [key]: bestVal } as Partial<BurstAnalysisOptions>, SETTLE_MS);
      }
    };

    // Single warm-up pass — coordinate descent converges fast for the
    // first round and the SA phase below picks up where it leaves off.
    // Each sweep checks the stop flag so the user's stop click takes
    // effect promptly even during the warm-up.
    if (!isStopped()) await sweep('envelopeSmoothSec', [2, 4, 8, 16, 24, 40, 60, 80]);
    if (!isStopped() && currentConfidence() < 0.7)
      await sweep('highPassPeriodSec', [0, 60, 120, 200, 300]);
    if (!isStopped() && currentConfidence() < 0.7)
      await sweep('peakProminenceSigma', [0.3, 0.5, 1.0, 1.5, 2.5]);
    if (!isStopped() && currentConfidence() < 0.7)
      await sweep('peakThresholdSigma', [-0.5, 0.5, 1.0, 1.5, 2.5]);
    if (!isStopped() && currentConfidence() < 0.7)
      await sweep('minPeakSpacingSec', [5, 15, 30, 50, 80]);

    // ---------- Phase 2: multi-axis simulated annealing ----------
    // At each step pick 2-3 random knobs and perturb them together so
    // the user sees several sliders move at once. SA's acceptance
    // criterion lets us escape the local optima coordinate descent
    // gets stuck at — early steps may take worse moves on purpose
    // (the temperature controls how often) but we always remember the
    // best opts seen and settle there at the end.
    interface ParamRange {
      min: number;
      max: number;
      step: number;
    }
    const ranges: Record<string, ParamRange> = {
      envelopeSmoothSec: { min: 0, max: 120, step: 1 },
      highPassPeriodSec: { min: 0, max: 300, step: 5 },
      peakProminenceSigma: { min: 0.1, max: 4, step: 0.1 },
      peakThresholdSigma: { min: -1.5, max: 4, step: 0.1 },
      minPeakSpacingSec: { min: 1, max: 200, step: 1 },
    };
    const tunable = Object.keys(ranges) as (keyof BurstAnalysisOptions & keyof typeof ranges)[];

    // Mulberry32 PRNG so the search is reproducible across an SA run.
    // Seeded from the current confidence so different starting points
    // get different exploration paths.
    let prngState = (Math.floor(currentConfidence() * 1e6) + 0x9e3779b9) >>> 0;
    const rand = () => {
      prngState = (prngState + 0x6d2b79f5) >>> 0;
      let z = prngState;
      z = Math.imul(z ^ (z >>> 15), z | 1);
      z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
      return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
    };

    const perturb = (current: number, r: ParamRange, temperature: number): number => {
      // Move size scales with temperature: 50% of range when hot, ~5%
      // when cold. Centered Gaussian-ish (sum of two uniforms) so most
      // moves are small but occasional bigger jumps happen.
      const span = r.max - r.min;
      const scale = span * (0.05 + 0.45 * temperature);
      const delta = (rand() + rand() - 1) * scale;
      let v = current + delta;
      if (v < r.min) v = r.min;
      if (v > r.max) v = r.max;
      v = Math.round(v / r.step) * r.step;
      return v;
    };

    // bestOpts/bestConf are tracked globally above; SA refines from there.
    let temperature = 0.15;
    let sinceImprovement = 0;
    let iteration = 0;

    // Indefinite loop — runs until the user stops it (toggle button
    // clears burstAutoAdjusting). The user is in control of how long
    // to search; we keep proposing multi-axis moves and re-heating
    // when stuck, with periodic random restarts to escape global
    // optima.
    while (!isStopped()) {
      iteration++;

      // Periodic random restart — every 80 steps after stagnation, jump
      // to a completely random configuration. Most random restarts will
      // land on a worse spot and SA's reject path will revert; the
      // occasional lucky one finds a new basin of attraction.
      if (iteration % 80 === 0 && sinceImprovement > 30) {
        const jumpPatch: Partial<BurstAnalysisOptions> = {};
        for (const p of tunable) {
          const r = ranges[p];
          const span = r.max - r.min;
          let v = r.min + rand() * span;
          v = Math.round(v / r.step) * r.step;
          (jumpPatch as Record<string, number>)[p] = v;
        }
        const jumpConf = await apply(jumpPatch);
        const beat = jumpConf > bestConf;
        noteIfImproved(jumpConf);
        if (beat) {
          sinceImprovement = 0;
        } else {
          await apply(bestOpts);
        }
        // Re-heat after a restart so the next steps can keep exploring.
        temperature = 0.18;
        continue;
      }

      // Pick 2 or 3 random knobs to perturb together.
      const k = 2 + Math.floor(rand() * 2);
      const shuffled = [...tunable].sort(() => rand() - 0.5);
      const picked = shuffled.slice(0, k);

      const patch: Partial<BurstAnalysisOptions> = {};
      for (const p of picked) {
        const cur = opts[p] as number;
        (patch as Record<string, number>)[p] = perturb(cur, ranges[p], temperature);
      }

      const conf = await apply(patch);
      if (isStopped()) break;
      const prevBest = bestConf;
      noteIfImproved(conf);
      const dE = conf - prevBest;

      if (dE > 0) {
        sinceImprovement = 0;
      } else if (rand() < Math.exp(dE / temperature)) {
        sinceImprovement++;
      } else {
        await apply(bestOpts);
        sinceImprovement++;
      }

      // Slow cooling so an indefinite run doesn't freeze fast.
      temperature *= 0.985;

      // Re-heat if we've stalled.
      if (sinceImprovement > 15) {
        temperature = Math.min(0.18, temperature * 4);
        sinceImprovement = 0;
      }
    }

    // ---------- Stop handler ----------
    // The user's intent on Stop varies — sometimes they want the global
    // best the search ever saw, sometimes they want to lock in whatever
    // shape they were watching when they clicked. Don't auto-apply
    // either; offer both via the settle dialog. The dialog is shown
    // only when there's a meaningful difference (≥ 1 percentage point).
    const finalState = get();
    if (finalState.state === 'open') {
      const sameAsBest = tunable.every((k) => (opts[k] as number) === (bestOpts[k] as number));
      const currentConf = finalState.burstRun?.candidates[0]?.confidence ?? 0;
      const currentPct = Math.round(currentConf * 100);
      const bestPct = Math.round(bestConf * 100);
      const showDialog = !sameAsBest && bestPct > currentPct;
      set({
        ...finalState,
        burstAutoAdjusting: false,
        burstPendingSettle: showDialog
          ? { bestOpts: { ...bestOpts }, bestPct, currentPct }
          : null,
      });
    }
  },
  setSimpleSpikeAxis: (axis) => {
    const cur = get();
    if (cur.state !== 'open') return;
    if (cur.simpleSpikeAxis === axis) return;
    if (!cur.spikeSource) {
      set({ ...cur, simpleSpikeAxis: axis });
      return;
    }
    const run = analyzeSimpleSpikes(cur.spikeSource.session, {
      range: cur.spikeSource.range,
      mask: cur.spikeSource.mask,
      axis,
      direction: cur.simpleSpikeDirection,
    });
    set({ ...cur, simpleSpikeAxis: axis, simpleSpikeRun: run });
  },
  setSimpleSpikeDirection: (dir) => {
    const cur = get();
    if (cur.state !== 'open') return;
    if (cur.simpleSpikeDirection === dir) return;
    if (!cur.spikeSource) {
      set({ ...cur, simpleSpikeDirection: dir });
      return;
    }
    const run = analyzeSimpleSpikes(cur.spikeSource.session, {
      range: cur.spikeSource.range,
      mask: cur.spikeSource.mask,
      axis: cur.simpleSpikeAxis,
      direction: dir,
    });
    set({ ...cur, simpleSpikeDirection: dir, simpleSpikeRun: run });
  },
  setManualSpikeAxis: (axis) => {
    const cur = get();
    if (cur.state !== 'open') return;
    if (cur.manualSpikeAxis === axis) return;
    if (!cur.spikeSource) {
      set({ ...cur, manualSpikeAxis: axis });
      return;
    }
    const run = analyzeManualSpikes(cur.spikeSource.session, {
      range: cur.spikeSource.range,
      mask: cur.spikeSource.mask,
      axis,
    });
    // Selections are kept per-axis; switching just brings up the
    // other axis's pick set.
    set({ ...cur, manualSpikeAxis: axis, manualSpikeRun: run });
  },
  addManualSpikePoint: (index) => {
    const cur = get();
    if (cur.state !== 'open') return;
    const axis = cur.manualSpikeAxis;
    const existing = cur.manualSpikeSelections[axis];
    if (existing.includes(index)) return;
    set({
      ...cur,
      manualSpikeSelections: {
        ...cur.manualSpikeSelections,
        [axis]: [...existing, index],
      },
    });
  },
  removeManualSpikePoint: (index) => {
    const cur = get();
    if (cur.state !== 'open') return;
    const axis = cur.manualSpikeAxis;
    const existing = cur.manualSpikeSelections[axis];
    const next = existing.filter((i) => i !== index);
    if (next.length === existing.length) return;
    set({
      ...cur,
      manualSpikeSelections: {
        ...cur.manualSpikeSelections,
        [axis]: next,
      },
    });
  },
  resetManualSpikePoints: () => {
    const cur = get();
    if (cur.state !== 'open') return;
    if (cur.manualSpikeSelections.ra.length === 0
        && cur.manualSpikeSelections.dec.length === 0) return;
    set({ ...cur, manualSpikeSelections: { ra: [], dec: [] } });
  },
  selectManualSpikePointsByThreshold: (thresholdArc) => {
    const cur = get();
    if (cur.state !== 'open' || !cur.manualSpikeRun) return;
    if (!Number.isFinite(thresholdArc) || thresholdArc === 0) return;
    const run = cur.manualSpikeRun;
    // Chart Y values are (detrended - median) * (pixelScale when ARCSEC,
    // else 1). The threshold the user types is always in arc-seconds —
    // convert to pixel-space once so we can compare against the raw
    // detrended buffer directly.
    const thresholdPx = thresholdArc / run.pixelScale;
    const axis = cur.manualSpikeAxis;
    const picked: number[] = [];
    if (thresholdPx > 0) {
      for (let i = 0; i < run.detrended.length; i++) {
        if (run.detrended[i] - run.median >= thresholdPx) picked.push(i);
      }
    } else {
      for (let i = 0; i < run.detrended.length; i++) {
        if (run.detrended[i] - run.median <= thresholdPx) picked.push(i);
      }
    }
    set({
      ...cur,
      manualSpikeSelections: {
        ...cur.manualSpikeSelections,
        [axis]: picked,
      },
    });
  },
  resolveBurstPendingSettle: (keepBest) => {
    const cur = get();
    if (cur.state !== 'open' || !cur.burstPendingSettle) return;
    if (!keepBest) {
      // Stay where we are. Just clear the dialog.
      set({ ...cur, burstPendingSettle: null });
      return;
    }
    if (!cur.burstSource) {
      set({ ...cur, burstPendingSettle: null });
      return;
    }
    // Restore the global-best opts and recompute. The search uses
    // analyzeBursts identically so the chart and candidates table snap
    // to the high-water-mark configuration the dialog promised.
    const opts: BurstAnalysisOptions = {
      ...cur.burstPendingSettle.bestOpts,
      range: cur.burstSource.range,
      mask: cur.burstSource.mask,
    };
    const run = analyzeBursts(cur.burstSource.session, opts);
    set({ ...cur, burstOpts: opts, burstRun: run, burstPendingSettle: null });
  },
}));
