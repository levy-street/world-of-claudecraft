# Phase 02 QA: Verify Masterwork model

Audit the Phase 02 masterwork model for correctness, test coverage, determinism, three-host
parity, and cleanup, then fix what the audit finds before Phase 3 begins.

## Phase-specific QA emphasis

- Rng draw-order regression across a craft sequence: replay a fixed-seed sequence of mixed
  crafts (with and without self-signed reagents, above and below the 75-skill threshold) and
  confirm outputs and proc occurrences are identical run to run; confirm the draw-order pin
  fails when an extra draw is inserted.
- The raid-floor bound test actually binds: raise the +1 quality-tier budget bump locally and
  confirm the bound test fails, then revert. A bound test that cannot fail is a defect.
- Legacy-instance load path: an instance persisted with the old `rolled.quality` loads,
  tooltips, and equips with no stat change and no crash, in both hosts.

## QA Starter Prompt

```
This is Phase 02 QA of the Professions 2.0 feature: Verify Masterwork model.

Model: Opus 4.8, xhigh effort. Harness: Claude Code.

Goal: audit the Phase 02 change for correctness, missing tests, dead code, determinism,
three-host parity, and i18n completeness for this phase, then fix what the audit finds.

STEP 0 - PRE-FLIGHT:
- Confirm git status is clean (a concurrent session may share the checkout); stop and report
  if it is not.
- Scan Claude Code memory (the MEMORY.md index) for phase-relevant entries, at minimum:
  node25-breaks-jsdom-gate (run the gate under Node 24), the PR 2039 merge state, and
  combo-recipes-broken-online (the #2033 liveness trap for mirrored state).

STEP 1 - LOAD CONTEXT (do NOT read planning docs directly):
Spawn one Explore agent to read and summarize:
- docs/professions-2/state.md and docs/professions-2/progress.md
- docs/professions-2/phase-02-masterwork-model.md (deliverables and acceptance criteria)
- the git diff against the phase-start commit recorded in progress.md (name every touched
  file)
The summary must return: each Phase 02 deliverable and acceptance criterion paired with where
the diff claims to satisfy it; the locations of the proc module, the rng draw-order pin, the
raid-floor bound test, and the event mirror path in both hosts; the phase validation
commands from state.md's sim-only matrix row.

STEP 2 - QA AUDIT:
Fan out three agents in parallel, each with ONLY the Explore summary. Prompt each for
COVERAGE, not filtering: report every gap with confidence and severity; this session filters.

Agent correctness deliverables:
- Verify every deliverable and acceptance criterion against the real code, not the phase
  file's claims or the commit messages.
- Run the phase validation commands: npx tsc --noEmit; npx vitest run
  tests/professions_crafting.test.ts tests/professions_rarity_roll.test.ts
  tests/archetype_ceiling.test.ts tests/deeds.test.ts tests/item_instance.test.ts
  tests/architecture.test.ts; plus the net/wire row (tests/snapshots.test.ts,
  tests/world_api_parity.test.ts) if the diff touches src/net or a wire key.
- Exercise the real behavior: a fixed-seed craft sequence run twice must match, including
  proc occurrences; a forced proc yields rolled.masterwork plus rolled.stats that apply on
  equip via recalcPlayerStats; the deeds reader result for a masterwork item is coherent.
- Probe the phase emphasis items: the rng draw-order regression across a mixed craft
  sequence; prove the raid-floor bound test binds (raise the budget bump locally, watch the
  test fail, revert); walk the legacy rolled.quality load path end to end in both hosts.

Agent test-coverage deliverables:
- Find untested paths: the proc-chance table edges (recipe tier parity, each bonus term, the
  15 percent cap, the 75-skill threshold boundary), self-signed reagent detection, the
  masterwork SimEvent mirror, save/load of rolled.masterwork.
- Add missing tests, including a determinism test if sim logic changed and one is missing.
- Remove orphaned tests still pinning the five-way roll or trivialAt.

Agent dead-code-and-cleanup deliverables:
- Unused imports, types, and content fields left behind by the trivialAt and quality-roll
  removal, across src/sim/professions/ and src/sim/content/recipes.ts.
- Sim purity: no DOM/Three imports, no Math.random, Date.now, or performance.now, all
  randomness via Rng.
- Leftover TODOs and debug remnants in the phase's diff.

Also: spawn review agents per the Review Dispatch Matrix in
docs/professions-2/implementation-plan.md; check git diff --name-only and spawn ONLY matching
rows; and run the qa-checklist agent over the phase diff, since the deliverable set is
complete. Prompt all of them for COVERAGE, not filtering.
If any agent response comes back truncated, re-spawn that agent with a narrower scope and
merge the results; never accept a truncated report as complete.

STEP 3 - FIX:
- Apply every BLOCKING and SHOULD-FIX finding; defer only with a written reason.
- Rerun the STEP 2 validation commands until green.
- Commit with explicit paths (never git add -A), Conventional Commits with a scope and a
  body, for example fix(professions): ... or test(professions): ... .

STEP 4 - UPDATE DOCS + MEMORY:
- Update docs/professions-2/progress.md: the Phase 2 QA status row, checklist deltas, and
  notes on deferrals.
- Update docs/professions-2/state.md if any surface changed during fixes.
- Record any surprises to Claude Code memory.

STEP 5 - FINAL RESPONSE FORMAT:
Verdict: PASS, PASS-WITH-FOLLOWUPS, or FAIL; counts of BLOCKING, SHOULD-FIX, and deferred
findings; the deferral list with reasons; one line handing off to Phase 3
(phase-03-parity-bug-fixes.md).

STOPPING RULES:
- Stop and ask the maintainer if a fix would redefine deed semantics to keep the deeds
  reader coherent; that is a maintainer call.
- Stop and ask if a fix would change a locked decision in state.md.
```
