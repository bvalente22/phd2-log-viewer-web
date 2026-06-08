import { get, set, del, keys } from 'idb-keyval';

/**
 * Persists a HANDLE to the debug log the user dragged in with a guide log —
 * a `FileSystemFileHandle`, which is structured-cloneable, so we store a tiny
 * reference (a "link") rather than the 20–40 MB of debug-log bytes. Keyed by
 * the guide log's content hash. Reopening the same guide log later re-reads the
 * file through the handle (re-granting read permission on first use).
 *
 * LRU-capped: handles are tiny, but the underlying files can be huge, so we cap
 * how many guide logs we remember a debug log for.
 *
 * Chromium-only (File System Access API) — same limitation as the folder
 * browser. Elsewhere `getAsFileSystemHandle` is unavailable, so nothing is
 * stored and the dragged debug log stays session-only.
 */
const PREFIX = 'dbgh:';
const INDEX_KEY = 'dbgh:index';
const MAX_REMEMBERED = 50;

export interface DebugLogHandleRecord {
  /** Guide log content hash (without the `dbgh:` prefix). */
  key: string;
  handle: FileSystemFileHandle;
  /** Debug log filename, for display. */
  fileName: string;
  cachedAt: number;
}

const loadIndex = async (): Promise<string[]> => (await get<string[]>(INDEX_KEY)) ?? [];
const saveIndex = (names: string[]) => set(INDEX_KEY, names);

/** Remember the debug-log handle for a guide log (MRU; evicts the LRU tail). */
export async function putDebugLogHandle(
  key: string, handle: FileSystemFileHandle, fileName: string,
): Promise<void> {
  const rec: DebugLogHandleRecord = { key, handle, fileName, cachedAt: Date.now() };
  await set(PREFIX + key, rec);
  let names = [key, ...(await loadIndex()).filter((n) => n !== key)];
  while (names.length > MAX_REMEMBERED) {
    const evict = names.pop()!;
    await del(PREFIX + evict);
  }
  await saveIndex(names);
}

export async function getDebugLogHandle(key: string): Promise<DebugLogHandleRecord | undefined> {
  return get<DebugLogHandleRecord>(PREFIX + key);
}

export async function deleteDebugLogHandle(key: string): Promise<void> {
  await del(PREFIX + key);
  await saveIndex((await loadIndex()).filter((n) => n !== key));
}

/** Test/maintenance helper — every debug-log-handle key (with the `dbgh:` prefix). */
export async function _allDebugLogHandleKeys(): Promise<string[]> {
  return (await keys()).map(String).filter((k) => k.startsWith(PREFIX) && k !== INDEX_KEY);
}
