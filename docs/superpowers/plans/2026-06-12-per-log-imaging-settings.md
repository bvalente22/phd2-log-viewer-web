# Per-log imaging settings + remember checkbox + interpretation tooltips — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Image Impact panel remember imaging scale + seeing per guide log (durable by content hash) with a global "Remember settings" override, accept decimal entry without a leading 0, link the imaging-scale label to a calculator, and show the prototype's interpretation phrases as ellipse tooltips.

**Architecture:** Per-log values live in a new idb-keyval store keyed by content hash (mirrors the Primary-period feature, loaded from `logStore`). Global values + the remember flag stay in `viewStore` (localStorage). The compute module gains `guidingOnlyEccentricity` plus two pure helpers (`elongationRating`, `samplingRelation`). The `ImageImpact` component resolves effective values, routes edits, and builds the tooltip strings.

**Tech Stack:** TypeScript, React, Zustand (+persist), idb-keyval, react-i18next, Tailwind, vitest. Commands from `web/`.

**Spec:** `docs/superpowers/specs/2026-06-12-per-log-imaging-settings-design.md`

---

## File Structure

- `web/src/storage/imagingSettings.ts` — NEW: idb-keyval per-log record (`imaging:` prefix).
- `web/src/state/imagingSettingsStore.ts` — NEW: `{hash, record}` + `loadForLog`/`setForLog`/`clear`.
- `web/src/state/__tests__/imagingSettingsStore.test.ts` — NEW.
- `web/src/state/logStore.ts` — load/clear the per-log store with the others.
- `web/src/state/viewStore.ts` — add `rememberImaging` + setter + persist.
- `web/src/parser/imageImpact.ts` — add `guidingOnlyEccentricity`, `elongationRating`, `samplingRelation`.
- `web/src/parser/__tests__/imageImpact.test.ts` — extend.
- `web/src/i18n/locales/{en,es,de,fr,it,zh}/stats.json` — rename + new `imageImpact` keys.
- `web/src/components/ImageImpact.tsx` — decimal inputs, effective-value wiring, checkbox, link, tooltips.

---

## Task 1: Per-log storage + store

**Files:**
- Create: `web/src/storage/imagingSettings.ts`
- Create: `web/src/state/imagingSettingsStore.ts`
- Test: `web/src/state/__tests__/imagingSettingsStore.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/src/state/__tests__/imagingSettingsStore.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useImagingSettingsStore } from '../imagingSettingsStore';
import { getImagingSettings, deleteImagingSettings, _allImagingSettingsKeys } from '../../storage/imagingSettings';

beforeEach(async () => {
  for (const k of await _allImagingSettingsKeys()) await deleteImagingSettings(k.slice('imaging:'.length));
  useImagingSettingsStore.setState({ hash: null, record: null });
});

const S = () => useImagingSettingsStore.getState();

describe('imagingSettingsStore', () => {
  it('loadForLog with no stored value sets record null', async () => {
    await S().loadForLog('h1');
    expect(S().hash).toBe('h1');
    expect(S().record).toBeNull();
  });

  it('setForLog persists both fields and updates record; survives a reload', async () => {
    await S().loadForLog('h1');
    await S().setForLog('h1', 0.8, 2.5);
    expect(S().record).toMatchObject({ imagingScale: 0.8, seeingFwhm: 2.5 });
    expect(await getImagingSettings('h1')).toMatchObject({ imagingScale: 0.8, seeingFwhm: 2.5 });
    S().clear();
    await S().loadForLog('h1');
    expect(S().record).toMatchObject({ imagingScale: 0.8, seeingFwhm: 2.5 });
  });

  it('switching logs restores/clears the record (no bleed across logs)', async () => {
    await S().loadForLog('h1');
    await S().setForLog('h1', 0.8, 2.5);
    await S().loadForLog('h2');
    expect(S().hash).toBe('h2');
    expect(S().record).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/state/__tests__/imagingSettingsStore.test.ts`
Expected: FAIL — cannot find module `../imagingSettingsStore`.

- [ ] **Step 3: Create the storage module**

Create `web/src/storage/imagingSettings.ts`:

```ts
import { get, set, del, keys } from 'idb-keyval';

const PREFIX = 'imaging:';

/**
 * Per-guide-log imaging settings for the Image Impact panel, persisted by the
 * log's content hash (the same `meta.hash` annotations / primary period use).
 * One record per log: the imaging scale (arcsec/pixel) and seeing FWHM (arcsec)
 * the user set while viewing it. Used only in per-log mode (the "Remember
 * settings" checkbox switches the panel to a single global value instead).
 */
export interface ImagingSettingsRecord {
  key: string;
  imagingScale: number;
  seeingFwhm: number;
  updatedAt: number;
}

export async function getImagingSettings(key: string): Promise<ImagingSettingsRecord | undefined> {
  return get<ImagingSettingsRecord>(PREFIX + key);
}

export async function putImagingSettings(p: {
  key: string; imagingScale: number; seeingFwhm: number;
}): Promise<ImagingSettingsRecord> {
  const rec: ImagingSettingsRecord = {
    key: p.key, imagingScale: p.imagingScale, seeingFwhm: p.seeingFwhm, updatedAt: Date.now(),
  };
  await set(PREFIX + p.key, rec);
  return rec;
}

export async function deleteImagingSettings(key: string): Promise<void> {
  await del(PREFIX + key);
}

/** Test/maintenance helper — every imaging-settings key (with the `imaging:` prefix). */
export async function _allImagingSettingsKeys(): Promise<string[]> {
  return (await keys()).map(String).filter((k) => k.startsWith(PREFIX));
}
```

