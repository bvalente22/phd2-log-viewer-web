# Guiding Header Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a compact "dashboard" strip above the guide chart summarizing the section's PHD2 header (pier side, hour angle, altitude, rotator, backlash, RA/Dec algorithms), and default the Guiding Assistant panel to collapsed.

**Architecture:** A pure, unit-tested parser (`guideHeader.ts`) extracts the fields from the already-captured `GuideSession.hdr` lines at render time. A presentational `GuidingDashboard` component renders a tile grid with a theme-aware accent (`--dash-accent` CSS var). No parser-pipeline, worker, or store changes.

**Tech Stack:** React + TypeScript, Tailwind, react-i18next, Vitest. All work under `web/`.

**Working directory for all commands:** `web/` (run `cd web` first if your shell isn't there). Branch `feat/guiding-dashboard` is already checked out and pushed.

**Convention reminders (from CLAUDE.md / repo memory):**
- Push after every commit (`git push` — upstream already set).
- Comment ported algorithms / platform-driven mappings, citing the source (here: the PHD2 `X = RA, Y = Dec` convention).
- Every interactive/explanatory UI element gets a `title`.
- Restart the Vite dev server after code changes and re-check in browser.

---

## File Structure

- **Create** `web/src/parser/guideHeader.ts` — pure parser: `parseGuideHeader(hdr) -> GuideHeaderInfo`.
- **Create** `web/src/parser/__tests__/guideHeader.test.ts` — unit tests over real header variants.
- **Create** `web/src/components/GuidingDashboard.tsx` — the dashboard strip component.
- **Modify** `web/src/index.css` — add `--dash-accent` (default + 4 theme overrides) and `.dash-accent` utility.
- **Modify** `web/src/i18n/locales/{en,es,de,fr,it,zh}/sections.json` — add `dashboard` label block.
- **Modify** `web/src/pages/ViewerPage.tsx` — render `<GuidingDashboard />` after `<GAResultsPanel />`.
- **Modify** `web/src/components/GAResultsPanel.tsx` — remove hardcoded `open` (default collapsed).

---

## Task 1: Header parser (`guideHeader.ts`) with tests

**Files:**
- Create: `web/src/parser/guideHeader.ts`
- Test: `web/src/parser/__tests__/guideHeader.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `web/src/parser/__tests__/guideHeader.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseGuideHeader } from '../guideHeader';

// Real header fragments sampled from fixtures in `sample data/`.
const coord =
  'RA = 15.21 hr, Dec = -90.0 deg, Hour angle = -6.00 hr, Pier side = West, Rotator pos = N/A, Alt = 20.1 deg, Az = 180.0 deg';
const coordRot =
  'RA = 11.16 hr, Dec = -0.0 deg, Hour angle = -0.22 hr, Pier side = East, Rotator pos = 191.1, Alt = 59.4 deg, Az = 173.4 deg';

