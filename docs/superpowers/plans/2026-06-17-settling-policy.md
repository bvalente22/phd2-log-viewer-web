# Settling-Exclusion Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the guide-graph section view match the desktop PHD2 Log Viewer by default (API settling only), with a two-option right-click menu (desktop / + dithers) that preserves manual excludes.

**Architecture:** Add an `includeDithers` switch to `computeSettlingMask`; track a per-section `settlingPolicy` in `viewStore` with an `applySettlingPolicy` action that recomputes the effective mask (settling-for-policy ∪ manual excludes); default new sections to `'desktop'`; surface the two policies in the context menu with a check on the active one. `calcStats` is unchanged — RMS, drift, and PAE all follow the resulting mask.

**Tech Stack:** React 18 + TypeScript, Zustand (persisted, but exclusions/policy are session-scoped), Vitest, i18next (6 locales).

## Global Constraints

- Work on a feature branch `feat/settling-policy` — `main` only advances via PR per `CLAUDE.md`. Push after commits; open the PR in the final task.
- **Environment (NAS share):** `npx`/`cd web` fail here. Run the toolchain from the `G:` drive via `node`, with `cd` in EVERY command (cwd resets between calls):
  - `cd /g/HomeLab-Repos/PHDLogViewer/web && node node_modules/typescript/bin/tsc --noEmit`
  - `cd /g/HomeLab-Repos/PHDLogViewer/web && node node_modules/vitest/vitest.mjs run <files>`
  - Do NOT use `npx`/`npm install`; if a vitest run fails transiently with a `@vitejs/plugin-react` resolve error, RE-RUN it. Cold vitest ≈ 30s.
- Default policy is `'desktop'` (API settling only). `'web'` adds the post-dither frames.
- `computeSettlingMask` default `includeDithers` is `true` (backward compatible).
- Manual range-excludes must survive policy switches.
- PHD2 jargon (`settling`, `dither`, `RA`, `Dec`) stays English in translated strings.
- All paths relative to repo root; the app is under `web/`.

---

### Task 1: `computeSettlingMask` gains an `includeDithers` option

**Files:**
- Modify: `web/src/parser/settling.ts`
- Test: `web/src/parser/__tests__/settling.test.ts`

**Interfaces:**
- Produces: `computeSettlingMask(s, base?, opts?: { includeDithers?: boolean }): Uint8Array` — `includeDithers` defaults `true`; when `false`, the post-DITHER 5-frame loop is skipped (API settling windows only).

- [ ] **Step 1: Write the failing test**

Append to `web/src/parser/__tests__/settling.test.ts` (it has a `sessionWith(n, infos)` helper and a `masked(m)` helper):

```ts
describe('computeSettlingMask includeDithers option', () => {
  // DITHER @50 (excludes [50,55)) and a settling window [50,53).
  const dithered = () => sessionWith(100, [
    [50, 'DITHER 1.0, 1.0'],
    [50, 'Settling started'],
    [53, 'Settling complete'],
  ]);

  it('default (includeDithers true) excludes settling window + 5 post-dither frames', () => {
    const m = computeSettlingMask(dithered());
    expect(m[52]).toBe(1); // settling window
    expect(m[54]).toBe(1); // post-dither frame (53,54 beyond the window)
    expect(m[55]).toBe(0);
  });

  it('includeDithers:false excludes ONLY the settling window (desktop policy)', () => {
    const m = computeSettlingMask(dithered(), undefined, { includeDithers: false });
    expect(m[52]).toBe(1); // settling window still excluded
    expect(m[53]).toBe(0); // post-dither frames NOT excluded
    expect(m[54]).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /g/HomeLab-Repos/PHDLogViewer/web && node node_modules/vitest/vitest.mjs run src/parser/__tests__/settling.test.ts`
Expected: the `includeDithers:false` test FAILS (option ignored; `m[54]` is 1).

- [ ] **Step 3: Implement the option**

In `web/src/parser/settling.ts`, change the `computeSettlingMask` signature and guard the dither loop:

```ts
export function computeSettlingMask(
  s: GuideSession,
  base?: Uint8Array,
  opts?: { includeDithers?: boolean },
): Uint8Array {
```

