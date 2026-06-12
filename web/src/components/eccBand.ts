// Pure presentation classifier for the StatsGrid eccentricity badge.
// Thresholds are evaluated on the value ROUNDED to 2 decimals — the same
// number the user sees — so a displayed 0.50 is green and 0.66 is red.

export type EccBand = 'green' | 'yellow' | 'red';

export function eccBand(e: number): EccBand {
  const r = Math.round(e * 100) / 100;
  if (r <= 0.5) return 'green';
  if (r <= 0.65) return 'yellow';
  return 'red';
}

// Tailwind background + readable text per band (white on green/red, dark on
// the light amber). Literal strings so Tailwind's content scan keeps them.
export const ECC_BAND_CLASSES: Record<EccBand, string> = {
  green: 'bg-emerald-600 text-white',
  yellow: 'bg-amber-400 text-slate-900',
  red: 'bg-rose-600 text-white',
};
