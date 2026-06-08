/**
 * Timestamp helpers for matching a guide-log sample to a line in the sibling
 * PHD2 DEBUG log. Debug lines begin with a local wall-clock `HH:MM:SS.mmm`
 * (no date); guide samples carry an epoch ms (session start + dt). We match in
 * a TZ-independent "wall clock" space so the viewer's timezone never matters:
 * the guide log's start digits round-trip through the local Date constructor,
 * and we re-encode the local clock components as `Date.UTC(...)`.
 */

const TS = /^(\d{2}):(\d{2}):(\d{2})\.(\d{3})/;
const DAY_MS = 86_400_000;
const HALF_DAY_MS = DAY_MS / 2;

/**
 * Parse the leading `HH:MM:SS.mmm` of each debug line into an absolute
 * wall-clock ms (anchored on the session's calendar date). Lines without a
 * leading timestamp inherit the previous line's time (PHD2 wraps a few multi-
 * line messages); lines before the first timestamp get `dayAnchorMs`. Debug
 * logs are chronological, so a sharp backward jump in time-of-day (> 12 h) is
 * treated as a midnight rollover and bumps the day.
 *
 * `dayAnchorMs` must be the wall-clock midnight of the session's date, e.g.
 * `dayAnchorMs(garun.starts)`.
 */
export function parseDebugTimes(lines: string[], dayAnchorMs: number): Float64Array {
  const out = new Float64Array(lines.length);
  let dayOffset = 0;
  let lastMsOfDay = -1;
  let lastAbs = dayAnchorMs;
  for (let i = 0; i < lines.length; i++) {
    const m = TS.exec(lines[i]);
    if (!m) {
      out[i] = lastAbs;
      continue;
    }
    const msOfDay = ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000 + +m[4];
    if (lastMsOfDay >= 0 && msOfDay < lastMsOfDay - HALF_DAY_MS) dayOffset += 1;
    lastMsOfDay = msOfDay;
    lastAbs = dayAnchorMs + dayOffset * DAY_MS + msOfDay;
    out[i] = lastAbs;
  }
  return out;
}

/**
 * Index of the entry in the non-decreasing `times` closest to `targetMs`.
 * Ties resolve to the lower index. Clamps to the ends; returns 0 when empty.
 */
export function findClosestTimeIndex(times: Float64Array, targetMs: number): number {
  const n = times.length;
  if (n === 0) return 0;
  if (targetMs <= times[0]) return 0;
  if (targetMs >= times[n - 1]) return n - 1;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < targetMs) lo = mid + 1;
    else hi = mid;
  }
  // `lo` is the first index with times[lo] >= targetMs; compare it to lo-1.
  const below = lo - 1;
  return targetMs - times[below] <= times[lo] - targetMs ? below : lo;
}

/**
 * Epoch ms → TZ-independent wall-clock ms (the local clock digits re-encoded as
 * if UTC). Round-trips PHD2's local timestamps so matching is timezone-proof.
 */
export function toWallClockMs(epochMs: number): number {
  const d = new Date(epochMs);
  return Date.UTC(
    d.getFullYear(), d.getMonth(), d.getDate(),
    d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds(),
  );
}

/** Wall-clock midnight of the day containing `epochMs`, as the UTC anchor used by parseDebugTimes. */
export function dayAnchorMs(epochMs: number): number {
  const d = new Date(epochMs);
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Time-of-day ms of the first line carrying a leading `HH:MM:SS.mmm`, or null. */
export function firstTimestampMsOfDay(lines: string[]): number | null {
  for (const line of lines) {
    const m = TS.exec(line);
    if (m) return ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000 + +m[4];
  }
  return null;
}

/**
 * Wall-clock midnight anchor for the debug log, given the guide session's start
 * and the log's first timestamp-of-day. A PHD2 debug log usually starts BEFORE
 * the session (it logs continuously from launch). If the session began after
 * midnight while the log's first line is later in the day (it started the
 * previous evening), anchoring on the session's own date would push the pre-
 * midnight lines a full day too late — so anchor a day earlier, making the log's
 * timeline bracket the session. Pass the result to `parseDebugTimes`.
 */
export function debugLogAnchorMs(sessionStartEpochMs: number, firstLineMsOfDay: number | null): number {
  const anchor = dayAnchorMs(sessionStartEpochMs);
  if (firstLineMsOfDay == null) return anchor;
  const sessionWall = toWallClockMs(sessionStartEpochMs);
  return anchor + firstLineMsOfDay > sessionWall ? anchor - DAY_MS : anchor;
}
