import { useFolderStore } from '../state/folderStore';
import { useLogStore } from '../state/logStore';
import { getDebugLogHandle, putDebugLogHandle } from './debugLogHandles';

/**
 * Sibling debug-log filename for a guide log: PHD2 writes them side by side and
 * the only difference is `GuideLog` → `DebugLog`
 * (PHD2_GuideLog_2026-05-10_005406.txt → PHD2_DebugLog_2026-05-10_005406.txt).
 */
export function debugLogNameFor(guideLogName: string): string {
  return guideLogName.replace(/GuideLog/i, 'DebugLog');
}

/** Whether the browser can prompt for a folder (File System Access API). */
export const canGrantFolder = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

// Session stash of the debug log dragged in with the guide log, keyed by the
// guide log's content hash (matches the persisted handle + the annotations /
// primary-period sidecars).
const stashedDebugLogs = new Map<string, File>();

/** Remember (for this session) the debug log dragged in with the guide log. */
export function setStashedDebugLog(hash: string, file: File): void {
  stashedDebugLogs.set(hash, file);
}

/** Guide-log hashes whose debug log is stashed in memory this session. */
export function getStashedDebugLogHashes(): string[] {
  return [...stashedDebugLogs.keys()];
}

/**
 * Persist a HANDLE (link, not bytes) to the dragged debug log so a later session
 * can re-read it. Chromium-only — `getAsFileSystemHandle` yields the handle from
 * a drop; elsewhere there's nothing to persist and the stash stays session-only.
 */
export async function rememberDebugLogHandle(
  hash: string, handle: FileSystemFileHandle, fileName: string,
): Promise<void> {
  await putDebugLogHandle(hash, handle, fileName);
}

const currentHash = (): string | null => useLogStore.getState().meta?.hash ?? null;

let grantedFolder: FileSystemDirectoryHandle | null = null;

/** Ensure read permission on a handle, prompting if needed (needs a gesture). */
async function ensureRead(h: FileSystemHandle): Promise<boolean> {
  let perm = await h.queryPermission({ mode: 'read' });
  if (perm === 'prompt') perm = await h.requestPermission({ mode: 'read' });
  return perm === 'granted';
}

async function fileFromDirHandle(
  handle: FileSystemDirectoryHandle, guideLogName: string,
): Promise<File | null> {
  try {
    if (!(await ensureRead(handle))) return null;
    const fh = await handle.getFileHandle(debugLogNameFor(guideLogName));
    return await fh.getFile();
  } catch {
    return null; // NotFoundError / permission / FS error
  }
}

async function fileFromStoredHandle(hash: string): Promise<File | null> {
  try {
    const rec = await getDebugLogHandle(hash);
    if (!rec) return null;
    if (!(await ensureRead(rec.handle))) return null;
    return await rec.handle.getFile();
  } catch {
    return null; // permission denied, file moved/deleted, etc.
  }
}

/**
 * Resolve the sibling debug log from a source the app already has: this
 * session's dragged-in stash, a persisted handle from a previous session, or a
 * folder the app has access to. Returns null when none has it (the caller then
 * offers the manual grant / pick). Must run from a user gesture (the double-
 * click / Backlash-open) so the permission prompt is allowed.
 */
export async function resolveDebugLogFile(guideLogName: string): Promise<File | null> {
  const hash = currentHash();
  if (hash) {
    const stashed = stashedDebugLogs.get(hash);
    if (stashed) return stashed;
    const fromHandle = await fileFromStoredHandle(hash);
    if (fromHandle) return fromHandle;
  }
  const st = useFolderStore.getState();
  const folderHandle = st.state === 'listing' || st.state === 'needs-permission' ? st.handle : null;
  for (const h of [folderHandle, grantedFolder]) {
    if (!h) continue;
    const f = await fileFromDirHandle(h, guideLogName);
    if (f) return f;
  }
  return null;
}

/**
 * Prompt the user to pick the folder that holds the guide + debug logs, find the
 * sibling debug log in it, and remember the folder for the session. Must run
 * from a user gesture. Returns the File, or null if cancelled / not in folder.
 */
export async function grantDebugFolderAndResolve(guideLogName: string): Promise<File | null> {
  if (!canGrantFolder) return null;
  let handle: FileSystemDirectoryHandle;
  try {
    handle = await window.showDirectoryPicker({ mode: 'read' });
  } catch {
    return null; // user cancelled the picker
  }
  grantedFolder = handle;
  return fileFromDirHandle(handle, guideLogName);
}
