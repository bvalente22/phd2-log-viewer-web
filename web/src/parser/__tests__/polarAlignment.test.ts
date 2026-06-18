import { describe, it, expect } from 'vitest';
import { computePolarAlignment, settlingMask } from '../polarAlignment';
import { newGuideSession } from '../types';
import type { GuideEntry, GuideSession } from '../types';

// Full entry builder (mkE in stats.test only sets ra/dec).
const e = (o: Partial<GuideEntry>): GuideEntry => ({
  frame: 0, dt: 0, mount: 'MOUNT', included: true, guiding: true,
  dx: 0, dy: 0, raraw: 0, decraw: 0, raguide: 0, decguide: 0,
  radur: 0, decdur: 0, mass: 0, snr: 0, err: 0, info: '', ...o,
});

const session = (entries: GuideEntry[], extra: Partial<GuideSession> = {}): GuideSession => {
  const s = newGuideSession('x');
  s.entries = entries; s.pixelScale = 1; s.declination = 0; s.hourAngleHours = 0;
  Object.assign(s, extra);
  return s;
};

describe('settlingMask', () => {
  it('excludes entries between Settling started and Settling complete', () => {
    const s = session([e({ dt: 0 }), e({ dt: 1 }), e({ dt: 2 }), e({ dt: 3 })]);
    s.infos = [
      { idx: 1, repeats: 1, info: 'Settling started' },
      { idx: 3, repeats: 1, info: 'Settling complete' },
    ];
    expect(settlingMask(s)).toEqual([false, true, true, false]);
  });
});

describe('computePolarAlignment drift', () => {
  it('RA drift backs out corrections via the endpoint formula', () => {
    // raraw ramps 0..3 over 180s, but 1.0 px of correction was applied total.
    // Uncorrected displacement = (3 - 0) - (-1) ... here raguide sums to 1 on a
    // pulsed frame, so endpoint = (3 - 0 - 1)/180 px/s = 2/180; *60 = 0.6667 px/min.
    const s = session([
      e({ dt: 0, raraw: 0 }),
      e({ dt: 60, raraw: 1, raguide: 1, radur: 50 }),
      e({ dt: 120, raraw: 2 }),
      e({ dt: 180, raraw: 3 }),
    ]);
    const pa = computePolarAlignment(s);
    expect(pa.driftRaPxMin).toBeCloseTo((3 - 0 - 1) / 180 * 60, 4);
  });

  it('Dec drift is the cumulative-uncorrected slope', () => {
    // All frames un-pulsed & adjacent: cumulative = raw decraw ramp 0..3 over 180s.
    const s = session([
      e({ dt: 0, decraw: 0 }),
      e({ dt: 60, decraw: 1 }),
      e({ dt: 120, decraw: 2 }),
      e({ dt: 180, decraw: 3 }),
    ]);
    const pa = computePolarAlignment(s);
    expect(pa.driftDecPxMin).toBeCloseTo(1, 4); // 1 px/min
  });

  it('Dec drift does NOT accumulate across a settling gap (skip-gaps)', () => {
    // decraw jumps from 0.1 to 5.0 across a settling gap (lock moved). Without
    // skip-gaps the slope would be huge; with it, the gap delta is ignored so
    // the trend stays ~0.
    const s = session([
      e({ dt: 0, decraw: 0.0 }),
      e({ dt: 60, decraw: 0.1 }),  // last before gap
      e({ dt: 120, decraw: 5.0 }), // first after gap (excluded-neighbor → skip delta)
      e({ dt: 180, decraw: 5.1 }),
    ]);
    s.infos = [
      { idx: 2, repeats: 1, info: 'Settling started' },
      { idx: 2, repeats: 1, info: 'Settling complete' }, // excludes nothing here…
    ];
    // Force a gap by excluding index 2 via the mask (simulates a dropped/settling frame).
    const mask = new Uint8Array([0, 0, 1, 0]);
    const pa = computePolarAlignment(s, mask);
    // Included indices: 0,1,3. Pair (1->3) is non-adjacent (idx 2 excluded) → its
    // delta is skipped. Pair (0->1) delta = +0.1. So cumulative is tiny, slope small.
    expect(Math.abs(pa.driftDecPxMin)).toBeLessThan(0.5);
  });
});

