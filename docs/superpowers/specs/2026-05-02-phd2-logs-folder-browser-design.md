# PHD2 Log Viewer — Logs Folder Browser

**Status:** Design approved 2026-05-02
**Predecessors:** v1 / v2 / v3 of the web edition (current `main` is v0.3.4).
**Source app:** No direct desktop equivalent — the Windows desktop opens individual files; this feature is web-native.

---

## 1. Goal

Let the user pick their entire PHD2 logs folder once and browse every guide log inside it directly from the sidebar, with logs identified by parsed **date and time** instead of opaque filenames. The folder handle persists across browser sessions; the user reconnects with a single click each session.

## 2. Non-goals (deferred)

- **Firefox / Safari support.** The File System Access API is Chrome / Edge only. Other browsers retain the existing drag-drop / file-picker / recents workflow with no change.
- **Watching the folder.** No `FileSystemObserver`-style auto-refresh. A manual `↻` icon in the pane header reloads the listing.
- **Recursive descent into subfolders.** Top-level only.
- **Date filter / search box** in the pane. Add when someone has 1000+ logs and the flat list feels unwieldy.
- **Bulk operations** (compare two logs, delete, rename, etc.).

## 3. UI

### 3.1 Entry points to pick a folder

Two:

1. **Empty-state screen** (shown when no log is loaded). A new "Choose logs folder…" button sits next to the existing drop zone:

   ```
   ┌────────────────────────────────────────────────────┐
   │   PHD2 Log Viewer                                  │
   │                                                    │
   │   ┌──────────────────────────────────────────────┐ │
   │   │     Drop a PHD2 guide log here               │ │
   │   │     [ or pick a file ]                       │ │
   │   └──────────────────────────────────────────────┘ │
   │                                                    │
   │   [ Choose logs folder… ]                          │
   │   Browse all your guide logs by date.              │
   │   (Chrome / Edge only)                             │
   │                                                    │
   │   Recent logs (3)                          ▾       │
   └────────────────────────────────────────────────────┘
   ```

2. **Sidebar pane** (visible whenever a log is loaded). New `LogsFolderPane` mounted **above** the existing `RecentsDropdown`. Sidebar order: `LogsFolderPane`, `RecentsDropdown`, `SectionList`. The pane has its own picker button while empty, and a `⋯` overflow menu with "Change folder" / "Forget folder" once configured.

Both entry points dispatch the same store action.

### 3.2 Sidebar-pane visual states

#### State A — no folder configured

```
┌─ Logs folder ▾ ──────────────┐
│                              │
│   [ Choose folder… ]         │
│   Pick your PHD2 logs folder │
│   (typically Documents\PHD2) │
└──────────────────────────────┘
```

#### State B — folder set, permission needed

This is the typical state immediately after an app reload. The browser doesn't auto-grant a previously-stored handle; we need to call `requestPermission` once per session.

```
┌─ Logs folder · PHD2 ▾ ────────┐
│                               │
│   [ Reconnect ]               │
│   Re-grant read access to     │
│   restore the folder listing. │
│                               │
└───────────────────────────────┘
```

Clicking Reconnect calls `handle.requestPermission({ mode: 'read' })` and transitions to State C on success.

#### State C — listing

```
┌─ Logs folder · PHD2 · 142 logs    ↻  ⋯  ▾ ─┐
│                                            │
│   2026-03-30 · 16:15  ◀ current            │
│   PHD2_GuideLog_2026-03-30_161541.txt      │
│ ─────                                      │
│   2026-03-16 · 21:22                       │
│   PHD2_GuideLog_2026-03-16_212239.txt      │
│ ─────                                      │
│   2026-01-19 · 19:58                       │
│   PHD2_GuideLog_2026-01-19_195816.txt      │
│   …                                        │
└────────────────────────────────────────────┘
```

- **Header chips:**
  - Folder name + log count.
  - `↻` refresh icon — re-runs `listFolder()`.
  - `⋯` overflow menu — opens a small popup with "Change folder…" and "Forget folder".
- **Rows** — one per log, each showing:
  - Line 1: parsed local-time `YYYY-MM-DD · HH:MM` (or `—` for unparseable filenames).
  - Line 2: the raw filename, smaller / dimmer.
  - The currently-loaded log gets a `(current)` tag in sky-blue.
- **Sort:** newest first. Unparseable filenames sink to the bottom alphabetically.
- **Click** loads that log (see §5).

### 3.3 Browser-support stub

When `'showDirectoryPicker' in window` is false (Firefox / Safari), the pane renders a single-paragraph stub:

```
┌─ Logs folder ▾ ────────────────────────────┐
│                                            │
│   Folder browsing requires a Chromium-     │
│   based browser (Chrome or Edge). Drag a   │
│   log onto the drop zone to load one.      │
│                                            │
└────────────────────────────────────────────┘
```

