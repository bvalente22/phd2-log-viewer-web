# Log Annotations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user attach an optional friendly name and free-form notes (≤32k) to any PHD2 log, stored as an IndexedDB sidecar keyed by a content hash, surfaced in the file list and editable via a modal.

**Architecture:** A new `annotations.ts` storage module (mirrors `recents.ts`) holds records keyed by `hashLogText(text)`. `logStore.loadFromText` computes the hash, stores it on the recent + `meta`, and asks a new `annotationStore` to load (or first-open-prompt) the annotation. A new `AnnotationModal` component renders both the first-open prompt and the full editor. `RecentsDropdown` rows show the friendly name (or filename + pencil) and open the editor.

**Tech Stack:** TypeScript, React, Zustand, `idb-keyval`, react-i18next, Tailwind, Vitest.

---

## File Structure

- **Create** `web/src/storage/annotations.ts` — sidecar store + `hashLogText`. One responsibility: persist/fetch annotation records by content hash.
- **Create** `web/src/storage/__tests__/annotations.test.ts` — unit tests for the store + hash.
- **Create** `web/src/state/annotationStore.ts` — Zustand store: current log's annotation, modal draft state, save/clear/skip actions.
- **Create** `web/src/state/__tests__/annotationStore.test.ts` — store round-trip test.
- **Create** `web/src/components/AnnotationModal.tsx` — first-open prompt + full editor (one component, `mode` prop on the store's modal state).
- **Modify** `web/src/storage/recents.ts` — add optional `hash` to records; backfill on read.
- **Modify** `web/src/state/logStore.ts` — compute hash, pass to `putRecent`, store on `meta`, trigger `annotationStore.loadForLog`.
- **Modify** `web/src/components/RecentsDropdown.tsx` — friendly-name rows + pencil/note affordance opening the editor.
- **Modify** `web/src/pages/ViewerPage.tsx` — mount `<AnnotationModal />`; add an annotate button by the header filename.
- **Modify** `web/src/i18n/locales/en/common.json` — `annotations.*` strings (other locales fall back to `en`).

Run all commands from `web/`. Tests: `npx vitest run <path>`. Final gate: `npx tsc --noEmit && npx vitest run`.

---

## Task 1: Annotations storage module + hash

**Files:**
- Create: `web/src/storage/annotations.ts`
- Test: `web/src/storage/__tests__/annotations.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// web/src/storage/__tests__/annotations.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  hashLogText, getAnnotation, putAnnotation, markSeen,
  deleteAnnotation, _allAnnotationKeys,
} from '../annotations';

beforeEach(async () => {
  for (const k of await _allAnnotationKeys()) {
    // strip the 'anno:' prefix back to the bare key for deleteAnnotation
    await deleteAnnotation(k.slice('anno:'.length));
  }
});

describe('hashLogText', () => {
  it('is stable for identical text', () => {
    expect(hashLogText('hello world')).toBe(hashLogText('hello world'));
  });
  it('differs for changed text', () => {
    expect(hashLogText('hello world')).not.toBe(hashLogText('hello worle'));
  });
  it('differs when only length differs', () => {
    expect(hashLogText('aa')).not.toBe(hashLogText('aaa'));
  });
});

describe('annotations store', () => {
  it('round-trips name + notes', async () => {
    const rec = await putAnnotation({ key: 'k1', filename: 'f.log', friendlyName: 'Backyard', notes: 'windy' });
    expect(rec.seen).toBe(true);
    const got = await getAnnotation('k1');
    expect(got?.friendlyName).toBe('Backyard');
    expect(got?.notes).toBe('windy');
    expect(got?.filename).toBe('f.log');
  });

  it('preserves an unspecified field on partial update', async () => {
    await putAnnotation({ key: 'k1', filename: 'f.log', friendlyName: 'Backyard', notes: 'windy' });
    await putAnnotation({ key: 'k1', filename: 'f.log', friendlyName: 'Renamed' }); // notes omitted
    const got = await getAnnotation('k1');
    expect(got?.friendlyName).toBe('Renamed');
    expect(got?.notes).toBe('windy');
  });

  it('clears a field when explicitly null', async () => {
    await putAnnotation({ key: 'k1', filename: 'f.log', friendlyName: 'Backyard', notes: 'windy' });
    await putAnnotation({ key: 'k1', filename: 'f.log', friendlyName: null, notes: null });
    const got = await getAnnotation('k1');
    expect(got?.friendlyName).toBeNull();
    expect(got?.notes).toBeNull();
    expect(got?.seen).toBe(true); // still seen → no re-prompt
  });

  it('markSeen creates an empty seen record and does not clobber an existing one', async () => {
    const a = await markSeen('k2', 'g.log');
    expect(a.friendlyName).toBeNull();
    expect(a.seen).toBe(true);
    await putAnnotation({ key: 'k2', filename: 'g.log', friendlyName: 'Named' });
    const b = await markSeen('k2', 'g.log'); // must not wipe the name
    expect(b.friendlyName).toBe('Named');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/storage/__tests__/annotations.test.ts`
Expected: FAIL — cannot find module `../annotations`.

- [ ] **Step 3: Write the implementation**

```ts
// web/src/storage/annotations.ts
import { get, set, del, keys } from 'idb-keyval';

const PREFIX = 'anno:';

export interface Annotation {
  /** Content hash of the log text — the match key. */
  key: string;
  friendlyName: string | null;
  notes: string | null;
  /** Last-seen filename, for display / recovery. */
  filename: string;
  /** Set once the log has been opened, so we never re-prompt. */
  seen: true;
  updatedAt: number;
}

/**
 * FNV-1a (32-bit) hash of the log text, concatenated with the text length to
 * widen the effective key space. Returned as hex. Not cryptographic — just a
 * stable content fingerprint so the same log re-opened maps to the same
 * annotation record. Collisions across a personal log collection are
 * negligible. See docs/superpowers/specs/2026-06-02-log-annotations-design.md.
 */
export function hashLogText(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const a = (h >>> 0).toString(16).padStart(8, '0');
  const b = (text.length >>> 0).toString(16).padStart(8, '0');
  return `${a}${b}`;
}

export async function getAnnotation(key: string): Promise<Annotation | undefined> {
  return get<Annotation>(PREFIX + key);
}

/**
 * Upsert. A field passed as `undefined` (or omitted) keeps the existing value;
 * passing `null` clears it. `seen` is always forced true. Returns the written
 * record.
 */
export async function putAnnotation(p: {
  key: string;
  filename: string;
  friendlyName?: string | null;
  notes?: string | null;
}): Promise<Annotation> {
  const existing = await get<Annotation>(PREFIX + p.key);
  const rec: Annotation = {
    key: p.key,
    filename: p.filename,
    friendlyName: p.friendlyName !== undefined ? p.friendlyName : existing?.friendlyName ?? null,
    notes: p.notes !== undefined ? p.notes : existing?.notes ?? null,
    seen: true,
    updatedAt: Date.now(),
  };
  await set(PREFIX + p.key, rec);
  return rec;
}

/**
 * Record that a log has been seen without naming it, so the first-open prompt
 * never fires again. No-op (returns the existing record) when one already
 * exists — must never clobber a name/notes the user already saved.
 */
export async function markSeen(key: string, filename: string): Promise<Annotation> {
  const existing = await get<Annotation>(PREFIX + key);
  if (existing) return existing;
  const rec: Annotation = {
    key, filename, friendlyName: null, notes: null, seen: true, updatedAt: Date.now(),
  };
  await set(PREFIX + key, rec);
  return rec;
}

export async function deleteAnnotation(key: string): Promise<void> {
  await del(PREFIX + key);
}

/** Test/maintenance helper — every annotation key (with the `anno:` prefix). */
export async function _allAnnotationKeys(): Promise<string[]> {
  return (await keys()).map(String).filter((k) => k.startsWith(PREFIX));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/storage/__tests__/annotations.test.ts`
Expected: PASS (3 + 4 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/storage/annotations.ts web/src/storage/__tests__/annotations.test.ts
git commit -m "feat: annotations sidecar store + content hash"
```

---

## Task 2: Add `hash` to recents (store + backfill)

**Files:**
- Modify: `web/src/storage/recents.ts`
- Test: `web/src/storage/__tests__/recents.test.ts`

- [ ] **Step 1: Add a failing test for hash persistence + backfill**

Append to `web/src/storage/__tests__/recents.test.ts` (inside the existing `describe('recents', ...)` block):

```ts
  it('stores and returns a provided hash', async () => {
    await putRecent({ name: 'h.log', size: 3, text: 'abc', hash: 'deadbeef' });
    const ls = await listRecents();
    expect(ls[0].hash).toBe('deadbeef');
  });

  it('backfills a missing hash on list', async () => {
    // Simulate a pre-feature recent with no hash by writing through putRecent
    // without one, then confirm listRecents computes & returns one.
    await putRecent({ name: 'old.log', size: 5, text: 'hello' });
    const ls = await listRecents();
    expect(typeof ls[0].hash).toBe('string');
    expect(ls[0].hash!.length).toBeGreaterThan(0);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/storage/__tests__/recents.test.ts`
Expected: FAIL — `ls[0].hash` is `undefined` (property doesn't exist yet).

- [ ] **Step 3: Edit `recents.ts`**

Add the import at the top (after the existing `idb-keyval` import):

```ts
import { hashLogText } from './annotations';
```

Add `hash` to both interfaces:

```ts
export interface RecentMeta {
  id: string;
  name: string;
  size: number;
  openedAt: number;
  hash?: string;
}

export interface RecentRecord extends RecentMeta {
  text: string;
}
```

Change `putRecent` to accept and persist `hash`:

```ts
export async function putRecent(p: { name: string; size: number; text: string; hash?: string }): Promise<string> {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const rec: RecentRecord = {
    id, name: p.name, size: p.size, text: p.text,
    hash: p.hash ?? hashLogText(p.text),
    openedAt: Date.now(),
  };
  await set(PREFIX + id, rec);
  const idx = await loadIndex();
  idx.ids = [id, ...idx.ids.filter(x => x !== id)];
  while (idx.ids.length > MAX) {
    const evict = idx.ids.pop()!;
    await del(PREFIX + evict);
  }
  await saveIndex(idx);
  return id;
}
```

Change `listRecents` to backfill a missing hash from the stored text:

```ts
export async function listRecents(): Promise<RecentMeta[]> {
  const idx = await loadIndex();
  const out: RecentMeta[] = [];
  for (const id of idx.ids) {
    const r = await get<RecentRecord>(PREFIX + id);
    if (!r) continue;
    let hash = r.hash;
    if (!hash) {
      hash = hashLogText(r.text);
      await set(PREFIX + id, { ...r, hash }); // persist the backfill
    }
    out.push({ id: r.id, name: r.name, size: r.size, openedAt: r.openedAt, hash });
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/storage/__tests__/recents.test.ts`
Expected: PASS (existing 3 + new 2).

- [ ] **Step 5: Commit**

```bash
git add web/src/storage/recents.ts web/src/storage/__tests__/recents.test.ts
git commit -m "feat: persist content hash on recents (with backfill)"
```

---

## Task 3: Annotation store (modal state + actions)

**Files:**
- Create: `web/src/state/annotationStore.ts`
- Test: `web/src/state/__tests__/annotationStore.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// web/src/state/__tests__/annotationStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useAnnotationStore } from '../annotationStore';
import { getAnnotation, deleteAnnotation, _allAnnotationKeys } from '../../storage/annotations';

beforeEach(async () => {
  for (const k of await _allAnnotationKeys()) await deleteAnnotation(k.slice('anno:'.length));
  useAnnotationStore.setState({ current: null, currentKey: null, modal: null, revision: 0 });
});

describe('annotationStore', () => {
  it('first open of an unseen log opens the first-open prompt prefilled with the filename', async () => {
    await useAnnotationStore.getState().loadForLog('k1', 'log.txt');
    const m = useAnnotationStore.getState().modal;
    expect(m?.mode).toBe('first-open');
    expect(m?.name).toBe('log.txt');
    expect(useAnnotationStore.getState().current).toBeNull();
  });

  it('loading a seen log does not prompt and sets current', async () => {
    await useAnnotationStore.getState().loadForLog('k1', 'log.txt');
    await useAnnotationStore.getState().skipFirstOpen(); // marks seen
    await useAnnotationStore.getState().loadForLog('k1', 'log.txt');
    expect(useAnnotationStore.getState().modal).toBeNull();
    expect(useAnnotationStore.getState().current?.seen).toBe(true);
  });

  it('save persists name + notes, bumps revision, updates current', async () => {
    await useAnnotationStore.getState().loadForLog('k1', 'log.txt');
    useAnnotationStore.getState().setDraftName('Backyard');
    useAnnotationStore.getState().setDraftNotes('windy night');
    const before = useAnnotationStore.getState().revision;
    await useAnnotationStore.getState().save();
    expect(useAnnotationStore.getState().revision).toBe(before + 1);
    expect(useAnnotationStore.getState().modal).toBeNull();
    const rec = await getAnnotation('k1');
    expect(rec?.friendlyName).toBe('Backyard');
    expect(rec?.notes).toBe('windy night');
    expect(useAnnotationStore.getState().current?.friendlyName).toBe('Backyard');
  });

  it('clearCurrentInModal blanks name + notes but keeps the seen record', async () => {
    await useAnnotationStore.getState().loadForLog('k1', 'log.txt');
    useAnnotationStore.getState().setDraftName('Backyard');
    await useAnnotationStore.getState().save();
    await useAnnotationStore.getState().openEditor('k1', 'log.txt');
    await useAnnotationStore.getState().clearCurrentInModal();
    const rec = await getAnnotation('k1');
    expect(rec?.friendlyName).toBeNull();
    expect(rec?.notes).toBeNull();
    expect(rec?.seen).toBe(true);
  });

  it('setDraftNotes caps at NOTES_MAXLEN', async () => {
    await useAnnotationStore.getState().loadForLog('k1', 'log.txt');
    useAnnotationStore.getState().setDraftNotes('x'.repeat(40000));
    expect(useAnnotationStore.getState().modal?.notes.length).toBe(32768);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/state/__tests__/annotationStore.test.ts`
Expected: FAIL — cannot find module `../annotationStore`.

- [ ] **Step 3: Write the implementation**

```ts
// web/src/state/annotationStore.ts
import { create } from 'zustand';
import {
  getAnnotation, putAnnotation, markSeen, type Annotation,
} from '../storage/annotations';

/** Notes hard cap — see the design spec (≈32k). */
export const NOTES_MAXLEN = 32768;

type Modal =
  | null
  | {
      mode: 'edit' | 'first-open';
      key: string;
      filename: string;
      name: string;   // draft friendly name
      notes: string;  // draft notes
    };

interface AnnotationState {
  /** Annotation for the currently-loaded log (null if unseen/none). */
  current: Annotation | null;
  currentKey: string | null;
  /** Modal draft state, or null when no modal is open. */
  modal: Modal;
  /** Bumped on every persisted change so list views (RecentsDropdown) refetch. */
  revision: number;

  /** Called when a log loads. Sets `current`, or opens the first-open prompt. */
  loadForLog: (key: string, filename: string) => Promise<void>;
  /** Open the full editor for any log (e.g. from the file-list pencil). */
  openEditor: (key: string, filename: string) => Promise<void>;
  /** First-open prompt → expand into the full editor (keeps drafts). */
  expandToNotes: () => void;
  setDraftName: (s: string) => void;
  setDraftNotes: (s: string) => void;
  /** Persist the current modal drafts. */
  save: () => Promise<void>;
  /** Delete button — blank name + notes, keep the seen record (no re-prompt). */
  clearCurrentInModal: () => Promise<void>;
  /** Skip the first-open prompt — record "seen" so it never re-prompts. */
  skipFirstOpen: () => Promise<void>;
  /** Close without persisting (edit mode only). */
  close: () => void;
}

export const useAnnotationStore = create<AnnotationState>((set, get) => ({
  current: null,
  currentKey: null,
  modal: null,
  revision: 0,

  loadForLog: async (key, filename) => {
    const existing = await getAnnotation(key);
    if (existing) {
      set({ current: existing, currentKey: key });
    } else {
      set({
        current: null,
        currentKey: key,
        modal: { mode: 'first-open', key, filename, name: filename, notes: '' },
      });
    }
  },

  openEditor: async (key, filename) => {
    const existing = await getAnnotation(key);
    set({
      modal: {
        mode: 'edit',
        key,
        filename,
        name: existing?.friendlyName ?? '',
        notes: existing?.notes ?? '',
      },
    });
  },

  expandToNotes: () =>
    set((st) => (st.modal ? { modal: { ...st.modal, mode: 'edit' } } : st)),

  setDraftName: (s) =>
    set((st) => (st.modal ? { modal: { ...st.modal, name: s } } : st)),

  setDraftNotes: (s) =>
    set((st) => (st.modal ? { modal: { ...st.modal, notes: s.slice(0, NOTES_MAXLEN) } } : st)),

  save: async () => {
    const st = get();
    if (!st.modal) return;
    const name = st.modal.name.trim();
    const rec = await putAnnotation({
      key: st.modal.key,
      filename: st.modal.filename,
      friendlyName: name.length ? name : null,
      notes: st.modal.notes.length ? st.modal.notes : null,
    });
    set((s2) => ({
      modal: null,
      revision: s2.revision + 1,
      current: s2.currentKey === rec.key ? rec : s2.current,
    }));
  },

  clearCurrentInModal: async () => {
    const st = get();
    if (!st.modal) return;
    const rec = await putAnnotation({
      key: st.modal.key,
      filename: st.modal.filename,
      friendlyName: null,
      notes: null,
    });
    set((s2) => ({
      modal: null,
      revision: s2.revision + 1,
      current: s2.currentKey === rec.key ? rec : s2.current,
    }));
  },

  skipFirstOpen: async () => {
    const st = get();
    if (!st.modal) return;
    await markSeen(st.modal.key, st.modal.filename);
    set((s2) => ({ modal: null, revision: s2.revision + 1 }));
  },

  close: () => set({ modal: null }),
}));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/state/__tests__/annotationStore.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/state/annotationStore.ts web/src/state/__tests__/annotationStore.test.ts
git commit -m "feat: annotation store (modal drafts + save/clear/skip)"
```

---

## Task 4: Wire hashing + annotation load into logStore

**Files:**
- Modify: `web/src/state/logStore.ts`

No new unit test (the load path is covered by the store + storage tests; this is wiring verified in the browser in Task 9). TDD does not apply to a pure integration edit here.

- [ ] **Step 1: Edit `logStore.ts`**

Add imports near the existing `putRecent` import:

```ts
import { putRecent } from '../storage/recents';
import { hashLogText } from '../storage/annotations';
import { useAnnotationStore } from './annotationStore';
```

Add `hash` to `LogMeta`:

```ts
export interface LogMeta {
  name: string;
  size: number;
  recentId: string | null;
  hash: string;
}
```

Replace the body of `loadFromText` with the hash-aware version:

```ts
  loadFromText: async (text, name, opts) => {
    set({ loading: true, error: null });
    try {
      const log = await parseLogAsync(text);
      const hash = hashLogText(text);
      let recentId: string | null = null;
      if (opts?.persist !== false) {
        recentId = await putRecent({ name, size: text.length, text, hash });
      }
      set({
        log,
        meta: { name, size: text.length, recentId, hash },
        selectedSection: log.sections.length > 0 ? 0 : -1,
        loading: false,
      });
      // Load the saved annotation, or fire the first-open prompt for an
      // unseen log. Fire-and-forget: the UI reacts to annotationStore.
      void useAnnotationStore.getState().loadForLog(hash, name);
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS — no errors. (If any other file constructs a `LogMeta` literal without `hash`, fix it; a repo search confirms `meta` is only built here.)

- [ ] **Step 3: Run the full suite (no regressions)**

Run: `npx vitest run`
Expected: PASS — all existing tests plus Tasks 1–3.

- [ ] **Step 4: Commit**

```bash
git add web/src/state/logStore.ts
git commit -m "feat: compute log hash on load and trigger annotation lookup/prompt"
```

---

## Task 5: AnnotationModal component

**Files:**
- Create: `web/src/components/AnnotationModal.tsx`

UI component — verified in the browser (Task 9), no unit test (the project has no component-test harness; storage/store logic is already covered).

- [ ] **Step 1: Write the component**

```tsx
// web/src/components/AnnotationModal.tsx
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAnnotationStore, NOTES_MAXLEN } from '../state/annotationStore';

/**
 * Centered dialog for naming + annotating a log. One component serves two
 * modes (driven by annotationStore.modal.mode):
 *   - 'first-open': name-only prompt fired the first time an unseen log opens.
 *     Save / Skip; a "+ notes" link expands into the full editor. Dismissing
 *     (Escape / backdrop / Skip) records "seen" so it never re-prompts.
 *   - 'edit': full editor (name + ≥10-line notes textarea + Delete), opened
 *     from the file-list pencil/note icon or the header annotate button.
 * Renders nothing when annotationStore.modal is null.
 */
export function AnnotationModal() {
  const { t } = useTranslation('common');
  const modal = useAnnotationStore((s) => s.modal);
  const setDraftName = useAnnotationStore((s) => s.setDraftName);
  const setDraftNotes = useAnnotationStore((s) => s.setDraftNotes);
  const save = useAnnotationStore((s) => s.save);
  const clearCurrent = useAnnotationStore((s) => s.clearCurrentInModal);
  const skipFirstOpen = useAnnotationStore((s) => s.skipFirstOpen);
  const expandToNotes = useAnnotationStore((s) => s.expandToNotes);
  const close = useAnnotationStore((s) => s.close);

  // Dismiss semantics differ by mode: first-open records "seen" so it never
  // re-prompts; edit just closes without persisting.
  const dismiss = modal?.mode === 'first-open' ? skipFirstOpen : close;

  useEffect(() => {
    if (!modal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') void dismiss();
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void save();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modal?.mode]);

  if (!modal) return null;
  const isFirstOpen = modal.mode === 'first-open';
  const hasContent = modal.name.trim().length > 0 || modal.notes.length > 0;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50"
      onMouseDown={(e) => { if (e.target === e.currentTarget) void dismiss(); }}
    >
      <div className="w-[480px] max-w-[90vw] rounded-lg border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2.5">
          <h2 className="text-sm font-medium text-slate-100">
            {isFirstOpen ? t('annotations.firstOpenTitle') : t('annotations.editTitle')}
          </h2>
          <button
            className="text-slate-500 hover:text-slate-200"
            onClick={() => void dismiss()}
            title={t('annotations.close')}
            aria-label={t('annotations.close')}
          >
            ✕
          </button>
        </div>

        <div className="px-4 py-3">
          <label className="mb-1 block text-[10px] uppercase tracking-wide text-slate-500">
            {t('annotations.nameLabel')}
          </label>
          <input
            autoFocus
            className="w-full rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
            value={modal.name}
            placeholder={t('annotations.namePlaceholder')}
            onChange={(e) => setDraftName(e.target.value)}
            title={t('annotations.nameLabel')}
          />

          {modal.filename && (
            <p className="mt-1 truncate text-[11px] text-slate-600" title={modal.filename}>
              {modal.filename}
            </p>
          )}

          {!isFirstOpen && (
            <>
              <label className="mb-1 mt-3 block text-[10px] uppercase tracking-wide text-slate-500">
                {t('annotations.notesLabel')}
              </label>
              <textarea
                rows={10}
                maxLength={NOTES_MAXLEN}
                className="w-full resize-y rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs leading-relaxed text-slate-200 focus:border-sky-500 focus:outline-none"
                value={modal.notes}
                placeholder={t('annotations.notesPlaceholder')}
                onChange={(e) => setDraftNotes(e.target.value)}
                title={t('annotations.notesLabel')}
              />
              <p className="mt-0.5 text-right text-[10px] text-slate-600">
                {modal.notes.length.toLocaleString()} / {NOTES_MAXLEN.toLocaleString()}
              </p>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-slate-800 px-4 py-2.5">
          <button
            className="rounded bg-sky-600 px-3 py-1 text-xs font-medium text-white hover:bg-sky-500"
            onClick={() => void save()}
            title={t('annotations.save')}
          >
            {t('annotations.save')}
          </button>

          {isFirstOpen ? (
            <>
              <button
                className="rounded px-3 py-1 text-xs text-slate-400 hover:text-slate-200"
                onClick={() => void skipFirstOpen()}
                title={t('annotations.skip')}
              >
                {t('annotations.skip')}
              </button>
              <button
                className="ms-auto text-xs text-sky-400 hover:text-sky-300"
                onClick={() => expandToNotes()}
                title={t('annotations.addNotes')}
              >
                {t('annotations.addNotes')}
              </button>
            </>
          ) : (
            <button
              className="ms-auto rounded border border-red-900 px-3 py-1 text-xs text-red-400 hover:bg-red-950/40 disabled:cursor-not-allowed disabled:opacity-40"
              onClick={() => void clearCurrent()}
              disabled={!hasContent}
              title={t('annotations.delete')}
            >
              {t('annotations.delete')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS. (Strings render as raw keys until Task 8 adds them — that's fine for compilation.)

- [ ] **Step 3: Commit**

```bash
git add web/src/components/AnnotationModal.tsx
git commit -m "feat: AnnotationModal (first-open prompt + full editor)"
```

---

## Task 6: Friendly-name rows in RecentsDropdown

**Files:**
- Modify: `web/src/components/RecentsDropdown.tsx`

- [ ] **Step 1: Replace the file with the annotation-aware version**

```tsx
// web/src/components/RecentsDropdown.tsx
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { listRecents, getRecent, deleteRecent } from '../storage/recents';
import type { RecentMeta } from '../storage/recents';
import { getAnnotation, type Annotation } from '../storage/annotations';
import { useLogStore } from '../state/logStore';
import { useAnnotationStore } from '../state/annotationStore';

export function RecentsDropdown() {
  const { t } = useTranslation('sections');
  const { t: tc } = useTranslation('common');
  const [items, setItems] = useState<RecentMeta[]>([]);
  const [annos, setAnnos] = useState<Record<string, Annotation>>({}); // by recent id
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const loadFromText = useLogStore((s) => s.loadFromText);
  const currentName = useLogStore((s) => s.meta?.name);
  const openEditor = useAnnotationStore((s) => s.openEditor);
  // Re-fetch annotations whenever any annotation is persisted.
  const revision = useAnnotationStore((s) => s.revision);

  const refresh = async () => {
    const list = await listRecents();
    setItems(list);
    const map: Record<string, Annotation> = {};
    for (const r of list) {
      if (!r.hash) continue;
      const a = await getAnnotation(r.hash);
      if (a) map[r.id] = a;
    }
    setAnnos(map);
  };

  useEffect(() => { void refresh(); }, [revision]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [open]);

  const openRecent = async (id: string) => {
    const rec = await getRecent(id);
    if (rec) {
      await loadFromText(rec.text, rec.name, { persist: false });
      setOpen(false);
    }
  };

  const removeRecent = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await deleteRecent(id);
    await refresh();
  };

  const editAnno = (r: RecentMeta, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!r.hash) return;
    void openEditor(r.hash, r.name);
  };

  const clearAll = async () => {
    for (const r of items) await deleteRecent(r.id);
    await refresh();
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative border-b border-slate-800">
      <button
        className="flex w-full items-center justify-between px-3 py-2 text-start text-xs uppercase tracking-wide text-slate-400 hover:bg-slate-800"
        onClick={() => setOpen((v) => !v)}
        title={open ? t('recents.hideTooltip') : t('recents.showTooltip')}
      >
        <span>{t('recents.dropdownLabel', { count: items.length })}</span>
        <span className="text-slate-500">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="absolute start-0 end-0 top-full z-30 max-h-96 overflow-y-auto border border-slate-700 bg-slate-900 shadow-lg">
          {items.length === 0 ? (
            <div className="px-3 py-2 text-xs text-slate-500">{t('recents.empty')}</div>
          ) : (
            <ul>
              {items.map((r) => {
                const isCurrent = r.name === currentName;
                const anno = annos[r.id];
                const hasName = !!anno?.friendlyName;
                const hasNotes = !!anno?.notes;
                return (
                  <li
                    key={r.id}
                    className={`flex items-center gap-1 border-b border-slate-800 last:border-b-0 ${
                      isCurrent ? 'bg-slate-800/60' : ''
                    }`}
                  >
                    <button
                      className="flex min-w-0 flex-1 flex-col items-start px-3 py-2 text-start hover:bg-slate-800"
                      onClick={() => void openRecent(r.id)}
                      title={t('recents.reopenTooltip', { name: r.name })}
                    >
                      {hasName ? (
                        <>
                          <span className="w-full truncate text-sm text-slate-200">
                            {anno!.friendlyName}
                            {isCurrent && <span className="ms-2 text-xs text-sky-400">{t('recents.current')}</span>}
                          </span>
                          <span className="w-full truncate text-[11px] text-slate-500">{r.name}</span>
                        </>
                      ) : (
                        <span className="w-full truncate text-sm text-slate-300">
                          {r.name}
                          {isCurrent && <span className="ms-2 text-xs text-sky-400">{t('recents.current')}</span>}
                        </span>
                      )}
                    </button>
                    {/* Annotate affordance: a note glyph when notes exist (even
                        without a name), otherwise a pencil to add a name. */}
                    {r.hash && (
                      <button
                        className="px-1.5 text-slate-500 hover:text-sky-400"
                        onClick={(e) => editAnno(r, e)}
                        title={hasNotes ? tc('annotations.notesIndicatorTooltip')
                          : hasName ? tc('annotations.editTooltip')
                          : tc('annotations.nameTooltip')}
                        aria-label={tc('annotations.editTooltip')}
                      >
                        {hasNotes ? '🗒' : '✎'}
                      </button>
                    )}
                    <button
                      className="px-2 text-slate-500 hover:text-red-400"
                      onClick={(e) => void removeRecent(r.id, e)}
                      title={t('recents.removeTooltip', { name: r.name })}
                    >
                      ×
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <button
            className="w-full border-t border-slate-700 px-3 py-2 text-start text-xs text-slate-400 hover:bg-slate-800 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={items.length === 0}
            onClick={() => void clearAll()}
            title={t('recents.clearAllTooltip')}
          >
            {t('recents.clearAll')}
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/RecentsDropdown.tsx
git commit -m "feat: friendly-name rows + annotate affordance in Recents list"
```

---

## Task 7: Mount the modal + header annotate button

**Files:**
- Modify: `web/src/pages/ViewerPage.tsx`

- [ ] **Step 1: Add imports**

After the existing `LogsFolderPane` import, add:

```ts
import { AnnotationModal } from '../components/AnnotationModal';
```

In the hooks section near `const meta = useLogStore((s) => s.meta);`, add:

```ts
  const openEditor = useAnnotationStore((s) => s.openEditor);
```

And add the store import at the top with the other state imports:

```ts
import { useAnnotationStore } from '../state/annotationStore';
```

- [ ] **Step 2: Add the annotate button beside the filename in the header**

In the header `<h1>`, the filename block currently ends after the PHD-version span (around `ViewerPage.tsx:89`). Add the button right after the closing of the filename span, still inside the `log && ( ... )` fragment:

```tsx
              <span className="break-all text-xs font-normal text-slate-400" title={meta?.name}>
                {meta?.name}
              </span>
              {meta?.hash && (
                <button
                  className="ms-1 align-middle text-xs text-slate-500 hover:text-sky-400"
                  onClick={() => void openEditor(meta.hash, meta.name)}
                  title={t('annotations.annotateCurrentTooltip')}
                  aria-label={t('annotations.annotateCurrentTooltip')}
                >
                  ✎
                </button>
              )}
              <span className="ms-2 text-xs text-slate-500">{t('phdVersion', { version: log.phdVersion })}</span>
```

Note: `t` here is `useTranslation('common')` (already in scope at `ViewerPage.tsx:26`), and `annotations.*` lives in the `common` namespace, so no `ns:` override is needed.

- [ ] **Step 3: Mount the modal**

At the bottom of the returned JSX, next to `<AnalysisModal />`:

```tsx
      <AnalysisModal />
      <AnnotationModal />
    </>
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/ViewerPage.tsx
git commit -m "feat: mount AnnotationModal + header annotate button"
```

---

## Task 8: i18n strings (en catalog)

**Files:**
- Modify: `web/src/i18n/locales/en/common.json`

- [ ] **Step 1: Add the `annotations` block**

Add this key block to `web/src/i18n/locales/en/common.json` (as a new top-level key alongside the existing ones — mind the trailing comma on the preceding entry):

```json
  "annotations": {
    "firstOpenTitle": "Name this log",
    "editTitle": "Annotate log",
    "nameLabel": "Friendly name",
    "namePlaceholder": "e.g. Backyard — windy night",
    "notesLabel": "Notes",
    "notesPlaceholder": "Your own comments about this session…",
    "save": "Save",
    "skip": "Skip",
    "addNotes": "+ notes",
    "delete": "Delete",
    "close": "Close",
    "editTooltip": "Edit name & notes for this log",
    "nameTooltip": "Add a friendly name for this log",
    "notesIndicatorTooltip": "This log has notes — click to view/edit",
    "annotateCurrentTooltip": "Name & annotate this log"
  }
```

- [ ] **Step 2: Verify JSON parses + type-check**

Run: `npx tsc --noEmit`
Expected: PASS (a JSON syntax error here would fail the import). The other 5 locales intentionally fall back to `en` for these keys per the i18n setup (`fallbackLng: 'en'`).

- [ ] **Step 3: Commit**

```bash
git add web/src/i18n/locales/en/common.json
git commit -m "i18n: annotation strings (en; other locales fall back)"
```

---

## Task 9: Verify in browser + full gate + PR

**Files:** none (verification + integration).

- [ ] **Step 1: Full type-check + test gate**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS — all suites green (including Tasks 1–3).

- [ ] **Step 2: Restart the dev server and exercise the feature**

Per the project rule, restart Vite and verify in the browser (use a real log from `sample data/`). Confirm:
1. Opening a never-seen log shows the **first-open prompt**, name field pre-filled with the filename.
2. **Skip** dismisses; re-opening the same log does **not** re-prompt.
3. **"+ notes"** expands to the full editor; Save persists.
4. The Recents row now shows the **friendly name** with the filename beneath; un-named rows show the filename + **✎**; a notes-only row shows **🗒**.
5. The **pencil in the row** and the **✎ by the header filename** both open the editor with existing values loaded.
6. **Delete** blanks the row back to filename-only and does not re-prompt on reload.
7. Notes accept a large paste and stop at 32,768 chars (counter shows the cap).
8. Switching the app language still renders the dialog (English strings via fallback).

- [ ] **Step 3: Open the PR**

```bash
git push -u origin feature/log-annotations
git merge-base --is-ancestor origin/main HEAD || { echo "DIVERGED — stop"; exit 1; }
gh pr create --title "feat: log annotations (friendly name + notes sidecar)" --body "Implements docs/superpowers/specs/2026-06-02-log-annotations-design.md per the plan in docs/superpowers/plans/2026-06-02-log-annotations.md."
```

- [ ] **Step 4: Auto-merge per policy (coding PR, clean gate)**

```bash
gh pr merge <num> --squash --delete-branch
git checkout main && git pull --ff-only
# restart the dev server if it was running
```

---

## Self-Review

**Spec coverage:**
- Content-hash match key → Task 1 (`hashLogText`), Task 4 (computed on load). ✓
- Prompt once, don't nag → Task 3 (`loadForLog` only prompts when no record; `skipFirstOpen`/`save` write `seen:true`), Task 5 (Escape/backdrop/Skip all record seen). ✓
- Independent permanent store → Task 1 (`anno:` keyspace, never evicted; separate from `recents`). ✓
- Friendly name primary + filename beneath; pencil on un-named → Task 6. ✓
- Modal editor, notes ≥10 lines, 32k max → Task 5 (`rows={10}`, `maxLength={NOTES_MAXLEN}`). ✓
- First-open blocking modal, name-only, Save/Skip, "+ notes" → Task 5. ✓
- Deletion: whole-record blank, per-field clear by emptying → Task 3 (`clearCurrentInModal`; emptying a field + Save writes null via the `length ? : null` logic). ✓
- Real filename stays in header → Task 7 leaves the existing filename span; only adds a button. ✓
- Tests following recents pattern → Tasks 1–3. ✓
- i18n en keys, fallback for others → Task 8. ✓
- Tooltips on new buttons → Tasks 5–7 (`title` on every button). ✓
- Export/import deferred → not in plan. ✓

**Placeholder scan:** No TBD/TODO; every code step contains complete code. ✓

**Type consistency:** `Annotation` shape, `hashLogText`, `NOTES_MAXLEN`, `putAnnotation`/`getAnnotation`/`markSeen` signatures, `LogMeta.hash`, `RecentMeta.hash`, and store action names (`loadForLog`, `openEditor`, `expandToNotes`, `setDraftName`, `setDraftNotes`, `save`, `clearCurrentInModal`, `skipFirstOpen`, `close`) are used identically across Tasks 1–7. ✓
