import { describe, it, expect } from 'vitest';
import { parseDebugTimes, findClosestTimeIndex } from '../debugTimestamps';

const DAY = 86_400_000;
const A = Date.UTC(2025, 11, 14); // midnight of the session's wall-clock date
const ms = (h: number, m: number, s: number, mmm = 0) =>
  A + ((h * 60 + m) * 60 + s) * 1000 + mmm;

describe('parseDebugTimes', () => {
  it('parses the leading HH:MM:SS.mmm of each line to a wall-clock absolute ms', () => {
    const out = parseDebugTimes(
      [
        '20:30:12.319 00.052 14012 PHD2 version 2.6.14 continues execution with:',
        '20:30:13.500 00.001 14012 something',
      ],
      A,
    );
    expect(out[0]).toBe(ms(20, 30, 12, 319));
    expect(out[1]).toBe(ms(20, 30, 13, 500));
  });

  it('lets a line with no leading timestamp inherit the previous time', () => {
    const out = parseDebugTimes(
      ['20:30:12.000 a', '    wrapped continuation line', '20:30:14.000 b'],
      A,
    );
    expect(out[1]).toBe(ms(20, 30, 12, 0)); // inherited
    expect(out[2]).toBe(ms(20, 30, 14, 0));
  });

  it('handles midnight rollover (chronological lines that cross 00:00)', () => {
    const out = parseDebugTimes(['23:59:59.000 a', '00:00:01.000 b'], A);
    expect(out[0]).toBe(ms(23, 59, 59, 0));
    expect(out[1]).toBe(A + DAY + 1000); // next day, 00:00:01
  });

  it('assigns the day anchor to lines before the first timestamp', () => {
    const out = parseDebugTimes(['header with no time', '20:30:00.000 a'], A);
    expect(out[0]).toBe(A);
    expect(out[1]).toBe(ms(20, 30, 0, 0));
  });
});

describe('findClosestTimeIndex', () => {
  const times = Float64Array.from([10, 20, 30]);
  it('returns the nearest index, rounding to the closer neighbour', () => {
    expect(findClosestTimeIndex(times, 22)).toBe(1);
    expect(findClosestTimeIndex(times, 26)).toBe(2);
    expect(findClosestTimeIndex(times, 25)).toBe(1); // tie -> lower
  });
  it('clamps before-first and after-last', () => {
    expect(findClosestTimeIndex(times, 5)).toBe(0);
    expect(findClosestTimeIndex(times, 100)).toBe(2);
  });
  it('returns 0 for an empty array', () => {
    expect(findClosestTimeIndex(Float64Array.from([]), 5)).toBe(0);
  });
});
