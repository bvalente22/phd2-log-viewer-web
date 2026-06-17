import { describe, it, expect } from 'vitest';
import { calcStats } from '../stats';
import { newGuideSession } from '../types';
import type { GuideEntry } from '../types';
import { computePolarAlignment } from '../polarAlignment';

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

  it('computes RMS about the mean (std-dev), not about zero', () => {
    // RA values [2,2,4,4]: mean = 3, std-dev = 1. RMS-about-zero would be
    // sqrt((4+4+16+16)/4) = sqrt(10) ≈ 3.162. The desktop PHDLogView reports
    // the standard deviation (RMS about the mean), so we must get 1.
    const s = newGuideSession('x');
    s.entries = [mkE(1, 1, 2, 5), mkE(2, 2, 2, 5), mkE(3, 3, 4, 9), mkE(4, 4, 4, 9)];
    s.pixelScale = 1;
    const st = calcStats(s);
    expect(st.rmsRa).toBeCloseTo(1);   // mean 3, std 1
    expect(st.rmsDec).toBeCloseTo(2);  // mean 7, std 2
    expect(st.rmsTotal).toBeCloseTo(Math.sqrt(1 + 4));
    // mean/peak are unaffected by the mean-subtraction.
    expect(st.meanRa).toBeCloseTo(3);
    expect(st.peakRa).toBeCloseTo(4);
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

describe('calcStats polar-alignment fields', () => {
  it('exposes Alt/Az/trust/HA and drift matching computePolarAlignment', () => {
    const s = newGuideSession('x');
    s.entries = [mkE(1, 0, 0, 0), mkE(2, 60, 0, 1), mkE(3, 120, 0, 2), mkE(4, 180, 0, 3)];
    s.pixelScale = 2; s.declination = 0; s.hourAngleHours = 3;
    const pa = computePolarAlignment(s);
    const st = calcStats(s);
    expect(st.driftDec).toBeCloseTo(pa.driftDecPxMin, 6);
    expect(st.paeArcMin).toBeCloseTo(pa.paeTotalArcMin, 6);
    expect(st.altArcMin).toBeCloseTo(pa.altArcMin!, 6);
    expect(st.azArcMin).toBeCloseTo(pa.azArcMin!, 6);
    expect(st.altTrust).toBe(true);
    expect(st.azTrust).toBe(true);
    expect(st.hourAngleHours).toBe(3);
  });
});
