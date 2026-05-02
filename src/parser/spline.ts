/**
 * Natural-boundary cubic spline interpolation.
 *
 * Used by the analysis pipeline (`analyze.ts`) for two purposes:
 *   1. Resample the drift-corrected RA signal onto a uniform time grid before
 *      FFT (matches `gsl_spline` use in AnalysisWin.cpp:366-375).
 *   2. Smoothly draw the periodogram and snap the cursor to local maxima
 *      (matches `GARun::ffts` use in AnalysisWin.cpp:408 / OnMove peak-snap).
 *
 * Natural boundary conditions match GSL's default `gsl_interp_cspline`.
 */
export class Spline {
  private readonly xs: number[];
  private readonly ys: number[];
  private readonly m: number[]; // second derivatives at each node

  constructor(xs: ArrayLike<number>, ys: ArrayLike<number>) {
    if (xs.length !== ys.length) throw new Error('Spline: x and y must be same length');
    if (xs.length < 2) throw new Error('Spline: need at least 2 points');
    for (let i = 1; i < xs.length; i++) {
      if (xs[i] <= xs[i - 1]) throw new Error('Spline: x must be strictly monotonic increasing');
    }
    const n = xs.length;
    this.xs = Array.from(xs);
    this.ys = Array.from(ys);
    this.m = this.solveSecondDerivatives(n);
  }

  private solveSecondDerivatives(n: number): number[] {
    // Tridiagonal system for natural cubic spline second derivatives.
    // See e.g. Numerical Recipes §3.3.
    const m = new Array<number>(n).fill(0);
    if (n === 2) return m; // straight line, no curvature
    const a = new Array<number>(n).fill(0);
    const b = new Array<number>(n).fill(0);
    const c = new Array<number>(n).fill(0);
    const d = new Array<number>(n).fill(0);
    for (let i = 1; i < n - 1; i++) {
      const h0 = this.xs[i] - this.xs[i - 1];
      const h1 = this.xs[i + 1] - this.xs[i];
      a[i] = h0;
      b[i] = 2 * (h0 + h1);
      c[i] = h1;
      d[i] = 6 * ((this.ys[i + 1] - this.ys[i]) / h1 - (this.ys[i] - this.ys[i - 1]) / h0);
    }
    // Natural boundary: m[0] = m[n-1] = 0; solve interior with Thomas algorithm.
    for (let i = 2; i < n - 1; i++) {
      const w = a[i] / b[i - 1];
      b[i] -= w * c[i - 1];
      d[i] -= w * d[i - 1];
    }
    if (n - 2 >= 1) {
      m[n - 2] = d[n - 2] / b[n - 2];
      for (let i = n - 3; i >= 1; i--) {
        m[i] = (d[i] - c[i] * m[i + 1]) / b[i];
      }
    }
    return m;
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
    const h = xs[hi] - xs[lo];
    const a = (xs[hi] - x) / h;
    const b = (x - xs[lo]) / h;
    return (
      a * this.ys[lo] +
      b * this.ys[hi] +
      ((a * a * a - a) * this.m[lo] + (b * b * b - b) * this.m[hi]) * (h * h) / 6
    );
  }
}
