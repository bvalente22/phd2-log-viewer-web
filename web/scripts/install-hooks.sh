#!/bin/sh
# Point this repo at the tracked .githooks/ directory so `git commit` runs the
# pre-commit version-bump hook automatically. Run once after cloning.
set -e
git config core.hooksPath .githooks
chmod +x .githooks/* 2>/dev/null || true
echo "git hooks installed (core.hooksPath=.githooks)"
