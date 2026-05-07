# CLAUDE.md

Project-specific operating rules for Claude Code in this repository.

## Repository layout

- Single canonical repo: `https://github.com/bvalente22/phd2-log-viewer-web` (set as `origin`).
- One `.git`, one timeline. The previous setup had a separate `web/.git` subclone that drifted into a parallel timeline; that workflow is retired. Do not reintroduce a nested `.git` under `web/`.
- The active web app lives under `web/`. The repo root also contains the original C++ desktop sources (`LogViewFrame.cpp`, `AnalysisWin.cpp`, `logparser.cpp`, etc.), `phd2log/`, `sample data/`, and supporting artifacts. They share one history.

## Git workflow — non-negotiable

1. **Push after every commit.** Each commit lands on a feature branch on `origin` immediately. Never let committed work pile up locally between sessions; un-pushed commits are the failure mode that produced the parallel-timeline divergence in the past.
2. **`main` only advances via PR merge.** Never push directly to `main`. Force-push to `main` is reserved for explicitly-authorized one-time history resets and must be requested by name (not by a generic "yes proceed").
3. **No history rewrites — ever.** No `git filter-repo`, no `filter-branch`, no `rebase --root`, no `amend` after push, no fresh-init-and-replay. Path/structure reorganizations become normal commits, not rewrites of earlier history. Rewriting history was the root cause of the prior divergence.
4. **Verify connectivity before opening a PR.** Run `git merge-base --is-ancestor origin/main HEAD` (or `git fetch origin && git log --oneline origin/main..HEAD`) first. If the branch and `origin/main` share no recent ancestor, **stop** and surface the divergence to the user instead of pushing.

## PR workflow

```
git checkout -b <branch-name>           # always work on a feature branch
# ... edits + commits ...
git push -u origin <branch-name>
git merge-base --is-ancestor origin/main HEAD || { echo "DIVERGED — stop"; exit 1; }
gh pr create --title "..." --body "..."
```

After the user merges the PR on GitHub, `git checkout main && git pull --ff-only` to update local.

## Things to never do without explicit user authorization

- `git push --force` / `git push --force-with-lease` to `main`
- `git push origin --delete main`
- Anything in the "no history rewrites" list above
- Deleting branches that have unmerged commits the user may want
