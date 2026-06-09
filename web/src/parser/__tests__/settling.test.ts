import { describe, it, expect } from 'vitest';
import { computeSettlingMask } from '../settling';
import { newGuideSession, type GuideSession, type InfoEntry } from '../types';

/**
 * Build a minimal GuideSession with `n` placeholder entries and the supplied
 * info markers. computeSettlingMask only reads `entries.length` and `infos`.
 */
function sessionWith(n: number, infos: Array<[number, string]>): GuideSession {
  const s = newGuideSession('2026-06-09');
  s.entries = Array.from({ length: n }, (_, i) => ({
    frame: i + 1,
    dt: i,
    mount: 'MOUNT' as const,
    included: true,
    guiding: true,
    dx: 0, dy: 0, raraw: 0, decraw: 0, raguide: 0, decguide: 0,
    radur: 0, decdur: 0, mass: 0, snr: 0, err: 0, info: '',
  }));
  s.infos = infos.map(([idx, info]): InfoEntry => ({ idx, repeats: 1, info }));
  return s;
}

const masked = (m: Uint8Array): number[] =>
  [...m].flatMap((v, i) => (v ? [i] : []));

describe('computeSettlingMask', () => {
  it('excludes the frames inside a normal settling window', () => {
    // Settling started @100, complete @110 -> exclude [100,110)
    const s = sessionWith(200, [
      [100, 'Settling started'],
      [110, 'Settling complete'],
    ]);
    const m = computeSettlingMask(s);
    expect(masked(m)).toEqual([100, 101, 102, 103, 104, 105, 106, 107, 108, 109]);
  });

  it('closes the settling window at a FAILED settle, not the next completion', () => {
    // A dither's settle fails @105, then a later dither settles normally
    // @200..210. Only [100,105) and [200,210) should be excluded — the good
    // guiding frames between the failure and the next dither (105..200) must
    // stay selected. Before the fix the mask leaked from 100 all the way to
    // the next "Settling complete" @210.
    const s = sessionWith(300, [
      [100, 'Settling started'],
      [105, 'Settling failed'],
      [200, 'Settling started'],
      [210, 'Settling complete'],
    ]);
    const m = computeSettlingMask(s);
    const out = masked(m);
    // failure window [100,105)
    expect(out).toContain(100);
    expect(out).toContain(104);
    // frames after the failure and before the next dither must NOT be excluded
    expect(out).not.toContain(105);
    expect(out).not.toContain(150);
    expect(out).not.toContain(199);
    // second (successful) settle window [200,210)
    expect(out).toContain(200);
    expect(out).toContain(209);
    expect(out).not.toContain(210);
  });
});
