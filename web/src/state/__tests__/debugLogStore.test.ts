import { describe, it, expect, vi, beforeEach } from 'vitest';

// Records the order of the two activation-sensitive side effects so we can lock
// in that the sibling file is RESOLVED before the viewer tab is OPENED. The bug
// this guards against: opening the tab first (`window.open`) consumes the
// click's transient user activation, which the File System Access permission
// prompt for a persisted debug-log handle then needs — so resolution silently
// failed and the debug window reported "no debug log" after reopening a guide
// log from Recents in a new session.
const calls: string[] = [];

vi.mock('../../components/debugLogTab', () => ({
  openDebugTab: vi.fn(() => { calls.push('openDebugTab'); return { key: 'k1', tab: {} }; }),
  setDebugTabSlot: vi.fn(),
}));
vi.mock('../../storage/debugLogAccess', () => ({
  // Resolve to null (no sibling) so the slow path runs to the needPick branch
  // without touching the real file/permission machinery.
  resolveDebugLogFile: vi.fn(async () => { calls.push('resolve'); return null; }),
  grantDebugFolderAndResolve: vi.fn(),
  pickDebugLogFileHandle: vi.fn(),
  stashDebugLogForCurrentLog: vi.fn(),
}));

import { useDebugLogStore } from '../debugLogStore';

beforeEach(() => {
  calls.length = 0;
  useDebugLogStore.setState({ status: 'idle', errorKey: null, canPick: false, pending: null });
});

describe('openForSample', () => {
  it('resolves the sibling debug log BEFORE opening the viewer tab', async () => {
    await useDebugLogStore.getState().openForSample({
      guideLogName: 'PHD2_GuideLog_x.txt', startsMs: 1_700_000_000_000, targetEpochMs: 1_700_000_010_000,
    });
    // Order matters: window.open (inside openDebugTab) consumes the gesture's
    // transient activation, so resolution — which may prompt for handle
    // permission — must come first.
    expect(calls).toEqual(['resolve', 'openDebugTab']);
  });

  it('reports noTimestamp without opening a tab when the sample has no clock', async () => {
    await useDebugLogStore.getState().openForSample({
      guideLogName: 'g.txt', startsMs: null, targetEpochMs: 0,
    });
    expect(calls).toEqual([]);
    expect(useDebugLogStore.getState().errorKey).toBe('noTimestamp');
  });
});
