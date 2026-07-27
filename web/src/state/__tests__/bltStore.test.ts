import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BltSequence } from '../../parser/parseBlt';

// bindToGuideLog now auto-loads the available debug log when there's no cached
// result. Mock the cache (empty), the resolver, and the parser.
vi.mock('../../storage/bltCache', () => ({
  getBltCache: vi.fn(async () => undefined),
  putBltCache: vi.fn(async () => {}),
  clearBltCache: vi.fn(async () => {}),
}));
vi.mock('../../storage/debugLogAccess', () => ({ resolveDebugLogFile: vi.fn() }));
vi.mock('../../parser/parseBlt', () => ({
  parseDebugLogFile: vi.fn(async () => [{ kind: 'north' } as unknown as BltSequence]),
}));

import { resolveDebugLogFile } from '../../storage/debugLogAccess';
import { getBltCache } from '../../storage/bltCache';
import { useBltStore } from '../bltStore';

const resolveMock = resolveDebugLogFile as unknown as ReturnType<typeof vi.fn>;
const cacheMock = getBltCache as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  cacheMock.mockResolvedValue(undefined);
  useBltStore.setState({
    guideLogName: '', debugLogName: null, debugLogSize: 0,
    sequences: [], selectedIndex: -1, loading: false, error: null,
  });
});

describe('bltStore.bindToGuideLog auto-load', () => {
  it('auto-loads the resolved debug log when there is no cached result', async () => {
    resolveMock.mockResolvedValue(new File(['x'], 'PHD2_DebugLog.txt'));
    await useBltStore.getState().bindToGuideLog('PHD2_GuideLog.txt');
    expect(useBltStore.getState().debugLogName).toBe('PHD2_DebugLog.txt');
    expect(useBltStore.getState().sequences).toHaveLength(1);
    expect(useBltStore.getState().selectedIndex).toBe(0);
  });

  it('leaves the drop zone (no sequences) when nothing is available', async () => {
    resolveMock.mockResolvedValue(null);
    await useBltStore.getState().bindToGuideLog('g2.txt');
    expect(useBltStore.getState().sequences).toHaveLength(0);
    expect(useBltStore.getState().debugLogName).toBeNull();
  });
});

describe('bltStore — debug log with no backlash run', () => {
  it('flags a RESTORED zero-sequence debug log as noSequences', async () => {
    // Regression: the cache-restore path used to leave `error` null, so a
    // remembered debug log with no BLT run was indistinguishable from "no debug
    // log yet" and the tab showed a bare drop zone telling the user to load the
    // very file they had already loaded.
    cacheMock.mockResolvedValue({
      guideLogName: 'g3.txt',
      debugLogName: 'PHD2_DebugLog_g3.txt',
      debugLogSize: 1234,
      sequences: [],
    });
    await useBltStore.getState().bindToGuideLog('g3.txt');
    const s = useBltStore.getState();
    expect(s.debugLogName).toBe('PHD2_DebugLog_g3.txt'); // a log IS loaded
    expect(s.sequences).toHaveLength(0);
    expect(s.error).toBe('noSequences');
    expect(s.selectedIndex).toBe(-1);
  });

  it('does not flag a restored log that does have runs', async () => {
    cacheMock.mockResolvedValue({
      guideLogName: 'g4.txt',
      debugLogName: 'PHD2_DebugLog_g4.txt',
      debugLogSize: 10,
      sequences: [{ kind: 'north' } as unknown as BltSequence],
    });
    await useBltStore.getState().bindToGuideLog('g4.txt');
    const s = useBltStore.getState();
    expect(s.error).toBeNull();
    expect(s.selectedIndex).toBe(0);
  });
});
