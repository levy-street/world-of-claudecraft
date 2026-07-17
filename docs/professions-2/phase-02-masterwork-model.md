# Phase 02: Masterwork model

This phase replaces the five-way output quality roll with deterministic craft outputs plus a
single celebrated masterwork proc whose bonus stats are baked from the item budget. It is its
own slice because it rewrites the output-side RNG contract of crafting: every later phase
(node materials in Phase 4, the crafting window and celebrations in Phase 6, recipe ladders in
Phase 10, deeds and tuning in Phase 15) builds on deterministic outputs, so this contract must
land and be pinned before content phases pin recipes against it.

## Context pointers

- `docs/professions-2/state.md`: the locked masterwork decision (Locked design decisions), the
  proc tuning targets (Tuning targets section), and the sim-only validation matrix row.
- `docs/professions-2/progress.md`: the Phase 2 checklist and any Phase 1 notes.
- `docs/professions-2/implementation-plan.md`: team workflow and the Review Dispatch Matrix.
- `src/sim/professions/crafting.ts`: `resolveCraftForRecipe` quality path, the five-way roll
  to retire.
- `src/sim/professions/gathering.ts`: `rollMaterialRarity`, input-side RNG that stays untouched.
- `src/sim/item_budget.ts`: `primaryStatBudget`, `normalizePrimaryStats`.
- `src/sim/types.ts`: `ItemInstancePayload.rolled`.
- `src/sim/professions/types.ts`: `trivialAt`, to be removed.
- `src/sim/deeds.ts`: the rolled-quality reader that must stay coherent.
- `src/sim/content/recipes.ts`: recipe records carrying `trivialAt`.
- Tests pinning the old behavior: `tests/professions_crafting.test.ts`,
  `tests/professions_rarity_roll.test.ts`, `tests/archetype_ceiling.test.ts`,
  `tests/deeds.test.ts`, `tests/item_instance.test.ts`.
- Local conventions: the root `CLAUDE.md`, `src/sim/CLAUDE.md`, `tests/CLAUDE.md`.

## Starter Prompt

