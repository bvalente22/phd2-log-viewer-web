import { calcRms, type SessionRms } from '../parser/stats';
import type { GuideSession } from '../parser/types';
import { settlingMaskFor, DEFAULT_SETTLING_POLICY } from '../state/viewStore';

export interface SectionRms extends SessionRms {
  /** The section has been viewed, so it has a live mask in viewStore. */
  viewed: boolean;
  /** Its live mask differs from the default first-view settling exclusions. */
  edited: boolean;
}

/** The mask each guide session gets the first time it is viewed (GuideGraph). */
export const defaultMasks = (sessions: GuideSession[]): Uint8Array[] =>
  sessions.map((s) => settlingMaskFor(s, DEFAULT_SETTLING_POLICY));

const sameMask = (a: Uint8Array, b: Uint8Array) => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

/**
 * Total RMS for every guide session of a log, as the section list shows it.
 * A viewed section uses its live exclusion mask — the same one StatsGrid uses,
 * so the list and the stats footer always agree. An unviewed section uses the
 * mask it WILL get on first view (`defaults`), so its number doesn't jump when
 * it is opened. A wrong-length mask is stale (left by another log) and ignored,
 * matching viewStore's length guards.
 */
export function sessionRmsList(
  sessions: GuideSession[],
  exclusions: Map<number, Uint8Array>,
  defaults: Uint8Array[],
): SectionRms[] {
  return sessions.map((s, i) => {
    const cur = exclusions.get(i);
    const live = cur && cur.length === s.entries.length ? cur : undefined;
    return {
      ...calcRms(s, live ?? defaults[i]),
      viewed: live !== undefined,
      edited: live !== undefined && !sameMask(live, defaults[i]),
    };
  });
}
