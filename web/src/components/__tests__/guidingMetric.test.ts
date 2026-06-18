import { describe, it, expect } from 'vitest';
import { aspectRatioMetric, eccentricityMetric, guidingMetric } from '../guidingMetric';

describe('aspectRatioMetric.compute', () => {
  it('Max/Min of the two RMS values', () => {
    expect(aspectRatioMetric.compute(3, 5)).toBeCloseTo(5 / 3); // 1.6667
    expect(aspectRatioMetric.compute(5, 3)).toBeCloseTo(5 / 3); // order-independent
    expect(aspectRatioMetric.compute(5, 5)).toBe(1);
  });
  it('returns null when an axis RMS is 0 (no data / division by zero)', () => {
    expect(aspectRatioMetric.compute(0, 0)).toBeNull();
    expect(aspectRatioMetric.compute(0, 4)).toBeNull();
  });
});

describe('aspectRatioMetric.band', () => {
  it('green at or below 1.20', () => {
    expect(aspectRatioMetric.band(1)).toBe('green');
    expect(aspectRatioMetric.band(1.2)).toBe('green');
  });
  it('yellow from 1.21 to 1.60', () => {
    expect(aspectRatioMetric.band(1.21)).toBe('yellow');
    expect(aspectRatioMetric.band(1.6)).toBe('yellow');
  });
  it('red above 1.60', () => {
    expect(aspectRatioMetric.band(1.61)).toBe('red');
    expect(aspectRatioMetric.band(3)).toBe('red');
  });
  it('thresholds use the value rounded to 2 decimals', () => {
    expect(aspectRatioMetric.band(1.604)).toBe('yellow'); // -> 1.60
    expect(aspectRatioMetric.band(1.605)).toBe('red');     // -> 1.61
  });
});

describe('eccentricityMetric (dormant, kept)', () => {
  it('compute: sqrt(1 - lo^2/hi^2), order-independent, null on no motion', () => {
    expect(eccentricityMetric.compute(3, 5)).toBeCloseTo(0.8);
    expect(eccentricityMetric.compute(5, 3)).toBeCloseTo(0.8);
    expect(eccentricityMetric.compute(4, 4)).toBeCloseTo(0);
    expect(eccentricityMetric.compute(0, 0)).toBeNull();
  });
  it('band thresholds', () => {
    expect(eccentricityMetric.band(0.5)).toBe('green');
    expect(eccentricityMetric.band(0.65)).toBe('yellow');
    expect(eccentricityMetric.band(0.66)).toBe('red');
  });
});

describe('active metric', () => {
  it('defaults to Aspect Ratio', () => {
    expect(guidingMetric).toBe(aspectRatioMetric);
    expect(guidingMetric.labelKey).toBe('guide.aspectRatio');
  });
});

import { polarAlignmentBand } from '../guidingMetric';

describe('polarAlignmentBand', () => {
  it('bands by 2′ and 5′ thresholds', () => {
    expect(polarAlignmentBand(0)).toBe('green');
    expect(polarAlignmentBand(2)).toBe('green');
    expect(polarAlignmentBand(2.01)).toBe('yellow');
    expect(polarAlignmentBand(5)).toBe('yellow');
    expect(polarAlignmentBand(5.01)).toBe('red');
  });
});
