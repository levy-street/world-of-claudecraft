# Phase 07 QA: verify the intermediates and the Quickening Catalyst

### QA Starter Prompt
```
This is Phase 07 QA of the Masterwrought feature.

Model: xhigh effort. Harness: Claude Code. Worktree: ~/Documents/wocc-masterwrought.

Goal: audit the Phase 07 implementation for correctness, decisive tests, gate
persistence, and the recorded demand math before phases 08/09 author against it.

WORKTREE GUARD (do this FIRST; the user runs multiple concurrent sessions): run pwd.
If you are not in /Users/fernando/Documents/wocc-masterwrought, switch this session into
it NOW with the EnterWorktree tool (path: /Users/fernando/Documents/wocc-masterwrought).
If EnterWorktree is unavailable or refuses, STOP and ask the user to relaunch Claude Code
from that directory. Phase work never runs from the main checkout at
~/Documents/world-of-claudecraft.

STEP 0 - PRE-FLIGHT: git status clean (Phase 07 committed); SYNC RELEASE per the
canonical workflow (fetch, merge newest origin/release/**, release-merge-audit). Memory
scan: test-pin trap index (READ before judging any pin), daily-reset and cooldown
persistence gotchas.

STEP 1 - LOAD CONTEXT (Explore agent): state.md (R13, R15, the new mapping and demand
math), progress.md Phase 07 checklist, phase-07-intermediates.md (what was promised),
git diff against the phase-start commit, src/sim/professions/node_persist.ts,
src/sim/professions/crafting.ts, and every file the diff touched.

STEP 2 - QA AUDIT (parallel agents, COVERAGE not filtering):
Correctness agent: all ten intermediate rows present and matching the state.md mapping;
each consumes gathered mats + 1 Catalyst; trainer wiring at 75 (R13); the Catalyst gate
is reachable from the REAL craft path in both hosts, survives logout, cannot be reset by
re-log or portal cycling, and reads sim time (never Date.now); refusal line emits and
the matcher covers it.
Test-decisiveness agent: would deleting the daily gate fail a test; negative cases per
dimension (second craft same day refused, next day allowed, save/load round-trip); no
constant-self-comparison pins; the economy rows fail on a reagent change.
Consistency agent: the demand math in state.md is arithmetically coherent (intermediates
per apex piece vs one catalyst per day: the time gate actually gates); every
intermediate has a named phase 08/09/10 consumer; names web-verified per R15; ids
append-only in the golden.
Cleanup agent: no dead code, no unused imports, sim purity intact, masterwork.ts and the
XP tables untouched.
Dispatch per the Review Dispatch Matrix: architecture-reviewer, migration-safety if a
JSONB shape changed, plus qa-checklist (phase-completion gate).

STEP 3 - FIX: apply ALL findings (blocking, should-fix, nits); rerun the Phase 07
validation set; separate fix commits with explicit paths. The fix round is itself
unreviewed code: have a fresh reviewer pass over the fix diff.

STEP 4 - DOCS: progress.md (Phase 07 QA row), state.md drift, memory notes.

STEP 5 - REPORT: PASS / PASS-WITH-FOLLOWUPS / FAIL, counts found and fixed, handoff to
Phase 08. Follow-ups are CUT-or-fix decisions, never future-PR items.
```
