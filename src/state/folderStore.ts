import { create } from 'zustand';
import { parseLogFilename } from '../parser/filename';
import { saveFolderHandle, loadFolderHandle, clearFolderHandle } from '../storage/folderHandle';
import { useLogStore } from './logStore';

export interface FolderRecord {
  handle: FileSystemFileHandle;
  filename: string;
  dateMs: number | null;
  dateLabel: string;
}

type State =
  | { state: 'unsupported' }
  | { state: 'no-folder' }
  | { state: 'needs-permission'; handle: FileSystemDirectoryHandle; folderName: string }
  | { state: 'listing'; handle: FileSystemDirectoryHandle; folderName: string;
      records: ReadonlyArray<FolderRecord> }
  | { state: 'error'; message: string };

interface Actions {
  /** Browser shows the OS picker; user selects a directory. */
  pickFolder: () => Promise<void>;
  /** Re-grant read permission on the saved handle. */
  reconnect: () => Promise<void>;
  /** Forget the saved handle and return to 'no-folder'. */
  forgetFolder: () => Promise<void>;
  /** Re-read the folder listing (e.g. after the user added a new log). */
  refresh: () => Promise<void>;
  /** Read the file at `record.handle` and load it into the main log store. */
  openRecord: (record: FolderRecord) => Promise<void>;
}

const isSupported = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

/**
 * Module-level helper — list every guide log inside `handle`, sort by parsed
 * date descending. Unparseable dates sort to the bottom alphabetically.
 */
async function listFolder(handle: FileSystemDirectoryHandle): Promise<FolderRecord[]> {
  const out: FolderRecord[] = [];
  for await (const entry of handle.values()) {
    if (entry.kind !== 'file') continue;
    const parsed = parseLogFilename(entry.name);
    if (!parsed) continue;
    out.push({
      handle: entry as FileSystemFileHandle,
      filename: entry.name,
      dateMs: parsed.dateMs,
      dateLabel: parsed.dateLabel,
    });
  }
  out.sort((a, b) => {
    if (a.dateMs !== null && b.dateMs !== null) return b.dateMs - a.dateMs;
    if (a.dateMs !== null) return -1;
    if (b.dateMs !== null) return 1;
    return a.filename.localeCompare(b.filename);
  });
  return out;
}

/**
 * Zustand store for the logs-folder browser.
 *
 * Encapsulates every File System Access API call so components stay
 * presentational. State machine matches §7 of the design spec.
 */
export const useFolderStore = create<State & Actions>((set, get) => ({
  state: isSupported ? 'no-folder' : 'unsupported',

  pickFolder: async () => {
    if (!isSupported) return;
    try {
      const handle = await window.showDirectoryPicker({ mode: 'read' });
      await saveFolderHandle(handle);
      const records = await listFolder(handle);
      set({ state: 'listing', handle, folderName: handle.name, records });
    } catch (err) {
      // AbortError when user cancels the picker — silent no-op.
      if ((err as DOMException)?.name === 'AbortError') return;
      set({ state: 'error', message: (err as Error).message ?? 'Failed to pick folder' });
    }
  },

  reconnect: async () => {
    const cur = get();
    if (cur.state !== 'needs-permission') return;
    const perm = await cur.handle.requestPermission({ mode: 'read' });
    if (perm !== 'granted') {
      set({ state: 'needs-permission', handle: cur.handle, folderName: cur.folderName });
      return;
    }
    try {
      const records = await listFolder(cur.handle);
      set({ state: 'listing', handle: cur.handle, folderName: cur.folderName, records });
    } catch (err) {
      set({ state: 'error', message: (err as Error).message ?? 'Failed to read folder' });
    }
  },

  forgetFolder: async () => {
    await clearFolderHandle();
    if (isSupported) {
      set({ state: 'no-folder' });
    } else {
      set({ state: 'unsupported' });
    }
  },

  refresh: async () => {
    const cur = get();
    if (cur.state !== 'listing') return;
    try {
      const records = await listFolder(cur.handle);
      set({ state: 'listing', handle: cur.handle, folderName: cur.folderName, records });
    } catch (err) {
      set({ state: 'error', message: (err as Error).message ?? 'Failed to refresh folder' });
    }
  },

  openRecord: async (record) => {
    try {
      const file = await record.handle.getFile();
      const text = await file.text();
      await useLogStore.getState().loadFromText(text, record.filename, { persist: false });
    } catch (err) {
      set({ state: 'error', message: (err as Error).message ?? 'Failed to read log' });
    }
  },
}));

/**
 * Initialize the store from any persisted folder handle. Called once at
 * module load — components don't need to invoke this themselves.
 */
async function init(): Promise<void> {
  if (!isSupported) return;
  const handle = await loadFolderHandle();
  if (!handle) return;
  const perm = await handle.queryPermission({ mode: 'read' });
  if (perm === 'granted') {
    try {
      const records = await listFolder(handle);
      useFolderStore.setState({ state: 'listing', handle, folderName: handle.name, records });
    } catch {
      useFolderStore.setState({ state: 'needs-permission', handle, folderName: handle.name });
    }
  } else if (perm === 'prompt') {
    useFolderStore.setState({ state: 'needs-permission', handle, folderName: handle.name });
  } else {
    // 'denied' — treat as no folder.
    await clearFolderHandle();
    useFolderStore.setState({ state: 'no-folder' });
  }
}
void init();
