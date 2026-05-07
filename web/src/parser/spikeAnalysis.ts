import type { GuideSession } from './types';
import { computeDriftCorrected } from './analyze';
import { Spline } from './spline';
import { forwardFftMagnitudes } from './fft';

const MIN_ENTRIES = 24; // Need a bit more than the regular GA threshold so
// the FFT bins below the longest period of interest have any meaning.

export type SpikeAxis = 'ra' | 'dec';

export interface SpikeAnalysisOptions {
  range: { begin: number; end: number };
  mask?: Uint8Array;
  /** Which axis to analyze. RA-only initially per the user's request, but
   *  the API accepts either so the modal can flip RA ↔ Dec without a
   *  separate code path. */
  axis: SpikeAxis;
  /** Sigma multiplier for the spike threshold. Default 3 in callers; the
   *  pipeline accepts 1..6 to give the user a slider's worth of room. */
  k: number;
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
 * Round `n` up to the next power of two, since `forwardFftMagnitudes`
 * (fft.js) only takes power-of-two lengths. Mirrors the helper inline
 * in analyze.ts.
 */
const nextPow2 = (n: number): number => {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
};

/**
 * Run the FFT pipeline against the absolute-deviation envelope of the
 * drift-corrected series. Spline-resample to a uniform grid (the
 * irregular sample cadence would otherwise smear the peaks), Hamming-
 * window, zero-pad to the next power of two, FFT, and convert magnitudes
 * to (period, amplitude) pairs sorted ascending by period.
 *
 * The envelope is `|values - median|` (not `|values|`) so a non-zero
 * baseline doesn't show up as a DC offset that shifts the periodogram
 * floor up. Subtracting the envelope MEAN before windowing further
 * removes the DC bin so the lowest-frequency bins reflect real
 * variability rather than the average envelope level.
 */
function envelopeFFT(
  t: Float64Array,
  values: Float64Array,
  median: number,
): { fftPeriod: Float64Array; fftAmplitude: Float64Array; fftAmpMax: number } {
  const n0 = t.length;
  if (n0 < 2) {
    return { fftPeriod: new Float64Array(0), fftAmplitude: new Float64Array(0), fftAmpMax: 0 };
  }
  const dt = (t[n0 - 1] - t[0]) / (n0 - 1);
  const n = nextPow2(n0);

  // Build envelope and subtract its mean (centering removes the DC bin).
  const env = new Float64Array(n0);
  let envSum = 0;
  for (let i = 0; i < n0; i++) {
    env[i] = Math.abs(values[i] - median);
    envSum += env[i];
  }
  const envMean = envSum / n0;
  for (let i = 0; i < n0; i++) env[i] -= envMean;

  // Spline-resample onto a uniform grid (mirrors analyze.ts).
  const sp = new Spline(Array.from(t), Array.from(env));
  const sig = new Float64Array(n);
  const k = (Math.PI * 2) / (n0 - 1);
  for (let i = 0; i < n0; i++) {
    let x = t[0] + i * dt;
    if (x > t[n0 - 1]) x = t[n0 - 1];
    const hw = 0.54 - 0.46 * Math.cos(i * k);
    sig[i] = hw * sp.at(x);
  }

  const mags = forwardFftMagnitudes(sig);
  const scale = 4 / n0;
  const nfft = n / 2 - 1;
  const period = new Float64Array(nfft);
  const amplitude = new Float64Array(nfft);
  let amax = 0;
  for (let i = 0; i < nfft; i++) {
    const f = (i + 1) / (n * dt);
    const p = 1 / f;
    const a = mags[i + 1] * scale;
    period[nfft - 1 - i] = p;
    amplitude[nfft - 1 - i] = a;
    if (a > amax) amax = a;
  }
  return { fftPeriod: period, fftAmplitude: amplitude, fftAmpMax: amax };
}

/**
 * Full Spike Analysis pipeline:
 *   1. Drift-correct the session (reuses `computeDriftCorrected`).
 *   2. Pick the requested axis (`rac` for RA, `decc` for Dec).
 *   3. Compute robust median + MAD-derived σ.
 *   4. Flag samples whose |value - median| exceeds k × σ.
 *   5. Cluster consecutive flagged samples into events.
 *   6. FFT the absolute-deviation envelope (envelopeFFT above).
 *
 * The result has the same axis-conventions as `GARun` (period in seconds,
 * ascending) so the existing PeriodogramChart can render the periodogram
 * with no shape changes.
 */
export function analyzeSpikes(s: GuideSession, opts: SpikeAnalysisOptions): SpikeRun {
  if (opts.k <= 0) {
    throw new Error(`analyzeSpikes: k must be positive (got ${opts.k})`);
  }
  // Reuse the existing drift-correction. We always need RA + Dec computed
  // because the unguided / raw-RA code paths might use them too — for
  // spike analysis we just pick which series feeds the rest.
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

  const n = values.length;
  const spikeMask = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (Math.abs(values[i] - median) > threshold) spikeMask[i] = 1;
  }
  const events = clusterSpikes(drift.t, values, median, spikeMask);

