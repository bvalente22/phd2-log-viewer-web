# Editable, per-log-persistent Primary period — design

**Date:** 2026-06-08
**Status:** approved (brainstorming), pending spec review.

## Summary

The Analysis periodogram's **Primary period** (the denominator for all period ratios + the top-3 cap, shipped auto-only in PR #71/#72) becomes an **editable field with one value per guide log**:

- Pre-filled with the auto-detected primary (largest-amplitude peak ≤ Max Period) the first time a log is analyzed.
- **Editable**; an edit **replaces** the calculated value and persists.
- **One value per guide log**, shared across all guide sections (switching sections does NOT recalculate).
- **Persists durably** keyed by the log's content hash (survives page reload + reopening the same log). A **different** guide log has no stored value, so it **recalculates**.
- A **reset-to-auto** affordance recomputes the dominant peak for the **current** section.
- All ratios (peak cards + periodogram hover) and the **top-3 cap** use this single value.

All work is in `web/`. Reuses the content-hash + IndexedDB-sidecar pattern from the log-annotations feature.

## Decisions (from brainstorming)
- Scope: **one value per log**; the first section analyzed sets it; an edit replaces it; only a different log recalculates. (`source: 'auto' | 'edited'`.)
- Top-3 cap follows the field, using **`min(effectivePrimary, maxPeriodSec)`** so both the "no peak longer than Primary" rule and the Max-Period filter hold.
- Persistence: **durable**, keyed by `meta.hash` (idb-keyval sidecar, like annotations).
- Validation: positive number; invalid input (blank/0/negative/NaN) **reverts to last valid** on commit. A **reset-to-auto** button re-derives from the current section.
- Field placement: in the bottom panel beside **"Max period"**.

## A. Storage sidecar — `web/src/storage/primaryPeriod.ts`
Mirror `annotations.ts` (idb-keyval, prefixed key).
```ts
export interface PrimaryPeriodRecord {
  key: string;            // log content hash (meta.hash)
  value: number;          // seconds, > 0
  source: 'auto' | 'edited';
  updatedAt: number;
}
getPrimaryPeriod(key): Promise<PrimaryPeriodRecord | undefined>
putPrimaryPeriod({ key, value, source }): Promise<PrimaryPeriodRecord>
deletePrimaryPeriod(key): Promise<void>     // used by reset-to-auto's re-store path is a put, not delete; del kept for tests/maintenance
```
Key prefix `primary:`. `value` is always stored in **seconds** (canonical), independent of the arc-sec/pixels display toggle.

## B. Store — `web/src/state/primaryPeriodStore.ts` (zustand)
```ts
interface PrimaryPeriodState {
  hash: string | null;                 // log this record belongs to
  record: PrimaryPeriodRecord | null;  // null until loaded / when absent
  loadedHash: string | null;           // hash whose sidecar read has completed
}
interface PrimaryPeriodActions {
  loadForLog(hash: string): Promise<void>;          // read sidecar -> {record|null, loadedHash:hash}
  initAuto(hash: string, value: number): Promise<void>; // write {auto} ONLY if absent (first-section init)
  setEdited(hash: string, value: number): Promise<void>;
  setAuto(hash: string, value: number): Promise<void>;  // reset-to-auto (always overwrites)
  clear(): void;                                        // on log clear
}
```
- `loadForLog` sets `hash`, reads the sidecar, sets `record` (or null) and `loadedHash = hash`. Guards against races (ignore a stale read if `hash` changed meanwhile).
- `initAuto` writes `{value, source:'auto'}` to the sidecar **only when `record` is null and `loadedHash === hash`** — so it can't clobber a stored value or fire before the read completes (avoids the load/init race).
- `setEdited` / `setAuto` upsert and update in-memory `record`.

## C. logStore hook — `web/src/state/logStore.ts`
After the existing `useAnnotationStore.getState().loadForLog(hash, name)` in `loadFromText`, add `void usePrimaryPeriodStore.getState().loadForLog(hash)`. `clear()` also calls `usePrimaryPeriodStore.getState().clear()`. This is what makes "different log → recalculate, same log → restore" work.

## D. AnalysisModal wiring — single source of truth
- Keep the existing `autoPrimaryRaw` memo (largest-amplitude peak ≤ Max Period on the **Raw-RA** curve; null for spike/no-peak).
- Subscribe to `primaryPeriodStore` (`record`, `loadedHash`).
- `effectivePrimary = record?.value ?? autoPrimaryRaw` (still null only when there's no auto and no stored value).
- **Init effect:** when `loadedHash === meta.hash`, `record == null`, and `autoPrimaryRaw != null` → `initAuto(hash, autoPrimaryRaw)`. (Runs once per fresh log; after it, `record` drives everything and section switches no longer recompute.)
- Replace `primaryPeriodSec` (the value passed to the cards' Ratio, the `PeriodogramChart primaryPeriodSec` prop, and the top-3 cap) with `effectivePrimary`.
- **Top-3 cap:** `const cap = effectivePrimary != null ? Math.min(effectivePrimary, s.maxPeriodSec) : s.maxPeriodSec;` then `topPeaks(s.garun, 3, cap)`.

## E. UI — editable field (AnalysisModal bottom panel, beside "Max period")
```
  TOP 3 PEAKS    Max period [600] s    Primary period [376.7] s ↺   (edited)
```
- A controlled numeric `<input>` showing `effectivePrimary` (rounded for display), with local edit state committed on **blur / Enter**.
- On commit: parse → if finite and `> 0` → `setEdited(hash, value)`; else revert the input to `effectivePrimary` (no store write).
- `↺` button → `setAuto(hash, autoPrimaryRaw)` (recompute from current section). Disabled when `autoPrimaryRaw == null`.
- `(edited)` hint shown only when `record?.source === 'edited'`.
- Only rendered for the regular periodogram modes (not spike; matches where `topPeaks`/Ratio already render). Hidden when `effectivePrimary == null` (e.g. no qualifying peak).

## F. i18n
Add `primaryPeriod`, `primaryPeriodTooltip`, `resetToAuto`, `resetToAutoTooltip`, `edited` under the `analysis` namespace (en only; other locales fall back), near the existing `maxPeriod` keys.

## G. Testing
- **Unit (vitest, fake-indexeddb):** `primaryPeriodStore`:
  - `loadForLog` with no sidecar → `record null`, `loadedHash` set.
  - `initAuto` writes only when absent; a second `initAuto` (record present) is a no-op (doesn't overwrite a stored value).
  - `setEdited` persists `source:'edited'`; `loadForLog` of the same hash restores it.
  - `setAuto` overwrites.
  - hash swap (`loadForLog(h2)`) clears the previous record.
  - Storage round-trip (`putPrimaryPeriod`/`getPrimaryPeriod`).
- **Type/build:** `tsc --noEmit` clean; full `vitest run` green.
- **Browser (Playwright):** edit Primary → card + hover ratios re-flow and the top-3 re-cap; switch sections → value unchanged; reload page (same log) → value restored; reset-to-auto re-derives; invalid input reverts.

## H. Out of scope / non-goals
- No change to `primaryPeriod()` math or the auto-detection rule (largest-amplitude peak ≤ Max).
- No per-section primaries; no cross-device sync (IndexedDB is per-browser, like annotations).
- Spike/Simple/Burst tabs unaffected.
- The Primary value is stored in seconds; the field shows seconds (the periodogram x-axis is already in seconds), independent of the arc-sec/pixels amplitude toggle.

## Rollback
Additive; confined to `web/` plus the two-line `logStore` hook. Revert = the feature branch. With no stored record and the init effect intact, behavior equals today's auto-only Primary.
