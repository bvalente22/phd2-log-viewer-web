import FFTLib from 'fft.js';

interface FFTInstance {
  size: number;
  createComplexArray(): number[];
  realTransform(out: number[], data: ArrayLike<number>): void;
  completeSpectrum(out: number[]): void;
}
type FFTCtor = new (size: number) => FFTInstance;
const FFT = FFTLib as unknown as FFTCtor;

/**
 * Forward real FFT. Returns the magnitude (|z|) of each non-redundant bin
 * (length n/2). The caller is responsible for choosing how to convert bin
 * indices to (period, amplitude) — see `analyze.ts` for the periodogram-
 * scaling convention used by the desktop app (AnalysisWin.cpp:393).
 *
 * `fft.js` requires the input length to be a power of two — the analyze
 * pipeline ensures this by rounding the resampled signal up to the next
 * power of two and zero-padding (see analyze.ts).
 */
export function forwardFftMagnitudes(signal: ArrayLike<number>): Float64Array {
  const n = signal.length;
  if (n < 2 || (n & (n - 1)) !== 0) {
    throw new Error(`forwardFftMagnitudes: length ${n} is not a power of two ≥ 2`);
  }
  const fft = new FFT(n);
  const out = fft.createComplexArray();
  fft.realTransform(out, signal);
  const mags = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    const re = out[2 * i];
    const im = out[2 * i + 1];
    mags[i] = Math.hypot(re, im);
  }
  return mags;
}
