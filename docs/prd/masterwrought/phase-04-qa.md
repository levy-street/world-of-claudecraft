# Phase 04 QA: verify the materials backbone

### QA Starter Prompt
```
This is Phase 04 QA of the Masterwrought feature.

Model: xhigh effort. Harness: Claude Code. Worktree: ~/Documents/wocc-masterwrought.

Goal: audit the Phase 04 implementation before the intermediates and apex recipes consume
these materials. Audit emphasis (the phase's QA focus): draw-order neutrality of grants;
DB JSONB back-compat; the rift gate cannot be farmed across portal cycles; retention
story for any new server table (none expected).

STEP 0 - PRE-FLIGHT: git status clean (Phase 04 committed); SYNC RELEASE per the
canonical workflow (fetch, merge newest origin/release/**, release-merge-audit). Memory
scan: test-pin trap index (READ before judging any pin), daily-gate and cooldown-persist
gotchas, JSONB back-compat, draw-order entries.

STEP 1 - LOAD CONTEXT (Explore agent): state.md (R4, R9, recorded prices/yields),
progress.md Phase 04 checklist, phase-04-materials-backbone.md (what was promised),
git diff against the phase-start commit, src/sim/instances/dungeons.ts and every file the
diff touched.

STEP 2 - QA AUDIT (parallel agents, COVERAGE not filtering):
Correctness agent: every deliverable present; core drops per-participant on every listed
final-boss route; extraction refuses non-raid-sourced epics via the source-level check;
Ember grants exactly once per week from ANY of the three pillars and accrues when missed;
quartermaster row priced and recorded; offline Sim and online ClientWorld identical.
Draw-order agent: every new rng draw site goes through ctx.rng at a documented position
and APPENDS to the sequence; the parity suite actually covers a scenario that exercises
the new draws; no pre-existing draw sequence shifted.
Gate-abuse agent: the rift daily gate survives portal cycles, re-entry, logout/login, and
rank-reroll attempts (a second A/S first clear the same day never double-grants); the
weekly boundary cannot be gamed by clock edges the sim does not own.
Persistence agent: new PlayerMeta/CharacterState fields are optional with defaults; an
old-shape save loads without throwing; round-trip pinned; no new unbounded server table
(if one exists, it has a retention story).
Test-decisiveness agent: each pin fails on regression (would removing the daily gate fail
a test? would granting Ember twice a week?); negative cases per faucet; no
constant-self-comparison pins.
Dispatch per the Review Dispatch Matrix: architecture-reviewer + cross-platform-sync +
migration-safety, plus qa-checklist (phase-completion gate).

STEP 3 - FIX: apply ALL findings (blocking, should-fix, nits); rerun the Phase 04
validation set including parity; separate fix commits with explicit paths. The fix round
is itself unreviewed code: have a fresh reviewer pass over the fix diff.

STEP 4 - DOCS: progress.md (Phase 04 QA row), state.md drift, memory notes.

STEP 5 - REPORT: PASS / PASS-WITH-FOLLOWUPS / FAIL, counts found and fixed, handoff to
Phase 05. Follow-ups are CUT-or-fix decisions, never future-PR items.
```
