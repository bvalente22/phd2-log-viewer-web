import type { GuideSession } from './types';
import { computeDriftCorrected } from './analyze';
import { forwardFftMagnitudes } from './fft';

/**
 * Burst-period analysis pipeline.
 *
 * Goal: discover the repeating period of bursts/spike-clusters in the
 * drift-corrected guiding signal, without assuming the period in
 * advance. Designed as a tunable signal-analysis tool — every stage is
 * exposed as a knob in the UI so the user can iterate from automatic
 * detection toward a refined fit.
 *
 * Pipeline:
 *   raw axis values
 *     → DC removal (subtract median)
 *     → optional high-pass (subtract running median over HP window)
 *     → optional low-pass (boxcar smooth)
 *     → optional robust normalization (divide by 1.4826 × MAD)
 *     → direction filter (positive / negative / both)
 *     → spike-energy (abs / x² / rolling-RMS)
 *     → envelope smooth
 *     → autocorrelation (primary period detector)
 *     → envelope peak detection (validation)
 *     → FFT periodogram of envelope (supporting evidence)
 *     → candidate ranking + harmonic flagging
 */

const MIN_ENTRIES = 24;
const MAX_CANDIDATES = 5;

export type BurstAxis = 'ra' | 'dec';
/** Spike-energy transform applied after preprocessing. */
export type EnergyMethod = 'abs' | 'square' | 'rms';
/** Which sign(s) of deviation to keep before energy. */
export type DirectionFilter = 'both' | 'positive' | 'negative';

export interface BurstAnalysisOptions {
  range: { begin: number; end: number };
  mask?: Uint8Array;
  axis: BurstAxis;

  // Preprocessing
  /** Window for the running-median high-pass (seconds). 0 = off. */
  highPassPeriodSec: number;
  /** Window for the boxcar low-pass smoother (seconds). 0 = off. */
  lowPassPeriodSec: number;
  /** Divide by 1.4826 × MAD after detrending. */
  robustNormalize: boolean;

  // Spike-energy
  energyMethod: EnergyMethod;
  direction: DirectionFilter;
  /** Smoothing window applied to the spike-energy series (seconds). */
  envelopeSmoothSec: number;

  // Peak detection on the envelope
  /** Minimum height above local valleys, in robust-σ units of the envelope. */
  peakProminenceSigma: number;
  /** Minimum height above the envelope median, in robust-σ units. */
  peakThresholdSigma: number;
  /** Minimum spacing between detected envelope peaks (seconds). */
  minPeakSpacingSec: number;

  // Period search
  periodMinSec: number;
  periodMaxSec: number;
}

export interface BurstCandidate {
  /** Period in seconds. */
  periodSec: number;
  /** Equivalent frequency (Hz) — convenience for telemetry / table display. */
  freqHz: number;
  /** Normalized autocorrelation value at this lag (in [-1, 1]). */
  acfValue: number;
  /** Height of the ACF peak above its neighboring valleys. */
  acfProminence: number;
  /** Number of envelope peaks whose inter-peak interval is consistent with this period. */
  supportingBurstCount: number;
  /** Median of those supporting intervals (seconds). */
  medianIntervalSec: number;
  /** Std-dev of those supporting intervals (seconds). */
  intervalStdSec: number;
  /**
   * Harmonic relationship to the strongest candidate:
   *   'fundamental' — this is the strongest candidate (or its peer)
   *   'half'        — period is ~½ of the fundamental (likely sub-harmonic / bin-bleed)
   *   'double'      — period is ~2× the fundamental (likely super-harmonic — every other burst stronger)
   *   null          — independent of any other candidate
   */
  harmonic: 'fundamental' | 'half' | 'double' | null;
  /** 0..1 combined score across ACF strength, peak-spacing agreement, and consistency. */
  confidence: number;
  /** User-friendly bucket: > 0.7 strong, 0.3..0.7 moderate, < 0.3 weak. */
  rating: 'strong' | 'moderate' | 'weak';
}

export interface BurstRun {
  axis: BurstAxis;
  options: BurstAnalysisOptions;
  pixelScale: number;
  starts: number | null;

  /** Uniform sample cadence used for the analysis (seconds). */
  dt: number;
  /** Time grid (seconds since session start). */
  t: Float64Array;

  // Pipeline stages — each is the same length as `t`, ready for charting.
  /** Drift-corrected axis values, before any preprocessing. */
  raw: Float64Array;
  /** After DC + HP + LP + robust normalize. */
  detrended: Float64Array;
  /** Smoothed spike-energy. */
  envelope: Float64Array;

