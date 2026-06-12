import { describe, it, expect } from 'vitest';
import { computeImageImpact, presetForFwhm, SEEING_PRESETS } from '../imageImpact';

describe('computeImageImpact', () => {
  it('worked example is RA-dominant with the expected final shape', () => {
    const r = computeImageImpact(0.75, 0.55, 0.80, 3.00)!;
    expect(r.dominantAxis).toBe('RA');
    expect(r.majorRmsArcsec).toBeCloseTo(0.75);
    expect(r.minorRmsArcsec).toBeCloseTo(0.55);
    expect(r.finalFwhmMajorArcsec).toBeCloseTo(3.481, 2);
    expect(r.finalFwhmMinorArcsec).toBeCloseTo(3.268, 2);
    expect(r.finalFwhmMajorPx).toBeCloseTo(4.352, 2);
    expect(r.finalFwhmMinorPx).toBeCloseTo(4.085, 2);
    expect(r.estimatedEccentricity).toBeCloseTo(0.345, 2);
    expect(r.baseFwhmArcsec).toBe(3.00);
  });

  it('is Dec-dominant when Dec RMS is larger; magnitudes mirror', () => {
    const r = computeImageImpact(0.55, 0.75, 0.80, 3.00)!;
    expect(r.dominantAxis).toBe('Dec');
    expect(r.majorRmsArcsec).toBeCloseTo(0.75);
    expect(r.estimatedEccentricity).toBeCloseTo(0.345, 2);
  });

  it('equal axes -> eccentricity 0', () => {
    const r = computeImageImpact(0.6, 0.6, 1, 2)!;
    expect(r.estimatedEccentricity).toBeCloseTo(0);
  });

  it('returns null when any input is <= 0', () => {
    expect(computeImageImpact(0, 0.5, 1, 3)).toBeNull();
    expect(computeImageImpact(0.5, 0.5, 0, 3)).toBeNull();
    expect(computeImageImpact(0.5, 0.5, 1, 0)).toBeNull();
  });
});

describe('presetForFwhm', () => {
  it('matches preset midpoints, else custom', () => {
    expect(presetForFwhm(3.0)).toBe('ok');
    expect(presetForFwhm(0.75)).toBe('exceptional');
    expect(presetForFwhm(5.5)).toBe('veryPoor');
    expect(presetForFwhm(2.2)).toBe('custom');
  });
  it('SEEING_PRESETS lists the five tiers in order', () => {
    expect(SEEING_PRESETS.map((p) => p.key)).toEqual(['exceptional', 'good', 'ok', 'poor', 'veryPoor']);
  });
});
