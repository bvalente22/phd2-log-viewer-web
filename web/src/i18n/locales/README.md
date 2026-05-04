# Translations

This folder holds one subfolder per supported language. To improve a translation,
just edit the JSON files — each language's folder mirrors the English source of
truth, file-for-file and key-for-key.

## Layout

```
locales/
  en/      <-- source of truth
  es/      <-- Spanish
  de/      <-- German
  fr/      <-- French
  it/      <-- Italian
  zh/      <-- Simplified Chinese (zh-CN browser locales also resolve here)
```

Each language has the same set of namespaces:

| File           | What it covers                                      |
|----------------|-----------------------------------------------------|
| `common.json`  | App chrome, version line, drop zone, language label |
| `toolbar.json` | Graph toolbar buttons, tooltips, right-click menu   |
| `analysis.json`| Analysis modal (drift chart + periodogram)          |
| `stats.json`   | Guide stats grid + calibration stats grid           |
| `sections.json`| Sidebar: section list, recents, logs-folder pane    |
| `chart.json`   | Plotly axis titles and trace names                  |
| `errors.json`  | User-visible error messages                         |

## Conventions

### PHD2 jargon stays in English

Domain terms — `RA`, `Dec`, `RMS`, `SNR`, `Mass`, `AO`, `FFT`, `dither`,
`settling`, `backlash`, `drift`, `xRate`, `yRate`, `xAngle`, `yAngle`, `PAE`,
`pixel scale`, `mount`, `frame`, `guide star`, `periodogram` — are kept in
English across **every** locale. This matches what the international
astrophotography community actually says on forums and in star-party
conversation.

The prose around those terms (verbs, articles, descriptions) is translated
normally. So in German you'll see things like
"`RA`-Fehlerspur ein-/ausblenden" rather than "Spur des Rektaszensionsfehlers".

### Interpolation placeholders

Strings use `{{name}}` placeholders — keep them verbatim and re-position them
within the sentence as the target language requires. Example, English vs French:

```
en: "Reopen {{name}}"
fr: "Rouvrir {{name}}"
```

### Numbers and dates

Don't translate or format numbers or dates inside JSON. Number / date
formatting is done at runtime via `Intl.NumberFormat` / `Intl.DateTimeFormat`
in [`../format.ts`](../format.ts), so 0.123 will render as `0,123` in
French/German automatically without you having to touch the JSON.

### Adding a new language

1. Create `locales/<lng>/`.
2. Copy the seven JSON files from `locales/en/` and translate the values.
3. Add the imports + the entry in `resources` and `SUPPORTED_LANGUAGES` in
   [`../index.ts`](../index.ts).