describe('computePolarAlignment PAE + decomposition', () => {
  // Dec drift fixture: decraw ramps so drift = 1 px/min; pixelScale 2 → 2"/min.
  const ramp = () => {
    const s = session([
      e({ dt: 0, decraw: 0 }), e({ dt: 60, decraw: 1 }),
      e({ dt: 120, decraw: 2 }), e({ dt: 180, decraw: 3 }),
    ]);
    s.pixelScale = 2;
    return s;
  };

  it('total PAE = 3.8197 * |Dec drift "/min| / cos(dec)', () => {
    const s = ramp();
    s.declination = 0; // cos = 1
    const pa = computePolarAlignment(s);
    expect(pa.paeTotalArcMin).toBeCloseTo(3.8197 * 2, 3); // 1 px/min * 2 "/px = 2 "/min
  });

  it('at HA 0h: predominantly azimuth, altitude small', () => {
    // ramp() has dt=[0,60,120,180], meanDt=90s → effectiveHa ≈ 0.025h
    // azSens≈1, altSens≈0.0066 (small but not exactly 0 due to effective HA shift)
    const s = ramp(); s.hourAngleHours = 0;
    const pa = computePolarAlignment(s);
    expect(pa.azArcMin!).toBeGreaterThan(pa.altArcMin!);
    expect(pa.azArcMin!).toBeCloseTo(pa.paeTotalArcMin, 2); // ~99.998% azimuth
    expect(pa.azTrust).toBe(true);
    expect(pa.altTrust).toBe(false);
  });

  it('at HA 6h: predominantly altitude, azimuth small', () => {
    // ramp() meanDt=90s → effectiveHa ≈ 6.025h; altSens≈1, azSens≈0.0066
    const s = ramp(); s.hourAngleHours = 6; // near 90 deg
    const pa = computePolarAlignment(s);
    expect(pa.altArcMin!).toBeGreaterThan(pa.azArcMin!);
    expect(pa.altArcMin!).toBeCloseTo(pa.paeTotalArcMin, 2); // ~99.998% altitude
    expect(pa.altTrust).toBe(true);
    expect(pa.azTrust).toBe(false);
  });

  it('at HA 3h (45 deg): both axes trusted, split matches effective-HA sin/cos', () => {
    const s = ramp(); s.hourAngleHours = 3; // near 45 deg
    const pa = computePolarAlignment(s);
    // ramp() has dt=[0,60,120,180], all 4 frames included; mean dt = (0+60+120+180)/4 = 90s
    const meanDt = (0 + 60 + 120 + 180) / 4; // 90s
    const effectiveHa = 3 + (meanDt / 3600) * 1.0027379;
    const haRad = (effectiveHa * 15 * Math.PI) / 180;
    expect(pa.altTrust).toBe(true);
    expect(pa.azTrust).toBe(true);
    expect(pa.paeDeterminable).toBe(true);
    expect(pa.altArcMin!).toBeCloseTo(pa.paeTotalArcMin * Math.sin(haRad), 2);
    expect(pa.azArcMin!).toBeCloseTo(pa.paeTotalArcMin * Math.cos(haRad), 2);
  });

  it('null hour angle leaves Alt/Az null and untrusted', () => {
    const s = ramp(); s.hourAngleHours = null;
    const pa = computePolarAlignment(s);
    expect(pa.altArcMin).toBeNull();
    expect(pa.azArcMin).toBeNull();
    expect(pa.altTrust).toBe(false);
    expect(pa.azTrust).toBe(false);
  });

  it('PAE = 0 near declination ±90° (cos guard)', () => {
    const s = ramp();
    s.declination = Math.PI / 2; // cos ≈ 0 → guarded
    expect(computePolarAlignment(s).paeTotalArcMin).toBe(0);
    expect(computePolarAlignment(s).paeDeterminable).toBe(false);
  });

  it('paeDeterminable = false when fewer than 2 included frames', () => {
    // Only one included entry → firstIdx === lastIdx, so lastIdx > firstIdx is false.
    const s = session([
      e({ dt: 0, decraw: 0, included: false }),
      e({ dt: 60, decraw: 1, included: true }),
      e({ dt: 120, decraw: 2, included: false }),
    ]);
    s.pixelScale = 2;
    expect(computePolarAlignment(s).paeDeterminable).toBe(false);
  });
});

describe('effective hour angle', () => {
  it('uses the drift-weighted mean HA for the Alt/Az split (total PAE unchanged)', () => {
    // 0..600s of frames, Dec ramps so drift is nonzero. Start HA = -6h; over
    // 600s the effective (mean) HA moves toward the meridian, so |cos| grows
    // and the azimuth contribution rises above the start-HA value.
    const rows = [];
    for (let k = 0; k <= 10; k++) rows.push(e({ dt: k * 60, decraw: k * 0.1 }));
    const s = session(rows, { pixelScale: 5, declination: 0, hourAngleHours: -6 });
    const pa = computePolarAlignment(s);
    // effective HA = -6 + (mean dt 300s /3600)*1.0027 ≈ -5.916h
    expect(pa.effectiveHaHours).toBeCloseTo(-6 + (300 / 3600) * 1.0027379, 4);
    // azimuth contribution is now > 0 (start HA -6h would give |cos|≈0)
    expect(pa.azArcMin!).toBeGreaterThan(0);
    expect(pa.includedCount).toBe(11);
  });
  it('effectiveHaHours is null when hourAngleHours is null', () => {
    const s = session([e({ dt: 0, decraw: 0 }), e({ dt: 60, decraw: 1 })], { hourAngleHours: null });
    expect(computePolarAlignment(s).effectiveHaHours).toBeNull();
  });
});
