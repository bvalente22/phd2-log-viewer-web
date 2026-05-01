import { get, set, del, keys } from 'idb-keyval';

const MAX = 10;
const PREFIX = 'recent:';
const INDEX_KEY = 'recents:index';

export interface RecentMeta {
  id: string;
  name: string;
  size: number;
  openedAt: number;
}

export interface RecentRecord extends RecentMeta {
  text: string;
}

interface Index {
  ids: string[];
}

const loadIndex = async (): Promise<Index> => (await get<Index>(INDEX_KEY)) ?? { ids: [] };
const saveIndex = (i: Index) => set(INDEX_KEY, i);

export async function putRecent(p: { name: string; size: number; text: string }): Promise<string> {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const rec: RecentRecord = { id, name: p.name, size: p.size, text: p.text, openedAt: Date.now() };
  await set(PREFIX + id, rec);
  const idx = await loadIndex();
  idx.ids = [id, ...idx.ids.filter(x => x !== id)];
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
  for (const id of idx.ids) {
    const r = await get<RecentRecord>(PREFIX + id);
    if (r) out.push({ id: r.id, name: r.name, size: r.size, openedAt: r.openedAt });
  }
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
