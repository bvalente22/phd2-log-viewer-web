import { describe, it, expect } from 'vitest';
import { primaryPeriod, periodRatio, rampValue } from '../perioPeaks';

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
