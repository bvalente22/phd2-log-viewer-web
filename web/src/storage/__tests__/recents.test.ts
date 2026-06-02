import { describe, it, expect, beforeEach } from 'vitest';
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
      await putRecent({ name: `f${i}`, size: 1, text: 'x' });
      await new Promise(r => setTimeout(r, 2));
    }
    const ls = await listRecents();
    expect(ls.length).toBe(10);
    expect(ls[0].name).toBe('f11');
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