- [ ] **Step 4: Create the store**

Create `web/src/state/imagingSettingsStore.ts`:

```ts
import { create } from 'zustand';
import {
  getImagingSettings, putImagingSettings, type ImagingSettingsRecord,
} from '../storage/imagingSettings';

/**
 * Holds the per-log imaging settings (scale + seeing) for the currently-loaded
 * guide log. `loadForLog` is called from logStore when a log opens, so a
 * different log restores/clears the record. Edits in per-log mode go through
 * `setForLog` (writes the full record). When the "Remember settings" checkbox
 * is on, the panel ignores this store and uses the global viewStore values.
 */
interface ImagingSettingsState {
  hash: string | null;
  record: ImagingSettingsRecord | null;
  loadForLog: (hash: string) => Promise<void>;
  setForLog: (hash: string, imagingScale: number, seeingFwhm: number) => Promise<void>;
  clear: () => void;
}

export const useImagingSettingsStore = create<ImagingSettingsState>((set, get) => ({
  hash: null,
  record: null,

  loadForLog: async (hash) => {
    set({ hash, record: null });
    const rec = await getImagingSettings(hash);
    if (get().hash !== hash) return; // ignore a stale read if the log changed
    set({ record: rec ?? null });
  },

  setForLog: async (hash, imagingScale, seeingFwhm) => {
    const rec = await putImagingSettings({ key: hash, imagingScale, seeingFwhm });
    if (get().hash !== hash) return;
    set({ record: rec });
  },

  clear: () => set({ hash: null, record: null }),
}));
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd web && npx vitest run src/state/__tests__/imagingSettingsStore.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add web/src/storage/imagingSettings.ts web/src/state/imagingSettingsStore.ts web/src/state/__tests__/imagingSettingsStore.test.ts
git commit -m "feat: per-log imaging-settings store (durable by content hash)"
```

---

## Task 2: Load/clear the per-log store from logStore

**Files:**
- Modify: `web/src/state/logStore.ts`

- [ ] **Step 1: Import the store**

In `web/src/state/logStore.ts`, add near the other store imports (it uses `useViewStore`, `usePrimaryPeriodStore`, `useAnnotationStore`):

```ts
import { useImagingSettingsStore } from './imagingSettingsStore';
```

- [ ] **Step 2: Load on log open**

In `web/src/state/logStore.ts`, in `loadFromText`, immediately after the line
`void usePrimaryPeriodStore.getState().loadForLog(hash);` add:

```ts
      void useImagingSettingsStore.getState().loadForLog(hash);
```

- [ ] **Step 3: Clear on log clear**

In `web/src/state/logStore.ts`, in `clear`, immediately after
`usePrimaryPeriodStore.getState().clear();` add:

```ts
    useImagingSettingsStore.getState().clear();
```

- [ ] **Step 4: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: no output (clean).

- [ ] **Step 5: Commit**

```bash
git add web/src/state/logStore.ts
git commit -m "feat: load/clear per-log imaging settings with the active log"
```

---

## Task 3: Global remember flag (viewStore)

**Files:**
- Modify: `web/src/state/viewStore.ts`

- [ ] **Step 1: Interface field**

In `web/src/state/viewStore.ts`, in `ViewState`, just after the `imagingScale: number;` / `seeingFwhm: number;` pair, add:

```ts
  /**
   * When true, the Image Impact panel uses one global imaging scale + seeing for
   * ALL logs (and persists them across sessions). When false (default), those
   * two values are remembered per guide log; a new log seeds from the global
   * values. Checking the box copies the current values into the global ones.
   */
  rememberImaging: boolean;
```

And after `setSeeingFwhm: (n: number) => void;` add:

```ts
  setRememberImaging: (b: boolean) => void;
```

- [ ] **Step 2: Default + setter**

In `web/src/state/viewStore.ts`, after `seeingFwhm: 3.0,` add:

```ts
  rememberImaging: false,
```

And after `setSeeingFwhm: (n) => set({ seeingFwhm: n }),` add:

```ts
  setRememberImaging: (b) => set({ rememberImaging: b }),
```

- [ ] **Step 3: Persist**

In `partialize`, after `seeingFwhm: s.seeingFwhm,` add:

```ts
    rememberImaging: s.rememberImaging,
```

- [ ] **Step 4: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: no output (clean).

- [ ] **Step 5: Commit**

```bash
git add web/src/state/viewStore.ts
git commit -m "feat: persist the global 'remember imaging settings' flag"
```

---

## Task 4: Compute additions (guiding-only ecc, rating, sampling)

**Files:**
- Modify: `web/src/parser/imageImpact.ts`
- Test: `web/src/parser/__tests__/imageImpact.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `web/src/parser/__tests__/imageImpact.test.ts` (add the import for the new helpers at the top — change the existing import line to include them):

Change the top import to:

```ts
import {
  computeImageImpact, presetForFwhm, SEEING_PRESETS,
  elongationRating, samplingRelation,
} from '../imageImpact';
```

Add these describe blocks at the end of the file:

```ts
describe('guidingOnlyEccentricity', () => {
  it('is the guide-error ellipse eccentricity, before adding seeing', () => {
    const r = computeImageImpact(0.75, 0.55, 0.80, 3.00)!;
    expect(r.guidingOnlyEccentricity).toBeCloseTo(0.680, 2); // sqrt(1-(0.55/0.75)^2)
  });
});

