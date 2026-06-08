import { describe, it, expect, vi, beforeEach } from 'vitest';

// resolveDebugLogFile reads the current log's hash + the folder store, and the
// persisted-handle store. Mock all three so we drive resolution order directly.
// (A real FileSystemFileHandle is structured-cloneable; a fake with method
// properties is not, so we mock the handle store rather than round-trip IDB.)
vi.mock('../../state/logStore', () => ({ useLogStore: { getState: vi.fn(() => ({ meta: null })) } }));
vi.mock('../../state/folderStore', () => ({ useFolderStore: { getState: () => ({ state: 'idle', handle: null }) } }));
vi.mock('../debugLogHandles', () => ({
  getDebugLogHandle: vi.fn(async () => undefined),
  putDebugLogHandle: vi.fn(async () => {}),
}));

import { useLogStore } from '../../state/logStore';
import { getDebugLogHandle } from '../debugLogHandles';
import { resolveDebugLogFile, setStashedDebugLog } from '../debugLogAccess';

const setHash = (hash: string | null) =>
  (useLogStore.getState as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ meta: hash ? { hash } : null });
const getHandleMock = getDebugLogHandle as unknown as ReturnType<typeof vi.fn>;

const storedHandle = (file: File, perm: PermissionState = 'granted') => ({
  key: 'k', fileName: 'd.txt', cachedAt: 0,
  handle: {
    kind: 'file', name: 'd.txt',
    queryPermission: async () => perm,
    requestPermission: async () => perm,
    getFile: async () => file,
  },
});

beforeEach(() => {
  getHandleMock.mockReset();
  getHandleMock.mockResolvedValue(undefined);
});

describe('resolveDebugLogFile resolution order', () => {
  it('reads the persisted handle when permission is granted and there is no stash', async () => {
    setHash('h1');
    const file = new File(['x'], 'PHD2_DebugLog_x.txt');
    getHandleMock.mockResolvedValue(storedHandle(file));
    expect(await resolveDebugLogFile('PHD2_GuideLog_x.txt')).toBe(file);
  });

  it('prefers the session stash over the persisted handle', async () => {
    setHash('h2');
    const stash = new File(['s'], 's.txt');
    getHandleMock.mockResolvedValue(storedHandle(new File(['h'], 'd.txt')));
    setStashedDebugLog('h2', stash);
    expect(await resolveDebugLogFile('g.txt')).toBe(stash);
  });

  it('returns null when the handle permission is denied and no folder is available', async () => {
    setHash('h3');
    getHandleMock.mockResolvedValue(storedHandle(new File(['x'], 'd.txt'), 'denied'));
    expect(await resolveDebugLogFile('g.txt')).toBeNull();
  });

  it('returns null when no guide log hash is loaded and no folder', async () => {
    setHash(null);
    expect(await resolveDebugLogFile('g.txt')).toBeNull();
  });
});