  envelopeMedian: number;
  envelopeSigma: number;

  /** Indices into `t` of detected envelope peaks. */
  peakIndices: number[];
  peakTimes: number[];
  /** Inter-peak intervals (seconds), one shorter than `peakTimes`. */
  peakIntervals: number[];

  /** ACF lag axis (seconds, starting at 0). */
  acfLags: Float64Array;
  /** ACF values normalized so r(0) = 1. */
  acfValues: Float64Array;

  /** FFT of the envelope, period axis (seconds). */
  fftPeriod: Float64Array;
  /** Magnitudes (raw FFT). */
  fftAmplitude: Float64Array;

  /** Top candidates, ranked by confidence. */
  candidates: BurstCandidate[];
}

// =================================================================
// Stage helpers — small, pure functions composed by `analyzeBursts`.
// Tests cover the composition; helpers are not exported.
// =================================================================

function median(xs: ArrayLike<number>): number {
  const n = xs.length;
  if (n === 0) return 0;
  const sorted = Float64Array.from(xs).sort();
  return n % 2 === 1
    ? sorted[(n - 1) >> 1]
    : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

function mad(xs: ArrayLike<number>, med: number): number {
  const dev = new Float64Array(xs.length);
  for (let i = 0; i < xs.length; i++) dev[i] = Math.abs(xs[i] - med);
  return median(dev);
}

function robustSigma(xs: ArrayLike<number>): number {
  const m = median(xs);
  return 1.4826 * mad(xs, m);
}

/** Centered running-median filter — robust baseline estimator for HP. */
function runningMedian(xs: ArrayLike<number>, windowSamples: number): Float64Array {
  const n = xs.length;
  const out = new Float64Array(n);
  if (windowSamples < 2 || n < 3) {
    for (let i = 0; i < n; i++) out[i] = xs[i];
    return out;
  }
  const half = Math.floor(windowSamples / 2);
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(n - 1, i + half);
    const len = hi - lo + 1;
    const buf = new Float64Array(len);
    for (let j = 0; j < len; j++) buf[j] = xs[lo + j];
    buf.sort();
    out[i] = len % 2 === 1
      ? buf[(len - 1) >> 1]
      : (buf[len / 2 - 1] + buf[len / 2]) / 2;
  }
  return out;
}

/** Centered boxcar smoother. */
function boxcarSmooth(xs: ArrayLike<number>, windowSamples: number): Float64Array {
  const n = xs.length;
  const out = new Float64Array(n);
  if (windowSamples < 2 || n < 3) {
    for (let i = 0; i < n; i++) out[i] = xs[i];
    return out;
  }
  const half = Math.floor(windowSamples / 2);
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(n - 1, i + half);
    let s = 0;
    let c = 0;
    for (let j = lo; j <= hi; j++) {
      s += xs[j];
      c++;
    }
    out[i] = s / c;
  }
  return out;
}

/** Rolling RMS = sqrt(rolling mean of x²). */
function rmsSmooth(xs: ArrayLike<number>, windowSamples: number): Float64Array {
  const n = xs.length;
  const out = new Float64Array(n);
  const w = Math.max(2, windowSamples);
  const half = Math.floor(w / 2);
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(n - 1, i + half);
    let s = 0;
    let c = 0;
    for (let j = lo; j <= hi; j++) {
      s += xs[j] * xs[j];
      c++;
    }
    out[i] = Math.sqrt(s / c);
  }
  return out;
}

/** Linear interpolation onto a uniform grid `tNew`. */
function linearResample(t: ArrayLike<number>, x: ArrayLike<number>, tNew: ArrayLike<number>): Float64Array {
  const n = t.length;
  const m = tNew.length;
  const out = new Float64Array(m);
  if (n === 0) return out;
  if (n === 1) {
    for (let i = 0; i < m; i++) out[i] = x[0];
    return out;
  }
  let j = 0;
  for (let i = 0; i < m; i++) {
    const tq = tNew[i];
    while (j < n - 2 && t[j + 1] < tq) j++;
    const t0 = t[j];
    const t1 = t[j + 1];
    if (tq <= t0) { out[i] = x[0]; continue; }
    if (tq >= t[n - 1]) { out[i] = x[n - 1]; continue; }
    const u = (tq - t0) / (t1 - t0);
    out[i] = x[j] * (1 - u) + x[j + 1] * u;
  }
  return out;
}

