import { describe, it, expect } from 'vitest';
import { forwardFftMagnitudes } from '../fft';

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
