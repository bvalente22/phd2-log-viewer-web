import { describe, it, expect } from 'vitest';
import { canAnalyze, findUnguidedWindow } from '../analyze';
import { newGuideSession } from '../types';
import type { GuideEntry } from '../types';

const mkE = (frame: number, dt: number, included = true, guiding = true): GuideEntry => ({
  frame, dt, mount: 'MOUNT', included, guiding,
  dx: 0, dy: 0, raraw: 0, decraw: 0, raguide: 0, decguide: 0,
  radur: 0, decdur: 0, mass: 0, snr: 20, err: 0, info: '',
});

describe('canAnalyze', () => {
  it('returns false for a session with fewer than 12 valid entries', () => {
    const s = newGuideSession('x');
    s.entries = Array.from({ length: 10 }, (_, i) => mkE(i + 1, i + 1));
    expect(canAnalyze(s, { range: { begin: 0, end: 10 }, undoRaCorrections: false })).toBe(false);
  });

  it('returns true once 12 entries pass the filter', () => {
    const s = newGuideSession('x');
    s.entries = Array.from({ length: 12 }, (_, i) => mkE(i + 1, i + 1));
    expect(canAnalyze(s, { range: { begin: 0, end: 12 }, undoRaCorrections: false })).toBe(true);
  });

  it('honors the user mask when counting', () => {
    const s = newGuideSession('x');
    s.entries = Array.from({ length: 13 }, (_, i) => mkE(i + 1, i + 1));
    const mask = new Uint8Array(13);
    mask[0] = 1;
    mask[1] = 1;
    expect(canAnalyze(s, { range: { begin: 0, end: 13 }, undoRaCorrections: false, mask })).toBe(false);
  });

  it('skips entries that the parser flagged as not-included', () => {
    const s = newGuideSession('x');
    s.entries = Array.from({ length: 13 }, (_, i) => mkE(i + 1, i + 1, i > 0));
    expect(canAnalyze(s, { range: { begin: 0, end: 13 }, undoRaCorrections: false })).toBe(true);
    s.entries[5].included = false;
    s.entries[6].included = false;
    expect(canAnalyze(s, { range: { begin: 0, end: 13 }, undoRaCorrections: false })).toBe(false);
  });
});

describe('findUnguidedWindow', () => {
  it('returns null when every entry was guided', () => {
    const s = newGuideSession('x');
    s.entries = Array.from({ length: 5 }, (_, i) => mkE(i + 1, i + 1, true, true));
    expect(findUnguidedWindow(s)).toBeNull();
  });

  it('finds the first contiguous unguided run', () => {
    const s = newGuideSession('x');
    s.entries = [
      mkE(1, 1, true, true),
      mkE(2, 2, true, false),
      mkE(3, 3, true, false),
      mkE(4, 4, true, false),
      mkE(5, 5, true, true),
      mkE(6, 6, true, false),
    ];
    expect(findUnguidedWindow(s)).toEqual({ begin: 1, end: 3 });
  });

  it('finds the run starting at index 0 when the session opens unguided', () => {
    const s = newGuideSession('x');
    s.entries = [
      mkE(1, 1, true, false),
      mkE(2, 2, true, false),
      mkE(3, 3, true, true),
    ];
    expect(findUnguidedWindow(s)).toEqual({ begin: 0, end: 1 });
  });
});
