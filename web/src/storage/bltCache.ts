import { get, set, del, keys } from 'idb-keyval';
import type { BltSequence } from '../parser/parseBlt';

/**
 * BLT cache — persists parsed Backlash Test sequences keyed by guide-log
 * filename, so the user doesn't have to re-load and re-parse the
 * (40 MB) debug log every time they re-open the same guide log.
 *
 * We persist only the parsed BltSequence[] (a few KB at most), not the
 * raw debug-log text. The user's File handle isn't persistable across
 * sessions in most browsers, so re-opening the same guide log restores
 * the analysis result but not the source file — re-parsing requires a
 * fresh drop/pick.
 */

const PREFIX = 'blt:';
const MAX_CACHED = 50;
const INDEX_KEY = 'blt:index';

interface CachedBlt {
  /** Guide log filename used as the key. */
  guideLogName: string;
  /** Source debug log filename, just for display. */
  debugLogName: string;
  /** Size of the source debug log, just for display. */
  debugLogSize: number;
  /** When the cache entry was written. */
  cachedAt: number;
  sequences: BltSequence[];
}

interface Index {
  /** Guide log names in MRU order. */
  names: string[];
}

const loadIndex = async (): Promise<Index> => (await get<Index>(INDEX_KEY)) ?? { names: [] };
const saveIndex = (i: Index) => set(INDEX_KEY, i);

/** Stash the parsed BLT result for a guide log. */
export async function putBltCache(p: {
  guideLogName: string;
  debugLogName: string;
  debugLogSize: number;
  sequences: BltSequence[];
}): Promise<void> {
  const rec: CachedBlt = { ...p, cachedAt: Date.now() };
  await set(PREFIX + p.guideLogName, rec);
  const idx = await loadIndex();
  idx.names = [p.guideLogName, ...idx.names.filter((n) => n !== p.guideLogName)];
  // Evict the LRU tail if we exceed the cache budget.
  while (idx.names.length > MAX_CACHED) {
    const evict = idx.names.pop()!;
    await del(PREFIX + evict);
  }
  await saveIndex(idx);
}

/** Retrieve a previously-cached BLT result, if any. */
export async function getBltCache(guideLogName: string): Promise<CachedBlt | undefined> {
  return get<CachedBlt>(PREFIX + guideLogName);
}

/** Drop a single cache entry (and remove from the index). */
export async function clearBltCache(guideLogName: string): Promise<void> {
  await del(PREFIX + guideLogName);
  const idx = await loadIndex();
  idx.names = idx.names.filter((n) => n !== guideLogName);
  await saveIndex(idx);
}

/** Drop ALL BLT cache entries — used by a hypothetical "clear data"
 *  control; not currently surfaced. */
export async function clearAllBltCaches(): Promise<void> {
  const allKeys = await keys();
  for (const k of allKeys) {
    if (typeof k === 'string' && k.startsWith(PREFIX)) await del(k);
  }
}
