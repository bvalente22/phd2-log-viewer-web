import { describe, it, expect } from 'vitest';
import { openDebugTab, setDebugTabSlot, type DebugTabSlot } from '../debugLogTab';

const slots = () => (window as unknown as { __debugTabData: Record<string, DebugTabSlot> }).__debugTabData;

describe('debugLogTab slots', () => {
  it('openDebugTab creates a loading slot and returns its key', () => {
    const { key } = openDebugTab();
    expect(slots()[key]).toEqual({ state: 'loading' });
  });

  it('setDebugTabSlot updates the slot (ready payload kept by reference)', () => {
    const { key } = openDebugTab();
    setDebugTabSlot(key, { state: 'needPick' });
    expect(slots()[key]).toEqual({ state: 'needPick' });
    const payload: DebugTabSlot = {
      state: 'ready', fileName: 'PHD2_DebugLog_x.txt', lines: ['a', 'b'], matchedIndex: 1, targetMs: 1000, matchedMs: 1100,
    };
    setDebugTabSlot(key, payload);
    expect(slots()[key]).toBe(payload);
  });

  it('uses a fresh key per open so multiple tabs do not clobber each other', () => {
    expect(openDebugTab().key).not.toBe(openDebugTab().key);
  });
});
