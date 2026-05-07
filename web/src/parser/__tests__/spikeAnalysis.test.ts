import { describe, expect, it } from 'vitest';
import { analyzeSpikes, pickTopSpikePeriods } from '../spikeAnalysis';
import { newGuideSession } from '../types';
import type { GuideEntry, GuideSession } from '../types';

/** Build a minimal GuideEntry for tests. Most fields are zero/defaults
 *  except the ones spike analysis actually reads (dt, raraw, decraw,
 *  raguide, included). */
const makeEntry = (i: number, dt: number, raraw: number, decraw = 0): GuideEntry => ({
  frame: i + 1,
  dt,
  mount: 'MOUNT',
  dx: 0, dy: 0,
  raraw, decraw,
  raguide: 0, decguide: 0,
  radur: 0, decdur: 0,
  mass: 1500, snr: 15,
  err: 0,
  info: '',
  included: true,
  guiding: true,
});

/** Synthesize a session with N samples, fixed cadence dt, baseline white-
 *  noise, and periodic spikes injected at the given period. Spikes are
 *  short (1-2 samples wide) and uniform in amplitude.
 *
 *  Key detail: `computeDriftCorrected` reconstructs RA position via
 *  `rapos += (raraw[i] - raraw[i-1] - raguide[i-1])`. With `raguide=0`
 *  this telescopes to `rapos[i] = raraw[i]` (since `raraw[-1] = 0`).
 *  So setting `raraw[i] = target_v[i]` directly makes the drift
 *  accumulator yield the target series, avoiding the random-walk drift
 *  a cumulative encoding would introduce.
 */
const makeSpikeSession = (
  n: number,
  dt: number,
  noiseSigma: number,
  spikePeriodSec: number,
  spikeAmplitude: number,
  axis: 'ra' | 'dec' = 'ra',
): GuideSession => {
  const s = newGuideSession('2026-01-01 00:00:00');
  s.startsMs = 0;
  s.pixelScale = 1;
  // Deterministic Mulberry32-style PRNG so the test is repeatable.
  let state = 0x12345678 >>> 0;
  const rand = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
  const gauss = () => Math.sqrt(-2 * Math.log(rand() || 1e-12)) * Math.cos(2 * Math.PI * rand());
  for (let i = 0; i < n; i++) {
    const t = (i + 1) * dt;
    let v = noiseSigma * gauss();
    // Inject a spike at every period boundary, alternating sign so the
    // median stays near zero.
    const phase = t % spikePeriodSec;
    if (phase < dt || spikePeriodSec - phase < dt) {
      v += spikeAmplitude * (i % 2 === 0 ? 1 : -1);
    }
    // `raraw` directly encodes the target rapos value (see comment above).
    // Dec uses `decraw` directly — `computeDriftCorrected` doesn't
    // accumulate Dec, it just reads the raw value.
    s.entries.push(
      axis === 'ra'
        ? makeEntry(i, t, v, 0)
        : makeEntry(i, t, 0, v),
    );
  }
  return s;
};

