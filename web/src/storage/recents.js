import { get, set, del, keys } from 'idb-keyval';
const MAX = 10;
const PREFIX = 'recent:';
const INDEX_KEY = 'recents:index';
const loadIndex = async () => (await get(INDEX_KEY)) ?? { ids: [] };
const saveIndex = (i) => set(INDEX_KEY, i);
export async function putRecent(p) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const rec = { id, name: p.name, size: p.size, text: p.text, openedAt: Date.now() };
    await set(PREFIX + id, rec);
    const idx = await loadIndex();
    idx.ids = [id, ...idx.ids.filter(x => x !== id)];
    while (idx.ids.length > MAX) {
        const evict = idx.ids.pop();
        await del(PREFIX + evict);
    }
    await saveIndex(idx);
    return id;
}
export async function getRecent(id) {
    return get(PREFIX + id);
}
export async function listRecents() {
    const idx = await loadIndex();
    const out = [];
    for (const id of idx.ids) {
        const r = await get(PREFIX + id);
        if (r)
            out.push({ id: r.id, name: r.name, size: r.size, openedAt: r.openedAt });
    }
    return out;
}
export async function deleteRecent(id) {
    await del(PREFIX + id);
    const idx = await loadIndex();
    idx.ids = idx.ids.filter(x => x !== id);
    await saveIndex(idx);
}
export async function _allKeys() {
    return (await keys()).map(String);
}
