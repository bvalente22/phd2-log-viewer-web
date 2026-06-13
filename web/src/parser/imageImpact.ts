// Estimate how asymmetric RA/Dec guide RMS may elongate stars in an imaging
// scope, by combining the (already-arcsec) guide RMS with a base seeing FWHM in
// quadrature. Pure + presentation-free so the model is unit-testable. Modeled on
// imagingEstimator/guideEccChatGPT.html. Guide image scale is NOT needed here:
// the RMS are already in arcseconds, so it would only convert to guide pixels,
// which this panel does not show.

const FWHM_PER_SIGMA = 2.355; // Gaussian FWHM = 2.355 * sigma

export interface SeeingPreset {
  key: string;   // i18n suffix: imageImpact.preset_<key>
  fwhm: number;  // midpoint FWHM of the seeing range, arcsec
}

// Midpoint of each seeing range (see the spec table).
export const SEEING_PRESETS: SeeingPreset[] = [
  { key: 'exceptional', fwhm: 0.75 },
  { key: 'good', fwhm: 1.5 },
  { key: 'ok', fwhm: 3.0 },
  { key: 'poor', fwhm: 4.5 },
  { key: 'veryPoor', fwhm: 5.5 },
];

/** Preset key whose midpoint equals `fwhm` (within 1e-6), else 'custom'. */
export function presetForFwhm(fwhm: number): string {
  const hit = SEEING_PRESETS.find((p) => Math.abs(p.fwhm - fwhm) < 1e-6);
  return hit ? hit.key : 'custom';
}

export interface ImageImpactResult {
  dominantAxis: 'RA' | 'Dec';
  majorRmsArcsec: number;        // max(ra, dec)
  minorRmsArcsec: number;        // min(ra, dec)
  finalFwhmMajorArcsec: number;
  finalFwhmMinorArcsec: number;
  finalFwhmMajorPx: number;
  finalFwhmMinorPx: number;
  estimatedEccentricity: number; // [0,1)
  guidingOnlyEccentricity: number; // guide-error ellipse alone, before seeing
  baseFwhmArcsec: number;        // = input fwhm (dashed base circle)
}

const safeSqrt = (x: number) => Math.sqrt(Math.max(0, x));

/**
 * Returns the estimated star-shape model, or null when any input is <= 0 (empty
 * selection or an unset field) — the caller renders a "no data" hint then.
 */
export function computeImageImpact(
  raRmsArcsec: number,
  decRmsArcsec: number,
  imagingScale: number,
  fwhmArcsec: number,
): ImageImpactResult | null {
  if (!(raRmsArcsec > 0) || !(decRmsArcsec > 0) || !(imagingScale > 0) || !(fwhmArcsec > 0)) {
    return null;
  }
  const major = Math.max(raRmsArcsec, decRmsArcsec);
  const minor = Math.min(raRmsArcsec, decRmsArcsec);
  const dominantAxis: 'RA' | 'Dec' = raRmsArcsec >= decRmsArcsec ? 'RA' : 'Dec';

  const baseSigma = fwhmArcsec / FWHM_PER_SIGMA;
  const sigmaMajor = safeSqrt(baseSigma * baseSigma + major * major);
  const sigmaMinor = safeSqrt(baseSigma * baseSigma + minor * minor);

  const estimatedEccentricity = safeSqrt(1 - (sigmaMinor / sigmaMajor) ** 2);
  const guidingOnlyEccentricity = safeSqrt(1 - (minor / major) ** 2);
  const finalFwhmMajorArcsec = sigmaMajor * FWHM_PER_SIGMA;
  const finalFwhmMinorArcsec = sigmaMinor * FWHM_PER_SIGMA;

  return {
    dominantAxis,
    majorRmsArcsec: major,
    minorRmsArcsec: minor,
    finalFwhmMajorArcsec,
    finalFwhmMinorArcsec,
    finalFwhmMajorPx: finalFwhmMajorArcsec / imagingScale,
    finalFwhmMinorPx: finalFwhmMinorArcsec / imagingScale,
    estimatedEccentricity,
    guidingOnlyEccentricity,
    baseFwhmArcsec: fwhmArcsec,
  };
}

export type ElongationRating = 'low' | 'moderate' | 'high';

/** Qualitative label for an estimated eccentricity (prototype thresholds). */
export function elongationRating(ecc: number): ElongationRating {
  if (ecc < 0.25) return 'low';
  if (ecc < 0.45) return 'moderate';
  return 'high';
}

export interface SamplingRelation {
  relation: 'same' | 'coarser' | 'finer';
  ratio: number; // larger/smaller scale; 1 when essentially equal
}

/**
 * How the guide-camera pixel scale compares to the imaging-camera scale. Does
 * not affect eccentricity (RMS are already arc-sec); it explains how the same
 * sky error maps onto each camera's pixels.
 */
export function samplingRelation(guideScale: number, imagingScale: number): SamplingRelation {
  if (Math.abs(guideScale - imagingScale) < 0.001) return { relation: 'same', ratio: 1 };
  return guideScale > imagingScale
    ? { relation: 'coarser', ratio: guideScale / imagingScale }
    : { relation: 'finer', ratio: imagingScale / guideScale };
}
