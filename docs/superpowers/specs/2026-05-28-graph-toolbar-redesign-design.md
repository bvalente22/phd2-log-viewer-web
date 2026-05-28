# GraphToolbar redesign — hybrid layout, muted chips, prominent Analysis button

Date: 2026-05-28
Branch: `ui/toolbar-redesign`

Reorganize the guiding-section chart toolbar (`GraphToolbar.tsx`). Today it's
three wrapping rows (DATA / DISPLAY / gesture-hint) with too many controls in a
flat strip. Move to a **hybrid** layout: a compact always-visible primary row +
a single "Display" popover for secondary controls. Mute the trace-toggle chip
colors. Make the Analysis button match the analysis-screen header and read as the
primary action. Layout/colors chosen via visual-companion mockups (Layout A,
muted palette, Analysis treatment 3).

UI/presentational only — no parser, FFT, store-logic, or chart-gesture changes.
Folds in deferred backlog #3 (remove the gesture-hint line).

## 1. Layout — one primary row + a "Display" popover

`web/src/components/GraphToolbar.tsx`. Replace the current Row-1 (DATA) / Row-2
(DISPLAY) / Row-3 (gesture-hint) structure with:

**Primary row** (always visible, `flex-wrap`), left → right:
- RA master group (`renderMasterGroup`): `RA` master · trace · pulses · limits
- Dec master group: `DEC` master · trace · pulses · limits
- Star master group: `STAR` master · Mass · SNR
- Events (`renderTraceGroup`)
- Right-aligned cluster (`ms-auto`): **⚙ Display ▾** popover trigger, then
  **`<AnalysisButton />`**.

The master groups, Events, the SCATTER-disables-toggles behavior, and the
`hasAo` gating all stay exactly as today.

**Display popover** — opens on clicking ⚙ Display, floats over the chart,
positioned below-right of the trigger; closes on `Escape` and on outside
`pointerdown`. Contents grouped under small `text-slate-500` labels (reusing the
existing `ToggleChip` + the recenter/export `<button>`s verbatim):

- **View:** Time · Scatter  (`graphMode`)
- **Scale:** arc-sec · pixels  (`scaleMode`)
- **Y-axis:** auto Y · Y-lock · Recenter Y  (`autoScaleY`, `scaleLocked`, the
  `phd-recenter-y` event button)
- **Coord:** RA/Dec · dx/dy  (`coordMode`) — moved out of the old primary row
- **Device:** Mount · AO  (`device`, with `hasAo` disable) — moved out
- **Range slider:** Show  (`showRangeSlider`)
- **Export:** PNG · CSV  (the two existing download buttons + `sessionToCsv`)

The gesture-hint row (`{t('gestureHint')}`) is **removed entirely**. The
`SHOW_FLIP_TOGGLES` block stays as-is (still `false`, code intact).

## 2. Popover mechanics

Hand-rolled — only `@radix-ui/react-context-menu` and `react-tooltip` are
installed, and adding a popover dependency would trip the auto-merge policy.
Small local helper (in `GraphToolbar.tsx`, or a sibling `ToolbarPopover.tsx` if
it reads cleaner):

- `const [open, setOpen] = useState(false)` + a container `ref`.
- Trigger `<button>` (⚙ + "Display" + ▾ caret) with `aria-haspopup`,
  `aria-expanded`, and a `title` tooltip (`toolbar.display.tooltip`).
- Panel: absolutely positioned (`absolute end-0 mt-1 z-20`), `bg-slate-900`
  `border border-slate-700 rounded shadow-lg`, `flex flex-wrap` of the grouped
  chips. The toolbar root gets `relative` so the panel anchors to it.
- `useEffect` adds `keydown` (Esc → close) and `pointerdown` (target outside
  `ref` → close) listeners while `open`; cleaned up on close/unmount.

## 3. Muted chip palette (GraphToolbar only)

Retone `CHIP_TONE` + `MASTER_BORDER` active fills to the approved mockup values
(arbitrary Tailwind hex classes; hover = a slightly lighter shade). Inactive
states keep the slate-800 bg + tinted text approach, softened. Before → after
(active fill / inactive text):