/** Biased autocorrelation up to maxLag, normalized so r(0) = 1. */
function autocorrelate(xs: ArrayLike<number>, maxLag: number): Float64Array {
  const n = xs.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += xs[i];
  mean /= n;
  const out = new Float64Array(maxLag + 1);
  for (let k = 0; k <= maxLag; k++) {
    let s = 0;
    for (let i = 0; i < n - k; i++) {
      s += (xs[i] - mean) * (xs[i + k] - mean);
    }
    out[k] = s / n;
  }
  const c0 = out[0];
  if (c0 > 0) {
    for (let k = 0; k <= maxLag; k++) out[k] /= c0;
  }
  return out;
}

/** Find local maxima of `xs` whose index ∈ [iLo, iHi], with each peak's
 *  prominence (height above the immediately-adjacent valleys). */
function localMaxima(xs: Float64Array, iLo: number, iHi: number): { idx: number; value: number; prominence: number }[] {
  const out: { idx: number; value: number; prominence: number }[] = [];
  for (let i = Math.max(1, iLo); i <= Math.min(xs.length - 2, iHi); i++) {
    if (xs[i] > xs[i - 1] && xs[i] >= xs[i + 1]) {
      // Walk left/right to find adjacent minima for prominence.
      let leftMin = xs[i];
      for (let j = i - 1; j > 0; j--) {
        if (xs[j] < leftMin) leftMin = xs[j];
        if (xs[j] > xs[i]) break;
      }
      let rightMin = xs[i];
      for (let j = i + 1; j < xs.length; j++) {
        if (xs[j] < rightMin) rightMin = xs[j];
        if (xs[j] > xs[i]) break;
      }
      const prominence = xs[i] - Math.max(leftMin, rightMin);
      out.push({ idx: i, value: xs[i], prominence });
    }
  }
  return out;
}

/** Detect peaks on the envelope using prominence + threshold + min-spacing. */
function envelopePeakDetect(
  envelope: Float64Array,
  envMedian: number,
  envSigma: number,
  thresholdSigma: number,
  prominenceSigma: number,
  minSpacingSamples: number,
): number[] {
  const threshold = envMedian + thresholdSigma * envSigma;
  const minProminence = prominenceSigma * envSigma;
  const peaks = localMaxima(envelope, 0, envelope.length - 1)
    .filter((p) => p.value >= threshold && p.prominence >= minProminence);
  // Greedy min-spacing — keep tallest first.
  peaks.sort((a, b) => b.value - a.value);
  const kept: number[] = [];
  for (const p of peaks) {
    if (kept.every((k) => Math.abs(k - p.idx) >= minSpacingSamples)) kept.push(p.idx);
  }
  kept.sort((a, b) => a - b);
  return kept;
}

/** Pad to next power of two with zeros. */
function padPow2(xs: Float64Array): Float64Array {
  let n = 1;
  while (n < xs.length) n *= 2;
  if (n === xs.length) return xs;
  const padded = new Float64Array(n);
  padded.set(xs);
  return padded;
}

/** FFT-derived (period, amplitude) for the envelope. Runs on a
 *  mean-subtracted, zero-padded copy so the DC bin doesn't dominate. */
function envelopeFft(envelope: Float64Array, dt: number): { period: Float64Array; amplitude: Float64Array } {
  // Mean-subtract.
  let mean = 0;
  for (let i = 0; i < envelope.length; i++) mean += envelope[i];
  mean /= envelope.length;
  const centered = new Float64Array(envelope.length);
  for (let i = 0; i < envelope.length; i++) centered[i] = envelope[i] - mean;
  const padded = padPow2(centered);
  const mags = forwardFftMagnitudes(padded);
  const N = padded.length;
  // Bin k → frequency k/(N*dt) → period N*dt/k. Skip bin 0 (DC).
  const period = new Float64Array(mags.length - 1);
  const amplitude = new Float64Array(mags.length - 1);
  for (let k = 1; k < mags.length; k++) {
    period[k - 1] = (N * dt) / k;
    amplitude[k - 1] = mags[k] * (2 / N);
  }
  return { period, amplitude };
}

// =================================================================
// Public entry point
// =================================================================

