import { describe, it, expect, beforeEach } from 'vitest';
import { clampSidebarWidth, SIDEBAR_MIN, SIDEBAR_MAX, SIDEBAR_DEFAULT, useViewStore } from '../viewStore';
import { newGuideSession, type GuideSession, type InfoEntry } from '../../parser/types';

/** frames[i] === i so a frame number doubles as its entry index. */
const seqFrames = (n: number) => Array.from({ length: n }, (_, i) => i);

describe('exclusion masks survive a stale wrong-length entry', () => {
  beforeEach(() => {
    useViewStore.setState({ exclusions: new Map() });
  });

  // Regression: the exclusions Map is keyed by per-log sessionIdx (0,1,2…),
  // so loading a second log whose session 0 has a different entry count left
  // a stale, wrong-length mask under the same key. excludeRange did
  // `new Uint8Array(cur)` (inheriting the stale length) and wrote out of
  // bounds, silently dropping every bit — the "ctrl-drag does nothing until
  // you pick a context-menu option" bug (the menu items allocated a fresh
  // correct-length mask, which is why they "fixed" it).
  it('excludeRange rebuilds when the stored mask length != entryCount', () => {
    useViewStore.setState({ exclusions: new Map([[0, new Uint8Array(636)]]) });
    useViewStore.getState().excludeRange(0, 2373, 834, 1308, seqFrames(2373));
    const m = useViewStore.getState().exclusions.get(0)!;
    expect(m.length).toBe(2373);
    expect(m[833]).toBe(0);
    expect(m[834]).toBe(1);
    expect(m[1308]).toBe(1);
    expect(m[1309]).toBe(0);
  });

  it('includeRange rebuilds when the stored mask length != entryCount', () => {
    // A stale all-excluded mask of the wrong length; re-including a window
    // must first inflate to the correct length (extra frames default to
    // included) and then clear the requested range.
    const stale = new Uint8Array(636); stale.fill(1);
    useViewStore.setState({ exclusions: new Map([[0, stale]]) });
    useViewStore.getState().includeRange(0, 2373, 100, 200, seqFrames(2373));
    const m = useViewStore.getState().exclusions.get(0)!;
    expect(m.length).toBe(2373);
    expect(m[150]).toBe(0);
  });

  it('a correct-length stored mask is preserved and OR-merged', () => {
    const cur = new Uint8Array(2373); cur[10] = 1;
    useViewStore.setState({ exclusions: new Map([[0, cur]]) });
    useViewStore.getState().excludeRange(0, 2373, 834, 1308, seqFrames(2373));
    const m = useViewStore.getState().exclusions.get(0)!;
    expect(m[10]).toBe(1);   // pre-existing exclusion kept
    expect(m[834]).toBe(1);  // new range added
  });

  it('clearExclusions empties the map (called on new-log load)', () => {
    useViewStore.setState({ exclusions: new Map([[0, new Uint8Array(636)]]) });
    useViewStore.getState().clearExclusions();
    expect(useViewStore.getState().exclusions.size).toBe(0);
  });
});

describe('clampSidebarWidth', () => {
  it('passes through an in-range value', () => {
    expect(clampSidebarWidth(300)).toBe(300);
  });
  it('clamps below the minimum', () => {
    expect(clampSidebarWidth(50)).toBe(SIDEBAR_MIN);
  });
  it('clamps above the maximum', () => {
    expect(clampSidebarWidth(9999)).toBe(SIDEBAR_MAX);
  });
  it('exposes a default within bounds', () => {
    expect(SIDEBAR_DEFAULT).toBeGreaterThanOrEqual(SIDEBAR_MIN);
    expect(SIDEBAR_DEFAULT).toBeLessThanOrEqual(SIDEBAR_MAX);
  });
});

function sessionWith(n: number, infos: Array<[number, string]>): GuideSession {
  const s = newGuideSession('2026-06-09');
  s.entries = Array.from({ length: n }, (_, i) => ({
    frame: i + 1, dt: i, mount: 'MOUNT' as const, included: true, guiding: true,
    dx: 0, dy: 0, raraw: 0, decraw: 0, raguide: 0, decguide: 0,
    radur: 0, decdur: 0, mass: 0, snr: 0, err: 0, info: '',
  }));
  s.infos = infos.map(([idx, info]): InfoEntry => ({ idx, repeats: 1, info }));
  return s;
}

describe('applySettlingPolicy', () => {
  beforeEach(() => useViewStore.getState().clearExclusions());

  it('desktop = API only; web adds post-dither; manual excludes survive switches', () => {
    // DITHER @50 -> [50,55); settling window [50,53).
    const s = sessionWith(100, [
      [50, 'DITHER 1.0, 1.0'], [50, 'Settling started'], [53, 'Settling complete'],
    ]);
    const st = () => useViewStore.getState();

    st().applySettlingPolicy(0, s, 'desktop');
    let m = st().exclusions.get(0)!;
    expect(m[52]).toBe(1);            // settling window excluded
    expect(m[54]).toBe(0);            // post-dither NOT excluded (desktop)
    expect(st().settlingPolicy.get(0)).toBe('desktop');

    // user hand-excludes frame 10
    const withManual = new Uint8Array(m); withManual[10] = 1;
    st().setMask(0, withManual);

    st().applySettlingPolicy(0, s, 'web');
    m = st().exclusions.get(0)!;
    expect(m[54]).toBe(1);            // post-dither now excluded (web)
    expect(m[10]).toBe(1);            // manual exclude survived
    expect(st().settlingPolicy.get(0)).toBe('web');

    st().applySettlingPolicy(0, s, 'desktop');
    m = st().exclusions.get(0)!;
    expect(m[54]).toBe(0);            // post-dither dropped again
    expect(m[52]).toBe(1);            // settling window still excluded
    expect(m[10]).toBe(1);            // manual exclude still there
  });

  it('includeAll / excludeAll clear the section settling policy', () => {
    const s = sessionWith(10, []);
    const st = () => useViewStore.getState();
    st().applySettlingPolicy(0, s, 'web');
    expect(st().settlingPolicy.get(0)).toBe('web');
    st().includeAll(0, 10);
    expect(st().settlingPolicy.get(0)).toBeUndefined();
    st().applySettlingPolicy(0, s, 'desktop');
    expect(st().settlingPolicy.get(0)).toBe('desktop');
    st().excludeAll(0, 10);
    expect(st().settlingPolicy.get(0)).toBeUndefined();
  });
});
