# Persist the dragged debug log (as a handle) + share with Backlash — design

**Date:** 2026-06-08
**Status:** approved (brainstorming), proceeding to implementation per user.

## Summary

When the user drags the guide log + its `PHD2_DebugLog` in together (PR #75 already loads the guide + stashes the debug log for the session), **remember a handle/link to the debug log across sessions** (not its 20–40 MB of bytes) and let **both** the double-click debug viewer and the **Backlash (BLT)** analysis use it.

- Persist a `FileSystemFileHandle` (a tiny reference, NOT the content), keyed by the guide log's content hash.
- The double-click viewer resolves it across sessions (re-granting read permission on first use).
- The Backlash tab auto-loads the available debug log **on tab open** (parse on demand, not up front), so no separate drop is needed.

**Browser support:** relies on the File System Access API → Chromium (Chrome/Edge) only, the same limitation the folder browser already has. Firefox/Safari: dragged debug log still works for the session but isn't remembered (no persistable handle).

## Decisions (from brainstorming)
- Store a **handle/link, not the bytes** (user: "same as for the guidelogs").
- LRU-capped (~50; handles are tiny — only references).
- Backlash parses the available debug log **on Backlash-open**, not on drag.
- Keyed by the guide log's **content hash** (`meta.hash`) — robust + matches annotations/primary-period sidecars.

## A. Storage — `web/src/storage/debugLogHandles.ts`
idb-keyval sidecar, prefix `dbgh:`, MRU index, LRU cap 50.
```ts
interface DebugLogHandleRecord { key: string; handle: FileSystemFileHandle; fileName: string; cachedAt: number; }
putDebugLogHandle(key: string, handle: FileSystemFileHandle, fileName: string): Promise<void>   // LRU upsert
getDebugLogHandle(key: string): Promise<DebugLogHandleRecord | undefined>
deleteDebugLogHandle(key: string): Promise<void>
```
`FileSystemFileHandle` is structured-cloneable, so idb-keyval persists it. `key` is the guide log's `meta.hash`.

## B. Drag acquisition — `web/src/components/LogsFolderPane.tsx`
`onDrop` reads `e.dataTransfer.items[].getAsFileSystemHandle()` (call synchronously during the event — items are only valid then; await the returned promises after). `handleFiles` already finds the guide vs debug file by name. After `loadFromText(guide)` sets `meta.hash`:
- `setStashedDebugLog(hash, debugFile)` (session, in-memory — re-keyed by hash).
- If a `FileSystemFileHandle` for the debug log was obtained → `putDebugLogHandle(hash, handle, debug.name)` (persist).

The file-input (click-to-pick) path yields only `File`s (no handle) → session stash only; persistence is drag-only on this branch (file-input upgrade to `showOpenFilePicker` is a possible follow-up, out of scope).

## C. Resolution — `web/src/storage/debugLogAccess.ts`
`resolveDebugLogFile(guideLogName)` resolution order (reads `useLogStore.getState().meta?.hash` internally for the hash-keyed sources):
1. In-memory stash (`Map<hash, File>`) — this session's drag.
2. **Persisted handle** (`getDebugLogHandle(hash)`): `queryPermission`→`requestPermission` (read) → `handle.getFile()`. Must be called within a user gesture (the double-click / Backlash-open) so the permission prompt is allowed. On any failure (denied, file moved) → fall through.
3. Folder-browser directory handle / session-granted folder (existing).

`setStashedDebugLog` re-keyed from `guideLogName` → `hash`.

## D. Backlash integration — `web/src/state/bltStore.ts`
`bindToGuideLog` runs when the Backlash tab mounts (Backlash-open). After the cache check, when there's **no cached result**, resolve the available debug log and auto-load it:
```ts
// ...existing: load getBltCache; if cached, set + return...
const file = await resolveDebugLogFile(guideLogName);
if (get().guideLogName !== guideLogName) return; // superseded
if (file) await get().loadDebugLog(file);        // parses + caches as today
```
So opening Backlash with the debug log already provided auto-runs the analysis (no second drop). If nothing is available, the existing drop zone shows. The existing parsed-result cache still gives instant restore on later opens.

## E. Permissions + lifecycle
- Permission re-grant uses the standard File System Access prompt, fired from the double-click (viewer) or Backlash-open (BLT) — both user gestures.
- Handles are LRU-capped (50). `logStore.clear()` / forgetting a log may delete the handle (minor; optional — handles are tiny). Out of scope to surface a "clear" control.

## F. Testing
- **Unit (vitest, fake-indexeddb):** `debugLogHandles` put/get/delete + LRU eviction (store a fake handle object — idb-keyval clones it). `resolveDebugLogFile` order with a fake stash + fake handle (mock `useLogStore`/`useFolderStore` getState + the handle's `queryPermission`/`getFile`). `bltStore.bindToGuideLog` auto-loads when `resolveDebugLogFile` returns a file and there's no cache (mock resolveDebugLogFile + parseDebugLogFile).
- **Type/build:** `tsc --noEmit` clean; full `vitest run` green.
- **Browser (you):** the native `getAsFileSystemHandle` + permission prompt can't be Playwright-driven — verify in Chrome: drag both files, reload, double-click (re-grant) → debug tab opens; open Backlash → auto-loads.

## Out of scope / non-goals
- No content-copy fallback for non-Chromium (session-only there).
- No file-input handle upgrade (`showOpenFilePicker`) — drag is the persistable path here.
- No change to BLT's parsed-sequence cache or the debug-viewer rendering.

## Rollback
Additive: a new storage module + small hooks in LogsFolderPane / debugLogAccess / bltStore. Revert = the branch. With no persisted handle, behavior equals today's session-only stash.
