import { describe, it, expect } from 'vitest';
import { debugTabUrl } from '../debugLogTab';

describe('debugTabUrl', () => {
  it('stashes the payload on window and returns a keyed debug-log-tab URL', () => {
    const payload = {
      fileName: 'PHD2_DebugLog_x.txt',
      lines: ['a', 'b', 'c'],
      matchedIndex: 1,
      targetMs: 1000,
      matchedMs: 1100,
    };
    const url = debugTabUrl(payload);
    expect(url).toContain('debug-log-tab.html#');
    const key = url.split('#')[1];
    const store = (window as unknown as { __debugTabData: Record<string, unknown> }).__debugTabData;
    expect(store[key]).toBe(payload); // by reference, no copy
  });

  it('uses a fresh key per call so multiple tabs do not clobber each other', () => {
    const a = debugTabUrl({ fileName: 'a', lines: [], matchedIndex: 0, targetMs: 0, matchedMs: 0 });
    const b = debugTabUrl({ fileName: 'b', lines: [], matchedIndex: 0, targetMs: 0, matchedMs: 0 });
    expect(a.split('#')[1]).not.toBe(b.split('#')[1]);
  });
});
