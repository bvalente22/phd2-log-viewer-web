import { describe, it, expect } from 'vitest';
import { canAnalyze, findUnguidedWindow, findUnguidedWindowAtTime } from '../analyze';
import { newGuideSession } from '../types';
import type { GuideEntry } from '../types';

const mkE = (frame: number, dt: number, included = true, guiding = true): GuideEntry => ({
  frame, dt, mount: 'MOUNT', included, guiding,
  dx: 0, dy: 0, raraw: 0, decraw: 0, raguide: 0, decguide: 0,
  radur: 0, decdur: 0, mass: 0, snr: 20, err: 0, info: '',
});

describe('canAnalyze', () => {
  it('returns false for a session with fewer than 12 valid entries', () => {
    const s = newGuideSession('x');
    s.entries = Array.from({ length: 10 }, (_, i) => mkE(i + 1, i + 1));
    expect(canAnalyze(s, { range: { begin: 0, end: 10 }, undoRaCorrections: false })).toBe(false);
  });

  it('returns true once 12 entries pass the filter', () => {
    const s = newGuideSession('x');
    s.entries = Array.from({ length: 12 }, (_, i) => mkE(i + 1, i + 1));
    expect(canAnalyze(s, { range: { begin: 0, end: 12 }, undoRaCorrections: false })).toBe(true);
  });

  it('honors the user mask when counting', () => {
    const s = newGuideSession('x');
    s.entries = Array.from({ length: 13 }, (_, i) => mkE(i + 1, i + 1));
    const mask = new Uint8Array(13);
    mask[0] = 1;
    mask[1] = 1;
    expect(canAnalyze(s, { range: { begin: 0, end: 13 }, undoRaCorrections: false, mask })).toBe(false);
  });

  it('skips entries that the parser flagged as not-included', () => {
    const s = newGuideSession('x');
    s.entries = Array.from({ length: 13 }, (_, i) => mkE(i + 1, i + 1, i > 0));
    expect(canAnalyze(s, { range: { begin: 0, end: 13 }, undoRaCorrections: false })).toBe(true);
    s.entries[5].included = false;
    s.entries[6].included = false;
    expect(canAnalyze(s, { range: { begin: 0, end: 13 }, undoRaCorrections: false })).toBe(false);
  });
});

describe('findUnguidedWindow', () => {
  it('returns null when every entry was guided', () => {
    const s = newGuideSession('x');
    s.entries = Array.from({ length: 5 }, (_, i) => mkE(i + 1, i + 1, true, true));
    expect(findUnguidedWindow(s)).toBeNull();
  });

  it('finds the first contiguous unguided run', () => {
    const s = newGuideSession('x');
    s.entries = [
      mkE(1, 1, true, true),
      mkE(2, 2, true, false),
      mkE(3, 3, true, false),
      mkE(4, 4, true, false),
      mkE(5, 5, true, true),
      mkE(6, 6, true, false),
    ];
    // Half-open: indices 1, 2, 3 are unguided so end = 4 (one past last).
    expect(findUnguidedWindow(s)).toEqual({ begin: 1, end: 4 });
  });

  it('finds the run starting at index 0 when the session opens unguided', () => {
    const s = newGuideSession('x');
    s.entries = [
      mkE(1, 1, true, false),
      mkE(2, 2, true, false),
      mkE(3, 3, true, true),
    ];
    // Indices 0, 1 are unguided; idx 2 is guided. end = 2 (half-open).
    expect(findUnguidedWindow(s)).toEqual({ begin: 0, end: 2 });
  });
});

