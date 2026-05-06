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
 * Walk the session's info events in order, grouping every "GA Result"
 * line into a run. PHD2 logs come in two layouts depending on version
 * and configuration:
 *
 *   1) Older / typical layout — GA Result lines BETWEEN the
 *      MountGuidingEnabled markers:
 *        MountGuidingEnabled = false
 *        GA Result - SNR=...
 *        GA Result - Recommendation: ...
 *        MountGuidingEnabled = true
 *
 *   2) Newer layout — GA Result lines emitted AFTER
 *      `MountGuidingEnabled = true`:
 *        MountGuidingEnabled = false
 *        MountGuidingEnabled = true
 *        GA Result - SNR=...
 *        GA Result - Recommendation: ...
 *
 * Both forms are valid PHD2 output. We track the most recent
 * `MountGuidingEnabled = false` (`lastDisableIdx`) and the most recent
 * `MountGuidingEnabled = true` (`lastEnableIdx`) and snap them in as
 * the run's start / end when we see the first GA Result line.
 *
 * A new run is closed and pushed when we hit the next
 * `MountGuidingEnabled = false` (boundary between assistant runs)
 * or when we run out of infos. Empty runs (false/true toggle without
 * any GA Result lines, e.g. user toggling guiding for some unrelated
 * reason) are filtered out.
 */
export function extractGAResults(session: GuideSession): GARecommendationRun[] {
  const runs: GARecommendationRun[] = [];
  let current: GARecommendationRun | null = null;
  let lastDisableIdx: number | undefined = undefined;
  let lastEnableIdx: number | undefined = undefined;

  const closeIfFilled = () => {
    if (current && (current.recommendations.length > 0 || current.metrics.length > 0)) {
      runs.push(current);
    }
    current = null;
  };

  for (const info of session.infos) {
    if (info.info.includes(ENABLED_FALSE)) {
      // Boundary between assistant runs. Close any pending run and
      // reset the markers — anything that came before doesn't belong
      // to whatever run starts here.
      closeIfFilled();
      lastDisableIdx = info.idx;
      lastEnableIdx = undefined;
      continue;
    }
    if (info.info.includes(ENABLED_TRUE)) {
      lastEnableIdx = info.idx;
      // If a run was already opened by a preceding GA Result line
      // (layout 1), record the end now. If GA Results haven't started
      // yet (layout 2), the value is held and snapped in when the
      // first GA Result line creates the run.
      if (current) {
        current.endIdx = info.idx;
        current.endTime = startTime(session, info.idx);
      }
      continue;
    }

    const tail = stripGaPrefix(info);
    if (tail === null) continue;

    if (current === null) {
      const startIdx = lastDisableIdx ?? info.idx;
      current = {
        startIdx,
        endIdx: lastEnableIdx ?? null,
        startTime: startTime(session, startIdx),
        endTime: lastEnableIdx !== undefined ? startTime(session, lastEnableIdx) : undefined,
        recommendations: [],
        metrics: [],
      };
    }

    if (tail.startsWith(REC_PREFIX)) {
      current.recommendations.push(tail.slice(REC_PREFIX.length));
    } else {
      current.metrics.push(tail);
    }
  }

  closeIfFilled();

  return runs;
}