describe('analyzeSpikes', () => {
  it('detects spikes whose deviation exceeds k * sigma_robust', () => {
    // 200 samples at 2s cadence, baseline noise σ=0.1, spikes of ±2 px
    // every 80s. 80s / 2s cadence = spike at every 40th sample → 5 spikes.
    const s = makeSpikeSession(200, 2.0, 0.1, 80, 2.0, 'ra');
    const run = analyzeSpikes(s, {
      range: { begin: 0, end: s.entries.length },
      axis: 'ra',
      k: 3,
    });
    // sigma_robust should be close to 0.1 (un-inflated by the spikes).
    expect(run.sigma).toBeGreaterThan(0.05);
    expect(run.sigma).toBeLessThan(0.5);
    // Threshold = 3σ ≈ 0.3 px; spikes at ±2 px easily clear it.
    expect(run.threshold).toBeLessThan(2);
    // Should detect approximately 5 events. Allow some slop because the
    // injection sometimes hits two consecutive samples near the period
    // boundary, and clustering may merge them.
    expect(run.events.length).toBeGreaterThanOrEqual(3);
    expect(run.events.length).toBeLessThanOrEqual(8);
  });

  it('robust sigma is not inflated by spikes (compared to ordinary stddev)', () => {
    const s = makeSpikeSession(200, 2.0, 0.1, 80, 2.0, 'ra');
    const run = analyzeSpikes(s, {
      range: { begin: 0, end: s.entries.length },
      axis: 'ra',
      k: 3,
    });
    // Compute ordinary stddev of the same drift-corrected values.
    const xs = run.values;
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length;
    const stddevOrdinary = Math.sqrt(variance);
    // Robust σ should be substantially smaller than ordinary σ — that's
    // the whole point of using MAD on a spike-contaminated series.
    expect(run.sigma).toBeLessThan(stddevOrdinary * 0.7);
  });

  it('FFT envelope surfaces the planted spike period in the top 3', () => {
    // 600 samples * 2s = 1200s. Spike period 80s → 15 cycles.
    //
    // For a Dirac-comb-like signal (sharp narrow spikes at a fixed
    // period), the FFT spreads energy roughly equally across the
    // fundamental and its harmonics (T/2, T/3, ...). Any of those is a
    // legitimate detection — they all reflect the same underlying
    // periodicity. The user-facing surface is the top-3 list, so the
    // assertion is "the planted period appears in the top 3", not
    // "it's strictly first".
    const s = makeSpikeSession(600, 2.0, 0.05, 80, 2.0, 'ra');
    const run = analyzeSpikes(s, {
      range: { begin: 0, end: s.entries.length },
      axis: 'ra',
      k: 3,
    });
    const top = pickTopSpikePeriods(run, 3, { minPeriodSec: 50 });
    expect(top.length).toBeGreaterThan(0);
    // With minPeriodSec=50 we filter out the harmonics (40, 26.7, 20s),
    // leaving the fundamental as the highest-period candidate that
    // actually carries spike energy. The 80s period must be present.
    const has80 = top.some((p) => Math.abs(p.period - 80) / 80 < 0.15);
    expect(has80).toBe(true);
    // The aligned count for the 80s peak should be most of the planted
    // 15 spikes (with offset search, alignment isn't dependent on which
    // event we picked as reference).
    const peak80 = top.find((p) => Math.abs(p.period - 80) / 80 < 0.15)!;
    expect(peak80.alignedEvents).toBeGreaterThanOrEqual(12);
  });

  it('respects the axis option (Dec)', () => {
    const s = makeSpikeSession(200, 2.0, 0.1, 80, 2.0, 'dec');
    const ra = analyzeSpikes(s, { range: { begin: 0, end: s.entries.length }, axis: 'ra', k: 3 });
    const dec = analyzeSpikes(s, { range: { begin: 0, end: s.entries.length }, axis: 'dec', k: 3 });
    // With spikes on Dec only, the Dec analysis finds them, RA doesn't
    // (or finds essentially none).
    expect(dec.events.length).toBeGreaterThanOrEqual(3);
    // RA should have far fewer (often 0) flagged samples.
    expect(ra.events.length).toBeLessThanOrEqual(2);
  });

  it('honors a custom k threshold', () => {
    const s = makeSpikeSession(200, 2.0, 0.1, 80, 2.0, 'ra');
    const tight = analyzeSpikes(s, { range: { begin: 0, end: s.entries.length }, axis: 'ra', k: 4 });
    const loose = analyzeSpikes(s, { range: { begin: 0, end: s.entries.length }, axis: 'ra', k: 2 });
    // k=4 is stricter → fewer events than k=2.
    expect(tight.events.length).toBeLessThanOrEqual(loose.events.length);
  });

  it('throws when too few entries', () => {
    const s = makeSpikeSession(10, 2.0, 0.1, 80, 2.0, 'ra');
    expect(() => analyzeSpikes(s, {
      range: { begin: 0, end: s.entries.length },
      axis: 'ra',
      k: 3,
    })).toThrow();
  });

  it('clusters consecutive flagged samples into single events', () => {
    const s = makeSpikeSession(200, 2.0, 0.1, 80, 2.0, 'ra');
    const run = analyzeSpikes(s, {
      range: { begin: 0, end: s.entries.length },
      axis: 'ra',
      k: 3,
    });
    // Total flagged samples (the mask sum).
    let flagged = 0;
    for (let i = 0; i < run.spikeMask.length; i++) if (run.spikeMask[i] === 1) flagged++;
    // Total flagged-sample count across all events should equal `flagged`.
    const widthSum = run.events.reduce((a, e) => a + e.width, 0);
    expect(widthSum).toBe(flagged);
    // Distinct event count should be ≤ flagged sample count.
    expect(run.events.length).toBeLessThanOrEqual(flagged);
  });
});

describe('pickTopSpikePeriods', () => {
  it('filters periods below minPeriodSec', () => {
    const s = makeSpikeSession(600, 2.0, 0.05, 80, 2.0, 'ra');
    const run = analyzeSpikes(s, { range: { begin: 0, end: s.entries.length }, axis: 'ra', k: 3 });
    const all = pickTopSpikePeriods(run, 10);
    const filtered = pickTopSpikePeriods(run, 10, { minPeriodSec: 50 });
    for (const p of filtered) expect(p.period).toBeGreaterThanOrEqual(50);
    // Filtered list should be shorter (the noise lobes below 50s are gone).
    expect(filtered.length).toBeLessThanOrEqual(all.length);
  });

  it('counts phase-aligned events for the candidate period', () => {
    const s = makeSpikeSession(600, 2.0, 0.05, 80, 2.0, 'ra');
    const run = analyzeSpikes(s, { range: { begin: 0, end: s.entries.length }, axis: 'ra', k: 3 });
    const top = pickTopSpikePeriods(run, 3, { minPeriodSec: 50 });
    // The 80s candidate should align with most of the events thanks to
    // the offset search inside pickTopSpikePeriods.
    const peak80 = top.find((p) => Math.abs(p.period - 80) / 80 < 0.15);
    expect(peak80).toBeDefined();
    expect(peak80!.alignedEvents).toBeGreaterThanOrEqual(Math.floor(run.events.length * 0.7));
  });
});
