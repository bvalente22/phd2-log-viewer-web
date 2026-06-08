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
import { useBltStore } from '../bltStore';

const resolveMock = resolveDebugLogFile as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
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
