# Guiding-section header dashboard + default-collapsed Guiding Assistant

Date: 2026-05-27
Branch: `feat/guiding-dashboard`

## Summary

Two changes to the guiding-section view:

1. **Header dashboard.** A compact "dashboard" strip directly above the guide chart
   that surfaces the most-consulted setup facts from the section's PHD2 header:
   pier side, hour angle, altitude, rotator angle (when present), backlash-comp
   status/amount, and the RA & Dec guide-algorithm name / aggression / minimum
   move. Today this data is only reachable by twirling open the raw `SectionHeader`
   block and reading 16 dense key=value lines.

2. **Default-collapse the Guiding Assistant panel.** `GAResultsPanel` currently
   renders its `<details>` hardcoded `open`. Default it to collapsed so the GA
   recommendations no longer push the chart down on every GA-bearing session; the
   summary line stays visible and one click still expands it.

Both are UI-only and live entirely inside `web/`. No parser-pipeline or worker
changes — the header text we need is already captured in `GuideSession.hdr`.

## Part 1 — Header dashboard

### Data source

`GuideSession.hdr: string[]` already holds the raw header lines verbatim (see
`types.ts` and the `SectionHeader` component, which dumps them). The dashboard
parses the three relevant lines out of that array at render time. No new fields on
`GuideSession`; no change to the parse pipeline, worker, or golden tests.

The relevant header lines (formats confirmed across every fixture in `sample data/`):

```
X guide algorithm = Hysteresis, Hysteresis = 0.100, Aggression = 0.450, Minimum move = 0.098
Y guide algorithm = Lowpass, Slope weight = 5.000, Minimum move = 0.250
Backlash comp = enabled, pulse = 163 ms
RA = 15.21 hr, Dec = -90.0 deg, Hour angle = -6.00 hr, Pier side = West, Rotator pos = N/A, Alt = 20.1 deg, Az = 180.0 deg
```

PHD2 convention: **X guide algorithm = RA, Y guide algorithm = Dec.** This mapping
gets a source comment in the parser per the repo's "comment ported algorithms"
rule.

### New unit: `src/parser/guideHeader.ts`

A pure, separately-tested function — no React, no i18n — so the parsing rules can be
locked down with fixtures the way the rest of `src/parser/` is.

```ts
export interface AlgoInfo {
  name: string;          // "Hysteresis", "Resist Switch", "Lowpass2", "Lowpass", …
  param: string | null;  // tidied secondary param, already labeled:
                         //   "agg 0.45" | "aggr 32" | "slope wt 5" | null
  minMove: string | null;// tidied, e.g. "0.2", "0.098"
}

export interface GuideHeaderInfo {
  pierSide: string | null;     // "West" | "East" | …
  hourAngle: string | null;    // "-6.00"  (hours; unit appended in the view)
  altitude: string | null;     // "20.1"   (degrees)
  rotator: string | null;      // "191.1" when present; null when "N/A"/absent
  backlash: { enabled: boolean; pulseMs: string } | null;
  ra: AlgoInfo | null;         // from "X guide algorithm = …"
  dec: AlgoInfo | null;        // from "Y guide algorithm = …"
}

export function parseGuideHeader(hdr: string[]): GuideHeaderInfo;
```

Parsing rules:

- **Coordinate line** — match on `Pier side =`, then pull each field with its own
  regex so field order/whitespace doesn't matter:
  `Pier side = ([^,]+)`, `Hour angle = ([-\d.]+)`, `Alt = ([-\d.]+)`,
  `Rotator pos = ([^,]+)`. Rotator: trim; treat `N/A` (case-insensitive) as `null`.
- **Backlash** — `Backlash comp = (enabled|disabled), pulse = (\d+) ms`.
- **Algorithm lines** — `X guide algorithm = …` / `Y guide algorithm = …`. Note the
  Resist Switch variant is **space-separated, min-move-before-aggression**
  (`… Minimum move = 0.200 Aggression = 100% FastSwitch = enabled`) while the
  others are comma-separated, so parse by keyword, not by position:
  - `name` = text after `= ` up to the first `,` **or** the first ` X = `-style
    key (i.e. up to the first occurrence of a known `Key =`). In practice: capture
    up to the first comma, and if the capture still contains another ` = `, cut it
    at the first parameter keyword. "Resist Switch" must survive (the space inside
    the name is not a delimiter).
  - `minMove` = `Minimum move = ([\d.]+)`.
  - secondary `param`, in priority order: `Aggression = ([\d.]+%?)` → `"agg {v}"`;
    else `Aggressiveness = ([\d.]+)` → `"aggr {v}"`; else the first remaining
    `Key = value` that isn't `Minimum move`/`FastSwitch` (e.g. `Slope weight = 5.000`
    → `"slope wt 5"`). If nothing, `null`.
- **Number tidying** (`tidyNum`) — strip trailing zeros after a decimal point and a
  dangling dot (`0.450`→`0.45`, `32.000`→`32`, `0.200`→`0.2`); leave a trailing `%`
  intact. Matches the trailing-zero trimming already done in `parseInfo.ts`.
- Any line absent → its fields are `null`. The whole result is "best effort"; old
  logs missing the coordinate line simply omit those tiles.

### Component: `src/components/GuidingDashboard.tsx`

Presentational, reads `log`/`selectedSection` from `useLogStore` the same way
`GAResultsPanel` does, memoizes `parseGuideHeader(session.hdr)`. Renders **nothing**
when the section isn't guiding or when every field came back `null`.

