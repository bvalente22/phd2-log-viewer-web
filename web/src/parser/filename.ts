/**
 * Lightweight metadata extractor for PHD2 log filenames.
 *
 * The standard format is `PHD2_GuideLog_YYYY-MM-DD_HHMMSS.{txt,log}` with
 * the timestamp written in local clock time by PHD2 (no timezone info in
 * the name itself, so we parse to local-time epoch ms — same convention
 * used elsewhere in the parser layer).
 *
 * Used by the logs-folder browser (`folderStore.ts`) to present logs
 * by date instead of filename and to filter `DebugLog`/other non-guide
 * files out of the listing.
 */
export interface ParsedLogName {
  /** Case-insensitive: filename contains "guidelog". */
  isGuideLog: boolean;
  /** Local-time epoch ms parsed from YYYY-MM-DD_HHMMSS, or null. */
  dateMs: number | null;
  /** "2026-03-30 · 16:15" when parseable, otherwise the raw filename. */
  dateLabel: string;
}

const TIMESTAMP_RE = /(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(\d{2})/;

/** Just the calendar date — no HHMMSS suffix required (unlike TIMESTAMP_RE). */
const DATE_RE = /\d{4}-\d{2}-\d{2}/;

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Pulls the bare YYYY-MM-DD calendar date out of a log filename, stripping
 * everything else — e.g. `name_test_PHD2_GuideLog_2026-05-11_182420.txt`
 * → `2026-05-11`. Returns the first date found, or null when the name
 * carries none (caller then falls back to the full filename).
 *
 * Used to seed the default friendly name in the first-open annotation
 * prompt, so a freshly-opened log is suggested as its date rather than its
 * verbose PHD2 filename.
 */
export function dateFromFilename(name: string): string | null {
  const m = name.match(DATE_RE);
  return m ? m[0] : null;
}

/**
 * Returns parsed metadata, or null if the filename does not contain
 * "guidelog" (case-insensitive).
 */
export function parseLogFilename(name: string): ParsedLogName | null {
  if (!/guidelog/i.test(name)) return null;
  const m = name.match(TIMESTAMP_RE);
  if (!m) {
    return { isGuideLog: true, dateMs: null, dateLabel: name };
  }
  const [, y, mo, d, h, mi, s] = m;
  const dateMs = new Date(+y, +mo - 1, +d, +h, +mi, +s).getTime();
  if (!Number.isFinite(dateMs)) {
    return { isGuideLog: true, dateMs: null, dateLabel: name };
  }
  const label = `${y}-${mo}-${d} · ${pad(+h)}:${pad(+mi)}`;
  return { isGuideLog: true, dateMs, dateLabel: label };
}
