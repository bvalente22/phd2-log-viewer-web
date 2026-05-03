# Logs Folder Browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a sidebar pane (and an empty-state button) that lets the user pick their PHD2 logs folder once, then browse every guide log in it sorted by parsed date+time, with the folder handle persisting across browser sessions.

**Architecture:** Pure-TS filename parser in `parser/filename.ts` (date+time + GuideLog filter). Zustand `folderStore` owns the `FileSystemDirectoryHandle` and the listing. `idb-keyval` persists the handle as a single value. `LogsFolderPane` renders the four states (unsupported / no-folder / needs-permission / listing) and dispatches store actions. The empty-state drop-zone screen gains a "Choose logs folder…" button beside the existing drop zone.

**Tech Stack:** TypeScript, React 18, Zustand, idb-keyval, File System Access API. Vitest for unit tests.

**Spec:** [docs/superpowers/specs/2026-05-02-phd2-logs-folder-browser-design.md](../specs/2026-05-02-phd2-logs-folder-browser-design.md)

---

## File Structure

```
web/
  src/
    parser/
      filename.ts                 # Task 1
      __tests__/
        filename.test.ts          # Task 1
    storage/
      folderHandle.ts             # Task 2
    state/
      folderStore.ts              # Task 3
    components/
      LogsFolderPane.tsx          # Task 4
      DropZone.tsx                # Task 5 (modify)
    pages/
      ViewerPage.tsx              # Task 5 (modify, mount the pane)
  e2e/
    folder.spec.ts                # Task 6
```

Note for the implementer: the project's commit hooks have an established subagent-shell-isolation quirk where `git commit` inside a subagent sometimes doesn't propagate to the parent shell. **Do NOT run `git commit`** — leave changes in the working tree and the orchestrator will commit on its side. You SHOULD run `git status`, `npm test`, `npm run typecheck`, `npm run e2e` etc. for verification.

Working directory throughout: `z:\HomeLab-Repos\PHDLogViewer\web`. Use `cd web` from `z:\HomeLab-Repos\PHDLogViewer` for npm and git commands.

---

### Task 1: Filename parser (`filename.ts`)

**Files:**
- Create: `web/src/parser/filename.ts`
- Test: `web/src/parser/__tests__/filename.test.ts`

The parser is the only piece of "domain logic" in this feature — given a filename string, it tells the caller whether it's a guide log and what date/time it represents. Pure TS, no DOM or file APIs.

- [ ] **Step 1: Write the failing tests**

```ts
// web/src/parser/__tests__/filename.test.ts
import { describe, it, expect } from 'vitest';
import { parseLogFilename } from '../filename';

describe('parseLogFilename', () => {
  it('parses a standard PHD2 guide-log filename', () => {
    const out = parseLogFilename('PHD2_GuideLog_2026-03-30_161541.txt');
    expect(out).not.toBeNull();
    expect(out!.isGuideLog).toBe(true);
    const d = new Date(out!.dateMs!);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(2); // March is index 2
    expect(d.getDate()).toBe(30);
    expect(d.getHours()).toBe(16);
    expect(d.getMinutes()).toBe(15);
    expect(out!.dateLabel).toBe('2026-03-30 · 16:15');
  });

  it('matches lowercase "guidelog" too', () => {
    const out = parseLogFilename('phd2_guidelog_2024-01-01_010101.log');
    expect(out).not.toBeNull();
    expect(out!.isGuideLog).toBe(true);
    expect(out!.dateLabel).toBe('2024-01-01 · 01:01');
  });

  it('returns null for filenames that do not contain "guidelog"', () => {
    expect(parseLogFilename('PHD2_DebugLog_2026-03-30_161541.txt')).toBeNull();
    expect(parseLogFilename('readme.md')).toBeNull();
    expect(parseLogFilename('PHD2_DebugLog_2026.txt')).toBeNull();
  });

  it('falls back to filename label when date pattern is missing', () => {
    const out = parseLogFilename('PHD2_GuideLog_renamed.txt');
    expect(out).not.toBeNull();
    expect(out!.isGuideLog).toBe(true);
    expect(out!.dateMs).toBeNull();
    expect(out!.dateLabel).toBe('PHD2_GuideLog_renamed.txt');
  });

  it('returns null when guidelog substring missing even with a date', () => {
    expect(parseLogFilename('Notes_2026-03-30_161541.txt')).toBeNull();
  });

  it('uses the first date+time match if there are several', () => {
    const out = parseLogFilename(
      'PHD2_GuideLog_2026-03-30_161541_then_2026-04-01_120000.txt',
    );
    expect(out!.dateLabel).toBe('2026-03-30 · 16:15');
  });

  it('treats a date without an HHMMSS suffix as unparseable', () => {
    const out = parseLogFilename('PHD2_GuideLog_2026-03-30.txt');
    expect(out).not.toBeNull();
    expect(out!.isGuideLog).toBe(true);
    expect(out!.dateMs).toBeNull();
    expect(out!.dateLabel).toBe('PHD2_GuideLog_2026-03-30.txt');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```
