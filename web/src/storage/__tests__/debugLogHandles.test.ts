import { describe, it, expect, beforeEach } from 'vitest';
import { del } from 'idb-keyval';
import {
  putDebugLogHandle, getDebugLogHandle, deleteDebugLogHandle, _allDebugLogHandleKeys,
} from '../debugLogHandles';

// A FileSystemFileHandle is structured-cloneable; idb-keyval clones it, so a
// plain object stands in fine for the store's purposes.
const fakeHandle = (name: string) => ({ kind: 'file', name }) as unknown as FileSystemFileHandle;

beforeEach(async () => {
  for (const k of await _allDebugLogHandleKeys()) await del(k);
  await del('dbgh:index');
});

describe('debugLogHandles', () => {
  it('round-trips a handle + filename keyed by guide hash', async () => {
    await putDebugLogHandle('h1', fakeHandle('PHD2_DebugLog_x.txt'), 'PHD2_DebugLog_x.txt');
    const rec = await getDebugLogHandle('h1');
    expect(rec?.fileName).toBe('PHD2_DebugLog_x.txt');
    expect((rec?.handle as unknown as { name: string }).name).toBe('PHD2_DebugLog_x.txt');
  });

  it('deleteDebugLogHandle removes it', async () => {
    await putDebugLogHandle('h1', fakeHandle('d.txt'), 'd.txt');
    await deleteDebugLogHandle('h1');
    expect(await getDebugLogHandle('h1')).toBeUndefined();
  });

  it('re-putting the same key updates without duplicating the index', async () => {
    await putDebugLogHandle('h1', fakeHandle('a.txt'), 'a.txt');
    await putDebugLogHandle('h1', fakeHandle('b.txt'), 'b.txt');
    expect((await getDebugLogHandle('h1'))?.fileName).toBe('b.txt');
    expect(await _allDebugLogHandleKeys()).toHaveLength(1);
  });

  it('evicts the least-recently-used beyond the cap', async () => {
    for (let i = 0; i <= 50; i++) await putDebugLogHandle('k' + i, fakeHandle('d' + i), 'd' + i); // 51 entries
    expect(await getDebugLogHandle('k0')).toBeUndefined(); // oldest evicted
    expect((await getDebugLogHandle('k50'))?.fileName).toBe('d50'); // newest kept
    expect((await _allDebugLogHandleKeys()).length).toBe(50);
  });
});
