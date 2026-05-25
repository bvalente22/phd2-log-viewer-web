import { describe, it, expect } from 'vitest';
import { forwardFftMagnitudes, arbitraryDftMagnitudes } from '../fft';

/** Brute-force length-N DFT magnitudes for bins 0..floor(N/2), our reference. */
function directDftMagnitudes(sig: ArrayLike<number>): number[] {
  const N = sig.length;
  const half = Math.floor(N / 2);
  const out: number[] = [];
  for (let k = 0; k <= half; k++) {
    let re = 0, im = 0;
    for (let n = 0; n < N; n++) {
      const ang = (-2 * Math.PI * k * n) / N;
      re += sig[n] * Math.cos(ang);
      im += sig[n] * Math.sin(ang);
    }
    out.push(Math.hypot(re, im));
  }
  return out;
}

describe('forwardFftMagnitudes', () => {
  it('returns near-zero magnitudes for an all-zero signal', () => {
    const n = 64;
    const sig = new Float64Array(n);
    const mags = forwardFftMagnitudes(sig);
    expect(mags.length).toBe(n / 2);
    for (let i = 0; i < mags.length; i++) {
      expect(mags[i]).toBeLessThan(1e-12);
    }
  });

  it('peaks at the bin matching a clean sinusoid', () => {
    const n = 64;
    const k = 4;
    const sig = new Float64Array(n);
    for (let i = 0; i < n; i++) sig[i] = Math.cos((2 * Math.PI * k * i) / n);
    const mags = forwardFftMagnitudes(sig);
    let argmax = 0;
    for (let i = 1; i < mags.length; i++) if (mags[i] > mags[argmax]) argmax = i;
    expect(argmax).toBe(k);
  });

  it('throws when length is not a power of two', () => {
    expect(() => forwardFftMagnitudes(new Float64Array(5))).toThrow();
  });
});

describe('arbitraryDftMagnitudes (Bluestein)', () => {
  // Cover prime, composite-non-pow2, the real unguided window size (92), and
  // power-of-two (which takes the fast path) — random + sinusoidal inputs.
  for (const N of [7, 12, 13, 23, 64, 92, 100, 255, 256, 384]) {
    it(`matches the direct DFT for N=${N} (random input)`, () => {
      const sig = new Float64Array(N);
      let seed = N * 2654435761;
      const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff - 0.5; };
      for (let i = 0; i < N; i++) sig[i] = rnd();
      const got = arbitraryDftMagnitudes(sig);
      const ref = directDftMagnitudes(sig);
      expect(got.length).toBe(ref.length);
      const scale = Math.max(1, ...ref); // relative tolerance vs the spectrum's scale
      for (let k = 0; k < ref.length; k++) {
        expect(Math.abs(got[k] - ref[k])).toBeLessThan(1e-9 * scale + 1e-9);
      }
    });
  }

  it('peaks at the bin matching a clean sinusoid for a non-pow2 length', () => {
    const N = 100;
    const k = 7;
    const sig = new Float64Array(N);
    for (let i = 0; i < N; i++) sig[i] = Math.cos((2 * Math.PI * k * i) / N);
    const mags = arbitraryDftMagnitudes(sig);
    let argmax = 1;
    for (let i = 1; i < mags.length; i++) if (mags[i] > mags[argmax]) argmax = i;
    expect(argmax).toBe(k);
  });

  it('returns floor(N/2)+1 bins including DC and Nyquist', () => {
    expect(arbitraryDftMagnitudes(new Float64Array(92)).length).toBe(47);
    expect(arbitraryDftMagnitudes(new Float64Array(91)).length).toBe(46);
  });
});
