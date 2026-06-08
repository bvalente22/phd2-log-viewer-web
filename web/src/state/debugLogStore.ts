import { create } from 'zustand';
import { validateDebugLogHeader } from '../parser/parseBlt';
import {
  parseDebugTimes, findClosestTimeIndex, toWallClockMs, dayAnchorMs,
} from '../parser/debugTimestamps';
import { resolveDebugLogFile } from '../storage/debugLogAccess';

/** Args identifying the clicked sample + its session anchor. */
export interface DebugOpenArgs {
  guideLogName: string;
  /** Session start epoch ms (GARun.starts). Null when the log has no parseable
   *  timestamp — matching is impossible, so we surface an error. */
  startsMs: number | null;
  /** Clicked sample's absolute epoch ms = startsMs + dt*1000. */
  targetEpochMs: number;
}

export type DebugErrorKey = 'notFound' | 'notDebugLog' | 'noTimestamp' | 'empty';

interface DebugLogState {
  status: 'closed' | 'loading' | 'open' | 'error';
  fileName: string | null;
  lines: string[];
  matchedIndex: number;
  /** Wall-clock ms of the clicked sample and of the matched line (for the header). */
  targetMs: number;
  matchedMs: number;
  errorKey: DebugErrorKey | null;
  /** Error states that a manual file pick can recover from show a pick button. */
  canPick: boolean;
  /** Pending args kept so a manual pick can complete the original request. */
  pending: DebugOpenArgs | null;
}

interface DebugLogActions {
  openForSample: (args: DebugOpenArgs) => Promise<void>;
  pickFile: (file: File) => Promise<void>;
  close: () => void;
}

// Per-session cache of parsed debug logs keyed by guide-log name — a debug log
// can be tens of MB, so we read/parse it once and reuse for later double-clicks.
const cache = new Map<string, { fileName: string; lines: string[]; times: Float64Array }>();

const CLOSED: DebugLogState = {
  status: 'closed', fileName: null, lines: [], matchedIndex: 0,
  targetMs: 0, matchedMs: 0, errorKey: null, canPick: false, pending: null,
};

export const useDebugLogStore = create<DebugLogState & DebugLogActions>((set, get) => ({
  ...CLOSED,

  openForSample: async (args) => {
    if (args.startsMs === null) {
      set({ ...CLOSED, status: 'error', errorKey: 'noTimestamp', canPick: false });
      return;
    }
    const targetMs = toWallClockMs(args.targetEpochMs);
    set({ ...CLOSED, status: 'loading', targetMs, pending: args });

    const cached = cache.get(args.guideLogName);
    if (cached) {
      openMatched(set, cached, targetMs);
      return;
    }
    // Try the folder handle first (must stay within the double-click gesture).
    const file = await resolveDebugLogFile(args.guideLogName);
    if (get().pending !== args) return; // superseded by a newer open/close
    if (!file) {
      set({ status: 'error', errorKey: 'notFound', canPick: true });
      return;
    }
    await loadAndOpen(set, get, args, file, targetMs);
  },

  pickFile: async (file) => {
    const args = get().pending;
    if (!args || args.startsMs === null) return;
    const targetMs = toWallClockMs(args.targetEpochMs);
    set({ status: 'loading', targetMs });
    await loadAndOpen(set, get, args, file, targetMs);
  },

  close: () => set({ ...CLOSED }),
}));

type SetFn = (partial: Partial<DebugLogState>) => void;
type GetFn = () => DebugLogState & DebugLogActions;

async function loadAndOpen(
  set: SetFn, get: GetFn, args: DebugOpenArgs, file: File, targetMs: number,
): Promise<void> {
  const text = await file.text();
  if (get().pending !== args) return;
  const lines = text.split(/\r?\n/);
  if (validateDebugLogHeader(lines[0] ?? '') !== null) {
    set({ status: 'error', errorKey: 'notDebugLog', canPick: true });
    return;
  }
  if (lines.length === 0) {
    set({ status: 'error', errorKey: 'empty', canPick: true });
    return;
  }
  const times = parseDebugTimes(lines, dayAnchorMs(args.startsMs as number));
  cache.set(args.guideLogName, { fileName: file.name, lines, times });
  openMatched(set, { fileName: file.name, lines, times }, targetMs);
}

function openMatched(
  set: SetFn,
  parsed: { fileName: string; lines: string[]; times: Float64Array },
  targetMs: number,
): void {
  const idx = findClosestTimeIndex(parsed.times, targetMs);
  set({
    status: 'open',
    fileName: parsed.fileName,
    lines: parsed.lines,
    matchedIndex: idx,
    targetMs,
    matchedMs: parsed.times[idx] ?? targetMs,
    errorKey: null,
    canPick: false,
  });
}
