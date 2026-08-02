# Phase 1 QA: verify the foundation

### QA starter prompt
```
This is Phase 1 QA of the Guild Bank feature.

Model: newest available Claude coding model, xhigh effort. Harness: Claude Code.
Worktree: /Users/seanghods/repos/world-of-claudecraft-guild-bank.

Goal: audit Phase 1 (sim state module, membership stamp, facet) for correctness, missing
tests, dead code, determinism, and parity.

STEP 0: git status clean (Phase 1 committed); memory scan.
STEP 1: Explore agent summarizes docs/guild-bank/state.md, progress.md Phase 1 checklist,
phase-01-foundation.md (what was promised), and the Phase 1 diff (git diff against the
packet-start commit).
STEP 2: spawn parallel review agents (COVERAGE not filtering; resume truncated agents with
"Stop reading more files. Output the full report now. Format: BLOCKING / SHOULD-FIX /
NICE-TO-HAVE / VERDICT."):
- Correctness: every deliverable and acceptance item actually landed; sanitize truly never
  destroys items (hostile shapes, unknown ids, over-capacity); capacity table indexed
  safely at both ends; stamp lifecycle complete (join, leave, kick, disband, rank change).
- Test coverage: decisive assertions, per-dimension negative cases, no
  constant-self-comparison pins; determinism assertion present for the new sim logic.
- Dead code and cleanup: unused exports/imports, sim import invariant, naming consistency
  with bank.ts.
- Per the dispatch matrix: architecture-reviewer, cross-platform-sync, qa-checklist.
STEP 3: fix all BLOCKING and SHOULD-FIX; rerun the Phase 1 validation rows; commit fixes
separately, explicit paths.
STEP 4: update progress.md (Phase 1 QA complete) and state.md drift; memory notes.
STEP 5: (not final; no teardown.)
STEP 6: end with QA verdict (PASS / PASS-WITH-FOLLOWUPS / FAIL), counts, deferred items,
one-line handoff to Phase 2.
```
