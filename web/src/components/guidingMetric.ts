// Single source of truth for the StatsGrid Total-row metric badge. Two metrics
// are defined; `guidingMetric` selects the active one. Both are pure ratios of
// the per-axis RMS (rmsRa, rmsDec), so they are scale-independent and
// order-independent. `compute` returns null when there is no motion to measure
// (an empty / fully-excluded selection), which the badge renders as "—".

export type Band = 'green' | 'yellow' | 'red';

// Tailwind background + readable text per band (white on green/red, dark on the
// light amber). Literal strings so Tailwind's content scan keeps them.
export const BAND_CLASSES: Record<Band, string> = {
  green: 'bg-emerald-600 text-white',
  yellow: 'bg-amber-400 text-slate-900',
  red: 'bg-rose-600 text-white',
};

export interface GuidingMetric {
  labelKey: string;    // i18n key for the badge label
  tooltipKey: string;  // i18n key for the badge tooltip
  compute(rmsRa: number, rmsDec: number): number | null;  // null = N/A
  band(value: number): Band;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// Aspect Ratio = Max/Min of the two RMS values. 1.00 = round, higher = elongated.
export const aspectRatioMetric: GuidingMetric = {
  labelKey: 'guide.aspectRatio',
  tooltipKey: 'aspectRatioTooltip',
  compute(rmsRa, rmsDec) {
    const lo = Math.min(rmsRa, rmsDec);
    const hi = Math.max(rmsRa, rmsDec);
    return lo > 0 ? hi / lo : null;
  },
  band(value) {
    const r = round2(value);
    if (r <= 1.2) return 'green';
    if (r <= 1.6) return 'yellow';
    return 'red';
  },
};

// Eccentricity = sqrt(1 - min^2/max^2). 0 = round, ->1 = elongated. Dormant;
// flip `guidingMetric` below to re-enable.
export const eccentricityMetric: GuidingMetric = {
  labelKey: 'guide.eccentricity',
  tooltipKey: 'eccentricityTooltip',
  compute(rmsRa, rmsDec) {
    const lo = Math.min(rmsRa, rmsDec);
    const hi = Math.max(rmsRa, rmsDec);
    return hi > 0 ? Math.sqrt(1 - (lo * lo) / (hi * hi)) : null;
  },
  band(value) {
    const r = round2(value);
    if (r <= 0.5) return 'green';
    if (r <= 0.65) return 'yellow';
    return 'red';
  },
};

// Source-code switch: change to `eccentricityMetric` to restore the old metric.
export const guidingMetric: GuidingMetric = aspectRatioMetric;
