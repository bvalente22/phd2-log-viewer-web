import type { GuideSession } from './types';
import { computeDriftCorrected } from './analyze';
import { forwardFftMagnitudes } from './fft';

/**
 * "Simple spikes" — the bare-bones spike analyzer the user asked for
 * after the regular Spikes and Bursts tabs got too feature-rich.
 *
 * Pipeline:
 *   1. Drift-corrected axis values (RA or Dec).
 *   2. Linear detrend — subtract the least-squares-fit line.
 *   3. Robust σ (1.4826 × MAD) on the detrended series.
 *   4. Threshold at 3σ; build a sparse "spike-only" series — keep the
 *      sample's value if |deviation| > 3σ, set everything else to 0.
 *      The direction filter optionally keeps only positive or only
 *      negative deviations.
 *   5. Mean-subtract and FFT the sparse series; pick the strongest
 *      non-DC bin within sensible period bounds → dominant period.
 *   6. Mean of |spike value − median| across the spike samples →
 *      mean amplitude.
 *
 * Output: just the two numbers (period, mean amplitude) and enough
 * intermediate state for the chart to render the detrended trace
 * with the spike samples highlighted.
 */

const MIN_ENTRIES = 24;

export type SimpleSpikeAxis = 'ra' | 'dec';
export type SimpleSpikeDirection = 'both' | 'positive' | 'negative';

export interface SimpleSpikeOptions {
  range: { begin: number; end: number };
  mask?: Uint8Array;
  axis: SimpleSpikeAxis;
  direction: SimpleSpikeDirection;
}

export interface SimpleSpikeRun {
  axis: SimpleSpikeAxis;
  direction: SimpleSpikeDirection;
  pixelScale: number;
  starts: number | null;

  /** Uniform sample cadence (median of dt across the source range). */
  dt: number;
  /** Time grid (seconds since session start). */
  t: Float64Array;

  /** Drift-corrected axis values after linear detrend. */
  detrended: Float64Array;

  /** Median of detrended values — typically very close to 0 after detrend. */
  median: number;
  /** Robust σ (1.4826 × MAD) of detrended values. */
  sigma: number;
  /** Detection cutoff = 3 × σ. */
  threshold: number;

  /** Per-sample mask: 1 if the sample passed the direction-filtered
   *  3σ test, 0 otherwise. */
  spikeMask: Uint8Array;
  /** Indices into `t`/`detrended` of the spike samples. */
  spikeIndices: number[];

  /** Dominant period (s) from the FFT of the sparse spike-only series.
   *  0 when fewer than 2 spikes are detected. */
  periodSec: number;
  /** Mean of |detrended[i] - median| across the spike samples, in
   *  pixels. 0 when no spikes. */
  meanAmplitude: number;
}

// =================================================================
// Helpers
// =================================================================

