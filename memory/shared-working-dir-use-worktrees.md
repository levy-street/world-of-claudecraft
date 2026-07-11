---
name: shared-working-dir-use-worktrees
description: The user edits the same repo checkout in parallel; do feature work in an isolated git worktree, never the main checkout
metadata:
  type: feedback
---

The user (ryan-foo) actively works in the **same `/Users/maxc/code/world-of-claudecraft` checkout at the same time** — switching branches and committing while I work. In one session they checked out `feature/swing-timer` then `hotfix/tooltip-details` mid-task, which **discarded my uncommitted changes** in the shared working tree.

**Why:** a single working directory has one HEAD and one working tree; the user's `git checkout`/`reset` migrates or drops *my* uncommitted edits.

**How to apply:** For any multi-step feature work, create an isolated worktree off the target base and do everything there — e.g. `git worktree add -B feature/<slug> /Users/maxc/code/woc-<slug> origin/release/v0.9`, edit/commit/push from that path, then `git worktree remove` when merged. Commit early (commits survive the user's branch switches; working-tree edits do not). Don't trust the main checkout's branch/working-tree to stay put across tool calls. See [[pr-workflow-release-v09]] and [[formatter-hook-reflows-ts]].
