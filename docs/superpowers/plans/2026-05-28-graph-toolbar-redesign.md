# GraphToolbar Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize the guiding-section chart toolbar into a compact always-visible primary row plus a single "Display" popover, mute the trace-toggle chip colors, and make the Analysis button match the analysis-screen amber header.

**Architecture:** Pure presentational change to `GraphToolbar.tsx`. A new hand-rolled `ToolbarPopover` (no new dependency) holds the secondary controls. The Analysis button is restyled in place. New i18n keys for the popover trigger + Y-axis group. No parser / store-logic / chart-gesture changes; chart trace colors (`themes.ts`) are untouched.

**Tech Stack:** React 18 + TypeScript, Tailwind (JIT, arbitrary `bg-[#hex]` values already used in this repo), react-i18next, Zustand view store.

**Branch:** `ui/toolbar-redesign` (already created; spec committed at `48ac014`).

**Spec:** `docs/superpowers/specs/2026-05-28-graph-toolbar-redesign-design.md`

**Testing note:** This repo has no `@testing-library/react` and no `.test.tsx` render tests; UI changes are verified in-browser (Playwright MCP) per established practice. Adding a render-test dependency would trip the auto-merge dependency policy, so verification here is `tsc --noEmit` + existing `vitest` + a manual browser pass. No new unit test.

---

### Task 1: Create the `ToolbarPopover` component

