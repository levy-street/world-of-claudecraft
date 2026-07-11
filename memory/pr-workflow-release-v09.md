---
name: pr-workflow-release-v09
description: How to open PRs on this repo — fork remote, release/v0.9 base, and the gh pr edit base-change workaround
metadata:
  type: project
---

PRs for world-of-claudecraft must be based off **`release/v0.9`** (upstream `levy-street`), not `main`. As of 2026-06-17 `release/v0.9` == `main` == tag `v0.9.0` (commit 2456da9), but target the branch by name.

**Push access:** the user `ryan-foo` can only push to the **fork** remote `ryan-foo/world-of-claudecraft` (`git push fork <branch>`). Pushing to `origin` (`levy-street`) is denied (403). Open PRs from `ryan-foo:<branch>` → `levy-street:release/v0.9`.

**Changing a PR base:** `gh pr edit <n> --base <branch>` fails with exit 1 (a deprecated Projects-classic GraphQL call errors). Use the REST API instead:
`gh api -X PATCH repos/levy-street/world-of-claudecraft/pulls/<n> -f base=release/v0.9`

**Co-author trailer** for commits: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
