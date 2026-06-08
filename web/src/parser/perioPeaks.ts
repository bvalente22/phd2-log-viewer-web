import type { Spline } from './spline';

/**
 * Periodogram curve + peak helpers shared by the chart (what's drawn), the
 * Top-N peaks table, the numbered chips, and the hover snap — so all four read
 * the SAME curve and can never disagree.
 *
 * The desktop log viewer draws the periodogram by evaluating the Akima
 * smoothing spline once per chart pixel (`PaintFFT` → `s_fftpos.Eval`,
 * AnalysisWin.cpp:1131-1143) and reports the peak the cursor lands on from
 * that same smooth curve (`OnMove`, AnalysisWin.cpp:864-914) — NOT from the
 * raw FFT bins. Reporting raw bins is what made our table disagree with the
 * plotted curve (e.g. a bin at 308.8s vs. the curve's visible peak), so every
 * readout here is derived from `densePeriodogram`.
 */

export const PERIO_DENSE_POINTS = 1500;

/**
 * Sample the periodogram's Akima spline on a dense log-spaced period grid —
 * the exact curve the chart plots. 1500 points across a typical 1000-3000px
 * chart is sub-pixel, so the rendered line is smooth and peak detection on
 * these samples matches the pixels the user sees.
 */
export function densePeriodogram(
  periods: ArrayLike<number>,
  spline: Spline,
  points = PERIO_DENSE_POINTS,
): { x: number[]; y: number[] } {
  const len = periods.length;
  if (len < 2) {
    const xs = Array.from(periods);
    return { x: xs, y: xs.map((p) => spline.at(p)) };
  }
  const pMin = Math.max(periods[0], 1e-6);
  const pMax = Math.max(periods[len - 1], pMin * 10);
  const logMin = Math.log10(pMin);
  const logMax = Math.log10(pMax);
  const x = new Array<number>(points);
  const y = new Array<number>(points);
  for (let i = 0; i < points; i++) {
    const p = Math.pow(10, logMin + (i / (points - 1)) * (logMax - logMin));
    x[i] = p;
    y[i] = spline.at(p);
  }
  return { x, y };
}

/** Every local maximum of a dense curve, in ascending-period order. */
export function curveLocalMaxima(curve: { x: number[]; y: number[] }): { period: number; amplitude: number }[] {
  const { x, y } = curve;
  const out: { period: number; amplitude: number }[] = [];
  for (let i = 1; i < x.length - 1; i++) {
    if (y[i] > y[i - 1] && y[i] > y[i + 1]) out.push({ period: x[i], amplitude: y[i] });
  }
  return out;
}

/**
 * Top-N peaks of the plotted curve, sorted by descending amplitude, skipping
 * any whose period exceeds `maxPeriodSec` (very-long-period drift artefacts
 * that would otherwise dominate the summary).
 */
export function curveTopPeaks(
  curve: { x: number[]; y: number[] },
  n: number,
  maxPeriodSec: number,
): { period: number; amplitude: number }[] {
  return curveLocalMaxima(curve)
    .filter((p) => p.period <= maxPeriodSec)
    .sort((a, b) => b.amplitude - a.amplitude)
    .slice(0, n);
}

/**
 * The "primary period" for period-ratio readouts: the LONGEST-period local-max
 * peak at or below `maxPeriodSec`. On the Raw-RA periodogram this is the
 * periodic-error fundamental (also its #1-amplitude peak); ratios on both the
 * Raw-RA and Residual tabs divide by this single anchor so a residual harmonic
 * at half the period reads 2x. Returns null when no peak qualifies.
 */
export function primaryPeriod(
  curve: { x: number[]; y: number[] },
  maxPeriodSec: number,
): number | null {
  let best: number | null = null;
  for (const m of curveLocalMaxima(curve)) {
    if (m.period > maxPeriodSec) continue;
    if (best === null || m.period > best) best = m.period;
  }
  return best;
}

/** Ratio of the primary period to a peak's period (primary / period). */
export function periodRatio(primaryPeriodSec: number, periodSec: number): number {
  return periodSec > 0 ? primaryPeriodSec / periodSec : 0;
}

/**
 * "Ramp" readout = amplitude / period, scaled ×1000 so the typically tiny value
 * shows digits left of the decimal. `amplitude` is in whatever unit the caller
 * displays (arc-sec or px), so ramp follows the scale toggle.
 */
export function rampValue(amplitude: number, periodSec: number): number {
  return periodSec > 0 ? (amplitude / periodSec) * 1000 : 0;
}
