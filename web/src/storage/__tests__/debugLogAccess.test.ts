import { describe, it, expect, vi, beforeEach } from 'vitest';

// resolveDebugLogFile reads the current log's hash + the folder store, and the
// persisted-handle store. Mock all three so we drive resolution order directly.
// (A real FileSystemFileHandle is structured-cloneable; a fake with method
// properties is not, so we mock the handle store rather than round-trip IDB.)
vi.mock('../../state/logStore', () => ({ useLogStore: { getState: vi.fn(() => ({ meta: null })) } }));
// Reconfigurable folder-store mock — tests set `folderState` to drive the
// folder-resolution branch (default: no folder).
let folderState: { state: string; handle: unknown } = { state: 'idle', handle: null };
vi.mock('../../state/folderStore', () => ({ useFolderStore: { getState: () => folderState } }));
vi.mock('../debugLogHandles', () => ({
  getDebugLogHandle: vi.fn(async () => undefined),
  putDebugLogHandle: vi.fn(async () => {}),
}));

import { useLogStore } from '../../state/logStore';
import { getDebugLogHandle, putDebugLogHandle } from '../debugLogHandles';
import { resolveDebugLogFile, setStashedDebugLog, readDroppedFiles } from '../debugLogAccess';

const setHash = (hash: string | null) =>
  (useLogStore.getState as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ meta: hash ? { hash } : null });
const getHandleMock = getDebugLogHandle as unknown as ReturnType<typeof vi.fn>;
const putHandleMock = putDebugLogHandle as unknown as ReturnType<typeof vi.fn>;

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
  putHandleMock.mockClear();
  folderState = { state: 'idle', handle: null };
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

  it('resolves the sibling from a connected folder AND persists its handle by hash', async () => {
    setHash('h4');
    const file = new File(['x'], 'PHD2_DebugLog_x.txt');
    const fileHandle = { kind: 'file', name: 'PHD2_DebugLog_x.txt', getFile: async () => file };
    const dirHandle = {
      queryPermission: async () => 'granted',
      requestPermission: async () => 'granted',
      getFileHandle: async (name: string) =>
        name === 'PHD2_DebugLog_x.txt' ? fileHandle : Promise.reject(new Error('NotFound')),
    };
    folderState = { state: 'listing', handle: dirHandle };
    expect(await resolveDebugLogFile('PHD2_GuideLog_x.txt')).toBe(file);
    // The exact sibling file handle is saved against the guide-log hash so a
    // later session (Recents reopen) resolves it without re-granting the folder.
    expect(putHandleMock).toHaveBeenCalledWith('h4', fileHandle, 'PHD2_DebugLog_x.txt');
  });
});

describe('readDroppedFiles', () => {
  it('captures the dropped files synchronously, surviving DataTransfer neutering after the handle await', async () => {
    const guide = new File(['g'], 'PHD2_GuideLog_x.txt');
    const debug = new File(['d'], 'PHD2_DebugLog_x.txt');
    // Array-like FileList that EMPTIES (as a real browser neuters it) the moment
    // the getAsFileSystemHandle promise resolves — i.e. during readDroppedFiles'
    // await. The fix must have already captured the files before that.
    const fileList: Record<number, File> & { length: number } = { 0: guide, 1: debug, length: 2 };
    const neuter = () => { delete fileList[0]; delete fileList[1]; fileList.length = 0; };
    const dataTransfer = {
      get files() { return fileList as unknown as FileList; },
      items: [
        {
          kind: 'file',
          getAsFileSystemHandle: () =>
            Promise.resolve().then(() => { neuter(); return { kind: 'file', name: 'PHD2_DebugLog_x.txt' }; }),
        },
      ] as unknown as DataTransferItemList,
    } as unknown as DataTransfer;

    const { files, debugHandle } = await readDroppedFiles(dataTransfer);
    expect(files.map((f) => f.name)).toEqual(['PHD2_GuideLog_x.txt', 'PHD2_DebugLog_x.txt']);
    expect((debugHandle as unknown as { name: string } | null)?.name).toBe('PHD2_DebugLog_x.txt');
  });

  it('returns no debug handle when the browser does not expose getAsFileSystemHandle', async () => {
    const guide = new File(['g'], 'PHD2_GuideLog_y.txt');
    const dataTransfer = {
      files: { 0: guide, length: 1 } as unknown as FileList,
      items: [{ kind: 'file' }] as unknown as DataTransferItemList,
    } as unknown as DataTransfer;
    const { files, debugHandle } = await readDroppedFiles(dataTransfer);
    expect(files.map((f) => f.name)).toEqual(['PHD2_GuideLog_y.txt']);
    expect(debugHandle).toBeNull();
  });
});
