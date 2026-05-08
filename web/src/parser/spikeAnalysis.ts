import type { GuideSession } from './types';
import { computeDriftCorrected } from './analyze';
import { Spline } from './spline';

const MIN_ENTRIES = 24; // Same lower bound the regular GA analyze uses,
// plus a bit of slack so the spike periodogram has meaningful resolution.

export type SpikeAxis = 'ra' | 'dec';
/**
 * Which side of the median a sample must be on to count as a spike.
 *   'both'     — flag samples whose |deviation| > threshold (default).
 *   'positive' — flag samples whose deviation > +threshold (e.g. East
 *                pulses that overshoot, dome bumps in one direction).
 *   'negative' — flag samples whose deviation < -threshold.
 *
 * Useful when the periodic disturbance is one-sided — combining both
 * directions can wash out the period if the positive and negative
 * arrivals happen at different cadences (e.g. drive-train chatter
 * that pulls one way only).
 */
export type SpikeDirection = 'both' | 'positive' | 'negative';

export interface SpikeAnalysisOptions {
  range: { begin: number; end: number };
  mask?: Uint8Array;
  /** Which axis to analyze. */
  axis: SpikeAxis;
  /** Sigma multiplier for the spike threshold. UI accepts 1..6. */
  k: number;
  /** Direction filter for spike detection. Default 'both'. */
  direction?: SpikeDirection;
}

/**
 * One detected spike event: a peak in the absolute-deviation series,
 * after merging consecutive flagged samples (see `clusterSpikes` below).
 */
export interface SpikeEvent {
  /** Index into the SpikeRun's `t`/`values` arrays at the peak. */
  i: number;
  /** Time at the peak, in seconds since session start. */
  t: number;
  /** Drift-corrected axis value at the peak, in pixels (signed). */
  value: number;
  /** Magnitude of the deviation from the robust median, in pixels. */
  deviation: number;
  /** How many consecutive flagged samples this event spans (typically 1-3). */
  width: number;
}

export interface SpikeRun {
  axis: SpikeAxis;
  /** The k that generated this run. Stored so the modal can re-display it. */
  k: number;
  /** Direction filter that produced this run's spike events. */
  direction: SpikeDirection;
  /** Robust center of the drift-corrected series (median, pixels). */
  median: number;
  /** Robust σ (1.4826 × MAD), in pixels. Less inflated by spikes than the
   *  ordinary standard deviation, which is the whole point. */
  sigma: number;
  /** k × sigma — the threshold a sample's |deviation| must exceed to be
   *  flagged as a spike. */
  threshold: number;
  /** Time grid of the analyzed range (seconds since session start). */
  t: Float64Array;
  /** Drift-corrected axis values aligned with `t`, in pixels. */
  values: Float64Array;
  /** Per-sample mask: 1 if the sample is a spike, 0 otherwise.
   *  Aligned with `t` / `values`. */
  spikeMask: Uint8Array;
  /** Peak events after clustering consecutive flagged samples. Sorted
   *  by time. */
  events: SpikeEvent[];
  /** FFT periodogram of the absolute-deviation envelope. Same shape /
   *  axis convention as `GARun.fftPeriod` / `fftAmplitude` so the
   *  existing PeriodogramChart can render it. */
  fftPeriod: Float64Array;
  fftAmplitude: Float64Array;
  fftAmpMax: number;
  /** Spline through the periodogram for hover-snap, mirrors GARun.fftSpline. */
  fftSpline: Spline;
  pixelScale: number;
  starts: number | null;
  /** The min/max of `values`, useful for chart Y-range hints. */
  valueMin: number;
  valueMax: number;
}

/**
 * Compute the median and MAD of an array.  Allocates one sorted copy.
 * Returns σ_robust = 1.4826 × MAD, the conventional Gaussian-equivalent
 * scaling.
 */
