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
 *   - If the log emits SETTLING STATE CHANGE state=1/0 events, exclude the
 *     entry range bounded by those events (matches the desktop's
 *     "Exclude frames settling" menu item).
 *   - As a fallback (newer logs may only emit DITHER), also exclude the
 *     N entries immediately following any DITHER event.
 *
 * The result is OR-merged with `base` when supplied, so callers can layer
 * this onto an existing user-edited mask.
 */
export function computeSettlingMask(s: GuideSession, base?: Uint8Array): Uint8Array {
  const m = base && base.length === s.entries.length
    ? new Uint8Array(base)
    : new Uint8Array(s.entries.length);

  let inSettle = false;
  let startEntryIdx = 0;
  for (const info of s.infos) {
    if (info.info === 'state=1' && !inSettle) {
      inSettle = true;
      startEntryIdx = info.idx;
    } else if (info.info === 'state=0' && inSettle) {
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
