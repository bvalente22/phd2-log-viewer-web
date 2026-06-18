# Settling-Exclusion Policy (desktop default) — Design Spec

- **Date:** 2026-06-17
- **Status:** Approved (design); pending implementation plan
- **Scope:** The guide-graph section view's settling-frame exclusion, which drives the footer stats (RMS, RA/Dec drift, PAE) and the chart's greyed frames.

## 1. Background & root cause

The polar-alignment Dec drift in the web app disagreed with the desktop PHD2 Log Viewer (seg 15: web −0.21″/min vs desktop −0.17″/min). Root cause: the web app **auto-excludes settling more aggressively than the desktop**.

- The web app, on first view of a section ([GuideGraph.tsx](../../../web/src/components/GuideGraph.tsx) `useEffect`), auto-applies `computeSettlingMask`, which excludes API settling windows **plus up to 5 frames after each DITHER** ("post-dither recovery frames").
- The desktop app excludes **API settling windows only** (`ExcludeSettlingByAPI`, `excludeParametric = false` by default).
- That single shared mask feeds **both** the polar-alignment drift and the RMS/Total/included-count stats, so the web app's whole readout diverged from the desktop on every dithered section.

Empirical comparison on the sample log (`sample data/polarAlignment/PHD2_GuideLog_2026-06-09_210610.txt`) confirmed that applying the **desktop policy (API only)** makes all stats match the desktop, at negligible RMS cost (the post-dither frames are ~5 per dither — too few to move RMS):

| Seg | Desktop (known) | Web current default (API+dither) | Desktop policy (API only) |
|----|----|----|----|
| 8 | RA −0.22, Dec −0.57, PAE 3.9 | RA −0.29, Dec −0.44, PAE 3.1 ✗ | RA −0.22, Dec −0.58, PAE 4.0 ✓ |
| 10 | RA −0.08, Dec −0.44, PAE 3.1 | RA −0.06, Dec −0.44, PAE 3.0 | RA −0.08, Dec −0.45, PAE 3.1 ✓ |
| 15 | RA −0.02, Dec −0.17, PAE 1.2 | RA −0.02, Dec −0.21, PAE 1.5 ✗ | RA −0.02, Dec −0.17, PAE 1.2 ✓ |

RMS barely moved (seg 8: 0.86→0.90″; seg 10/15: ~0.01″).

## 2. Goal

Make the section view match the desktop **by default**, while letting the user opt into the stricter web exclusion, via a clear per-section choice in the guide-graph right-click menu. Manual range-excludes are preserved across the choice.

## 3. Default behavior

On first view of a guiding section (the existing [GuideGraph.tsx](../../../web/src/components/GuideGraph.tsx) auto-default `useEffect`, guarded by "no mask exists yet for this section"): apply the **desktop** settling policy — API settling windows only — instead of `computeSettlingMask`. Set the section's settling policy to `'desktop'`. Result: RMS, RA/Dec drift, PAE, and the greyed frames all match the desktop out of the box.

## 4. Context menu

In [ContextMenu.tsx](../../../web/src/components/ContextMenu.tsx), replace the single "Exclude dithers / settling" item (lines ~157-168) with two items under a small "Settling exclusion" caption:

- **"Exclude Frames Settling (default)"** → desktop policy (API settling only).
- **"Exclude Frames Settling + Dithers"** → web policy (API settling + up to 5 post-dither frames).

A check (✓) marks the section's currently-active policy (radio-style), read from the per-section policy state. Selecting an item applies that policy (§5). "Include all", "Exclude all", "Reset section", "Reset zoom", and "Analysis…" are unchanged. "Reset section" returns the section to the **desktop** default policy.

## 5. Computation / data model

Today: `viewStore.exclusions: Map<sessionIdx, Uint8Array>` (one combined mask, persisted), with `setMask`/`includeAll`/`excludeAll`. `calcStats(session, mask)` feeds both RMS and `computePolarAlignment`.

Changes:

- Add per-section **settling policy** to `viewStore`: `settlingPolicy: Map<sessionIdx, 'desktop' | 'web'>` (persisted alongside `exclusions`; treated as `'desktop'` when absent).
- Add a store action **`applySettlingPolicy(sessionIdx, session, policy)`** that recomputes the effective mask while **preserving manual excludes**:
  - `oldPolicy = settlingPolicy.get(sessionIdx) ?? 'desktop'`
  - `oldSettling = settlingBitsFor(oldPolicy, session)`
  - `manual = currentMask AND NOT oldSettling`  (recover hand-excluded bits)
  - `newMask = settlingBitsFor(policy, session) OR manual`
  - set `exclusions[sessionIdx] = newMask`; `settlingPolicy[sessionIdx] = policy`