function robustStats(xs: ArrayLike<number>): { median: number; sigma: number } {
  const n = xs.length;
  if (n === 0) return { median: 0, sigma: 0 };
  const sorted = new Float64Array(n);
  for (let i = 0; i < n; i++) sorted[i] = xs[i];
  sorted.sort();
  const median = n % 2 === 1
    ? sorted[(n - 1) >> 1]
    : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  const dev = new Float64Array(n);
  for (let i = 0; i < n; i++) dev[i] = Math.abs(xs[i] - median);
  dev.sort();
  const mad = n % 2 === 1
    ? dev[(n - 1) >> 1]
    : (dev[n / 2 - 1] + dev[n / 2]) / 2;
  return { median, sigma: 1.4826 * mad };
}

/**
 * Merge runs of consecutive flagged samples into single events. Two
 * flagged samples within `gap` indices count as the same event — PHD2's
 * 2-3 second cadence means a real ~5-second spike will paint 2-3 frames
 * red. Without clustering the event count is inflated and the
 * inter-event statistics get noisy.
 */
function clusterSpikes(
  t: Float64Array,
  values: Float64Array,
  median: number,
  spikeMask: Uint8Array,
  gap = 3,
): SpikeEvent[] {
  const events: SpikeEvent[] = [];
  const n = spikeMask.length;
  let i = 0;
  while (i < n) {
    if (spikeMask[i] !== 1) { i++; continue; }
    // Walk forward while the next flagged sample is within `gap` indices
    // of the previous one.
    let j = i;
    let lastFlagged = i;
    while (j < n && (j === i || j - lastFlagged <= gap)) {
      if (spikeMask[j] === 1) lastFlagged = j;
      j++;
    }
    // Identify the peak (max |value - median|) within [i, lastFlagged].
    let peakI = i;
    let peakDev = Math.abs(values[i] - median);
    for (let k = i + 1; k <= lastFlagged; k++) {
      if (spikeMask[k] !== 1) continue;
      const d = Math.abs(values[k] - median);
      if (d > peakDev) { peakDev = d; peakI = k; }
    }
    // Width = count of flagged samples in this run, not the total span.
    let width = 0;
    for (let k = i; k <= lastFlagged; k++) if (spikeMask[k] === 1) width++;
    events.push({
      i: peakI,
      t: t[peakI],
      value: values[peakI],
      deviation: peakDev,
      width,
    });
    i = lastFlagged + 1;
  }
  return events;
}

/**
 * Default tolerance for phase-folded "aligned event" matching: ±15% of
 * the candidate period is the half-window. Real-world spikes from
 * mechanical sources (mount drive trains, dome rotation, etc.) aren't
 * perfectly periodic — period jitter of 5-10% is common — so a tighter
 * tolerance misses real alignments. 15% catches the structure while
 * still discriminating the fundamental from its harmonics.
 */
const ALIGN_TOL = 0.15;

/**
 * Number of phase offsets to scan per period. The classic epoch-
 * folding trick from pulsar timing: for each candidate period T,
 * try a coarse grid of offsets t0 in [0, T) and pick the one that
 * lines up the most events. 32 offsets at 10% tolerance covers the
 * full phase space with a bit of overlap.
 */
const NUM_OFFSETS = 32;

/**
 * Minimum aligned-event count for a candidate period to count as a
 * "real" peak. Expressed as a fraction of the total event count.
 *
 * Why we need this: with N total events scattered in time, ANY period
 * will catch some events at SOME offset purely by coincidence — the
 * 32-offset best-of search inflates the random alignment count well
 * above the per-offset uniform expectation. Without a floor, the
 * mean-magnitude periodogram reads ~A (the typical spike size) at
 * literally every period, because the events are the same large
 * spikes regardless of which period you fold them onto.
 *
 * 0.4 (40% of events must align at the best offset) was chosen
 * empirically against the Peak-86sec sample log — it's high enough
 * to suppress the noise floor, low enough to keep harmonics of the
 * true period visible.
 */
const MIN_ALIGNED_FRACTION = 0.4;

/**
 * Build a "spike magnitude periodogram" — for each candidate period
 * T, find the phase-offset that aligns the most spike events, and
 * report the MEAN MAGNITUDE of those aligned events (when the count
 * exceeds the minimum-aligned threshold; otherwise zero).
 *
 * For a perfect periodic spike train of magnitude A:
 *   - At T = true period, every event aligns → amplitude = mean = A
 *   - At harmonics (T/2, 2T, ...) the events still align well →
 *     amplitude ≈ A (these are real periodicities)
 *   - At unrelated T, fewer events fit the alignment window than the
 *     min-aligned floor → amplitude = 0 (clean baseline)
 *
 * The min-aligned floor is what makes the chart legible: without it,
 * the mean-of-aligned metric saturates near A across all periods
 * (because the underlying events are the same set of large spikes
 * regardless of where you fold them). The floor distinguishes
 * "found a real periodic structure" from "caught the same N events
 * by coincidence at some offset".
 */
