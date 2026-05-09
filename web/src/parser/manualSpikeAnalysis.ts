import type { GuideSession } from './types';
import { computeDriftCorrected } from './analyze';

/**
 * Manual Spike Analysis — same baseline pipeline as Simple Spikes
 * (drift-correct → linear detrend → robust stats) but no automatic
 * spike detection. The user selects spike samples by clicking on the
 * chart; statistics (mean period, mean amplitude) are derived from
 * those selections in the UI.
 */

const MIN_ENTRIES = 24;

export type ManualSpikeAxis = 'ra' | 'dec';

export interface ManualSpikeOptions {
  range: { begin: number; end: number };
  mask?: Uint8Array;
  axis: ManualSpikeAxis;
}

export interface ManualSpikeRun {
  axis: ManualSpikeAxis;
  pixelScale: number;
  starts: number | null;

  /** Sample cadence (median of dt across the source range). */
  dt: number;
  /** Time grid (seconds since session start). */
  t: Float64Array;
  /** Drift-corrected axis values after linear detrend. */
  detrended: Float64Array;

  /** Robust center; usually ≈ 0 after detrend. */
  median: number;
  /** Robust σ (1.4826 × MAD). Used to draw ±3σ context lines. */
  sigma: number;
}

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

export function analyzeManualSpikes(
  s: GuideSession,
  opts: ManualSpikeOptions,
): ManualSpikeRun {
  const drift = computeDriftCorrected(s, {
    range: opts.range,
    undoRaCorrections: false,
    mask: opts.mask,
  });
  if (drift.t.length < MIN_ENTRIES) {
    throw new Error(
      `analyzeManualSpikes: need at least ${MIN_ENTRIES} usable entries; got ${drift.t.length}`,
    );
  }
  const t = drift.t;
  const dt = t.length > 1 ? (t[t.length - 1] - t[0]) / (t.length - 1) : 1;
  const xRaw = opts.axis === 'ra' ? drift.rac : drift.decc;
  const detrended = linearDetrend(t, xRaw);
  const med = median(detrended);
  const sigma = 1.4826 * mad(detrended, med);
  return {
    axis: opts.axis,
    pixelScale: s.pixelScale,
    starts: s.startsMs,
    dt,
    t,
    detrended,
    median: med,
    sigma,
  };
}

/** Compute the user-visible summary stats from a set of selected
 *  point indices into a ManualSpikeRun. Pure — easy to unit-test. */
export interface ManualSpikeStats {
  /** Number of selected points. */
  count: number;
  /** Mean of consecutive-pair time intervals (s). 0 when fewer than 2 points. */
  meanPeriodSec: number;
  /** Median of those intervals (s). Less sensitive to one stray pick than the mean. */
  medianPeriodSec: number;
  /** Std-dev of those intervals. 0 when fewer than 2 intervals. */
  intervalStdSec: number;
  /** Mean of |detrended − median| across selected points (in pixels). 0 when none. */
  meanAmplitude: number;
  /** Smallest |detrended − median| across selected points. 0 when none. */
  minAmplitude: number;
  /** Largest |detrended − median| across selected points. 0 when none. */
  maxAmplitude: number;
}

export function manualSpikeStats(
  run: ManualSpikeRun,
  selected: ReadonlyArray<number>,
): ManualSpikeStats {
  if (selected.length === 0) {
    return {
      count: 0,
      meanPeriodSec: 0, medianPeriodSec: 0, intervalStdSec: 0,
      meanAmplitude: 0, minAmplitude: 0, maxAmplitude: 0,
    };
  }
  // Sort indices by time so consecutive intervals are well-defined.
  const sorted = [...selected].sort((a, b) => run.t[a] - run.t[b]);
  // Per-point amplitude stats — mean, min, max.
  let ampSum = 0;
  let minAmp = Infinity;
  let maxAmp = -Infinity;
  for (const i of sorted) {
    const a = Math.abs(run.detrended[i] - run.median);
    ampSum += a;
    if (a < minAmp) minAmp = a;
    if (a > maxAmp) maxAmp = a;
  }
  const meanAmplitude = ampSum / sorted.length;
  // Period: mean + median of consecutive time intervals.
  if (sorted.length < 2) {
    return {
      count: sorted.length,
      meanPeriodSec: 0, medianPeriodSec: 0, intervalStdSec: 0,
      meanAmplitude, minAmplitude: minAmp, maxAmplitude: maxAmp,
    };
  }
  const intervals: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    intervals.push(run.t[sorted[i]] - run.t[sorted[i - 1]]);
  }
  const meanPeriodSec = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  let varSum = 0;
  for (const v of intervals) varSum += (v - meanPeriodSec) ** 2;
  const intervalStdSec = intervals.length > 1 ? Math.sqrt(varSum / intervals.length) : 0;
  // Median interval — sort and take the middle (or average of two middles).
  const sortedIv = [...intervals].sort((a, b) => a - b);
  const m = sortedIv.length;
  const medianPeriodSec = m % 2 === 1
    ? sortedIv[(m - 1) >> 1]
    : (sortedIv[m / 2 - 1] + sortedIv[m / 2]) / 2;
  return {
    count: sorted.length,
    meanPeriodSec, medianPeriodSec, intervalStdSec,
    meanAmplitude, minAmplitude: minAmp, maxAmplitude: maxAmp,
  };
}