describe('findUnguidedWindowAtTime', () => {
  // Two unguided windows: [1..3] and [5..7] (using inclusive index labels).
  const session = (() => {
    const s = newGuideSession('x');
    s.entries = [
      mkE(1, 1.0, true, true),    // idx 0 guided
      mkE(2, 2.0, true, false),   // idx 1 unguided
      mkE(3, 3.0, true, false),   // idx 2 unguided
      mkE(4, 4.0, true, false),   // idx 3 unguided
      mkE(5, 5.0, true, true),    // idx 4 guided
      mkE(6, 6.0, true, false),   // idx 5 unguided
      mkE(7, 7.0, true, false),   // idx 6 unguided
      mkE(8, 8.0, true, false),   // idx 7 unguided
      mkE(9, 9.0, true, true),    // idx 8 guided
    ];
    return s;
  })();

  it('returns the FIRST unguided window for clicks inside it', () => {
    expect(findUnguidedWindowAtTime(session, 2.5)).toEqual({ begin: 1, end: 4 });
  });

  it('returns the SECOND unguided window for clicks inside it', () => {
    expect(findUnguidedWindowAtTime(session, 6.5)).toEqual({ begin: 5, end: 8 });
  });

  it('returns null when the click lands on a guided frame', () => {
    expect(findUnguidedWindowAtTime(session, 5.0)).toBeNull();
  });

  it('snaps to the closest entry when the time is between samples', () => {
    // Time 1.9 is closer to entry idx 1 (dt=2.0, unguided) than idx 0 (dt=1.0, guided).
    expect(findUnguidedWindowAtTime(session, 1.9)).toEqual({ begin: 1, end: 4 });
  });

  it('returns null on an empty session', () => {
    const s = newGuideSession('x');
    expect(findUnguidedWindowAtTime(s, 0)).toBeNull();
  });
});

import { computeDriftCorrected } from '../analyze';