**Files:**
- Create: `web/src/components/ToolbarPopover.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Small click-to-open popover for the chart toolbar's secondary controls.
 * Hand-rolled (the app has no popover dependency, and adding one would trip
 * the auto-merge dependency policy): the panel floats over the chart,
 * anchored to the toolbar's right edge, and closes on Escape or an outside
 * pointerdown. `children` are the panel contents — the caller supplies the
 * grouped ToggleChips. The trigger stays mounted so its `ms-auto` position
 * is stable whether the panel is open or closed.
 */
export function ToolbarPopover({
  label,
  title,
  children,
}: {
  label: ReactNode;
  title?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={title}
        aria-haspopup="true"
        aria-expanded={open}
        className={`rounded border px-2 py-0.5 text-xs transition-colors ${
          open
            ? 'border-slate-600 bg-slate-700 text-slate-100'
            : 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700'
        }`}
      >
        {label}
      </button>
      {open && (
        <div
          role="group"
          className="absolute end-0 z-20 mt-1 flex max-w-[min(90vw,34rem)] flex-wrap items-center gap-2 rounded border border-slate-700 bg-slate-900 p-3 text-xs shadow-lg"
        >
          {children}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `cd web && npx tsc --noEmit`
Expected: clean (new file compiles; not yet imported anywhere).

- [ ] **Step 3: Commit**

```bash
git add web/src/components/ToolbarPopover.tsx
git commit -m "Add ToolbarPopover: hand-rolled click-to-open toolbar popover"
git push
```

---

### Task 2: Mute the chip palette in GraphToolbar

**Files:**
- Modify: `web/src/components/GraphToolbar.tsx` (the `CHIP_TONE` map ~lines 67-88 and `MASTER_BORDER` map ~lines 208-212)

- [ ] **Step 1: Replace `CHIP_TONE`**

Replace the whole `CHIP_TONE` object with:

```tsx
const CHIP_TONE: Record<ChipTone, { active: string; inactive: string }> = {
  default: {
    active:   'bg-[#3f6b8f] text-white hover:bg-[#4a7ba3]',
    inactive: 'bg-slate-800 text-slate-400 hover:bg-slate-700',
  },
  ra: {
    active:   'bg-[#3f6b8f] text-white hover:bg-[#4a7ba3]',
    inactive: 'bg-slate-800 text-[#6fa3c4] hover:bg-slate-700',
  },
  dec: {
    active:   'bg-[#a85f5f] text-white hover:bg-[#b87070]',
    inactive: 'bg-slate-800 text-[#d09a9a] hover:bg-slate-700',
  },
  mass: {
    active:   'bg-[#ad924a] text-slate-900 hover:bg-[#c0a458]',
    inactive: 'bg-slate-800 text-[#c4ad6b] hover:bg-slate-700',
  },
  snr: {
    active:   'bg-[#d7dde5] text-slate-900 hover:bg-[#e6ebf1]',
    inactive: 'bg-slate-800 text-[#cbd5e1] hover:bg-slate-700',
  },
};
```

Also update the comment above the map: note these are deliberately muted relative to the chart trace colors (a solid chip concentrates color far more than a thin plotted line; see the design spec / memory `feedback_toolbar_chip_colors.md`).

- [ ] **Step 2: Replace `MASTER_BORDER`**

```tsx
const MASTER_BORDER: Record<'ra' | 'dec' | 'star', string> = {
  ra:   'border-[#5e87a6]',
  dec:  'border-[#c08e8e]',
  star: 'border-[#bd9f54]',
};
```

- [ ] **Step 3: Type-check**

Run: `cd web && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/GraphToolbar.tsx
git commit -m "Mute GraphToolbar chip palette (chart traces unchanged)"
git push
```

---

### Task 3: Restructure GraphToolbar into a primary row + Display popover

**Files:**
- Modify: `web/src/components/GraphToolbar.tsx` (the `import` block at top and the entire `return (...)` JSX, ~lines 255-431)

- [ ] **Step 1: Add the import**

At the top with the other imports add:

```tsx
import { ToolbarPopover } from './ToolbarPopover';
```

- [ ] **Step 2: Replace the entire `return (...)`**

Replace everything from `return (` to the matching closing `);` at the end of the component with:

```tsx
  // Layout: a single always-visible primary row (the data/master groups +
  // Events), with the right-aligned cluster holding the "Display" popover
  // (all secondary how-it's-plotted controls) and the Analysis button. The
  // old DISPLAY row and the gesture-hint row are gone — the hint lived in a
  // row of its own and was the least-used line in the toolbar.
  return (
    <div className="flex w-full flex-wrap items-center gap-2 border-b border-slate-800 px-3 py-1 text-xs">
      {renderMasterGroup('RA', 'ra', raAnyOn, toggleRaAxis, t('groups.raTooltip'), raItems)}
      {/* Pulse-direction "flip" toggles are temporarily hidden — flip the
          SHOW_FLIP_TOGGLES const back to true to restore. Store fields and
          setters stay live; nothing about the flip semantics changes. */}
      {SHOW_FLIP_TOGGLES && (
        <ToggleChip
          label={t('traces.flipRaPulses')}
          active={flipRaPulses}
          onClick={() => setFlipRaPulses(!flipRaPulses)}
          disabled={graphMode === 'SCATTER' || !traces.raPulses}
          title={
            graphMode === 'SCATTER'
              ? t('traces.togglesScatterDisabled')
              : !traces.raPulses
              ? t('traces.flipPulsesDisabled')
              : t('traces.flipRaPulsesTooltip')
          }
          tone="ra"
        />
      )}
      {renderMasterGroup('Dec', 'dec', decAnyOn, toggleDecAxis, t('groups.decTooltip'), decItems)}
      {SHOW_FLIP_TOGGLES && (
        <ToggleChip
          label={t('traces.flipDecPulses')}
          active={flipDecPulses}
          onClick={() => setFlipDecPulses(!flipDecPulses)}
          disabled={graphMode === 'SCATTER' || !traces.decPulses}
          title={
            graphMode === 'SCATTER'
              ? t('traces.togglesScatterDisabled')
              : !traces.decPulses
              ? t('traces.flipPulsesDisabled')
              : t('traces.flipDecPulsesTooltip')
          }
          tone="dec"
        />
      )}
      {renderMasterGroup(t('groups.guideStar'), 'star', starAnyOn, toggleStarGroup, t('groups.guideStarTooltip'), starItems)}
      {renderTraceGroup(t('groups.events'), t('groups.eventsTooltip'), eventItems)}

      {/* Right cluster: secondary display controls collapse into the
          Display popover; Analysis is the prominent primary action. */}
      <div className="ms-auto flex items-center gap-2">
        <ToolbarPopover
          label={<>{'⚙'}&nbsp;{t('groups.display')}&nbsp;{'▾'}</>}
          title={t('groups.displayTooltip')}
        >
          <span className="me-1 text-slate-500" title={t('groups.viewTooltip')}>{t('groups.view')}:</span>
          <ToggleChip
            label={t('view.time')}
            active={graphMode === 'TIME'}
            onClick={() => setGraphMode('TIME')}
            title={t('view.timeTooltip')}
          />
          <ToggleChip
            label={t('view.scatter')}
            active={graphMode === 'SCATTER'}
            onClick={() => setGraphMode('SCATTER')}
            title={t('view.scatterTooltip')}
          />
          <span className="ms-3 me-1 text-slate-500" title={t('groups.scaleTooltip')}>{t('groups.scale')}:</span>
          <ToggleChip
            label={t('scale.arcsec')}
            active={scaleMode === 'ARCSEC'}
            onClick={() => setScaleMode('ARCSEC')}
            title={t('scale.arcsecTooltip')}
          />
          <ToggleChip
            label={t('scale.pixels')}
            active={scaleMode === 'PIXELS'}
            onClick={() => setScaleMode('PIXELS')}
            title={t('scale.pixelsTooltip')}
          />
          <span className="ms-3 me-1 text-slate-500" title={t('groups.yAxisTooltip')}>{t('groups.yAxis')}:</span>
          <ToggleChip
            label={t('scale.autoY')}
            active={autoScaleY}
            onClick={() => setAutoScaleY(!autoScaleY)}
            title={t('scale.autoYTooltip')}
          />
          <ToggleChip
            label={scaleLocked ? t('scale.yLocked') : t('scale.y')}
            active={scaleLocked}
            onClick={() => setScaleLocked(!scaleLocked)}
            title={t('scale.yLockedTooltip')}
          />
          <button
            className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-300 hover:bg-slate-700"
            onClick={() => window.dispatchEvent(new CustomEvent('phd-recenter-y'))}
            title={t('scale.recenterYTooltip')}
          >
            {t('scale.recenterY')}
          </button>
          <span className="ms-3 me-1 text-slate-500" title={t('groups.coordTooltip')}>{t('groups.coord')}:</span>
          <ToggleChip
            label="RA/Dec"
            active={coordMode === 'RA_DEC'}
            onClick={() => setCoordMode('RA_DEC')}
            disabled={graphMode === 'SCATTER'}
            title={t('coord.raDecTooltip')}
          />
          <ToggleChip
            label="dx/dy"
            active={coordMode === 'DX_DY'}
            onClick={() => setCoordMode('DX_DY')}
            disabled={graphMode === 'SCATTER'}
            title={t('coord.dxDyTooltip')}
          />
          <span className="ms-3 me-1 text-slate-500" title={t('groups.deviceTooltip')}>{t('groups.device')}:</span>
          <ToggleChip
            label="Mount"
            active={device === 'MOUNT'}
            onClick={() => setDevice('MOUNT')}
            disabled={!hasAo}
            title={hasAo ? t('device.mountTooltip') : t('device.noAo')}
          />
          <ToggleChip
            label="AO"
            active={device === 'AO'}
            onClick={() => setDevice('AO')}
            disabled={!hasAo}
            title={hasAo ? t('device.aoTooltip') : t('device.noAoShort')}
          />
          <span className="ms-3 me-1 text-slate-500" title={t('groups.rangeSliderTooltip')}>{t('groups.rangeSlider')}:</span>
          <ToggleChip
            label={t('rangeSlider.show')}
            active={showRangeSlider}
            onClick={() => setShowRangeSlider(!showRangeSlider)}
            title={t('rangeSlider.showTooltip')}
          />
          <span className="ms-3 me-1 text-slate-500" title={t('groups.exportTooltip')}>{t('groups.export')}:</span>
          <button
            className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-300 hover:bg-slate-700 disabled:opacity-40"
            disabled={!session}
            onClick={() => {
              const stem = meta?.name?.replace(/\.[^.]+$/, '') ?? 'log';
              const fname = `phd2-${stem}-${session?.date ?? ''}`.replace(/[^a-zA-Z0-9-_]+/g, '-');
              window.dispatchEvent(new CustomEvent('phd-export-png', { detail: { filename: fname } }));
            }}
            title={t('export.pngTooltip')}
          >
            {t('export.png')}
          </button>
          <button
            className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-300 hover:bg-slate-700 disabled:opacity-40"
            disabled={!session}
            onClick={() => {
              if (!session) return;
              const csv = sessionToCsv(session, mask);
              const stem = meta?.name?.replace(/\.[^.]+$/, '') ?? 'log';
              const dateTag = session.date.replace(/[^a-zA-Z0-9]+/g, '-');
              triggerDownload(`${stem}-${dateTag}.csv`, csv, 'text/csv;charset=utf-8');
            }}
            title={t('export.csvTooltip')}
          >
            {t('export.csv')}
          </button>
        </ToolbarPopover>
        <AnalysisButton />
      </div>
    </div>
  );
