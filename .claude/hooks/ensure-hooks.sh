#!/usr/bin/env bash
# Enable the repo's git hooks for this clone (SessionStart hook).
#
# World of ClaudeCraft ships a pre-push QA floor in .githooks/. Git does not use a checked-in
# hooks directory unless core.hooksPath points at it, and that config is per-clone, so it has
# to be set once on each contributor's machine. This runs at the start of a Claude Code
# session and does that, idempotently and only when nothing else already owns the hook path
# (so it never clobbers husky or a contributor's own setup). It is repo-local, prints what it
# did, and is easy to undo: `git config --unset core.hooksPath`.
set -uo pipefail

dir="${CLAUDE_PROJECT_DIR:-$PWD}"
cd "$dir" 2>/dev/null || exit 0
command -v git >/dev/null 2>&1 || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0
[ -d "$dir/.githooks" ] || exit 0

current=$(git config --local --get core.hooksPath 2>/dev/null || true)
if [ -z "$current" ]; then
  if git config --local core.hooksPath .githooks 2>/dev/null; then
    echo "World of ClaudeCraft: enabled .githooks (pre-push QA floor: tsc, guard tests, biome, copy rules). Undo with: git config --unset core.hooksPath" >&2
  fi
fi
exit 0
