import { describe, it, expect, beforeEach } from 'vitest';
import { set } from 'idb-keyval';
import { listRecents, putRecent, getRecent, deleteRecent } from '../recents';

beforeEach(async () => {
  for (const r of await listRecents()) await deleteRecent(r.id);
});

describe('recents', () => {
  it('round-trips a recent record', async () => {
    const id = await putRecent({ name: 'foo.log', size: 100, text: 'hello' });
    const r = await getRecent(id);
    expect(r?.name).toBe('foo.log');
    expect(r?.text).toBe('hello');
  });

  it('lists recents most-recent first', async () => {
    const a = await putRecent({ name: 'a', size: 1, text: 'a' });
    await new Promise(r => setTimeout(r, 5));
    const b = await putRecent({ name: 'b', size: 1, text: 'b' });
    const ls = await listRecents();
    expect(ls[0].id).toBe(b);
    expect(ls[1].id).toBe(a);
  });

  it('LRU-evicts beyond max', async () => {
    for (let i = 0; i < 12; i++) {
      // Distinct text per entry so they don't collapse under hash-dedupe.
      await putRecent({ name: `f${i}`, size: 1, text: `x${i}` });
      await new Promise(r => setTimeout(r, 2));
    }
    const ls = await listRecents();
    expect(ls.length).toBe(10);
    expect(ls[0].name).toBe('f11');
  });

  it('dedupes repeat opens of the same content', async () => {
    await putRecent({ name: 'same.log', size: 5, text: 'identical' });
    await new Promise(r => setTimeout(r, 2));
    await putRecent({ name: 'same.log', size: 5, text: 'identical' });
    const ls = await listRecents();
    expect(ls.length).toBe(1);
  });

  it('reopening the same content moves it to the top (most-recent)', async () => {
    await putRecent({ name: 'a', size: 1, text: 'aaa' });
    await new Promise(r => setTimeout(r, 2));
    await putRecent({ name: 'b', size: 1, text: 'bbb' });
    await new Promise(r => setTimeout(r, 2));
    await putRecent({ name: 'a', size: 1, text: 'aaa' }); // reopen A
    const ls = await listRecents();
    expect(ls.length).toBe(2);
    expect(ls[0].name).toBe('a'); // A is back on top
    expect(ls[1].name).toBe('b');
  });

  it('dedupes by an explicitly provided hash regardless of filename', async () => {
    await putRecent({ name: 'old-name.log', size: 1, text: 'whatever', hash: 'fixedhash' });
    await new Promise(r => setTimeout(r, 2));
    await putRecent({ name: 'renamed.log', size: 1, text: 'whatever', hash: 'fixedhash' });
    const ls = await listRecents();
    expect(ls.length).toBe(1);
    expect(ls[0].name).toBe('renamed.log'); // most-recent name wins
  });

  it('collapses legacy same-hash duplicates on list (safety net for pre-fix data)', async () => {
    // Seed raw entries the way the OLD putRecent did: two records with the
    // same hash plus an index that references both. listRecents must return a
    // single, deduped entry (most-recent first kept).
    await set('recent:dup-2', { id: 'dup-2', name: 'dupe.log', size: 1, text: 'd', hash: 'H', openedAt: 2 });
    await set('recent:dup-1', { id: 'dup-1', name: 'dupe.log', size: 1, text: 'd', hash: 'H', openedAt: 1 });
    await set('recents:index', { ids: ['dup-2', 'dup-1'] });
    const ls = await listRecents();
    expect(ls.length).toBe(1);
    expect(ls[0].id).toBe('dup-2'); // most-recent kept
  });

  it('stores and returns a provided hash', async () => {
    await putRecent({ name: 'h.log', size: 3, text: 'abc', hash: 'deadbeef' });
    const ls = await listRecents();
    expect(ls[0].hash).toBe('deadbeef');
  });

  it('backfills a missing hash on list', async () => {
    // Simulate a pre-feature recent with no hash by writing through putRecent
    // without one, then confirm listRecents computes & returns one.
    await putRecent({ name: 'old.log', size: 5, text: 'hello' });
    const ls = await listRecents();
    expect(typeof ls[0].hash).toBe('string');
    expect(ls[0].hash!.length).toBeGreaterThan(0);
  });
});
