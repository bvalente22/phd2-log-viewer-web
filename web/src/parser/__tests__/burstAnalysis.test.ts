import { describe, expect, it } from 'vitest';
import { analyzeBursts, defaultBurstOptions } from '../burstAnalysis';
import { newGuideSession } from '../types';
import type { GuideEntry, GuideSession } from '../types';

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

/** Synthesize a session that has a clear burst train at `burstPeriodSec`.
 *  Each burst is a small cluster of large positive deviations spread
 *  over `burstWidthSamples` samples so it survives envelope smoothing.
 *  Background is gaussian noise.
 */
function makeBurstSession(
  n: number,
  dt: number,
  noiseSigma: number,
  burstPeriodSec: number,
  burstAmplitude: number,
  burstWidthSamples = 3,
): GuideSession {
  const s = newGuideSession('2026-01-01 00:00:00');
  s.startsMs = 0;
  s.pixelScale = 1;
  // Mulberry32 PRNG so the test is deterministic.
  let state = 0xabcdef >>> 0;
  const rand = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
  const gauss = () => Math.sqrt(-2 * Math.log(rand() || 1e-12)) * Math.cos(2 * Math.PI * rand());

  // Pre-build a "where the burst centers fall" set so multiple samples
  // around each center get a contribution — `computeDriftCorrected`
  // reconstructs RA position via raraw differences, so we need the
  // burst to be expressed as a burst-shaped raraw bump.
  const centers: number[] = [];
  for (let t = burstPeriodSec; t <= n * dt; t += burstPeriodSec) centers.push(t);

  for (let i = 0; i < n; i++) {
    const t = (i + 1) * dt;
    let v = noiseSigma * gauss();
    for (const c of centers) {
      const offsetSamples = Math.round((t - c) / dt);
      if (Math.abs(offsetSamples) <= Math.floor(burstWidthSamples / 2)) {
        v += burstAmplitude;
      }
    }
    s.entries.push(makeEntry(i, t, v, 0));
  }
  return s;
}

