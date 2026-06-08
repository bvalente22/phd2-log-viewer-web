import type { GuideSession } from './types';

const MIN_ENTRIES = 12; // matches AnalysisWin.cpp:273

export interface AnalyzeOptions {
  range: { begin: number; end: number };
  undoRaCorrections: boolean;
  mask?: Uint8Array;
}

const isUsable = (
  s: GuideSession,
  i: number,
  mask: Uint8Array | undefined,
): boolean => {
  const e = s.entries[i];
  // The parser already enforces `included = StarWasFound(err)`; mirror the
  // desktop's `Include` predicate (AnalysisWin.cpp:88) and add the user's
  // exclusion mask which our app keeps separate.
  if (!e.included) return false;
  return !mask || mask[i] !== 1;
};

export function canAnalyze(s: GuideSession, opts: AnalyzeOptions): boolean {
  const { range, mask } = opts;
  let n = 0;
  for (let i = range.begin; i < range.end && i < s.entries.length; i++) {
    if (isUsable(s, i, mask) && ++n >= MIN_ENTRIES) return true;
  }
  return false;
}

/**
 * The first contiguous run of `guiding === false` entries (Guiding Assistant).
 * Returns a half-open `{ begin, end }` range matching `AnalyzeOptions.range`
 * conventions — `begin` is the first unguided index, `end` is one past the
 * last unguided index. Returns null when every entry was guided.
 */
export function findUnguidedWindow(s: GuideSession): { begin: number; end: number } | null {
  let begin = -1;
  for (let i = 0; i < s.entries.length; i++) {
    if (!s.entries[i].guiding) {
      if (begin < 0) begin = i;
    } else if (begin >= 0) {
      return { begin, end: i };
    }
  }
  if (begin >= 0) return { begin, end: s.entries.length };
  return null;
}

/**
 * The contiguous unguided window that contains the entry whose `dt` is
 * closest to `tSec` (seconds since session start). Used to let the user
 * pick *which* unguided window to analyze when a session has more than one
 * — the right-click-menu code converts the cursor's data X to a time and
 * passes it here. Returns null when no unguided run covers that time.
 */
export function findUnguidedWindowAtTime(
  s: GuideSession,
  tSec: number,
): { begin: number; end: number } | null {
  if (s.entries.length === 0) return null;
  // Locate the entry closest to tSec (linear scan is fine — sessions rarely
  // exceed tens of thousands of entries, and this only fires on a click).
  let nearest = 0;
  let bestDist = Math.abs(s.entries[0].dt - tSec);
  for (let i = 1; i < s.entries.length; i++) {
    const d = Math.abs(s.entries[i].dt - tSec);
    if (d < bestDist) {
      bestDist = d;
      nearest = i;
    }
  }
  if (s.entries[nearest].guiding) return null;
  let begin = nearest;
  while (begin > 0 && !s.entries[begin - 1].guiding) begin--;
  let end = nearest;
  while (end + 1 < s.entries.length && !s.entries[end + 1].guiding) end++;
  return { begin, end: end + 1 }; // half-open
}

export interface DriftCorrected {
  /** Filtered timestamps (seconds) of every used entry, in order. */
  t: Float64Array;
  /** Drift-corrected RA position. */
  rac: Float64Array;
  /** Drift-corrected Dec. */
  decc: Float64Array;
  /** Source log Frame number of every used entry (parallel to `t`). */
  frame: Int32Array;
  /** Raw RA distance (RARawDistance, px) of every used entry (parallel to `t`). */
  raRaw: Float64Array;
  /** Raw Dec distance (DECRawDistance, px) of every used entry (parallel to `t`). */
  decRaw: Float64Array;
  /** RA position drift slope (units per second). */
  driftRa: number;
  /** Dec drift slope (units per second). */
  driftDec: number;
}