function spikeMagnitudePeriodogram(
  events: SpikeEvent[],
  periodMin: number,
  periodMax: number,
  numBins = 400,
): { period: Float64Array; amplitude: Float64Array; ampMax: number } {
  if (events.length === 0 || periodMin >= periodMax) {
    // Empty arrays — Spline (used downstream for hover-snap) refuses
    // a zero-length or non-monotonic input, so we explicitly return
    // empty rather than zero-filled. Callers must guard.
    return {
      period: new Float64Array(0),
      amplitude: new Float64Array(0),
      ampMax: 0,
    };
  }
  const period = new Float64Array(numBins);
  const amplitude = new Float64Array(numBins);
  const logMin = Math.log(periodMin);
  const logMax = Math.log(periodMax);
  const minAligned = Math.max(2, Math.floor(events.length * MIN_ALIGNED_FRACTION));

  let ampMax = 0;
  for (let i = 0; i < numBins; i++) {
    const T = Math.exp(logMin + (i / (numBins - 1)) * (logMax - logMin));
    period[i] = T;
    const halfWindow = T * ALIGN_TOL;
    let bestSum = 0;
    let bestCount = 0;
    for (let o = 0; o < NUM_OFFSETS; o++) {
      const offset = (o / NUM_OFFSETS) * T;
      let sum = 0;
      let count = 0;
      for (const ev of events) {
        const phase = ((ev.t - offset) % T + T) % T;
        const dist = Math.min(phase, T - phase);
        if (dist <= halfWindow) {
          sum += ev.deviation;
          count++;
        }
      }
      if (sum > bestSum) {
        bestSum = sum;
        bestCount = count;
      }
    }
    // Mean magnitude of aligned events when there are enough of them
    // to credibly call this a periodic structure; otherwise zero so
    // the chart baseline is clean.
    const a = bestCount >= minAligned ? bestSum / bestCount : 0;
    amplitude[i] = a;
    if (a > ampMax) ampMax = a;
  }
  return { period, amplitude, ampMax };
}

/**
 * Aligned-event lookup: for a given period and offset (or best
 * offset if not provided), return the event indices whose phase falls
 * within the alignment tolerance window. Used by the modal hover
 * feature — when the user mouses over a peak in the periodogram, the
 * spike chart highlights exactly the events contributing to that peak.
 */
export function alignedEventIndices(
  events: SpikeEvent[],
  periodSec: number,
  tol = ALIGN_TOL,
): number[] {
  if (events.length === 0 || !Number.isFinite(periodSec) || periodSec <= 0) return [];
  const halfWindow = periodSec * tol;
  // Find the offset that maximizes the aligned event SUM (matches the
  // periodogram's bestSum criterion above so the highlighted set is
  // the same set the periodogram is reporting).
  let bestOffset = 0;
  let bestSum = -1;
  for (let o = 0; o < NUM_OFFSETS; o++) {
    const offset = (o / NUM_OFFSETS) * periodSec;
    let sum = 0;
    for (const ev of events) {
      const phase = ((ev.t - offset) % periodSec + periodSec) % periodSec;
      const dist = Math.min(phase, periodSec - phase);
      if (dist <= halfWindow) sum += ev.deviation;
    }
    if (sum > bestSum) { bestSum = sum; bestOffset = offset; }
  }
  // Collect indices at that best offset.
  const out: number[] = [];
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const phase = ((ev.t - bestOffset) % periodSec + periodSec) % periodSec;
    const dist = Math.min(phase, periodSec - phase);
    if (dist <= halfWindow) out.push(i);
  }
  return out;
}

