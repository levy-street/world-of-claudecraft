# Phase 10 QA: Verify Recipe ladders and materials content

Audit the Phase 10 content drop: the six tier ladders, the material families, the corpse
component collision fix, and the pinned economy invariant.

## Phase-specific QA emphasis

- Cross-craft material demand sanity: every gathered or harvested material (Phase 4 node
  yields, the new corpse components, fiber and cloth) has at least one consuming recipe;
  flag every orphan material.
- The collision fix must not break existing quest saves mid-objective: exercise a save that
  holds old quest items with a quest partially counted, load it, and verify credit
  continues correctly.
- Count the ladders against the `state.md` craft list: exactly the six deep crafts get
  ladders (engineering is the toolmaker line, not a seventh ladder; jewelcrafting,
  inscription, and enchanting stay shallow).
- Economy invariant decisiveness: the test must enumerate EVERY recipe (not a sample) and
  price vendor reagents at their purchase price, not their sell price.
- The 2026-07-17 amendment deliverables: every rare recipe consumes at least one
  lower-tier material family (cross-tier composition); cooking and alchemy carry
  combat-worthy consumables at EVERY tier; the perfect specimen component rides
  rollCorpseMaterialRarity and is always signed at rare+; and the materialTierBonus hook
  is wired with pinned values at the crafting.ts call site (higher-tier materials raise
  the proc chance, the cap and the drawCounts pins stay green).

## QA Starter Prompt

```
This is Phase 10 QA of the Professions 2.0 feature: Verify Recipe ladders and materials
content.

Model: Opus 4.8, xhigh effort (reserve max for genuinely frontier problems), 1m context
variant where the file load demands it.
Harness: Claude Code.
ULTRACODE: this phase was a batch content drop across hundreds of records; add the keyword
`ultracode` so you can run an adversarial-verify Workflow (each finding independently
confirmed by a skeptic agent before it counts).

Goal: audit the Phase 10 implementation for correctness, missing tests, dead code,
determinism, three-host parity, and i18n completeness.

STEP 0 - PRE-FLIGHT:
- Verify git status is clean (Phase 10 should already be committed). If dirty, ask the
  user (a concurrent session may share this checkout).
- Memory scan (if you use Claude Code memory): check entries from the professions domain
  (suggested topics: node25-breaks-jsdom-gate for the gate rule, PR 2039 state,
  combo-recipes-broken-online for the 2033 stub trap).

STEP 1 - LOAD CONTEXT (do NOT read planning docs directly, save your context):
Spawn an Explore agent to read and summarize:
- docs/professions-2/state.md (locked decisions, validation matrix, the Phase 10 entry in
  New surfaces: material item families, ladder locations, the economy test path)
- docs/professions-2/progress.md (the Phase 10 deliverables checklist and acceptance
  criteria)
- docs/professions-2/phase-10-recipe-ladders.md (the implementation prompt: what was
  promised, including the acceptance criteria and stopping rules)
- git diff against the Phase 10 start commit (git diff --name-only first, then the
  substantive files: src/sim/content/recipes.ts, src/sim/content/items.ts,
  src/sim/content/professions.ts, src/ui/i18n.catalog/items.ts, the new tests)
- CLAUDE.md (root) + src/sim/CLAUDE.md + src/ui/CLAUDE.md + src/guide/CLAUDE.md
The agent must return: the full Phase 10 deliverable list, every file created or
modified, the new material and fish item ids, the ladder recipe counts per craft, the
economy test path, and any deferrals noted in progress.md.

STEP 2 - QA AUDIT (spawn three parallel agents using the Explore summary; prompt each for
COVERAGE not filtering: report every issue including low-severity and uncertain ones;
ranking happens in a later step):

Correctness agent:
- Verify every Phase 10 deliverable was actually implemented and every acceptance
  criterion in the phase prompt is met.
- Run the phase's validation commands: npx tsc --noEmit; npx vitest run
  tests/progression.test.ts tests/professions_crafting.test.ts
  tests/mob_component_tags.test.ts tests/localization_fixes.test.ts; the economy
  invariant test; npm run i18n:gen + npx vitest run tests/i18n_completeness.test.ts;
  npm run wiki:content.
- Exercise the real behavior, not just the tests: train a new recipe at its master and
  craft it end to end in the sim (materials consumed, output produced, fee charged);
  harvest a corpse and confirm the dedicated material drops while quest credit still
  flows only from the correct mobs.
- Probe the phase-specific emphasis items: every gathered material has a consumer
  (flag orphans); an existing quest save mid-objective with old quest items still
  progresses after the collision fix; the ladder count matches the state.md craft list
  exactly (six deep crafts, engineering excluded); the economy test enumerates every
  recipe and prices vendor reagents at purchase price.
- Verify no pre-existing recipe changed in cost or output, and no ItemDef players may
  hold was deleted.

Test coverage agent:
- Identify new content paths without tests: untested ladders, tiers, training links,
  material mappings, and the fish forward references.
- Add missing tests, including a determinism test (same seed, same result) if any sim
  logic changed alongside the content (crafting resolution, harvest yields).
- Verify the economy invariant and referential integrity suites are decisive: they fail
  on a seeded bad record, not just pass on the current data.
- Update existing tests broken by Phase 10; remove orphaned tests for replaced
  placeholder content. Verify assertions are meaningful, not just "it runs".

Dead code and cleanup agent:
- Find unused imports, types, helper functions, and leftover placeholder records from the
  pre-ladder recipe tables.
- Verify sim purity: src/sim/ has no DOM/Three imports, imports nothing from
  render/ui/game/net, and all randomness goes through Rng.
- Verify no TODO/FIXME items were left unresolved and no commented-out code remains;
  check naming consistency with the existing content tables.

Multi-agent review dispatch: apply the Review Dispatch Matrix in
docs/professions-2/implementation-plan.md; check git diff --name-only against the
phase-start commit and spawn ONLY the agents whose row matches, plus qa-checklist (this
is the phase-completion QA gate). Prompt each for COVERAGE not filtering.
Resume any agent that truncates mid-analysis with: "Stop reading more files. Output the
full report now based on what you've already seen. No more tool calls. Format:
BLOCKING / SHOULD-FIX / NICE-TO-HAVE / VERDICT."

STEP 3 - FIX:
Apply all BLOCKING and SHOULD-FIX items. Rerun the validation matrix rows from state.md
(at minimum npx tsc --noEmit, the four vitest files above, the economy test, and
npm run wiki:content). Commit fixes separately from the QA verdicts so the history is
reviewable; EXPLICIT paths, never git add -A; Conventional Commits with a body.

STEP 4 - UPDATE DOCS + MEMORY:
- Update docs/professions-2/progress.md (mark Phase 10 QA complete; note items deferred
  to follow-up).
- Update docs/professions-2/state.md (any drift discovered during QA: corrected item ids,
  test paths, ladder counts).
- If you use Claude Code memory, record any surprising rules learned during QA.

STEP 5 - FINAL RESPONSE FORMAT:
End your turn with: QA verdict (PASS / PASS-WITH-FOLLOWUPS / FAIL), counts of BLOCKING /
SHOULD-FIX / NICE-TO-HAVE found and fixed, deferred items, and a one-line handoff for the
Phase 11 implementation session.

STOPPING RULES:
- Stop and surface to the user if any BLOCKING item cannot be fixed without changing the
  phase scope (for example, a material whose only viable source turns out to be wave-2
  content, or a collision fix that cannot preserve existing quest saves).
```
