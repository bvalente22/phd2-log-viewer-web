# Polar Alignment — accuracy phase status & open follow-ups

The polar-alignment **accuracy phase** is COMPLETE and merged to `main` (PR #109, commit `945acf6`):

- **Effective (drift-weighted mean) hour angle** for the per-section Alt/Az split — total PAE is unchanged (hour-angle-independent); only the split + trust flags sharpen.
- **Whole-log least-squares "All Sections" solve** (`web/src/parser/globalPolarAlignment.ts`): combines guiding sections at different hour angles to solve azimuth & altitude uniquely (`e_i = A·cosH_i + E·sinH_i`), pier-side normalized, with a **High / Medium / Low / —** confidence rating from HA spread + fit residual.
- **Toggling UI:** the "Polar Alignment Error" readout switches **Section ⟷ All Sections** (stats + bullseye together) on click. As of PR #113 it lives in `PolarAlignmentPanel`, now the **Polar Alignment** tab of the tabbed guiding footer (`StatsTabs`), and the All-Sections **confidence is computed but no longer displayed** — only the section count is shown. See `tabbed-stats-footer.md`.
- **Narrow tooltips:** shared `wrapTip` helper in `web/src/i18n/format.ts` (extracted from `ImageImpact`).
- **Developer explainer:** `docs/polar-alignment-explained.md`. Spec + plan under `docs/superpowers/`.
- Tests: 44 files / 325 passing from the G: drive; tsc clean.

Prior merged phases: the per-section Polar Alignment Error feature; the desktop-default settling policy (#106).

## Open follow-ups (non-blocking — for resume)

1. **Optional test** — add a **residual-driven Low/Medium confidence** case to `web/src/parser/__tests__/globalPolarAlignment.test.ts`. This was the final whole-branch (Opus) review's single recommendation. The existing global tests cover happy-path recovery, pier-flip normalization, and insufficient-spread, but nothing pins `relResidual` at the Low/Medium boundary — e.g. inject an outlier section so the fit lands in `low`, and one with an HA spread in [1.5, 3.0) for `medium`.

2. **Email summary (active thread)** — the user asked for a **short-email** version of the PA approach to send to another developer. A draft was provided in chat: per-section drift → `PAE = 3.8197·|Dec drift ″/min| / cos δ` (matches the desktop *phdlogview* — validated on sample segs 8/10/15: RA exact, Dec ±0.01″/min, PAE ~0.1′); the web app adds (1) a per-section Alt/Az split using the section's mean hour angle, with the weakly-observed axis flagged "!", and (2) a whole-log least-squares solve that separates Alt/Az when sections span enough hour angle, with a confidence rating. Bottom line: total PAE accurate; per-section split is an approximation with the bad axis flagged; whole-log solve gives a trustworthy breakdown. **Pending the user's decision:** shorten to 3–4 sentences, drop the formula for a non-technical reader, and/or add it as an abstract at the top of `docs/polar-alignment-explained.md`.