/**
 * Full Spike Analysis pipeline:
 *   1. Drift-correct the session (reuses `computeDriftCorrected`).
 *   2. Pick the requested axis (`rac` for RA, `decc` for Dec).
 *   3. Compute robust median + MAD-derived σ.
 *   4. Flag samples whose |value - median| exceeds k × σ.
 *   5. Cluster consecutive flagged samples into events.
 *   6. Build the spike-magnitude periodogram (epoch-folding, NOT FFT)
 *      so the y-axis reads in spike-magnitude units the user can
 *      interpret directly.
 *
 * The (period, amplitude) shape matches `GARun.fftPeriod` / `fftAmplitude`
 * so the existing PeriodogramChart can render the result with no
 * structural changes — but the SEMANTICS differ. Here amplitude is
 * "average event magnitude weighted by phase alignment" (px units),
 * not FFT spectral coefficient.
 */
export function analyzeSpikes(s: GuideSession, opts: SpikeAnalysisOptions): SpikeRun {
  if (opts.k <= 0) {
    throw new Error(`analyzeSpikes: k must be positive (got ${opts.k})`);
  }
  const drift = computeDriftCorrected(s, {
    range: opts.range,
    undoRaCorrections: false,
    mask: opts.mask,
  });
  if (drift.t.length < MIN_ENTRIES) {
    throw new Error(
      `analyzeSpikes: need at least ${MIN_ENTRIES} usable entries; got ${drift.t.length}`,
    );
  }
  const values = opts.axis === 'ra' ? drift.rac : drift.decc;
  const { median, sigma } = robustStats(values);
  const threshold = opts.k * sigma;
  const direction: SpikeDirection = opts.direction ?? 'both';

  const n = values.length;
  const spikeMask = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const dev = values[i] - median;
    let isSpike = false;
    if (direction === 'positive') isSpike = dev > threshold;
    else if (direction === 'negative') isSpike = dev < -threshold;
    else isSpike = Math.abs(dev) > threshold;
    if (isSpike) spikeMask[i] = 1;
  }
  const events = clusterSpikes(drift.t, values, median, spikeMask);

  // Periodogram bounds:
  //   - lower bound at 2 × cadence (Nyquist for the spike train).
  //   - upper bound at one fifth of the session span — a periodic
  //     signal needs at least ~5 cycles in the data to be reliably
  //     detected, otherwise a wide alignment window will catch most
  //     events at any long period (the alignment-based amplitude
  //     saturates and produces spurious "peaks" near the span/2 bin).
  const dt = drift.t.length > 1
    ? (drift.t[drift.t.length - 1] - drift.t[0]) / (drift.t.length - 1)
    : 1;
  const span = drift.t.length > 1 ? drift.t[drift.t.length - 1] - drift.t[0] : 1;
  const periodMin = Math.max(2 * dt, 4);
  const periodMax = Math.max(periodMin * 4, span / 5);
  const pgram = spikeMagnitudePeriodogram(events, periodMin, periodMax);
  // Spline-construction needs ≥ 2 strictly increasing x values. When
  // there are no spike events, the periodogram is empty — fall back
  // to a 2-point flat spline over the search range so downstream
  // hover-snap doesn't blow up.
  const splineX = pgram.period.length >= 2
    ? Array.from(pgram.period)
    : [periodMin, periodMax];
  const splineY = pgram.amplitude.length >= 2
    ? Array.from(pgram.amplitude)
    : [0, 0];
  const fftSpline = new Spline(splineX, splineY);

  let valueMin = values[0];
  let valueMax = values[0];
  for (let i = 1; i < n; i++) {
    if (values[i] < valueMin) valueMin = values[i];
    if (values[i] > valueMax) valueMax = values[i];
  }

  return {
    axis: opts.axis,
    k: opts.k,
    direction,
    median,
    sigma,
    threshold,
    t: drift.t,
    values: values instanceof Float64Array ? values : new Float64Array(values),
    spikeMask,
    events,
    fftPeriod: pgram.period,
    fftAmplitude: pgram.amplitude,
    fftAmpMax: pgram.ampMax,
    fftSpline,
    pixelScale: s.pixelScale,
    starts: s.startsMs,
    valueMin,
    valueMax,
  };
}

