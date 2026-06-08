import { useFolderStore } from '../state/folderStore';

/**
 * Sibling debug-log filename for a guide log: PHD2 writes them side by side and
 * the only difference is `GuideLog` → `DebugLog`
 * (PHD2_GuideLog_2026-05-10_005406.txt → PHD2_DebugLog_2026-05-10_005406.txt).
 */
export function debugLogNameFor(guideLogName: string): string {
  return guideLogName.replace(/GuideLog/i, 'DebugLog');
}

/**
 * Try to read the sibling debug log straight from the folder the guide log was
 * opened from (the logs-folder browser keeps a `FileSystemDirectoryHandle`).
 * Returns the `File` on success, or `null` when there's no folder handle, the
 * sibling isn't there, or read permission is refused — the caller then falls
 * back to prompting the user to pick the file.
 *
 * Must be called from within a user gesture (the chart double-click) so
 * `requestPermission` can prompt if the handle is in the 'prompt' state.
 */
export async function resolveDebugLogFile(guideLogName: string): Promise<File | null> {
  const st = useFolderStore.getState();
  const handle = st.state === 'listing' || st.state === 'needs-permission' ? st.handle : null;
  if (!handle) return null;
  try {
    let perm = await handle.queryPermission({ mode: 'read' });
    if (perm === 'prompt') perm = await handle.requestPermission({ mode: 'read' });
    if (perm !== 'granted') return null;
    const fh = await handle.getFileHandle(debugLogNameFor(guideLogName));
    return await fh.getFile();
  } catch {
    // NotFoundError (no sibling), permission, or any FS error → let the caller
    // prompt for a manual pick instead.
    return null;
  }
}
