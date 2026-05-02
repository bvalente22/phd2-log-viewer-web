import { describe, it, expect } from 'vitest';
import { calcStats } from '../stats';
import { newGuideSession } from '../types';
import type { GuideEntry } from '../types';

const mkE = (frame: number, dt: number, ra: number, dec: number, included = true): GuideEntry => ({
  frame, dt, mount: 'MOUNT', included, guiding: true,
  dx: ra, dy: dec, raraw: ra, decraw: dec, raguide: ra, decguide: dec,
  radur: 0, decdur: 0, mass: 0, snr: 0, err: 0, info: '',
});

describe('calcStats', () => {
  it('computes RMS, peak, mean for a small set', () => {
    const s = newGuideSession('x');
    s.entries = [mkE(1, 1, 1, 0), mkE(2, 2, -1, 0), mkE(3, 3, 1, 0), mkE(4, 4, -1, 0)];
    s.pixelScale = 2;
    const st = calcStats(s);
    expect(st.rmsRa).toBeCloseTo(1);
    expect(st.rmsDec).toBeCloseTo(0);
    expect(st.peakRa).toBeCloseTo(1);
    expect(st.meanRa).toBeCloseTo(0);
    expect(st.includedCount).toBe(4);
    expect(st.excludedCount).toBe(0);
    expect(st.rmsRaArcsec).toBeCloseTo(2);
  });

  it('computes drift from a linear ramp', () => {
    const s = newGuideSession('x');
    s.entries = [mkE(1, 0, 0, 0), mkE(2, 60, 1, 0), mkE(3, 120, 2, 0), mkE(4, 180, 3, 0)];
    const st = calcStats(s);
    expect(st.driftRa).toBeCloseTo(1, 3);
  });

  it('respects exclusion mask', () => {
    const s = newGuideSession('x');
    s.entries = [mkE(1, 1, 10, 0), mkE(2, 2, 1, 0), mkE(3, 3, -1, 0)];
    const mask = new Uint8Array([1, 0, 0]);
    const st = calcStats(s, mask);
    expect(st.peakRa).toBeCloseTo(1);
    expect(st.includedCount).toBe(2);
    expect(st.excludedCount).toBe(1);
  });

  it('skips entries with included=false', () => {
    const s = newGuideSession('x');
    s.entries = [mkE(1, 1, 99, 0, false), mkE(2, 2, 1, 0), mkE(3, 3, -1, 0)];
    const st = calcStats(s);
    expect(st.peakRa).toBeCloseTo(1);
    expect(st.includedCount).toBe(2);
  });
});
