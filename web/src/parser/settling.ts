import type { GuideSession } from './index';

/**
 * Frames immediately following a DITHER event are typically still settling
 * even when the log has no explicit SETTLING state markers. Five frames is
 * the desktop's default for the "Exclude frames settling" menu item.
 */
const DITHER_SETTLE_FRAMES = 5;

/**
 * Build an exclusion mask covering frames during settling and post-dither
 * settle. Two paths:
 *   - If the log emits SETTLING STATE CHANGE events, exclude the entry range
 *     bounded by "Settling started" / "Settling complete" markers (matches
 *     the desktop's "Exclude frames settling" menu item).
 *   - As a fallback (older logs that only emit DITHER markers without
 *     settling state), also exclude the N entries immediately following any
 *     DITHER event.
 *
 * `info.info` carries the SETTLING text the parser strips the
 * `"SETTLING STATE CHANGE, "` prefix from (see `parseInfo.ts:14`), so the
 * literal payloads we match against here are the human-readable
 * `"Settling started"` / `"Settling complete"` strings PHD2 writes in
 * current logs. Older logs that emitted the underlying state-machine
 * payloads (`state=1` / `state=0`) are matched as a back-compat alias.
 *
 * A settle can also END by FAILING ("Settling failed") — PHD2 abandons the
 * settle and resumes normal guiding. The desktop's `ExcludeSettlingByAPI`
 * closes the window on either completion OR failure (`info.find("Settling
 * fail")`), so we treat "Settling failed" as a closing marker too. Without
 * it, `inSettle` would stay latched after a failure and leak the mask
 * forward to the *next* "Settling complete", wrongly excluding every good
 * guiding frame in between.
 *
 * The result is OR-merged with `base` when supplied, so callers can layer
 * this onto an existing user-edited mask.
 */
export const SETTLING_START = new Set(['Settling started', 'state=1']);
export const SETTLING_END = new Set(['Settling complete', 'Settling failed', 'state=0']);

export function computeSettlingMask(s: GuideSession, base?: Uint8Array): Uint8Array {
  const m = base && base.length === s.entries.length
    ? new Uint8Array(base)
    : new Uint8Array(s.entries.length);

  let inSettle = false;
  let startEntryIdx = 0;
  for (const info of s.infos) {
    if (SETTLING_START.has(info.info) && !inSettle) {
      inSettle = true;
      startEntryIdx = info.idx;
    } else if (SETTLING_END.has(info.info) && inSettle) {
      for (let i = startEntryIdx; i < info.idx && i < s.entries.length; i++) m[i] = 1;
      inSettle = false;
    }
  }
  if (inSettle) {
    for (let i = startEntryIdx; i < s.entries.length; i++) m[i] = 1;
  }

  for (const info of s.infos) {
    if (info.info.startsWith('DITHER')) {
      const stop = Math.min(s.entries.length, info.idx + DITHER_SETTLE_FRAMES);
      for (let i = info.idx; i < stop; i++) m[i] = 1;
    }
  }

  return m;
}