interface LFit {
  n: number;
  sx: number; sy: number; sxx: number; sxy: number;
}
const newLFit = (): LFit => ({ n: 0, sx: 0, sy: 0, sxx: 0, sxy: 0 });
const lfitAdd = (f: LFit, x: number, y: number) => {
  f.n++; f.sx += x; f.sy += y; f.sxx += x * x; f.sxy += x * y;
};
const lfitLine = (f: LFit): { slope: number; intercept: number } => {
  if (f.n < 2) return { slope: 0, intercept: f.n === 1 ? f.sy : 0 };
  const denom = f.n * f.sxx - f.sx * f.sx;
  if (denom === 0) return { slope: 0, intercept: f.sy / f.n };
  const slope = (f.n * f.sxy - f.sx * f.sy) / denom;
  const intercept = (f.sy - slope * f.sx) / f.n;
  return { slope, intercept };
};

/**
 * Step 1-3 of `GARun::Analyze` (AnalysisWin.cpp:283-356):
 *   - Build accumulated RA position by integrating per-frame raw moves
 *     (optionally re-adding the RA correction to show what tracking would
 *     have looked like unguided).
 *   - Linear-fit (RA, Dec) vs. time.
 *   - Subtract the fit -> drift-corrected series.
 *
 * Honors the user-supplied exclusion mask in addition to the parser's
 * `entry.included` flag.
 */
export function computeDriftCorrected(s: GuideSession, opts: AnalyzeOptions): DriftCorrected {
  const { range, mask, undoRaCorrections } = opts;
  let n = 0;
  for (let i = range.begin; i < range.end && i < s.entries.length; i++) {
    if (isUsable(s, i, mask)) n++;
  }
  const t = new Float64Array(n);
  const ra = new Float64Array(n);
  const dec = new Float64Array(n);
  const frame = new Int32Array(n);
  const raRaw = new Float64Array(n);
  const decRaw = new Float64Array(n);

  const fitR = newLFit();
  const fitD = newLFit();

  let rapos = 0;
  let prevRaguide = 0;
  let prevRaraw = 0;
  let k = 0;
  for (let i = range.begin; i < range.end && i < s.entries.length; i++) {
    if (!isUsable(s, i, mask)) continue;
    const e = s.entries[i];
    const raraw = e.raraw;
    const raguide = e.raguide;
    const move = raraw - prevRaraw - prevRaguide;
    rapos += move;
    prevRaraw = raraw;
    prevRaguide = undoRaCorrections ? raguide : 0;
    t[k] = e.dt;
    ra[k] = rapos;
    dec[k] = e.decraw;
    // Per-sample provenance for the drift-chart readout / debug-log match:
    // the source Frame number and the raw RA/Dec distances straight from the log.
    frame[k] = e.frame;
    raRaw[k] = raraw;
    decRaw[k] = e.decraw;
    lfitAdd(fitR, e.dt, rapos);
    lfitAdd(fitD, e.dt, e.decraw);
    k++;
  }

  const lineR = lfitLine(fitR);
  const lineD = lfitLine(fitD);
  const rac = new Float64Array(n);
  const decc = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    rac[i] = ra[i] - (lineR.slope * t[i] + lineR.intercept);
    decc[i] = dec[i] - (lineD.slope * t[i] + lineD.intercept);
  }
  return { t, rac, decc, frame, raRaw, decRaw, driftRa: lineR.slope, driftDec: lineD.slope };
}

import { Spline } from './spline';
import { arbitraryDftMagnitudes } from './fft';
import { densePeriodogram } from './perioPeaks';

export interface GARun {
  starts: number | null;
  pixelScale: number;
  range: { begin: number; end: number };
  undoRaCorrections: boolean;
  driftRa: number;
  driftDec: number;
  t: Float64Array;
  rac: Float64Array;
  decc: Float64Array;
  /** Source log Frame number per sample (parallel to `t`). */
  frame: Int32Array;
  /** Raw RA distance (px) per sample (parallel to `t`). */
  raRaw: Float64Array;
  /** Raw Dec distance (px) per sample (parallel to `t`). */
  decRaw: Float64Array;
  fftPeriod: Float64Array;
  fftAmplitude: Float64Array;
  fftAmpMax: number;
  fftSpline: Spline;
}

