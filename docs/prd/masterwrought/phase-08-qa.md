# Phase 08 QA: verify the apex armor catalogs

### QA Starter Prompt
```
This is Phase 08 QA of the Masterwrought feature.

Model: xhigh effort. Harness: Claude Code. Worktree: ~/Documents/wocc-masterwrought.

Goal: audit the Phase 08 armor catalogs for audit-first ordering, budget exactness,
stat-shape sanity, and decisive pins before phase 09 extends the sweep.

WORKTREE GUARD (do this FIRST; the user runs multiple concurrent sessions): run pwd.
If you are not in /Users/fernando/Documents/wocc-masterwrought, switch this session into
it NOW with the EnterWorktree tool (path: /Users/fernando/Documents/wocc-masterwrought).
If EnterWorktree is unavailable or refuses, STOP and ask the user to relaunch Claude Code
from that directory. Phase work never runs from the main checkout at
~/Documents/world-of-claudecraft.

STEP 0 - PRE-FLIGHT: git status clean (Phase 08 committed); SYNC RELEASE per the
canonical workflow (fetch, merge newest origin/release/**, release-merge-audit). Memory
scan: test-pin trap index (READ before judging any pin), frozen-id golden gotchas.

STEP 1 - LOAD CONTEXT (Explore agent): state.md (R2, R8, R12, R13, R14, power placement,
the recorded slot audit and reagent quantities), progress.md Phase 08 checklist,
phase-08-apex-armor.md (what was promised), git diff against the phase-start commit,
tests/masterwrought_budget.test.ts, and every file the diff touched.

STEP 2 - QA AUDIT (parallel agents, COVERAGE not filtering):
Ordering agent: git history proves the slot audit landed in state.md BEFORE any item
row; the shipped slot picks match the audit's verdict (or the recorded reason they
deviate); the open-items ledger line is closed.
Correctness agent: 9 pieces + bag present; recipe.level 25 / epic / skillReq 100 /
masterwrought: true on all 9 and absent on the bag; acquisition per R8 with no trainer
row; reagents match the state.md quantities and the phase 07 demand math; tradable (R2);
standard disenchant (R12); R14 swept adversarially (no proc, effect, or on-use field on
ANY new def).
Stat-shape agent: per-piece audit against the Lionheart/Lariat rule (no scarce-stat
outlier, no stat-light slot carrying an outsized rating load); every rating allocation
pinned against a named same-band raid or heroic-vendor equivalent.
Test-decisiveness agent: the sweep test fails if any piece's primary sum drifts by one
point; every phase 08 item is IN the sweep (adversarial: grep the defs against the
test's item list); no constant-self-comparison pins; frozen-id and English-name gates
green.
Cleanup agent: no dead code, no unused imports, no accidental sim logic in the data
tables.
Dispatch per the Review Dispatch Matrix: qa-checklist (phase-completion gate);
architecture-reviewer only if the diff holds non-data sim logic.

STEP 3 - FIX: apply ALL findings (blocking, should-fix, nits); rerun the Phase 08
validation set; separate fix commits with explicit paths. The fix round is itself
unreviewed code: have a fresh reviewer pass over the fix diff.

STEP 4 - DOCS: progress.md (Phase 08 QA row), state.md drift, memory notes.

STEP 5 - REPORT: PASS / PASS-WITH-FOLLOWUPS / FAIL, counts found and fixed, handoff to
Phase 09. Follow-ups are CUT-or-fix decisions, never future-PR items.
```
