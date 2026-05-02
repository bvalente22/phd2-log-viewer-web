import { describe, it, expect } from 'vitest';
import { Spline } from '../spline';

describe('Spline', () => {
  it('passes through every input node exactly', () => {
    const xs = [0, 1, 2, 3, 4];
    const ys = [0, 2, 1, 5, -1];
    const sp = new Spline(xs, ys);
    for (let i = 0; i < xs.length; i++) {
      expect(sp.at(xs[i])).toBeCloseTo(ys[i], 9);
    }
  });

  it('linearly interpolates a linear input within tight tolerance', () => {
    const xs = [0, 1, 2, 3, 4, 5];
    const ys = xs.map((x) => 2 * x + 3);
    const sp = new Spline(xs, ys);
    for (let t = 0; t <= 5; t += 0.1) {
      expect(sp.at(t)).toBeCloseTo(2 * t + 3, 6);
    }
  });

  it('clamps outside the domain to the boundary value', () => {
    const xs = [0, 1, 2];
    const ys = [10, 20, 30];
    const sp = new Spline(xs, ys);
    expect(sp.at(-5)).toBeCloseTo(10);
    expect(sp.at(99)).toBeCloseTo(30);
  });

  it('approximates a known cubic at midpoints', () => {
    // Natural-boundary CS cannot reproduce x^3 exactly (natural BC forces
    // y''=0 at endpoints); the BC error propagates inward. scipy's
    // CubicSpline(bc_type='natural') gives the same residuals: ~0.03 at
    // x=2.5 and ~0.12 at x=3.5 (closer to right boundary). Tolerance 0
    // (|err|<0.5) is the right "approximates" check here.
    const xs = [0, 1, 2, 3, 4, 5, 6];
    const ys = xs.map((x) => x * x * x);
    const sp = new Spline(xs, ys);
    expect(sp.at(2.5)).toBeCloseTo(2.5 ** 3, 0);
    expect(sp.at(3.5)).toBeCloseTo(3.5 ** 3, 0);
  });

  it('throws on non-monotonic x', () => {
    expect(() => new Spline([0, 2, 1], [0, 0, 0])).toThrow(/monotonic/i);
  });

  it('throws when x and y lengths differ', () => {
    expect(() => new Spline([0, 1], [0])).toThrow(/length/i);
  });
});
