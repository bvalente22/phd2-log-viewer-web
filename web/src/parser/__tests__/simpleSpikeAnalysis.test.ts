import { describe, expect, it } from 'vitest';
import { analyzeSimpleSpikes } from '../simpleSpikeAnalysis';
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

/** Build a session with single-sample positive spikes at every
 *  `periodSec` boundary, on top of small Gaussian noise. */
function makeSpikeSession(
  n: number,
  dt: number,
  noiseSigma: number,
  periodSec: number,
  spikeAmp: number,
): GuideSession {
  const s = newGuideSession('2026-01-01 00:00:00');
  s.startsMs = 0;
  s.pixelScale = 1;
  let state = 0xc0ffee >>> 0;
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
    if (Math.abs((t % periodSec)) < dt) v += spikeAmp;
    s.entries.push(makeEntry(i, t, v, 0));
  }
  return s;
}

describe('analyzeSimpleSpikes', () => {
  it('returns the planted period (within ~15%) and a sensible mean amplitude', () => {
    // 600 samples × 2s = 1200s span, spike every 86s → ~14 cycles.
    const s = makeSpikeSession(600, 2, 0.1, 86, 1.5);
    const run = analyzeSimpleSpikes(s, {
      range: { begin: 0, end: s.entries.length },
      axis: 'ra',
      direction: 'both',
    });
    expect(run.spikeIndices.length).toBeGreaterThan(5);
    expect(Math.abs(run.periodSec - 86) / 86).toBeLessThan(0.15);
    // Mean amplitude should land near the planted spike size (1.5),
    // give or take noise contribution to flagged samples.
    expect(run.meanAmplitude).toBeGreaterThan(1.0);
    expect(run.meanAmplitude).toBeLessThan(2.0);
  });

  it('respects direction=positive (excludes negative-side noise)', () => {
    const s = makeSpikeSession(600, 2, 0.1, 86, 1.5);
    const both = analyzeSimpleSpikes(s, {
      range: { begin: 0, end: s.entries.length }, axis: 'ra', direction: 'both',
    });
    const pos = analyzeSimpleSpikes(s, {
      range: { begin: 0, end: s.entries.length }, axis: 'ra', direction: 'positive',
    });
    expect(pos.spikeIndices.length).toBeLessThanOrEqual(both.spikeIndices.length);
    for (const i of pos.spikeIndices) {
      expect(pos.detrended[i] - pos.median).toBeGreaterThan(0);
    }
  });

  it('linear detrend zeroes the slope (within numerical precision)', () => {
    // Plant a strong linear ramp; the detrended series should have no
    // residual slope.
    const s = newGuideSession('2026-01-01 00:00:00');
    s.startsMs = 0;
    s.pixelScale = 1;
    const n = 200, dt = 2;
    for (let i = 0; i < n; i++) {
      const t = (i + 1) * dt;
      // Pure linear ramp 0 → 5 — no spikes.
      s.entries.push(makeEntry(i, t, 5 * (i / n), 0));
    }
    const run = analyzeSimpleSpikes(s, {
      range: { begin: 0, end: s.entries.length }, axis: 'ra', direction: 'both',
    });
    // Detrended series should sum to ~0 (zero mean) and the slope from
    // first to last should be tiny.
    let sum = 0;
    for (let i = 0; i < run.detrended.length; i++) sum += run.detrended[i];
    expect(Math.abs(sum / run.detrended.length)).toBeLessThan(0.01);
    const slope = (run.detrended[run.detrended.length - 1] - run.detrended[0])
      / (run.t[run.t.length - 1] - run.t[0]);
    expect(Math.abs(slope)).toBeLessThan(0.01);
  });

  it('throws with insufficient data', () => {
    const s = makeSpikeSession(10, 2, 0.1, 86, 1.5);
    expect(() => analyzeSimpleSpikes(s, {
      range: { begin: 0, end: s.entries.length }, axis: 'ra', direction: 'both',
    })).toThrow();
  });

  it('reports period 0 when no spikes detected', () => {
    // Pure noise — no spikes should clear the threshold.
    const s = makeSpikeSession(200, 2, 0.05, 100000, 0.001);
    const run = analyzeSimpleSpikes(s, {
      range: { begin: 0, end: s.entries.length }, axis: 'ra', direction: 'both',
    });
    if (run.spikeIndices.length === 0) {
      expect(run.periodSec).toBe(0);
      expect(run.meanAmplitude).toBe(0);
    }
  });
});
