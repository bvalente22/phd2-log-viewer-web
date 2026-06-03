# Sidebar Resize + Analysis Hover-Strip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a draggable handle to resize the left sidebar (persisted width, double-click reset), and move hover values off the three visible analysis charts into a readout strip beneath each, matching the main GuideGraph pattern.

**Architecture:** Sidebar width becomes a persisted `viewStore` field with a pure clamp helper (unit-tested); a new `SidebarResizer` component on the sidebar/main boundary drives it via pointer capture. The analysis hover change sets `hoverinfo:'none'` on traces (keeps the cursor spike + `plotly_hover` event, kills the floating popup) so the existing/added bottom strips become the single readout. Chart interactions are browser-verified (no Plotly unit-test harness in this repo).

**Tech Stack:** React + TypeScript, zustand (`persist`), react-plotly.js, Tailwind, vitest, Playwright MCP for browser verification.

Spec: `docs/superpowers/specs/2026-06-03-sidebar-resize-and-analysis-hover-strip-design.md`

---

## File Structure

- `web/src/state/viewStore.ts` — add `sidebarWidth` state, `setSidebarWidth`, `clampSidebarWidth` helper + bound constants, persist entry. (modify)
- `web/src/state/__tests__/viewStore.test.ts` — unit test for `clampSidebarWidth`. (create)
- `web/src/components/SidebarResizer.tsx` — the drag handle. (create)
- `web/src/pages/ViewerPage.tsx` — use `sidebarWidth` in the grid template; render `<SidebarResizer/>` right of the hide bar. (modify)
- `web/src/i18n/locales/en/common.json` — `sidebar.resizeTooltip` key. (modify)
- `web/src/components/DriftChart.tsx` — traces `hoverinfo:'none'`. (modify)
- `web/src/components/PeriodogramChart.tsx` — active trace `hoverinfo:'none'`, remove dead `activeHoverTemplate`/`customdata`. (modify)
- `web/src/components/ManualSpikeChart.tsx` — traces `hoverinfo:'none'`, add bottom strip + `onHover`/`onUnhover`. (modify)
- `web/src/i18n/locales/en/analysis.json` — `manualSpike.hoverTooltip` key. (modify)

---

## Task 1: viewStore — sidebarWidth state + clamp helper (TDD)

**Files:**
- Modify: `web/src/state/viewStore.ts`
- Test: `web/src/state/__tests__/viewStore.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `web/src/state/__tests__/viewStore.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { clampSidebarWidth, SIDEBAR_MIN, SIDEBAR_MAX, SIDEBAR_DEFAULT } from '../viewStore';

