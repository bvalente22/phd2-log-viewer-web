# CI / Pages deploy — Node 24 status

**Source of truth: the `Cross-session context` section of [`../../CLAUDE.md`](../../CLAUDE.md).** This is a granular per-topic copy.

**Deploy:** `.github/workflows/deploy-pages.yml` runs on **every push to `main`**
(`npm ci && npm run build` → `web/dist` → Pages). Live site:
https://bvalente22.github.io/phd2-log-viewer-web/. Merging ANY PR to `main`
triggers a deploy; the workflow has no path filter, so docs/memory merges deploy
too.

**Node 20 deprecation (handled in #115, 2026-06-19):** bumped
`actions/checkout@v4→v5`, `actions/setup-node@v4→v5`, build `node-version
20→22`. **Still on Node 20 / no fix available yet:**
`actions/upload-pages-artifact@v3` (pulls in `upload-artifact@v4`) and
`actions/deploy-pages@v4` — GitHub has **not** released Node 24 versions of the
Pages actions. The runner force-runs them on Node 24, so deploys stay green; the
two remaining "Node.js 20 is deprecated" annotations are **expected**. Bump them
once GitHub ships updates, before the **Sept 16 2026** Node-20 removal.

**Auth gotcha:** pushing changes under `.github/workflows/` requires the `gh`
token's **`workflow`** scope — a plain `repo` token is rejected with "refusing to
allow an OAuth App to create or update workflow … without `workflow` scope."
Granted on this machine 2026-06-19 via `gh auth refresh -h github.com -s
workflow`. Run that in an **interactive terminal**: the device-code flow does not
complete from a headless/background process (it prints the code but doesn't poll
to completion).

Related: `nas-vitest-toolchain.md`.
