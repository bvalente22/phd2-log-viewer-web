# PHD2 Web Viewer v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship v1 of the web edition of PHD2 Log Viewer — a static React app that parses PHD2 guide logs in the browser and renders the main guide graph with stats, exclusion editing, info markers, and IndexedDB recents.

**Architecture:** Pure-TS parser ported from [logparser.cpp](../../../logparser.cpp), Zustand state, Plotly.js (`scattergl`) for charts, Tailwind + Radix for UI, IndexedDB via `idb-keyval` for recents. All inside a new `web/` directory at repo root. Module boundaries: `parser/` → `state/` → `components/`, with `storage/` called only from `state/`.

**Tech Stack:** React 18, TypeScript, Vite, Tailwind CSS, Radix UI, Zustand, Plotly.js + react-plotly.js, idb-keyval, Vitest, Playwright.

**Spec:** [docs/superpowers/specs/2026-05-01-phd2-log-viewer-web-design.md](../specs/2026-05-01-phd2-log-viewer-web-design.md)

---

## File Structure

```
web/
  package.json                 # Task 1
  tsconfig.json                # Task 1
  vite.config.ts               # Task 1
  tailwind.config.js           # Task 1
  postcss.config.js            # Task 1
  index.html                   # Task 1
  playwright.config.ts         # Task 23
  src/
    main.tsx                   # Task 1
    index.css                  # Task 1
    parser/
      types.ts                 # Task 2
      tokens.ts                # Task 3
      parseEntry.ts            # Task 4
      parseCalibration.ts      # Task 5
      parseInfo.ts             # Task 6
      fixupMonotonic.ts        # Task 7
      parseLog.ts              # Task 8
      stats.ts                 # Task 9
      index.ts                 # Task 9
      __tests__/
        parseEntry.test.ts     # Task 4
        parseCalibration.test.ts # Task 5
        parseInfo.test.ts      # Task 6
        fixupMonotonic.test.ts # Task 7
        parseLog.test.ts       # Task 8
        stats.test.ts          # Task 9
        golden.test.ts         # Task 10
        fixtures/
          synthetic.log        # Task 8
          synthetic.golden.json # Task 10
    storage/
      recents.ts               # Task 11
      __tests__/recents.test.ts # Task 11
    state/
      logStore.ts              # Task 12
      viewStore.ts             # Task 13
    components/
      App.tsx                  # Task 22
      DropZone.tsx             # Task 14
      RecentsPanel.tsx         # Task 20
      SectionList.tsx          # Task 15
      StatsGrid.tsx            # Task 16
      GuideGraph.tsx           # Task 17
      ContextMenu.tsx          # Task 19
    pages/
      ViewerPage.tsx           # Task 21
  samples/
    README.md                  # Task 23
  e2e/
    smoke.spec.ts              # Task 23
```

---

### Task 1: Scaffold Vite + React + TS + Tailwind in `web/`

**Files:**
- Create: `web/package.json`, `web/tsconfig.json`, `web/tsconfig.node.json`, `web/vite.config.ts`, `web/index.html`, `web/postcss.config.js`, `web/tailwind.config.js`, `web/src/main.tsx`, `web/src/index.css`, `web/.gitignore`

- [ ] **Step 1: Create `web/.gitignore`**

```
node_modules
dist
coverage
playwright-report
test-results
.vite
```

- [ ] **Step 2: Create `web/package.json`**

```json
{
  "name": "phd2-log-viewer-web",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "e2e": "playwright test",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "idb-keyval": "^6.2.1",
    "plotly.js": "^2.35.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-plotly.js": "^2.6.0",
    "zustand": "^4.5.5",
    "@radix-ui/react-context-menu": "^2.2.2",
    "@radix-ui/react-tooltip": "^1.1.4"
  },
  "devDependencies": {
    "@playwright/test": "^1.48.0",
    "@types/plotly.js": "^2.33.4",
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "@types/react-plotly.js": "^2.6.3",
    "@vitejs/plugin-react": "^4.3.3",
    "autoprefixer": "^10.4.20",
    "postcss": "^8.4.47",
    "tailwindcss": "^3.4.14",
    "typescript": "^5.6.3",
    "vite": "^5.4.10",
    "vitest": "^2.1.4",
    "jsdom": "^25.0.1",
    "fake-indexeddb": "^6.0.0"
  }
}
```

- [ ] **Step 3: Create `web/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "allowImportingTsExtensions": false,
    "types": ["vitest/globals"]
  },
  "include": ["src", "e2e"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

- [ ] **Step 4: Create `web/tsconfig.node.json`**

```json
{
  "compilerOptions": {
    "composite": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["vite.config.ts", "playwright.config.ts"]
}
```

- [ ] **Step 5: Create `web/vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
  },
});
```

- [ ] **Step 6: Create `web/src/test-setup.ts`**

```ts
import 'fake-indexeddb/auto';
```

- [ ] **Step 7: Create `web/postcss.config.js`**

```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 8: Create `web/tailwind.config.js`**

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
};
```

- [ ] **Step 9: Create `web/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>PHD2 Log Viewer</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 10: Create `web/src/index.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

html, body, #root { height: 100%; }
body { @apply bg-slate-950 text-slate-100; }
```

- [ ] **Step 11: Create `web/src/main.tsx` (placeholder app)**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';