/**
 * Full GARun port. Equivalent to AnalysisWin.cpp:283-411.
 *
 *   1. computeDriftCorrected → (t, rac, decc, driftRa, driftDec)
 *   2. Spline-resample rac onto a uniform grid of length n0 (the count of
 *      used entries)
 *   3. Apply a Hamming window
 *   4. arbitraryDftMagnitudes → bin magnitudes at the EXACT length-n0 DFT
 *   5. Convert bins to (period, amplitude); skip DC; sort ascending by
 *      period; build a smoothing spline
 */
export function analyze(s: GuideSession, opts: AnalyzeOptions): GARun {
  if (!canAnalyze(s, opts)) {
    throw new Error('analyze: need at least 12 usable entries; canAnalyze returned false');
  }
  const drift = computeDriftCorrected(s, opts);
  const n0 = drift.t.length;
  const dt = (drift.t[n0 - 1] - drift.t[0]) / (n0 - 1);

  const sp = new Spline(Array.from(drift.t), Array.from(drift.rac));
  // The desktop FFTs the resampled signal at exactly N = n0 (the used-entry
  // count) with NO zero-padding (GSL mixed-radix, AnalysisWin.cpp:380). The
  // period of bin k is `n0·dt/(k+1)`, so the FFT length sets where every bin —
  // and therefore the Akima peak the user reads — lands. We earlier zero-padded
  // up to the next power of two (a workaround for `fft.js`), which shifted the
  // longest bin from `n0·dt` out to `2^⌈log2 n0⌉·dt` and moved an unguided
  // worm-period peak the desktop reports at ~410s out to ~423s. `arbitraryDft-
  // Magnitudes` reproduces the exact length-n0 transform via Bluestein, so we
  // stay bin-for-bin faithful to the desktop.
  const sig = new Float64Array(n0);
  const k = (Math.PI * 2) / (n0 - 1);
  for (let i = 0; i < n0; i++) {
    let x = drift.t[0] + i * dt;
    if (x > drift.t[n0 - 1]) x = drift.t[n0 - 1];
    const hw = 0.54 - 0.46 * Math.cos(i * k);
    sig[i] = hw * sp.at(x);
  }

  const mags = arbitraryDftMagnitudes(sig); // bins 0..⌊n0/2⌋
  // AnalysisWin.cpp:393 — one-sided periodogram amplitude scaling.
  const scale = 4 / n0;
  // Keep bins 1..⌊n0/2⌋-1 (skip DC and the Nyquist bin), exactly as the
  // desktop's `nfft = n/2 - 1` loop (AnalysisWin.cpp:399-403).
  const nfft = Math.floor(n0 / 2) - 1;
  const period = new Float64Array(nfft);
  const amplitude = new Float64Array(nfft);
  for (let j = 0; j < nfft; j++) {
    const f = (j + 1) / (n0 * dt);
    const p = 1 / f;
    const a = mags[j + 1] * scale;
    // Reverse-write so periods land in ascending order (the lowest frequency /
    // longest period is bin 1). Matches the C++ ordering at
    // AnalysisWin.cpp:401-403.
    period[nfft - 1 - j] = p;
    amplitude[nfft - 1 - j] = a;
  }
  const spline = new Spline(Array.from(period), Array.from(amplitude));
  // The y-axis must fit the *drawn* curve, and the Akima spline can ride a
  // little above the highest bin between sparse long-period samples — which is
  // exactly the peak the summary reports. Take the max of the dense curve (the
  // same one the chart plots and the table reads) so that reported peak is
  // never clipped.
  const curveY = densePeriodogram(period, spline).y;
  let amax = 0;
  for (const y of curveY) if (y > amax) amax = y;

  return {
    starts: s.startsMs,
    pixelScale: s.pixelScale,
    range: { begin: opts.range.begin, end: opts.range.end },
    undoRaCorrections: opts.undoRaCorrections,
    driftRa: drift.driftRa,
    driftDec: drift.driftDec,
    t: drift.t,
    rac: drift.rac,
    decc: drift.decc,
    frame: drift.frame,
    raRaw: drift.raRaw,
    decRaw: drift.decRaw,
    fftPeriod: period,
    fftAmplitude: amplitude,
    fftAmpMax: amax,
    fftSpline: spline,
  };
}
