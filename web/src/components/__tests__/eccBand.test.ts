import { describe, it, expect } from 'vitest';
import { eccBand } from '../eccBand';

describe('eccBand', () => {
  it('green at or below 0.50', () => {
    expect(eccBand(0)).toBe('green');
    expect(eccBand(0.50)).toBe('green');
    expect(eccBand(0.499)).toBe('green'); // rounds to 0.50
  });
  it('yellow from 0.51 to 0.65', () => {
    expect(eccBand(0.51)).toBe('yellow');
    expect(eccBand(0.65)).toBe('yellow');
  });
  it('red at 0.66 and above', () => {
    expect(eccBand(0.66)).toBe('red');
    expect(eccBand(0.80)).toBe('red');
    expect(eccBand(1)).toBe('red');
  });
  it('thresholds use the value rounded to 2 decimals', () => {
    expect(eccBand(0.654)).toBe('yellow'); // -> 0.65
    expect(eccBand(0.655)).toBe('red');     // -> 0.66
  });
});
