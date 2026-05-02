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
