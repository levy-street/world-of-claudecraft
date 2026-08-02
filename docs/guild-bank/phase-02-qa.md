# Phase 2 QA: verify ops and wire

### QA starter prompt
```
This is Phase 2 QA of the Guild Bank feature.

Model: newest available Claude coding model, xhigh effort. Harness: Claude Code.
Worktree: /Users/seanghods/repos/world-of-claudecraft-guild-bank.
ULTRACODE: this is a high-risk phase (economy mutation paths); optionally add `ultracode`
to run an adversarial-verify Workflow over the findings.

Goal: audit Phase 2 (op bodies, gating, wire) with emphasis on exploit paths and refusal
completeness.

STEP 0: git status clean; memory scan.
STEP 1: Explore agent summarizes state.md ledger, progress.md Phase 2 checklist,
phase-02-ops-and-wire.md, and the Phase 2 diff.
STEP 2: parallel review agents (COVERAGE not filtering; standard truncation resume):
- Correctness/exploit: attempt to construct a mint or dupe on paper: double-dispatch of
  one command in a tick, deposit+withdraw interleavings, stale-rank windows, capacity
  scratch-vs-real divergence (the trade fitsAfterSwap issue class), treasury cap edge at
  exactly the cap, withdrawal overflowing player copper, instanced-stack splitting.
- Test coverage: a decisive negative test per refusal dimension on every op; snapshot
  null-transition tests; determinism assertion present.
- Dead code and cleanup; sim import invariant.
- Carried forward from Phase 1 QA (acceptance lines, each verified explicitly):
  no `guildBank*` method body in `src/net/online.ts` is empty (all five Phase 1
  stubs filled with real sends); every leave/kick/disband call site pairs
  `setPlayerGuild` with `setPlayerGuildMembership` (or uses one combined entry
  point), and join plus every rank change re-stamps; re-audit the
  `guildMembership` parity-trace exclusion now that the officer gate reads it.
- Per the dispatch matrix: architecture-reviewer, cross-platform-sync,
  privacy-security-review, qa-checklist.
STEP 3: fix all BLOCKING and SHOULD-FIX; rerun the Phase 2 validation rows; commit fixes
separately, explicit paths.
STEP 4: update progress.md and state.md; memory notes.
STEP 5: (not final; no teardown.)
STEP 6: end with QA verdict, counts, deferred items, one-line handoff to Phase 3.
```
