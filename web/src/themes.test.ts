import { describe, it, expect } from 'vitest';
import { raDecColors, RA_DEC_BLUE, RA_DEC_RED } from './themes';

describe('raDecColors', () => {
  it('returns RA blue / Dec red by default', () => {
    expect(raDecColors(false)).toEqual({ ra: RA_DEC_BLUE, dec: RA_DEC_RED });
  });
  it('swaps to RA red / Dec blue', () => {
    expect(raDecColors(true)).toEqual({ ra: RA_DEC_RED, dec: RA_DEC_BLUE });
  });
});