function median(xs: ArrayLike<number>): number {
  const n = xs.length;
  if (n === 0) return 0;
  const sorted = Float64Array.from(xs).sort();
  return n % 2 === 1
    ? sorted[(n - 1) >> 1]
    : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

function mad(xs: ArrayLike<number>, m: number): number {
  const dev = new Float64Array(xs.length);
  for (let i = 0; i < xs.length; i++) dev[i] = Math.abs(xs[i] - m);
  return median(dev);
}

/** Linear detrend: subtract the least-squares line y = a + b·t.
 *  Output has zero mean (within numerical precision) and zero slope. */
function linearDetrend(t: Float64Array, x: ArrayLike<number>): Float64Array {
  const n = x.length;
  let sumT = 0, sumX = 0, sumTT = 0, sumTX = 0;
  for (let i = 0; i < n; i++) {
    const ti = t[i];
    const xi = x[i];
    sumT += ti;
    sumX += xi;
    sumTT += ti * ti;
    sumTX += ti * xi;
  }
  const denom = n * sumTT - sumT * sumT;
  const slope = denom !== 0 ? (n * sumTX - sumT * sumX) / denom : 0;
  const intercept = (sumX - slope * sumT) / n;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = x[i] - (intercept + slope * t[i]);
  return out;
}

function padPow2(xs: Float64Array): Float64Array {
  let n = 1;
  while (n < xs.length) n *= 2;
  if (n === xs.length) return xs;
  const padded = new Float64Array(n);
  padded.set(xs);
  return padded;
}

// =================================================================
// Public entry point
// =================================================================

export function analyzeSimpleSpikes(
  s: GuideSession,
  opts: SimpleSpikeOptions,
): SimpleSpikeRun {
  const drift = computeDriftCorrected(s, {
    range: opts.range,
    undoRaCorrections: false,
    mask: opts.mask,
  });
  if (drift.t.length < MIN_ENTRIES) {
    throw new Error(
      `analyzeSimpleSpikes: need at least ${MIN_ENTRIES} usable entries; got ${drift.t.length}`,
    );
  }

  const t = drift.t;
  const dt = t.length > 1 ? (t[t.length - 1] - t[0]) / (t.length - 1) : 1;
  const span = t.length > 1 ? t[t.length - 1] - t[0] : 1;
  const xRaw = opts.axis === 'ra' ? drift.rac : drift.decc;

  // Step 1-2: linear detrend.
  const detrended = linearDetrend(t, xRaw);

  // Step 3: robust stats on the detrended series.
  const med = median(detrended);
  const sigma = 1.4826 * mad(detrended, med);
  const threshold = 3 * sigma;

  // Step 4: build sparse spike-only series + collect summary stats.
  const n = detrended.length;
  const spikeMask = new Uint8Array(n);
  const spikeIndices: number[] = [];
  const sparse = new Float64Array(n);
  let amplitudeSum = 0;
  for (let i = 0; i < n; i++) {
    const dev = detrended[i] - med;
    let isSpike = false;
    if (opts.direction === 'positive') isSpike = dev > threshold;
    else if (opts.direction === 'negative') isSpike = dev < -threshold;
    else isSpike = Math.abs(dev) > threshold;
    if (isSpike) {
      spikeMask[i] = 1;
      spikeIndices.push(i);
      sparse[i] = dev;
      amplitudeSum += Math.abs(dev);
    }
  }

  // Step 5: FFT the sparse series. Mean-subtract first so the DC bin
  // doesn't dominate when most samples are zero. Pad to power of two
  // for the FFT library.
  let periodSec = 0;
  if (spikeIndices.length >= 2) {
    let mean = 0;
    for (let i = 0; i < n; i++) mean += sparse[i];
    mean /= n;
    const centered = new Float64Array(n);
    for (let i = 0; i < n; i++) centered[i] = sparse[i] - mean;
    const padded = padPow2(centered);
    const N = padded.length;
    const mags = forwardFftMagnitudes(padded);
    // Acceptable period range — Nyquist on the low end, span/3 on the
    // high end (need ≥ 3 cycles in the data to call it a period).
    const periodMin = Math.max(2 * dt, 4);
    const periodMax = Math.max(periodMin * 4, span / 3);
    let bestBin = -1;
    let bestMag = 0;
    for (let k = 1; k < mags.length; k++) {
      const period = (N * dt) / k;
      if (period < periodMin || period > periodMax) continue;
      if (mags[k] > bestMag) {
        bestMag = mags[k];
        bestBin = k;
      }
    }
    if (bestBin > 0) {
      // Walk back to the fundamental. A periodic spike train has
      // near-equal magnitude at every harmonic of the fundamental
      // (n × f₀ for n = 1, 2, 3, ...) — picking max-magnitude alone
      // lands arbitrarily on whichever harmonic happened to win the
      // numerical tie. So: if dividing the peak bin by some integer d
      // lands on a bin that's still ≥ 50% of the peak magnitude (= a
      // co-equal harmonic), prefer the longer period. Iterate through
      // small divisors and take the lowest-frequency strong bin found.
      const peakBin = bestBin;
      const peakMag = bestMag;
      for (let div = 2; div <= 12; div++) {
        const candBin = Math.round(peakBin / div);
        if (candBin < 1) continue;
        const candPeriod = (N * dt) / candBin;
        if (candPeriod < periodMin || candPeriod > periodMax) continue;
        if (candBin >= bestBin) continue;
        if (mags[candBin] >= 0.5 * peakMag) {
          bestBin = candBin;
        }
      }
      periodSec = (N * dt) / bestBin;
    }
  }

  // Step 6: mean amplitude.
  const meanAmplitude = spikeIndices.length > 0
    ? amplitudeSum / spikeIndices.length
    : 0;

  return {
    axis: opts.axis,
    direction: opts.direction,
    pixelScale: s.pixelScale,
    starts: s.startsMs,
    dt,
    t,
    detrended,
    median: med,
    sigma,
    threshold,
    spikeMask,
    spikeIndices,
    periodSec,
    meanAmplitude,
  };
}
