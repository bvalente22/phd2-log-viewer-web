/**
 * Theme system. Five themes: `default` (slate dark), `paper` (white +
 * dark text), `high-contrast` (pure black + pure white + bright lines),
 * `night` (dim crimson surfaces, low blue-light for dark-adapted
 * astrophotographers using the viewer at the eyepiece), and `monochrome`
 * (pure white chrome + pure black UI; only the plot traces carry color).
 * Each theme exposes:
 *   - id           the value persisted in viewStore.theme
 *   - dataAttr     the `data-theme="..."` value placed on <html>; the
 *                  matching CSS in index.css overrides Tailwind's
 *                  hardcoded slate-* surface classes for non-default
 *                  themes (specificity: `[data-theme=...] .bg-slate-X`
 *                  beats `.bg-slate-X` without !important).
 *   - plot         Plotly layout overrides (paper_bgcolor, plot_bgcolor,
 *                  gridcolor, zerolinecolor, font color). Trace colors
 *                  themselves (RA blue, Dec red, Mass yellow, SNR white)
 *                  stay constant across themes — they encode meaning.
 *
 * Adding a new theme: append an entry, add a matching `[data-theme=...]`
 * block in index.css, add the i18n label key, done.
 */

export type ThemeId = 'default' | 'paper' | 'high-contrast' | 'night' | 'monochrome';

export interface PlotThemeColors {
  paper: string;
  plot: string;
  font: string;
  grid: string;
  zeroline: string;
  /** Color of the bold "0" zero-line through the y-axis. */
  zerolineStrong: string;
  /** Inline-event annotation pill background (Settling/DITHER labels). */
  annotationBg: string;
  /** Inline-event annotation text color. */
  annotationFg: string;
  /**
   * Mass and SNR trace colors are theme-aware — yellow and near-white
   * are dark-bg-coded and disappear on the Paper-white plot. RA blue
   * and Dec red are saturated enough to stay constant across themes.
   */
  traceMass: string;
  traceSnr: string;
  /**
   * Analysis-periodogram trace colors — amber (residual error / unguided) and
   * teal (raw RA). Theme-aware: bright on the dark backgrounds, deepened on
   * the white (paper/monochrome) backgrounds where the bright variants wash
   * out. Blue/red are deliberately avoided (reserved for RA/Dec elsewhere).
   * Spike mode keeps its own amber accent in PeriodogramChart.
   */
  fftResidual: string;
  fftRawRa: string;
  /**
   * Vertical-cursor "spike" color used by every line chart on hover.
   * Picked to contrast with both the chart background and the saturated
   * trace colors (RA blue / Dec red). Bright yellow on dark backgrounds,
   * near-black on white, cyan on pure black, pale red on the night-mode
   * crimson surfaces so dark adaptation is preserved.
   */
  hoverSpike: string;
}

export interface Theme {
  id: ThemeId;
  /** i18n key under common.themes (e.g. 'default' → common:themes.default). */
  i18nKey: string;
  /** Value placed on <html data-theme="..."> at runtime. */
  dataAttr: ThemeId;
  plot: PlotThemeColors;
}