Then wrap the existing post-DITHER loop (the `for (const info of s.infos) { if (info.info.startsWith('DITHER')) … }` block) in a condition:

```ts
  if (opts?.includeDithers ?? true) {
    for (const info of s.infos) {
      if (info.info.startsWith('DITHER')) {
        const stop = Math.min(s.entries.length, info.idx + DITHER_SETTLE_FRAMES);
        for (let i = info.idx; i < stop; i++) m[i] = 1;
      }
    }
  }
```

(Leave the API settling-window logic above it unchanged.)

- [ ] **Step 4: Run to verify pass**

Run: `cd /g/HomeLab-Repos/PHDLogViewer/web && node node_modules/vitest/vitest.mjs run src/parser/__tests__/settling.test.ts`
Expected: PASS (existing 2 tests + 2 new).

- [ ] **Step 5: Commit**

```bash
git add web/src/parser/settling.ts web/src/parser/__tests__/settling.test.ts
git commit -m "feat(parser): computeSettlingMask includeDithers option (API-only when false)"
```

---

### Task 2: `viewStore` per-section settling policy + `applySettlingPolicy`

**Files:**
- Modify: `web/src/state/viewStore.ts`
- Test: `web/src/state/__tests__/viewStore.test.ts` (create)

**Interfaces:**
- Consumes: `computeSettlingMask` (Task 1), `GuideSession`.
- Produces: `SettlingPolicy = 'desktop' | 'web'`; `viewStore.settlingPolicy: Map<number, SettlingPolicy>`; `applySettlingPolicy(sessionIdx, session, policy)` — sets `exclusions[sessionIdx] = settlingFor(policy) ∪ manualBits` and records the policy.

- [ ] **Step 1: Write the failing test**

