# Inline Event Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the desktop "Events" checkbox to the web viewer — a per-section toggle that draws each `INFO` event's text inline on the time graph, with row-stacked collision avoidance, anchored to the chart bottom via Plotly annotations.

**Architecture:** A pure helper (`eventLayout.ts`) computes screen-pixel row stacking from `(timeSec, text)` tuples + a `pxPerSecond` factor + a `measureTextPx` callback (so it's deterministic in tests). `GuideGraph` consumes that helper inside its `useMemo` data block when `traces.events` is on, builds Plotly annotations, and re-runs the helper on `relayout` to keep stacking correct as the user zooms.

**Tech Stack:** React 18, TypeScript, Zustand (with `persist`), Plotly.js (`annotations` array on `layout`), Vitest, Playwright.

**Reference spec:** `docs/superpowers/specs/2026-05-02-phd2-inline-event-labels-design.md`

**Reference C++ source:** `LogViewFrame.cpp:1814-1842`

---

## File Structure

**Create:**

| File | Responsibility |
| --- | --- |
| `web/src/components/eventLayout.ts` | Pure row-stacking helper. No DOM, no Plotly, no React imports. |
| `web/src/components/__tests__/eventLayout.test.ts` | Vitest unit tests for the helper. |
| `web/e2e/events.spec.ts` | Playwright e2e for the toolbar toggle + DOM annotation count. |

**Modify:**

| File | Reason |
| --- | --- |
| `web/src/state/viewStore.ts` | Add `events: boolean` to `TraceVisibility` and the initial `traces` object. |
| `web/src/components/GraphToolbar.tsx` | Append `Events` chip to the `show:` row. |
| `web/src/components/GuideGraph.tsx` | Read `traces.events`, derive annotations from `s.infos`, pass to layout, re-derive on `relayout`. |

No file split is warranted; `GuideGraph.tsx` is already large (~630 lines) but every modification in this plan is contained to clearly-bounded blocks.

---

## Pre-Flight

The web app lives in `web/`. All `npm` / `npx` commands in this plan run from inside `web/`. The plan assumes working tree is clean and on `main` (the parent repo, which is the one with the worktree under `web/`). The pre-commit hook auto-bumps `package.json` patch version unless `package.json` is already in the staged diff — that means **commits in this plan will produce versions v0.4.1 → v0.4.7** (one bump per commit). That's expected.

Subagent commits don't always propagate cleanly to the orchestrator's shell, so when this plan is executed by subagents the orchestrator should commit after each task on the subagent's behalf. Inline executors can commit directly.

---

## Task 1: Add `events` flag to `TraceVisibility`

Add the new boolean to the view-store type, default value, and persist allow-list.

**Files:**
- Modify: `web/src/state/viewStore.ts:10-17`
- Modify: `web/src/state/viewStore.ts:68`
- Modify: `web/src/state/viewStore.ts:140-149`

- [ ] **Step 1: Add `events` to the `TraceVisibility` interface**

In `web/src/state/viewStore.ts`, replace lines 10-17:

```ts
export interface TraceVisibility {
  ra: boolean;
  dec: boolean;
  raPulses: boolean;
  decPulses: boolean;
  mass: boolean;
  snr: boolean;
  events: boolean;
}
```

- [ ] **Step 2: Add `events: false` to the initial `traces` object**

In `web/src/state/viewStore.ts`, replace line 68:

```ts
  traces: { ra: true, dec: true, raPulses: true, decPulses: true, mass: false, snr: false, events: false },
```

- [ ] **Step 3: Run typecheck to verify nothing else breaks**

Run from `web/`:

```
npx tsc --noEmit
```

Expected: PASS — no errors. (`toggleTrace` already takes `keyof TraceVisibility`, so it picks up the new key automatically.)

- [ ] **Step 4: Run the existing vitest suite**

Run from `web/`:

```
npx vitest run
```

Expected: all existing tests still PASS (81 tests).

- [ ] **Step 5: Commit**

```
git add web/src/state/viewStore.ts
git commit -m "Add events flag to TraceVisibility (default off)"
```

---

## Task 2: Pure helper — `layoutInlineEvents`

Implement and unit-test the row-stacking helper. This is the heart of the feature: given events sorted by time, a `pxPerSecond` factor, and a way to measure text width, return each event tagged with its `row`.

**Files:**
- Create: `web/src/components/eventLayout.ts`
- Test: `web/src/components/__tests__/eventLayout.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `web/src/components/__tests__/eventLayout.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { layoutInlineEvents } from '../eventLayout';

// Fixed-width measurer: every character is 6 px wide. Keeps the assertions
// deterministic regardless of how the runtime canvas API would behave.
const fixedWidth = (text: string) => text.length * 6;

describe('layoutInlineEvents', () => {
  it('returns [] for empty input', () => {
    expect(layoutInlineEvents([], 1, fixedWidth)).toEqual([]);
  });

  it('places a single event on row 0', () => {
    const out = layoutInlineEvents(
      [{ timeSec: 0, text: 'A', isDither: false }],
      1,
      fixedWidth,
    );
    expect(out).toHaveLength(1);
    expect(out[0].row).toBe(0);
  });

  it('keeps two well-separated events on row 0', () => {
    // event A: t=0, "A" (6 px wide). event B: t=100s, "B" (6 px). At
    // pxPerSecond=1 the second sits at xpos=100, far past A_end+10=16.
    const out = layoutInlineEvents(
      [
        { timeSec: 0, text: 'A', isDither: false },
        { timeSec: 100, text: 'B', isDither: false },
      ],
      1,
      fixedWidth,
    );
    expect(out.map((o) => o.row)).toEqual([0, 0]);
  });

  it('promotes the second of two overlapping events to row 1', () => {
    // event A: t=0, "AAAAA" (30 px). event B: t=1s. xpos_B=1 < 30+10=40 → row=1.
    const out = layoutInlineEvents(
      [
        { timeSec: 0, text: 'AAAAA', isDither: false },
        { timeSec: 1, text: 'BBBBB', isDither: true },
      ],
      1,
      fixedWidth,
    );
    expect(out.map((o) => o.row)).toEqual([0, 1]);
  });

  it('stacks three progressively closer events as 0, 1, 2', () => {
    // A at t=0 ("AAAAA" 30px). B at t=1s overlaps → row 1, prev_end=36.
    // C at t=2s, xpos=2 < 36+10=46 → row=2.
    const out = layoutInlineEvents(
      [
        { timeSec: 0, text: 'AAAAA', isDither: false },
        { timeSec: 1, text: 'BBBBB', isDither: false },
        { timeSec: 2, text: 'CCCCC', isDither: false },
      ],
      1,
      fixedWidth,
    );
    expect(out.map((o) => o.row)).toEqual([0, 1, 2]);
  });

  it('zooming in (more px per second) breaks an overlap apart', () => {
    // Same input as the overlap test, but pxPerSecond=100. xpos_B=100 >> 30+10.
    const out = layoutInlineEvents(
      [
        { timeSec: 0, text: 'AAAAA', isDither: false },
        { timeSec: 1, text: 'BBBBB', isDither: true },
      ],
      100,
      fixedWidth,
    );
    expect(out.map((o) => o.row)).toEqual([0, 0]);
  });

  it('zooming out (fewer px per second) creates an overlap', () => {
    // Two events 200s apart, narrow text. At pxPerSecond=0.05 they sit at
    // xpos=0 and xpos=10 px. With width 6 px and gap 10 px → second is at 10
    // which is NOT < prev_end(6)+10 = 16... we need them closer. Use
    // pxPerSecond=0.02: xpos_B = 4. 4 < 16 → row 1.
    const out = layoutInlineEvents(
      [
        { timeSec: 0, text: 'A', isDither: false },
        { timeSec: 200, text: 'B', isDither: false },
      ],
      0.02,
      fixedWidth,
    );
    expect(out.map((o) => o.row)).toEqual([0, 1]);
  });

  it('preserves the input text and isDither flag verbatim', () => {
    const out = layoutInlineEvents(
      [
        { timeSec: 5, text: 'DITHER 0.5, 0.5 ×3', isDither: true },
      ],
      1,
      fixedWidth,
    );
    expect(out[0].text).toBe('DITHER 0.5, 0.5 ×3');
    expect(out[0].isDither).toBe(true);
    expect(out[0].timeSec).toBe(5);
  });

  it('sorts unsorted input ascending before laying out', () => {
    // Caller may pass already-sorted infos, but the helper guards against
    // reordering. With pxPerSecond=1, A@0 and C@100 are far apart; if the
    // helper sorts, both rows = 0. If it didn't, the t=100 → t=0 jump would
    // produce nonsense rows.
    const out = layoutInlineEvents(
      [
        { timeSec: 100, text: 'C', isDither: false },
        { timeSec: 0, text: 'A', isDither: false },
      ],
      1,
      fixedWidth,
    );
    expect(out.map((o) => o.timeSec)).toEqual([0, 100]);
    expect(out.map((o) => o.row)).toEqual([0, 0]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run from `web/`:

```
npx vitest run src/components/__tests__/eventLayout.test.ts
```

Expected: FAIL with `Cannot find module '../eventLayout'`.

- [ ] **Step 3: Write the helper**

Create `web/src/components/eventLayout.ts`:

```ts
/**
 * Pure row-stacking layout for inline INFO event labels on the time graph.
 *
 * Ports the desktop algorithm in LogViewFrame.cpp:1814-1842, which decides
 * row placement in screen-pixel space (not data units): two labels share a
 * row only if the next label's left edge sits beyond the previous label's
 * right edge plus a 10 px breathing-room gap. When they don't, the new
 * label is bumped onto a higher row, and `prev_end` continues to track the
 * widest right-edge seen so far so subsequent labels also know to stack.
 *
 * The helper is deliberately UI-agnostic: the caller injects pxPerSecond
 * (derived from the current x-axis range and chart pixel width) and a
 * measurement function (a memoized canvas measureText in production, a
 * fixed-width fake in tests). That keeps the row math testable without a
 * DOM.
 */

export interface EventInput {
  /** Time of the event, in seconds since the session start. */
  timeSec: number;
  /** The label string already formatted (caller appends "×N" for repeats). */
  text: string;
  /** True for DITHER events; controls border color upstream. */
  isDither: boolean;
}

export interface EventLayoutItem extends EventInput {
  /** 0-indexed row from the bottom. row=0 = lowest, row=1 = stacked above. */
  row: number;
}

export type MeasureTextFn = (text: string) => number;

const PIXEL_GAP = 10; // matches the `prev_end + 10` guard in the desktop code

export function layoutInlineEvents(
  events: ReadonlyArray<EventInput>,
  pxPerSecond: number,
  measureTextPx: MeasureTextFn,
): EventLayoutItem[] {
  if (events.length === 0) return [];

  // Defensive sort. The parser inserts infos in time order, but a misuse
  // upstream shouldn't silently produce garbage rows.
  const sorted = [...events].sort((a, b) => a.timeSec - b.timeSec);

  const out: EventLayoutItem[] = [];
  let prevEndPx = -Infinity;
  let row = 0;

  for (const ev of sorted) {
    const xPosPx = ev.timeSec * pxPerSecond;
    const widthPx = measureTextPx(ev.text);

    if (xPosPx < prevEndPx + PIXEL_GAP) {
      row += 1;
    } else {
      row = 0;
    }

    if (xPosPx + widthPx > prevEndPx) {
      prevEndPx = xPosPx + widthPx;
    }

    out.push({ ...ev, row });
  }

  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run from `web/`:

```
npx vitest run src/components/__tests__/eventLayout.test.ts
```

Expected: all 9 test cases PASS.

- [ ] **Step 5: Run the full test suite to confirm no regressions**

Run from `web/`:

```
npx vitest run
```

Expected: previous total + 9 new = 90 PASS.

- [ ] **Step 6: Commit**

```
git add web/src/components/eventLayout.ts web/src/components/__tests__/eventLayout.test.ts
git commit -m "Add pure layoutInlineEvents helper + tests"
```

---

## Task 3: Toolbar `Events` chip

Surface the toggle in the `show:` row of the existing toolbar.

**Files:**
- Modify: `web/src/components/GraphToolbar.tsx:103-110`

- [ ] **Step 1: Add the new chip definition**

In `web/src/components/GraphToolbar.tsx`, replace lines 103-110:

```ts
  const items: { key: keyof TraceVisibility; label: string; title: string }[] = [
    { key: 'ra', label: 'RA', title: 'Show/hide the RA error trace' },
    { key: 'dec', label: 'Dec', title: 'Show/hide the Dec error trace' },
    { key: 'raPulses', label: 'RA pulses', title: 'Show/hide RA correction pulse durations as bars on the 0 line' },
    { key: 'decPulses', label: 'Dec pulses', title: 'Show/hide Dec correction pulse durations as bars on the 0 line' },
    { key: 'mass', label: 'Mass', title: 'Show/hide guide-star mass (yellow), scaled to the bottom half of the chart' },
    { key: 'snr', label: 'SNR', title: 'Show/hide guide-star SNR (white), scaled to the bottom half of the chart' },
    { key: 'events', label: 'Events', title: 'Show INFO events as inline labels along the bottom of the chart (matches the desktop "events" checkbox)' },
  ];
```

- [ ] **Step 2: Typecheck**

Run from `web/`:

```
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 3: Run the e2e smoke test**

Run from `web/` (Vite dev server must be running, or the Playwright config will start one):

```
npx playwright test e2e/smoke.spec.ts
```

Expected: PASS — adding a chip doesn't break anything else.

- [ ] **Step 4: Commit**

```
git add web/src/components/GraphToolbar.tsx
git commit -m "Add Events toggle chip to graph toolbar"
```

---

## Task 4: Build event-input list inside `GuideGraph`'s `useMemo`

Compute the list of `(timeSec, text, isDither)` tuples once per data-derivation cycle, when `traces.events` is on. Don't compute the row layout yet — that depends on chart pixel width which we don't have inside `useMemo`. We only assemble the input.

**Files:**
- Modify: `web/src/components/GuideGraph.tsx:330-400`

- [ ] **Step 1: Build the event input list inside the data `useMemo`**

In `web/src/components/GuideGraph.tsx`, locate the existing `useMemo` body that returns `{ session, sessionIdx, hasAo, yMax, xExtent, traces, shapes }` (lines 330-400). Replace the `return` block with the version below, which adds an `events` field. Everything before the `return` stays untouched.

```ts
    const eventInputs: { timeSec: number; text: string; isDither: boolean }[] = [];
    if (traces.events) {
      for (const info of session.infos) {
        const entry = session.entries[info.idx];
        if (!entry) continue;
        const text = info.repeats > 1 ? `${info.info} ×${info.repeats}` : info.info;
        eventInputs.push({
          timeSec: entry.dt,
          text,
          isDither: info.info.startsWith('DITHER'),
        });
      }
    }

    return {
      session,
      sessionIdx: sec.idx,
      hasAo,
      yMax,
      xExtent,
      traces: buildTraces(session, traces, scaleMode, yMax, coordMode, device, hasAo),
      shapes: buildShapes(session, mask),
      eventInputs,
    };
```

- [ ] **Step 2: Typecheck and run unit tests**

Run from `web/`:

```
npx tsc --noEmit && npx vitest run
```

Expected: PASS. (No new tests yet — this just plumbs the data.)

- [ ] **Step 3: Commit**

```
git add web/src/components/GuideGraph.tsx
git commit -m "Plumb event-label inputs through GuideGraph useMemo"
```

---

## Task 5: Wire annotations into the layout + relayout-on-zoom

Compute the actual annotation array using `layoutInlineEvents`, place them in `layout.annotations` on initial render, and re-derive on `onRelayout` so row stacking stays accurate as the user zooms.

**Files:**
- Modify: `web/src/components/GuideGraph.tsx` — imports near the top, the `onRelayout` callback (lines 526-552), the `layout` block (lines 560-605).

- [ ] **Step 1: Import the helper and `Annotations` type**

At the top of `web/src/components/GuideGraph.tsx`, replace lines 1-11 with:

```ts
import { useMemo, useCallback, useRef, useEffect, useId, useState } from 'react';
import Plot from 'react-plotly.js';
// Use the prebuilt dist to avoid pulling plotly's source modules (which require
// the `buffer/` polyfill not available in the browser bundle path).
// @ts-expect-error -- no types for the dist bundle; we only call relayout.
import Plotly from 'plotly.js/dist/plotly';
import type { Data, Layout, Shape, Annotations } from 'plotly.js';
import { useLogStore } from '../state/logStore';
import { useViewStore } from '../state/viewStore';
import type { GuideSession } from '../parser';
import { useChartGestures } from './useChartGestures';
import { layoutInlineEvents } from './eventLayout';
```

- [ ] **Step 2: Add a helper that turns laid-out events into Plotly annotations**

In `web/src/components/GuideGraph.tsx`, immediately before `function buildShapes` (line 238), add:

```ts
const DITHER_BORDER = 'rgba(168, 85, 247, 0.7)';
const INFO_BORDER = 'rgba(250, 204, 21, 0.55)';

/**
 * Convert laid-out events into Plotly annotation specs. yref:'paper' keeps
 * the labels glued to the bottom of the plot regardless of Y zoom; yshift
 * stacks higher rows upward (row=0 is the bottom row). Border color matches
 * the existing dotted line for that event so the visual link is obvious.
 *
 * 14 px row spacing is intentional: the desktop used 16 px against a larger
 * DC font; the web font is 10 px, so 14 px keeps rows compact with ~4 px of
 * breathing room.
 */
function buildEventAnnotations(
  laidOut: ReturnType<typeof layoutInlineEvents>,
): Partial<Annotations>[] {
  return laidOut.map((ev) => ({
    x: ev.timeSec,
    xref: 'x',
    y: 0,
    yref: 'paper',
    yanchor: 'bottom',
    xanchor: 'left',
    yshift: ev.row * 14,
    text: ev.text,
    showarrow: false,
    bgcolor: 'rgba(15,23,42,0.85)',
    bordercolor: ev.isDither ? DITHER_BORDER : INFO_BORDER,
    borderwidth: 1,
    borderpad: 2,
    font: { size: 10, color: 'rgb(226,232,240)' },
  }));
}
```

- [ ] **Step 3: Add a memoized text measurer and a refresh function**

Inside the `GuideGraph` component, immediately after the `dataRef` line (the `useRef` near line 297) — insert the block below. This adds:

1. `measureTextPxRef` — a session-scoped memo that calls a hidden canvas's `measureText` for each unique label string only once.
2. `refreshAnnotationsRef` — a stable function ref that reads the current chart's pixel width, recomputes the row layout, and pushes new annotations via `Plotly.relayout`.

```ts
  const measureTextPxRef = useRef<((text: string) => number) | null>(null);
  if (!measureTextPxRef.current) {
    const cache = new Map<string, number>();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.font = '10px sans-serif';
    measureTextPxRef.current = (text: string) => {
      const cached = cache.get(text);
      if (cached !== undefined) return cached;
      const w = ctx ? ctx.measureText(text).width : text.length * 6;
      cache.set(text, w);
      return w;
    };
  }

  const refreshAnnotationsRef = useRef<() => void>(() => {});
```

- [ ] **Step 4: Compute annotations for the initial render**

Inside the `GuideGraph` component, after the existing `data = useMemo(...)` block (after line 400), add a second `useMemo` that derives the initial annotation array from current `data` and the *natural* x extent. This is the array Plotly uses on first paint, before the user has zoomed.

Add immediately after the `useEffect(() => { dataRef.current = ... })` block (after line 404):

```ts
  const initialAnnotations = useMemo<Partial<Annotations>[]>(() => {
    if (!data || data.eventInputs.length === 0) return [];
    const measure = measureTextPxRef.current!;
    // Use the natural span of the data for first paint. The relayout
    // handler below recomputes once the chart actually has a real width.
    const span = Math.max(1e-6, data.xExtent[1] - data.xExtent[0]);
    // Assume a ~1000 px chart for first paint; relayout will correct it.
    const pxPerSecond = 1000 / span;
    const laid = layoutInlineEvents(data.eventInputs, pxPerSecond, measure);
    return buildEventAnnotations(laid);
  }, [data]);
```

- [ ] **Step 5: Update `refreshAnnotationsRef` to re-derive from current chart width**

Add the following `useEffect` immediately below the `initialAnnotations` `useMemo` you just inserted:

```ts
  useEffect(() => {
    refreshAnnotationsRef.current = () => {
      const ctx = dataRef.current;
      if (!ctx) return;
      if (!data || data.eventInputs.length === 0) {
        void Plotly.relayout(plotId, { annotations: [] });
        return;
      }
      const div = document.getElementById(plotId) as PlotDiv | null;
      const xa = div?._fullLayout?.xaxis;
      const widthPx = xa?._length ?? div?.clientWidth ?? 1000;
      const range = xa?.range ?? data.xExtent;
      const span = Math.max(1e-6, range[1] - range[0]);
      const pxPerSecond = widthPx / span;
      const measure = measureTextPxRef.current!;
      const laid = layoutInlineEvents(data.eventInputs, pxPerSecond, measure);
      void Plotly.relayout(plotId, { annotations: buildEventAnnotations(laid) });
    };
  }, [data, plotId]);
```

- [ ] **Step 6: Call the refresher from the existing `onRelayout` callback**

In `web/src/components/GuideGraph.tsx`, replace the existing `onRelayout` definition (lines 529-552) with this version. The only change is the final `refreshAnnotationsRef.current?.()` call right before the function ends.

```ts
  const onRelayout = useCallback((ev: Readonly<Record<string, unknown>>) => {
    const idx = dataRef.current?.sessionIdx;
    if (idx === undefined) return;
    const cur = sectionViews.get(idx) ?? {};
    const next = { ...cur };

    const xr0 = ev['xaxis.range[0]'];
    const xr1 = ev['xaxis.range[1]'];
    if (typeof xr0 === 'number' && typeof xr1 === 'number') {
      next.x = [xr0, xr1];
    }
    const yr0 = ev['yaxis.range[0]'];
    const yr1 = ev['yaxis.range[1]'];
    if (typeof yr0 === 'number' && typeof yr1 === 'number') {
      next.y = [yr0, yr1];
      if (scaleLocked) lockedYView = [yr0, yr1];
    }
    if (ev['xaxis.autorange'] === true) next.x = undefined;
    if (ev['yaxis.autorange'] === true) {
      next.y = undefined;
      if (scaleLocked) lockedYView = null;
    }
    sectionViews.set(idx, next);

    // Inline-event labels stack by screen pixels, so the row layout is only
    // valid for the current x-zoom. Re-derive annotations whenever Plotly
    // reports a layout change (wheel zoom, drag, autorange reset, etc.).
    refreshAnnotationsRef.current?.();
  }, [scaleLocked]);
```

- [ ] **Step 7: Pass `annotations` into the layout and refresh once on initial mount**

In `web/src/components/GuideGraph.tsx`, replace the `layout` block (lines 560-605) with:

```ts
  const layout: Partial<Layout> = {
    autosize: true,
    margin: { l: 60, r: 60, t: 20, b: 40 },
    paper_bgcolor: '#0f172a',
    plot_bgcolor: '#0f172a',
    font: { color: '#cbd5e1', size: 11 },
    xaxis: {
      title: { text: 'time (s)' }, gridcolor: '#1e293b', zerolinecolor: '#334155',
      // X is unfixed so Plotly's built-in scrollZoom (config below) can zoom
      // it via the wheel; Plotly handles cursor-anchored zoom correctly. Drag
      // gestures are owned by our custom handlers (Plotly dragmode:false),
      // so leaving fixedrange:false here does not enable any unwanted drag.
      // We always provide an *explicit* range (this section's saved view, or
      // the data extent on first visit) so Plotly never sees autorange:true
      // and the first wheel event can't anchor on a stale 0 offset.
      fixedrange: false,
      range: sectionViews.get(data.sessionIdx)?.x ?? data.xExtent,
      // Compact range-slider thumbnail beneath the chart shows the full
      // session at a glance and lets the user drag to scrub a window.
      rangeslider: {
        visible: true,
        thickness: 0.06,
        bgcolor: '#020617',
        bordercolor: '#1e293b',
        borderwidth: 1,
      },
    },
    yaxis: {
      title: { text: yTitle }, gridcolor: '#1e293b',
      zerolinecolor: '#64748b', zerolinewidth: 1,
      // Y stays fixed so scrollZoom only ever affects X. Our drag handler
      // calls Plotly.relayout({yaxis.range:...}) directly, which bypasses
      // fixedrange.
      fixedrange: true,
      // Y range source: scale-locked global > per-section saved Y > the
      // computed default (auto-Y percentile or raw min/max of this session).
      range: (scaleLocked && lockedYView)
        ? lockedYView
        : sectionViews.get(data.sessionIdx)?.y ?? [-data.yMax, data.yMax],
    },
    shapes: data.shapes,
    annotations: initialAnnotations,
    showlegend: true,
    legend: { orientation: 'h', y: 1.1 },
    dragmode: false,
    barmode: 'overlay',
  };
```

Then, immediately above `if (!data) return ...` (line 554), add a one-shot refresh that runs after the chart has been measured. Insert this `useEffect`:

```ts
  // After the chart mounts and its real pixel width is available, redo the
  // annotation layout so the row spacing reflects the actual chart size
  // (initialAnnotations used a 1000 px guess to avoid a flash of empty).
  useEffect(() => {
    const id = requestAnimationFrame(() => refreshAnnotationsRef.current?.());
    return () => cancelAnimationFrame(id);
  }, [data, traces.events]);
```

- [ ] **Step 8: Typecheck and run unit tests**

Run from `web/`:

```
npx tsc --noEmit && npx vitest run
```

Expected: PASS (90 tests).

- [ ] **Step 9: Run the e2e smoke test**

Run from `web/`:

```
npx playwright test e2e/smoke.spec.ts
```

Expected: PASS — toggle is still off by default, smoke test should be unchanged.

- [ ] **Step 10: Commit**

```
git add web/src/components/GuideGraph.tsx
git commit -m "Render inline event labels via Plotly annotations"
```

---

## Task 6: E2E test for the toggle

Verify in a real browser that the toggle is off by default, that turning it on adds annotations to the DOM, that turning it off removes them, and that the chip is disabled in scatter mode.

**Files:**
- Create: `web/e2e/events.spec.ts`

- [ ] **Step 1: Write the e2e test**

Create `web/e2e/events.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, '..', 'src', 'parser', '__tests__', 'fixtures', 'synthetic.log');

const dropFixture = async (page: import('@playwright/test').Page) => {
  const text = readFileSync(FIXTURE, 'utf-8');
  await page.setInputFiles('input[type=file]', {
    name: 'synthetic.log',
    mimeType: 'text/plain',
    buffer: Buffer.from(text, 'utf-8'),
  });
};

test.describe('Inline event labels', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await dropFixture(page);
    await page.getByText('Guide ·', { exact: false }).first().click();
    await expect(page.locator('.js-plotly-plot')).toBeVisible();
  });

  test('default off — no inline event annotations rendered', async ({ page }) => {
    await expect(page.locator('.js-plotly-plot .annotation-text')).toHaveCount(0);
  });

  test('toggling Events on adds annotations and toggling off removes them', async ({ page }) => {
    const eventsChip = page.getByRole('button', { name: 'Events', exact: true });
    await expect(eventsChip).toBeVisible();

    await eventsChip.click();
    // Synthetic fixture has 4 INFO events. We expect at least 1 annotation
    // because all 4 may collapse-stack into stacked rows but each still
    // produces its own annotation.
    await expect(page.locator('.js-plotly-plot .annotation-text')).toHaveCount(4);

    // At least one annotation contains the synthetic fixture's known text.
    await expect(page.locator('.js-plotly-plot .annotation-text', { hasText: 'state=1' })).toBeVisible();

    await eventsChip.click();
    await expect(page.locator('.js-plotly-plot .annotation-text')).toHaveCount(0);
  });

  test('Events chip is disabled in scatter view', async ({ page }) => {
    const scatterChip = page.getByRole('button', { name: 'scatter', exact: true });
    await scatterChip.click();
    const eventsChip = page.getByRole('button', { name: 'Events', exact: true });
    await expect(eventsChip).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run the e2e test**

Run from `web/`:

```
npx playwright test e2e/events.spec.ts
```

Expected: all three tests PASS.

- [ ] **Step 3: Run the full e2e suite to confirm no regressions**

Run from `web/`:

```
npx playwright test
```

Expected: previous total + 3 new = 30 PASS.

- [ ] **Step 4: Commit**

```
git add web/e2e/events.spec.ts
git commit -m "Add e2e tests for inline event labels toggle"
```

---

## Task 7: Manual verification

Confirm the feature looks right in the live browser before declaring done.

**Files:** None — pure smoke test.

- [ ] **Step 1: Start the dev server (if not already running)**

From `web/`:

```
npm run dev
```

Expected: Vite prints a localhost URL (e.g. `http://localhost:5173`).

- [ ] **Step 2: Open the app and load a real fixture**

Drag any file from `sample data/` (at the repo root) into the drop zone, click into a guiding section, and click `Events` in the toolbar.

**What to look for:**

- Inline labels appear at the bottom of the chart, anchored to dotted vertical lines.
- DITHER labels have a purple border; other INFO labels have a yellow border.
- Adjacent labels stack into rows when they would otherwise overlap.
- Wheel-zooming changes the spacing so labels that were overlapping become separated (and vice versa).
- Toggling `Events` off removes all inline labels but leaves the dotted lines + hover tooltips intact.
- Switching to `scatter` view greys out the `Events` chip.

- [ ] **Step 3: Verify no console errors**

Open DevTools (F12). The Console should be free of red errors for the lifetime of the toggle.

- [ ] **Step 4: Done — final commit allowed if anything was tweaked**

If Steps 1-3 surfaced any visual issue (e.g. wrong row spacing, missed coloring), fix it in `eventLayout.ts` or `GuideGraph.tsx`, re-run `npx vitest run` and `npx playwright test`, and commit:

```
git add web/src/components/eventLayout.ts web/src/components/GuideGraph.tsx
git commit -m "Polish inline event label rendering"
```

If everything looks correct, no extra commit needed. The feature is complete.

---

## Self-Review

**Spec coverage:**

| Spec section | Plan task |
| --- | --- |
| §3 Source-app reference (algorithm) | Task 2 implements the row-stacking algorithm verbatim; Task 5 wires it into Plotly |
| §4.1 Toolbar toggle | Task 3 |
| §4.2 Annotation rendering (`yref:'paper'`, `xanchor`, `bgcolor`, `bordercolor`, `font`, `yshift`) | Task 5 step 2 (`buildEventAnnotations`) |
| §4.3 `eventLayout.ts` pure helper | Task 2 |
| §4.4 Re-layout on zoom | Task 5 steps 5-6 |
| §5.1 New `events` flag in `traces` | Task 1 |
| §5.2 No new selectors | Followed: Task 5 reads `traces.events` via the existing `traces` selector |
| §6 Architecture | Implemented in Tasks 4-5 (helper outside `GuideGraph`, called inside `useMemo` and on `relayout`) |
| §7 Files touched | Mirrors the File Structure table at the top of this plan |
| §8.1 Zero events | Covered by Task 5 step 5 (`if (!data || data.eventInputs.length === 0) ... { annotations: [] }`) |
| §8.2-§8.7 Toggle off→on, section change, excluded ranges, repeats, auto-Y, hover tooltips | Implicit — annotations come from `s.infos` directly without filtering by mask, and use `yref:'paper'` so Y choices don't move them; tooltip code is untouched |
| §9.1 Unit tests | Task 2 step 1 — 9 cases |
| §9.2 E2E tests | Task 6 — 3 cases |
| §10 Risk: measureText caching | Task 5 step 3 — `cache: Map<string, number>` |
| §10 Risk: relayout debouncing | No additional debounce; relies on `react-plotly.js`'s own rAF throttling, as called out in the spec |
| §10 Rollback | Implicit — additive changes only, no migration |

**Placeholder scan:** No "TBD", "implement later", or vague "handle errors" steps. Every code step ships full code; every command step lists exact `npx`/`git` invocations and expected outcomes.

**Type / name consistency:**

- `EventInput`, `EventLayoutItem`, `MeasureTextFn`, `layoutInlineEvents`, `buildEventAnnotations`, `refreshAnnotationsRef`, `measureTextPxRef`, `initialAnnotations`, `traces.events` — all defined exactly once and used with consistent names downstream.
- `data.eventInputs` is the property name set in Task 4 and read in Task 5; both spell it the same way.
- The `EventInput` interface in Task 2 matches the inline shape constructed in Task 4 (`timeSec`, `text`, `isDither` — same order doesn't matter, but same field names do).
