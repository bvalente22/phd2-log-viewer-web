import { describe, it, expect } from 'vitest';
import { primaryPeriod, periodRatio, rampValue, curveTopPeaks, applyPrimaryOverride } from '../perioPeaks';

describe('applyPrimaryOverride', () => {
  // Amplitude-ranked, as curveTopPeaks returns them.
  const peaks = [
    { period: 389.5, amplitude: 2.34 },
    { period: 87.6, amplitude: 0.9 },
    { period: 83.5, amplitude: 0.7 },
  ];

  it('reports the manual period on the 1× peak and keeps its measured amplitude', () => {
    const out = applyPrimaryOverride(peaks, 384, 0.15);
    expect(out[0]).toEqual({ period: 384, amplitude: 2.34, measuredPeriod: 389.5 });
    expect(out[1]).toEqual(peaks[1]);
    expect(out[2]).toEqual(peaks[2]);
  });

  it('matches a 1× peak measured below the primary too', () => {
    const out = applyPrimaryOverride([{ period: 365.5, amplitude: 1 }], 384, 0.15);
    expect(out[0]).toMatchObject({ period: 384, measuredPeriod: 365.5 });
  });

  it('overrides only the strongest peak when two fall within tolerance', () => {
    const out = applyPrimaryOverride(
      [{ period: 395, amplitude: 3 }, { period: 372, amplitude: 2 }],
      384, 0.15,
    );
    expect(out[0]).toMatchObject({ period: 384, measuredPeriod: 395 });
    expect(out[1]).toEqual({ period: 372, amplitude: 2 });
  });

  it('leaves every peak alone when none is near the primary', () => {
    const out = applyPrimaryOverride(peaks.slice(1), 384, 0.15);
    expect(out).toEqual(peaks.slice(1));
    expect(out.some((p) => 'measuredPeriod' in p)).toBe(false);
  });

  it('does not mutate its input', () => {
    const input = [{ period: 389.5, amplitude: 2.34 }];
    applyPrimaryOverride(input, 384, 0.15);
    expect(input[0].period).toBe(389.5);
  });
});

// Local maxima at periods 150 (amp 4), 300 (amp 10), 460 (amp 2). The dominant
// (largest-amplitude) peak is 300; 460 is a small longer-period bump — exactly
// the kind of peak the old "longest peak <= max" rule wrongly latched onto.
const curve = {
  x: [100, 150, 200, 300, 380, 460, 550],
  y: [1, 4, 1, 10, 1, 2, 1],
};

describe('primaryPeriod', () => {
  it('picks the LARGEST-amplitude peak at or below maxPeriodSec (not the longest period)', () => {
    expect(primaryPeriod(curve, 600)).toBe(300);
  });
  it('still picks the tallest peak when a small longer-period bump is in range', () => {
    expect(primaryPeriod(curve, 500)).toBe(300);
  });
  it('falls back to the tallest remaining peak when the dominant one exceeds max', () => {
    // max 250 excludes the 300s peak (amp 10), leaving 150s (amp 4) as tallest.
    expect(primaryPeriod(curve, 250)).toBe(150);
  });
  it('returns null when no peak qualifies', () => {
    expect(primaryPeriod(curve, 120)).toBeNull();
  });
});

describe('curveTopPeaks (top-3 capped at the primary period)', () => {
  it('excludes peaks longer than the cap and ranks the rest by amplitude', () => {
    // cap = 300 (the primary). The 460s bump is dropped; 300 (amp 10) outranks
    // 150 (amp 4). This is exactly how the modal caps the top-3 at the primary.
    const top = curveTopPeaks(curve, 3, 300);
    expect(top.map((p) => p.period)).toEqual([300, 150]);
  });
});

describe('periodRatio', () => {
  it('is primary / period', () => {
    expect(periodRatio(400, 200)).toBeCloseTo(2);
    expect(periodRatio(400, 400)).toBeCloseTo(1);
  });
});

describe('rampValue', () => {
  it('is amplitude / period scaled by 1000', () => {
    expect(rampValue(2.3, 400)).toBeCloseTo(5.75);
    expect(rampValue(0.36, 400)).toBeCloseTo(0.9);
  });
});