Tiles (in order), each rendered only if its data is present:

| Tile          | Caption (i18n)    | Value                                            |
|---------------|-------------------|--------------------------------------------------|
| Pier side     | Pier side         | `West` / `East`                                  |
| Hour angle    | Hour angle        | `-6.00 h`                                         |
| Altitude      | Altitude          | `20.1°`                                           |
| Rotator       | Rotator           | `191.1°`  *(omitted entirely when null)*          |
| Backlash      | Backlash comp     | enabled → `Enabled · 163 ms`; disabled → `Disabled` |
| RA algorithm  | RA algorithm      | `Hysteresis` + sub `· agg 0.45 · min 0.098`       |
| Dec algorithm | Dec algorithm     | `Lowpass` + sub `· slope wt 5 · min 0.25`         |

The two algorithm tiles are double-width (they carry name + two sub-values). Each
tile has a `title` with the raw header fragment it came from (per the repo's
"tooltips on all interactive UI" habit, applied here so hovering explains the
abbreviations). The strip container gets a `title` naming it the guiding setup
summary.

### Visual treatment ("Option B", chosen via the visual companion)

Elevated panel with a theme-aware accent rail. Built so it stands out on every skin
without violating Night (all-crimson, dark-adapted) or Monochrome (chrome is
colorless by design):

- **Surface** uses Tailwind `slate-*` classes so the theme system retints it
  automatically: tiles `bg-slate-800`, 1px dividers from a `bg-slate-700` backing
  with `gap-px`, top/bottom `border-y border-slate-700`, values `text-slate-100`.
- **Accent** is a new CSS variable `--dash-accent`, applied to the 3px left rail
  (inline `style`), the small bold "Guiding setup" section label, and the tile
  captions (`.dash-accent { color: var(--dash-accent) }`). Captions stay 9px
  uppercase; values stay `text-slate-100`.
- `--dash-accent` is defined once in `:root` (the default/dark value) and overridden
  in each non-default `[data-theme=…]` block in `index.css`, alongside the existing
  per-theme overrides:

  | Theme          | `--dash-accent` | rationale                                  |
  |----------------|-----------------|--------------------------------------------|
  | default (dark) | `#34d399`       | emerald-400; distinct from GA panel's sky  |
  | paper          | `#0d9488`       | teal-600; readable on white                |
  | high-contrast  | `#22d3ee`       | bright cyan on black                       |
  | night          | `#ff9a9a`       | stays in the red family; preserves dark adaptation |
  | monochrome     | `#000000`       | grayscale; honors the colorless-chrome rule |

  Adding `--dash-accent` to the theme blocks is the same "append a value when you add
  a theme" contract `themes.ts` already documents.

### Placement (`ViewerPage.tsx`)

Insert `<GuidingDashboard />` in the guiding branch **after** `<GAResultsPanel />`
and **before** `<GraphContextMenu>`. Resulting order:

```
GraphToolbar → SectionHeader → SectionSummary → GAResultsPanel → GuidingDashboard → chart → StatsGrid
```

It sits outside the `TIME`/`SCATTER` chart swap, so it shows in both graph modes.

### i18n

New `dashboard` block in `sections.json` for all six locales (en, es, de, fr, it,
zh): captions (`pierSide`, `hourAngle`, `altitude`, `rotator`, `backlashComp`,
`raAlgorithm`, `decAlgorithm`), the `sectionLabel` ("Guiding setup"), and
`backlashEnabled`/`backlashDisabled` value strings, plus a `tooltip`. Per the repo's
locale policy, PHD2 jargon (RA, Dec, algorithm names, units) stays in English in
every locale; only the surrounding labels are translated.

## Part 2 — Default-collapse the Guiding Assistant panel

In `GAResultsPanel.tsx`, remove the hardcoded `open` attribute on the root
`<details>` (line ~135). The `<summary>` ("Guiding Assistant — N runs") stays
visible so the feature is still discoverable; the run cards are hidden until the
user clicks. No state/persistence added — uncontrolled `<details>` defaulting to
closed is sufficient. Update the adjacent comment to say it now defaults collapsed.

## Testing

- **`guideHeader.test.ts`** — unit tests over the real header variants pulled from
  `sample data/`: Hysteresis (`Aggression` fraction), Lowpass2 (`Aggressiveness`),
  Resist Switch (space-separated, `%`, min-move-first), Lowpass (no aggression →
  slope-weight fallback), backlash enabled vs disabled, rotator present vs `N/A`,
  and a header missing the coordinate line (all-null coordinate fields). Assert the
  exact tidied output strings.
- **`tsc --noEmit` + `vitest run`** clean before opening the PR (per `CLAUDE.md`).
- **Manual / browser check** across at least Dark, Night, and Monochrome skins on a
  real log, confirming the strip renders, the accent adapts, tiles omit correctly
  (a log with `Rotator pos = N/A` shows no rotator tile), and the GA panel now
  starts collapsed. Chart gestures are untouched, but verify the dashboard doesn't
  shift the chart enough to affect drag/zoom.

## Out of scope (YAGNI)

- No new structured fields persisted on `GuideSession`; parsing stays at render time.
- No RA/Dec/Az coordinates, exposure, pixel scale, or equipment profile in the
  dashboard — those remain in the expandable `SectionHeader`.
- No per-user persistence of the GA panel open/closed state.
- No dashboard for calibration sections (calibration headers don't carry guide
  algorithms/backlash; their identification strip is unchanged).
```