```

Note: every handler (`setGraphMode`, `setScaleMode`, `setAutoScaleY`, `setScaleLocked`, `setCoordMode`, `setDevice`, `setShowRangeSlider`, `session`, `meta`, `mask`, `sessionToCsv`, `triggerDownload`) is already declared in the component body and the helper section — nothing new to wire. The `⚙` is the gear (⚙) and `▾` the down-triangle (▾).

- [ ] **Step 3: Type-check**

Run: `cd web && npx tsc --noEmit`
Expected: clean. (Missing i18n keys like `groups.display` render the key string at runtime until Task 5 — they are not a compile error.)

- [ ] **Step 4: Commit**

```bash
git add web/src/components/GraphToolbar.tsx
git commit -m "Restructure GraphToolbar: primary row + Display popover, drop gesture-hint row"
git push
```

---

### Task 4: Restyle the Analysis button (treatment 3 + icon)

**Files:**
- Modify: `web/src/components/AnalysisButton.tsx` (the returned `<button>`, ~lines 60-70)

- [ ] **Step 1: Replace the returned button**

```tsx
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!enabled}
      title={t('contextMenu.analysisTooltip')}
      className="inline-flex items-center gap-1.5 rounded bg-amber-700 px-3.5 py-1 text-xs font-bold uppercase tracking-wide text-amber-50 shadow-sm ring-1 ring-amber-300 transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500 disabled:shadow-none disabled:ring-slate-700"
    >
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M3 17l4-6 4 3 5-9 4 7" />
      </svg>
      {t('contextMenu.analysis')}
    </button>
  );
