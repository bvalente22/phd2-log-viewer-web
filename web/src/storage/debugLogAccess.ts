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

/**
 * Read a drop's files, capturing the File list SYNCHRONOUSLY. The browser
 * neuters the DataTransfer the instant the drop handler yields at an `await`, so
 * reading `e.dataTransfer.files` *after* awaiting the handle promises returns an
 * empty list — which silently dropped the pair. Capture the files first, then
 * collect the debug log's FileSystemFileHandle (Chromium) when offered.
 */
export async function readDroppedFiles(
  dataTransfer: DataTransfer,
): Promise<{ files: File[]; debugHandle: FileSystemFileHandle | null }> {
  const files = Array.from(dataTransfer.files); // capture NOW, before any await
  const handlePromises: Promise<FileSystemHandle | null>[] = [];
  const items = dataTransfer.items;
  if (items) {
    for (let i = 0; i < items.length; i++) {
      const it = items[i] as DataTransferItem & {
        getAsFileSystemHandle?: () => Promise<FileSystemHandle | null>;
      };
      if (it.kind === 'file' && it.getAsFileSystemHandle) handlePromises.push(it.getAsFileSystemHandle());
    }
  }
  let debugHandle: FileSystemFileHandle | null = null;
  try {
    const handles = await Promise.all(handlePromises);
    const dh = handles.find((h) => h && h.kind === 'file' && /DebugLog/i.test(h.name));
    if (dh) debugHandle = dh as FileSystemFileHandle;
  } catch {
    // handles are best-effort (Chromium only) — files still carry the data.
  }
  return { files, debugHandle };
}

const currentHash = (): string | null => useLogStore.getState().meta?.hash ?? null;

let grantedFolder: FileSystemDirectoryHandle | null = null;

/** Whether the browser exposes the File System Access file picker
 *  (`showOpenFilePicker`). When present, picking the debug log yields a durable
 *  handle we can persist; otherwise picks fall back to a one-shot `<input>` File
 *  that can only be stashed for the session. */
export const canPickFileHandle =
  typeof window !== 'undefined' && 'showOpenFilePicker' in window;

/**
 * Save the debug log so the CURRENT guide log can re-resolve it later WITHOUT
 * the user re-providing it: a session stash (instant reuse now) plus a
 * persisted `FileSystemFileHandle` keyed by the guide log's content hash, which
 * survives reloads so reopening the guide log from Recents still powers the
 * double-click-to-debug jump. No-op when no guide log is loaded. Persisting the
 * handle is Chromium-only and best-effort (a `File` from `<input>` has no handle
 * to store — see `stashDebugLogForCurrentLog` for that case).
 */
async function persistDebugLogForCurrentLog(
  handle: FileSystemFileHandle, file: File,
): Promise<void> {
  const hash = currentHash();
  if (!hash) return;
  setStashedDebugLog(hash, file);
  try {
    await putDebugLogHandle(hash, handle, file.name);
  } catch {
    // IDB unavailable / handle not structured-cloneable — the session stash
    // above still covers reuse for the rest of this session.
  }
}

/** Session-only association for a debug log we have as bytes but no handle for
 *  (a dropped / `<input>`-picked File). Lets other components in THIS session
 *  see it; nothing is persisted across reloads. */
export function stashDebugLogForCurrentLog(file: File): void {
  const hash = currentHash();
  if (hash) setStashedDebugLog(hash, file);
}

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
    const file = await fh.getFile();
    // Remember this exact file handle for the current guide log so the NEXT
    // session resolves it directly — no folder grant needed again.
    await persistDebugLogForCurrentLog(fh, file);
    return file;
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

/**
 * Pick the debug log via the File System Access API so we get a durable
 * `FileSystemFileHandle` (not just bytes). The handle is persisted by the
 * current guide log's content hash, so a LATER session — e.g. reopening the
 * guide log from Recents — can re-read the same debug file for the double-click
 * jump without re-picking it. Must run from a user gesture. Returns the File, or
 * null when the picker is unavailable or the user cancels.
 */
export async function pickDebugLogFileHandle(): Promise<File | null> {
  if (!canPickFileHandle) return null;
  let handle: FileSystemFileHandle;
  try {
    [handle] = await window.showOpenFilePicker({
      multiple: false,
      types: [{ description: 'PHD2 debug log', accept: { 'text/plain': ['.txt', '.log'] } }],
    });
  } catch {
    return null; // user cancelled the picker
  }
  const file = await handle.getFile();
  await persistDebugLogForCurrentLog(handle, file);
  return file;
}