describe('clampSidebarWidth', () => {
  it('passes through an in-range value', () => {
    expect(clampSidebarWidth(300)).toBe(300);
  });
  it('clamps below the minimum', () => {
    expect(clampSidebarWidth(50)).toBe(SIDEBAR_MIN);
  });
  it('clamps above the maximum', () => {
    expect(clampSidebarWidth(9999)).toBe(SIDEBAR_MAX);
  });
  it('exposes a default within bounds', () => {
    expect(SIDEBAR_DEFAULT).toBeGreaterThanOrEqual(SIDEBAR_MIN);
    expect(SIDEBAR_DEFAULT).toBeLessThanOrEqual(SIDEBAR_MAX);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/state/__tests__/viewStore.test.ts`
Expected: FAIL — `clampSidebarWidth`/`SIDEBAR_MIN` not exported.

- [ ] **Step 3: Add constants + helper near the top of `viewStore.ts`**

After the existing `export type GraphMode = ...` line (around line 9), add:

```ts
/** Sidebar width bounds (px). Drag-resize is clamped to this range. */
export const SIDEBAR_MIN = 180;
export const SIDEBAR_MAX = 480;
export const SIDEBAR_DEFAULT = 260;
export const clampSidebarWidth = (n: number): number =>
  Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, n));
```

- [ ] **Step 4: Add the state field, setter type, default, and setter impl**

In the `ViewState` interface, right after `sidebarCollapsed: boolean;` (line 71) add:

```ts
  /** Expanded-sidebar width in px. Persisted; clamped to [SIDEBAR_MIN,
   *  SIDEBAR_MAX]. Ignored while `sidebarCollapsed` (the rail is fixed 16px). */
  sidebarWidth: number;
```

In the setter type block, right after `setSidebarCollapsed: (b: boolean) => void;` (line 102) add:

```ts
  setSidebarWidth: (n: number) => void;
```

In the store body, right after the `sidebarCollapsed: false,` default (line 140) add:

```ts
  sidebarWidth: SIDEBAR_DEFAULT,
```

In the store body, right after `setSidebarCollapsed: (b) => set({ sidebarCollapsed: b }),` (line 159) add:

```ts
  setSidebarWidth: (n) => set({ sidebarWidth: clampSidebarWidth(n) }),
```

In the `partialize` block, right after `sidebarCollapsed: s.sidebarCollapsed,` (line 293) add:

```ts
    sidebarWidth: s.sidebarWidth,
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd web && npx vitest run src/state/__tests__/viewStore.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add web/src/state/viewStore.ts web/src/state/__tests__/viewStore.test.ts
git commit -m "feat: persisted sidebarWidth state + clamp helper"
```

---

## Task 2: SidebarResizer component + wire into ViewerPage

**Files:**
- Create: `web/src/components/SidebarResizer.tsx`
- Modify: `web/src/pages/ViewerPage.tsx`
- Modify: `web/src/i18n/locales/en/common.json`

- [ ] **Step 1: Add the i18n tooltip key**

In `web/src/i18n/locales/en/common.json`, inside the `"sidebar"` object (after `"expandTooltip"`, line 50), add a trailing comma to that line and insert:

```json
    "resizeTooltip": "Drag to resize the sidebar. Double-click to reset to the default width."
```

- [ ] **Step 2: Create `web/src/components/SidebarResizer.tsx`**

```tsx
import { useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useViewStore,
  SIDEBAR_MIN,
  SIDEBAR_MAX,
  SIDEBAR_DEFAULT,
} from '../state/viewStore';

/**
 * Drag handle on the sidebar/main boundary (rendered right of the collapse
 * bar) that resizes the expanded sidebar. Uses pointer capture so the drag
 * keeps tracking when the cursor leaves the thin strip or the window. The
 * store clamps the width to [SIDEBAR_MIN, SIDEBAR_MAX]; double-click resets
 * to SIDEBAR_DEFAULT. Only mount this when the sidebar is expanded.
 */
export function SidebarResizer() {
  const { t } = useTranslation('common');
  const width = useViewStore((s) => s.sidebarWidth);
  const setWidth = useViewStore((s) => s.setSidebarWidth);
  // Drag origin captured on pointerdown; null when not dragging.
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      drag.current = { startX: e.clientX, startWidth: width };
      e.currentTarget.setPointerCapture(e.pointerId);
      // Suppress text selection across the whole page during the drag.
      document.body.style.userSelect = 'none';
    },
    [width],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const d = drag.current;
      if (!d) return;
      setWidth(d.startWidth + (e.clientX - d.startX));
    },
    [setWidth],
  );

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    document.body.style.userSelect = '';
  }, []);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={width}
      aria-valuemin={SIDEBAR_MIN}
      aria-valuemax={SIDEBAR_MAX}
      title={t('sidebar.resizeTooltip')}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={() => setWidth(SIDEBAR_DEFAULT)}
      className="w-1.5 flex-shrink-0 cursor-col-resize bg-slate-800 transition-colors hover:bg-sky-600/60"
    />
  );
}
```

- [ ] **Step 3: Wire width into ViewerPage grid**

In `web/src/pages/ViewerPage.tsx`, add to the store selectors (after line 36
`const setSidebarCollapsed = ...`):

```ts
  const sidebarWidthPx = useViewStore((s) => s.sidebarWidth);
```

Change the `sidebarWidth` constant (line 68) from:

```ts
  const sidebarWidth = sidebarCollapsed ? '16px' : '260px';
