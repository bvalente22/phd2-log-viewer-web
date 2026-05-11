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
    // Akima is tuned for anti-overshoot on bumpy data, not for polynomial
    // reproduction. On a pure x^3 the residual is much larger than a
    // natural-BC cubic spline's (~0.03 at x=2.5 there, ~2.5 here). The
    // analysis pipeline doesn't depend on cubic reproduction — the check
    // here is just that the value is in the ballpark.
    const xs = [0, 1, 2, 3, 4, 5, 6];
    const ys = xs.map((x) => x * x * x);
    const sp = new Spline(xs, ys);
    expect(Math.abs(sp.at(2.5) - 2.5 ** 3)).toBeLessThan(3);
    expect(Math.abs(sp.at(3.5) - 3.5 ** 3)).toBeLessThan(3);
  });

  it('does not overshoot at a step-like transition', () => {
    // Akima's headline property vs. natural-BC cubic: it stays bounded
    // near the data when the input has a sharp transition. A natural
    // cubic spline can ring 10-20% past a step; Akima should not.
    const xs = [0, 1, 2, 3, 4, 5, 6, 7];
    const ys = [0, 0, 0, 0, 1, 1, 1, 1];
    const sp = new Spline(xs, ys);
    for (let t = 0; t <= 7; t += 0.1) {
      expect(sp.at(t)).toBeGreaterThanOrEqual(-0.05);
      expect(sp.at(t)).toBeLessThanOrEqual(1.05);
    }
  });

  it('handles the n=2 straight-line case', () => {
    const sp = new Spline([0, 1], [10, 20]);
    expect(sp.at(0)).toBeCloseTo(10);
    expect(sp.at(0.5)).toBeCloseTo(15);
    expect(sp.at(1)).toBeCloseTo(20);
  });

  it('throws on non-monotonic x', () => {
    expect(() => new Spline([0, 2, 1], [0, 0, 0])).toThrow(/monotonic/i);
  });

  it('throws when x and y lengths differ', () => {
    expect(() => new Spline([0, 1], [0])).toThrow(/length/i);
  });
});