export function analyzeBursts(s: GuideSession, opts: BurstAnalysisOptions): BurstRun {
  const drift = computeDriftCorrected(s, {
    range: opts.range,
    undoRaCorrections: false,
    mask: opts.mask,
  });
  if (drift.t.length < MIN_ENTRIES) {
    throw new Error(
      `analyzeBursts: need at least ${MIN_ENTRIES} usable entries; got ${drift.t.length}`,
    );
  }

  // ----- Stage 1: resample to a uniform grid. -----
  // PHD2 cadence varies with exposure changes; even with stable
  // exposures, dropped frames open gaps. Resample to the median dt so
  // every downstream stage sees uniform spacing (autocorrelation, FFT,
  // and rolling smoothers all assume it).
  const tArr = drift.t;
  const xRaw = opts.axis === 'ra' ? drift.rac : drift.decc;
  const dts: number[] = [];
  for (let i = 1; i < tArr.length; i++) dts.push(tArr[i] - tArr[i - 1]);
  const dt = median(dts) || 1;
  const tStart = tArr[0];
  const tEnd = tArr[tArr.length - 1];
  const N = Math.max(MIN_ENTRIES, Math.floor((tEnd - tStart) / dt) + 1);
  const t = new Float64Array(N);
  for (let i = 0; i < N; i++) t[i] = tStart + i * dt;
  const raw = linearResample(tArr, xRaw, t);

  // ----- Stage 2: DC removal + optional HP + LP. -----
  const rawMedian = median(raw);
  const dcRemoved = new Float64Array(N);
  for (let i = 0; i < N; i++) dcRemoved[i] = raw[i] - rawMedian;

  let detrended: Float64Array = dcRemoved;
  if (opts.highPassPeriodSec > 0) {
    const hpSamples = Math.max(3, Math.round(opts.highPassPeriodSec / dt));
    const baseline = runningMedian(detrended, hpSamples);
    const out = new Float64Array(N);
    for (let i = 0; i < N; i++) out[i] = detrended[i] - baseline[i];
    detrended = out;
  }
  if (opts.lowPassPeriodSec > 0) {
    const lpSamples = Math.max(2, Math.round(opts.lowPassPeriodSec / dt));
    detrended = boxcarSmooth(detrended, lpSamples);
  }

  // ----- Stage 3: optional robust normalization. -----
  if (opts.robustNormalize) {
    const sigma = robustSigma(detrended) || 1;
    const out = new Float64Array(N);
    for (let i = 0; i < N; i++) out[i] = detrended[i] / sigma;
    detrended = out;
  }

  // ----- Stage 4: direction filter. -----
  // Apply BEFORE energy so the user's "positive only" choice produces
  // a one-sided envelope that the autocorrelation will read cleanly.
  const directed = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const v = detrended[i];
    if (opts.direction === 'positive') directed[i] = Math.max(0, v);
    else if (opts.direction === 'negative') directed[i] = Math.max(0, -v);
    else directed[i] = v;
  }

  // ----- Stage 5: spike-energy. -----
  let energy: Float64Array;
  if (opts.energyMethod === 'square') {
    energy = new Float64Array(N);
    for (let i = 0; i < N; i++) energy[i] = directed[i] * directed[i];
  } else if (opts.energyMethod === 'rms') {
    // Rolling RMS over a small window — picks up bursts that are
    // multi-sample even when individual samples don't peak high.
    const rmsWindow = Math.max(3, Math.round((opts.envelopeSmoothSec || dt * 4) / dt / 2));
    energy = rmsSmooth(directed, rmsWindow);
  } else {
    energy = new Float64Array(N);
    for (let i = 0; i < N; i++) energy[i] = Math.abs(directed[i]);
  }

  // ----- Stage 6: envelope smooth. -----
  let envelope: Float64Array;
  if (opts.envelopeSmoothSec > 0 && opts.energyMethod !== 'rms') {
    const envSamples = Math.max(2, Math.round(opts.envelopeSmoothSec / dt));
    envelope = boxcarSmooth(energy, envSamples);
  } else {
    envelope = energy;
  }
  const envMedian = median(envelope);
  const envSigma = robustSigma(envelope) || 1e-9;

  // ----- Stage 7: autocorrelation over the search range. -----
  const lagMin = Math.max(1, Math.floor(opts.periodMinSec / dt));
  const lagMax = Math.min(N - 2, Math.ceil(opts.periodMaxSec / dt));
  // ACF cap at lagMax + slack so peak detection has neighbors.
  const acfLen = Math.max(lagMin + 2, Math.min(lagMax + 10, N - 1));
  const acfValues = autocorrelate(envelope, acfLen);
  const acfLags = new Float64Array(acfValues.length);
  for (let k = 0; k < acfValues.length; k++) acfLags[k] = k * dt;

  // ----- Stage 8: envelope peak detection. -----
  const minSpacingSamples = Math.max(1, Math.round(opts.minPeakSpacingSec / dt));
  const peakIndices = envelopePeakDetect(
    envelope,
    envMedian,
    envSigma,
    opts.peakThresholdSigma,
    opts.peakProminenceSigma,
    minSpacingSamples,
  );
  const peakTimes = peakIndices.map((i) => t[i]);
  const peakIntervals: number[] = [];
  for (let i = 1; i < peakTimes.length; i++) peakIntervals.push(peakTimes[i] - peakTimes[i - 1]);

  // ----- Stage 9: FFT periodogram. -----
  const fft = envelopeFft(envelope, dt);

  // ----- Stage 10: candidate ranking. -----
  // ACF local maxima within [lagMin, lagMax], take top N by value × prominence.
  const acfPeaks = localMaxima(acfValues, lagMin, lagMax);
  acfPeaks.sort((a, b) => b.value * b.prominence - a.value * a.prominence);
  const topAcf = acfPeaks.slice(0, MAX_CANDIDATES);

  // For each ACF peak: count peak-spacings consistent with this period.
  const ALIGN_TOL = 0.2; // 20% — bursts aren't precisely periodic.
  const candidatesRaw: Omit<BurstCandidate, 'harmonic' | 'rating'>[] = topAcf.map((pk) => {
    const period = pk.idx * dt;
    const supporting = peakIntervals.filter((iv) => Math.abs(iv - period) / period <= ALIGN_TOL);
    const med = supporting.length > 0 ? median(supporting) : 0;
    let std = 0;
    if (supporting.length > 1) {
      const m = supporting.reduce((a, b) => a + b, 0) / supporting.length;
      std = Math.sqrt(supporting.reduce((a, b) => a + (b - m) ** 2, 0) / supporting.length);
    }
    // Confidence — combine ACF peak height, prominence, and peak-spacing
    // agreement (more supporting bursts + lower variance → higher confidence).
    const acfScore = Math.max(0, Math.min(1, (pk.value + pk.prominence) / 2));
    const supportRatio = peakIntervals.length > 0
      ? supporting.length / peakIntervals.length
      : 0;
    const consistency = supporting.length > 1 && med > 0
      ? Math.max(0, 1 - (std / med))
      : 0;
    const confidence = Math.max(0, Math.min(1,
      0.5 * acfScore + 0.3 * supportRatio + 0.2 * consistency,
    ));
    return {
      periodSec: period,
      freqHz: 1 / period,
      acfValue: pk.value,
      acfProminence: pk.prominence,
      supportingBurstCount: supporting.length,
      medianIntervalSec: med,
      intervalStdSec: std,
      confidence,
    };
  });

  // Sort by confidence descending, then mark harmonic relationships.
  candidatesRaw.sort((a, b) => b.confidence - a.confidence);
  const candidates: BurstCandidate[] = candidatesRaw.map((c, i) => {
    let harmonic: BurstCandidate['harmonic'] = i === 0 ? 'fundamental' : null;
    if (i > 0 && candidatesRaw.length > 0) {
      const fundamental = candidatesRaw[0].periodSec;
      // Tolerance: 12% — distinguishes 86 vs 80 (real near-miss) from 86 vs 43 (harmonic).
      const ratio = c.periodSec / fundamental;
      if (Math.abs(ratio - 0.5) < 0.12) harmonic = 'half';
      else if (Math.abs(ratio - 2) < 0.24) harmonic = 'double';
    }
    const rating: BurstCandidate['rating'] =
      c.confidence >= 0.7 ? 'strong'
      : c.confidence >= 0.3 ? 'moderate'
      : 'weak';
    return { ...c, harmonic, rating };
  });

  return {
    axis: opts.axis,
    options: opts,
    pixelScale: s.pixelScale,
    starts: s.startsMs,
    dt,
    t,
    raw,
    detrended,
    envelope,
    envelopeMedian: envMedian,
    envelopeSigma: envSigma,
    peakIndices,
    peakTimes,
    peakIntervals,
    acfLags,
    acfValues,
    fftPeriod: fft.period,
    fftAmplitude: fft.amplitude,
    candidates,
  };
}

/** Reasonable defaults that "just work" for typical PHD2 logs (1–3s
 *  cadence, hour-scale sessions, periodic-error bursts on the order of
 *  60–120 s). Slider initial positions in the UI use these. */
export function defaultBurstOptions(range: { begin: number; end: number }): BurstAnalysisOptions {
  return {
    range,
    axis: 'ra',
    highPassPeriodSec: 0,
    lowPassPeriodSec: 0,
    robustNormalize: false,
    energyMethod: 'abs',
    direction: 'both',
    envelopeSmoothSec: 8,
    peakProminenceSigma: 1.5,
    peakThresholdSigma: 1,
    minPeakSpacingSec: 20,
    periodMinSec: 10,
    periodMaxSec: 300,
  };
}
