import { get, set, del, keys } from 'idb-keyval';
import { hashLogText } from './annotations';

const MAX = 10;
const PREFIX = 'recent:';
const INDEX_KEY = 'recents:index';

export interface RecentMeta {
  id: string;
  name: string;
  size: number;
  openedAt: number;
  hash?: string;
}

export interface RecentRecord extends RecentMeta {
  text: string;
}

interface Index {
  ids: string[];
}

const loadIndex = async (): Promise<Index> => (await get<Index>(INDEX_KEY)) ?? { ids: [] };
const saveIndex = (i: Index) => set(INDEX_KEY, i);

export async function putRecent(p: { name: string; size: number; text: string; hash?: string }): Promise<string> {
  const hash = p.hash ?? hashLogText(p.text);
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const rec: RecentRecord = {
    id, name: p.name, size: p.size, text: p.text, hash,
    openedAt: Date.now(),
  };
  await set(PREFIX + id, rec);
  const idx = await loadIndex();
  // Dedupe by content hash: drop any prior entry for the same log so repeat
  // opens of the same file don't pile up — the freshly-added id takes its
  // place at the top instead, and the latest filename wins. Dangling index
  // entries (record missing) are pruned in passing.
  const survivors: string[] = [];
  for (const x of idx.ids) {
    if (x === id) continue;
    const prev = await get<RecentRecord>(PREFIX + x);
    if (!prev) continue; // prune dangling id
    const prevHash = prev.hash ?? hashLogText(prev.text);
    if (prevHash === hash) {
      await del(PREFIX + x); // same content — remove the stale entry
    } else {
      survivors.push(x);
    }
  }
  idx.ids = [id, ...survivors];
  while (idx.ids.length > MAX) {
    const evict = idx.ids.pop()!;
    await del(PREFIX + evict);
  }
  await saveIndex(idx);
  return id;
}

export async function getRecent(id: string): Promise<RecentRecord | undefined> {
  return get<RecentRecord>(PREFIX + id);
}

export async function listRecents(): Promise<RecentMeta[]> {
  const idx = await loadIndex();
  const out: RecentMeta[] = [];
  const seenHashes = new Set<string>();
  const keptIds: string[] = [];
  let pruned = false;
  for (const id of idx.ids) {
    const r = await get<RecentRecord>(PREFIX + id);
    if (!r) { pruned = true; continue; } // drop dangling index entry
    let hash = r.hash;
    if (!hash) {
      hash = hashLogText(r.text);
      await set(PREFIX + id, { ...r, hash }); // persist the backfill
    }
    // Safety net for data written by the pre-dedupe putRecent: collapse any
    // same-hash duplicates, keeping the first (most-recent) occurrence and
    // pruning the rest from both the store and the index.
    if (seenHashes.has(hash)) {
      await del(PREFIX + id);
      pruned = true;
      continue;
    }
    seenHashes.add(hash);
    keptIds.push(id);
    out.push({ id: r.id, name: r.name, size: r.size, openedAt: r.openedAt, hash });
  }
  if (pruned) await saveIndex({ ids: keptIds }); // persist the cleanup once
  return out;
}

export async function deleteRecent(id: string): Promise<void> {
  await del(PREFIX + id);
  const idx = await loadIndex();
  idx.ids = idx.ids.filter(x => x !== id);
  await saveIndex(idx);
}

export async function _allKeys(): Promise<string[]> {
  return (await keys()).map(String);
}
