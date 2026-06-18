import { describe, it, expect } from 'vitest';
import { computeGlobalPolarAlignment } from '../globalPolarAlignment';
import { PAE_CONSTANT } from '../polarAlignment';
import { newGuideLog, newGuideSession, type GuideLog, type GuideEntry } from '../types';

// Build a guiding session whose Dec drift yields a chosen signed effective error
// `e` at hour angle `haHours`, declination 0, pixelScale 1, with `n` frames.
function sectionFor(e: number, haHours: number, n = 60, pier = 'West'): ReturnType<typeof newGuideSession> {
  const s = newGuideSession('x');
  s.pixelScale = 1; s.declination = 0; s.hourAngleHours = haHours; s.pierSide = pier;
  // e = 3.8197 * driftDecPxMin (dec=0, ps=1). driftDec px/min over the frames:
  // make decraw a clean linear ramp so the cumulative-Dec slope = driftDec.
  const driftPxMin = e / PAE_CONSTANT;            // px/min
  const driftPxSec = driftPxMin / 60;
  const dtStep = 1;                                // 1s frames → mean dt ~ (n-1)/2 s (tiny HA shift)
  const rows: GuideEntry[] = [];
  for (let k = 0; k < n; k++) {
    rows.push({
      frame: k + 1, dt: k * dtStep, mount: 'MOUNT', included: true, guiding: true,
      dx: 0, dy: 0, raraw: 0, decraw: k * dtStep * driftPxSec, raguide: 0, decguide: 0,
      radur: 0, decdur: 0, mass: 0, snr: 0, err: 0, info: '',
    });
  }
  s.entries = rows;
  return s;
}

function logOf(sessions: ReturnType<typeof newGuideSession>[]): GuideLog {
  const log = newGuideLog();
  sessions.forEach((s) => { log.sessions.push(s); log.sections.push({ type: 'GUIDING', idx: log.sessions.length - 1 }); });
  return log;
}

describe('computeGlobalPolarAlignment', () => {
  it('recovers Alt & Az from sections at different hour angles', () => {
    // True A (az) = 1.5', E (alt) = 2.0'. e_i = A cos H + E sin H.
    const A = 1.5, E = 2.0;
    const has = [-6, -4, -2, 0, 2]; // hours, wide spread
    const sessions = has.map((h) => {
      const Hr = (h * 15 * Math.PI) / 180;
      const e = A * Math.cos(Hr) + E * Math.sin(Hr);
      return sectionFor(e, h);
    });
    const g = computeGlobalPolarAlignment(logOf(sessions));
    expect(g.azArcMin).toBeCloseTo(1.5, 1);
    expect(g.altArcMin).toBeCloseTo(2.0, 1);
    expect(g.totalArcMin).toBeCloseTo(Math.hypot(1.5, 2.0), 1);
    expect(g.confidence).toBe('high');
    expect(g.sectionCount).toBe(5);
  });

  it('pier-side flip is normalized (flipped section does not break the solve)', () => {
    const A = 1.0, E = 1.5;
    const has = [-5, -1, 3];
    const sessions = has.map((h, i) => {
      const Hr = (h * 15 * Math.PI) / 180;
      let e = A * Math.cos(Hr) + E * Math.sin(Hr);
      const pier = i === 2 ? 'East' : 'West';
      if (pier === 'East') e = -e;     // the log would record the flipped sign
      return sectionFor(e, h, 60, pier);
    });
    const g = computeGlobalPolarAlignment(logOf(sessions));
    expect(g.azArcMin).toBeCloseTo(1.0, 1);
    expect(g.altArcMin).toBeCloseTo(1.5, 1);
  });

  it('reports insufficient when sections share one hour angle', () => {
    const sessions = [sectionFor(1, -6), sectionFor(1.1, -6), sectionFor(0.9, -6)];
    const g = computeGlobalPolarAlignment(logOf(sessions));
    expect(g.confidence).toBe('insufficient');
  });

  it('skips sections with too few frames', () => {
    const sessions = [sectionFor(2, -6, 60), sectionFor(2, 0, 10)]; // 2nd has 10 < MIN_GLOBAL_FRAMES
    const g = computeGlobalPolarAlignment(logOf(sessions));
    expect(g.sectionCount).toBe(1);
    expect(g.confidence).toBe('insufficient');
  });
});
