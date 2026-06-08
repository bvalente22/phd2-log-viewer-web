# Analysis top-graph: richer readout + double-click → in-app debug-log viewer — design

**Date:** 2026-06-08
**Status:** approved (brainstorming); user said "proceed to coding, I'll check in the morning" → implement both, hold PR open for review.

## Summary

Two enhancements to the Analysis modal's **top (drift) chart** ([DriftChart.tsx](web/src/components/DriftChart.tsx)):

1. **Richer hover readout** beneath the chart: **clock time → frame number → RA (corrected + raw) → Dec (corrected + raw)**.
2. **Double-click → in-app debug-log viewer**: double-clicking a sample opens an in-app viewer of the sibling `PHD2_DebugLog_<date>.txt`, loaded in full, scrolled to and highlighting the line whose timestamp is closest to the clicked sample's time. If the debug log can't be found, show an error dialog.

**Feasibility note:** the originally-requested "open in the OS default app and scroll/highlight in that external editor" is **impossible in a browser** (sandbox: no API to launch the OS default application for a local file or control an external editor). The in-app viewer is the feasible equivalent and was chosen by the user.

All work is in `web/`. No parser-format changes; `GARun` gains three per-sample arrays.

## A. Data plumbing — per-sample frame + raw RA/Dec

`computeDriftCorrected` ([analyze.ts](web/src/parser/analyze.ts)) already iterates the usable entries building `t`/`rac`/`decc`. Add three parallel arrays, populated from the source `GuideEntry`:

- `frame: Int32Array` — `entry.frame` (the log's Frame column).
- `raRaw: Float64Array` — `entry.raraw` (RARawDistance, px).
- `decRaw: Float64Array` — `entry.decraw` (DECRawDistance, px).

Thread them through `DriftCorrected` and `GARun` (same length/order as `t`). `analyze()` copies them onto the returned `GARun`. `spikeAsGARun` (in AnalysisModal) fills empty `Int32Array(0)`/`Float64Array(0)` — the spike tab uses `SpikeChart`, not `DriftChart`, so it never reads them.

(The chart plots the **drift-corrected** `rac`/`decc`; the readout shows those as "corrected" and the log's `raraw`/`decraw` as "raw". They are different quantities for RA — corrected is the accumulated-position PE signal, raw is the per-frame distance — but that is exactly the pair the user asked to see. Easy to swap the RA "raw" to the pre-drift accumulated value later if desired.)

## B. Feature 1 — readout strip ([DriftChart.tsx](web/src/components/DriftChart.tsx))

`onHover` already receives the Plotly point; use `points[0].pointNumber` as the **sample index** (both traces share one x array, so the index maps straight into `garun.frame/raRaw/decRaw/rac/decc`). Track the last-hovered index in a ref (reused by the double-click handler).

New strip format (follows the arc-sec/pixels scale toggle; `k = pixelScale` in ARCSEC):
```
  19:43:07 · Frame 204 · RA 0.45″ (raw 0.52″) · Dec −0.12″ (raw −0.09″)
```
- Clock from `formatClock(garun.starts, t[idx])` (existing helper, UTC-consistent with the date axis).
- Both RA and Dec always shown regardless of `showRa`/`showDec`.
- When `garun.starts == null` (no timestamp) the clock segment is omitted (shows `t=…s` instead). Frame still shows.

## C. Feature 2 — double-click → in-app debug-log viewer

### Modules
- **`web/src/parser/debugTimestamps.ts`** (pure, unit-tested):
  - `parseDebugTimes(lines: string[], anchorDateMs: number): Float64Array` — parse each line's leading `HH:MM:SS.mmm` to absolute ms anchored on the session's local date, handling **midnight rollover** (timestamps are chronological; when the clock-of-day drops by > 12 h vs the previous line, add a day). Lines with no leading timestamp inherit the previous absolute time; lines before the first timestamp get the anchor.
  - `findClosestTimeIndex(times: Float64Array, targetMs: number): number` — binary search for the nearest time (times are non-decreasing). Returns 0 for empty.
- **`web/src/state/debugLogStore.ts`** (zustand): viewer state + actions.
  - State: `state: 'closed' | 'loading' | 'open' | 'error'`, `fileName`, `lines: string[]`, `times: Float64Array`, `matchedIndex`, `targetMs`, `matchedMs`, `error` (i18n key + params), `guideLogName`, and a needs-pick flag.
  - `openForSample({ guideLogName, anchorDateMs, targetMs })`:
    1. If a cached `{lines,times}` exists for `guideLogName`, match + open immediately.
    2. Else `resolveDebugLogFile(guideLogName)` (below). If a `File` came back → read text, split lines, `parseDebugTimes`, cache, match, open.
    3. If no file (no handle / not found) → set `state:'error'` with a "needs pick" affordance, OR auto-open the file picker (see access).
  - `pickFile(file)`: validate via `validateDebugLogHeader` (reuse from parseBlt), then same read/parse/cache/open path; error on invalid.
  - `close()`.
- **`web/src/storage/debugLogAccess.ts`**:
  - `resolveDebugLogFile(guideLogName): Promise<File | null>` — compute `debugName = guideLogName.replace(/GuideLog/i, 'DebugLog')`; if `folderStore` has a directory handle, ensure read permission (`queryPermission`/`requestPermission`), `getFileHandle(debugName)` → `getFile()`. Return `null` on missing handle / `NotFoundError` so the caller falls back to a pick prompt.
- **`web/src/components/DebugLogViewer.tsx`**: full-screen modal, mounted at the `ViewerPage` root.
  - **Virtualized full-file scroll**: fixed line-height rows; a tall spacer sized `lines.length * lineHeight`; on scroll, render only the visible slice (`startIdx … endIdx` from `scrollTop`). Opens scrolled so the matched line is centered; the matched line is highlighted (amber row). Monospace; line numbers in a gutter.
  - Header: filename, "target HH:MM:SS.mmm → matched HH:MM:SS.mmm", close pill (Esc closes).
  - `state:'loading'` → spinner; `state:'error'` → message + "Pick debug log…" button (opens picker → `pickFile`).

### Wiring (DriftChart)
- Attach a native `dblclick` listener on the plot container. On dblclick, if a last-hovered sample index exists, compute `targetMs = garun.starts + t[idx]*1000` and call `debugLogStore.openForSample({ guideLogName, anchorDateMs: garun.starts, targetMs })`. Guide-log name comes from `logStore.meta`.
- `useChartGestures` uses pointer events; a separate `dblclick` listener doesn't conflict (double-click pan-reset is already disabled via `doubleClick:false`).
- Guard: do nothing when `garun.starts == null` (can't match clock times) — show the error dialog "debug match needs a timestamped log".

### Access policy
Auto-find via the folder directory handle; if unavailable or the file isn't there, the error state offers a **"Pick debug log…"** button (cached per guide-log name for the session, like the Backlash tab).

## Errors → dialog (DebugLogViewer error state)
- Debug log not found in the folder (and no pick yet).
- Permission denied on the directory handle.
- Picked file fails `validateDebugLogHeader` (not a PHD2 debug log).
- No timestamp on the sample (unguided/no `starts`).

## Testing
- **Unit (vitest):**
  - `parseDebugTimes`: parses `HH:MM:SS.mmm`; carries forward non-timestamped lines; midnight rollover adds a day.
  - `findClosestTimeIndex`: exact, between-two (nearest), before-first, after-last, empty.
  - `analyze()` populates `frame`/`raRaw`/`decRaw` aligned with `t` (extend an existing analyze test).
- **Type/build:** `tsc --noEmit` clean; full `vitest run` green.
- **Browser (Playwright):** on `sample data/QuarkPHD2_GuideLog_2026-06-05_223909.txt` (has a sibling debug log? if not, use `sample data/blt sample data/` pair): readout shows clock·frame·RA(raw)·Dec(raw); double-click opens the viewer scrolled to the matching line; missing-file path shows the error + pick button.

## Out of scope / non-goals
- No external-app launch / external-editor control (browser can't).
- No editing of the debug log; read-only viewer.
- The "editable Primary period" periodogram request is a **separate, later phase** (memory `project_editable_primary_period`).
- Spike/Simple/Burst tabs unchanged (hidden; use their own charts).

## Rollback
Additive; confined to `web/`. Revert = the feature branch commits. New `GARun` arrays are optional consumers; default behavior unchanged when not double-clicking.