function App() {
  return <div className="p-4">PHD2 Log Viewer (scaffold)</div>;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

- [ ] **Step 12: Install and verify dev server boots**

```
cd web && npm install && npm run typecheck
```

Expected: typecheck passes with zero errors.

- [ ] **Step 13: Commit**

```
git add web/.gitignore web/package.json web/package-lock.json web/tsconfig*.json web/vite.config.ts web/postcss.config.js web/tailwind.config.js web/index.html web/src/main.tsx web/src/index.css web/src/test-setup.ts
git commit -m "Scaffold web/ with Vite + React + TS + Tailwind"
```

---

### Task 2: Parser types

**Files:** Create `web/src/parser/types.ts`

- [ ] **Step 1: Write `web/src/parser/types.ts`**

```ts
export type WhichMount = 'MOUNT' | 'AO';

export interface GuideEntry {
  frame: number;
  dt: number;          // seconds since session start
  mount: WhichMount;
  included: boolean;
  guiding: boolean;
  dx: number;
  dy: number;
  raraw: number;
  decraw: number;
  raguide: number;
  decguide: number;
  radur: number;       // signed: negative = West
  decdur: number;      // signed: negative = South
  mass: number;
  snr: number;
  err: number;
  info: string;
}

export interface InfoEntry {
  idx: number;         // index into entries[] of the following frame
  repeats: number;
  info: string;
}

export type CalDirection = 'WEST' | 'EAST' | 'BACKLASH' | 'NORTH' | 'SOUTH';

export interface CalibrationEntry {
  direction: CalDirection;
  step: number;
  dx: number;
  dy: number;
}

export interface Limits {
  minMo: number;
  maxDur: number;
}

export interface Mount {
  isValid: boolean;
  xRate: number;
  yRate: number;
  xAngle: number;
  yAngle: number;
  xlim: Limits;
  ylim: Limits;
}

export const newMount = (): Mount => ({
  isValid: false,
  xRate: 1.0,
  yRate: 1.0,
  xAngle: 0.0,
  yAngle: Math.PI / 2,
  xlim: { minMo: 0, maxDur: 0 },
  ylim: { minMo: 0, maxDur: 0 },
});

export interface GuideSession {
  date: string;             // raw date string from "Guiding Begins at "
  startsMs: number | null;  // parsed UTC ms, or null if unparseable
  hdr: string[];
  duration: number;
  pixelScale: number;
  declination: number;      // radians
  entries: GuideEntry[];
  infos: InfoEntry[];
  ao: Mount;
  mount: Mount;
}

export const newGuideSession = (date: string): GuideSession => ({
  date,
  startsMs: null,
  hdr: [],
  duration: 0,
  pixelScale: 1,
  declination: 0,
  entries: [],
  infos: [],
  ao: newMount(),
  mount: newMount(),
});

export interface Calibration {
  date: string;
  startsMs: number | null;
  hdr: string[];
  device: WhichMount;
  entries: CalibrationEntry[];
}

export const newCalibration = (date: string): Calibration => ({
  date,
  startsMs: null,
  hdr: [],
  device: 'MOUNT',
  entries: [],
});

export type SectionType = 'CALIBRATION' | 'GUIDING';

export interface LogSectionLoc {
  type: SectionType;
  idx: number;
}

export interface GuideLog {
  phdVersion: string;
  sessions: GuideSession[];
  calibrations: Calibration[];
  sections: LogSectionLoc[];
}

export const newGuideLog = (): GuideLog => ({
  phdVersion: '',
  sessions: [],
  calibrations: [],
  sections: [],
});
```

- [ ] **Step 2: Typecheck**

Run: `cd web && npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```
git add web/src/parser/types.ts
git commit -m "Add parser types"
```

---

### Task 3: Parser tokens

**Files:** Create `web/src/parser/tokens.ts`

- [ ] **Step 1: Write `web/src/parser/tokens.ts`**

```ts
export const VERSION_PREFIX = 'PHD2 version ';
export const GUIDING_BEGINS = 'Guiding Begins at ';
export const GUIDING_HEADING = 'Frame,Time,mount';
export const MOUNT_KEY = 'Mount = ';
export const AO_KEY = 'AO = ';
export const PX_SCALE = 'Pixel scale = ';
export const GUIDING_ENDS = 'Guiding Ends';
export const INFO_KEY = 'INFO: ';
export const CALIBRATION_BEGINS = 'Calibration Begins at ';
export const CALIBRATION_HEADING = 'Direction,Step,dx,dy,x,y,Dist';
export const CALIBRATION_ENDS = 'Calibration complete';
export const XALGO = 'X guide algorithm = ';
export const YALGO = 'Y guide algorithm = ';
export const MINMOVE = 'Minimum move = ';

export const startsWith = (s: string, p: string): boolean =>
  s.length >= p.length && s.slice(0, p.length) === p;

export const endsWith = (s: string, p: string): boolean =>
  s.length >= p.length && s.slice(s.length - p.length) === p;

export const isEmpty = (s: string): boolean => /^\s*$/.test(s);

export const rtrim = (s: string): string => s.replace(/[\s\r\n]+$/, '');

/** StarWasFound: true for STAR_OK (0) and STAR_SATURATED (1). Mirrors PHD2. */
export const starWasFound = (err: number): boolean => err === 0 || err === 1;

/**
 * Parse a "key = value" pair out of a header line and return the number,
 * or `dflt` if not found / not parseable.
 */
export const getDbl = (ln: string, key: string, dflt: number): number => {
  const i = ln.indexOf(key);
  if (i < 0) return dflt;
  const tail = ln.slice(i + key.length);
  const v = parseFloat(tail);
  return Number.isFinite(v) ? v : dflt;
};
```

- [ ] **Step 2: Typecheck**

Run: `cd web && npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```
git add web/src/parser/tokens.ts
git commit -m "Add parser tokens and small helpers"
```

---

### Task 4: `parseEntry` (CSV row → GuideEntry)

**Files:** Create `web/src/parser/parseEntry.ts`, `web/src/parser/__tests__/parseEntry.test.ts`

Background: the original C++ in [logparser.cpp:103-275](../../../logparser.cpp#L103-L275) splits on commas with default-on-empty handling. Direction columns flip the sign of the duration. AO's XStep/YStep columns overwrite radur/decdur after the flip.

- [ ] **Step 1: Write the failing test**

```ts
// web/src/parser/__tests__/parseEntry.test.ts
import { describe, it, expect } from 'vitest';
import { parseEntry } from '../parseEntry';

describe('parseEntry', () => {
  it('parses a typical mount row with West/North directions (durations stay positive)', () => {
    const ln = '42,12.345,"Mount",0.10,-0.20,0.05,-0.07,0.04,-0.06,150,E,80,N,,,1234,12.5,0';
    const e = parseEntry(ln);
    expect(e).not.toBeNull();
    expect(e!.frame).toBe(42);
    expect(e!.dt).toBeCloseTo(12.345);
    expect(e!.mount).toBe('MOUNT');
    expect(e!.dx).toBeCloseTo(0.10);
    expect(e!.dy).toBeCloseTo(-0.20);
    expect(e!.raraw).toBeCloseTo(0.05);
    expect(e!.decraw).toBeCloseTo(-0.07);
    expect(e!.raguide).toBeCloseTo(0.04);
    expect(e!.decguide).toBeCloseTo(-0.06);
    expect(e!.radur).toBe(150);   // East = positive
    expect(e!.decdur).toBe(80);   // North = positive
    expect(e!.mass).toBe(1234);
    expect(e!.snr).toBeCloseTo(12.5);
    expect(e!.err).toBe(0);
    expect(e!.info).toBe('');
  });

  it('flips RADuration sign for West and DECDuration for South', () => {
    const ln = '1,1.0,"Mount",0,0,0,0,0,0,200,W,300,S,,,0,0,0';
    const e = parseEntry(ln)!;
    expect(e.radur).toBe(-200);
    expect(e.decdur).toBe(-300);
  });

  it('parses AO row with XStep/YStep overwriting radur/decdur', () => {
    const ln = '5,5.0,"AO",0,0,0,0,0,0,100,E,50,N,7,-3,0,0,0';
    const e = parseEntry(ln)!;
    expect(e.mount).toBe('AO');
    expect(e.radur).toBe(7);
    expect(e.decdur).toBe(-3);
  });

  it('captures trailing info column with quotes stripped', () => {
    const ln = '9,9.0,"Mount",0,0,0,0,0,0,0,E,0,N,,,0,0,2,"Star lost - low SNR"';
    const e = parseEntry(ln)!;
    expect(e.err).toBe(2);
    expect(e.info).toBe('Star lost - low SNR');
  });

  it('treats unknown mount string as MOUNT (older logs)', () => {
    const ln = '1,1.0,"My Mount Name",0,0,0,0,0,0,0,E,0,N,,,0,0,0';
    const e = parseEntry(ln)!;
    expect(e.mount).toBe('MOUNT');
  });

  it('returns null on a malformed row', () => {
    expect(parseEntry('not,a,row')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm test -- parseEntry`
Expected: FAIL — module `../parseEntry` not found.

- [ ] **Step 3: Implement `web/src/parser/parseEntry.ts`**

```ts
import type { GuideEntry, WhichMount } from './types';

const toLong = (s: string): number | null => {
  if (!s) return null;
  const v = parseInt(s, 10);
  return Number.isFinite(v) ? v : null;
};

const toDouble = (s: string): number | null => {
  if (!s) return null;
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : null;
};

export function parseEntry(ln: string): GuideEntry | null {
  const cols = ln.split(',');
  if (cols.length < 15) return null;

  const frame = toLong(cols[0]);
  if (frame === null) return null;

  const dt = toDouble(cols[1]);
  if (dt === null) return null;

  const mountStr = cols[2];
  let mount: WhichMount;
  if (mountStr === '"Mount"') mount = 'MOUNT';
  else if (mountStr === '"AO"') mount = 'AO';
  else mount = 'MOUNT'; // older logs had the mount name here

  const numOrZero = (s: string | undefined): number => {
    if (s === undefined || s === '') return 0;
    const v = parseFloat(s);
    return Number.isFinite(v) ? v : NaN;
  };

  const dx = numOrZero(cols[3]);
  const dy = numOrZero(cols[4]);
  const raraw = numOrZero(cols[5]);
  const decraw = numOrZero(cols[6]);
  const raguide = numOrZero(cols[7]);
  const decguide = numOrZero(cols[8]);
  if ([dx, dy, raraw, decraw, raguide, decguide].some(Number.isNaN)) return null;

  let radur = cols[9] === '' ? 0 : (() => {
    const v = parseInt(cols[9], 10);
    return Number.isFinite(v) ? v : NaN;
  })();
  if (Number.isNaN(radur)) return null;

  const raDir = cols[10];
  if (raDir) {
    if (raDir[0] === 'E') {
      // positive
    } else if (raDir[0] === 'W') {
      radur = -radur;
    } else {
      return null;
    }
  }

  let decdur = cols[11] === '' ? 0 : (() => {
    const v = parseInt(cols[11], 10);
    return Number.isFinite(v) ? v : NaN;
  })();
  if (Number.isNaN(decdur)) return null;

  const decDir = cols[12];
  if (decDir) {
    if (decDir[0] === 'N') {
      // positive
    } else if (decDir[0] === 'S') {
      decdur = -decdur;
    } else {
      return null;
    }
  }

  // XStep/YStep overwrite radur/decdur for AO
  if (cols[13] !== undefined && cols[13] !== '') {
    const v = parseInt(cols[13], 10);
    if (!Number.isFinite(v)) return null;
    radur = v;
  }
  if (cols[14] !== undefined && cols[14] !== '') {
    const v = parseInt(cols[14], 10);
    if (!Number.isFinite(v)) return null;
    decdur = v;
  }

  const mass = cols[15] === undefined || cols[15] === '' ? 0 : parseInt(cols[15], 10);
  const snr = cols[16] === undefined || cols[16] === '' ? 0 : parseFloat(cols[16]);
  const err = cols[17] === undefined || cols[17] === '' ? 0 : parseInt(cols[17], 10);
  if ([mass, snr, err].some((v) => !Number.isFinite(v))) return null;

  let info = '';
  if (cols[18] !== undefined && cols[18] !== '') {
    info = cols[18];
    if (info.length >= 2 && info.startsWith('"') && info.endsWith('"')) {
      info = info.slice(1, info.length - 1);
    }
  }

  return {
    frame,
    dt,
    mount,
    included: true,
    guiding: false,
    dx,
    dy,
    raraw,
    decraw,
    raguide,
    decguide,
    radur,
    decdur,
    mass,
    snr,
    err,
    info,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npm test -- parseEntry`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```
git add web/src/parser/parseEntry.ts web/src/parser/__tests__/parseEntry.test.ts
git commit -m "Add parseEntry with direction-flip and AO-step handling"
```

---

### Task 5: `parseCalibration`

**Files:** Create `web/src/parser/parseCalibration.ts`, `web/src/parser/__tests__/parseCalibration.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// web/src/parser/__tests__/parseCalibration.test.ts
import { describe, it, expect } from 'vitest';
import { parseCalibration } from '../parseCalibration';

describe('parseCalibration', () => {
  it('parses a Mount West entry', () => {
    const e = parseCalibration('West,1,0.5,-0.2,1,2,0.8')!;
    expect(e.direction).toBe('WEST');
    expect(e.step).toBe(1);
    expect(e.dx).toBeCloseTo(0.5);
    expect(e.dy).toBeCloseTo(-0.2);
  });

  it('treats Left as WEST (AO)', () => {
    const e = parseCalibration('Left,3,0.1,0.0,0,0,0.1')!;
    expect(e.direction).toBe('WEST');
  });

  it('treats Up as NORTH (AO)', () => {
    const e = parseCalibration('Up,2,0.0,0.4,0,0,0.4')!;
    expect(e.direction).toBe('NORTH');
  });

  it('parses Backlash', () => {
    const e = parseCalibration('Backlash,1,0,0.05,0,0,0.05')!;
    expect(e.direction).toBe('BACKLASH');
  });

  it('returns null for unknown direction', () => {
    expect(parseCalibration('Sideways,1,0,0,0,0,0')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm test -- parseCalibration`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `web/src/parser/parseCalibration.ts`**

```ts
import type { CalibrationEntry, CalDirection } from './types';

const DIRS: Record<string, CalDirection> = {
  West: 'WEST',
  Left: 'WEST',
  East: 'EAST',
  Backlash: 'BACKLASH',
  North: 'NORTH',
  Up: 'NORTH',
  South: 'SOUTH',
};

export function isAoDirectionToken(tok: string): boolean {
  return tok === 'Left' || tok === 'Up';
}

export function parseCalibration(ln: string): CalibrationEntry | null {
  const cols = ln.split(',');
  if (cols.length < 4) return null;
  const direction = DIRS[cols[0]];
  if (!direction) return null;
  const step = parseInt(cols[1], 10);
  const dx = parseFloat(cols[2]);
  const dy = parseFloat(cols[3]);
  if (![step, dx, dy].every(Number.isFinite)) return null;
  return { direction, step, dx, dy };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npm test -- parseCalibration`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add web/src/parser/parseCalibration.ts web/src/parser/__tests__/parseCalibration.test.ts
git commit -m "Add parseCalibration with Mount/AO direction tokens"
```

---

### Task 6: `parseInfo` with coalescing

**Files:** Create `web/src/parser/parseInfo.ts`, `web/src/parser/__tests__/parseInfo.test.ts`

Background: rules from [logparser.cpp:332-394](../../../logparser.cpp#L332-L394). Strip `"SETTLING STATE CHANGE, "` and `"Guiding parameter change, "` prefixes; trim DITHER trailing `, new lock pos ...`; strip trailing zeros after the last `.`. Coalesce repeated identical events; replace prior at same idx for parameter changes (same key before `=`); replace prior `SET LOCK POS` when followed by `DITHER` at same idx.

- [ ] **Step 1: Write the failing test**

```ts
// web/src/parser/__tests__/parseInfo.test.ts
import { describe, it, expect } from 'vitest';
import { addInfo } from '../parseInfo';
import type { InfoEntry } from '../types';

describe('addInfo', () => {
  it('strips SETTLING STATE CHANGE prefix', () => {
    const infos: InfoEntry[] = [];
    addInfo(infos, 5, 'SETTLING STATE CHANGE, state=1');
    expect(infos[0].info).toBe('state=1');
  });

  it('strips Guiding parameter change prefix', () => {
    const infos: InfoEntry[] = [];
    addInfo(infos, 5, 'Guiding parameter change, RA aggressiveness = 0.7');
    expect(infos[0].info).toBe('RA aggressiveness = 0.7');
  });

  it('trims DITHER , new lock pos suffix', () => {
    const infos: InfoEntry[] = [];
    addInfo(infos, 5, 'DITHER 0.5, 0.5, new lock pos 1.0,2.0');
    expect(infos[0].info).toBe('DITHER 0.5, 0.5');
  });

  it('strips trailing zeros after last decimal', () => {
    const infos: InfoEntry[] = [];
    addInfo(infos, 5, 'aggressiveness = 0.70000');
    expect(infos[0].info).toBe('aggressiveness = 0.7');
  });

  it('coalesces repeated identical events on adjacent frames', () => {
    const infos: InfoEntry[] = [];
    addInfo(infos, 5, 'Star lost');
    addInfo(infos, 6, 'Star lost');
    addInfo(infos, 7, 'Star lost');
    expect(infos.length).toBe(1);
    expect(infos[0].repeats).toBe(3);
  });

  it('replaces prior parameter-change at same idx when key matches', () => {
    const infos: InfoEntry[] = [];
    addInfo(infos, 5, 'aggressiveness = 0.5');
    addInfo(infos, 5, 'aggressiveness = 0.7');
    expect(infos.length).toBe(1);
    expect(infos[0].info).toBe('aggressiveness = 0.7');
  });

  it('replaces SET LOCK POS with DITHER at same idx', () => {
    const infos: InfoEntry[] = [];
    addInfo(infos, 5, 'SET LOCK POS 1.0, 2.0');
    addInfo(infos, 5, 'DITHER 0.5, 0.5');
    expect(infos.length).toBe(1);
    expect(infos[0].info).toBe('DITHER 0.5, 0.5');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm test -- parseInfo`
Expected: FAIL.

- [ ] **Step 3: Implement `web/src/parser/parseInfo.ts`**

```ts
import type { InfoEntry } from './types';

const SETTLING_PFX = 'SETTLING STATE CHANGE, ';
const PARAM_PFX = 'Guiding parameter change, ';

const beforeLast = (s: string, ch: string): string => {
  const i = s.lastIndexOf(ch);
  return i < 0 ? s : s.slice(0, i);
};

/**
 * Append an INFO event for a frame index (`idx` = index of the *following*
 * entry — same convention as the C++ parser). Applies the coalescing rules.
 */
export function addInfo(infos: InfoEntry[], idx: number, raw: string): void {
  let info = raw;

  if (info.startsWith(SETTLING_PFX)) info = info.slice(SETTLING_PFX.length);
  else if (info.startsWith(PARAM_PFX)) info = info.slice(PARAM_PFX.length);

  if (info.startsWith('DITHER')) {
    const p = info.indexOf(', new lock pos');
    if (p >= 0) info = info.slice(0, p);
  }

  if (info.endsWith('00')) {
    // strip trailing zeros after the last "."
    info = info.replace(/(\.[0-9]*?)0+$/, '$1');
    // collapse a trailing "." (e.g. "0." → "0")
    if (info.endsWith('.')) info = info.slice(0, -1);
  }

  if (infos.length > 0) {
    const prev = infos[infos.length - 1];

    // coalesce repeated events on adjacent frames
    if (prev.info === info && idx >= prev.idx && idx <= prev.idx + prev.repeats) {
      prev.repeats += 1;
      return;
    }

    if (prev.idx === idx) {
      // coalesce parameter changes (same key before '=')
      if (prev.info.includes('=') && info.startsWith(beforeLast(prev.info, '='))) {
        prev.info = info;
        return;
      }
      // SET LOCK POS replaced by DITHER at same idx
      if (info.startsWith('DITHER') && prev.info.startsWith('SET LOCK POS')) {
        prev.info = info;
        return;
      }
    }
  }

  infos.push({ idx, repeats: 1, info });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npm test -- parseInfo`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add web/src/parser/parseInfo.ts web/src/parser/__tests__/parseInfo.test.ts
git commit -m "Add addInfo with coalescing rules"
```

---

### Task 7: `fixupMonotonic`

**Files:** Create `web/src/parser/fixupMonotonic.ts`, `web/src/parser/__tests__/fixupMonotonic.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// web/src/parser/__tests__/fixupMonotonic.test.ts
import { describe, it, expect } from 'vitest';
import { fixupNonMonotonic } from '../fixupMonotonic';
import { newGuideSession } from '../types';
import type { GuideEntry } from '../types';

const mkEntry = (frame: number, dt: number): GuideEntry => ({
  frame, dt, mount: 'MOUNT', included: true, guiding: true,
  dx: 0, dy: 0, raraw: 0, decraw: 0, raguide: 0, decguide: 0,
  radur: 0, decdur: 0, mass: 0, snr: 0, err: 0, info: '',
});

describe('fixupNonMonotonic', () => {
  it('leaves monotonic sessions untouched', () => {
    const s = newGuideSession('x');
    s.entries = [mkEntry(1, 1), mkEntry(2, 2), mkEntry(3, 3)];
    fixupNonMonotonic(s);
    expect(s.entries.map(e => e.dt)).toEqual([1, 2, 3]);
    expect(s.infos.length).toBe(0);
  });

  it('repairs a backward jump using the median positive interval and inserts info event', () => {
    const s = newGuideSession('x');
    // intervals: 1, 1, -3 (backward), then 1, 1
    s.entries = [
      mkEntry(1, 1), mkEntry(2, 2), mkEntry(3, 3),
      mkEntry(4, 0), mkEntry(5, 1), mkEntry(6, 2),
    ];
    fixupNonMonotonic(s);
    const dts = s.entries.map(e => e.dt);
    for (let i = 1; i < dts.length; i++) {
      expect(dts[i]).toBeGreaterThan(dts[i - 1]);
    }
    expect(s.infos.length).toBe(1);
    expect(s.infos[0].info).toBe('Timestamp jumped backwards');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm test -- fixupMonotonic`
Expected: FAIL.

- [ ] **Step 3: Implement `web/src/parser/fixupMonotonic.ts`**

```ts
import type { GuideSession, InfoEntry } from './types';

const isMonotonic = (s: GuideSession): boolean => {
  for (let i = 1; i < s.entries.length; i++) {
    if (s.entries[i].dt <= s.entries[i - 1].dt) return false;
  }
  return true;
};

const insertInfo = (s: GuideSession, entryIdx: number, info: string) => {
  let pos = 0;
  while (pos < s.infos.length) {
    if (s.entries[s.infos[pos].idx].frame >= s.entries[entryIdx].frame) break;
    pos++;
  }
  const ie: InfoEntry = { idx: entryIdx, repeats: 1, info };
  s.infos.splice(pos, 0, ie);
};

export function fixupNonMonotonic(s: GuideSession): void {
  if (s.entries.length <= 1 || isMonotonic(s)) return;

  const positives: number[] = [];
  for (let i = 1; i < s.entries.length; i++) {
    const d = s.entries[i].dt - s.entries[i - 1].dt;
    if (d > 0) positives.push(d);
  }
  if (positives.length === 0) return;
  positives.sort((a, b) => a - b);
  const med = positives[Math.floor(positives.length / 2)];

  let corr = 0;
  for (let i = 1; i < s.entries.length; i++) {
    const d = s.entries[i].dt + corr - s.entries[i - 1].dt;
    if (d <= 0) {
      corr += med - d;
      insertInfo(s, i, 'Timestamp jumped backwards');
    }
    s.entries[i].dt += corr;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npm test -- fixupMonotonic`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add web/src/parser/fixupMonotonic.ts web/src/parser/__tests__/fixupMonotonic.test.ts
git commit -m "Add fixupNonMonotonic with median-interval repair"
```

---

### Task 8: `parseLog` state machine

**Files:** Create `web/src/parser/parseLog.ts`, `web/src/parser/__tests__/parseLog.test.ts`, `web/src/parser/__tests__/fixtures/synthetic.log`

Background: state machine from [logparser.cpp:524-763](../../../logparser.cpp#L524-L763).

- [ ] **Step 1: Create synthetic fixture `web/src/parser/__tests__/fixtures/synthetic.log`**

```
PHD2 version 2.6.11, Log version 2.5. Log enabled at 2024-01-15 22:00:00
Calibration Begins at 2024-01-15 22:00:05
Mount = "Test Mount", xAngle = 0.0, xRate = 5.0, yAngle = 1.5708, yRate = 5.0
Pixel scale = 1.50 arc-sec/px, Binning = 1
Direction,Step,dx,dy,x,y,Dist
West,1,0.5,0.0,0.5,0.0,0.5
West,2,1.0,0.0,1.0,0.0,1.0
East,1,0.5,0.0,0.5,0.0,0.5
North,1,0.0,0.5,0.0,0.5,0.5
South,1,0.0,0.0,0.0,0.0,0.0
Calibration complete

Guiding Begins at 2024-01-15 22:05:00
Mount = "Test Mount", xAngle = 0.0, xRate = 5.0, yAngle = 1.5708, yRate = 5.0, guiding enabled, Max RA duration = 2000, Max DEC duration = 2000
Pixel scale = 1.50 arc-sec/px, Binning = 1
RA = 5.0 hr, Dec = 30.0 deg, Hour angle = 0.0 hr
X guide algorithm = Hysteresis, Minimum move = 0.10
Y guide algorithm = Resist Switch, Minimum move = 0.20
Frame,Time,mount,dx,dy,RARawDistance,DECRawDistance,RAGuideDistance,DECGuideDistance,RADuration,RADirection,DECDuration,DECDirection,XStep,YStep,StarMass,SNR,ErrorCode,Info
1,1.000,"Mount",0.10,0.05,0.10,0.05,0.10,0.05,100,W,50,N,,,1500,15.5,0
2,2.000,"Mount",-0.05,0.10,-0.05,0.10,-0.05,0.10,50,E,100,N,,,1500,15.0,0
3,3.000,"Mount",0.20,-0.10,0.20,-0.10,0.20,-0.10,200,W,100,S,,,1500,14.5,0
INFO: SETTLING STATE CHANGE, state=1
4,4.000,"Mount",0.05,0.00,0.05,0.00,0.05,0.00,50,W,0,N,,,1500,15.0,0
INFO: SETTLING STATE CHANGE, state=0
5,5.000,"Mount",-0.10,0.05,-0.10,0.05,-0.10,0.05,100,E,50,N,,,1500,15.5,0
Guiding Ends at 2024-01-15 22:10:00
```

- [ ] **Step 2: Write the failing test**

```ts
// web/src/parser/__tests__/parseLog.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseLog } from '../parseLog';

const FIXTURE = readFileSync(
  join(__dirname, 'fixtures', 'synthetic.log'),
  'utf-8'
);

describe('parseLog', () => {
  it('parses the synthetic log into one calibration and one guiding section', () => {
    const log = parseLog(FIXTURE);
    expect(log.phdVersion).toBe('2.6.11');
    expect(log.calibrations.length).toBe(1);
    expect(log.sessions.length).toBe(1);
    expect(log.sections.length).toBe(2);
    expect(log.sections[0]).toEqual({ type: 'CALIBRATION', idx: 0 });
    expect(log.sections[1]).toEqual({ type: 'GUIDING', idx: 0 });
  });

  it('parses calibration entries', () => {
    const log = parseLog(FIXTURE);
    const cal = log.calibrations[0];
    expect(cal.device).toBe('MOUNT');
    expect(cal.entries.length).toBe(5);
    expect(cal.entries[0].direction).toBe('WEST');
    expect(cal.entries[3].direction).toBe('NORTH');
  });

  it('parses guiding entries with correct direction-flipped durations', () => {
    const log = parseLog(FIXTURE);
    const s = log.sessions[0];
    expect(s.entries.length).toBe(5);
    expect(s.entries[0].radur).toBe(-100); // W
    expect(s.entries[0].decdur).toBe(50);  // N
    expect(s.entries[2].radur).toBe(-200); // W
    expect(s.entries[2].decdur).toBe(-100); // S
    expect(s.entries[4].radur).toBe(100);  // E
  });

  it('captures pixel scale, declination, mount header info', () => {
    const log = parseLog(FIXTURE);
    const s = log.sessions[0];
    expect(s.pixelScale).toBeCloseTo(1.5);
    expect(s.declination).toBeCloseTo(30 * Math.PI / 180);
    expect(s.mount.isValid).toBe(true);
    expect(s.mount.xRate).toBeCloseTo(5.0);
    expect(s.mount.xlim.minMo).toBeCloseTo(0.10);
    expect(s.mount.ylim.minMo).toBeCloseTo(0.20);
    expect(s.mount.xlim.maxDur).toBeCloseTo(2000);
  });

  it('captures INFO events with prefix stripped', () => {
    const log = parseLog(FIXTURE);
    const s = log.sessions[0];
    expect(s.infos.length).toBe(2);
    expect(s.infos[0].info).toBe('state=1');
    expect(s.infos[1].info).toBe('state=0');
  });

  it('records duration as last entry dt', () => {
    const log = parseLog(FIXTURE);
    expect(log.sessions[0].duration).toBe(5);
  });

  it('marks all entries as guiding=true since "guiding enabled" is in the mount header', () => {
    const log = parseLog(FIXTURE);
    expect(log.sessions[0].entries.every(e => e.guiding)).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd web && npm test -- parseLog`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `web/src/parser/parseLog.ts`**

```ts
import {
  GUIDING_BEGINS, GUIDING_HEADING, GUIDING_ENDS,
  CALIBRATION_BEGINS, CALIBRATION_HEADING, CALIBRATION_ENDS,
  VERSION_PREFIX, MOUNT_KEY, AO_KEY, PX_SCALE,
  XALGO, YALGO, MINMOVE, INFO_KEY,
  startsWith, isEmpty, rtrim, getDbl, starWasFound,
} from './tokens';
import { newGuideLog, newGuideSession, newCalibration } from './types';
import type {
  GuideLog, GuideSession, Calibration, Mount, Limits, GuideEntry,
} from './types';
import { parseEntry } from './parseEntry';
import { parseCalibration, isAoDirectionToken } from './parseCalibration';
import { addInfo } from './parseInfo';
import { fixupNonMonotonic } from './fixupMonotonic';

type State = 'SKIP' | 'GUIDING_HDR' | 'GUIDING' | 'CAL_HDR' | 'CALIBRATING';
type HdrState = 'GLOBAL' | 'AO' | 'MOUNT';

const parseMount = (ln: string, m: Mount): void => {
  m.isValid = true;
  m.xAngle = getDbl(ln, ', xAngle = ', 0.0);
  m.xRate = getDbl(ln, ', xRate = ', 1.0);
  m.yAngle = getDbl(ln, ', yAngle = ', Math.PI / 2);
  m.yRate = getDbl(ln, ', yRate = ', 1.0);
  if (m.xRate < 0.05) m.xRate *= 1000;
  if (m.yRate < 0.05) m.yRate *= 1000;
};

const getMinMo = (ln: string, lim: Limits): void => {
  lim.minMo = getDbl(ln, MINMOVE, 0);
};

const parseIsoCombined = (s: string): number | null => {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
};

export function parseLog(text: string): GuideLog {
  const log = newGuideLog();
  let st: State = 'SKIP';
  let hdrst: HdrState = 'GLOBAL';
  let axis: 'X' | 'Y' | '' = '';
  let s: GuideSession | null = null;
  let cal: Calibration | null = null;
  let mountEnabled = false;

  // Iterate lines preserving the original semantics: getline drops trailing \n.
  const lines = text.split(/\r?\n/);

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    let ln = rtrim(lines[lineIdx]);

    // Process this line. Use a labelled block so transitions can re-process.
    let redo = true;
    while (redo) {
      redo = false;

      if (st === 'SKIP') {
        if (startsWith(ln, GUIDING_BEGINS)) {
          st = 'GUIDING_HDR';
          hdrst = 'GLOBAL';
          axis = '';
          mountEnabled = false;
          const date = ln.slice(GUIDING_BEGINS.length);
          const session = newGuideSession(date);
          session.startsMs = parseIsoCombined(date);
          log.sessions.push(session);
          log.sections.push({ type: 'GUIDING', idx: log.sessions.length - 1 });
          s = log.sessions[log.sessions.length - 1];
          break;
        }
        if (startsWith(ln, CALIBRATION_BEGINS)) {
          st = 'CAL_HDR';
          const date = ln.slice(CALIBRATION_BEGINS.length);
          const c = newCalibration(date);
          c.startsMs = parseIsoCombined(date);
          log.calibrations.push(c);
          log.sections.push({ type: 'CALIBRATION', idx: log.calibrations.length - 1 });
          cal = log.calibrations[log.calibrations.length - 1];
          break;
        }
        if (startsWith(ln, VERSION_PREFIX)) {
          const start = VERSION_PREFIX.length;
          let end = ln.indexOf(', Log version ', start);
          if (end < 0) {
            const m = ln.slice(start).search(/[ \t\r\n]/);
            end = m < 0 ? ln.length : start + m;
          }
          log.phdVersion = ln.slice(start, end);
        }
        break;
      }

      if (st === 'GUIDING_HDR' && s) {
        if (startsWith(ln, GUIDING_HEADING)) {
          st = 'GUIDING';
          break;
        }
        if (startsWith(ln, MOUNT_KEY)) {
          parseMount(ln, s.mount);
          hdrst = 'MOUNT';
          mountEnabled = ln.includes(', guiding enabled, ');
        } else if (startsWith(ln, AO_KEY)) {
          parseMount(ln, s.ao);
          hdrst = 'AO';
        } else if (startsWith(ln, PX_SCALE)) {
          s.pixelScale = getDbl(ln, 'Pixel scale = ', 1);
        } else if (startsWith(ln, XALGO)) {
          getMinMo(ln, hdrst === 'MOUNT' ? s.mount.xlim : s.ao.xlim);
          axis = 'X';
        } else if (startsWith(ln, YALGO)) {
          getMinMo(ln, hdrst === 'MOUNT' ? s.mount.ylim : s.ao.ylim);
          axis = 'Y';
        } else if (startsWith(ln, MINMOVE)) {
          if (axis === 'X') getMinMo(ln, hdrst === 'MOUNT' ? s.mount.xlim : s.ao.xlim);
          else if (axis === 'Y') getMinMo(ln, hdrst === 'MOUNT' ? s.mount.ylim : s.ao.ylim);
        } else if (ln.includes('Max RA duration = ')) {
          const mnt = hdrst === 'MOUNT' ? s.mount : s.ao;
          mnt.xlim.maxDur = getDbl(ln, 'Max RA duration = ', 0);
          mnt.ylim.maxDur = getDbl(ln, 'Max DEC duration = ', 0);
        } else if (startsWith(ln, 'RA = ')) {
          const decDeg = getDbl(ln, ' hr, Dec = ', 0);
          s.declination = (decDeg * Math.PI) / 180;
        }
        s.hdr.push(ln);
        break;
      }

      if (st === 'GUIDING' && s) {
        if (isEmpty(ln) || startsWith(ln, GUIDING_ENDS)) {
          if (s.entries.length > 0) {
            s.duration = s.entries[s.entries.length - 1].dt;
          }
          s = null;
          st = 'SKIP';
          break;
        }
        const c0 = ln.charCodeAt(0);
        if (c0 >= 49 /* '1' */ && c0 <= 57 /* '9' */) {
          const e = parseEntry(ln);
          if (!e) break;
          if (!starWasFound(e.err)) {
            e.included = false;
            const synth = e.info || 'Frame dropped';
            addInfo(s.infos, s.entries.length, synth);
            if (!e.info) e.info = synth;
          } else {
            e.included = true;
          }
          e.guiding = mountEnabled;
          s.entries.push(e);
          break;
        }
        if (startsWith(ln, INFO_KEY)) {
          addInfo(s.infos, s.entries.length, ln.slice(INFO_KEY.length));
          const p = ln.indexOf('MountGuidingEnabled = ');
          if (p >= 0) {
            mountEnabled = ln.slice(p + 22, p + 26) === 'true';
          }
        }
        break;
      }

      if (st === 'CAL_HDR' && cal) {
        if (startsWith(ln, CALIBRATION_HEADING)) {
          st = 'CALIBRATING';
          break;
        }
        cal.hdr.push(ln);
        break;
      }

      if (st === 'CALIBRATING' && cal) {
        if (isEmpty(ln) || startsWith(ln, CALIBRATION_ENDS)) {
          cal = null;
          st = 'SKIP';
          break;
        }
        const tok = ln.split(',', 1)[0];
        if (['West','East','Backlash','North','South','Left','Up'].includes(tok)) {
          if (isAoDirectionToken(tok)) cal.device = 'AO';
          const e = parseCalibration(ln);
          if (e) cal.entries.push(e);
        } else {
          cal.hdr.push(ln);
        }
        break;
      }

      break;
    }
  }

  // Close out any session left open.
  if (s) {
    const session = s as GuideSession;
    if (session.entries.length > 0) {
      session.duration = session.entries[session.entries.length - 1].dt;
    }
  }

  for (const sec of log.sections) {
    if (sec.type === 'GUIDING') fixupNonMonotonic(log.sessions[sec.idx]);
  }

  return log;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd web && npm test -- parseLog`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```
git add web/src/parser/parseLog.ts web/src/parser/__tests__/parseLog.test.ts web/src/parser/__tests__/fixtures/synthetic.log
git commit -m "Add parseLog state machine with synthetic fixture"
```

---

### Task 9: Stats math

**Files:** Create `web/src/parser/stats.ts`, `web/src/parser/index.ts`, `web/src/parser/__tests__/stats.test.ts`

Background: ports `CalcStats` from `LogViewFrame.cpp`. RMS, mean, peak, drift (regression slope), error ellipse via PCA, polar alignment error.

- [ ] **Step 1: Write the failing test**

```ts
// web/src/parser/__tests__/stats.test.ts
import { describe, it, expect } from 'vitest';
import { calcStats } from '../stats';
import { newGuideSession } from '../types';
import type { GuideEntry } from '../types';

const mkE = (frame: number, dt: number, ra: number, dec: number, included = true): GuideEntry => ({
  frame, dt, mount: 'MOUNT', included, guiding: true,
  dx: ra, dy: dec, raraw: ra, decraw: dec, raguide: ra, decguide: dec,
  radur: 0, decdur: 0, mass: 0, snr: 0, err: 0, info: '',
});

describe('calcStats', () => {
  it('computes RMS, peak, mean for a small set', () => {
    const s = newGuideSession('x');
    s.entries = [mkE(1, 1, 1, 0), mkE(2, 2, -1, 0), mkE(3, 3, 1, 0), mkE(4, 4, -1, 0)];
    s.pixelScale = 2;
    const st = calcStats(s);
    expect(st.rmsRa).toBeCloseTo(1);
    expect(st.rmsDec).toBeCloseTo(0);
    expect(st.peakRa).toBeCloseTo(1);
    expect(st.meanRa).toBeCloseTo(0);
    expect(st.includedCount).toBe(4);
    expect(st.excludedCount).toBe(0);
    // arc-sec scale
    expect(st.rmsRaArcsec).toBeCloseTo(2);
  });

  it('computes drift from a linear ramp', () => {
    const s = newGuideSession('x');
    // dt in seconds; raraw rises by 1 per 60s => 1 px/min
    s.entries = [mkE(1, 0, 0, 0), mkE(2, 60, 1, 0), mkE(3, 120, 2, 0), mkE(4, 180, 3, 0)];
    const st = calcStats(s);
    expect(st.driftRa).toBeCloseTo(1, 3);
  });

  it('respects exclusion mask', () => {
    const s = newGuideSession('x');
    s.entries = [mkE(1, 1, 10, 0), mkE(2, 2, 1, 0), mkE(3, 3, -1, 0)];
    const mask = new Uint8Array([1, 0, 0]); // exclude first
    const st = calcStats(s, mask);
    expect(st.peakRa).toBeCloseTo(1);
    expect(st.includedCount).toBe(2);
    expect(st.excludedCount).toBe(1);
  });

  it('skips entries with included=false', () => {
    const s = newGuideSession('x');
    s.entries = [mkE(1, 1, 99, 0, false), mkE(2, 2, 1, 0), mkE(3, 3, -1, 0)];
    const st = calcStats(s);
    expect(st.peakRa).toBeCloseTo(1);
    expect(st.includedCount).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm test -- stats`
Expected: FAIL.

- [ ] **Step 3: Implement `web/src/parser/stats.ts`**

```ts
import type { GuideSession } from './types';

export type ExclusionMask = Uint8Array; // 1 = excluded

export interface SessionStats {
  rmsRa: number;
  rmsDec: number;
  rmsTotal: number;
  peakRa: number;
  peakDec: number;
  meanRa: number;
  meanDec: number;
  driftRa: number;     // px/min
  driftDec: number;    // px/min
  rmsRaArcsec: number;
  rmsDecArcsec: number;
  rmsTotalArcsec: number;
  driftRaArcsec: number;
  driftDecArcsec: number;
  paeArcMin: number;   // polar alignment error, arc-min
  ellipse: { theta: number; lx: number; ly: number; elongation: number };
  durationSec: number;
  includedCount: number;
  excludedCount: number;
}

const linregSlope = (xs: number[], ys: number[]): number => {
  if (xs.length < 2) return 0;
  let mx = 0, my = 0;
  for (let i = 0; i < xs.length; i++) { mx += xs[i]; my += ys[i]; }
  mx /= xs.length; my /= ys.length;
  let num = 0, den = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i] - mx;
    num += dx * (ys[i] - my);
    den += dx * dx;
  }
  return den === 0 ? 0 : num / den;
};

/**
 * 2D PCA of (ra, dec) — returns the angle of the major axis and the two
 * standard deviations along the principal axes.
 */
const pcaEllipse = (ras: number[], decs: number[]) => {
  const n = ras.length;
  if (n < 2) return { theta: 0, lx: 0, ly: 0, elongation: 1 };
  let mra = 0, mdec = 0;
  for (let i = 0; i < n; i++) { mra += ras[i]; mdec += decs[i]; }
  mra /= n; mdec /= n;
  let cxx = 0, cxy = 0, cyy = 0;
  for (let i = 0; i < n; i++) {
    const a = ras[i] - mra;
    const b = decs[i] - mdec;
    cxx += a * a; cxy += a * b; cyy += b * b;
  }
  cxx /= n; cxy /= n; cyy /= n;
  const tr = cxx + cyy;
  const det = cxx * cyy - cxy * cxy;
  const disc = Math.max(0, tr * tr / 4 - det);
  const l1 = tr / 2 + Math.sqrt(disc);
  const l2 = tr / 2 - Math.sqrt(disc);
  const theta = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
  const lx = Math.sqrt(Math.max(0, l1));
  const ly = Math.sqrt(Math.max(0, l2));
  const elongation = ly === 0 ? Infinity : lx / ly;
  return { theta, lx, ly, elongation };
};

/**
 * Compute per-session stats. Entries with `included === false` (dropped frames)
 * are always excluded; the optional `mask` further excludes entries by index
 * (1 = excluded).
 */
export function calcStats(s: GuideSession, mask?: ExclusionMask): SessionStats {
  const ras: number[] = [];
  const decs: number[] = [];
  const dts: number[] = [];
  let included = 0;
  let excluded = 0;

  for (let i = 0; i < s.entries.length; i++) {
    const e = s.entries[i];
    const masked = mask && mask[i] === 1;
    if (!e.included || masked) {
      excluded++;
      continue;
    }
    included++;
    ras.push(e.raraw);
    decs.push(e.decraw);
    dts.push(e.dt);
  }

  const sumSq = (a: number[]) => a.reduce((x, y) => x + y * y, 0);
  const rmsRa = ras.length ? Math.sqrt(sumSq(ras) / ras.length) : 0;
  const rmsDec = decs.length ? Math.sqrt(sumSq(decs) / decs.length) : 0;
  const rmsTotal = Math.sqrt(rmsRa * rmsRa + rmsDec * rmsDec);
  const peakRa = ras.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  const peakDec = decs.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  const meanRa = ras.length ? ras.reduce((a, b) => a + b, 0) / ras.length : 0;
  const meanDec = decs.length ? decs.reduce((a, b) => a + b, 0) / decs.length : 0;

  // Drift: slope of value-vs-time, scaled to per-minute.
  const driftRa = linregSlope(dts, ras) * 60;
  const driftDec = linregSlope(dts, decs) * 60;

  const ellipse = pcaEllipse(ras, decs);

  // PAE conversion: |drift_dec| (arc-sec/min) / cos(dec) * 3.81972
  // matches the desktop formula. Drift in px/min * pixelScale = arc-sec/min.
  const driftDecArcsecMin = Math.abs(driftDec) * s.pixelScale;
  const cosDec = Math.cos(s.declination) || 1;
  const paeArcMin = (driftDecArcsecMin * 3.81972) / cosDec;

  return {
    rmsRa, rmsDec, rmsTotal,
    peakRa, peakDec,
    meanRa, meanDec,
    driftRa, driftDec,
    rmsRaArcsec: rmsRa * s.pixelScale,
    rmsDecArcsec: rmsDec * s.pixelScale,
    rmsTotalArcsec: rmsTotal * s.pixelScale,
    driftRaArcsec: driftRa * s.pixelScale,
    driftDecArcsec: driftDec * s.pixelScale,
    paeArcMin,
    ellipse,
    durationSec: s.duration,
    includedCount: included,
    excludedCount: excluded,
  };
}
```

- [ ] **Step 4: Create `web/src/parser/index.ts`**

```ts
export * from './types';
export { parseLog } from './parseLog';
export { calcStats } from './stats';
export type { SessionStats, ExclusionMask } from './stats';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd web && npm test -- stats`
Expected: PASS.

- [ ] **Step 6: Commit**

```
git add web/src/parser/stats.ts web/src/parser/index.ts web/src/parser/__tests__/stats.test.ts
git commit -m "Add CalcStats port: RMS/peak/mean/drift/ellipse/PAE"
```

---

### Task 10: Golden snapshot harness

**Files:** Create `web/src/parser/__tests__/golden.test.ts`, `web/src/parser/__tests__/fixtures/synthetic.golden.json`, `web/samples/README.md`

Background: the synthetic fixture exists; this task just locks in a golden output so future changes can't silently regress parsing. Real PHD2 logs (when available) get added the same way.

- [ ] **Step 1: Create `web/samples/README.md`**

```markdown
# Sample PHD2 Logs

Drop real PHD2 guide log files here (`*.log` or `*.txt`) to use during dev and to extend `parser/__tests__/golden.test.ts` with golden snapshots.

A small synthetic log used by the parser tests lives at `src/parser/__tests__/fixtures/synthetic.log` and does not need to be replicated here.

To verify parity with the C++ desktop app on a real log:
1. Run the desktop app, open the log, copy the stats numbers.
2. Add the log to this directory.
3. Add an entry to `golden.test.ts` with the expected stats values.
```

- [ ] **Step 2: Create the golden snapshot file `web/src/parser/__tests__/fixtures/synthetic.golden.json`**

```json
{
  "phdVersion": "2.6.11",
  "sectionCount": 2,
  "sessions": [
    {
      "entryCount": 5,
      "infoCount": 2,
      "pixelScale": 1.5,
      "duration": 5,
      "mountValid": true,
      "guidingEnabled": true
    }
  ],
  "calibrations": [
    { "device": "MOUNT", "entryCount": 5 }
  ]
}
```

- [ ] **Step 3: Write the failing test**

```ts
// web/src/parser/__tests__/golden.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseLog } from '../parseLog';

const cases = [
  { logPath: 'fixtures/synthetic.log', goldenPath: 'fixtures/synthetic.golden.json' },
];

describe('golden snapshots', () => {
  for (const c of cases) {
    it(`matches snapshot for ${c.logPath}`, () => {
      const text = readFileSync(join(__dirname, c.logPath), 'utf-8');
      const golden = JSON.parse(readFileSync(join(__dirname, c.goldenPath), 'utf-8'));
      const log = parseLog(text);

      expect(log.phdVersion).toBe(golden.phdVersion);
      expect(log.sections.length).toBe(golden.sectionCount);
      expect(log.sessions.length).toBe(golden.sessions.length);
      expect(log.calibrations.length).toBe(golden.calibrations.length);

      log.sessions.forEach((s, i) => {
        const g = golden.sessions[i];
        expect(s.entries.length).toBe(g.entryCount);
        expect(s.infos.length).toBe(g.infoCount);
        expect(s.pixelScale).toBeCloseTo(g.pixelScale);
        expect(s.duration).toBeCloseTo(g.duration);
        expect(s.mount.isValid).toBe(g.mountValid);
        expect(s.entries.every(e => e.guiding === g.guidingEnabled)).toBe(true);
      });

      log.calibrations.forEach((cal, i) => {
        const g = golden.calibrations[i];
        expect(cal.device).toBe(g.device);
        expect(cal.entries.length).toBe(g.entryCount);
      });
    });
  }
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npm test -- golden`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add web/src/parser/__tests__/golden.test.ts web/src/parser/__tests__/fixtures/synthetic.golden.json web/samples/README.md
git commit -m "Add golden-snapshot harness for parser"
```

---

### Task 11: Recents storage (IndexedDB)

**Files:** Create `web/src/storage/recents.ts`, `web/src/storage/__tests__/recents.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// web/src/storage/__tests__/recents.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { listRecents, putRecent, getRecent, deleteRecent } from '../recents';

beforeEach(async () => {
  for (const r of await listRecents()) await deleteRecent(r.id);
});

describe('recents', () => {
  it('round-trips a recent record', async () => {
    const id = await putRecent({ name: 'foo.log', size: 100, text: 'hello' });
    const r = await getRecent(id);
    expect(r?.name).toBe('foo.log');
    expect(r?.text).toBe('hello');
  });

  it('lists recents most-recent first', async () => {
    const a = await putRecent({ name: 'a', size: 1, text: 'a' });
    await new Promise(r => setTimeout(r, 5));
    const b = await putRecent({ name: 'b', size: 1, text: 'b' });
    const ls = await listRecents();
    expect(ls[0].id).toBe(b);
    expect(ls[1].id).toBe(a);
  });

  it('LRU-evicts beyond max', async () => {
    for (let i = 0; i < 12; i++) {
      await putRecent({ name: `f${i}`, size: 1, text: 'x' });
      await new Promise(r => setTimeout(r, 2));
    }
    const ls = await listRecents();
    expect(ls.length).toBe(10);
    expect(ls[0].name).toBe('f11');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm test -- recents`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `web/src/storage/recents.ts`**

```ts
import { get, set, del, keys } from 'idb-keyval';

const MAX = 10;
const PREFIX = 'recent:';
const INDEX_KEY = 'recents:index';

export interface RecentMeta {
  id: string;
  name: string;
  size: number;
  openedAt: number;
}

export interface RecentRecord extends RecentMeta {
  text: string;
}

interface Index {
  ids: string[]; // most-recent first
}

const loadIndex = async (): Promise<Index> => (await get<Index>(INDEX_KEY)) ?? { ids: [] };
const saveIndex = (i: Index) => set(INDEX_KEY, i);

export async function putRecent(p: { name: string; size: number; text: string }): Promise<string> {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const rec: RecentRecord = { id, name: p.name, size: p.size, text: p.text, openedAt: Date.now() };
  await set(PREFIX + id, rec);
  const idx = await loadIndex();
  idx.ids = [id, ...idx.ids.filter(x => x !== id)];
  while (idx.ids.length > MAX) {
    const evict = idx.ids.pop()!;
    await del(PREFIX + evict);
  }
  await saveIndex(idx);
  return id;
}

export async function getRecent(id: string): Promise<RecentRecord | undefined> {
  return get<RecentRecord>(PREFIX + id);
}

export async function listRecents(): Promise<RecentMeta[]> {
  const idx = await loadIndex();
  const out: RecentMeta[] = [];
  for (const id of idx.ids) {
    const r = await get<RecentRecord>(PREFIX + id);
    if (r) out.push({ id: r.id, name: r.name, size: r.size, openedAt: r.openedAt });
  }
  return out;
}

export async function deleteRecent(id: string): Promise<void> {
  await del(PREFIX + id);
  const idx = await loadIndex();
  idx.ids = idx.ids.filter(x => x !== id);
  await saveIndex(idx);
}

// for tests / cleanup
export async function _allKeys(): Promise<string[]> {
  return (await keys()).map(String);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npm test -- recents`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add web/src/storage/recents.ts web/src/storage/__tests__/recents.test.ts
git commit -m "Add IndexedDB recents store with LRU eviction"
```

---

### Task 12: `logStore`

**Files:** Create `web/src/state/logStore.ts`

- [ ] **Step 1: Implement `web/src/state/logStore.ts`**

```ts
import { create } from 'zustand';
import type { GuideLog } from '../parser';
import { parseLog } from '../parser';
import { putRecent } from '../storage/recents';

export interface LogMeta {
  name: string;
  size: number;
  recentId: string | null;
}

interface LogState {
  log: GuideLog | null;
  meta: LogMeta | null;
  selectedSection: number; // index into log.sections
  loading: boolean;
  error: string | null;
  loadFromText: (text: string, name: string, opts?: { persist?: boolean }) => Promise<void>;
  selectSection: (i: number) => void;
  clear: () => void;
}

export const useLogStore = create<LogState>((set) => ({
  log: null,
  meta: null,
  selectedSection: 0,
  loading: false,
  error: null,
  loadFromText: async (text, name, opts) => {
    set({ loading: true, error: null });
    try {
      const log = parseLog(text);
      let recentId: string | null = null;
      if (opts?.persist !== false) {
        recentId = await putRecent({ name, size: text.length, text });
      }
      set({
        log,
        meta: { name, size: text.length, recentId },
        selectedSection: log.sections.length > 0 ? 0 : -1,
        loading: false,
      });
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },
  selectSection: (i) => set({ selectedSection: i }),
  clear: () => set({ log: null, meta: null, selectedSection: 0, error: null }),
}));
```

- [ ] **Step 2: Typecheck**

Run: `cd web && npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```
git add web/src/state/logStore.ts
git commit -m "Add logStore (zustand): load, select, persist"
```

---

### Task 13: `viewStore`

**Files:** Create `web/src/state/viewStore.ts`

- [ ] **Step 1: Implement `web/src/state/viewStore.ts`**

```ts
import { create } from 'zustand';

export type CoordMode = 'RA_DEC' | 'DX_DY';
export type Device = 'MOUNT' | 'AO';
export type VerticalMode = 'PAN' | 'ZOOM';

export interface TraceVisibility {
  ra: boolean;
  dec: boolean;
  raPulses: boolean;
  decPulses: boolean;
  mass: boolean;
  snr: boolean;
}

interface ViewState {
  coordMode: CoordMode;
  device: Device;
  verticalMode: VerticalMode;
  scaleLocked: boolean;
  lockedYRange: [number, number] | null;
  traces: TraceVisibility;
  /**
   * Per-section exclusion masks. Keyed by sessionIndex (the GuideLog.sessions
   * index, not the sections-list index). Value: Uint8Array length === entries.length.
   */
  exclusions: Map<number, Uint8Array>;

  setCoordMode: (m: CoordMode) => void;
  setDevice: (d: Device) => void;
  setVerticalMode: (v: VerticalMode) => void;
  setScaleLocked: (b: boolean, range?: [number, number]) => void;
  toggleTrace: (k: keyof TraceVisibility) => void;

  ensureMask: (sessionIdx: number, entryCount: number) => Uint8Array;
  setMask: (sessionIdx: number, mask: Uint8Array) => void;
  includeAll: (sessionIdx: number, entryCount: number) => void;
  excludeAll: (sessionIdx: number, entryCount: number) => void;
  excludeRange: (sessionIdx: number, entryCount: number, fromFrame: number, toFrame: number, frames: number[]) => void;
}

export const useViewStore = create<ViewState>((set, get) => ({
  coordMode: 'RA_DEC',
  device: 'MOUNT',
  verticalMode: 'PAN',
  scaleLocked: false,
  lockedYRange: null,
  traces: { ra: true, dec: true, raPulses: false, decPulses: false, mass: false, snr: false },
  exclusions: new Map(),

  setCoordMode: (m) => set({ coordMode: m }),
  setDevice: (d) => set({ device: d }),
  setVerticalMode: (v) => set({ verticalMode: v }),
  setScaleLocked: (b, range) => set({ scaleLocked: b, lockedYRange: b && range ? range : null }),
  toggleTrace: (k) => set((s) => ({ traces: { ...s.traces, [k]: !s.traces[k] } })),

  ensureMask: (sessionIdx, entryCount) => {
    const m = get().exclusions.get(sessionIdx);
    if (m && m.length === entryCount) return m;
    const fresh = new Uint8Array(entryCount);
    const next = new Map(get().exclusions);
    next.set(sessionIdx, fresh);
    set({ exclusions: next });
    return fresh;
  },

  setMask: (sessionIdx, mask) => {
    const next = new Map(get().exclusions);
    next.set(sessionIdx, mask);
    set({ exclusions: next });
  },

  includeAll: (sessionIdx, entryCount) => {
    const fresh = new Uint8Array(entryCount);
    const next = new Map(get().exclusions);
    next.set(sessionIdx, fresh);
    set({ exclusions: next });
  },

  excludeAll: (sessionIdx, entryCount) => {
    const m = new Uint8Array(entryCount);
    m.fill(1);
    const next = new Map(get().exclusions);
    next.set(sessionIdx, m);
    set({ exclusions: next });
  },

  excludeRange: (sessionIdx, entryCount, fromFrame, toFrame, frames) => {
    const cur = get().exclusions.get(sessionIdx) ?? new Uint8Array(entryCount);
    const m = new Uint8Array(cur);
    const lo = Math.min(fromFrame, toFrame);
    const hi = Math.max(fromFrame, toFrame);
    for (let i = 0; i < frames.length; i++) {
      if (frames[i] >= lo && frames[i] <= hi) m[i] = 1;
    }
    const next = new Map(get().exclusions);
    next.set(sessionIdx, m);
    set({ exclusions: next });
  },
}));
```

- [ ] **Step 2: Typecheck**

Run: `cd web && npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```
git add web/src/state/viewStore.ts
git commit -m "Add viewStore (zustand): toggles, exclusion masks"
```

---

### Task 14: `DropZone` component

**Files:** Create `web/src/components/DropZone.tsx`

- [ ] **Step 1: Implement `web/src/components/DropZone.tsx`**

```tsx
import { useCallback, useRef, useState } from 'react';
import { useLogStore } from '../state/logStore';

export function DropZone() {
  const loadFromText = useLogStore((s) => s.loadFromText);
  const loading = useLogStore((s) => s.loading);
  const error = useLogStore((s) => s.error);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFile = useCallback(async (file: File) => {
    const text = await file.text();
    await loadFromText(text, file.name);
  }, [loadFromText]);

  return (
    <div
      className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors ${
        dragOver ? 'border-sky-400 bg-sky-950/30' : 'border-slate-600'
      }`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) void handleFile(f);
      }}
    >
      <p className="mb-3 text-slate-300">Drop a PHD2 guide log here</p>
      <button
        className="rounded bg-sky-600 px-3 py-1 text-sm hover:bg-sky-500"
        onClick={() => inputRef.current?.click()}
      >
        or pick a file
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".log,.txt,text/plain"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
          e.target.value = '';
        }}
      />
      {loading && <p className="mt-3 text-sm text-slate-400">Parsing…</p>}
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd web && npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```
git add web/src/components/DropZone.tsx
git commit -m "Add DropZone component"
```

---

### Task 15: `SectionList` component

**Files:** Create `web/src/components/SectionList.tsx`

- [ ] **Step 1: Implement `web/src/components/SectionList.tsx`**

```tsx
import { useLogStore } from '../state/logStore';

export function SectionList() {
  const log = useLogStore((s) => s.log);
  const selected = useLogStore((s) => s.selectedSection);
  const select = useLogStore((s) => s.selectSection);

  if (!log || log.sections.length === 0) {
    return <p className="p-3 text-sm text-slate-400">No sections.</p>;
  }

  return (
    <ul className="overflow-y-auto">
      {log.sections.map((sec, i) => {
        const isCal = sec.type === 'CALIBRATION';
        const item = isCal ? log.calibrations[sec.idx] : log.sessions[sec.idx];
        const label = isCal ? `Cal: ${item.date}` : `Guide: ${item.date}`;
        const sub = isCal
          ? `${(item as typeof log.calibrations[number]).entries.length} steps`
          : `${(item as typeof log.sessions[number]).entries.length} frames, ${Math.round((item as typeof log.sessions[number]).duration)}s`;
        return (
          <li key={i}>
            <button
              className={`block w-full px-3 py-2 text-left text-sm hover:bg-slate-800 ${
                selected === i ? 'bg-slate-800 text-sky-300' : 'text-slate-200'
              }`}
              onClick={() => select(i)}
            >
              <div className="font-medium">{label}</div>
              <div className="text-xs text-slate-400">{sub}</div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd web && npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```
git add web/src/components/SectionList.tsx
git commit -m "Add SectionList component"
```

---

### Task 16: `StatsGrid` component

**Files:** Create `web/src/components/StatsGrid.tsx`

- [ ] **Step 1: Implement `web/src/components/StatsGrid.tsx`**

```tsx
import { useMemo } from 'react';
import { useLogStore } from '../state/logStore';
import { useViewStore } from '../state/viewStore';
import { calcStats } from '../parser';

const fmt = (n: number, d = 3) => Number.isFinite(n) ? n.toFixed(d) : '—';

export function StatsGrid() {
  const log = useLogStore((s) => s.log);
  const sectionIdx = useLogStore((s) => s.selectedSection);
  const exclusions = useViewStore((s) => s.exclusions);

  const stats = useMemo(() => {
    if (!log || sectionIdx < 0) return null;
    const sec = log.sections[sectionIdx];
    if (!sec || sec.type !== 'GUIDING') return null;
    const session = log.sessions[sec.idx];
    const mask = exclusions.get(sec.idx);
    return { stats: calcStats(session, mask), pixelScale: session.pixelScale };
  }, [log, sectionIdx, exclusions]);

  if (!stats) return null;
  const s = stats.stats;

  const rows: [string, string][] = [
    ['RMS Total', `${fmt(s.rmsTotal)} px / ${fmt(s.rmsTotalArcsec)}″`],
    ['RMS RA', `${fmt(s.rmsRa)} px / ${fmt(s.rmsRaArcsec)}″`],
    ['RMS Dec', `${fmt(s.rmsDec)} px / ${fmt(s.rmsDecArcsec)}″`],
    ['Peak RA', fmt(s.peakRa)],
    ['Peak Dec', fmt(s.peakDec)],
    ['Drift RA', `${fmt(s.driftRa)} px/min`],
    ['Drift Dec', `${fmt(s.driftDec)} px/min`],
    ['PAE', `${fmt(s.paeArcMin, 2)}′`],
    ['Included', String(s.includedCount)],
    ['Excluded', String(s.excludedCount)],
    ['Duration', `${Math.round(s.durationSec)} s`],
  ];

  const copy = (val: string) => navigator.clipboard?.writeText(val);

  return (
    <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 p-3 text-sm">
      {rows.map(([k, v]) => (
        <button
          key={k}
          className="contents text-left hover:opacity-80"
          onClick={() => copy(v)}
          title="Click to copy"
        >
          <span className="text-slate-400">{k}</span>
          <span className="font-mono text-slate-100">{v}</span>
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd web && npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```
git add web/src/components/StatsGrid.tsx
git commit -m "Add StatsGrid component"
```

---

### Task 17: `GuideGraph` component

**Files:** Create `web/src/components/GuideGraph.tsx`

- [ ] **Step 1: Implement `web/src/components/GuideGraph.tsx`**

```tsx
import { useMemo } from 'react';
import Plot from 'react-plotly.js';
import type { Data, Layout, Shape } from 'plotly.js';
import { useLogStore } from '../state/logStore';
import { useViewStore } from '../state/viewStore';
import type { GuideSession } from '../parser';

function buildTraces(s: GuideSession, mask: Uint8Array | undefined): Data[] {
  const t = s.entries.map((e) => e.dt);
  const ra = s.entries.map((e, i) => (mask?.[i] ? null : e.raraw));
  const dec = s.entries.map((e, i) => (mask?.[i] ? null : e.decraw));
  return [
    {
      x: t, y: ra, type: 'scattergl', mode: 'lines',
      name: 'RA', line: { color: '#60a5fa', width: 1 },
    } as Data,
    {
      x: t, y: dec, type: 'scattergl', mode: 'lines',
      name: 'Dec', line: { color: '#f87171', width: 1 },
    } as Data,
  ];
}

function buildShapes(s: GuideSession, mask: Uint8Array | undefined): Partial<Shape>[] {
  const shapes: Partial<Shape>[] = [];

  // info markers — vertical lines
  for (const info of s.infos) {
    const t = s.entries[info.idx]?.dt;
    if (t === undefined) continue;
    shapes.push({
      type: 'line', xref: 'x', yref: 'paper',
      x0: t, x1: t, y0: 0, y1: 1,
      line: { color: 'rgba(250, 204, 21, 0.4)', width: 1, dash: 'dot' },
    });
  }

  // exclusion overlay rectangles — coalesce contiguous excluded ranges
  if (mask) {
    let runStart = -1;
    for (let i = 0; i <= s.entries.length; i++) {
      const ex = i < s.entries.length && mask[i] === 1;
      if (ex && runStart < 0) runStart = i;
      else if (!ex && runStart >= 0) {
        shapes.push({
          type: 'rect', xref: 'x', yref: 'paper',
          x0: s.entries[runStart].dt, x1: s.entries[i - 1].dt,
          y0: 0, y1: 1,
          fillcolor: 'rgba(148, 163, 184, 0.18)',
          line: { width: 0 },
        });
        runStart = -1;
      }
    }
  }

  return shapes;
}

export function GuideGraph() {
  const log = useLogStore((s) => s.log);
  const sectionIdx = useLogStore((s) => s.selectedSection);
  const exclusions = useViewStore((s) => s.exclusions);
  const verticalMode = useViewStore((s) => s.verticalMode);

  const data = useMemo(() => {
    if (!log || sectionIdx < 0) return null;
    const sec = log.sections[sectionIdx];
    if (!sec || sec.type !== 'GUIDING') return null;
    const session = log.sessions[sec.idx];
    const mask = exclusions.get(sec.idx);
    return {
      traces: buildTraces(session, mask),
      shapes: buildShapes(session, mask),
      pixelScale: session.pixelScale,
    };
  }, [log, sectionIdx, exclusions]);

  if (!data) {
    return <div className="flex h-full items-center justify-center text-slate-500">Select a guiding section.</div>;
  }

  const layout: Partial<Layout> = {
    autosize: true,
    margin: { l: 50, r: 60, t: 20, b: 40 },
    paper_bgcolor: '#0f172a',
    plot_bgcolor: '#0f172a',
    font: { color: '#cbd5e1', size: 11 },
    xaxis: { title: { text: 'time (s)' }, gridcolor: '#1e293b', zerolinecolor: '#334155' },
    yaxis: {
      title: { text: 'pixels' }, gridcolor: '#1e293b', zerolinecolor: '#334155',
      fixedrange: verticalMode === 'PAN',
    },
    yaxis2: {
      title: { text: 'arc-sec' }, overlaying: 'y', side: 'right',
      showgrid: false,
    },
    shapes: data.shapes,
    showlegend: true,
    legend: { orientation: 'h', y: 1.1 },
    dragmode: 'pan',
  };

  return (
    <Plot
      data={data.traces}
      layout={layout}
      config={{ displaylogo: false, responsive: true, scrollZoom: true }}
      style={{ width: '100%', height: '100%' }}
      useResizeHandler
    />
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd web && npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```
git add web/src/components/GuideGraph.tsx
git commit -m "Add GuideGraph (Plotly) with info markers and exclusion overlays"
```

---

### Task 18: Wire up keyboard shortcuts

**Files:** Modify `web/src/components/GuideGraph.tsx` (small edit) — and create a hook `web/src/state/useKeyboard.ts`

- [ ] **Step 1: Create `web/src/state/useKeyboard.ts`**

```ts
import { useEffect } from 'react';
import { useLogStore } from './logStore';
import { useViewStore } from './viewStore';

export function useKeyboardShortcuts() {
  const log = useLogStore((s) => s.log);
  const selected = useLogStore((s) => s.selectedSection);
  const select = useLogStore((s) => s.selectSection);
  const setVerticalMode = useViewStore((s) => s.setVerticalMode);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (!log) return;

      if (e.key === 'p' || e.key === 'P') setVerticalMode('PAN');
      else if (e.key === 'z' || e.key === 'Z') setVerticalMode('ZOOM');
      else if (e.key === '[' && selected > 0) select(selected - 1);
      else if (e.key === ']' && selected < log.sections.length - 1) select(selected + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [log, selected, select, setVerticalMode]);
}
```

- [ ] **Step 2: Typecheck**

Run: `cd web && npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```
git add web/src/state/useKeyboard.ts
git commit -m "Add keyboard shortcuts hook"
```

---

### Task 19: Right-click context menu (Include/Exclude all + Settling)

**Files:** Create `web/src/components/ContextMenu.tsx`

- [ ] **Step 1: Implement `web/src/components/ContextMenu.tsx`**

```tsx
import * as RCM from '@radix-ui/react-context-menu';
import { ReactNode } from 'react';
import { useLogStore } from '../state/logStore';
import { useViewStore } from '../state/viewStore';
import type { GuideSession } from '../parser';

const computeSettlingMask = (s: GuideSession): Uint8Array => {
  const m = new Uint8Array(s.entries.length);
  let inSettle = false;
  let startEntryIdx = 0;
  for (const info of s.infos) {
    if (info.info === 'state=1' && !inSettle) {
      inSettle = true;
      startEntryIdx = info.idx;
    } else if (info.info === 'state=0' && inSettle) {
      for (let i = startEntryIdx; i < info.idx && i < s.entries.length; i++) m[i] = 1;
      inSettle = false;
    }
  }
  if (inSettle) {
    for (let i = startEntryIdx; i < s.entries.length; i++) m[i] = 1;
  }
  return m;
};

export function GraphContextMenu({ children }: { children: ReactNode }) {
  const log = useLogStore((s) => s.log);
  const sectionIdx = useLogStore((s) => s.selectedSection);
  const includeAll = useViewStore((s) => s.includeAll);
  const excludeAll = useViewStore((s) => s.excludeAll);
  const setMask = useViewStore((s) => s.setMask);

  const sec = log && sectionIdx >= 0 ? log.sections[sectionIdx] : null;
  const session = sec && sec.type === 'GUIDING' ? log!.sessions[sec.idx] : null;
  const sessionIdx = sec && sec.type === 'GUIDING' ? sec.idx : -1;
  const isUnguided = !!session && session.entries.length > 0 && !session.entries[0].guiding;

  return (
    <RCM.Root>
      <RCM.Trigger asChild>{children}</RCM.Trigger>
      <RCM.Portal>
        <RCM.Content className="min-w-[14rem] rounded border border-slate-700 bg-slate-900 p-1 text-sm shadow-lg">
          <Item
            disabled={!session}
            onSelect={() => session && includeAll(sessionIdx, session.entries.length)}
          >
            Include all frames
          </Item>
          <Item
            disabled={!session}
            onSelect={() => session && excludeAll(sessionIdx, session.entries.length)}
          >
            Exclude all frames
          </Item>
          <Item
            disabled={!session}
            onSelect={() => session && setMask(sessionIdx, computeSettlingMask(session))}
          >
            Exclude frames settling
          </Item>
          <RCM.Separator className="my-1 h-px bg-slate-700" />
          <Item disabled hint="Coming in v3">Analyze selected frames</Item>
          <Item disabled hint="Coming in v3">Analyze selected, raw RA</Item>
          {isUnguided && <Item disabled hint="Coming in v3">Analyze unguided section</Item>}
        </RCM.Content>
      </RCM.Portal>
    </RCM.Root>
  );
}

function Item({ children, onSelect, disabled, hint }: {
  children: ReactNode; onSelect?: () => void; disabled?: boolean; hint?: string;
}) {
  return (
    <RCM.Item
      disabled={disabled}
      onSelect={onSelect}
      className={`flex cursor-pointer items-center justify-between rounded px-2 py-1 outline-none ${
        disabled ? 'text-slate-500' : 'text-slate-100 data-[highlighted]:bg-slate-800'
      }`}
    >
      <span>{children}</span>
      {hint && <span className="ml-3 text-xs text-slate-500">{hint}</span>}
    </RCM.Item>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd web && npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```
git add web/src/components/ContextMenu.tsx
git commit -m "Add right-click context menu (include/exclude all, exclude settling)"
```

---

### Task 20: `RecentsPanel` component

**Files:** Create `web/src/components/RecentsPanel.tsx`

- [ ] **Step 1: Implement `web/src/components/RecentsPanel.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { listRecents, getRecent, deleteRecent } from '../storage/recents';
import type { RecentMeta } from '../storage/recents';
import { useLogStore } from '../state/logStore';

export function RecentsPanel() {
  const [items, setItems] = useState<RecentMeta[]>([]);
  const loadFromText = useLogStore((s) => s.loadFromText);

  const refresh = async () => setItems(await listRecents());

  useEffect(() => { void refresh(); }, []);

  if (items.length === 0) return null;

  return (
    <div className="border-t border-slate-800 p-3">
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Recent</h3>
      <ul className="space-y-1">
        {items.map((r) => (
          <li key={r.id} className="flex items-center justify-between text-sm">
            <button
              className="flex-1 truncate text-left text-slate-200 hover:text-sky-300"
              onClick={async () => {
                const rec = await getRecent(r.id);
                if (rec) await loadFromText(rec.text, rec.name, { persist: false });
              }}
            >
              {r.name}
            </button>
            <button
              className="ml-2 text-slate-500 hover:text-red-400"
              onClick={async () => { await deleteRecent(r.id); await refresh(); }}
              title="Remove"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd web && npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```
git add web/src/components/RecentsPanel.tsx
git commit -m "Add RecentsPanel component"
```

---

### Task 21: `ViewerPage` shell

**Files:** Create `web/src/pages/ViewerPage.tsx`

- [ ] **Step 1: Implement `web/src/pages/ViewerPage.tsx`**

```tsx
import { DropZone } from '../components/DropZone';
import { SectionList } from '../components/SectionList';
import { StatsGrid } from '../components/StatsGrid';
import { GuideGraph } from '../components/GuideGraph';
import { GraphContextMenu } from '../components/ContextMenu';
import { RecentsPanel } from '../components/RecentsPanel';
import { useLogStore } from '../state/logStore';
import { useKeyboardShortcuts } from '../state/useKeyboard';

export function ViewerPage() {
  useKeyboardShortcuts();
  const log = useLogStore((s) => s.log);

  if (!log) {
    return (
      <div className="mx-auto flex h-full max-w-2xl flex-col justify-center gap-4 p-6">
        <h1 className="text-2xl font-semibold">PHD2 Log Viewer</h1>
        <DropZone />
        <RecentsPanel />
      </div>
    );
  }

  return (
    <div className="grid h-full grid-cols-[260px_1fr_320px] grid-rows-[auto_1fr]">
      <header className="col-span-3 flex items-center justify-between border-b border-slate-800 px-4 py-2">
        <h1 className="text-sm font-medium">
          PHD2 Log Viewer — <span className="text-slate-400">{useLogStore.getState().meta?.name}</span>
        </h1>
        <button
          className="text-xs text-slate-400 hover:text-slate-200"
          onClick={() => useLogStore.getState().clear()}
        >
          Open another
        </button>
      </header>
      <aside className="overflow-y-auto border-r border-slate-800">
        <SectionList />
        <RecentsPanel />
      </aside>
      <main className="relative">
        <GraphContextMenu>
          <div className="h-full">
            <GuideGraph />
          </div>
        </GraphContextMenu>
      </main>
      <aside className="overflow-y-auto border-l border-slate-800">
        <StatsGrid />
      </aside>
    </div>
  );
}
```

- [ ] **Step 2: Update `web/src/main.tsx` to render `ViewerPage`**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { ViewerPage } from './pages/ViewerPage';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ViewerPage />
  </StrictMode>
);
```

- [ ] **Step 3: Typecheck and run dev**

Run: `cd web && npm run typecheck && npm run build`
Expected: PASS, build succeeds.

- [ ] **Step 4: Commit**

```
git add web/src/pages/ViewerPage.tsx web/src/main.tsx
git commit -m "Wire up ViewerPage shell"
```

---

### Task 22: All-tests sanity check

- [ ] **Step 1: Run the full test suite**

Run: `cd web && npm test`
Expected: all parser, stats, recents tests pass.

- [ ] **Step 2: Run typecheck**

Run: `cd web && npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Run build**

Run: `cd web && npm run build`
Expected: build artefacts in `web/dist/` produced without errors.

- [ ] **Step 4: Manual sanity check (auto mode: skip if no real PHD2 log available; document in commit)**

Run: `cd web && npm run dev`
Expected: dev server starts; opening the URL shows the dropzone; dropping `web/src/parser/__tests__/fixtures/synthetic.log` populates the section list and renders a chart with two traces.

- [ ] **Step 5: Commit any small fixes from the manual check**

```
git add -A
git commit -m "v1 sanity-check fixes" --allow-empty
```

---

### Task 23: Playwright smoke test

**Files:** Create `web/playwright.config.ts`, `web/e2e/smoke.spec.ts`

- [ ] **Step 1: Create `web/playwright.config.ts`**

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  use: { baseURL: 'http://localhost:5173' },
});
```

- [ ] **Step 2: Write `web/e2e/smoke.spec.ts`**

```ts
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FIXTURE = join(__dirname, '..', 'src', 'parser', '__tests__', 'fixtures', 'synthetic.log');

test('drop-and-view smoke', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Drop a PHD2 guide log here')).toBeVisible();

  // upload via the hidden file input
  const text = readFileSync(FIXTURE, 'utf-8');
  await page.setInputFiles('input[type=file]', {
    name: 'synthetic.log',
    mimeType: 'text/plain',
    buffer: Buffer.from(text, 'utf-8'),
  });

  await expect(page.getByText('Guide:', { exact: false })).toBeVisible();
  await page.getByText('Guide:', { exact: false }).first().click();
  await expect(page.locator('.js-plotly-plot')).toBeVisible();
  await expect(page.getByText('RMS Total')).toBeVisible();
});
```

- [ ] **Step 3: Install browsers and run**

Run: `cd web && npx playwright install chromium && npm run e2e`
Expected: 1 test passes.

- [ ] **Step 4: Commit**

```
git add web/playwright.config.ts web/e2e/smoke.spec.ts
git commit -m "Add Playwright smoke test"
```

---

## Done definition (matches spec §12)

- All Vitest tests pass.
- Playwright smoke test passes.
- `npm run build` succeeds.
- Dropping the synthetic log shows the section list, renders a chart, and fills the stats grid.
- Recents persist across reload (manual verification).