Create `web/src/state/__tests__/viewStore.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useViewStore } from '../viewStore';
import { newGuideSession, type GuideSession, type InfoEntry } from '../../parser/types';

function sessionWith(n: number, infos: Array<[number, string]>): GuideSession {
  const s = newGuideSession('2026-06-09');
  s.entries = Array.from({ length: n }, (_, i) => ({
    frame: i + 1, dt: i, mount: 'MOUNT' as const, included: true, guiding: true,
    dx: 0, dy: 0, raraw: 0, decraw: 0, raguide: 0, decguide: 0,
    radur: 0, decdur: 0, mass: 0, snr: 0, err: 0, info: '',
  }));
  s.infos = infos.map(([idx, info]): InfoEntry => ({ idx, repeats: 1, info }));
  return s;
}

describe('applySettlingPolicy', () => {
  beforeEach(() => useViewStore.getState().clearExclusions());

  it('desktop = API only; web adds post-dither; manual excludes survive switches', () => {
    // DITHER @50 -> [50,55); settling window [50,53).
    const s = sessionWith(100, [
      [50, 'DITHER 1.0, 1.0'], [50, 'Settling started'], [53, 'Settling complete'],
    ]);
    const st = () => useViewStore.getState();

    st().applySettlingPolicy(0, s, 'desktop');
    let m = st().exclusions.get(0)!;
    expect(m[52]).toBe(1);            // settling window excluded
    expect(m[54]).toBe(0);            // post-dither NOT excluded (desktop)
    expect(st().settlingPolicy.get(0)).toBe('desktop');

    // user hand-excludes frame 10
    const withManual = new Uint8Array(m); withManual[10] = 1;
    st().setMask(0, withManual);

    st().applySettlingPolicy(0, s, 'web');
    m = st().exclusions.get(0)!;
    expect(m[54]).toBe(1);            // post-dither now excluded (web)
    expect(m[10]).toBe(1);            // manual exclude survived
    expect(st().settlingPolicy.get(0)).toBe('web');

    st().applySettlingPolicy(0, s, 'desktop');
    m = st().exclusions.get(0)!;
    expect(m[54]).toBe(0);            // post-dither dropped again
    expect(m[52]).toBe(1);            // settling window still excluded
    expect(m[10]).toBe(1);            // manual exclude still there
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /g/HomeLab-Repos/PHDLogViewer/web && node node_modules/vitest/vitest.mjs run src/state/__tests__/viewStore.test.ts`
Expected: FAIL (`applySettlingPolicy`/`settlingPolicy` don't exist).

- [ ] **Step 3: Add imports + the policy type**

In `web/src/state/viewStore.ts`, add near the top imports:

```ts
import { computeSettlingMask } from '../parser/settling';
import type { GuideSession } from '../parser/types';
```

And add an exported type (next to the other `export type` lines near the top):

```ts
export type SettlingPolicy = 'desktop' | 'web';
```

- [ ] **Step 4: Extend the state interface**

In `interface ViewState`, add the field next to `exclusions`:

```ts
  exclusions: Map<number, Uint8Array>;
  settlingPolicy: Map<number, SettlingPolicy>;
```

and add the action declaration next to `setMask`:

```ts
  setMask: (sessionIdx: number, mask: Uint8Array) => void;
  applySettlingPolicy: (sessionIdx: number, session: GuideSession, policy: SettlingPolicy) => void;
```

- [ ] **Step 5: Initialize state + implement the action + clear it**

Add the initial value next to `exclusions: new Map(),`:

```ts
  exclusions: new Map(),
  settlingPolicy: new Map(),
```

Add the action implementation right after `setMask` (before `includeAll`):

```ts
  applySettlingPolicy: (sessionIdx, session, policy) => {
    const entryCount = session.entries.length;
    const oldPolicy = get().settlingPolicy.get(sessionIdx) ?? 'desktop';
    const cur = get().exclusions.get(sessionIdx);
    const hasCur = cur != null && cur.length === entryCount;
    const settleFor = (p: SettlingPolicy) =>
      computeSettlingMask(session, undefined, { includeDithers: p === 'web' });
    const oldSettle = settleFor(oldPolicy);
    const newSettle = settleFor(policy);
    const next = new Uint8Array(entryCount);
    for (let i = 0; i < entryCount; i++) {
      // manual = hand-excluded bit that wasn't part of the old policy's settling
      const manual = hasCur && cur![i] === 1 && oldSettle[i] === 0;
      next[i] = newSettle[i] === 1 || manual ? 1 : 0;
    }
    const nextEx = new Map(get().exclusions);
    nextEx.set(sessionIdx, next);
    const nextPol = new Map(get().settlingPolicy);
    nextPol.set(sessionIdx, policy);
    set({ exclusions: nextEx, settlingPolicy: nextPol });
  },
```

Update `clearExclusions` to clear the policy too:

```ts
  clearExclusions: () => set({ exclusions: new Map(), settlingPolicy: new Map() }),
```

(`settlingPolicy` is session-scoped — do NOT add it to the `partialize` block, same as `exclusions`.)

- [ ] **Step 6: Run to verify pass + tsc**

Run: `cd /g/HomeLab-Repos/PHDLogViewer/web && node node_modules/typescript/bin/tsc --noEmit && node node_modules/vitest/vitest.mjs run src/state/__tests__/viewStore.test.ts`
Expected: tsc clean; the new test passes.

- [ ] **Step 7: Commit**

```bash
git add web/src/state/viewStore.ts web/src/state/__tests__/viewStore.test.ts
git commit -m "feat(state): per-section settlingPolicy + applySettlingPolicy (preserves manual excludes)"
```

---

### Task 3: i18n — replace the dither menu strings (6 locales)

**Files:**
- Modify: `web/src/i18n/locales/{en,es,de,fr,it,zh}/toolbar.json`

**Interfaces:**
- Produces: `contextMenu.settlingCaption`, `contextMenu.excludeSettling`(+`Tooltip`), `contextMenu.excludeSettlingDithers`(+`Tooltip`); removes `contextMenu.excludeDithers`(+`Tooltip`).

- [ ] **Step 1: Edit en**

In `web/src/i18n/locales/en/toolbar.json`, inside `contextMenu`, replace:

```json
    "excludeDithers": "Exclude dithers / settling",
    "excludeDithersTooltip": "Add settling windows (and frames just after each DITHER event) to the existing exclusions",
```

with:

```json
    "settlingCaption": "Settling exclusion",
    "excludeSettling": "Exclude Frames Settling (default)",
    "excludeSettlingTooltip": "Drops only the settling windows PHD2 reports (Settling started → complete). Matches the desktop PHD2 Log Viewer.",
    "excludeSettlingDithers": "Exclude Frames Settling + Dithers",
    "excludeSettlingDithersTooltip": "Also drops the few recovery frames just after each dither — stricter than the desktop, slightly cleaner stats.",
```

- [ ] **Step 2: Mirror the same keys into the other 5 locales**

Replace the `excludeDithers`/`excludeDithersTooltip` pair in each `contextMenu` block with the five keys, translated (keep `settling`/`dither`/PHD2 jargon English):

`es/toolbar.json`:
```json
    "settlingCaption": "Exclusión de settling",
    "excludeSettling": "Excluir frames de settling (predeterminado)",
    "excludeSettlingTooltip": "Descarta solo las ventanas de settling que reporta PHD2 (Settling started → complete). Coincide con el visor de escritorio de PHD2.",
    "excludeSettlingDithers": "Excluir frames de settling + dithers",
    "excludeSettlingDithersTooltip": "También descarta los pocos frames de recuperación justo tras cada dither: más estricto que el escritorio, estadísticas algo más limpias.",
```

`de/toolbar.json`:
```json
    "settlingCaption": "Settling-Ausschluss",
    "excludeSettling": "Frames im Settling ausschließen (Standard)",
    "excludeSettlingTooltip": "Verwirft nur die von PHD2 gemeldeten Settling-Fenster (Settling started → complete). Entspricht dem Desktop-PHD2-Log-Viewer.",
    "excludeSettlingDithers": "Frames im Settling + Dithers ausschließen",
    "excludeSettlingDithersTooltip": "Verwirft zusätzlich die wenigen Erholungs-Frames direkt nach jedem Dither — strenger als der Desktop, etwas sauberere Statistik.",
```

`fr/toolbar.json`:
```json
    "settlingCaption": "Exclusion du settling",
    "excludeSettling": "Exclure les frames de settling (par défaut)",
    "excludeSettlingTooltip": "Ne retire que les fenêtres de settling signalées par PHD2 (Settling started → complete). Identique au visualiseur de bureau PHD2.",
    "excludeSettlingDithers": "Exclure les frames de settling + dithers",
    "excludeSettlingDithersTooltip": "Retire aussi les quelques frames de récupération juste après chaque dither — plus strict que le bureau, statistiques un peu plus propres.",
```

`it/toolbar.json`:
```json
    "settlingCaption": "Esclusione settling",
    "excludeSettling": "Escludi i frame di settling (predefinito)",
    "excludeSettlingTooltip": "Scarta solo le finestre di settling riportate da PHD2 (Settling started → complete). Coincide con il visualizzatore desktop di PHD2.",
    "excludeSettlingDithers": "Escludi i frame di settling + dithers",
    "excludeSettlingDithersTooltip": "Scarta anche i pochi frame di recupero subito dopo ogni dither — più severo del desktop, statistiche un po' più pulite.",
```

`zh/toolbar.json`:
```json
    "settlingCaption": "Settling 排除",
    "excludeSettling": "排除 settling 帧(默认)",
    "excludeSettlingTooltip": "仅丢弃 PHD2 报告的 settling 窗口(Settling started → complete)。与桌面版 PHD2 Log Viewer 一致。",
    "excludeSettlingDithers": "排除 settling 帧 + dithers",
    "excludeSettlingDithersTooltip": "同时丢弃每次 dither 之后的少数恢复帧——比桌面版更严格,统计略干净。",
```

- [ ] **Step 3: Validate JSON + tsc**

Run: `cd /g/HomeLab-Repos/PHDLogViewer/web && for f in en es de fr it zh; do node -e "JSON.parse(require('fs').readFileSync('src/i18n/locales/$f/toolbar.json','utf8'));console.log('$f ok')"; done && node node_modules/typescript/bin/tsc --noEmit`
Expected: 6× `ok`; tsc clean.

- [ ] **Step 4: Commit**

```bash
git add web/src/i18n/locales/*/toolbar.json
git commit -m "i18n(toolbar): replace dither menu string with desktop/web settling options"
```

---

### Task 4: GuideGraph auto-default → desktop policy

**Files:**
- Modify: `web/src/components/GuideGraph.tsx`

**Interfaces:**
- Consumes: `applySettlingPolicy` (Task 2).

- [ ] **Step 1: Add the store hook**

In `web/src/components/GuideGraph.tsx`, near the other `useViewStore` selectors, add:

```ts
  const applySettlingPolicy = useViewStore((s) => s.applySettlingPolicy);
```

- [ ] **Step 2: Replace the auto-default effect body**

Replace the first-time-viewing `useEffect` (the one commented "First-time-viewing default: auto-exclude dithers and settling windows", currently computing `computeSettlingMask(data.session)` and calling `setMask`) with:

```ts
  // First-time-viewing default: apply the DESKTOP settling policy (API settling
  // windows only) so the section's stats (RMS, drift, PAE) and greyed frames
  // match the desktop PHD2 Log Viewer. Only when no mask exists yet for this
  // section — once the user touches exclusions, we leave it alone.
  useEffect(() => {
    if (!data) return;
    const existing = exclusions.get(data.sessionIdx);
    if (existing && existing.length === data.session.entries.length) return;
    applySettlingPolicy(data.sessionIdx, data.session, 'desktop');
  }, [data, exclusions, applySettlingPolicy]);
```

- [ ] **Step 3: Remove the now-unused `computeSettlingMask` import (if unused)**

If `computeSettlingMask` is no longer referenced in `GuideGraph.tsx`, delete its import line (`import { computeSettlingMask } from '../parser/settling';`). `tsc` will flag it if it lingers and is unused. (Leave `setMask` if it's still used elsewhere in the file.)

- [ ] **Step 4: Verify tsc + full suite (no regressions)**

Run: `cd /g/HomeLab-Repos/PHDLogViewer/web && node node_modules/typescript/bin/tsc --noEmit && node node_modules/vitest/vitest.mjs run`
Expected: tsc clean; full suite green.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/GuideGraph.tsx
git commit -m "feat(ui): default new sections to the desktop settling policy"
```

---

### Task 5: ContextMenu — two settling options with active check

**Files:**
- Modify: `web/src/components/ContextMenu.tsx`

**Interfaces:**
- Consumes: `settlingPolicy`, `applySettlingPolicy` (Task 2); `contextMenu.*` i18n (Task 3).

- [ ] **Step 1: Add store hooks + active policy**

In `GraphContextMenu`, next to the existing `useViewStore` selectors (`includeAll`, `excludeAll`, `setMask`, `exclusions`), add:

```ts
  const settlingPolicy = useViewStore((s) => s.settlingPolicy);
  const applySettlingPolicy = useViewStore((s) => s.applySettlingPolicy);
```

After `sessionIdx` is computed, add:

```ts
  const activePolicy = sessionIdx >= 0 ? (settlingPolicy.get(sessionIdx) ?? 'desktop') : 'desktop';
```

- [ ] **Step 2: Replace the single settling `Item` with a caption + two items**

Replace the existing single `Item` block (the one rendering `t('contextMenu.excludeDithers')` and calling `setMask(sessionIdx, computeSettlingMask(session, current))`) with:

```tsx
          <RCM.Separator className="my-1 h-px bg-slate-700" />
          <div className="px-2 py-1 text-[11px] uppercase tracking-wide text-slate-500">
            {t('contextMenu.settlingCaption')}
          </div>
          <Item
            disabled={!session}
            onSelect={() => session && applySettlingPolicy(sessionIdx, session, 'desktop')}
            title={t('contextMenu.excludeSettlingTooltip')}
          >
            <span className="me-1 inline-block w-4 text-emerald-400">{activePolicy === 'desktop' ? '✓' : ''}</span>
            {t('contextMenu.excludeSettling')}
          </Item>
          <Item
            disabled={!session}
            onSelect={() => session && applySettlingPolicy(sessionIdx, session, 'web')}
            title={t('contextMenu.excludeSettlingDithersTooltip')}
          >
            <span className="me-1 inline-block w-4 text-emerald-400">{activePolicy === 'web' ? '✓' : ''}</span>
            {t('contextMenu.excludeSettlingDithers')}
          </Item>
```

- [ ] **Step 3: Remove the now-unused `computeSettlingMask` import (if unused)**

If `computeSettlingMask` is no longer referenced in `ContextMenu.tsx`, delete its import line. `tsc` will flag it if unused.

- [ ] **Step 4: Verify tsc + full suite**

Run: `cd /g/HomeLab-Repos/PHDLogViewer/web && node node_modules/typescript/bin/tsc --noEmit && node node_modules/vitest/vitest.mjs run`
Expected: tsc clean; full suite green.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/ContextMenu.tsx
git commit -m "feat(ui): two-option settling menu (desktop default / + dithers) with active check"
```

---

### Task 6: Full verification + manual sample-log check + PR

**Files:** none (verification only)

- [ ] **Step 1: Full type-check + suite**

Run: `cd /g/HomeLab-Repos/PHDLogViewer/web && node node_modules/typescript/bin/tsc --noEmit && node node_modules/vitest/vitest.mjs run`
Expected: tsc clean; entire suite green.

- [ ] **Step 2: Manual sample-log check**

Start the dev server (locally), load `sample data/polarAlignment/PHD2_GuideLog_2026-06-09_210610.txt`. For segment 15, confirm the footer now reads **Dec Drift −0.17″/min** and **PAE 1.2′** by default (matching the desktop), with the context menu showing **✓ Exclude Frames Settling (default)**. Pick **"Exclude Frames Settling + Dithers"** and confirm Dec drift shifts to ≈ −0.21″/min and the ✓ moves. Confirm seg 8 reads PAE ≈ 3.9′ by default. Right-click → manually exclude a range, switch policies, and confirm the manual exclude persists.

- [ ] **Step 3: Push + open PR**

```bash
git push -u origin feat/settling-policy
git merge-base --is-ancestor origin/main HEAD || { echo "DIVERGED — stop"; exit 1; }
gh pr create --title "feat: desktop-default settling policy + two-option menu" --body "Implements docs/superpowers/specs/2026-06-17-settling-policy-design.md. Section view matches the desktop PHD2 Log Viewer by default (API settling only); right-click menu offers desktop / + dithers; manual excludes preserved. Fixes the seg 15 -0.21 vs -0.17 discrepancy (and seg 8 3.1 vs 3.9)."
```

- [ ] **Step 4: Auto-merge per policy once green**

After `tsc` + `vitest` confirmed clean (coding PR, no infra/CLAUDE.md):

```bash
gh pr merge <num> --squash --delete-branch
git checkout main && git pull --ff-only
```

---

## Self-Review

**Spec coverage:** §3 default → Task 4. §4 menu → Task 5 + Task 3 (i18n). §5 data model (settlingPolicy + applySettlingPolicy + manual preservation, clearExclusions) → Task 2. §6 settling.ts includeDithers → Task 1. §7 edge cases: no-dither section (both policies same mask) — covered by Task 1's logic; older `state=` markers — unchanged shared sets; persistence — settlingPolicy session-scoped (Task 2, not in partialize). §8 i18n → Task 3. §9 testing → Tasks 1/2 unit + Task 6 manual (seg 8/10/15 anchor). §10 out of scope (Analysis FFT, PA math) — untouched.

**Placeholder scan:** No TBD/TODO; every code step is complete; commands have expected output.

**Type consistency:** `SettlingPolicy` (Task 2) used in `applySettlingPolicy` (Tasks 2/4/5) and `computeSettlingMask(..., { includeDithers })` (Tasks 1/2). `settlingPolicy: Map<number, SettlingPolicy>` consistent across store + ContextMenu reads. i18n keys defined in Task 3 are consumed in Task 5. `Item` children-with-check matches the `Item` component's `<span>{children}</span>` structure.