describe('analyzeBursts', () => {
  it('finds the planted period as the top candidate', () => {
    // 600 samples × 2s = 1200s, burst every 86s → ~14 cycles in range.
    const s = makeBurstSession(600, 2.0, 0.1, 86, 1.5, 3);
    const opts = defaultBurstOptions({ begin: 0, end: s.entries.length });
    const run = analyzeBursts(s, { ...opts, axis: 'ra' });
    expect(run.candidates.length).toBeGreaterThan(0);
    const top = run.candidates[0];
    // The fundamental should land within ~15% of the planted 86s period.
    expect(Math.abs(top.periodSec - 86) / 86).toBeLessThan(0.15);
    expect(top.harmonic).toBe('fundamental');
    expect(top.acfValue).toBeGreaterThan(0.2);
  });

  it('the top candidate is supported by envelope peaks at ~the planted period', () => {
    // The raw `peakIntervals` may include spurious bumps; the candidate's
    // `medianIntervalSec` is the filtered version (only intervals within
    // 20% of the candidate period count). That's what the user actually
    // sees in the table.
    const s = makeBurstSession(600, 2.0, 0.1, 86, 1.5, 3);
    const opts = defaultBurstOptions({ begin: 0, end: s.entries.length });
    const run = analyzeBursts(s, { ...opts, axis: 'ra' });
    expect(run.peakIntervals.length).toBeGreaterThan(2);
    expect(run.candidates.length).toBeGreaterThan(0);
    const top = run.candidates[0];
    expect(top.supportingBurstCount).toBeGreaterThanOrEqual(3);
    expect(Math.abs(top.medianIntervalSec - 86) / 86).toBeLessThan(0.2);
  });

  it('flags harmonic relationships among candidates', () => {
    // The same burst train will also produce ACF peaks at 2T, 3T, etc.
    // The top candidate is fundamental; subsequent candidates should be
    // labeled as harmonics relative to it (when they fall within tolerance).
    const s = makeBurstSession(800, 2.0, 0.05, 86, 1.5, 3);
    const opts = defaultBurstOptions({ begin: 0, end: s.entries.length });
    const run = analyzeBursts(s, { ...opts, axis: 'ra', periodMaxSec: 400 });
    const [first] = run.candidates;
    expect(first).toBeDefined();
    expect(first.harmonic).toBe('fundamental');
    // At least one other candidate should be flagged half or double when
    // they exist near 43 / 172 within tolerance.
    const flagged = run.candidates.slice(1).filter((c) => c.harmonic === 'half' || c.harmonic === 'double');
    // We don't strictly require flagged > 0 (depends on which lobes the
    // ACF surfaces) but the first one must be marked fundamental and any
    // harmonic-bucket assignment that appears should be sensible.
    for (const c of flagged) {
      const ratio = c.periodSec / first.periodSec;
      if (c.harmonic === 'half') expect(Math.abs(ratio - 0.5)).toBeLessThan(0.12);
      if (c.harmonic === 'double') expect(Math.abs(ratio - 2)).toBeLessThan(0.24);
    }
  });

  it('returns intermediate stages for plotting', () => {
    const s = makeBurstSession(600, 2.0, 0.1, 86, 1.5, 3);
    const opts = defaultBurstOptions({ begin: 0, end: s.entries.length });
    const run = analyzeBursts(s, { ...opts, axis: 'ra' });
    expect(run.t.length).toBe(run.raw.length);
    expect(run.t.length).toBe(run.detrended.length);
    expect(run.t.length).toBe(run.envelope.length);
    expect(run.acfValues[0]).toBeCloseTo(1, 5);
    expect(run.acfLags.length).toBe(run.acfValues.length);
    expect(run.fftPeriod.length).toBe(run.fftAmplitude.length);
    expect(run.fftPeriod.length).toBeGreaterThan(0);
  });

  it('throws with insufficient data', () => {
    const s = makeBurstSession(10, 2.0, 0.1, 86, 1.5, 3);
    expect(() => analyzeBursts(s, {
      ...defaultBurstOptions({ begin: 0, end: s.entries.length }),
      axis: 'ra',
    })).toThrow();
  });

  it('high-pass removes a slow ramp without disturbing the burst period', () => {
    // Add a linear baseline drift on top of the bursts; HP should
    // remove it so the burst period still surfaces.
    const s = newGuideSession('2026-01-01 00:00:00');
    s.startsMs = 0;
    s.pixelScale = 1;
    const n = 600, dt = 2;
    let state = 0xdeadbeef >>> 0;
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
      let v = 0.05 * gauss();
      // Linear ramp 0..3 over the session
      v += 3 * (i / n);
      // Burst at 86s period
      const phase = t % 86;
      if (phase < dt) v += 1.5;
      s.entries.push(makeEntry(i, t, v, 0));
    }
    const opts = defaultBurstOptions({ begin: 0, end: s.entries.length });
    const runWithHP = analyzeBursts(s, { ...opts, axis: 'ra', highPassPeriodSec: 200 });
    expect(runWithHP.candidates.length).toBeGreaterThan(0);
    const top = runWithHP.candidates[0];
    // Within ~20% of 86s — wider tolerance because the burst is single-sample
    // and the envelope smoothing may shift the ACF peak slightly.
    expect(Math.abs(top.periodSec - 86) / 86).toBeLessThan(0.2);
  });

  it('respects direction filter', () => {
    // Inject only-positive bursts: the negative-direction analysis
    // should produce a much weaker (or absent) top candidate.
    const s = newGuideSession('2026-01-01 00:00:00');
    s.startsMs = 0;
    s.pixelScale = 1;
    const n = 600, dt = 2;
    for (let i = 0; i < n; i++) {
      const t = (i + 1) * dt;
      const phase = t % 86;
      const v = phase < dt ? 1.5 : 0;
      s.entries.push(makeEntry(i, t, v, 0));
    }
    const opts = defaultBurstOptions({ begin: 0, end: s.entries.length });
    const pos = analyzeBursts(s, { ...opts, axis: 'ra', direction: 'positive' });
    const neg = analyzeBursts(s, { ...opts, axis: 'ra', direction: 'negative' });
    expect(pos.candidates[0]?.acfValue ?? 0).toBeGreaterThan(neg.candidates[0]?.acfValue ?? 0);
  });
});
