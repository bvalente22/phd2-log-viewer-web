import { create } from 'zustand';
import { validateDebugLogHeader } from '../parser/parseBlt';
import {
  parseDebugTimes, findClosestTimeIndex, toWallClockMs,
  debugLogAnchorMs, firstTimestampMsOfDay,
} from '../parser/debugTimestamps';
import {
  resolveDebugLogFile, grantDebugFolderAndResolve,
  pickDebugLogFileHandle, stashDebugLogForCurrentLog,
} from '../storage/debugLogAccess';
import { openDebugTab, setDebugTabSlot } from '../components/debugLogTab';

/** Args identifying the clicked sample + its session anchor. */
export interface DebugOpenArgs {
  guideLogName: string;
  /** Session start epoch ms (GARun.starts). Null → no timestamp → can't match. */
  startsMs: number | null;
  /** Clicked sample's absolute epoch ms = startsMs + dt*1000. */
  targetEpochMs: number;
}

export type DebugErrorKey = 'notFound' | 'notDebugLog' | 'noTimestamp' | 'empty' | 'popupBlocked';

interface DebugLogState {
  /** The rendered log lives in a NEW TAB; this in-app modal is only the
   *  grant-folder / pick / error dialog, so the store is idle or showing error. */
  status: 'idle' | 'error';
  errorKey: DebugErrorKey | null;
  /** Error states a manual grant/pick can recover from show those affordances. */
  canPick: boolean;
  /** Pending args kept so a grant/pick can complete the original request. */
  pending: DebugOpenArgs | null;
}

interface DebugLogActions {
  openForSample: (args: DebugOpenArgs) => Promise<void>;
  /** User picked the debug file (file input or drop) — a one-shot File with no
   *  durable handle; stashed for the session only. */
  pickFile: (file: File) => Promise<void>;
  /** User picked the debug file via the File System Access API — yields a
   *  durable handle persisted by guide-log hash, so the association survives
   *  reloads. Preferred over `pickFile` when the browser supports it. */
  pickViaHandle: () => Promise<void>;
  /** User asked to grant the folder so we can auto-find the sibling. */
  grantFolder: () => Promise<void>;
  dismiss: () => void;
}

// Per-session cache of parsed debug logs keyed by guide-log name — a debug log
// can be tens of MB, so we read/parse it once and reuse for later double-clicks.
const cache = new Map<string, { fileName: string; lines: string[]; times: Float64Array }>();

// The data-slot key of the currently-open debug tab. The tab polls its slot,
// so we update the slot (not the Window) — no tab reference needed.
let currentKey: string | null = null;

const IDLE: DebugLogState = { status: 'idle', errorKey: null, canPick: false, pending: null };

export const useDebugLogStore = create<DebugLogState & DebugLogActions>((set, get) => ({
  ...IDLE,

  openForSample: async (args) => {
    if (args.startsMs === null) {
      set({ ...IDLE, status: 'error', errorKey: 'noTimestamp' });
      return;
    }
    // Open the tab NOW (in the click gesture, popup-safe) directly to the
    // static viewer page; it shows "Loading…" and polls for the data below.
    const opened = openDebugTab();
    if (!opened.tab) {
      set({ ...IDLE, status: 'error', errorKey: 'popupBlocked' });
      return;
    }
    currentKey = opened.key;
    set({ ...IDLE, pending: args });
    const targetMs = toWallClockMs(args.targetEpochMs);

    const cached = cache.get(args.guideLogName);
    if (cached) {
      ready(opened.key, cached, targetMs);
      return;
    }

    const file = await resolveDebugLogFile(args.guideLogName);
    if (get().pending !== args) return; // superseded by a newer request
    if (!file) {
      setDebugTabSlot(opened.key, { state: 'needPick' });
      set({ status: 'error', errorKey: 'notFound', canPick: true });
      return;
    }
    await loadAndFill(set, get, args, file, targetMs, opened.key);
  },

  pickFile: async (file) => {
    const args = get().pending;
    if (!args || args.startsMs === null || !currentKey) return;
    // No durable handle from an <input>/drop File — stash it for the session so
    // other components (and repeat double-clicks) reuse it without re-picking.
    stashDebugLogForCurrentLog(file);
    const targetMs = toWallClockMs(args.targetEpochMs);
    set({ status: 'idle' });
    await loadAndFill(set, get, args, file, targetMs, currentKey);
  },

  pickViaHandle: async () => {
    const args = get().pending;
    if (!args || args.startsMs === null || !currentKey) return;
    // The picker (and the handle persistence it does) runs in the click gesture.
    const file = await pickDebugLogFileHandle();
    if (!file) return; // unavailable or cancelled — leave the dialog open
    if (get().pending !== args) return; // superseded by a newer request
    const targetMs = toWallClockMs(args.targetEpochMs);
    set({ status: 'idle' });
    await loadAndFill(set, get, args, file, targetMs, currentKey);
  },

  grantFolder: async () => {
    const args = get().pending;
    if (!args || args.startsMs === null || !currentKey) return;
    const file = await grantDebugFolderAndResolve(args.guideLogName);
    if (get().pending !== args) return;
    if (!file) {
      // Cancelled, or the sibling isn't in the chosen folder — stay on the
      // dialog so the user can retry, pick the file, or drag it in.
      set({ status: 'error', errorKey: 'notFound', canPick: true });
      return;
    }
    const targetMs = toWallClockMs(args.targetEpochMs);
    set({ status: 'idle' });
    await loadAndFill(set, get, args, file, targetMs, currentKey);
  },

  dismiss: () => set({ ...IDLE }),
}));

type SetFn = (partial: Partial<DebugLogState>) => void;
type GetFn = () => DebugLogState & DebugLogActions;

async function loadAndFill(
  set: SetFn, get: GetFn, args: DebugOpenArgs, file: File, targetMs: number, key: string,
): Promise<void> {
  const text = await file.text();
  if (get().pending !== args) return;
  const lines = text.split(/\r?\n/);
  if (validateDebugLogHeader(lines[0] ?? '') !== null) {
    setDebugTabSlot(key, { state: 'error', message: 'That file is not a PHD2 debug log.' });
    set({ status: 'error', errorKey: 'notDebugLog', canPick: true });
    return;
  }
  if (lines.length === 0) {
    setDebugTabSlot(key, { state: 'error', message: 'The debug log is empty.' });
    set({ status: 'error', errorKey: 'empty', canPick: true });
    return;
  }
  // Anchor the log's timeline so it brackets the session even when the log
  // started the previous evening and the session is after midnight.
  const anchor = debugLogAnchorMs(args.startsMs as number, firstTimestampMsOfDay(lines));
  const times = parseDebugTimes(lines, anchor);
  const parsed = { fileName: file.name, lines, times };
  cache.set(args.guideLogName, parsed);
  ready(key, parsed, targetMs);
  set({ ...IDLE });
}

/** Hand the matched, parsed log to the open tab's data slot. */
function ready(
  key: string,
  parsed: { fileName: string; lines: string[]; times: Float64Array },
  targetMs: number,
): void {
  const idx = findClosestTimeIndex(parsed.times, targetMs);
  setDebugTabSlot(key, {
    state: 'ready',
    fileName: parsed.fileName,
    lines: parsed.lines,
    matchedIndex: idx,
    targetMs,
    matchedMs: parsed.times[idx] ?? targetMs,
  });
}
