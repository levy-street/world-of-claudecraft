# Phase 05 QA: verify the jewelcrafting base catalog

### QA Starter Prompt
```
This is Phase 05 QA of the Masterwrought feature.

Model: xhigh effort. Harness: Claude Code. Worktree: ~/Documents/wocc-masterwrought.

Goal: audit the Phase 05 catalog before the intermediates (phase 07) and apex jewelry
(phase 09) build on the profession. Audit emphasis (the phase's QA focus): no rating
allocations beyond same-band vendor jewelry (R14); itemization coverage tests;
profession XP curve sanity on the new rungs.

STEP 0 - PRE-FLIGHT: git status clean (Phase 05 committed); SYNC RELEASE per the
canonical workflow (fetch, merge newest origin/release/**, release-merge-audit). Memory
scan: test-pin trap index (READ before judging any pin), content/economy pin gotchas.

STEP 1 - LOAD CONTEXT (Explore agent): state.md (R10, R13, R14, R15, the recorded
station decision, power placement numbers), progress.md Phase 05 checklist,
phase-05-jewelcrafting-base.md (what was promised), git diff against the phase-start
commit, src/sim/content/recipes.ts + src/sim/content/professions.ts arms the diff
touched, and every other touched file.

STEP 2 - QA AUDIT (parallel agents, COVERAGE not filtering):
Budget agent: recompute every new item's budget from primaryStatBudget at the
recipe-derived ilvl by hand for a sample of each rung and confirm EXACT equality; confirm
NO rating allocation on any base-rung piece beyond the same-band vendor jewelry (R14:
pure primary stats + stamina); the recipe_economy exception list is still EMPTY.
Coverage agent: itemization coverage tests pass and actually see the new pieces; every
recipe's inputs exist (ores, salvage gems, vendor flux rows all resolvable); every recipe
has a trainer row with a tier-table fee; every item has an icon row and an English name;
wiki regenerated and fresh.
Progression agent: profession XP curve sanity on the new rungs (skill-up pacing 0 to 50
comparable to a model profession; no rung starves or trivializes skill gain); station
decision recorded in state.md matches what the code does.
Test-decisiveness agent: pins fail on regression (would inflating one budget by a point
fail a test? would a rating stat on a base ring?); no constant-self-comparison pins;
new ids append-only against the frozen-id golden.
Dispatch per the Review Dispatch Matrix: frontend-seam-reviewer, plus qa-checklist
(phase-completion gate); architecture-reviewer only if station LOGIC landed in sim.

STEP 3 - FIX: apply ALL findings (blocking, should-fix, nits); rerun the Phase 05
validation set; separate fix commits with explicit paths. The fix round is itself
unreviewed code: have a fresh reviewer pass over the fix diff.

STEP 4 - DOCS: progress.md (Phase 05 QA row), state.md drift, memory notes.

STEP 5 - REPORT: PASS / PASS-WITH-FOLLOWUPS / FAIL, counts found and fixed, handoff to
Phase 06. Follow-ups are CUT-or-fix decisions, never future-PR items.
```