```

The amber-700 fill matches the analysis-modal header's "ANALYSIS:" pill; the amber-300 ring + shadow + uppercase lift it as the primary action and keep it distinct from the muted-ochre Mass chip.

- [ ] **Step 2: Type-check**

Run: `cd web && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/AnalysisButton.tsx
git commit -m "Restyle Analysis button: gold ring, uppercase, chart-peak icon"
git push
```

---

### Task 5: Add i18n keys to all six locales

**Files:**
- Modify: `web/src/i18n/locales/en/toolbar.json`
- Modify: `web/src/i18n/locales/es/toolbar.json`
- Modify: `web/src/i18n/locales/de/toolbar.json`
- Modify: `web/src/i18n/locales/fr/toolbar.json`
- Modify: `web/src/i18n/locales/it/toolbar.json`
- Modify: `web/src/i18n/locales/zh-Hans/toolbar.json`

In each file, add four keys to the existing `"groups"` object (alongside `view`, `scale`, etc.). Use this per-locale text:

| key | en | es | de | fr | it | zh-Hans |
|-----|----|----|----|----|----|---------|
| `display` | `Display` | `Visualización` | `Anzeige` | `Affichage` | `Visualizzazione` | `显示` |
| `displayTooltip` | `Show chart display options: view, scale, Y-axis, coordinate frame, device, range slider, and export` | `Mostrar opciones de visualización del gráfico: vista, escala, eje Y, sistema de coordenadas, dispositivo, barra de rango y exportación` | `Diagramm-Anzeigeoptionen einblenden: Ansicht, Skala, Y-Achse, Koordinatensystem, Gerät, Bereichsregler und Export` | `Afficher les options d'affichage du graphique : vue, échelle, axe Y, repère de coordonnées, périphérique, curseur de plage et export` | `Mostra le opzioni di visualizzazione del grafico: vista, scala, asse Y, sistema di coordinate, dispositivo, barra dell'intervallo ed esportazione` | `显示图表显示选项：视图、刻度、Y 轴、坐标系、设备、范围滑块和导出` |
| `yAxis` | `y-axis` | `eje Y` | `Y-Achse` | `axe Y` | `asse Y` | `Y 轴` |
| `yAxisTooltip` | `Y-axis auto-fit, lock, and recenter` | `Ajuste automático, bloqueo y recentrado del eje Y` | `Y-Achse automatisch anpassen, sperren und zentrieren` | `Ajustement automatique, verrouillage et recentrage de l'axe Y` | `Adattamento automatico, blocco e ricentratura dell'asse Y` | `Y 轴自动适配、锁定和居中` |

Example for `en/toolbar.json` — change the end of the `"groups"` block from:

```json
    "scale": "scale",
    "scaleTooltip": "Y-axis units"
  },
```

to:

```json
    "scale": "scale",
    "scaleTooltip": "Y-axis units",
    "display": "Display",
    "displayTooltip": "Show chart display options: view, scale, Y-axis, coordinate frame, device, range slider, and export",
    "yAxis": "y-axis",
    "yAxisTooltip": "Y-axis auto-fit, lock, and recenter"
  },