- `ra`:   `bg-sky-600` → `bg-[#3f6b8f]`,  inactive text `sky-400` → `#6fa3c4`
- `dec`:  `bg-red-600` → `bg-[#a85f5f]`,  inactive text `red-400` → `#d09a9a`
- `mass`: `bg-yellow-500` → `bg-[#ad924a]` (keep dark text), inactive `yellow-400` → `#c4ad6b`
- `snr`:  `bg-slate-100` → `bg-[#d7dde5]` (keep dark text), inactive `slate-200` → `#cbd5e1`
- `default` active: `bg-sky-700` → `bg-[#3f6b8f]` (softer selected state for
  the view/scale/coord/device toggles now living in the popover)
- `MASTER_BORDER`: ra `border-sky-300` → `border-[#5e87a6]`, dec `border-red-300`
  → `border-[#c08e8e]`, star `border-amber-300` → `border-[#bd9f54]`

**Chart traces (`themes.ts`) are NOT touched** — the divergence is intentional
(a solid chip concentrates color far more than a thin plotted line). Toolbar
chips don't retint per theme today (no `index.css` overrides target the colored
chip classes); the muted chips inherit that same behavior — no monochrome/paper
special-casing, no regression.

## 4. Analysis button — treatment 3

`web/src/components/AnalysisButton.tsx`. Keep all logic; restyle only the
`className` and add an icon:

- Current: `rounded bg-amber-700 px-3 py-1 text-xs font-semibold text-amber-50
  ring-1 ring-amber-600 hover:bg-amber-600 …`
- New: gold ring + lift + uppercase + a touch larger + leading chart-peak icon:
  `inline-flex items-center gap-1.5 rounded bg-amber-700 px-3.5 py-1 text-xs
  font-bold uppercase tracking-wide text-amber-50 ring-1 ring-amber-300 shadow-sm
  hover:bg-amber-600 …` (disabled state unchanged: slate bg/text/ring).
- Icon: inline `<svg>` (a periodogram-style zigzag), `aria-hidden`, ~13px,
  `stroke="currentColor"`, e.g. path `M3 17l4-6 4 3 5-9 4 7`.
- The amber-700 fill matches the analysis-screen header's "ANALYSIS:" pill
  (`AnalysisModal.tsx` header is `bg-amber-200` / pill `bg-amber-700`), so opening
  the modal feels continuous, and the burnt-amber hue stays clearly separate from
  the muted-ochre Mass chip.

## 5. i18n

`web/src/i18n/locales/*/toolbar.json` (all 6 locales). Add:
- `groups.display` = "Display", `display.tooltip` (what the popover holds),
  `groups.yAxis` = "Y-axis".
- Reuse every existing `view.*` / `scale.*` / `coord.*` / `device.*` /
  `rangeSlider.*` / `export.*` / `groups.*` string unchanged.
- `gestureHint` key may remain unused (like the legend keys left after PR #51) —
  do not churn 6 locales to delete it.
- PHD2 jargon (RA/Dec/Mass/SNR/AO/dx/dy) stays English per `locales/README.md`.

## Deferred (backlog — NOT in this change)

GuideGraph event-label stacking (#1), moving GuideGraph's hover readout below the
chart (#2), sidebar `<`/`>` keyboard shortcuts (#5), SectionHeader bg (#6), and the
Analysis-modal-header prominence (#7). See `project_backlog.md`.

## Verification

- `npx tsc --noEmit` clean; `npx vitest run` green (add a small test for the
  popover: trigger toggles `open`, Esc closes, a control inside is reachable).
- In-browser (per the test-chart-interactions rule, exercise the chart too, since
  the toolbar lives above it):
  - Primary row shows only the trace/master groups + Events + ⚙ Display + Analysis;
    no gesture-hint line.
  - ⚙ Display opens a floating panel over the chart; Esc and outside-click close it;
    every control inside works (view, scale, Y-axis trio, coord, device, range
    slider, PNG/CSV export) and reflects current state.
  - Chart drag / ctrl-drag / shift-drag / wheel-zoom / hover still behave (no
    gesture regression from the toolbar restructure).
  - Muted chips render across Dark / Paper / Night / Monochrome (same as the old
    colored chips — they don't retint).
  - Analysis button: gold-ringed amber, uppercase, icon, opens the modal; visually
    distinct from the Mass chip.
  - Narrow viewport: primary row wraps cleanly; popover stays anchored.
