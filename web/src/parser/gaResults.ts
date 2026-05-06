import type { GuideSession, InfoEntry } from './types';

/**
 * One Guiding Assistant run extracted from a session's `infos`.
 *
 * PHD2 brackets each GA invocation with a pair of info events:
 *   "INFO: Guiding parameter change, MountGuidingEnabled = false"  (start)
 *   "INFO: Guiding parameter change, MountGuidingEnabled = true"   (end)
 *
 * Between them the assistant emits info events prefixed with
 * "GA Result - ". Within those, lines starting with "Recommendation: "
 * are user-facing suggestions (these are what the user usually wants
 * to read at a glance); the remaining "GA Result - ..." lines are the
 * raw measurement summary (SNR, RA/Dec peaks, drift rates, backlash
 * estimate, etc.) which we keep as `metrics` so they can be revealed
 * on demand.
 *
 * The desktop viewer doesn't have a dedicated UI for these — they
 * surface only as hover text on inline event labels, which requires
 * the user to mouse-target each label individually. This helper
 * extracts them once so the GAResultsPanel can render them as a
 * structured card per run.
 */
export interface GARecommendationRun {
  /** Entry index of the `MountGuidingEnabled = false` info event. */
  startIdx: number;
  /** Entry index of the matching `MountGuidingEnabled = true`, or null when guiding never resumed inside this session. */
  endIdx: number | null;
  /** dt (seconds since session start) at startIdx, undefined if the entry can't be resolved. */
  startTime: number | undefined;
  /** dt at endIdx, undefined if not yet resumed. */
  endTime: number | undefined;
  /** Recommendation lines, with the "GA Result - Recommendation: " prefix stripped. */
  recommendations: string[];
  /**
   * Non-recommendation `GA Result - ` lines (SNR/RMS/peak/drift/PA/backlash
   * summary). The "GA Result - " prefix is stripped; the rest is verbatim
   * so the reader sees the same raw text PHD2 wrote into the log.
   */
  metrics: string[];
}

const GA_PREFIX = 'GA Result - ';
const REC_PREFIX = 'Recommendation: ';
const ENABLED_FALSE = 'MountGuidingEnabled = false';
const ENABLED_TRUE = 'MountGuidingEnabled = true';

const startTime = (s: GuideSession, idx: number): number | undefined => {
  const e = s.entries[idx];
  return e ? e.dt : undefined;
};

const stripGaPrefix = (info: InfoEntry): string | null =>
  info.info.startsWith(GA_PREFIX) ? info.info.slice(GA_PREFIX.length) : null;

/**
 * Walk the session's info events in order, opening a run on each
 * `MountGuidingEnabled = false` and closing it on the next
 * `MountGuidingEnabled = true`. GA Result lines that fall inside the
 * open window get attached to that run. Empty runs (no GA Result
 * lines between the on/off pair, e.g. when the user toggled guiding
 * for some other reason) are filtered out.
 *
 * If guiding never resumes before the session ends, the trailing run
 * is still emitted with `endIdx = null` — the user might want to read
 * recommendations even when they cut the session short after the
 * assistant finished.
 */
export function extractGAResults(session: GuideSession): GARecommendationRun[] {
  const runs: GARecommendationRun[] = [];
  let current: GARecommendationRun | null = null;

  for (const info of session.infos) {
    if (info.info.includes(ENABLED_FALSE)) {
      // Defensive: if a previous run was still open and had any
      // content, push it before starting a new one. (Shouldn't happen
      // in well-formed logs but it's cheap to handle.)
      if (current && (current.recommendations.length > 0 || current.metrics.length > 0)) {
        runs.push(current);
      }
      current = {
        startIdx: info.idx,
        endIdx: null,
        startTime: startTime(session, info.idx),
        endTime: undefined,
        recommendations: [],
        metrics: [],
      };
      continue;
    }
    if (info.info.includes(ENABLED_TRUE)) {
      if (current) {
        current.endIdx = info.idx;
        current.endTime = startTime(session, info.idx);
        if (current.recommendations.length > 0 || current.metrics.length > 0) {
          runs.push(current);
        }
        current = null;
      }
      continue;
    }
    if (!current) continue;
    const tail = stripGaPrefix(info);
    if (tail === null) continue;
    if (tail.startsWith(REC_PREFIX)) {
      current.recommendations.push(tail.slice(REC_PREFIX.length));
    } else {
      current.metrics.push(tail);
    }
  }

  // Trailing open run (guiding never resumed).
  if (current && (current.recommendations.length > 0 || current.metrics.length > 0)) {
    runs.push(current);
  }

  return runs;
}
