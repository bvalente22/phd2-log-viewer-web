import { describe, it, expect } from 'vitest';
import { primaryPeriod, periodRatio, rampValue } from '../perioPeaks';

// Curve with local maxima at periods 100 (amp 5), 200 (amp 4), 400 (amp 6),
// 800 (amp 9). 800 is the highest amplitude but exceeds a typical max-period.
const curve = {
  x: [50, 100, 150, 200, 250, 400, 550, 800, 1000],
  y: [1, 5, 1, 4, 1, 6, 1, 9, 1],
};

describe('primaryPeriod', () => {
  it('picks the LONGEST-period peak at or below maxPeriodSec (not the highest amplitude)', () => {
    expect(primaryPeriod(curve, 600)).toBe(400);
  });
  it('includes peaks up to and including maxPeriodSec', () => {
    expect(primaryPeriod(curve, 800)).toBe(800);
  });
  it('returns null when no peak qualifies', () => {
    expect(primaryPeriod(curve, 50)).toBeNull();
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
