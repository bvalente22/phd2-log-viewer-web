import { describe, it, expect } from 'vitest';
import { raDecColors, RA_DEC_BLUE, RA_DEC_RED, THEMES } from './themes';

/** WCAG contrast ratio between two #rrggbb colors. */
const contrast = (a: string, b: string): number => {
  const lum = (hex: string) => {
    const [r, g, b2] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b2;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe('peakMarkers', () => {
  for (const theme of Object.values(THEMES)) {
    it(`${theme.id}: three distinct colors, each readable against the plot paper`, () => {
      const m = theme.plot.peakMarkers;
      expect(new Set(m).size).toBe(3);
      // PeakChip uses `paper` as its ink on the marker color, and the dotted
      // lines sit on `paper` — both rely on this.
      for (const c of m) expect(contrast(c, theme.plot.paper)).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe('raDecColors', () => {
  it('returns RA blue / Dec red by default', () => {
    expect(raDecColors(false)).toEqual({ ra: RA_DEC_BLUE, dec: RA_DEC_RED });
  });
  it('swaps to RA red / Dec blue', () => {
    expect(raDecColors(true)).toEqual({ ra: RA_DEC_RED, dec: RA_DEC_BLUE });
  });
});
