import { get, set, del } from 'idb-keyval';

/**
 * IndexedDB-backed persistence of the user's chosen logs-folder handle.
 *
 * `FileSystemDirectoryHandle` is structured-cloneable, so idb-keyval can
 * serialize it without help. Permission state isn't persisted with the
 * handle — the browser re-prompts each session via `requestPermission`
 * (folderStore handles that).
 */

const KEY = 'phd-folder-handle';

export async function saveFolderHandle(h: FileSystemDirectoryHandle): Promise<void> {
  await set(KEY, h);
}

export async function loadFolderHandle(): Promise<FileSystemDirectoryHandle | undefined> {
  return get<FileSystemDirectoryHandle>(KEY);
}

export async function clearFolderHandle(): Promise<void> {
  await del(KEY);
}
