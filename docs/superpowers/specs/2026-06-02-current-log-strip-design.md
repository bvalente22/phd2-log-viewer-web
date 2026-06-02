# Current-log annotation strip — design

**Date:** 2026-06-02
**Status:** Approved (brainstorming)

## Summary

Show the currently-open log's **friendly name + inline notes preview** in the
sidebar, directly beneath the "Open log" section header and above the "Drop a
PHD2 guide log here" drop zone, with one-click access to edit the name and
notes. Builds on the log-annotations feature (PR #64) — reuses the existing
`annotationStore`, `AnnotationModal`, and `annotations.ts` storage; no new
storage, parser, or editor.

## Placement

Inside [LogsFolderPane.tsx](web/src/components/LogsFolderPane.tsx), within the
existing `{open && ( … )}` expanded block, rendered **before** the drop-zone
`<div>`. It therefore follows the section's collapse state — visible when the
"Open log" section is expanded (the default), hidden when collapsed.

## Visibility

Renders only when a log is open (`logStore.meta?.hash` is present). Nothing is
rendered when no log is loaded.

## Content

Reads `annotationStore.current` (the annotation for the open log) and
`logStore.meta` (filename via `meta.name`, key via `meta.hash`):

- **Named** (`current.friendlyName` set): friendly name as the primary line;
  real filename muted beneath; a 2-line truncated **inline notes preview**
  (`-webkit-line-clamp: 2`) shown when `current.notes` is non-empty.
- **Un-named** (`current` null or no `friendlyName`): real filename, with a
  muted blue **"✎ Name this log"** cue beneath.

A trailing **blue pencil (✎) button with a transparent background** —
matching the Recents-row pencil styling (`text-slate-500 hover:text-sky-400`,
no fill/background). The whole strip is also clickable to edit.

## Behavior

Clicking the pencil (or the strip) calls the existing
`annotationStore.openEditor(meta.hash, meta.name)`, opening `AnnotationModal`
in `edit` mode (name + notes textarea + Delete). No new editor component.

The strip subscribes to `annotationStore.current` **and** `annotationStore.revision`,
so saving/clearing in the modal refreshes the strip immediately without a
reload. (`save`/`clearCurrentInModal` update `current` when `currentKey`
matches and bump `revision`.)

### Edge case — skipped (seen but unnamed) log

For a log opened then skipped at the first-open prompt, `annotationStore.current`
is `null` (skip only `markSeen`s; it doesn't populate `current`). The strip
shows the un-named state in that case — correct and expected. Editing from the
strip still works because `openEditor` reads the annotation by key directly.

## Components & scope

- **Modify** [LogsFolderPane.tsx](web/src/components/LogsFolderPane.tsx): add
  subscriptions to `logStore.meta` and `annotationStore` (`current`, `revision`,
  `openEditor`); render the strip. The pane currently subscribes only to
  `loadFromText` / `loading` / `error`.
- **Modify** [en/common.json](web/src/i18n/locales/en/common.json): add at most
  two `annotations.*` keys if needed — `currentLogNotesLabel` is not required;
  the existing `annotations.nameTooltip` / `editTooltip` cover the pencil, and a
  new `annotations.nameThisLog` ("Name this log") for the un-named cue. Other
  locales fall back to `en`.

No storage, parser, store-logic, or test-logic changes. UI-only.

## Testing

No unit test (the project has no component-test harness; the underlying store
and storage are already covered by the PR #64 suite). Verified in the browser:
named state with notes preview, un-named state with the cue, pencil opens the
editor, Save/Delete in the modal updates the strip live, strip hidden when no
log is open and when the section is collapsed.

## Out of scope

- Showing the strip when the "Open log" section is collapsed (it follows the
  section like the drop zone does).
- Any change to the Recents-list rows or the header ✎ button (both already
  shipped in PR #64).
