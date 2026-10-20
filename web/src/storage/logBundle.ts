import { listZipEntries, readZipEntry, looksLikeZip } from './zipReader';
import { parseLogFilename } from '../parser/filename';

/**
 * Turns whatever the user dropped or picked — loose guide/debug logs, one or
 * more `.zip` archives of them (e.g. PHD2's "Upload Log Files" bundle), or a
 * mix — into a list of guide logs, each paired with its debug log.
 *
 * Nothing heavy is read here: zip entries are only listed, and every log's
 * bytes sit behind a lazy `read()`. A bundle's debug logs run to tens of MB
 * each, so only the one the user actually opens is ever inflated.
 *
 * Pure (no stores), so the pairing rules are unit-testable.
 */

/**
 * Sibling debug-log filename for a guide log: PHD2 writes them side by side and
 * the only difference is `GuideLog` → `DebugLog`
 * (PHD2_GuideLog_2026-05-10_005406.txt → PHD2_DebugLog_2026-05-10_005406.txt).
 */
export function debugLogNameFor(guideLogName: string): string {
  return guideLogName.replace(/GuideLog/i, 'DebugLog');
}

/** One log file inside the drop: a loose file or a zip entry. */
export interface LogSource {
  /** Filename without any zip folder path. */
  name: string;
  /** Uncompressed size in bytes. */
  size: number;
  /** The file's bytes; a zip entry is extracted on each call. */
  read: () => Promise<File>;
  /**
   * Durable link for re-reading it in a later session (Chromium only): the
   * file's own handle, or — for a zip entry — the zip's handle plus the entry's
   * path inside it. Null when the browser gave us bytes only.
   */
  link: { handle: FileSystemFileHandle; entry?: string } | null;
}

export interface BundleLog {
  guide: LogSource;
  /** The matching debug log, when the drop contained one. */
  debug: LogSource | null;
  /** Local-time epoch ms parsed from the guide log's filename, or null. */
  dateMs: number | null;
  /** "2026-09-15 · 16:02" when the filename has a timestamp, else the filename. */
  dateLabel: string;
}

export interface LogBundle {
  /** The zip's filename when the drop was a single zip; null otherwise. */
  label: string | null;
  /** Guide logs, newest first. */
  logs: BundleLog[];
}

const isDebugName = (name: string) => /DebugLog/i.test(name);
const isGuideName = (name: string) => /GuideLog/i.test(name) && !isDebugName(name);
const isTextName = (name: string) => /\.(txt|log)$/i.test(name);
const isZipName = (name: string) => /\.zip$/i.test(name);
// macOS Finder's "Compress" adds resource-fork shadows (`__MACOSX/…`, `._name`).
const isJunkPath = (path: string) => path.startsWith('__MACOSX/') || /(^|\/)\._/.test(path);

/**
 * Build the bundle. `handles` are the File System Access handles for the
 * dropped/picked files when the browser provides them (matched by filename).
 * Throws `ZipError` when a zip can't be read.
 */
export async function buildLogBundle(
  files: readonly File[],
  handles: readonly FileSystemFileHandle[] = [],
): Promise<LogBundle> {
  const sources: (LogSource & { fromZip: boolean })[] = [];
  const zipNames: string[] = [];
  for (const file of files) {
    const handle = handles.find((h) => h.name === file.name) ?? null;
    if (isZipName(file.name) || (await looksLikeZip(file))) {
      zipNames.push(file.name);
      for (const entry of await listZipEntries(file)) {
        if (isJunkPath(entry.path)) continue;
        sources.push({
          name: entry.name,
          size: entry.size,
          read: () => readZipEntry(file, entry),
          link: handle ? { handle, entry: entry.path } : null,
          fromZip: true,
        });
      }
    } else {
      sources.push({
        name: file.name,
        size: file.size,
        read: async () => file,
        link: handle ? { handle } : null,
        fromZip: false,
      });
    }
  }

  let guides = sources.filter((s) => isGuideName(s.name));
  // No PHD2-named guide log: fall back to the old single-file behaviour so a
  // renamed log still opens — any loose non-debug file, or a zipped text file.
  if (guides.length === 0) {
    guides = sources.filter((s) => !isDebugName(s.name) && (!s.fromZip || isTextName(s.name)));
  }
  const debugs = sources.filter((s) => isDebugName(s.name));

  // Same filename twice (e.g. the loose file AND a zip copy) → keep the first.
  const seen = new Set<string>();
  guides = guides.filter((g) => {
    const k = g.name.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const used = new Set<LogSource>();
  const logs: BundleLog[] = guides.map((g) => {
    const want = debugLogNameFor(g.name).toLowerCase();
    const debug = debugs.find((d) => !used.has(d) && d.name.toLowerCase() === want) ?? null;
    if (debug) used.add(debug);
    const parsed = parseLogFilename(g.name);
    return {
      guide: strip(g),
      debug: debug ? strip(debug) : null,
      dateMs: parsed?.dateMs ?? null,
      dateLabel: parsed?.dateLabel ?? g.name,
    };
  });
  // One guide log + one debug log whose names don't line up (renamed by the
  // sender): they can only belong together.
  if (logs.length === 1 && !logs[0].debug && debugs.length === 1) logs[0].debug = strip(debugs[0]);

  logs.sort((a, b) => {
    if (a.dateMs !== null && b.dateMs !== null) return b.dateMs - a.dateMs;
    if (a.dateMs !== null) return -1;
    if (b.dateMs !== null) return 1;
    return a.guide.name.localeCompare(b.guide.name);
  });

  return { label: files.length === 1 && zipNames.length === 1 ? zipNames[0] : null, logs };
}

const strip = ({ name, size, read, link }: LogSource): LogSource => ({ name, size, read, link });