```

Apply the analogous edit in each locale using its column from the table (mind the trailing comma on the previous `scaleTooltip` line). The `gestureHint` key is now unused but is left in place (do not churn locales to remove it — same call made for the legend keys in PR #51).

- [ ] **Step 1: Edit all six files** per the table above.

- [ ] **Step 2: Validate JSON + type-check**

Run: `cd web && node -e "['en','es','de','fr','it','zh-Hans'].forEach(l=>JSON.parse(require('fs').readFileSync('src/i18n/locales/'+l+'/toolbar.json','utf8')))" && npx tsc --noEmit`
Expected: no JSON parse error; tsc clean.

- [ ] **Step 3: Commit**

```bash
git add web/src/i18n/locales/*/toolbar.json
git commit -m "i18n: add toolbar Display popover + Y-axis group keys (6 locales)"
git push
```

---

### Task 6: Verify and open PR

- [ ] **Step 1: Full local check**

Run: `cd web && npx tsc --noEmit && npx vitest run`
Expected: tsc clean; all existing vitest suites green (no test count change — no logic touched).

- [ ] **Step 2: Manual browser pass** (dev server + Playwright MCP)

Start/reuse the dev server (`cd web && npm run dev`, port 5173), load a guiding section (e.g. `PHD2_GuideLog_2026-03-30_161541`), and confirm:
- Primary row shows only RA/Dec/Star master groups + Events, then right-aligned `⚙ Display ▾` + the amber **ANALYSIS** button. No gesture-hint line.
- Clicking `⚙ Display` opens a floating panel over the chart; pressing Esc closes it; clicking outside closes it; clicking a chip inside keeps it open and toggles the control.
- Inside the popover: view (Time/Scatter), scale (arc-sec/pixels), y-axis (auto Y / Y-lock / recenter Y), coord (RA-Dec/dx-dy — disabled in Scatter), device (Mount/AO — disabled when no AO), range slider, Export PNG, Export CSV all work and reflect state.
- Chart gestures still behave: drag (X pan + Y zoom), ctrl-drag (exclude), shift-drag (include), wheel (X zoom), hover readout. (Per `feedback_test_chart_interactions.md`.)
- Muted chips render correctly on Dark / Paper / Night / Monochrome (they do not retint — same as before).
- Analysis button: gold-ringed amber, uppercase, chart icon, opens the modal on Raw RA; visually distinct from the Mass chip.
- Narrow viewport: primary row wraps cleanly; popover stays anchored to the right edge.

- [ ] **Step 3: Connectivity check + PR**

```bash
git merge-base --is-ancestor origin/main HEAD || { echo "DIVERGED — stop"; exit 1; }
gh pr create --title "GraphToolbar: hybrid layout (primary row + Display popover), muted chips, prominent Analysis button" --body "<summary + test plan>"
```

- [ ] **Step 4: Auto-merge** (coding PR; per CLAUDE.md auto-merge policy, once tsc + vitest are clean)

```bash
gh pr merge <num> --squash --delete-branch
git checkout main && git pull --ff-only
```

Restart the dev server if it was running so the merged state is on screen.

---

## Self-Review

**Spec coverage:**
- §1 layout (primary row + Display popover, coord/device moved in, gesture-hint removed) → Task 3. ✓
- §2 popover mechanics (Esc + outside-pointerdown, anchored panel, no dep) → Task 1. ✓
- §3 muted palette (CHIP_TONE + MASTER_BORDER, traces untouched, no theme special-casing) → Task 2. ✓
- §4 Analysis button treatment 3 (amber-700, gold ring, shadow, uppercase, icon) → Task 4. ✓
- §5 i18n (`groups.display`, `groups.displayTooltip`, `groups.yAxis`, `groups.yAxisTooltip`; reuse existing) → Task 5. ✓ (Note: spec named `display.tooltip`/`groups.display`; plan uses `groups.displayTooltip`/`groups.yAxisTooltip` for consistency with the file's existing `groups.<x>Tooltip` convention — functionally identical.)
- §5 verification → Task 6. ✓

**Placeholder scan:** PR body `<summary + test plan>` is the only intentional fill-in (written at PR time). No code placeholders.

**Type consistency:** `ToolbarPopover` props `{ label: ReactNode; title?: string; children: ReactNode }` match the call site in Task 3 (`label={<>…</>}`, `title={t(...)}`, children = chips). All store handlers referenced in Task 3 already exist in `GraphToolbar`'s body. i18n keys referenced in Task 3 (`groups.display`, `groups.displayTooltip`, `groups.yAxis`, `groups.yAxisTooltip`) are exactly those added in Task 5.