export interface SpikePeriodPick {
  /** Period in seconds. */
  period: number;
  /**
   * Periodogram value at this period — in raw pixel units, multiply
   * by pixelScale for arc-sec. With the spike-magnitude periodogram
   * this reads directly as the typical event magnitude weighted by
   * alignment fraction (i.e. it'll equal the mean event |deviation|
   * when ALL events align at this period).
   */
  amplitude: number;
  /**
   * Mean magnitude (px) across the events that actually align with
   * this period — what a single typical spike at this period looks
   * like. Computed at the best phase offset (matches what the
   * periodogram reports). Equals `amplitude` only when every event
   * aligns; for partial alignment it's larger because it averages
   * fewer (presumably more representative) events.
   */
  meanMagnitude: number;
  /** Number of events that phase-align with this period at the best offset. */
  alignedEvents: number;
}

/**
 * Plateau-aware peak finder for the spike-magnitude periodogram. The
 * spike-magnitude periodogram saturates at the mean event magnitude
 * across a range of periods (any period that lets all events fit
 * within the alignment tolerance window will produce the same value),
 * so a strict-inequality "local maximum" test misses real peaks
 * because their tops are flat. Walks rising → flat-top → falling
 * regions and reports the midpoint of each plateau as the peak.
 */
function findPeaks(
  period: Float64Array,
  amplitude: Float64Array,
): Array<{ period: number; amplitude: number; idx: number }> {
  const peaks: Array<{ period: number; amplitude: number; idx: number }> = [];
  const n = period.length;
  if (n < 3) return peaks;
  let i = 0;
  while (i < n) {
    // Skip flat / descending stretches to find the next ascending run.
    while (i < n - 1 && amplitude[i + 1] <= amplitude[i]) i++;
    // Now amplitude[i+1] > amplitude[i] (or i is at the end).
    if (i >= n - 1) break;
    // Walk up the slope.
    while (i < n - 1 && amplitude[i + 1] > amplitude[i]) i++;
    // i is at a local top — possibly the start of a plateau. Walk
    // through the plateau until the value drops.
    let j = i;
    while (j < n - 1 && amplitude[j + 1] === amplitude[i]) j++;
    // j is the last bin in the plateau (= i for a strict peak).
    if (j < n - 1 && amplitude[j + 1] < amplitude[i]) {
      const mid = (i + j) >> 1;
      peaks.push({ period: period[mid], amplitude: amplitude[mid], idx: mid });
    }
    i = j + 1;
  }
  return peaks;
}

/**
 * Pick the top-N spike periods from a SpikeRun's periodogram. Plateau-
 * aware local-maximum scan with optional min/max period filters; for
 * each peak we also compute the mean event magnitude AMONG the aligned
 * events (different from the periodogram amplitude, which is
 * normalized by the total event count rather than the aligned count).
 *
 * `minPeriodSec` is the user-tunable lower bound — useful for filtering
 * out PHD2's hysteresis "echo" peak that sits around 10-20 seconds.
 */
export function pickTopSpikePeriods(
  run: SpikeRun,
  n = 3,
  opts: { minPeriodSec?: number; maxPeriodSec?: number } = {},
): SpikePeriodPick[] {
  const minP = opts.minPeriodSec ?? 0;
  const maxP = opts.maxPeriodSec ?? Infinity;

  const allPeaks = findPeaks(run.fftPeriod, run.fftAmplitude);
  const peaks = allPeaks.filter((pk) => pk.period >= minP && pk.period <= maxP);
  peaks.sort((a, b) => b.amplitude - a.amplitude);
  const top = peaks.slice(0, n);

  // Per-pick: the periodogram amplitude is "magnitude × alignment
  // fraction"; the user often wants "magnitude of an aligned event"
  // (what would I typically see when this period fires). Compute it
  // by averaging deviations among aligned events.
  return top.map((pk) => {
    const aligned = alignedEventIndices(run.events, pk.period);
    let sum = 0;
    for (const i of aligned) sum += run.events[i].deviation;
    const meanMag = aligned.length > 0 ? sum / aligned.length : pk.amplitude;
    return {
      period: pk.period,
      amplitude: pk.amplitude,
      meanMagnitude: meanMag,
      alignedEvents: aligned.length,
    };
  });
}