  const fft = envelopeFFT(drift.t, values, median);
  const fftSpline = new Spline(Array.from(fft.fftPeriod), Array.from(fft.fftAmplitude));

  let valueMin = values[0];
  let valueMax = values[0];
  for (let i = 1; i < n; i++) {
    if (values[i] < valueMin) valueMin = values[i];
    if (values[i] > valueMax) valueMax = values[i];
  }

  return {
    axis: opts.axis,
    k: opts.k,
    median,
    sigma,
    threshold,
    t: drift.t,
    values: values instanceof Float64Array ? values : new Float64Array(values),
    spikeMask,
    events,
    fftPeriod: fft.fftPeriod,
    fftAmplitude: fft.fftAmplitude,
    fftAmpMax: fft.fftAmpMax,
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
  /** FFT amplitude at this period (in raw pixel units, multiply by k for
   *  arc-sec when needed). */
  amplitude: number;
  /** Number of detected spike events whose time mod period falls within
   *  ±tolerance — i.e. how many of the event timestamps actually align
   *  with this period. A high amplitude with a low alignment count is
   *  probably a noise lobe; a moderate amplitude with high alignment is
   *  a real periodic effect. */
  alignedEvents: number;
}

/**
 * Pick the top-N spike periods from a SpikeRun's periodogram. Local-
 * maximum scan with optional min/max period filters; the count for each
 * period is augmented with how many of the run's spike events actually
 * fall on that period (phase-folded ±tolerance).
 *
 * `minPeriodSec` is the user-tunable lower bound — useful for filtering
 * out PHD2's hysteresis "echo" peak that sits around 10-20 seconds.
 */
export function pickTopSpikePeriods(
  run: SpikeRun,
  n = 3,
  opts: { minPeriodSec?: number; maxPeriodSec?: number; tolerance?: number } = {},
): SpikePeriodPick[] {
  const minP = opts.minPeriodSec ?? 0;
  const maxP = opts.maxPeriodSec ?? Infinity;
  const tol = opts.tolerance ?? 0.15; // ±15% of the period by default

  // Collect local maxima within the period band.
  const peaks: { period: number; amplitude: number }[] = [];
  for (let i = 1; i < run.fftPeriod.length - 1; i++) {
    const p = run.fftPeriod[i];
    if (p < minP || p > maxP) continue;
    const a = run.fftAmplitude[i];
    if (a > run.fftAmplitude[i - 1] && a > run.fftAmplitude[i + 1]) {
      peaks.push({ period: p, amplitude: a });
    }
  }
  peaks.sort((a, b) => b.amplitude - a.amplitude);
  const top = peaks.slice(0, n);

  // For each picked period, find the phase-offset that maximizes the
  // number of aligned events. Phase-folding against a fixed reference
  // (e.g. events[0].t) is brittle: a single noise event near the start
  // shifts the reference and the genuine spike train falls outside the
  // window. The offset search is the standard "epoch-folding" trick from
  // pulsar timing — scan a coarse grid of t0 in [0, period) and pick the
  // offset that the most events align with.
  return top.map((pk) => {
    const halfWindow = pk.period * tol;
    const numOffsets = 40;
    let best = 0;
    for (let o = 0; o < numOffsets; o++) {
      const offset = (o / numOffsets) * pk.period;
      let aligned = 0;
      for (const ev of run.events) {
        const phase = ((ev.t - offset) % pk.period + pk.period) % pk.period;
        const distToZero = Math.min(phase, pk.period - phase);
        if (distToZero <= halfWindow) aligned++;
      }
      if (aligned > best) best = aligned;
    }
    return { period: pk.period, amplitude: pk.amplitude, alignedEvents: best };
  });
}