```
This is Phase 02 of the Professions 2.0 feature: Masterwork model.

Model: Opus 4.8, xhigh effort. Harness: Claude Code.

Goal: replace the five-way output quality roll with deterministic craft outputs plus a
masterwork proc whose bonus stats are baked from the item budget.

STEP 0 - PRE-FLIGHT:
- Sync with the LATEST release branch FIRST: git fetch origin "+refs/heads/release/*:refs/remotes/origin/release/*"; pick
  the newest by version sort (git branch -r --list "origin/release/*" | sort -V | tail -1). If this phase
  starts a fresh branch or worktree, base it on that branch; if the feature branch already exists, merge
  that release branch into it NOW, resolve conflicts, and run the release-merge-audit skill on the merge
  before proceeding. Never base work on main or an older release branch than the newest.
- Confirm git status is clean (a concurrent session may share the checkout); stop and report
  if it is not.
- Scan Claude Code memory (the MEMORY.md index) for phase-relevant entries, at minimum:
  node25-breaks-jsdom-gate (run the gate under Node 24), the PR 2039 merge state (the Phase 1
  foundation this phase builds on), and combo-recipes-broken-online (the #2033 ClientWorld
  stub trap: verify liveness when mirroring anything online, not just member shape).

STEP 1 - LOAD CONTEXT (do NOT read planning docs directly):
Spawn one Explore agent to read and summarize:
- docs/professions-2/state.md (locked masterwork decision, tuning targets, validation matrix)
- docs/professions-2/progress.md (Phase 2 checklist, Phase 1 notes)
- docs/professions-2/phase-02-masterwork-model.md (this phase file)
- src/sim/professions/crafting.ts (the resolveCraftForRecipe quality path)
- src/sim/professions/gathering.ts (rollMaterialRarity, input-side, stays)
- src/sim/item_budget.ts (primaryStatBudget, normalizePrimaryStats)
- src/sim/types.ts (ItemInstancePayload.rolled)
- src/sim/professions/types.ts (trivialAt)
- src/sim/deeds.ts (the rolled-quality reader)
- src/sim/content/recipes.ts (recipe records carrying trivialAt)
- CLAUDE.md files: the root one, src/sim/CLAUDE.md, tests/CLAUDE.md
The summary must return: the locked masterwork decision and the tuning targets verbatim; where
the five-way output quality roll happens and every Rng draw on the craft path in draw order;
the ItemInstancePayload.rolled shape and every reader of rolled.quality (deeds, tooltips,
recalcPlayerStats, save/load); the exact signatures of primaryStatBudget and
normalizePrimaryStats and how quality tiers map to budget; the existing SimEvent emit plus
wire mirror pattern to copy; every test file that pins the old roll or trivialAt; the sim-only
validation matrix row from state.md.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE:
Fan out three agents in parallel; give each ONLY the Explore summary, never the planning docs.
Use worktree isolation only if two agents must edit the same file.

Agent sim (proc module plus crafting path) deliverables:
- New pure module src/sim/professions/masterwork.ts: proc chance computed from craft skill,
  any self-signed reagent, and the 75-skill specialization threshold, per the tuning targets
  in state.md (base 3 percent at recipe tier parity, +1 percent per skill tier above,
  +2 percent with any self-signed reagent, +3 percent at the 75-skill specialization
  threshold, cap 15 percent). Exactly one Rng draw decides the proc; the draw order on the
  craft path is pinned by test.
- Craft outputs become deterministic: every craft yields the recipe's declared output. The
  five-way output quality roll is retired from the craft path only; input-side
  rollMaterialRarity in gathering.ts is untouched.
- trivialAt removed from ProfessionRecipeRecord and from all content in
  src/sim/content/recipes.ts; no consumer remains anywhere.
- A masterwork SimEvent with an id-based payload (recipe id, item id, crafter) emitted on
  proc and mirrored into ClientWorld state for Phase 6 to render; the mirror must be live in
  BOTH hosts (the #2033 trap: no dead stubs).

Agent instance/stats (budget baking plus reader coherence) deliverables:
- On proc, the crafted instance gains rolled.masterwork plus rolled.stats baked via
  primaryStatBudget with a +1 quality-tier budget bump; the result stays bounded below the
  raid floor band, and a test asserts the bound.
- Equip path: masterwork stats on the instance apply through recalcPlayerStats.
- The deeds item-discovery reader stays coherent: masterwork maps into its quality-tier read,
  or the reader is updated with its own test. Do not change deed semantics.
- Legacy instances with the old rolled.quality still load, tooltip, and equip correctly
  (normalize-on-load, additive JSONB).

Agent tests deliverables:
- Re-pin every test that pinned the old five-way roll or trivialAt.
- Determinism test: the same seed over a craft sequence yields identical outputs, including
  proc occurrences (the rng draw-order pin).
- The raid-floor bound test, the legacy rolled.quality load/tooltip test, and a parity test
  for the masterwork SimEvent mirror.

INVARIANTS THIS PHASE MUST KEEP:
- Determinism: all randomness through Rng, exactly one proc draw, draw order pinned; never
  Math.random, Date.now, or performance.now in sim code.
- IWorld/event parity: everything mirrored online lands live in BOTH Sim and ClientWorld,
  parity pinned in the same change; verify liveness, not just member shape.
- Server authority: the proc resolves server-side online; the client only renders.
- i18n: sim and server stay language-agnostic; the masterwork event carries ids only. Any
  player-visible text this phase would emit follows the S3 matcher duty in the same change
  (expected: none; all text is Phase 6).
- Prime directive: nothing existing breaks. Existing instances with old rolled.quality still
  load and tooltip correctly; never delete an ItemDef players may hold.

Out of scope (do NOT do in this phase):
- Any UI: the toast, zone-chat broadcast, and tooltip work are Phase 6.
- Material-tier proc inputs: they need Phase 4 materials; leave a named hook and record it as
  a Phase 10 hook in state.md.

STEP 3 - VALIDATION + MULTI-AGENT REVIEW:
- Run the sim-only validation matrix row from state.md: npx tsc --noEmit, the affected
  suites, tests/architecture.test.ts, and the determinism check.
- Explicitly: npx vitest run tests/professions_crafting.test.ts
  tests/professions_rarity_roll.test.ts tests/archetype_ceiling.test.ts tests/deeds.test.ts
  tests/item_instance.test.ts tests/architecture.test.ts
- If the diff touches src/net or a wire key for the event mirror, also run the net/wire row:
  npx vitest run tests/snapshots.test.ts tests/world_api_parity.test.ts
- Spawn review agents per the Review Dispatch Matrix in
  docs/professions-2/implementation-plan.md; check git diff --name-only and spawn ONLY
  matching rows (expected here: architecture-reviewer, cross-platform-sync, and qa-checklist
  once the deliverable set is complete).
- Prompt every review agent for COVERAGE, not filtering: report every correctness or
  requirement gap with confidence and severity; filtering happens afterward in this session.
- If any agent response comes back truncated, re-spawn that agent with a narrower scope and
  merge the results; never accept a truncated report as complete.
- No commit while any BLOCKING finding stands.

STEP 4 - COMMIT CADENCE:
Commit in slices with explicit paths (never git add -A); every commit carries a body:
- feat(professions): add the masterwork proc module
- feat(professions): bake budget-bounded masterwork stats into crafted instances
- chore(professions): retire the output quality roll and trivialAt

STEP 5 - ACCEPTANCE CRITERIA (do not mark complete until all check):
- [ ] Same seed, same outputs across a craft sequence, including proc occurrences.
- [ ] A masterwork's stats live on the instance (rolled.masterwork, rolled.stats) and apply
      on equip via recalcPlayerStats.
- [ ] The five-way output quality roll is gone from the craft path; rollMaterialRarity for
      gathering inputs is untouched; no consumer of trivialAt remains.
- [ ] The masterwork SimEvent is emitted on proc and mirrored live into ClientWorld state.
- [ ] The raid-floor bound is asserted by a test that actually binds.
- [ ] Legacy instances with rolled.quality load, tooltip, and equip unchanged.
- [ ] The STEP 3 validation commands are green.

STEP 6 - DOC UPDATES + MEMORY:
- Update docs/professions-2/progress.md: the Phase 2 status row and the Phase 2 checklist
  mirror; record the phase-start and final commit hashes in the notes section so the QA
  session can diff the phase.
- Update docs/professions-2/state.md: move the Phase 2 entry under "New surfaces per phase"
  from planned to landed, naming the masterwork SimEvent and its payload shape, the
  instance.rolled.masterwork field, the rng draw-order pin test, the trivialAt removal, the
  files created (src/sim/professions/masterwork.ts), and the named Phase 10 hook for
  material-tier proc inputs.
- Record any surprises to Claude Code memory.

STEP 7 - FINAL RESPONSE FORMAT:
Phase status; files touched; validation results (each command, pass or fail); review agent
verdicts; deferrals with reasons; one line handing off to phase-02-qa.md.

STOPPING RULES:
- Stop and ask the maintainer if the deeds reader cannot stay coherent without redefining
  deed semantics; that is a maintainer call.
- Stop and ask if any deliverable would require changing a locked decision in state.md.
```