```

to:

```ts
  const sidebarWidth = sidebarCollapsed ? '16px' : `${sidebarWidthPx}px`;
```

- [ ] **Step 4: Render the resizer right of the hide bar**

Add the import near the other component imports at the top of `ViewerPage.tsx`:

```ts
import { SidebarResizer } from '../components/SidebarResizer';
```

In the expanded-sidebar JSX, the hide-bar `<button>` (the `‹` collapse button)
is the last child before the closing `</>` of the expanded branch. Immediately
**after** that closing `</button>` and before the `</>`, add:

```tsx
            <SidebarResizer />
```

So the expanded branch ends `…</button><SidebarResizer /></>`, placing the
resizer to the right of the hide bar on the sidebar/main boundary.

- [ ] **Step 5: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Browser-verify the resizer**

Ensure the dev server is running (`http://localhost:5174/phd2-log-viewer-web/`).
With Playwright MCP: load a sample log so the sidebar shows sessions. Then:
- Drag the handle (the thin strip on the right edge of the sidebar, right of
  the `‹` bar) left and right — the sidebar grows/shrinks and pins at the
  bounds (can't go narrower than ~180px or wider than ~480px).
- Double-click the handle — width snaps back to 260px.
- Reload the page — the last dragged width is restored (persisted).
- Click `‹` to collapse — the 16px rail shows and the resizer is gone; click
  `›` to expand — the persisted width returns.

- [ ] **Step 7: Commit**

```bash
git add web/src/components/SidebarResizer.tsx web/src/pages/ViewerPage.tsx web/src/i18n/locales/en/common.json
git commit -m "feat: draggable sidebar resize handle (persisted, dbl-click reset)"
```

---

## Task 3: DriftChart — move hover values fully into the strip

**Files:**
- Modify: `web/src/components/DriftChart.tsx`

- [ ] **Step 1: Replace the RA trace popup with `hoverinfo:'none'`**

In the `traces` memo, the RA trace (around line 79-84) currently ends with:

```ts
        name: 'RA', line: { color: RA_COLOR, width: 1.5 },
        hovertemplate: 'RA: %{y:.2f}<extra></extra>',
```

Change the `hovertemplate` line to:

```ts
        name: 'RA', line: { color: RA_COLOR, width: 1.5 },
        // Values live in the readout strip below (onHover); hide the floating
        // popup but keep the plotly_hover event + cursor spike. Mirrors
        // GuideGraph's hoverinfo:'none' pattern.
        hoverinfo: 'none',
```

- [ ] **Step 2: Replace the Dec trace popup with `hoverinfo:'none'`**

The Dec trace (around line 86-93) currently ends with:

```ts
        name: 'Dec', line: { color: DEC_COLOR, width: 1.5 },
        hovertemplate: 'Dec: %{y:.2f}<extra></extra>',
```

Change the `hovertemplate` line to:

```ts
        name: 'Dec', line: { color: DEC_COLOR, width: 1.5 },
        hoverinfo: 'none',
```

- [ ] **Step 3: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Browser-verify**

In the Analysis modal (open via the Analysis button on a guiding section),
on the **Raw RA** tab, hover the top drift chart:
- No floating `RA:`/`Dec:` value box appears on the plot.
- The vertical cursor spike still tracks the mouse.
- The bottom strip shows `Time: … Y: …`.
- Drag (X pan + Y zoom) and wheel zoom still work.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/DriftChart.tsx
git commit -m "feat: drift chart hover values move to the strip (no on-chart popup)"
```

---

## Task 4: PeriodogramChart — drop the on-chart popup + dead template

**Files:**
- Modify: `web/src/components/PeriodogramChart.tsx`

- [ ] **Step 1: Set the active trace to `hoverinfo:'none'` and remove customdata**

In the `traces` builder, the active trace push (ends around line 251-268)
currently includes:

```ts
      customdata: otherY ?? undefined,
      hovertemplate: activeHoverTemplate,
    } as Data);
```

Replace those two property lines with a single `hoverinfo`:

```ts
      // Values live in the readout strip below (onHover); hide the floating
      // popup but keep the plotly_hover event + cursor spike. Mirrors
      // GuideGraph's hoverinfo:'none' pattern.
      hoverinfo: 'none',
    } as Data);
