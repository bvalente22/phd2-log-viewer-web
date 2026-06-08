import { useFolderStore } from '../state/folderStore';

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

// A debug log the user handed over alongside the guide log — e.g. dragged BOTH
// files onto the open-log drop zone at once. Keyed by guide-log name and checked
// first, so double-click opens it with no folder access or pick prompt needed.
const stashedDebugLogs = new Map<string, File>();

/** Remember a debug log provided with a guide log (drag-both / multi-pick). */
export function setStashedDebugLog(guideLogName: string, file: File): void {
  stashedDebugLogs.set(guideLogName, file);
}

// A folder the user granted specifically for finding debug logs. The browser
// can't see the parent folder of a file opened via drag / file-pick, so when
// the logs-folder browser wasn't used we let the user point us at the folder
// once and remember it for the session (later double-clicks auto-find).
let grantedFolder: FileSystemDirectoryHandle | null = null;

async function fileFromHandle(
  handle: FileSystemDirectoryHandle, guideLogName: string,
): Promise<File | null> {
  try {
    let perm = await handle.queryPermission({ mode: 'read' });
    if (perm === 'prompt') perm = await handle.requestPermission({ mode: 'read' });
    if (perm !== 'granted') return null;
    const fh = await handle.getFileHandle(debugLogNameFor(guideLogName));
    return await fh.getFile();
  } catch {
    // NotFoundError (no sibling) / permission / any FS error.
    return null;
  }
}

/**
 * Try to read the sibling debug log from a folder the app already has access to:
 * the logs-folder browser's directory handle, or a folder the user granted
 * earlier for debug logs. Returns null when neither has it (the caller then
 * offers the manual grant / pick).
 */
export async function resolveDebugLogFile(guideLogName: string): Promise<File | null> {
  // 1) A debug log the user dragged in alongside the guide log — no folder
  //    access needed, so this is the most reliable path.
  const stashed = stashedDebugLogs.get(guideLogName);
  if (stashed) return stashed;
  // 2) A folder the app already has access to: the logs-folder browser's
  //    directory handle, or a folder the user granted earlier for debug logs.
  const st = useFolderStore.getState();
  const folderHandle = st.state === 'listing' || st.state === 'needs-permission' ? st.handle : null;
  for (const h of [folderHandle, grantedFolder]) {
    if (!h) continue;
    const f = await fileFromHandle(h, guideLogName);
    if (f) return f;
  }
  return null;
}

/**
 * Prompt the user to pick the folder that holds the guide + debug logs, then
 * find the sibling debug log in it and remember the folder for the session.
 * Must run from a user gesture. Returns the File, or null if cancelled or the
 * sibling isn't in the chosen folder.
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
  return fileFromHandle(handle, guideLogName);
}