The empty-state "Choose logs folder…" button is hidden in unsupported browsers (no point exposing a non-functional control).

## 4. Architecture

```
web/
  src/
    parser/
      filename.ts                 # NEW. Pure: parseLogFilename(name)
      __tests__/
        filename.test.ts          # NEW.
    storage/
      folderHandle.ts             # NEW. IndexedDB persistence of FileSystemDirectoryHandle.
    state/
      folderStore.ts              # NEW. zustand: handle + listing + actions.
      logStore.ts                 # MODIFIED. Add loadFromHandle(file: FileSystemFileHandle).
    components/
      LogsFolderPane.tsx          # NEW. Sidebar pane.
      DropZone.tsx                # MODIFIED. Add the empty-state "Choose logs folder…" button.
    pages/
      ViewerPage.tsx              # MODIFIED. Mount <LogsFolderPane/> above the recents dropdown.
```

**Module boundaries:**

- `parser/filename.ts` is pure TS — same testing contract as the rest of the parser layer.
- `storage/folderHandle.ts` is the only thing that touches IndexedDB for folder state.
- `state/folderStore.ts` is the only thing that touches `FileSystemDirectoryHandle` and permission requests. Components consume `listing: ReadonlyArray<{ handle, dateMs, dateLabel, filename }>`.
- `components/LogsFolderPane.tsx` is presentational; it dispatches store actions and reads the listing.

## 5. Data flow — picking and loading a log

```
user clicks row
  -> folderStore.openRecord(record)
       -> file = await record.handle.getFile()
       -> text = await file.text()
       -> logStore.loadFromText(text, record.filename, { persist: false })
```

`persist: false` skips writing the log to IndexedDB recents — the folder is already the source of truth, so caching the contents would just duplicate data. Logs opened via the folder pane do NOT appear in the recents dropdown.

Logs opened the other ways (drag-drop, file picker) continue to use `persist: true` and behave exactly as today.

## 6. Filename parsing — `parser/filename.ts`

```ts
export interface ParsedLogName {
  /** Case-insensitive: filename contains "guidelog". */
  isGuideLog: boolean;
  /** Local-time epoch ms parsed from YYYY-MM-DD_HHMMSS, or null. */
  dateMs: number | null;
  /** Human label: "2026-03-30 · 16:15" or the raw filename. */
  dateLabel: string;
}

export function parseLogFilename(name: string): ParsedLogName | null;
```

Logic:

1. **Filter.** Lowercase the filename; reject (return `null`) if it doesn't include `guidelog`. This filters out `DebugLog*`, sidecar `.fbk` files, etc.
2. **Date match.** Apply `/(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(\d{2})/`. If matched, build a Date with the user's local timezone (PHD2 names the file using local clock):
   ```ts
   new Date(yyyy, mm - 1, dd, hh, mi, ss).getTime();
   ```
3. **Label.**
   - Date matched → `${yyyy}-${mm}-${dd} · ${hh}:${mi}` (truncated to minutes for readability).
   - No date → fall back to the raw filename.
4. **Edge cases:**
   - Lowercase (`phd2_guidelog_…`) → `isGuideLog = true`.
   - Multiple `YYYY-MM-DD` runs → first match wins.
   - Date present but time missing → `dateMs = null`, fall back to filename label.

Unit tests cover: standard PHD2 filenames, lowercase, no-time variants, no-date variants, `DebugLog` (returns null), Windows path separators (we receive plain filenames anyway, but defensive check), and `.txt` vs `.log` extensions.

## 7. State — `folderStore.ts`

```ts
type FolderState =
  | { state: 'unsupported' }                // !('showDirectoryPicker' in window)
  | { state: 'no-folder' }                  // never picked, or "Forget folder"
  | { state: 'needs-permission'; handle: FileSystemDirectoryHandle; folderName: string }
  | { state: 'listing'; handle: FileSystemDirectoryHandle; folderName: string;
      records: ReadonlyArray<FolderRecord> }
  | { state: 'error'; message: string };

interface FolderRecord {
  handle: FileSystemFileHandle;
  filename: string;
  dateMs: number | null;
  dateLabel: string;
}
```

**Actions:**
- `pickFolder()` — calls `window.showDirectoryPicker()`, stores the handle in IndexedDB, transitions to `'listing'` after a list scan.
- `reconnect()` — calls `handle.requestPermission({ mode: 'read' })`. On `'granted'`, transitions to `'listing'`.
- `forgetFolder()` — clears IndexedDB, transitions to `'no-folder'`.
- `refresh()` — re-runs the directory scan.
- `openRecord(record)` — fetches file text, calls `logStore.loadFromText(...)` with `persist: false`.