export const THEMES: Record<ThemeId, Theme> = {
  // The original dark slate look — kept untouched so no migration is
  // needed for existing users. CSS in index.css applies no overrides
  // when this theme is active; Tailwind's slate-* classes win as-is.
  default: {
    id: 'default',
    i18nKey: 'default',
    dataAttr: 'default',
    plot: {
      paper: '#0f172a',
      plot: '#0f172a',
      font: '#cbd5e1',
      fftResidual: '#fbbf24',
      fftRawRa: '#2dd4bf',
      grid: '#1e293b',
      zeroline: '#334155',
      zerolineStrong: '#64748b',
      annotationBg: 'rgba(15,23,42,0.85)',
      annotationFg: 'rgb(226,232,240)',
      traceMass: '#facc15',
      traceSnr: '#e2e8f0',
      hoverSpike: '#facc15',
    },
  },
  // White background, dark text — for daylight use or printing. Plot
  // bg matches the page bg so the chart blends in cleanly.
  paper: {
    id: 'paper',
    i18nKey: 'paper',
    dataAttr: 'paper',
    plot: {
      paper: '#ffffff',
      plot: '#ffffff',
      font: '#1e293b',
      fftResidual: '#d97706',
      fftRawRa: '#0d9488',
      grid: '#e2e8f0',
      zeroline: '#cbd5e1',
      zerolineStrong: '#94a3b8',
      annotationBg: 'rgba(255,255,255,0.92)',
      annotationFg: '#1e293b',
      // On white: deep amber-orange replaces bright yellow; dark slate
      // replaces near-white. Both still read as "Mass" (warm) and "SNR"
      // (neutral) but with enough contrast against the page.
      traceMass: '#b45309',
      traceSnr: '#475569',
      hoverSpike: '#0f172a',
    },
  },
  // Pure-black + pure-white + high-saturation gridlines for users with
  // low vision or in glare-heavy conditions.
  'high-contrast': {
    id: 'high-contrast',
    i18nKey: 'highContrast',
    dataAttr: 'high-contrast',
    plot: {
      paper: '#000000',
      plot: '#000000',
      font: '#ffffff',
      fftResidual: '#fbbf24',
      fftRawRa: '#2dd4bf',
      grid: '#404040',
      zeroline: '#808080',
      zerolineStrong: '#d0d0d0',
      annotationBg: 'rgba(0,0,0,0.92)',
      annotationFg: '#ffffff',
      traceMass: '#facc15',
      traceSnr: '#ffffff',
      hoverSpike: '#00ffff',
    },
  },
  // Pure white page with all UI elements rendered in pure black —
  // labels, borders, buttons, icons, plot axis lines, gridlines, axis
  // titles. The chart itself stays in color so RA/Dec/Mass/SNR still
  // encode meaning by hue. Mass and SNR fall back to the Paper palette
  // for the same legibility reason (yellow and near-white vanish on
  // white). Designed to read like a print figure: ink on paper, with
  // colored data on top.
  monochrome: {
    id: 'monochrome',
    i18nKey: 'monochrome',
    dataAttr: 'monochrome',
    plot: {
      paper: '#ffffff',
      plot: '#ffffff',
      font: '#000000',
      fftResidual: '#d97706',
      fftRawRa: '#0d9488',
      // Grid kept light so it reads as figure infrastructure, not noise
      // — pure-black gridlines on white would visually compete with the
      // colored traces. Axis labels, borders, and the zero-reference
      // line itself are pure black to keep the print aesthetic.
      grid: '#d4d4d4',
      zeroline: '#737373',
      zerolineStrong: '#000000',
      annotationBg: 'rgba(255,255,255,0.95)',
      annotationFg: '#000000',
      // Same swap as the Paper theme: deep amber-orange Mass and dark
      // slate SNR, since both are illegible on white at their dark-bg
      // defaults but still read as "warm" and "neutral".
      traceMass: '#b45309',
      traceSnr: '#475569',
      hoverSpike: '#0f172a',
    },
  },
  // Astronomer night mode: very dark crimson surfaces and dim red text
  // to preserve dark adaptation at the eyepiece. Trace colors aren't
  // monochromatic because RA/Dec/Mass/SNR carry meaning by hue, but the
  // page chrome and plot background are red-shifted.
  night: {
    id: 'night',
    i18nKey: 'night',
    dataAttr: 'night',
    plot: {
      paper: '#1a0606',
      plot: '#1a0606',
      font: '#ff8080',
      fftResidual: '#fbbf24',
      fftRawRa: '#2dd4bf',
      grid: '#3a1010',
      zeroline: '#5a1818',
      zerolineStrong: '#a04040',
      annotationBg: 'rgba(26,6,6,0.92)',
      annotationFg: '#ff8080',
      traceMass: '#facc15',
      traceSnr: '#e2e8f0',
      hoverSpike: '#ffd0d0',
    },
  },
};

export const DEFAULT_THEME: ThemeId = 'default';

/** Cheap accessor used by chart components that already select theme from viewStore. */
export const themeOf = (id: ThemeId): Theme => THEMES[id] ?? THEMES.default;

/**
 * Canonical RA / Dec trace hues. RA is sky-blue and Dec is rose by default; the
 * global `swapRaDec` view preference exchanges them everywhere EXCEPT the
 * periodogram (which uses the fft* colors). Hues are intentionally constant
 * across visual themes — they encode axis identity, not surface styling.
 */
export const RA_DEC_BLUE = '#60a5fa';
export const RA_DEC_RED = '#f87171';
export const raDecColors = (swap: boolean): { ra: string; dec: string } =>
  swap ? { ra: RA_DEC_RED, dec: RA_DEC_BLUE } : { ra: RA_DEC_BLUE, dec: RA_DEC_RED };
