import type { GuideSession } from './types';

const MIN_ENTRIES = 12; // matches AnalysisWin.cpp:273

export interface AnalyzeOptions {
  range: { begin: number; end: number };
  undoRaCorrections: boolean;
  mask?: Uint8Array;
}

const isUsable = (
  s: GuideSession,
  i: number,
  mask: Uint8Array | undefined,
): boolean => {
  const e = s.entries[i];
  // The parser already enforces `included = StarWasFound(err)`; mirror the
  // desktop's `Include` predicate (AnalysisWin.cpp:88) and add the user's
  // exclusion mask which our app keeps separate.
  if (!e.included) return false;
  return !mask || mask[i] !== 1;
};

export function canAnalyze(s: GuideSession, opts: AnalyzeOptions): boolean {
  const { range, mask } = opts;
  let n = 0;
  for (let i = range.begin; i < range.end && i < s.entries.length; i++) {
    if (isUsable(s, i, mask) && ++n >= MIN_ENTRIES) return true;
  }
  return false;
}

/**
 * The first contiguous run of `guiding === false` entries (Guiding Assistant).
 * Returns indices `[begin, end]` inclusive, or null if every entry was guided.
 */
export function findUnguidedWindow(s: GuideSession): { begin: number; end: number } | null {
  let begin = -1;
  for (let i = 0; i < s.entries.length; i++) {
    if (!s.entries[i].guiding) {
      if (begin < 0) begin = i;
    } else if (begin >= 0) {
      return { begin, end: i - 1 };
    }
  }
  if (begin >= 0) return { begin, end: s.entries.length - 1 };
  return null;
}

export interface DriftCorrected {
  /** Filtered timestamps (seconds) of every used entry, in order. */
  t: Float64Array;
  /** Drift-corrected RA position. */
  rac: Float64Array;
  /** Drift-corrected Dec. */
  decc: Float64Array;
  /** RA position drift slope (units per second). */
  driftRa: number;
  /** Dec drift slope (units per second). */
  driftDec: number;
}

interface LFit {
  n: number;
  sx: number; sy: number; sxx: number; sxy: number;
}
const newLFit = (): LFit => ({ n: 0, sx: 0, sy: 0, sxx: 0, sxy: 0 });
const lfitAdd = (f: LFit, x: number, y: number) => {
  f.n++; f.sx += x; f.sy += y; f.sxx += x * x; f.sxy += x * y;
};
const lfitLine = (f: LFit): { slope: number; intercept: number } => {
  if (f.n < 2) return { slope: 0, intercept: f.n === 1 ? f.sy : 0 };
  const denom = f.n * f.sxx - f.sx * f.sx;
  if (denom === 0) return { slope: 0, intercept: f.sy / f.n };
  const slope = (f.n * f.sxy - f.sx * f.sy) / denom;
  const intercept = (f.sy - slope * f.sx) / f.n;
  return { slope, intercept };
};

/**
 * Step 1-3 of `GARun::Analyze` (AnalysisWin.cpp:283-356):
 *   - Build accumulated RA position by integrating per-frame raw moves
 *     (optionally re-adding the RA correction to show what tracking would
 *     have looked like unguided).
 *   - Linear-fit (RA, Dec) vs. time.
 *   - Subtract the fit -> drift-corrected series.
 *
 * Honors the user-supplied exclusion mask in addition to the parser's
 * `entry.included` flag.
 */
export function computeDriftCorrected(s: GuideSession, opts: AnalyzeOptions): DriftCorrected {
  const { range, mask, undoRaCorrections } = opts;
  let n = 0;
  for (let i = range.begin; i < range.end && i < s.entries.length; i++) {
    if (isUsable(s, i, mask)) n++;
  }
  const t = new Float64Array(n);
  const ra = new Float64Array(n);
  const dec = new Float64Array(n);

  const fitR = newLFit();
  const fitD = newLFit();

  let rapos = 0;
  let prevRaguide = 0;
  let prevRaraw = 0;
  let k = 0;
  for (let i = range.begin; i < range.end && i < s.entries.length; i++) {
    if (!isUsable(s, i, mask)) continue;
    const e = s.entries[i];
    const raraw = e.raraw;
    const raguide = e.raguide;
    const move = raraw - prevRaraw - prevRaguide;
    rapos += move;
    prevRaraw = raraw;
    prevRaguide = undoRaCorrections ? raguide : 0;
    t[k] = e.dt;
    ra[k] = rapos;
    dec[k] = e.decraw;
    lfitAdd(fitR, e.dt, rapos);
    lfitAdd(fitD, e.dt, e.decraw);
    k++;
  }

  const lineR = lfitLine(fitR);
  const lineD = lfitLine(fitD);
  const rac = new Float64Array(n);
  const decc = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    rac[i] = ra[i] - (lineR.slope * t[i] + lineR.intercept);
    decc[i] = dec[i] - (lineD.slope * t[i] + lineD.intercept);
  }
  return { t, rac, decc, driftRa: lineR.slope, driftDec: lineD.slope };
}
