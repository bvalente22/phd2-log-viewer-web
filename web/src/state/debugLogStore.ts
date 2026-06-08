import { create } from 'zustand';
import { validateDebugLogHeader } from '../parser/parseBlt';
import {
  parseDebugTimes, findClosestTimeIndex, toWallClockMs, dayAnchorMs,
} from '../parser/debugTimestamps';
import { resolveDebugLogFile } from '../storage/debugLogAccess';
import {
  debugTabUrl, openLoadingTab, showMessageInTab,
} from '../components/debugLogTab';

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
  /** The rendered log opens in a NEW TAB; the in-app modal is only the pick /
   *  error dialog, so the store is either idle or showing an error. */
  status: 'idle' | 'error';
  errorKey: DebugErrorKey | null;
  /** Error states a manual file pick can recover from show a pick button. */
  canPick: boolean;
  /** Pending args kept so a manual pick can complete the original request. */
  pending: DebugOpenArgs | null;
}

interface DebugLogActions {
  openForSample: (args: DebugOpenArgs) => Promise<void>;
  pickFile: (file: File) => Promise<void>;
  dismiss: () => void;
}

// Per-session cache of parsed debug logs keyed by guide-log name — a debug log
// can be tens of MB, so we read/parse it once and reuse for later double-clicks.
const cache = new Map<string, { fileName: string; lines: string[]; times: Float64Array }>();

// The browser tab opened for the current request. Opened synchronously inside
// the double-click gesture (popup-safe), then navigated to the rendered page
// once the log is resolved. Kept across the (in-app) pick so we can fill the
// same tab the user is already looking at.
let tabRef: Window | null = null;

const IDLE: DebugLogState = { status: 'idle', errorKey: null, canPick: false, pending: null };

export const useDebugLogStore = create<DebugLogState & DebugLogActions>((set, get) => ({
  ...IDLE,

  openForSample: async (args) => {
    if (args.startsMs === null) {
      set({ ...IDLE, status: 'error', errorKey: 'noTimestamp' });
      return;
    }
    // Open the tab NOW, synchronously, while we still have the click's user
    // activation — otherwise the later window.open (after async file I/O) would
    // be popup-blocked.
    tabRef = openLoadingTab();
    if (!tabRef) {
      set({ ...IDLE, status: 'error', errorKey: 'popupBlocked' });
      return;
    }
    set({ ...IDLE, pending: args });
    const targetMs = toWallClockMs(args.targetEpochMs);

    const cached = cache.get(args.guideLogName);
    if (cached) {
      fillTab(cached, targetMs);
      set({ ...IDLE });
      return;
    }

    const file = await resolveDebugLogFile(args.guideLogName);
    if (get().pending !== args) return; // superseded by a newer request
    if (!file) {
      if (tabRef && !tabRef.closed) {
        showMessageInTab(tabRef, "Couldn't find the debug log automatically — pick it in the app window.");
      }
      set({ status: 'error', errorKey: 'notFound', canPick: true });
      return;
    }
    await loadAndFill(set, get, args, file, targetMs);
  },

  pickFile: async (file) => {
    const args = get().pending;
    if (!args || args.startsMs === null) return;
    // Reuse the tab from the double-click; reopen only if the user closed it.
    if (!tabRef || tabRef.closed) tabRef = openLoadingTab();
    else showMessageInTab(tabRef, 'Loading debug log…');
    const targetMs = toWallClockMs(args.targetEpochMs);
    set({ status: 'idle' });
    await loadAndFill(set, get, args, file, targetMs);
  },

  dismiss: () => set({ ...IDLE }),
}));

type SetFn = (partial: Partial<DebugLogState>) => void;
type GetFn = () => DebugLogState & DebugLogActions;

async function loadAndFill(
  set: SetFn, get: GetFn, args: DebugOpenArgs, file: File, targetMs: number,
): Promise<void> {
  const text = await file.text();
  if (get().pending !== args) return;
  const lines = text.split(/\r?\n/);
  if (validateDebugLogHeader(lines[0] ?? '') !== null) {
    if (tabRef && !tabRef.closed) showMessageInTab(tabRef, 'That file is not a PHD2 debug log.');
    set({ status: 'error', errorKey: 'notDebugLog', canPick: true });
    return;
  }
  if (lines.length === 0) {
    set({ status: 'error', errorKey: 'empty', canPick: true });
    return;
  }
  const times = parseDebugTimes(lines, dayAnchorMs(args.startsMs as number));
  const parsed = { fileName: file.name, lines, times };
  cache.set(args.guideLogName, parsed);
  fillTab(parsed, targetMs);
  set({ ...IDLE });
}

function fillTab(
  parsed: { fileName: string; lines: string[]; times: Float64Array },
  targetMs: number,
): void {
  const idx = findClosestTimeIndex(parsed.times, targetMs);
  const url = debugTabUrl({
    fileName: parsed.fileName,
    lines: parsed.lines,
    matchedIndex: idx,
    targetMs,
    matchedMs: parsed.times[idx] ?? targetMs,
  });
  // The tab has only ever been written via innerHTML (about:blank), so this is
  // its FIRST real navigation — which a popup honours (a re-navigation of an
  // already-committed blob document would be silently ignored).
  if (!tabRef || tabRef.closed) tabRef = window.open(url, '_blank');
  else {
    try { tabRef.location.href = url; }
    catch { tabRef = window.open(url, '_blank'); }
  }
}
