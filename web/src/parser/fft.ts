import FFTLib from 'fft.js';

interface FFTInstance {
  size: number;
  createComplexArray(): number[];
  realTransform(out: number[], data: ArrayLike<number>): void;
  completeSpectrum(out: number[]): void;
  transform(out: number[], data: ArrayLike<number>): void;
  inverseTransform(out: number[], data: ArrayLike<number>): void;
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
  // After realTransform, the first n/2 complex pairs are populated; the
  // rest is the conjugate spectrum we don't need.
  const mags = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    const re = out[2 * i];
    const im = out[2 * i + 1];
    mags[i] = Math.hypot(re, im);
  }
  return mags;
}

const nextPow2 = (n: number): number => {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
};

/**
 * Magnitudes of the first `floor(N/2)+1` bins of the length-`N` DFT of a real
 * signal, for ARBITRARY `N` (not just powers of two).
 *
 * The desktop log viewer FFTs the resampled signal at exactly `N = <number of
 * included entries>` using GSL's mixed-radix `gsl_fft_complex_forward`
 * (AnalysisWin.cpp:380) — no zero-padding. Zero-padding to the next power of
 * two (our old workaround for `fft.js`, which only accepts power-of-two sizes)
 * shifts every period bin (`p = N·dt/(k+1)`) and therefore moves the Akima
 * periodogram peak the user reads — e.g. an unguided worm-period peak the
 * desktop reports at 409.7s read 422.7s here. To stay bin-for-bin faithful we
 * reproduce the arbitrary-N transform via Bluestein's chirp-z algorithm, which
 * expresses the length-N DFT as a linear convolution evaluated with
 * power-of-two FFTs (so `fft.js` can still do the heavy lifting in O(N log N)).
 *
 *   X[k] = w[k] · Σ_n (x[n]·w[n]) · conj(w[k-n]),   w[m] = exp(-iπ m²/N)
 *
 * The m² phase argument is reduced mod 2N before scaling by π/N so it stays
 * precise for large N (a full night's session can be tens of thousands of
 * frames); `m²` itself stays exact in a double for any realistic N.
 */
export function arbitraryDftMagnitudes(signal: ArrayLike<number>): Float64Array {
  const N = signal.length;
  if (N < 2) throw new Error(`arbitraryDftMagnitudes: length ${N} must be ≥ 2`);
  // Power-of-two inputs can skip the chirp-z machinery entirely.
  if ((N & (N - 1)) === 0) {
    const full = forwardFftMagnitudes(signal); // length N/2 (bins 0..N/2-1)
    const out = new Float64Array(Math.floor(N / 2) + 1);
    out.set(full);
    // forwardFftMagnitudes omits the Nyquist bin (k=N/2); recompute it.
    let re = 0;
    for (let n = 0; n < N; n++) re += (n & 1 ? -signal[n] : signal[n]);
    out[N / 2] = Math.abs(re);
    return out;
  }

  const two = 2 * N;
  // Chirp phases w[m] = exp(-iπ m²/N): wRe[m]=cos(π m²/N), wIm[m]=-sin(π m²/N).
  const wRe = new Float64Array(N);
  const wIm = new Float64Array(N);
  for (let m = 0; m < N; m++) {
    const ang = (Math.PI * ((m * m) % two)) / N; // mod 2N keeps `ang` small
    wRe[m] = Math.cos(ang);
    wIm[m] = -Math.sin(ang);
  }

  const M = nextPow2(2 * N - 1);
  const fft = new FFT(M);
  const A = fft.createComplexArray(); // length 2M, zero-filled
  const B = fft.createComplexArray();
  // a[n] = x[n]·w[n]; b is the (symmetric) chirp kernel conj(w).
  for (let n = 0; n < N; n++) {
    const x = signal[n];
    A[2 * n] = x * wRe[n];
    A[2 * n + 1] = x * wIm[n];
  }
  B[0] = wRe[0]; B[1] = -wIm[0];
  for (let m = 1; m < N; m++) {
    const re = wRe[m];
    const im = -wIm[m]; // conj(w[m])
    B[2 * m] = re; B[2 * m + 1] = im;
    B[2 * (M - m)] = re; B[2 * (M - m) + 1] = im; // b[-m] = b[m]
  }

  const FA = fft.createComplexArray();
  const FB = fft.createComplexArray();
  fft.transform(FA, A);
  fft.transform(FB, B);
  // Pointwise complex product FA·FB, in place into FA.
  for (let i = 0; i < M; i++) {
    const ar = FA[2 * i], ai = FA[2 * i + 1];
    const br = FB[2 * i], bi = FB[2 * i + 1];
    FA[2 * i] = ar * br - ai * bi;
    FA[2 * i + 1] = ar * bi + ai * br;
  }
  const conv = fft.createComplexArray();
  fft.inverseTransform(conv, FA); // fft.js normalizes by 1/M

  const half = Math.floor(N / 2);
  const out = new Float64Array(half + 1);
  for (let k = 0; k <= half; k++) {
    const cr = conv[2 * k], ci = conv[2 * k + 1];
    // X[k] = w[k]·conv[k]
    const re = wRe[k] * cr - wIm[k] * ci;
    const im = wRe[k] * ci + wIm[k] * cr;
    out[k] = Math.hypot(re, im);
  }
  return out;
}