- `settlingBitsFor(policy, session)` returns a `Uint8Array`: `computeSettlingMask(session, undefined, { includeDithers: policy === 'web' })` (see §6).
- **GuideGraph auto-default** calls `applySettlingPolicy(sessionIdx, session, 'desktop')` (only when no mask exists yet — same guard as today).
- **ContextMenu** items call `applySettlingPolicy(sessionIdx, session, 'desktop' | 'web')`; the ✓ reads `settlingPolicy.get(sessionIdx) ?? 'desktop'`.
- Manual drag-excludes, "Include all", "Exclude all" modify the mask directly as today and do **not** change the policy. (After a manual edit, the "manual" portion is recovered on the next policy switch as `mask AND NOT currentPolicySettling`.)
- `calcStats` is **unchanged** — it receives the effective mask; RMS and `computePolarAlignment` both follow it (whole-section, consistent).
- `computePolarAlignment` keeps its internal API `settlingMask` as a safety net for mask-less calls (idempotent with the effective mask); no change needed.

Minor accepted edge: a manual exclude that lands exactly on a frame the *old* policy also excluded can be lost when switching `web → desktop` (it's subtracted as settling). Rare and low-impact.

## 6. `settling.ts` change

Add an options parameter to `computeSettlingMask`:

```ts
computeSettlingMask(s: GuideSession, base?: Uint8Array, opts?: { includeDithers?: boolean }): Uint8Array
```

- Default `includeDithers: true` (backward compatible with any existing callers).
- When `includeDithers === false`, skip the post-DITHER 5-frame loop → API settling windows only (the desktop policy).

This keeps all settling logic in one place. (`polarAlignment.ts`'s internal `settlingMask` — API-only — is unaffected and remains the PA safety net.)

## 7. Edge cases

- **Section with no dithers:** desktop and web policies produce identical masks; the ✓ still reflects the chosen policy.
- **Older logs (`state=1`/`state=0` markers):** already handled by the shared `SETTLING_START`/`SETTLING_END` sets in `settling.ts`.
- **Persistence:** policy persists with `exclusions` (same store, same per-log keying). Loading a different log resets per the existing exclusions behavior.

## 8. i18n

In `web/src/i18n/locales/*/toolbar.json` (all 6 locales), replace the `excludeDithers` / `excludeDithersTooltip` keys with two label+tooltip pairs:

- `excludeSettling` = "Exclude Frames Settling (default)" / tooltip: drops only PHD2's settling windows; matches the desktop viewer.
- `excludeSettlingDithers` = "Exclude Frames Settling + Dithers" / tooltip: also drops the few recovery frames just after each dither — stricter than the desktop, slightly cleaner stats.
- Optional `settlingCaption` = "Settling exclusion" for the caption.

PHD2 jargon (RA/Dec/PAE/dither) stays English per repo convention.

## 9. Testing

- **`settling.test.ts`:** `computeSettlingMask` with `includeDithers: false` excludes only the API windows (no post-dither frames); with `true` (default) keeps current behavior. A fixture with a DITHER event verifies the difference.
- **`viewStore` test:** `applySettlingPolicy` switches the mask between desktop/web; a manual-excluded range survives a `desktop → web → desktop` round-trip; `settlingPolicy` is recorded.
- **Regression anchor (manual, sample log is gitignored):** with the desktop default, seg 8/10/15 read RA −0.22/−0.08/−0.02, Dec −0.58/−0.45/−0.17, PAE 4.0/3.1/1.2 (matching the desktop). Documented here for manual verification; unit tests use synthetic data.
- No component render tests (no React Testing Library). Verify the menu via `tsc` + a manual check.
- Gate: `cd web && (G:) node node_modules/typescript/bin/tsc --noEmit` + `… vitest run` clean.

## 10. Out of scope

- The Analysis modal's FFT "all frames / auto-excluded" toggle (separate exclusion path in `analysisStore`).
- Any change to the polar-alignment math itself (drift, PAE, Alt/Az) — that's the accuracy phase (#2/#4/#5), deferred.
- Per-axis or per-frame settling tuning.
