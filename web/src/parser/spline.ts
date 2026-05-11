/**
 * Akima cubic-spline interpolation (non-periodic).
 *
 * Matches `gsl_interp_akima` (AnalysisWin.cpp:42 — `gsl_spline_alloc(gsl_interp_akima, n)`),
 * which is what the desktop log viewer uses both to resample the
 * drift-corrected RA signal onto a uniform grid before FFT (analyze.ts ↔
 * AnalysisWin.cpp:366-375) and to smooth the periodogram for cursor
 * peak-snap (AnalysisWin.cpp:408 / OnMove). Akima's defining property is
 * anti-overshoot at sharp transitions: where a natural-BC cubic spline
 * can ring by 10-20% past a step, Akima stays bounded near the data.
 * This matters for the periodogram, which often has narrow spikes.
 *
 * Algorithm (Akima 1970, as implemented in gsl/interp/akima.c):
 *   1. Interval slopes m[i] = (y[i+1]-y[i])/(x[i+1]-x[i]).
 *   2. Phantom slopes m[-2], m[-1], m[n-1], m[n] by linear extrapolation
 *      from the two real slopes on each side. These let the boundary
 *      tangent formula stay uniform with the interior.
 *   3. Per-data-point tangent b[i] = weighted blend of m[i-1] and m[i]:
 *        alpha = |m[i-1] - m[i-2]| / (|m[i+1] - m[i]| + |m[i-1] - m[i-2]|)
 *        b[i]  = (1 - alpha) * m[i-1] + alpha * m[i]
 *      (degenerate case ne==0: midpoint average).
 *   4. Per-interval Hermite cubic p(x) = y[i] + b[i]*h + c[i]*h^2 + d[i]*h^3
 *      with c, d derived from the two end tangents and the chord slope.
 *
 * For n == 2 we fall back to straight-line interpolation (the standard
 * Akima formulas need at least one slope difference, i.e. n >= 3).
 */
export class Spline {
  private readonly xs: number[];
  private readonly ys: number[];
  private readonly b: number[];
  private readonly c: number[];
  private readonly d: number[];

  constructor(xs: ArrayLike<number>, ys: ArrayLike<number>) {
    if (xs.length !== ys.length) throw new Error('Spline: x and y must be same length');
    if (xs.length < 2) throw new Error('Spline: need at least 2 points');
    for (let i = 1; i < xs.length; i++) {
      if (xs[i] <= xs[i - 1]) throw new Error('Spline: x must be strictly monotonic increasing');
    }
    const n = xs.length;
    this.xs = Array.from(xs);
    this.ys = Array.from(ys);

    if (n === 2) {
      const slope = (this.ys[1] - this.ys[0]) / (this.xs[1] - this.xs[0]);
      this.b = [slope, slope];
      this.c = [0];
      this.d = [0];
      return;
    }

    const m = new Array<number>(n - 1);
    for (let i = 0; i < n - 1; i++) {
      m[i] = (this.ys[i + 1] - this.ys[i]) / (this.xs[i + 1] - this.xs[i]);
    }

    // Slope array padded with two phantom slopes on each side so the
    // tangent formula needs no special case for boundary points. Index
    // mapping: ms[k] = m[k - 2], so ms[2..n] hold the n-1 real slopes.
    const ms = new Array<number>(n + 3);
    ms[0] = 3 * m[0] - 2 * m[1];
    ms[1] = 2 * m[0] - m[1];
    for (let i = 0; i < n - 1; i++) ms[i + 2] = m[i];
    ms[n + 1] = 2 * m[n - 2] - m[n - 3];
    ms[n + 2] = 3 * m[n - 2] - 2 * m[n - 3];

    const b = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      // Right-side discontinuity weight (|m[i+1] - m[i]|) blends in the
      // LEFT slope m[i-1]; left-side weight blends in the RIGHT slope.
      // Big jump on one side ⇒ rely on the other side's slope.
      const wR = Math.abs(ms[i + 3] - ms[i + 2]);
      const wL = Math.abs(ms[i + 1] - ms[i]);
      const ne = wR + wL;
      if (ne === 0) {
        b[i] = (ms[i + 1] + ms[i + 2]) / 2;
      } else {
        b[i] = (wR * ms[i + 1] + wL * ms[i + 2]) / ne;
      }
    }
    this.b = b;

    const c = new Array<number>(n - 1);
    const d = new Array<number>(n - 1);
    for (let i = 0; i < n - 1; i++) {
      const dx = this.xs[i + 1] - this.xs[i];
      c[i] = (3 * m[i] - 2 * b[i] - b[i + 1]) / dx;
      d[i] = (b[i] + b[i + 1] - 2 * m[i]) / (dx * dx);
    }
    this.c = c;
    this.d = d;
  }

  /** Interpolated value at `x`. Clamps to the boundary value outside the domain. */
  at(x: number): number {
    const xs = this.xs;
    const n = xs.length;
    if (x <= xs[0]) return this.ys[0];
    if (x >= xs[n - 1]) return this.ys[n - 1];
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] > x) hi = mid;
      else lo = mid;
    }
    const h = x - xs[lo];
    return this.ys[lo] + h * (this.b[lo] + h * (this.c[lo] + h * this.d[lo]));
  }
}