cd web && npm test -- filename
```

Expected: FAIL — module `../filename` not found.

- [ ] **Step 3: Implement `web/src/parser/filename.ts`**

```ts
/**
 * Lightweight metadata extractor for PHD2 log filenames.
 *
 * The standard format is `PHD2_GuideLog_YYYY-MM-DD_HHMMSS.{txt,log}` with
 * the timestamp written in local clock time by PHD2 (no timezone info in
 * the name itself, so we parse to local-time epoch ms — same convention
 * used elsewhere in the parser layer).
 *
 * Used by the logs-folder browser (`LogsFolderPane.tsx`) to present logs
 * by date instead of filename and to filter `DebugLog`/other non-guide
 * files out of the listing.
 */
export interface ParsedLogName {
  /** Case-insensitive: filename contains "guidelog". */
  isGuideLog: boolean;
  /** Local-time epoch ms parsed from YYYY-MM-DD_HHMMSS, or null. */
  dateMs: number | null;
  /** "2026-03-30 · 16:15" when parseable, otherwise the raw filename. */
  dateLabel: string;
}

const TIMESTAMP_RE = /(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(\d{2})/;

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Returns parsed metadata, or null if the filename does not contain
 * "guidelog" (case-insensitive).
 */
export function parseLogFilename(name: string): ParsedLogName | null {
  if (!/guidelog/i.test(name)) return null;
  const m = name.match(TIMESTAMP_RE);
  if (!m) {
    return { isGuideLog: true, dateMs: null, dateLabel: name };
  }
  const [, y, mo, d, h, mi, s] = m;
  const dateMs = new Date(+y, +mo - 1, +d, +h, +mi, +s).getTime();
  if (!Number.isFinite(dateMs)) {
    return { isGuideLog: true, dateMs: null, dateLabel: name };
  }
  const label = `${y}-${mo}-${d} · ${pad(+h)}:${pad(+mi)}`;
  return { isGuideLog: true, dateMs, dateLabel: label };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```
cd web && npm test -- filename
```

Expected: PASS — 7 tests.

- [ ] **Step 5: Typecheck**

```
cd web && npm run typecheck
```

Expected: clean.

- [ ] **Step 6: Report back to orchestrator** (do NOT commit)

Mention in your report: files created, test count + pass result, typecheck result.

---

### Task 2: IndexedDB persistence (`folderHandle.ts`)

**Files:**
- Create: `web/src/storage/folderHandle.ts`
- Test: none — `idb-keyval` and `FileSystemDirectoryHandle` are not testable under jsdom.

Three thin wrapper functions over `idb-keyval` for the saved folder handle.

- [ ] **Step 1: Implement `web/src/storage/folderHandle.ts`**

```ts
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
```

- [ ] **Step 2: Typecheck**

```
cd web && npm run typecheck
```

Expected: clean. The TypeScript DOM lib already declares `FileSystemDirectoryHandle` globally — no `@types/wicg-file-system-access` package needed.

If typecheck fails because `FileSystemDirectoryHandle` is unknown, the project's `tsconfig.json` `lib` likely lacks `"DOM"`. Inspect the file to confirm it's there before adding a polyfill — see existing `tsconfig.json`. Do not add `@types/wicg-file-system-access` unless the type genuinely isn't available.

- [ ] **Step 3: Report back** (no commit)

---

### Task 3: Folder store (`folderStore.ts`)

**Files:**
- Create: `web/src/state/folderStore.ts`

A zustand store with a discriminated-union state machine. No tests — same reasoning as Task 2, the FS API isn't usable in jsdom.

- [ ] **Step 1: Implement `web/src/state/folderStore.ts`**

```ts
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
    set({ state: isSupported ? 'no-folder' : 'unsupported' });
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
```

- [ ] **Step 2: Typecheck**

```
cd web && npm run typecheck
```

Expected: clean.

- [ ] **Step 3: Report back** (no commit)

---

### Task 4: Sidebar pane (`LogsFolderPane.tsx`)

**Files:**
- Create: `web/src/components/LogsFolderPane.tsx`

Renders the four visible states (unsupported / no-folder / needs-permission / listing). Same collapsible-header pattern as `RecentsDropdown`. No tests — its behavior is exercised through the e2e suite.

- [ ] **Step 1: Implement `web/src/components/LogsFolderPane.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react';
import { useFolderStore } from '../state/folderStore';
import { useLogStore } from '../state/logStore';

/**
 * Sidebar pane that lists every PHD2 guide log inside the user's chosen
 * folder, sorted newest-first by parsed date+time. Persistent — folder
 * handle survives reloads via IndexedDB; user re-grants permission once
 * per session via the "Reconnect" button.
 *
 * Visible states match folderStore's state machine:
 *   - unsupported     → show the explanatory stub (Firefox / Safari)
 *   - no-folder       → "Choose folder" button
 *   - needs-permission → "Reconnect" button
 *   - listing         → header chips + scrollable list of rows
 */
export function LogsFolderPane() {
  const folder = useFolderStore();
  const currentName = useLogStore((s) => s.meta?.name);
  const [open, setOpen] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Close the overflow menu when clicking outside it.
  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [menuOpen]);

  const folderName =
    folder.state === 'needs-permission' || folder.state === 'listing'
      ? folder.folderName
      : null;
  const recordCount = folder.state === 'listing' ? folder.records.length : null;

  return (
    <div className="border-b border-slate-800">
      <button
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs uppercase tracking-wide text-slate-400 hover:bg-slate-800"
        onClick={() => setOpen((v) => !v)}
        title={open ? 'Hide the logs-folder pane' : 'Show the logs-folder pane'}
      >
        <span className="flex-1 truncate">
          Logs folder
          {folderName && <span className="ml-1 text-slate-300">· {folderName}</span>}
          {recordCount !== null && <span className="ml-1 text-slate-500">· {recordCount} logs</span>}
        </span>
        {folder.state === 'listing' && (
          <span className="flex items-center gap-1">
            <span
              role="button"
              tabIndex={0}
              className="rounded px-1 text-slate-500 hover:bg-slate-700 hover:text-slate-200"
              title="Refresh the listing"
              onClick={(e) => { e.stopPropagation(); void folder.refresh(); }}
              onKeyDown={(e) => { if (e.key === 'Enter') void folder.refresh(); }}
            >↻</span>
            <span
              ref={menuRef}
              role="button"
              tabIndex={0}
              className="relative rounded px-1 text-slate-500 hover:bg-slate-700 hover:text-slate-200"
              title="Folder menu"
              onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
            >
              ⋯
              {menuOpen && (
                <div
                  className="absolute right-0 top-full z-30 mt-1 w-44 rounded border border-slate-700 bg-slate-900 shadow-lg"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    className="block w-full px-3 py-2 text-left text-xs text-slate-200 hover:bg-slate-800"
                    onClick={() => { setMenuOpen(false); void folder.pickFolder(); }}
                    title="Pick a different folder; replaces the current one"
                  >
                    Change folder…
                  </button>
                  <button
                    className="block w-full px-3 py-2 text-left text-xs text-slate-400 hover:bg-slate-800 hover:text-red-400"
                    onClick={() => { setMenuOpen(false); void folder.forgetFolder(); }}
                    title="Clear the saved folder handle from this browser"
                  >
                    Forget folder
                  </button>
                </div>
              )}
            </span>
          </span>
        )}
        <span className="text-slate-500">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div>
          {folder.state === 'unsupported' && (
            <div className="px-3 py-3 text-xs text-slate-400">
              Folder browsing requires a Chromium-based browser (Chrome or Edge).
              Drag a log onto the drop zone to load one.
            </div>
          )}
          {folder.state === 'no-folder' && (
            <div className="flex flex-col gap-2 px-3 py-3 text-xs text-slate-400">
              <button
                className="rounded bg-sky-700 px-3 py-1 text-sm text-white hover:bg-sky-600"
                onClick={() => void folder.pickFolder()}
                title="Open the OS folder picker; the browser will ask for read access"
              >
                Choose folder…
              </button>
              <span>
                Pick your PHD2 logs folder (typically <span className="font-mono text-slate-300">Documents\PHD2</span>).
              </span>
            </div>
          )}
          {folder.state === 'needs-permission' && (
            <div className="flex flex-col gap-2 px-3 py-3 text-xs text-slate-400">
              <button
                className="rounded bg-sky-700 px-3 py-1 text-sm text-white hover:bg-sky-600"
                onClick={() => void folder.reconnect()}
                title="Re-grant read access for this session"
              >
                Reconnect
              </button>
              <span>Re-grant read access to restore the folder listing.</span>
            </div>
          )}
          {folder.state === 'error' && (
            <div className="flex flex-col gap-2 px-3 py-3 text-xs text-red-400">
              <span>{folder.message}</span>
              <button
                className="self-start rounded bg-slate-800 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700"
                onClick={() => void folder.pickFolder()}
              >
                Choose folder…
              </button>
            </div>
          )}
          {folder.state === 'listing' && (
            <ul className="max-h-72 overflow-y-auto">
              {folder.records.map((r) => {
                const isCurrent = r.filename === currentName;
                return (
                  <li
                    key={r.filename}
                    className={`border-b border-slate-800 last:border-b-0 ${
                      isCurrent ? 'bg-slate-800/60' : ''
                    }`}
                  >
                    <button
                      className="block w-full truncate px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-800"
                      onClick={() => void folder.openRecord(r)}
                      title={`Open ${r.filename}`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{r.dateLabel}</span>
                        {isCurrent && <span className="text-xs text-sky-400">(current)</span>}
                      </div>
                      <div className="truncate text-xs text-slate-500">{r.filename}</div>
                    </button>
                  </li>
                );
              })}
              {folder.records.length === 0 && (
                <li className="px-3 py-3 text-xs text-slate-500">
                  No guide logs found in this folder. Add a `*GuideLog*` file or pick a different folder.
                </li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```
cd web && npm run typecheck
```

Expected: clean.

- [ ] **Step 3: Report back** (no commit)

---

### Task 5: Wire the pane into ViewerPage + DropZone

**Files:**
- Modify: `web/src/pages/ViewerPage.tsx`
- Modify: `web/src/components/DropZone.tsx`

Sidebar order: `LogsFolderPane`, `RecentsDropdown`, `SectionList`. The empty-state screen also gets a "Choose logs folder…" button beside the existing drop zone (visible only when folder browsing is supported).

- [ ] **Step 1: Modify `web/src/components/DropZone.tsx`**

Read the current file first to keep the rest of its code intact:

```
cd web && cat src/components/DropZone.tsx
```

Then add the folder-picker button below the existing drop zone. At the top of the file, near the existing imports, add:

```tsx
import { useFolderStore } from '../state/folderStore';
```

Inside the component body, after the existing state declarations (`dragOver`, `inputRef`, etc.), add:

```tsx
  const folderState = useFolderStore((s) => s.state);
  const pickFolder = useFolderStore((s) => s.pickFolder);
  const folderSupported = folderState !== 'unsupported';
```

Find the closing tag of the existing dashed-border drop-zone div (the `</div>` that closes the `flex flex-col items-center justify-center rounded-lg border-2 border-dashed …` div). After that closing `</div>` and before the parent's closing tag, insert:

```tsx
      {folderSupported && (
        <div className="mt-3 flex flex-col items-center gap-2">
          <button
            className="rounded bg-slate-800 px-3 py-1 text-sm text-slate-200 hover:bg-slate-700"
            onClick={() => void pickFolder()}
            title="Pick your PHD2 logs folder; afterwards every guide log will be browsable from the sidebar"
          >
            Choose logs folder…
          </button>
          <p className="text-xs text-slate-500">Browse all your guide logs by date.</p>
        </div>
      )}
```

If the existing JSX doesn't have a single shared parent element wrapping the dashed div, wrap both in a fragment (`<>...</>`) so the new block sits as a sibling.

- [ ] **Step 2: Modify `web/src/pages/ViewerPage.tsx`**

Read the file first:

```
cd web && cat src/pages/ViewerPage.tsx
```

Add the import next to the existing component imports:

```tsx
import { LogsFolderPane } from '../components/LogsFolderPane';
```

Find the sidebar `<aside>` block (the one containing `<RecentsDropdown />` and `<SectionList />`). Insert `<LogsFolderPane />` directly above `<RecentsDropdown />`. The sidebar's flex layout already accommodates extra children. Final order should be:

```tsx
<aside className="flex flex-col overflow-hidden border-r border-slate-800">
  <LogsFolderPane />
  <RecentsDropdown />
  <div className="flex-1 overflow-y-auto">
    <SectionList />
  </div>
</aside>
```

- [ ] **Step 3: Typecheck and unit tests**

```
cd web && npm run typecheck
cd web && npm test
```

Expected: typecheck clean, all 75+ tests pass (existing 74 + the 7 from Task 1's filename tests = 81+).

If any existing test now fails (no behavioral changes to the parser layer were intended), STOP and report — do not silently adjust assertions.

- [ ] **Step 4: Manual smoke (orchestrator handles this; do not start the dev server)**

Skip — the orchestrator runs the dev server after committing.

- [ ] **Step 5: Report back** (no commit)

---

### Task 6: Playwright e2e coverage

**Files:**
- Create: `web/e2e/folder.spec.ts`

The folder API itself can't be driven from headless Chromium without launch flags, so we cover what we CAN: the empty-state button visibility, and that the sidebar pane appears with the "Choose folder…" button after a log is loaded.

- [ ] **Step 1: Implement `web/e2e/folder.spec.ts`**

```ts
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SYNTHETIC = join(__dirname, '..', 'src', 'parser', '__tests__', 'fixtures', 'synthetic.log');

const dropFixture = async (page: import('@playwright/test').Page) => {
  const text = readFileSync(SYNTHETIC, 'utf-8');
  await page.setInputFiles('input[type=file]', {
    name: 'synthetic.log',
    mimeType: 'text/plain',
    buffer: Buffer.from(text, 'utf-8'),
  });
};

test.describe('Logs folder browser', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  });

  test('empty-state shows the "Choose logs folder…" button when supported', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'File System Access API only available in Chromium');
    await expect(page.getByRole('button', { name: 'Choose logs folder…' })).toBeVisible();
  });

  test('sidebar pane appears after a log is loaded', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'File System Access API only available in Chromium');
    await dropFixture(page);
    await page.getByText('Guide ·', { exact: false }).first().click();
    // The sidebar's "Logs folder" header must be visible.
    await expect(page.getByRole('button', { name: /Logs folder/ })).toBeVisible();
    // And the embedded "Choose folder…" button when no folder is configured.
    await expect(page.getByRole('button', { name: 'Choose folder…' })).toBeVisible();
  });
});
```

- [ ] **Step 2: Run the e2e suite**

```
cd web && npm run e2e
```

Expected: all previously-passing tests still pass, plus the 2 new ones. Total ≥ 27 passed, 1 skipped (the existing real-sample calibration test that already skips).

If the e2e suite fails for an unrelated reason (e.g. analysis modal regression), STOP and report.

- [ ] **Step 3: Report back** (no commit)

---

## Spec coverage check

- §1 Goal → Tasks 4 + 5 (UI + wire-up) deliver the visible feature.
- §3 UI states → Task 4 (each branch in `LogsFolderPane`).
- §4 Architecture / file structure → matches Tasks 1–5 one-to-one.
- §5 Data flow (open record → load) → Task 3 `openRecord` action.
- §6 Filename parsing → Task 1.
- §7 State machine → Task 3.
- §8 IndexedDB persistence → Task 2.
- §9 Listing implementation (sort order, parser filter) → Task 3 `listFolder`.
- §10 Error handling → Task 3 (catch blocks throughout).
- §11 Testing → Task 1 unit tests, Task 6 e2e.
- §12 Done definition → all tasks together; Task 6 confirms the visible surface.
- §13 Risks → known unknowns, no implementation needed.