```

- [ ] **Step 2: Remove the now-dead `activeHoverTemplate` + `otherY` plumbing**

Delete the block that builds `activeHoverTemplate` (the `let activeHoverTemplate:
string;` through its `if/else` assigning it, around lines 229-250) and the
`otherY` constant (around lines 225-228), since nothing references them after
Step 1.

Verify (grep) that `customdata`, `activeHoverTemplate`, and `otherY` have no
remaining references in `PeriodogramChart.tsx`:

Run: `cd web && grep -n "activeHoverTemplate\|customdata\|otherY" src/components/PeriodogramChart.tsx`
Expected: no matches (the `onHover` readout reads `garunOther.fftSpline` directly,
not `customdata`).

- [ ] **Step 3: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: no errors (no unused-var complaints for the removed locals).

- [ ] **Step 4: Browser-verify**

In the Analysis modal, on **Raw RA** and **Residual error** tabs, hover the
periodogram (bottom chart):
- No floating `Period / Raw RA / Residual` box on the plot.
- The vertical cursor spike still tracks.
- The bottom strip shows `Period: … Raw RA: … Residual error: …`.
- Numbered peak chips, drag, right-drag, and wheel zoom still work.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/PeriodogramChart.tsx
git commit -m "feat: periodogram hover values move to the strip (remove on-chart popup)"
```

---

## Task 5: ManualSpikeChart — add a readout strip + move hover into it

**Files:**
- Modify: `web/src/components/ManualSpikeChart.tsx`
- Modify: `web/src/i18n/locales/en/analysis.json`

- [ ] **Step 1: Add the strip tooltip i18n key**

In `web/src/i18n/locales/en/analysis.json`, inside the `"manualSpike"` object,
add after the `"gestureHint"` entry (add a comma to that line first):

```json
    "hoverTooltip": "Detrended value under the cursor. The vertical line tracks the cursor on the chart; the value shows here. Move the mouse off the chart to clear."
```

- [ ] **Step 2: Add hover state + import `useState`/`useCallback`**

At the top of `ManualSpikeChart.tsx`, ensure the React import includes
`useState` and `useCallback` (it already imports several hooks — add any that
are missing to the existing `import { … } from 'react';` line).

Inside the component body (near the other hooks, after the existing state),
add:

```ts
  const [hover, setHover] = useState<string | null>(null);
```

- [ ] **Step 3: Set both traces to `hoverinfo:'none'`**

In the `traces` memo, the detrended line trace (around line 178) has:

```ts
        hovertemplate: `t=%{x:.2f}s · y=%{y:.2f}${unit}<extra></extra>`,
```

Replace with:

```ts
        // Value goes to the readout strip below (onHover); keep the cursor
        // spike + plotly_hover, hide the floating popup.
        hoverinfo: 'none',
```

The selected-markers trace (around line 193) has:

```ts
        hovertemplate: `${t('manualSpike.selectedHover')}<br>t=%{x:.2f}s · y=%{y:.2f}${unit}<extra></extra>`,
```

Replace with:

```ts
        hoverinfo: 'none',
```

- [ ] **Step 4: Add `onHover`/`onUnhover` handlers**

After the `traces` memo (and before the `layout` object), add:

```ts
  // Fill the readout strip from the hovered point. selectedIndices carry the
  // picks; flag when the cursor lands on one so the user knows it's selected.
  const onHover = useCallback((ev: { points?: Array<{ x?: number; y?: number }> }) => {
    const x = ev.points?.[0]?.x;
    const y = ev.points?.[0]?.y;
    if (typeof x !== 'number' || typeof y !== 'number') return;
    const yPx = scaleMode === 'ARCSEC' ? y / run.pixelScale : y;
    const yArc = scaleMode === 'ARCSEC' ? y : y * run.pixelScale;
    const onPick = selectedIndices.some((i) => run.t[i] === x);
    setHover(
      `t=${x.toFixed(2)}s · y=${yArc.toFixed(2)}″ (${yPx.toFixed(2)}px)` +
        (onPick ? ' · selected' : ''),
    );
  }, [run, scaleMode, selectedIndices]);

  const onUnhover = useCallback(() => setHover(null), []);
```

