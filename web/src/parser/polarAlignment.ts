import type { GuideSession } from './types';
import { starWasFound } from './tokens';

export const PAE_CONSTANT = 3.8197;
// Below this sensitivity (|cos HA| for Az, |sin HA| for Alt) the axis is
// essentially unobservable from this section's Dec drift — flagged low-confidence.
export const TRUST_THRESHOLD = 0.30;

export interface PolarAlignment {
  driftRaPxMin: number;
  driftDecPxMin: number;
  paeTotalArcMin: number;
  altArcMin: number | null;
  azArcMin: number | null;
  altTrust: boolean;
  azTrust: boolean;
  hourAngleHours: number | null;
}

// Per-entry settling-exclusion flags from the parsed INFO events. Mirrors
// phdlogview ExcludeSettlingByAPI: exclude entries in [start, complete).
export function settlingMask(session: GuideSession): boolean[] {
  const out = new Array<boolean>(session.entries.length).fill(false);
  let settling = false;
  let startIdx = 0;
  for (const info of session.infos) {
    if (settling) {
      if (info.info.includes('Settling complete') || info.info.includes('Settling fail')) {
        settling = false;
        for (let i = startIdx; i < info.idx && i < out.length; i++) out[i] = true;
      }
    } else if (info.info.includes('Settling start')) {
      settling = true;
      startIdx = info.idx;
    }
  }
  if (settling) for (let i = startIdx; i < out.length; i++) out[i] = true;
  return out;
}

const slope = (xs: number[], ys: number[]): number => {
  const n = xs.length;
  if (n < 2) return 0;
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; }
  mx /= n; my /= n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx; num += dx * (ys[i] - my); den += dx * dx; }
  return den === 0 ? 0 : num / den;
};

export function computePolarAlignment(session: GuideSession, mask?: Uint8Array): PolarAlignment {
  const entries = session.entries;
  const settle = settlingMask(session);
  const included = (i: number): boolean =>
    entries[i].included && starWasFound(entries[i].err) &&
    !(mask && mask[i] === 1) && !settle[i];

  let firstIdx = -1, lastIdx = -1;
  for (let i = 0; i < entries.length; i++) {
    if (included(i)) { if (firstIdx < 0) firstIdx = i; lastIdx = i; }
  }

  let driftRaPps = 0, driftDecPps = 0;
  if (firstIdx >= 0 && lastIdx > firstIdx) {
    // RA: (raraw_last − raraw_first − Σ RA corrections) / elapsed.
    let sum = 0;
    for (let i = firstIdx; i <= lastIdx; i++) {
      if (included(i) && entries[i].radur !== 0) sum += entries[i].raguide;
    }
    const dtSpan = entries[lastIdx].dt - entries[firstIdx].dt;
    if (dtSpan > 0) {
      driftRaPps = (entries[lastIdx].raraw - entries[firstIdx].raraw - sum) / dtSpan;
    }

    // Dec: slope of cumulative uncorrected Dec. Accumulate a delta only across
    // an *adjacent* pair (no excluded frame between them) where the previous
    // frame was un-pulsed (decdur === 0). Adjacency = skip-gaps rule.
    let yAccum = 0;
    let prevIdx = firstIdx;
    let prevDec = entries[firstIdx].decraw;
    let prevGuided = entries[firstIdx].decdur !== 0;
    const xs = [entries[firstIdx].dt];
    const ys = [0];
    for (let i = firstIdx + 1; i <= lastIdx; i++) {
      if (!included(i)) continue;
      if (!prevGuided && i === prevIdx + 1) {
        yAccum += entries[i].decraw - prevDec;
        xs.push(entries[i].dt);
        ys.push(yAccum);
      }
      prevDec = entries[i].decraw;
      prevGuided = entries[i].decdur !== 0;
      prevIdx = i;
    }
    driftDecPps = slope(xs, ys);
  }

  const driftRaPxMin = driftRaPps * 60;
  const driftDecPxMin = driftDecPps * 60;

  // PAE + decomposition are filled in Task 3; provide safe defaults for now.
  return {
    driftRaPxMin,
    driftDecPxMin,
    paeTotalArcMin: 0,
    altArcMin: null,
    azArcMin: null,
    altTrust: false,
    azTrust: false,
    hourAngleHours: session.hourAngleHours,
  };
}
