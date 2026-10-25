import { describe, it, expect } from 'vitest';
import { defaultMasks, sessionRmsList } from '../sectionRms';
import { calcRms } from '../../parser/stats';
import { newGuideSession, type GuideSession, type InfoEntry } from '../../parser/types';

/** n frames whose RA alternates ±1 px, except a big ±10 px swing inside the
 *  settling window [4,7) so excluding it visibly lowers the RMS. */
function settlingSession(n = 12): GuideSession {
  const s = newGuideSession('2026-10-25');
  s.entries = Array.from({ length: n }, (_, i) => {
    const amp = i >= 4 && i < 7 ? 10 : 1;
    const ra = i % 2 === 0 ? amp : -amp;
    return {
      frame: i + 1, dt: i, mount: 'MOUNT' as const, included: true, guiding: true,
      dx: ra, dy: 0, raraw: ra, decraw: 0, raguide: ra, decguide: 0,
      radur: 0, decdur: 0, mass: 0, snr: 0, err: 0, info: '',
    };
  });
  s.infos = ([[4, 'Settling started'], [7, 'Settling complete']] as const)
    .map(([idx, info]): InfoEntry => ({ idx, repeats: 1, info }));
  return s;
}

describe('sessionRmsList', () => {
  it('an unviewed section uses the default settling mask it will get on first view', () => {
    const s = settlingSession();
    const defaults = defaultMasks([s]);
    const [r] = sessionRmsList([s], new Map(), defaults);
    expect(r.viewed).toBe(false);
    expect(r.edited).toBe(false);
    expect(r.excludedCount).toBe(3); // the settling window
    expect(r.rmsTotal).toBeCloseTo(calcRms(s, defaults[0]).rmsTotal);
    expect(r.rmsTotal).toBeLessThan(calcRms(s).rmsTotal);
  });

  it('a viewed section uses its live mask, and is not "edited" while it equals the default', () => {
    const s = settlingSession();
    const defaults = defaultMasks([s]);
    const [r] = sessionRmsList([s], new Map([[0, new Uint8Array(defaults[0])]]), defaults);
    expect(r.viewed).toBe(true);
    expect(r.edited).toBe(false);
  });

  it('a live mask that differs from the default drives the RMS and flags "edited"', () => {
    const s = settlingSession();
    const defaults = defaultMasks([s]);
    const includeAll = new Uint8Array(s.entries.length); // re-include the settling swing
    const [r] = sessionRmsList([s], new Map([[0, includeAll]]), defaults);
    expect(r.edited).toBe(true);
    expect(r.excludedCount).toBe(0);
    expect(r.rmsTotal).toBeCloseTo(calcRms(s).rmsTotal);
  });

  it('ignores a stale wrong-length mask left by another log', () => {
    const s = settlingSession();
    const defaults = defaultMasks([s]);
    const [r] = sessionRmsList([s], new Map([[0, new Uint8Array(3)]]), defaults);
    expect(r.viewed).toBe(false);
    expect(r.excludedCount).toBe(3);
  });
});