- [ ] **Step 5: Wrap the Plot in a flex column with the strip beneath**

Replace the component's return block (currently `<div className="h-full"><Plot
…/></div>`) with:

```tsx
  return (
    <div className="flex h-full flex-col">
      <div className="flex-1">
        <Plot
          divId={id}
          data={traces}
          layout={layout}
          config={{ displayModeBar: false, responsive: true, scrollZoom: true, doubleClick: false }}
          style={{ width: '100%', height: '100%' }}
          useResizeHandler
          onHover={onHover as never}
          onUnhover={onUnhover}
        />
      </div>
      <div
        className="min-h-[24px] border-t border-slate-800 bg-slate-900/40 px-3 py-1 font-mono text-[11px] text-slate-300"
        title={t('manualSpike.hoverTooltip')}
      >
        {hover ?? ' '}
      </div>
    </div>
  );
```

- [ ] **Step 6: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Browser-verify**

In the Analysis modal, open the **Manual Spike** tab and hover the chart:
- No floating `t=… · y=…` box on the plot.
- The vertical cursor spike still tracks.
- The new bottom strip shows `t=…s · y=…″ (…px)`, appending ` · selected` when
  over a picked point.
- Left-click still adds a pick, right-click still removes one (the strip is
  present and the plot area is ~24px shorter).
- Drag / wheel zoom still work; the threshold slider preview line still draws.

- [ ] **Step 8: Commit**

```bash
git add web/src/components/ManualSpikeChart.tsx web/src/i18n/locales/en/analysis.json
git commit -m "feat: manual-spike chart gains a hover readout strip (no on-chart popup)"
```

---

## Task 6: Full verification + e2e guard

**Files:** none (verification only)

- [ ] **Step 1: Check e2e specs don't assert on removed popups**

Run: `cd web && grep -n "hovertemplate\|RA: \|Period:\|t=%" e2e/analysis.spec.ts e2e/spike-analysis.spec.ts`
Expected: no assertions that depend on an on-chart hover popup. If any exist,
update them to read the bottom strip text instead (the strip is a `div`
following the Plotly chart; assert its text content).

- [ ] **Step 2: Full typecheck + unit tests**

Run: `cd web && npx tsc --noEmit && npx vitest run`
Expected: tsc clean; all vitest tests pass (including the new
`viewStore.test.ts`).

- [ ] **Step 3: Full browser regression pass (dark + one light theme)**

With the dev server up, in both the Dark and Paper themes:
- Resize the sidebar (drag, clamp, double-click reset, persist across reload,
  collapse/expand).
- Analysis modal: hover Raw RA, Residual error, and Manual Spike charts —
  confirm no on-chart popups, cursor spikes track, strips fill, gestures and
  Manual-Spike picking all work.

- [ ] **Step 4: Final commit (if any e2e tweaks were needed)**

```bash
git add -A
git commit -m "test: align analysis e2e with strip-based hover readout"
```

(Skip if Step 1 required no changes.)

---

## Self-Review

- **Spec coverage:** Part 1 (state + clamp Task 1; resizer + wiring + tooltip
  Task 2). Part 2 (DriftChart Task 3; PeriodogramChart Task 4; ManualSpikeChart
  strip Task 5). Persistence (Task 1 partialize + Task 2 reload check). Reset
  (Task 2 double-click). Scope-out hidden charts (untouched). Testing (Task 6).
  No gaps.
- **Placeholders:** none — every code step shows the exact edit.
- **Type/name consistency:** `clampSidebarWidth`, `SIDEBAR_MIN/MAX/DEFAULT`,
  `sidebarWidth`, `setSidebarWidth` used identically across Tasks 1–2;
  `hoverinfo:'none'` consistent across Tasks 3–5; `hover`/`setHover` local to
  ManualSpikeChart Task 5.