describe('parseGuideHeader', () => {
  it('extracts pier side, hour angle, altitude; rotator N/A -> null', () => {
    const info = parseGuideHeader([coord]);
    expect(info.pierSide).toBe('West');
    expect(info.hourAngle).toBe('-6.00');
    expect(info.altitude).toBe('20.1');
    expect(info.rotator).toBeNull();
  });

  it('reads a present rotator position and East pier', () => {
    const info = parseGuideHeader([coordRot]);
    expect(info.pierSide).toBe('East');
    expect(info.rotator).toBe('191.1');
  });

  it('parses backlash enabled with pulse', () => {
    const info = parseGuideHeader(['Backlash comp = enabled, pulse = 163 ms']);
    expect(info.backlash).toEqual({ enabled: true, pulseMs: '163' });
  });

  it('parses backlash disabled (amount dropped by the view)', () => {
    const info = parseGuideHeader(['Backlash comp = disabled, pulse = 470 ms']);
    expect(info.backlash).toEqual({ enabled: false, pulseMs: '470' });
  });

  it('Hysteresis: agg fraction shown verbatim, name + min move', () => {
    const a = parseGuideHeader([
      'X guide algorithm = Hysteresis, Hysteresis = 0.100, Aggression = 0.450, Minimum move = 0.098',
    ]).ra;
    expect(a).toEqual({ name: 'Hysteresis', param: 'agg 0.45', minMove: '0.098' });
  });

  it('Lowpass2: Aggressiveness shown as aggr', () => {
    const a = parseGuideHeader([
      'X guide algorithm = Lowpass2, Aggressiveness = 32.000, Minimum move = 0.300',
    ]).ra;
    expect(a).toEqual({ name: 'Lowpass2', param: 'aggr 32', minMove: '0.3' });
  });

  it('Resist Switch: space-separated, percent agg, min-move-before-agg', () => {
    const a = parseGuideHeader([
      'Y guide algorithm = Resist Switch, Minimum move = 0.200 Aggression = 100% FastSwitch = enabled',
    ]).dec;
    expect(a).toEqual({ name: 'Resist Switch', param: 'agg 100%', minMove: '0.2' });
  });

  it('Lowpass: no aggression -> falls back to slope weight', () => {
    const a = parseGuideHeader([
      'Y guide algorithm = Lowpass, Slope weight = 5.000, Minimum move = 0.250',
    ]).dec;
    expect(a).toEqual({ name: 'Lowpass', param: 'slope wt 5', minMove: '0.25' });
  });

  it('maps X->RA and Y->Dec', () => {
    const info = parseGuideHeader([
      'X guide algorithm = Lowpass2, Aggressiveness = 40.000, Minimum move = 0.150',
      'Y guide algorithm = Hysteresis, Hysteresis = 0.100, Aggression = 0.700, Minimum move = 0.13',
    ]);
    expect(info.ra?.name).toBe('Lowpass2');
    expect(info.dec?.name).toBe('Hysteresis');
  });

  it('returns all-null when header lacks the relevant lines', () => {
    const info = parseGuideHeader(['Equipment Profile = ASI MACH1', 'Exposure = 2000 ms']);
    expect(info).toEqual({
      pierSide: null, hourAngle: null, altitude: null, rotator: null,
      backlash: null, ra: null, dec: null,
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/parser/__tests__/guideHeader.test.ts`
Expected: FAIL — `Failed to resolve import "../guideHeader"` / module not found.

- [ ] **Step 3: Write the parser**

Create `web/src/parser/guideHeader.ts`:

```ts
// Parses the most-consulted setup facts out of a guiding section's raw PHD2
// header lines (already captured verbatim in GuideSession.hdr). Pure and
// presentation-free so the rules can be locked down with unit tests.
//
// PHD2 convention: the RA-axis guide algorithm is logged as "X guide
// algorithm" and the Dec-axis as "Y guide algorithm" (PHD2 Mount class:
// m_pXGuideAlgorithm = RA, m_pYGuideAlgorithm = Dec). We surface them as
// RA / Dec accordingly.

export interface AlgoInfo {
  /** Algorithm name, e.g. "Hysteresis", "Resist Switch", "Lowpass2". */
  name: string;
  /** Tidied, already-labeled secondary parameter: "agg 0.45" | "aggr 32" |
   *  "slope wt 5", or null when the line exposes none. */
  param: string | null;
  /** Tidied minimum-move value, e.g. "0.2", "0.098". */
  minMove: string | null;
}

export interface GuideHeaderInfo {
  pierSide: string | null;   // "West" | "East"
  hourAngle: string | null;  // hours, e.g. "-6.00" (unit appended in the view)
  altitude: string | null;   // degrees, e.g. "20.1"
  rotator: string | null;    // degrees when present; null for "N/A"/absent
  backlash: { enabled: boolean; pulseMs: string } | null;
  ra: AlgoInfo | null;
  dec: AlgoInfo | null;
}

/** Strip trailing zeros after a decimal point (and a dangling dot), keeping a
 *  trailing '%'. "0.450"->"0.45", "32.000"->"32", "0.200"->"0.2", "100%"->"100%".
 *  Mirrors the trailing-zero trimming in parseInfo.ts. */
const tidyNum = (s: string): string => {
  const pct = s.endsWith('%') ? '%' : '';
  const n = pct ? s.slice(0, -1) : s;
  if (!n.includes('.')) return n + pct;
  return n.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '') + pct;
};

const firstMatch = (hdr: string[], re: RegExp): RegExpMatchArray | null => {
  for (const line of hdr) {
    const m = line.match(re);
    if (m) return m;
  }
  return null;
};

const parseAlgo = (line: string | undefined): AlgoInfo | null => {
  if (!line) return null;
  const eq = line.indexOf('= ');
  if (eq < 0) return null;
  const body = line.slice(eq + 2);

  // Name = text up to the first comma. Preserves spaces inside the name
  // ("Resist Switch"); the comma (or, for the comma-less Resist Switch tail,
  // the run of " Key =" pairs) never appears inside a name.
  const comma = body.indexOf(',');
  const name = (comma >= 0 ? body.slice(0, comma) : body).trim();

  const minMoveM = line.match(/Minimum move = ([\d.]+)/);
  const minMove = minMoveM ? tidyNum(minMoveM[1]) : null;

  // Secondary param, in priority order: Aggression (fraction or percent) ->
  // Aggressiveness -> the first other "Key = number" that isn't Minimum move
  // or FastSwitch (e.g. Slope weight for plain Lowpass).
  let param: string | null = null;
  const agg = line.match(/Aggression = ([\d.]+%?)/);
  const aggr = line.match(/Aggressiveness = ([\d.]+)/);
  if (agg) {
    param = `agg ${tidyNum(agg[1])}`;
  } else if (aggr) {
    param = `aggr ${tidyNum(aggr[1])}`;
  } else {
    for (const m of line.matchAll(/([A-Za-z][A-Za-z ]*?) = ([\d.]+)/g)) {
      const key = m[1].trim();
      if (key === 'Minimum move' || key === 'FastSwitch') continue;
      const label =
        key === 'Slope weight' ? 'slope wt' :
        key === 'Hysteresis' ? 'hyst' :
        key.toLowerCase();
      param = `${label} ${tidyNum(m[2])}`;
      break;
    }
  }

  return { name, param, minMove };
};

export const parseGuideHeader = (hdr: string[]): GuideHeaderInfo => {
  const coord = hdr.find((l) => l.includes('Pier side =')) ?? '';
  const pierSide = (coord.match(/Pier side = ([^,]+)/)?.[1] ?? '').trim() || null;
  const hourAngle = coord.match(/Hour angle = (-?[\d.]+)/)?.[1] ?? null;
  const altitude = coord.match(/Alt = (-?[\d.]+)/)?.[1] ?? null;
  const rotRaw = (coord.match(/Rotator pos = ([^,]+)/)?.[1] ?? '').trim();
  const rotator = rotRaw && rotRaw.toUpperCase() !== 'N/A' ? rotRaw : null;

  const bl = firstMatch(hdr, /Backlash comp = (enabled|disabled), pulse = (\d+) ms/);
  const backlash = bl ? { enabled: bl[1] === 'enabled', pulseMs: bl[2] } : null;

  return {
    pierSide,
    hourAngle,
    altitude,
    rotator,
    backlash,
    ra: parseAlgo(hdr.find((l) => l.startsWith('X guide algorithm'))),
    dec: parseAlgo(hdr.find((l) => l.startsWith('Y guide algorithm'))),
  };
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/parser/__tests__/guideHeader.test.ts`
Expected: PASS — all 11 tests green.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output (clean).

- [ ] **Step 6: Commit and push**

```bash
git add src/parser/guideHeader.ts src/parser/__tests__/guideHeader.test.ts
git commit -m "Add guideHeader parser for the section dashboard"
git push
```

---

## Task 2: i18n label block in all six locales

**Files:**
- Modify: `web/src/i18n/locales/en/sections.json`
- Modify: `web/src/i18n/locales/es/sections.json`
- Modify: `web/src/i18n/locales/de/sections.json`
- Modify: `web/src/i18n/locales/fr/sections.json`
- Modify: `web/src/i18n/locales/it/sections.json`
- Modify: `web/src/i18n/locales/zh/sections.json`

PHD2 jargon (RA, Dec, algorithm names, units) stays English per the repo locale policy; only surrounding labels are translated. In each file, add a new top-level `"dashboard"` key inside the root object (e.g. after the existing `"summary"` block — remember to add a comma after the preceding block's closing `}`).

- [ ] **Step 1: en/sections.json** — add:

```json
  "dashboard": {
    "sectionLabel": "Guiding setup",
    "pierSide": "Pier side",
    "hourAngle": "Hour angle",
    "altitude": "Altitude",
    "rotator": "Rotator",
    "backlashComp": "Backlash comp",
    "raAlgorithm": "RA algorithm",
    "decAlgorithm": "Dec algorithm",
    "backlashEnabled": "Enabled · {{pulse}} ms",
    "backlashDisabled": "Disabled",
    "tooltip": "Key guiding setup from this section's PHD2 header — pier side, pointing, backlash, and RA/Dec algorithms."
  }
```

- [ ] **Step 2: es/sections.json** — add:

```json
  "dashboard": {
    "sectionLabel": "Configuración de guiado",
    "pierSide": "Lado de montura",
    "hourAngle": "Ángulo horario",
    "altitude": "Altitud",
    "rotator": "Rotador",
    "backlashComp": "Comp. holgura",
    "raAlgorithm": "Algoritmo RA",
    "decAlgorithm": "Algoritmo Dec",
    "backlashEnabled": "Activado · {{pulse}} ms",
    "backlashDisabled": "Desactivado",
    "tooltip": "Configuración de guiado clave del encabezado PHD2 de esta sección: lado de montura, apuntado, holgura y algoritmos RA/Dec."
  }
```

- [ ] **Step 3: de/sections.json** — add:

```json
  "dashboard": {
    "sectionLabel": "Guiding-Setup",
    "pierSide": "Pier-Seite",
    "hourAngle": "Stundenwinkel",
    "altitude": "Höhe",
    "rotator": "Rotator",
    "backlashComp": "Backlash-Komp.",
    "raAlgorithm": "RA-Algorithmus",
    "decAlgorithm": "Dec-Algorithmus",
    "backlashEnabled": "Aktiviert · {{pulse}} ms",
    "backlashDisabled": "Deaktiviert",
    "tooltip": "Wichtige Guiding-Einstellungen aus dem PHD2-Header dieses Abschnitts — Pier-Seite, Ausrichtung, Backlash und RA/Dec-Algorithmen."
  }
```

- [ ] **Step 4: fr/sections.json** — add:

```json
  "dashboard": {
    "sectionLabel": "Réglages de guidage",
    "pierSide": "Côté pier",
    "hourAngle": "Angle horaire",
    "altitude": "Altitude",
    "rotator": "Rotateur",
    "backlashComp": "Comp. backlash",
    "raAlgorithm": "Algorithme RA",
    "decAlgorithm": "Algorithme Dec",
    "backlashEnabled": "Activé · {{pulse}} ms",
    "backlashDisabled": "Désactivé",
    "tooltip": "Réglages de guidage clés de l'en-tête PHD2 de cette section — côté pier, pointage, backlash et algorithmes RA/Dec."
  }
```

- [ ] **Step 5: it/sections.json** — add:

```json
  "dashboard": {
    "sectionLabel": "Impostazioni guida",
    "pierSide": "Lato pier",
    "hourAngle": "Angolo orario",
    "altitude": "Altitudine",
    "rotator": "Rotatore",
    "backlashComp": "Comp. gioco",
    "raAlgorithm": "Algoritmo RA",
    "decAlgorithm": "Algoritmo Dec",
    "backlashEnabled": "Attivo · {{pulse}} ms",
    "backlashDisabled": "Disattivato",
    "tooltip": "Impostazioni di guida principali dall'header PHD2 di questa sezione — lato pier, puntamento, gioco e algoritmi RA/Dec."
  }
```

- [ ] **Step 6: zh/sections.json** — add:

```json
  "dashboard": {
    "sectionLabel": "导星设置",
    "pierSide": "中天侧",
    "hourAngle": "时角",
    "altitude": "高度",
    "rotator": "旋转器",
    "backlashComp": "齿隙补偿",
    "raAlgorithm": "RA 算法",
    "decAlgorithm": "Dec 算法",
    "backlashEnabled": "启用 · {{pulse}} ms",
    "backlashDisabled": "禁用",
    "tooltip": "本节 PHD2 头信息中的关键导星设置——中天侧、指向、齿隙和 RA/Dec 算法。"
  }
```

- [ ] **Step 7: Verify JSON parses + typecheck**

Run: `node -e "for (const l of ['en','es','de','fr','it','zh']) JSON.parse(require('fs').readFileSync('src/i18n/locales/'+l+'/sections.json','utf8'))" && npx tsc --noEmit`
Expected: no output (all six files are valid JSON; types clean).

- [ ] **Step 8: Commit and push**

```bash
git add src/i18n/locales/*/sections.json
git commit -m "i18n: dashboard label strings for the guiding header strip"
git push
```

---

## Task 3: Theme-aware accent CSS variable

**Files:**
- Modify: `web/src/index.css`

- [ ] **Step 1: Add the default var + utility class**

In `web/src/index.css`, immediately after the `body { @apply bg-slate-950 text-slate-100; }` line (line ~6), insert:

```css

/* Header-dashboard accent. Theme-aware so the strip stands out on every skin
   without breaking Night (crimson, dark-adapted) or Monochrome (chrome is
   colorless by design). This :root value is the default/dark theme; each
   [data-theme] block below overrides it. */
:root { --dash-accent: #34d399; }   /* emerald-400 — distinct from the GA panel's sky */
.dash-accent { color: var(--dash-accent); }
```

- [ ] **Step 2: Add per-theme overrides**

Add one override line at the top of each non-default theme block in `index.css` (right after that theme's `body` rule):

- Under `[data-theme="paper"] body { … }`:
  ```css
  [data-theme="paper"] { --dash-accent: #0d9488; }   /* teal-600, readable on white */
  ```
- Under `[data-theme="monochrome"] body { … }`:
  ```css
  [data-theme="monochrome"] { --dash-accent: #000000; }   /* grayscale chrome */
  ```
- Under `[data-theme="high-contrast"] body { … }`:
  ```css
  [data-theme="high-contrast"] { --dash-accent: #22d3ee; }   /* bright cyan on black */
  ```
- Under `[data-theme="night"] body { … }`:
  ```css
  [data-theme="night"] { --dash-accent: #ff9a9a; }   /* stays red; preserves dark adaptation */
  ```

- [ ] **Step 3: Typecheck / build sanity**

Run: `npx tsc --noEmit`
Expected: no output (CSS isn't type-checked, but this confirms nothing else broke).

- [ ] **Step 4: Commit and push**

```bash
git add src/index.css
git commit -m "Add theme-aware --dash-accent for the guiding dashboard"
git push
```

---

## Task 4: `GuidingDashboard` component

**Files:**
- Create: `web/src/components/GuidingDashboard.tsx`

(No unit test: this repo unit-tests parsers, not React components; correctness is verified in the browser in Task 7. The parsing logic it depends on is fully covered by Task 1.)

- [ ] **Step 1: Create the component**

Create `web/src/components/GuidingDashboard.tsx`:

```tsx
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLogStore } from '../state/logStore';
import { parseGuideHeader, type AlgoInfo, type GuideHeaderInfo } from '../parser/guideHeader';

/**
 * Compact "dashboard" strip directly above the guide chart that surfaces the
 * most-consulted setup facts from the section's PHD2 header — pier side,
 * pointing (hour angle / altitude / rotator), backlash compensation, and the
 * RA & Dec guide algorithms. Without it, this data is only reachable by
 * twirling open the raw 16-line SectionHeader block.
 *
 * Read-only. Surface uses slate-* classes so the active theme retints it; the
 * accent (left rail, section label, captions) uses the theme-aware
 * --dash-accent var (see index.css) so it pops on every skin and degrades to
 * red on Night / grayscale on Monochrome.
 *
 * Renders nothing for non-guiding sections or when the header yielded no
 * recognizable fields.
 */

/** One read-only labeled cell. `title` carries the explanation/raw value. */
function Tile({ caption, value, sub, wide }: {
  caption: string;
  value: string;
  sub?: string | null;
  wide?: boolean;
}) {
  return (
    <div
      className={`bg-slate-800 px-2.5 py-1 ${wide ? 'min-w-[150px] grow-[2]' : 'min-w-[88px] grow'}`}
      title={`${caption}: ${value}${sub ? ' ' + sub : ''}`}
    >
      <span className="dash-accent block text-[9px] font-medium uppercase tracking-wide">{caption}</span>
      <span className="text-[13px] text-slate-100">
        {value}
        {sub && <span className="text-[11px] text-slate-400"> {sub}</span>}
      </span>
    </div>
  );
}

/** "· agg 0.45 · min 0.098" — joins whatever the algorithm exposed. */
const algoSub = (a: AlgoInfo): string => {
  const parts: string[] = [];
  if (a.param) parts.push(a.param);
  if (a.minMove) parts.push(`min ${a.minMove}`);
  return parts.length ? `· ${parts.join(' · ')}` : '';
};

export function GuidingDashboard() {
  const { t } = useTranslation('sections');
  const log = useLogStore((s) => s.log);
  const sectionIdx = useLogStore((s) => s.selectedSection);

  const info = useMemo<GuideHeaderInfo | null>(() => {
    if (!log || sectionIdx < 0) return null;
    const sec = log.sections[sectionIdx];
    if (!sec || sec.type !== 'GUIDING') return null;
    return parseGuideHeader(log.sessions[sec.idx].hdr);
  }, [log, sectionIdx]);

  if (!info) return null;
  const hasAny =
    info.pierSide || info.hourAngle || info.altitude || info.rotator ||
    info.backlash || info.ra || info.dec;
  if (!hasAny) return null;

  return (
    <div
      className="flex flex-wrap gap-px border-y border-slate-700 bg-slate-700"
      style={{ borderLeft: '3px solid var(--dash-accent)' }}
      title={t('dashboard.tooltip')}
    >
      <span className="dash-accent w-full bg-slate-800 px-2.5 pt-1 text-[9px] font-bold uppercase tracking-wider">
        {t('dashboard.sectionLabel')}
      </span>
      {info.pierSide && <Tile caption={t('dashboard.pierSide')} value={info.pierSide} />}
      {info.hourAngle && <Tile caption={t('dashboard.hourAngle')} value={`${info.hourAngle} h`} />}
      {info.altitude && <Tile caption={t('dashboard.altitude')} value={`${info.altitude}°`} />}
      {info.rotator && <Tile caption={t('dashboard.rotator')} value={`${info.rotator}°`} />}
      {info.backlash && (
        <Tile
          caption={t('dashboard.backlashComp')}
          value={info.backlash.enabled
            ? t('dashboard.backlashEnabled', { pulse: info.backlash.pulseMs })
            : t('dashboard.backlashDisabled')}
        />
      )}
      {info.ra && (
        <Tile wide caption={t('dashboard.raAlgorithm')} value={info.ra.name} sub={algoSub(info.ra)} />
      )}
      {info.dec && (
        <Tile wide caption={t('dashboard.decAlgorithm')} value={info.dec.name} sub={algoSub(info.dec)} />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output (clean).

- [ ] **Step 3: Commit and push**

```bash
git add src/components/GuidingDashboard.tsx
git commit -m "Add GuidingDashboard header-summary strip component"
git push
```

---

## Task 5: Wire the dashboard into the guiding view

**Files:**
- Modify: `web/src/pages/ViewerPage.tsx`

- [ ] **Step 1: Add the import**

In `web/src/pages/ViewerPage.tsx`, next to the other component imports (after the `GAResultsPanel` import on line ~18), add:

```tsx
import { GuidingDashboard } from '../components/GuidingDashboard';
```

- [ ] **Step 2: Render it after the GA panel**

In the `isGuiding` block, the current order is `<GAResultsPanel />` then `<GraphContextMenu>`. Insert `<GuidingDashboard />` between them so it sits immediately above the chart:

Change:
```tsx
            <GAResultsPanel />
            <GraphContextMenu>
```
to:
```tsx
            <GAResultsPanel />
            {/* Header dashboard hugs the diagram — see
                docs/superpowers/specs/2026-05-27-guiding-dashboard-design.md */}
            <GuidingDashboard />
            <GraphContextMenu>
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output (clean).

- [ ] **Step 4: Commit and push**

```bash
git add src/pages/ViewerPage.tsx
git commit -m "Render GuidingDashboard above the guide chart"
git push
```

---

## Task 6: Default-collapse the Guiding Assistant panel

**Files:**
- Modify: `web/src/components/GAResultsPanel.tsx`

- [ ] **Step 1: Remove the hardcoded `open` and update the comment**

In `web/src/components/GAResultsPanel.tsx`, the root `<details>` (around line 127-137) currently has an `open` attribute. Remove it so the panel starts collapsed (the `<summary>` stays visible and one click expands it).

Change:
```tsx
      className="border-y-2 border-sky-500/60 bg-sky-900/20 px-3 py-1 text-xs"
      open
      title={t('ga.summaryTooltip')}
```
to:
```tsx
      // Default-collapsed (PR 2026-05-27): the run cards were pushing the
      // chart down on every GA-bearing session. The summary line stays
      // visible so the feature is still discoverable; one click expands it.
      className="border-y-2 border-sky-500/60 bg-sky-900/20 px-3 py-1 text-xs"
      title={t('ga.summaryTooltip')}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output (clean).

- [ ] **Step 3: Commit and push**

```bash
git add src/components/GAResultsPanel.tsx
git commit -m "Default the Guiding Assistant panel to collapsed"
git push
```

---

## Task 7: Full verification + PR

**Files:** none (verification only).

- [ ] **Step 1: Full test + typecheck**

Run: `npx tsc --noEmit && npx vitest run`
Expected: typecheck clean; full suite green (including the new `guideHeader` tests).

- [ ] **Step 2: Restart dev server and browser-verify**

Restart Vite (`npm run dev`) and load a real guiding log from `sample data/`. Confirm:
- The dashboard strip renders directly above the chart, below the (now collapsed) Guiding Assistant summary.
- Tiles show Pier side, Hour angle, Altitude, Backlash comp, RA algorithm, Dec algorithm; the **Rotator** tile is absent on a log whose header reads `Rotator pos = N/A` (e.g. `PHD2_GuideLog_2026-04-24_185307.txt`) and present on one with a numeric rotator.
- Aggression reads verbatim (`agg 0.45` / `aggr 32` / `agg 100%`); a plain-Lowpass Dec axis shows `slope wt …`.
- The Guiding Assistant panel starts collapsed on a GA-bearing log, and still expands on click.
- Switch themes (at least **Dark**, **Night**, **Monochrome**) via the theme picker: the surface retints with the skin and the accent rail/captions go emerald → red → grayscale respectively (never an out-of-palette color on Night/Monochrome).

- [ ] **Step 3: Verify branch connectivity, then open the PR (per CLAUDE.md)**

```bash
git merge-base --is-ancestor origin/main HEAD && echo "OK: connected to origin/main" || echo "DIVERGED — stop"
gh pr create --title "Guiding header dashboard + default-collapsed Guiding Assistant" \
  --body "Adds a header-summary dashboard strip above the guide chart (pier side, hour angle, altitude, rotator-when-present, backlash, RA/Dec algorithms) and defaults the Guiding Assistant panel to collapsed. Parser is unit-tested; accent is theme-aware across all five skins. Spec: docs/superpowers/specs/2026-05-27-guiding-dashboard-design.md"
```

- [ ] **Step 4: Auto-merge (coding PR, per CLAUDE.md auto-merge policy)**

Once `tsc --noEmit` + `vitest run` are confirmed clean (Step 1):

```bash
gh pr merge --squash --delete-branch
git checkout main && git pull --ff-only
```

Then restart the dev server on `main` so the merged change is on screen.

---

## Self-Review

**Spec coverage:**
- Pier side, hour angle, altitude, rotator(-when-present), backlash status+amount, RA/Dec algorithm name/aggression/min-move → Task 1 (parse) + Task 4 (render). ✓
- Aggression verbatim; no-agg fallback to own param → Task 1 `parseAlgo` + tests. ✓
- Option-B treatment (elevated slate surface + theme-aware accent) → Task 3 (var) + Task 4 (markup). ✓
- Works across all skins incl. Night/Monochrome → Task 3 overrides + Task 7 manual check. ✓
- Placement after GA panel, above chart → Task 5. ✓
- i18n in 6 locales → Task 2. ✓
- Tooltips → Task 4 (`title` on strip + tiles). ✓
- Default-collapse GA panel → Task 6. ✓
- Unit-test the parser; manual browser check → Task 1 + Task 7. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases" — every code step has complete code. ✓

**Type consistency:** `GuideHeaderInfo` / `AlgoInfo` field names (`pierSide`, `hourAngle`, `altitude`, `rotator`, `backlash.{enabled,pulseMs}`, `ra`, `dec`, `name`, `param`, `minMove`) are identical across the parser (Task 1), the component (Task 4), and the tests (Task 1). `parseGuideHeader` signature matches its call site. i18n keys used in Task 4 (`dashboard.sectionLabel`, `.pierSide`, `.hourAngle`, `.altitude`, `.rotator`, `.backlashComp`, `.raAlgorithm`, `.decAlgorithm`, `.backlashEnabled`, `.backlashDisabled`, `.tooltip`) exactly match the keys added in Task 2. ✓
```
