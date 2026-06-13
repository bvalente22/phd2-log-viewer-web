import { describe, it, expect } from 'vitest';
import {
  computeImageImpact, presetForFwhm, SEEING_PRESETS,
  elongationRating, samplingRelation,
} from '../imageImpact';

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

describe('guidingOnlyEccentricity', () => {
  it('is the guide-error ellipse eccentricity, before adding seeing', () => {
    const r = computeImageImpact(0.75, 0.55, 0.80, 3.00)!;
    expect(r.guidingOnlyEccentricity).toBeCloseTo(0.680, 2); // sqrt(1-(0.55/0.75)^2)
  });
});

describe('axesEffectivelyEqual', () => {
  it('true when the RA/Dec RMS differ by less than 0.2 arcsec', () => {
    expect(computeImageImpact(0.70, 0.60, 1, 3)!.axesEffectivelyEqual).toBe(true);  // diff ~0.10
    expect(computeImageImpact(0.80, 0.50, 1, 3)!.axesEffectivelyEqual).toBe(false); // diff ~0.30
    // order-independent
    expect(computeImageImpact(0.60, 0.70, 1, 3)!.axesEffectivelyEqual).toBe(true);
  });
});

describe('elongationRating', () => {
  it('low below 0.25, moderate below 0.45, else high', () => {
    expect(elongationRating(0.2)).toBe('low');
    expect(elongationRating(0.25)).toBe('moderate');
    expect(elongationRating(0.3)).toBe('moderate');
    expect(elongationRating(0.45)).toBe('high');
    expect(elongationRating(0.5)).toBe('high');
  });
});

describe('samplingRelation', () => {
  it('coarser when guide scale larger, finer when smaller, same when ~equal', () => {
    expect(samplingRelation(2.5, 0.8)).toEqual({ relation: 'coarser', ratio: 2.5 / 0.8 });
    expect(samplingRelation(0.8, 2.5)).toEqual({ relation: 'finer', ratio: 2.5 / 0.8 });
    expect(samplingRelation(1.0, 1.0)).toEqual({ relation: 'same', ratio: 1 });
    expect(samplingRelation(1.0, 1.0005)).toEqual({ relation: 'same', ratio: 1 });
  });
});
