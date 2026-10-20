import { create } from 'zustand';
import i18n from '../i18n';
import { buildLogBundle, type BundleLog, type LogBundle } from '../storage/logBundle';
import { ZipError } from '../storage/zipReader';
import { hashLogText } from '../storage/annotations';
import { setStashedDebugLog, rememberDebugLogHandle } from '../storage/debugLogAccess';
import { useDebugPresenceStore } from './debugLogPresenceStore';
import { useLogStore } from './logStore';

/**
 * The set of guide logs from the last drop / pick — one zip (e.g. PHD2's
 * "Upload Log Files" bundle), several loose guide/debug pairs, or a mix.
 *
 * Opening the drop loads the NEWEST guide log; when there's more than one, the
 * sidebar lists them all (`BundleLogList`) so the user can switch nights
 * without re-dropping. Each log reaches Recents only when opened, via the
 * normal `loadFromText` path. The list lasts for the session (until the next
 * drop or a dismiss) — the zip itself isn't persisted, only the guide logs
 * that were opened (Recents) and, in Chromium, a link to each one's debug log.
 */
interface LogBundleState {
  bundle: LogBundle | null;
  /** Reading a zip / extracting a guide log. */
  busy: boolean;
  /** Bundle-level failure (unreadable zip, no guide log in it). */
  error: string | null;
  openFiles: (files: File[], handles: FileSystemFileHandle[]) => Promise<void>;
  openLog: (log: BundleLog) => Promise<void>;
  dismiss: () => void;
}

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(`sections:bundle.${key}`, opts);

const zipReason = (e: ZipError): string => {
  switch (e.code) {
    case 'encrypted': return t('reasonEncrypted');
    case 'unsupported-method': return t('reasonUnsupported');
    case 'no-decompression': return t('reasonNoDecompression');
    case 'not-zip': return t('reasonNotZip');
    default: return t('reasonCorrupt');
  }
};

export const useLogBundleStore = create<LogBundleState>((set, get) => ({
  bundle: null,
  busy: false,
  error: null,

  openFiles: async (files, handles) => {
    if (files.length === 0) return;
    const sourceName = files.length === 1 ? files[0].name : t('droppedFiles', { count: files.length });
    set({ busy: true, error: null });
    let bundle: LogBundle;
    try {
      bundle = await buildLogBundle(files, handles);
    } catch (e) {
      const reason = e instanceof ZipError ? zipReason(e) : String(e);
      set({ busy: false, error: t('zipError', { name: sourceName, reason }) });
      return;
    }
    if (bundle.logs.length === 0) {
      set({ busy: false, error: t('noGuideLog', { name: sourceName }) });
      return;
    }
    set({ bundle });
    await get().openLog(bundle.logs[0]);
  },

  openLog: async (log) => {
    set({ busy: true, error: null });
    let text: string;
    try {
      text = await (await log.guide.read()).text();
    } catch (e) {
      const reason = e instanceof ZipError ? zipReason(e) : String(e);
      set({ busy: false, error: t('zipError', { name: log.guide.name, reason }) });
      return;
    }
    set({ busy: false });
    await useLogStore.getState().loadFromText(text, log.guide.name);
    // Key the debug log by THIS text's hash and only if it actually loaded — a
    // failed parse leaves the previous log's meta in place, and the debug log
    // must not attach to that one.
    const hash = hashLogText(text);
    if (!log.debug || useLogStore.getState().meta?.hash !== hash) return;
    const { debug } = log;
    // Stash the loader, not the bytes: a zip entry is then only inflated if the
    // user double-clicks a sample or opens Backlash (a loose file's loader just
    // returns the File).
    setStashedDebugLog(hash, debug.read);
    if (debug.link) {
      try {
        await rememberDebugLogHandle(hash, debug.link.handle, debug.name, debug.link.entry);
      } catch {
        // Persisting is best-effort; the session stash above still works.
      }
    }
    void useDebugPresenceStore.getState().refresh(); // light up the "D" badge
  },

  dismiss: () => set({ bundle: null, error: null }),
}));
