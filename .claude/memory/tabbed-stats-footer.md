# Guiding stats footer — tabbed (`StatsTabs`)

**Source of truth: the `Cross-session context` section of [`../../CLAUDE.md`](../../CLAUDE.md).** This is a granular per-topic copy.

The guiding-section footer band (under the chart) is a **three-tab strip** —
`web/src/components/StatsTabs.tsx`, mirroring `CalibrationTabs`. Tabs left→right:
**Stats** (default) | **Estimated Imaging Impact** | **Polar Alignment**. Only the
active panel renders; tab state is component-local and resets to Stats on each
section switch.

- `StatsGrid` is now **stats-only** (Total / RA / Dec rows + included/excluded
  counts). The PA readout + bullseye + whole-log "All Sections" solve were
  extracted into a new `PolarAlignmentPanel`. `ImageImpact` is unchanged except
  its header.
- **Decision (non-obvious — don't "fix" it):** the All-Sections **confidence**
  (High/Medium/Low) is still computed in `globalPolarAlignment.ts` and still
  gates whether the solve resolves (insufficient → "—"), but it is **deliberately
  not shown** in the UI. The All-Sections line shows only the section count.
- The Imaging Impact and Polar Alignment tab headers carry an **"EXPERIMENTAL"**
  suffix by design ("Estimated Imaging Impact: EXPERIMENTAL", "Polar Alignment
  Error: EXPERIMENTAL").
- Shipped: PR #113, squash commit `339570a`. Spec:
  `docs/superpowers/specs/2026-06-19-tabbed-stats-footer-design.md`. Related:
  `pa-accuracy-status.md`.