**Initialization (module load):**
1. Probe `'showDirectoryPicker' in window` → if false, set `'unsupported'` and stop.
2. Read the saved handle from IndexedDB. If absent → `'no-folder'`.
3. Query `handle.queryPermission({ mode: 'read' })`:
   - `'granted'` → list immediately, transition to `'listing'`.
   - `'prompt'` → `'needs-permission'`.
   - `'denied'` → `'no-folder'` (treat as forgotten).

## 8. Storage — `storage/folderHandle.ts`

`FileSystemDirectoryHandle` is structured-cloneable, so `idb-keyval`'s `set/get` work directly without serialization tricks. Two functions:

```ts
export const saveFolderHandle = (h: FileSystemDirectoryHandle): Promise<void>;
export const loadFolderHandle = (): Promise<FileSystemDirectoryHandle | undefined>;
export const clearFolderHandle = (): Promise<void>;
```

Stored under key `phd-folder-handle`.

## 9. Listing implementation

```ts
async function listFolder(handle: FileSystemDirectoryHandle): Promise<FolderRecord[]> {
  const out: FolderRecord[] = [];
  for await (const entry of handle.values()) {
    if (entry.kind !== 'file') continue;
    const parsed = parseLogFilename(entry.name);
    if (!parsed) continue; // not a guide log
    out.push({
      handle: entry,
      filename: entry.name,
      dateMs: parsed.dateMs,
      dateLabel: parsed.dateLabel,
    });
  }
  // Newest first; unparseable dates last (sorted alphabetically among themselves).
  out.sort((a, b) => {
    if (a.dateMs !== null && b.dateMs !== null) return b.dateMs - a.dateMs;
    if (a.dateMs !== null) return -1;
    if (b.dateMs !== null) return 1;
    return a.filename.localeCompare(b.filename);
  });
  return out;
}
```

For typical folder sizes (≤ a few hundred logs) this is fast — no perceptible delay. For pathological cases (thousands of files), we may add a "loading…" spinner; YAGNI for v1.

## 10. Error handling

| Failure | Surface |
|---|---|
| User cancels picker dialog | Silent — pane stays in its previous state. |
| `requestPermission` returns `'denied'` | Pane shows "Permission denied. Use 'Change folder' to pick again." |
| Saved handle's folder no longer exists | `for await` throws → catch, transition to `'error'` with "Folder not found. Choose a new folder." |
| `getFile()` on a row fails (file deleted between scan and click) | Error toast + remove the record from the listing. |

No analytics / telemetry. Errors are surfaced inline, never silenced.

## 11. Testing

**Unit (Vitest):**
- `filename.test.ts` — happy path, lowercase, no-time, no-date, DebugLog (null), case-insensitive, repeated date pattern.
- No tests for `folderStore` itself — Vitest's `jsdom` doesn't implement the File System Access API. Manual smoke testing covers initialization, picking, reconnecting, forgetting.

**E2E (Playwright):**
- One test: confirm the empty-state shows both the drop zone and the "Choose logs folder…" button. Skip on browsers without `showDirectoryPicker`.
- No automation of the actual directory picker (it triggers a native dialog Playwright can't drive in headless mode without launch flags). Manual smoke during dev covers the happy path.

## 12. Done definition

- A "Logs folder" pane in the sidebar lists every `GuideLog*` file in the user-configured folder, parsed date+time first, sorted newest-first.
- The empty-state screen has a "Choose logs folder…" button alongside the drop zone.
- Folder handle persists across reloads; one-click reconnect prompts the user once per session.
- Filter excludes `DebugLog` and other non-GuideLog files (case-insensitive substring match).
- Browsers without the API show a clear stub message and no broken UI.
- Existing drag-drop / file-picker / recents workflow is unchanged.
- All Vitest tests pass; the one new e2e test passes; manual happy-path smoke confirms picker → list → click → load → render.

## 13. Risks and open questions

- **Permission UX rough edges.** The "needs-permission" state might confuse users who expect the folder to "just work" after a reload. Mitigation: clear button label ("Reconnect"), one-line explanation in the body. If the friction is real, we can later cache a "do not prompt" flag and call `requestPermission` automatically on first interaction.
- **Folder handle staleness.** If the user moves their `Documents\PHD2` folder, the handle is still valid (filesystem-wise) but its contents change. Refresh handles this. If the folder is deleted, the catch-and-recover flow in §10 handles it.
- **Locale formatting.** `dateLabel` uses `YYYY-MM-DD · HH:MM` — fixed format, not user-locale. Fine for now since the rest of the app is English-only; revisit when i18n becomes a goal.
- **Identifying the "current" log.** We compare on filename (`logStore.meta.name === record.filename`). False positives are possible if two folders contain identically-named files; not realistically a concern given the PHD2 timestamp suffix.