describe('elongationRating', () => {
  it('low below 0.25, moderate below 0.45, else high', () => {
    expect(elongationRating(0.2)).toBe('low');
    expect(elongationRating(0.25)).toBe('moderate');
    expect(elongationRating(0.3)).toBe('moderate');
    expect(elongationRating(0.45)).toBe('high');
    expect(elongationRating(0.5)).toBe('high');
  });
});

describe('samplingRelation', () => {
  it('coarser when guide scale larger, finer when smaller, same when ~equal', () => {
    expect(samplingRelation(2.5, 0.8)).toEqual({ relation: 'coarser', ratio: 2.5 / 0.8 });
    expect(samplingRelation(0.8, 2.5)).toEqual({ relation: 'finer', ratio: 2.5 / 0.8 });
    expect(samplingRelation(1.0, 1.0)).toEqual({ relation: 'same', ratio: 1 });
    expect(samplingRelation(1.0, 1.0005)).toEqual({ relation: 'same', ratio: 1 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/parser/__tests__/imageImpact.test.ts`
Expected: FAIL — `elongationRating`/`samplingRelation` not exported; `guidingOnlyEccentricity` undefined.

- [ ] **Step 3: Add `guidingOnlyEccentricity` to the result**

In `web/src/parser/imageImpact.ts`, add to the `ImageImpactResult` interface after `estimatedEccentricity: number;`:

```ts
  guidingOnlyEccentricity: number; // guide-error ellipse alone, before seeing
```

And in `computeImageImpact`, after the `estimatedEccentricity` line, add:

```ts
  const guidingOnlyEccentricity = safeSqrt(1 - (minor / major) ** 2);
```

And add `guidingOnlyEccentricity,` to the returned object (next to `estimatedEccentricity,`).

- [ ] **Step 4: Add the two pure helpers**

In `web/src/parser/imageImpact.ts`, append at the end of the file:

```ts
export type ElongationRating = 'low' | 'moderate' | 'high';

/** Qualitative label for an estimated eccentricity (prototype thresholds). */
export function elongationRating(ecc: number): ElongationRating {
  if (ecc < 0.25) return 'low';
  if (ecc < 0.45) return 'moderate';
  return 'high';
}

export interface SamplingRelation {
  relation: 'same' | 'coarser' | 'finer';
  ratio: number; // larger/smaller scale; 1 when essentially equal
}

/**
 * How the guide-camera pixel scale compares to the imaging-camera scale. Does
 * not affect eccentricity (RMS are already arc-sec); it explains how the same
 * sky error maps onto each camera's pixels.
 */
export function samplingRelation(guideScale: number, imagingScale: number): SamplingRelation {
  if (Math.abs(guideScale - imagingScale) < 0.001) return { relation: 'same', ratio: 1 };
  return guideScale > imagingScale
    ? { relation: 'coarser', ratio: guideScale / imagingScale }
    : { relation: 'finer', ratio: imagingScale / guideScale };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd web && npx vitest run src/parser/__tests__/imageImpact.test.ts`
Expected: PASS (all, including the 3 new blocks).

- [ ] **Step 6: Commit**

```bash
git add web/src/parser/imageImpact.ts web/src/parser/__tests__/imageImpact.test.ts
git commit -m "feat: guiding-only eccentricity + elongation rating + sampling relation"
```

---

## Task 5: i18n — rename + interpretation keys (6 locales)

**Files:**
- Modify: `web/src/i18n/locales/{en,es,de,fr,it,zh}/stats.json`

For each locale: (a) change the `estimatedSeeing` value, (b) append the new keys
inside the `imageImpact` block — anchor on that locale's `noData` line (the last key),
replacing `"noData": "<val>"` with `"noData": "<val>",` + the new keys.

- [ ] **Step 1: en**

Change `"estimatedSeeing": "Estimated Seeing",` → `"estimatedSeeing": "Seeing conditions (FWHM)",`.
Then replace `    "noData": "No guiding data to estimate"` with:

```json
    "noData": "No guiding data to estimate",
    "remember": "Remember settings",
    "rememberTooltip": "Apply these to every log; otherwise they're saved per log",
    "imagingScaleLinkTitle": "Open the image-scale / field-of-view calculator (new tab)",
    "orientHorizontal": "horizontal",
    "orientVertical": "vertical",
    "ratingLow": "low estimated elongation",
    "ratingModerate": "moderate estimated elongation",
    "ratingHigh": "high estimated elongation",
    "interpGuide": "The guiding error is {{axis}}-dominant — estimated elongation tends toward the {{axis}} direction on the sky (the camera-projected {{axis}} axis, not necessarily {{orient}} unless the camera is aligned that way). Guiding-only eccentricity {{ecc}}.",
    "interpFinalPreset": "Using the {{preset}} midpoint {{fwhm}}″, the estimated final eccentricity is {{ecc}} — {{rating}}.",
    "interpFinalCustom": "Using a custom FWHM of {{fwhm}}″, the estimated final eccentricity is {{ecc}} — {{rating}}.",
    "samplingCoarser": "The guide camera is coarser than the imaging camera by {{ratio}}×, so the same sky error spans more pixels on the imaging camera.",
    "samplingFiner": "The guide camera is finer than the imaging camera by {{ratio}}×, so the same sky error spans fewer pixels on the imaging camera.",
    "samplingSame": "The guide and imaging scales are essentially the same.",
    "disclaimer": "This is an estimate. Real star eccentricity can also be affected by variable seeing, optical aberrations, focus, differential flexure, field rotation, wind, sampling, processing, and measurement method."
```

- [ ] **Step 2: es**

Change `"estimatedSeeing": "Seeing estimado",` → `"estimatedSeeing": "Condiciones de seeing (FWHM)",`.
Replace `    "noData": "Sin datos de guiado para estimar"` with:

```json
    "noData": "Sin datos de guiado para estimar",
    "remember": "Recordar ajustes",
    "rememberTooltip": "Aplicar a todos los logs; si no, se guardan por log",
    "imagingScaleLinkTitle": "Abrir la calculadora de escala de imagen / campo de visión (nueva pestaña)",
    "orientHorizontal": "horizontal",
    "orientVertical": "vertical",
    "ratingLow": "elongación estimada baja",
    "ratingModerate": "elongación estimada moderada",
    "ratingHigh": "elongación estimada alta",
    "interpGuide": "El error de guiado es {{axis}} dominante — la elongación estimada tiende hacia la dirección {{axis}} en el cielo (el eje {{axis}} proyectado en la cámara, no necesariamente {{orient}} salvo que la cámara esté alineada así). Excentricidad solo de guiado {{ecc}}.",
    "interpFinalPreset": "Con el punto medio de {{preset}} {{fwhm}}″, la excentricidad final estimada es {{ecc}} — {{rating}}.",
    "interpFinalCustom": "Con un FWHM personalizado de {{fwhm}}″, la excentricidad final estimada es {{ecc}} — {{rating}}.",
    "samplingCoarser": "La cámara de guiado es más gruesa que la de imagen por {{ratio}}×, así que el mismo error del cielo ocupa más píxeles en la cámara de imagen.",
    "samplingFiner": "La cámara de guiado es más fina que la de imagen por {{ratio}}×, así que el mismo error del cielo ocupa menos píxeles en la cámara de imagen.",
    "samplingSame": "Las escalas de guiado e imagen son esencialmente iguales.",
    "disclaimer": "Esto es una estimación. La excentricidad real de las estrellas también puede verse afectada por seeing variable, aberraciones ópticas, enfoque, flexión diferencial, rotación de campo, viento, muestreo, procesado y método de medición."
```

- [ ] **Step 3: de**

Change `"estimatedSeeing": "Geschätztes Seeing",` → `"estimatedSeeing": "Seeing-Bedingungen (FWHM)",`.
Replace `    "noData": "Keine Guiding-Daten zur Schätzung"` with:

```json
    "noData": "Keine Guiding-Daten zur Schätzung",
    "remember": "Einstellungen merken",
    "rememberTooltip": "Für alle Logs anwenden; sonst pro Log gespeichert",
    "imagingScaleLinkTitle": "Rechner für Bildmaßstab / Gesichtsfeld öffnen (neuer Tab)",
    "orientHorizontal": "horizontal",
    "orientVertical": "vertikal",
    "ratingLow": "geringe geschätzte Elongation",
    "ratingModerate": "mäßige geschätzte Elongation",
    "ratingHigh": "hohe geschätzte Elongation",
    "interpGuide": "Der Guiding-Fehler ist {{axis}}-dominant — die geschätzte Elongation tendiert zur {{axis}}-Richtung am Himmel (die kameraprojizierte {{axis}}-Achse, nicht zwingend {{orient}}, außer die Kamera ist so ausgerichtet). Guiding-Exzentrizität {{ecc}}.",
    "interpFinalPreset": "Mit dem Mittelwert von {{preset}} {{fwhm}}″ beträgt die geschätzte finale Exzentrizität {{ecc}} — {{rating}}.",
    "interpFinalCustom": "Mit einem benutzerdefinierten FWHM von {{fwhm}}″ beträgt die geschätzte finale Exzentrizität {{ecc}} — {{rating}}.",
    "samplingCoarser": "Die Guiding-Kamera ist um {{ratio}}× gröber als die Aufnahmekamera, sodass derselbe Himmelsfehler auf der Aufnahmekamera mehr Pixel einnimmt.",
    "samplingFiner": "Die Guiding-Kamera ist um {{ratio}}× feiner als die Aufnahmekamera, sodass derselbe Himmelsfehler auf der Aufnahmekamera weniger Pixel einnimmt.",
    "samplingSame": "Guiding- und Aufnahmemaßstab sind praktisch gleich.",
    "disclaimer": "Dies ist eine Schätzung. Die echte Sternexzentrizität kann auch durch variables Seeing, optische Aberrationen, Fokus, differentielle Flexure, Feldrotation, Wind, Sampling, Bearbeitung und Messmethode beeinflusst werden."
```

- [ ] **Step 4: fr**

Change `"estimatedSeeing": "Seeing estimé",` → `"estimatedSeeing": "Conditions de seeing (FWHM)",`.
Replace `    "noData": "Aucune donnée de guidage à estimer"` with:

```json
    "noData": "Aucune donnée de guidage à estimer",
    "remember": "Mémoriser les réglages",
    "rememberTooltip": "Appliquer à tous les logs ; sinon enregistrés par log",
    "imagingScaleLinkTitle": "Ouvrir le calculateur d'échelle d'image / champ de vision (nouvel onglet)",
    "orientHorizontal": "horizontale",
    "orientVertical": "verticale",
    "ratingLow": "élongation estimée faible",
    "ratingModerate": "élongation estimée modérée",
    "ratingHigh": "élongation estimée élevée",
    "interpGuide": "L'erreur de guidage est dominée par {{axis}} — l'élongation estimée tend vers la direction {{axis}} dans le ciel (l'axe {{axis}} projeté sur la caméra, pas nécessairement {{orient}} sauf si la caméra est alignée ainsi). Excentricité de guidage seule {{ecc}}.",
    "interpFinalPreset": "Avec le point médian de {{preset}} {{fwhm}}″, l'excentricité finale estimée est {{ecc}} — {{rating}}.",
    "interpFinalCustom": "Avec un FWHM personnalisé de {{fwhm}}″, l'excentricité finale estimée est {{ecc}} — {{rating}}.",
    "samplingCoarser": "La caméra de guidage est plus grossière que la caméra d'imagerie de {{ratio}}×, donc la même erreur du ciel occupe plus de pixels sur la caméra d'imagerie.",
    "samplingFiner": "La caméra de guidage est plus fine que la caméra d'imagerie de {{ratio}}×, donc la même erreur du ciel occupe moins de pixels sur la caméra d'imagerie.",
    "samplingSame": "Les échelles de guidage et d'imagerie sont essentiellement identiques.",
    "disclaimer": "Ceci est une estimation. L'excentricité réelle des étoiles peut aussi être affectée par un seeing variable, des aberrations optiques, la mise au point, la flexion différentielle, la rotation de champ, le vent, l'échantillonnage, le traitement et la méthode de mesure."
```

- [ ] **Step 5: it**

Change `"estimatedSeeing": "Seeing stimato",` → `"estimatedSeeing": "Condizioni di seeing (FWHM)",`.
Replace `    "noData": "Nessun dato di guida da stimare"` with:

```json
    "noData": "Nessun dato di guida da stimare",
    "remember": "Ricorda impostazioni",
    "rememberTooltip": "Applica a tutti i log; altrimenti salvate per log",
    "imagingScaleLinkTitle": "Apri il calcolatore di scala immagine / campo inquadrato (nuova scheda)",
    "orientHorizontal": "orizzontale",
    "orientVertical": "verticale",
    "ratingLow": "allungamento stimato basso",
    "ratingModerate": "allungamento stimato moderato",
    "ratingHigh": "allungamento stimato alto",
    "interpGuide": "L'errore di guida è {{axis}}-dominante — l'allungamento stimato tende verso la direzione {{axis}} nel cielo (l'asse {{axis}} proiettato sulla camera, non necessariamente {{orient}} a meno che la camera non sia allineata così). Eccentricità della sola guida {{ecc}}.",
    "interpFinalPreset": "Con il punto medio di {{preset}} {{fwhm}}″, l'eccentricità finale stimata è {{ecc}} — {{rating}}.",
    "interpFinalCustom": "Con un FWHM personalizzato di {{fwhm}}″, l'eccentricità finale stimata è {{ecc}} — {{rating}}.",
    "samplingCoarser": "La camera di guida è più grossolana di quella di ripresa di {{ratio}}×, quindi lo stesso errore del cielo occupa più pixel sulla camera di ripresa.",
    "samplingFiner": "La camera di guida è più fine di quella di ripresa di {{ratio}}×, quindi lo stesso errore del cielo occupa meno pixel sulla camera di ripresa.",
    "samplingSame": "Le scale di guida e ripresa sono essenzialmente uguali.",
    "disclaimer": "Questa è una stima. L'eccentricità reale delle stelle può essere influenzata anche da seeing variabile, aberrazioni ottiche, messa a fuoco, flessione differenziale, rotazione di campo, vento, campionamento, elaborazione e metodo di misura."
```

- [ ] **Step 6: zh**

Change `"estimatedSeeing": "估计视宁度",` → `"estimatedSeeing": "视宁度条件 (FWHM)",`.
Replace `    "noData": "无导星数据可估算"` with:

```json
    "noData": "无导星数据可估算",
    "remember": "记住设置",
    "rememberTooltip": "应用到所有日志；否则按日志分别保存",
    "imagingScaleLinkTitle": "打开成像比例 / 视场计算器（新标签页）",
    "orientHorizontal": "水平",
    "orientVertical": "垂直",
    "ratingLow": "估计拉长较低",
    "ratingModerate": "估计拉长中等",
    "ratingHigh": "估计拉长较高",
    "interpGuide": "导星误差以 {{axis}} 为主——估计的拉长偏向天空中的 {{axis}} 方向（相机投影的 {{axis}} 轴，除非相机如此对齐，否则不一定是{{orient}}方向）。仅导星偏心率 {{ecc}}。",
    "interpFinalPreset": "使用 {{preset}} 的中值 {{fwhm}}″，估计最终偏心率为 {{ecc}} — {{rating}}。",
    "interpFinalCustom": "使用自定义 FWHM {{fwhm}}″，估计最终偏心率为 {{ecc}} — {{rating}}。",
    "samplingCoarser": "导星相机比成像相机粗 {{ratio}}×，因此相同的天空误差在成像相机上占据更多像素。",
    "samplingFiner": "导星相机比成像相机细 {{ratio}}×，因此相同的天空误差在成像相机上占据更少像素。",
    "samplingSame": "导星与成像比例基本相同。",
    "disclaimer": "这是一个估算。真实的星点偏心率还会受到视宁度变化、光学像差、对焦、差分挠曲、场旋转、风、采样、后期处理和测量方法的影响。"
```

- [ ] **Step 7: Validate JSON**

Run: `cd web && node -e "for (const l of ['en','es','de','fr','it','zh']) { const j=JSON.parse(require('fs').readFileSync('src/i18n/locales/'+l+'/stats.json','utf8')); if(!j.imageImpact.disclaimer||!j.imageImpact.remember) throw new Error(l); console.log(l,'ok') }"`
Expected: `en ok` … `zh ok`.

- [ ] **Step 8: Commit**

```bash
git add web/src/i18n/locales
git commit -m "i18n: per-log imaging-settings + interpretation strings (6 locales)"
```

---

## Task 6: ImageImpact component (decimal inputs, wiring, checkbox, link, tooltips)

**Files:**
- Modify (full rewrite): `web/src/components/ImageImpact.tsx`

- [ ] **Step 1: Replace the component**

Replace the entire contents of `web/src/components/ImageImpact.tsx` with:

```tsx
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useLogStore } from '../state/logStore';
import { useViewStore } from '../state/viewStore';
import { useImagingSettingsStore } from '../state/imagingSettingsStore';
import { calcStats } from '../parser';
import {
  computeImageImpact, presetForFwhm, elongationRating, samplingRelation,
  SEEING_PRESETS, type ImageImpactResult,
} from '../parser/imageImpact';
import { fmtNumber } from '../i18n/format';

const f2 = (n: number) => fmtNumber(n, 2);
const IMAGING_SCALE_CALC_URL = 'https://astronomy.tools/calculators/field_of_view/';

// Shared SVG geometry (RA horizontal, Dec vertical). Conceptual, not measured.
const W = 150, H = 104, CX = 75, CY = 52, MAX_R = 46, MIN_R = 8;

// Decimal-friendly numeric input: holds the raw string locally so partial
// entries like ".8" or "1." are accepted (no leading 0 required); emits a
// number only when the text parses.
function DecimalInput({ value, onChange, className, title, ariaLabel }: {
  value: number; onChange: (n: number) => void;
  className?: string; title?: string; ariaLabel?: string;
}) {
  const [text, setText] = useState(() => String(value));
  useEffect(() => {
    // Re-sync when the value changes externally (e.g. switching logs) but don't
    // clobber an in-progress entry that already equals the value.
    if (parseFloat(text) !== value) setText(String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      type="text" inputMode="decimal" value={text}
      title={title} aria-label={ariaLabel} className={className}
      onChange={(e) => {
        const t = e.target.value;
        if (!/^\d*\.?\d*$/.test(t)) return;
        setText(t);
        const n = parseFloat(t);
        if (Number.isFinite(n)) onChange(n);
      }}
    />
  );
}

function Axes() {
  return (
    <>
      <line x1={14} y1={CY} x2={W - 14} y2={CY} stroke="rgba(255,255,255,.12)" />
      <line x1={CX} y1={12} x2={CX} y2={H - 12} stroke="rgba(255,255,255,.12)" />
      <text x={W - 16} y={CY - 4} fontSize={10} fill="#94a3b8" textAnchor="end">RA</text>
      <text x={CX + 3} y={22} fontSize={10} fill="#94a3b8">Dec</text>
    </>
  );
}

function axisRadii(major: number, minor: number, dominant: 'RA' | 'Dec') {
  const majR = Math.max(MIN_R, major);
  const minR = Math.max(MIN_R, minor);
  return dominant === 'Dec' ? { rx: minR, ry: majR } : { rx: majR, ry: minR };
}

const RATING_KEY = { low: 'imageImpact.ratingLow', moderate: 'imageImpact.ratingModerate', high: 'imageImpact.ratingHigh' } as const;
const SAMPLING_KEY = { same: 'imageImpact.samplingSame', coarser: 'imageImpact.samplingCoarser', finer: 'imageImpact.samplingFiner' } as const;

function guideTooltip(r: ImageImpactResult, t: TFunction): string {
  const orient = t(r.dominantAxis === 'RA' ? 'imageImpact.orientHorizontal' : 'imageImpact.orientVertical');
  return t('imageImpact.interpGuide', { axis: r.dominantAxis, orient, ecc: f2(r.guidingOnlyEccentricity) })
    + ' ' + t('imageImpact.disclaimer');
}

function finalTooltip(r: ImageImpactResult, imagingScale: number, guideScale: number, fwhm: number, t: TFunction): string {
  const rating = t(RATING_KEY[elongationRating(r.estimatedEccentricity)]);
  const preset = presetForFwhm(fwhm);
  const interp = preset === 'custom'
    ? t('imageImpact.interpFinalCustom', { fwhm: f2(fwhm), ecc: f2(r.estimatedEccentricity), rating })
    : t('imageImpact.interpFinalPreset', { preset: t(`imageImpact.preset_${preset}`), fwhm: f2(fwhm), ecc: f2(r.estimatedEccentricity), rating });
  const sr = samplingRelation(guideScale, imagingScale);
  const samp = t(SAMPLING_KEY[sr.relation], { ratio: sr.ratio.toFixed(1) });
  return `${interp} ${samp} ${t('imageImpact.disclaimer')}`;
}

function GuideEllipse({ r, title }: { r: ImageImpactResult; title: string }) {
  const { t } = useTranslation('stats');
  const scale = MAX_R / Math.max(r.majorRmsArcsec, r.minorRmsArcsec, 1e-6);
  const { rx, ry } = axisRadii(r.majorRmsArcsec * scale, r.minorRmsArcsec * scale, r.dominantAxis);
  const raVal = r.dominantAxis === 'RA' ? r.majorRmsArcsec : r.minorRmsArcsec;
  const decVal = r.dominantAxis === 'Dec' ? r.majorRmsArcsec : r.minorRmsArcsec;
  return (
    <div title={title}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('imageImpact.guidingError')}>
        <Axes />
        <ellipse cx={CX} cy={CY} rx={rx} ry={ry} fill="rgba(245,158,11,.18)" stroke="rgba(245,158,11,.9)" strokeWidth={2} />
        <text x={8} y={16} fontSize={10} fill="#94a3b8">RA {f2(raVal)}″</text>
        <text x={8} y={30} fontSize={10} fill="#94a3b8">Dec {f2(decVal)}″</text>
      </svg>
      <div className="mt-0.5 text-center text-[10px] text-slate-400">
        {t('imageImpact.guidingError')} · {t('imageImpact.dominant', { axis: r.dominantAxis })}
      </div>
    </div>
  );
}

function FinalEllipse({ r, title }: { r: ImageImpactResult; title: string }) {
  const { t } = useTranslation('stats');
  const scale = MAX_R / Math.max(r.finalFwhmMajorArcsec, 1e-6);
  const { rx, ry } = axisRadii(r.finalFwhmMajorArcsec * scale, r.finalFwhmMinorArcsec * scale, r.dominantAxis);
  const baseR = Math.max(MIN_R * 0.8, r.baseFwhmArcsec * scale);
  return (
    <div title={title}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('imageImpact.finalStar')}>
        <Axes />
        <circle cx={CX} cy={CY} r={baseR} fill="none" stroke="rgba(52,211,153,.5)" strokeWidth={2} strokeDasharray="4 4" />
        <ellipse cx={CX} cy={CY} rx={rx} ry={ry} fill="rgba(143,180,255,.18)" stroke="rgba(143,180,255,.95)" strokeWidth={2} />
      </svg>
      <div className="mt-0.5 text-center text-[10px] text-slate-400">
        {t('imageImpact.finalStar')} — {t('imageImpact.finalFwhm', {
          major: f2(r.finalFwhmMajorArcsec), minor: f2(r.finalFwhmMinorArcsec),
          majorpx: f2(r.finalFwhmMajorPx), minorpx: f2(r.finalFwhmMinorPx),
        })}
      </div>
    </div>
  );
}

/**
 * Image Impact panel — right of the StatsGrid on guiding sections. Estimates star
 * elongation from the section's RA/Dec arcsec RMS plus imaging scale + seeing.
 * Per-log values by default (imagingSettingsStore); the "Remember settings"
 * checkbox switches to one global value (viewStore) for all logs.
 */
export function ImageImpact() {
  const { t } = useTranslation('stats');
  const log = useLogStore((s) => s.log);
  const sectionIdx = useLogStore((s) => s.selectedSection);
  const hash = useLogStore((s) => s.meta?.hash);
  const exclusions = useViewStore((s) => s.exclusions);

  const remember = useViewStore((s) => s.rememberImaging);
  const setRemember = useViewStore((s) => s.setRememberImaging);
  const gScale = useViewStore((s) => s.imagingScale);
  const gFwhm = useViewStore((s) => s.seeingFwhm);
  const setGScale = useViewStore((s) => s.setImagingScale);
  const setGFwhm = useViewStore((s) => s.setSeeingFwhm);
  const perLog = useImagingSettingsStore((s) => s.record);
  const setForLog = useImagingSettingsStore((s) => s.setForLog);

  const ctx = useMemo(() => {
    if (!log || sectionIdx < 0) return null;
    const sec = log.sections[sectionIdx];
    if (!sec || sec.type !== 'GUIDING') return null;
    const session = log.sessions[sec.idx];
    const st = calcStats(session, exclusions.get(sec.idx));
    return { ra: st.rmsRaArcsec, dec: st.rmsDecArcsec, guideScale: session.pixelScale };
  }, [log, sectionIdx, exclusions]);

  if (!ctx) return null;

  // Effective values: global when "remember" is on, else this log's record, else
  // the global values as the seed for a never-seen log.
  const scale = remember ? gScale : (perLog?.imagingScale ?? gScale);
  const fwhm = remember ? gFwhm : (perLog?.seeingFwhm ?? gFwhm);

  const setScale = (n: number) => { if (remember) setGScale(n); else if (hash) void setForLog(hash, n, fwhm); };
  const setFwhm = (n: number) => { if (remember) setGFwhm(n); else if (hash) void setForLog(hash, scale, n); };
  const onToggleRemember = (checked: boolean) => {
    if (checked) { setGScale(scale); setGFwhm(fwhm); } // pin current values globally
    setRemember(checked);
  };

  const result = computeImageImpact(ctx.ra, ctx.dec, scale, fwhm);
  const preset = presetForFwhm(fwhm);

  return (
    <div className="border-s border-slate-700 px-4 py-2 text-sm" title={t('imageImpact.tooltip')}>
      <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-sky-300/80">{t('imageImpact.title')}</div>

      <div className="mb-2 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-0.5">
          <a
            href={IMAGING_SCALE_CALC_URL} target="_blank" rel="noopener noreferrer"
            title={t('imageImpact.imagingScaleLinkTitle')}
            className="text-[10px] text-sky-400 hover:text-sky-300 hover:underline"
          >
            {t('imageImpact.imagingScale')} ↗
          </a>
          <span className="flex items-center gap-1 rounded border border-slate-700 bg-slate-950 px-1.5 py-1">
            <DecimalInput
              value={scale} onChange={setScale}
              ariaLabel={t('imageImpact.imagingScale')}
              className="w-14 bg-transparent font-mono text-xs text-slate-100 focus:outline-none"
            />
            <span className="text-[10px] text-slate-500">″/px</span>
          </span>
        </label>

        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] text-slate-400">{t('imageImpact.estimatedSeeing')}</span>
          <span className="flex items-center gap-1">
            <select
              value={preset}
              onChange={(e) => {
                const p = SEEING_PRESETS.find((x) => x.key === e.target.value);
                if (p) setFwhm(p.fwhm);
              }}
              className="rounded border border-slate-700 bg-slate-950 px-1.5 py-1 text-xs text-slate-100 focus:outline-none"
            >
              {SEEING_PRESETS.map((p) => (
                <option key={p.key} value={p.key}>{t(`imageImpact.preset_${p.key}`)}</option>
              ))}
              <option value="custom">{t('imageImpact.preset_custom')}</option>
            </select>
            <span className="flex items-center gap-1 rounded border border-slate-700 bg-slate-950 px-1.5 py-1">
              <DecimalInput
                value={fwhm} onChange={setFwhm}
                title={t('imageImpact.seeingValueTitle')} ariaLabel={t('imageImpact.seeingValueTitle')}
                className="w-12 bg-transparent font-mono text-xs text-slate-100 focus:outline-none"
              />
              <span className="text-[10px] text-slate-500">″</span>
            </span>
          </span>
        </label>

        <label className="flex items-center gap-1.5 text-[10px] text-slate-400" title={t('imageImpact.rememberTooltip')}>
          <input type="checkbox" checked={remember} onChange={(e) => onToggleRemember(e.target.checked)} className="accent-sky-500" />
          {t('imageImpact.remember')}
        </label>
      </div>

      {result ? (
        <div className="flex flex-wrap gap-4">
          <GuideEllipse r={result} title={guideTooltip(result, t)} />
          <FinalEllipse r={result} title={finalTooltip(result, scale, ctx.guideScale, fwhm, t)} />
        </div>
      ) : (
        <div className="text-xs text-slate-500">{t('imageImpact.noData')}</div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: no output (clean).

- [ ] **Step 3: Commit**

```bash
git add web/src/components/ImageImpact.tsx
git commit -m "feat: per-log imaging inputs, remember checkbox, scale link, interpretation tooltips"
```

---

## Task 7: Full verification + PR

- [ ] **Step 1: Typecheck + full suite**

Run: `cd web && npx tsc --noEmit && npx vitest run`
Expected: clean typecheck; all tests pass (282 prior + new imagingSettingsStore (3) + imageImpact (3) cases).

- [ ] **Step 2: Browser verification**

Dev server on `http://localhost:5173/phd2-log-viewer-web/`. Load a guiding log and:
- Set imaging scale to `.8` (no leading 0) — accepted, final star recomputes.
- Set scale/seeing on log A, open log B (different) — B shows its own (seeded from global), A's value did not bleed; reopen A → its value restored. (Use two different sample logs.)
- Check **Remember settings** — value pins; open another log → same value shows; reload → checkbox + value persist.
- Uncheck — back to per-log.
- Hover the guiding-error ellipse and the final-star ellipse → interpretation tooltips (incl. the disclaimer) appear.
- Click the **Imaging scale ↗** label → opens astronomy.tools FOV calculator in a new tab.
- Confirm the seeing label reads **"Seeing conditions (FWHM)"**.

- [ ] **Step 3: Push + open the PR**

```bash
git push -u origin feat/per-log-imaging-settings
git merge-base --is-ancestor origin/main HEAD || { echo "DIVERGED — stop"; exit 1; }
gh pr create --title "feat: per-log imaging settings + remember checkbox + interpretation tooltips" --body "<summary + test evidence>"
```

- [ ] **Step 4: Merge per the auto-merge policy (coding PR, tests green)**

```bash
gh api -X PUT repos/bvalente22/phd2-log-viewer-web/pulls/<N>/merge -f merge_method=squash
git checkout main && git pull --ff-only   # if "File exists" hiccup: git reset --hard origin/main
```

---

## Self-Review

**Spec coverage:**
- Per-log storage by hash → Task 1 (storage + store) + Task 2 (logStore load/clear). ✓
- Global remember flag → Task 3. ✓
- Effective-value resolution + edit routing + toggle copies-to-global → Task 6. ✓
- Decimal inputs (no leading 0) → Task 6 `DecimalInput`. ✓
- Label rename + imaging-scale link → Task 5 (string) + Task 6 (anchor). ✓
- Interpretation tooltips (guiding-only ecc, rating, sampling, disclaimer; split by ellipse) → Task 4 (compute/helpers) + Task 5 (i18n) + Task 6 (`guideTooltip`/`finalTooltip`). ✓
- Tests → Tasks 1 & 4 (vitest), Task 7 (browser). ✓

**Placeholder scan:** All code/i18n steps complete. `<summary>`/`<N>` in Task 7 are runtime values.

**Type consistency:** `getImagingSettings`/`putImagingSettings`/`deleteImagingSettings`/`_allImagingSettingsKeys`/`ImagingSettingsRecord` (Task 1) used by the store (Task 1) and test. `useImagingSettingsStore` `loadForLog`/`setForLog`/`clear` (Task 1) used in Tasks 2 & 6. `rememberImaging`/`setRememberImaging` (Task 3) used in Task 6. `guidingOnlyEccentricity`/`elongationRating`/`samplingRelation` (Task 4) used in Task 6 tooltip builders. i18n keys (Task 5) — `interpGuide`/`interpFinalPreset`/`interpFinalCustom`/`sampling{Same,Coarser,Finer}`/`rating{Low,Moderate,High}`/`orient{Horizontal,Vertical}`/`remember`/`rememberTooltip`/`imagingScaleLinkTitle`/`disclaimer` — all referenced by Task 6; `RATING_KEY`/`SAMPLING_KEY` maps match the `low|moderate|high` / `same|coarser|finer` enum strings from Task 4. Consistent.