describe('computeDriftCorrected', () => {
  it('recovers the slope of a clean linear ramp', () => {
    const s = newGuideSession('x');
    s.entries = Array.from({ length: 60 }, (_, i) => ({
      ...mkE(i + 1, i + 1),
      decraw: 0.5 * (i + 1),
    }));
    const out = computeDriftCorrected(s, { range: { begin: 0, end: 60 }, undoRaCorrections: false });
    expect(out.driftDec).toBeCloseTo(0.5, 6);
    for (const v of out.decc) expect(Math.abs(v)).toBeLessThan(1e-6);
  });

  it('integrates accumulated RA position from per-frame moves', () => {
    const s = newGuideSession('x');
    s.entries = [
      { ...mkE(1, 1), raraw: 0, raguide: 0 },
      { ...mkE(2, 2), raraw: 0.3, raguide: 0 },
      { ...mkE(3, 3), raraw: 0.6, raguide: 0 },
      ...Array.from({ length: 9 }, (_, i) => ({ ...mkE(i + 4, i + 4), raraw: 0.6, raguide: 0 })),
    ];
    const out = computeDriftCorrected(s, { range: { begin: 0, end: 12 }, undoRaCorrections: false });
    expect(out.rac.length).toBe(12);
    for (const v of out.rac) expect(Number.isFinite(v)).toBe(true);
  });

  it('undoRaCorrections changes the effective rapos when raguide is non-zero', () => {
    const s = newGuideSession('x');
    s.entries = Array.from({ length: 12 }, (_, i) => ({
      ...mkE(i + 1, i + 1),
      raraw: 0,
      raguide: 0.1,
    }));
    const off = computeDriftCorrected(s, { range: { begin: 0, end: 12 }, undoRaCorrections: false });
    const on = computeDriftCorrected(s, { range: { begin: 0, end: 12 }, undoRaCorrections: true });
    expect(Math.abs(off.driftRa)).toBeLessThan(1e-6);
    expect(Math.abs(on.driftRa)).toBeGreaterThan(0.05);
  });

  it('honors the user mask in the drift fit', () => {
    const s = newGuideSession('x');
    s.entries = Array.from({ length: 12 }, (_, i) => ({
      ...mkE(i + 1, i + 1),
      decraw: i === 11 ? 1000 : 0,
    }));
    const mask = new Uint8Array(12);
    mask[11] = 1;
    const out = computeDriftCorrected(s, { range: { begin: 0, end: 12 }, undoRaCorrections: false, mask });
    expect(Math.abs(out.driftDec)).toBeLessThan(1e-6);
  });

  it('exposes per-sample frame number and raw RA/Dec aligned with t', () => {
    const s = newGuideSession('x');
    s.entries = Array.from({ length: 12 }, (_, i) => ({
      ...mkE(i + 1, (i + 1) * 2), // frame = i+1, dt = (i+1)*2
      raraw: 0.1 * (i + 1),
      decraw: -0.2 * (i + 1),
    }));
    const out = computeDriftCorrected(s, { range: { begin: 0, end: 12 }, undoRaCorrections: false });
    expect(out.frame.length).toBe(12);
    expect(Array.from(out.frame)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    expect(out.raRaw[5]).toBeCloseTo(0.6, 6);
    expect(out.decRaw[5]).toBeCloseTo(-1.2, 6);
    expect(out.t[5]).toBeCloseTo(12, 6); // dt of frame 6 = 6*2
  });

  it('skips masked entries in the per-sample arrays too', () => {
    const s = newGuideSession('x');
    s.entries = Array.from({ length: 12 }, (_, i) => ({ ...mkE(i + 1, i + 1), raraw: 0.1 * (i + 1) }));
    const mask = new Uint8Array(12);
    mask[3] = 1; // exclude frame 4
    const out = computeDriftCorrected(s, { range: { begin: 0, end: 12 }, undoRaCorrections: false, mask });
    expect(out.frame.length).toBe(11);
    expect(Array.from(out.frame)).not.toContain(4);
  });
});

import { analyze } from '../analyze';

describe('analyze (full pipeline)', () => {
  it('recovers a known sinusoid period and approximate amplitude', () => {
    const s = newGuideSession('x');
    s.pixelScale = 1;
    s.entries = Array.from({ length: 256 }, (_, i) => ({
      ...mkE(i + 1, i + 1),
      raraw: Math.cos((2 * Math.PI * (i + 1)) / 30),
    }));
    const ga = analyze(s, { range: { begin: 0, end: 256 }, undoRaCorrections: false });
    let imax = 0;
    for (let i = 1; i < ga.fftAmplitude.length; i++) {
      if (ga.fftAmplitude[i] > ga.fftAmplitude[imax]) imax = i;
    }
    const peakPeriod = ga.fftPeriod[imax];
    expect(peakPeriod).toBeGreaterThan(28);
    expect(peakPeriod).toBeLessThan(32);
    expect(ga.fftAmplitude[imax]).toBeGreaterThan(0.3);
    expect(ga.fftAmplitude[imax]).toBeLessThan(2.0);
  });

  it('produces fftPeriod sorted ascending and skips DC', () => {
    const s = newGuideSession('x');
    s.entries = Array.from({ length: 64 }, (_, i) => ({
      ...mkE(i + 1, i + 1),
      raraw: Math.sin(i * 0.4),
    }));
    const ga = analyze(s, { range: { begin: 0, end: 64 }, undoRaCorrections: false });
    expect(ga.fftPeriod.length).toBe(ga.fftAmplitude.length);
    expect(ga.fftPeriod.length).toBeGreaterThanOrEqual(5);
    for (let i = 1; i < ga.fftPeriod.length; i++) {
      expect(ga.fftPeriod[i]).toBeGreaterThanOrEqual(ga.fftPeriod[i - 1]);
    }
    for (const p of ga.fftPeriod) expect(Number.isFinite(p)).toBe(true);
  });

  it('attaches the requested undoRaCorrections flag and the session pixelScale', () => {
    const s = newGuideSession('x');
    s.pixelScale = 1.7;
    s.entries = Array.from({ length: 32 }, (_, i) => mkE(i + 1, i + 1));
    const ga = analyze(s, { range: { begin: 0, end: 32 }, undoRaCorrections: true });
    expect(ga.undoRaCorrections).toBe(true);
    expect(ga.pixelScale).toBeCloseTo(1.7);
    expect(ga.range).toEqual({ begin: 0, end: 32 });
  });

  it('throws when not enough entries are usable', () => {
    const s = newGuideSession('x');
    s.entries = Array.from({ length: 5 }, (_, i) => mkE(i + 1, i + 1));
    expect(() => analyze(s, { range: { begin: 0, end: 5 }, undoRaCorrections: false }))
      .toThrow(/at least 12/i);
  });

  it('FFTs at exactly N = n0 with no zero-padding (longest period = n0*dt)', () => {
    // n0 = 100 is NOT a power of two; the old code zero-padded to 128 and the
    // longest period read 128*dt instead of the desktop's 100*dt. dt = 1s here
    // (timestamps 1..100), so the longest period must be ~100, never 128.
    const s = newGuideSession('x');
    s.entries = Array.from({ length: 100 }, (_, i) => ({
      ...mkE(i + 1, i + 1),
      raraw: Math.cos((2 * Math.PI * (i + 1)) / 25),
    }));
    const ga = analyze(s, { range: { begin: 0, end: 100 }, undoRaCorrections: false });
    const longest = ga.fftPeriod[ga.fftPeriod.length - 1];
    expect(longest).toBeCloseTo(100, 3); // n0*dt, the desktop's arbitrary-N ceiling
    expect(longest).toBeLessThan(110); // and crucially NOT the padded 128
    expect(ga.fftPeriod.length).toBe(Math.floor(100 / 2) - 1); // 49 bins, not 63
  });
});

import { densePeriodogram, curveTopPeaks } from '../perioPeaks';

describe('analyze ↔ periodogram peaks (table matches the plotted curve)', () => {
  // Build a session whose RA carries a long-period sinusoid sampled over only
  // a few cycles — the sparse-long-period regime that exposed the bug.
  const buildSession = (n: number, periodSec: number, amp: number): ReturnType<typeof newGuideSession> => {
    const s = newGuideSession('x');
    s.pixelScale = 1;
    s.entries = Array.from({ length: n }, (_, i) => ({
      ...mkE(i + 1, i + 1),
      raraw: amp * Math.cos((2 * Math.PI * (i + 1)) / periodSec),
    }));
    return s;
  };

  it('reports the SAME peak the chart curve shows (#1 = curve argmax)', () => {
    const s = buildSession(120, 40, 1);
    const ga = analyze(s, { range: { begin: 0, end: 120 }, undoRaCorrections: false });
    const curve = densePeriodogram(ga.fftPeriod, ga.fftSpline);
    const peaks = curveTopPeaks(curve, 3, 600);
    expect(peaks.length).toBeGreaterThan(0);
    // The reported #1 peak must equal the global maximum of the drawn curve
    // (within the maxPeriod window) — this is the "table == graph" invariant.
    let curveMax = -Infinity;
    let curveMaxP = 0;
    for (let i = 0; i < curve.x.length; i++) {
      if (curve.x[i] <= 600 && curve.y[i] > curveMax) { curveMax = curve.y[i]; curveMaxP = curve.x[i]; }
    }
    expect(peaks[0].amplitude).toBeCloseTo(curveMax, 6);
    expect(peaks[0].period).toBeCloseTo(curveMaxP, 6);
  });

  it('the curve peak amplitude never falls below the FFT bins it interpolates', () => {
    // raw-RA sinusoid → the Akima curve rides on or above its control points,
    // and fftAmpMax (the y-axis ceiling) must cover the drawn peak so it is
    // never clipped.
    const s = buildSession(120, 40, 1);
    const ga = analyze(s, { range: { begin: 0, end: 120 }, undoRaCorrections: false });
    let binMax = 0;
    for (const a of ga.fftAmplitude) if (a > binMax) binMax = a;
    expect(ga.fftAmpMax).toBeGreaterThanOrEqual(binMax - 1e-9);
  });
});
