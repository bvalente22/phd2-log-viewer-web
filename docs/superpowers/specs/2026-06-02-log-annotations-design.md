# Log Annotations — design

**Date:** 2026-06-02
**Status:** Approved (brainstorming)

## Summary

Let the user attach an optional **friendly name** and an optional **free-form
notes** field (up to 32k characters) to any PHD2 guide log. Annotations are
stored in the browser via IndexedDB as a **sidecar** keyed by a hash of the
log's content — the raw log file on disk is never modified. The friendly name
surfaces in the left-hand file list; the real filename continues to show in the
graph header. On the first open of a never-seen log, a lightweight prompt
offers to name it.

### Why a sidecar (not in-place file editing)

The app is a static browser app (GitHub Pages, no backend). Writing back to the
user's actual log file requires the File System Access API, which is
**Chromium-only** (the app already has an `unsupported` state for Firefox/Safari
in `folderStore.ts`), prompts for `readwrite` permission, and — critically —
browsers never expose a file's absolute path. Editing the raw log also risks
corrupting the user's instrument data and breaking the parser. A sidecar in
IndexedDB works in every browser, needs no permissions, and never touches the
raw data.

## Decisions (locked during brainstorming)

| Decision | Choice |
| --- | --- |
| Match key | **Content hash** of the full log text. Filename stored for display only. |
| First-open prompt — on dismiss | **Prompt once**, record "seen", never auto-prompt again. Name later via the pencil icon. |
| Persistence | **Independent & permanent** store, keyed by hash. Not tied to the Recents list (which caps at 10 and evicts). |
| Export / import JSON | **Deferred** to a later version. |
| File-list row treatment | Friendly name primary, real filename muted beneath; un-named rows show filename + pencil. |
| Editor home | **Modal dialog** (patterned on the Analysis modal). Notes textarea ≥10 visible lines, 32k max. |
| First-open prompt style | **Blocking modal**, name-only, with Save / Skip and a "+ notes" link that expands to the full editor. |
| Deletion granularity | Modal **Delete** wipes the whole annotation. Name and notes each clearable individually by emptying the field and saving. |

## 1. Data model & storage

New module `web/src/storage/annotations.ts`, mirroring `web/src/storage/recents.ts`
and using the same `idb-keyval` primitive. Keys are namespaced (e.g. `anno:<hash>`).

```ts
interface Annotation {
  key: string;                  // content hash — the match key
  friendlyName: string | null;
  notes: string | null;
  filename: string;             // last-seen filename, for display / recovery
  seen: true;                   // set on first open so we never re-prompt
  updatedAt: number;
}
```

- **Key = content hash** of the full log text. A small synchronous string hash
  (FNV-1a or equivalent) — no crypto needed; collisions across a personal log
  collection are astronomically unlikely. Computed once at load.
- **Permanent & independent**: never evicted; untouched when a Recents entry
  falls off the 10-item list.
- A record exists once a log is *seen* (to record "don't re-prompt") even if
  name and notes are both empty.

Module API (sketch):

```ts
hashLogText(text: string): string
getAnnotation(key: string): Promise<Annotation | undefined>
putAnnotation(a: Partial<Annotation> & { key: string; filename: string }): Promise<void>
deleteAnnotation(key: string): Promise<void>
markSeen(key: string, filename: string): Promise<void>   // writes seen:true with empty fields
```

### Edge case — appended / growing logs

The key is the hash of the full text, so re-opening a log that PHD2 has since
appended to produces a different hash and reads as a new (un-annotated) log.
PHD2 log analysis is normally post-session, so this is acceptable. Documented
here, not engineered around in v1.

## 2. Matching flow on load

`loadFromText` in `web/src/state/logStore.ts` gains a post-parse step:

1. Parse the log (unchanged).
2. Compute `key = hashLogText(text)`.
3. `getAnnotation(key)`:
   - **No record** → first open → fire the first-open prompt (§4).
   - **Record exists** (even nameless) → no prompt; load its name/notes into
     state.
4. Stash the annotation (and `key`) on the log store so UI can read/update it.
   `LogMeta` gains `hash: string` and `annotation: Annotation | null`.

The hash is a single linear pass over the text — negligible beside the parse.

## 3. UI surfaces

- **Graph header & SectionSummary** — unchanged: always show the **real
  filename** (`ViewerPage.tsx` header + the `SectionSummary` strip). Add a small
  **annotate (pencil) button** next to the filename that opens the editor modal
  for the current log.
- **File list (Recents rows)** — friendly name primary, real filename muted
  beneath. Row states:
  - *Named* → friendly name + filename subtext; pencil on hover to edit.
  - *Notes but no name* → filename + a **note icon** so the user can see notes
    exist; click to edit.
  - *Nothing* → filename + pencil to add.
- **Editor modal** — new `AnnotationModal` component (patterned on
  `AnalysisModal`): friendly-name input + notes textarea (**≥10 visible lines**,
  scrolls, `maxLength={32768}`), **Save** and **Delete**. Opened from the
  pencil/note icon in the list and from the header button.

## 4. First-open prompt

Blocking modal (the same `AnnotationModal` in a `mode: 'first-open'` variant):
name field pre-filled with the filename, **Save** / **Skip**, and a **"+ notes"**
link that expands it into the full editor (`mode: 'edit'`). Both Save and Skip
write the record with `seen:true`, so it never re-prompts.

The modal takes a `mode: 'first-open' | 'edit'` prop rather than being a
separate component.

## 5. Testing & i18n

- **Unit tests** for `annotations.ts` (put/get/delete, hash stability for
  identical text, hash difference for changed text, independence from Recents
  eviction, `markSeen` semantics) — following the `recents.test.ts` pattern.
- All new strings go through i18n; add keys to the `en` locale, leave the other
  5 locales to the existing translation flow.
- Native `title` tooltips on the pencil / note / header buttons, per the
  project's tooltip convention.
- No chart code is touched. Per the project's chart-interaction rule, the modal,
  prompt, and the file-list row states will still be verified in the browser
  before shipping.

## Out of scope (v1)

- JSON export / import of annotations (deferred — the only cross-browser
  portability path, but separable work).
- In-place editing of the raw log file on disk.
- Re-linking annotations across content changes (appended logs).
