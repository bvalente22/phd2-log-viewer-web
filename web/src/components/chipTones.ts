// Per-toggle chip tone, loosely keyed to the trace color used on the chart so a
// toolbar reads at a glance, but deliberately MUTED relative to those trace
// colors. A solid chip concentrates color far more than a thin plotted line, so
// matching the vibrant trace saturation makes the toolbar too loud (the yellow
// Mass chip especially). The chart traces (themes.ts) stay vibrant — the
// divergence is intentional. See feedback_toolbar_chip_colors.md.
// Inactive state tints only the text (subtle hint); active fills the
// background. Disabled stays neutral. RA/Dec pulses share their axis tone so the
// matching pair lines up visually.
//
// Shared by the main GraphToolbar and the Analysis modal so the RA/Dec chips
// look identical in both places (and stay in sync if the palette changes).
export type ChipTone = 'default' | 'ra' | 'dec' | 'mass' | 'snr';

export const CHIP_TONE: Record<ChipTone, { active: string; inactive: string }> = {
  default: {
    active:   'bg-[#3f6b8f] text-white hover:bg-[#4a7ba3]',
    inactive: 'bg-slate-800 text-slate-400 hover:bg-slate-700',
  },
  ra: {
    active:   'bg-[#3f6b8f] text-white hover:bg-[#4a7ba3]',
    inactive: 'bg-slate-800 text-[#6fa3c4] hover:bg-slate-700',
  },
  dec: {
    active:   'bg-[#a85f5f] text-white hover:bg-[#b87070]',
    inactive: 'bg-slate-800 text-[#d09a9a] hover:bg-slate-700',
  },
  mass: {
    active:   'bg-[#ad924a] text-slate-900 hover:bg-[#c0a458]',
    inactive: 'bg-slate-800 text-[#c4ad6b] hover:bg-slate-700',
  },
  snr: {
    active:   'bg-[#d7dde5] text-slate-900 hover:bg-[#e6ebf1]',
    inactive: 'bg-slate-800 text-[#cbd5e1] hover:bg-slate-700',
  },
};

/**
 * When the global RA/Dec color swap is on, the `ra` and `dec` tones trade places
 * so chips track the (now swapped) trace colors (RA → red, Dec → blue). Other
 * tones are unaffected.
 */
export const swapTone = (tone: ChipTone, swap: boolean): ChipTone =>
  swap ? (tone === 'ra' ? 'dec' : tone === 'dec' ? 'ra' : tone) : tone;
