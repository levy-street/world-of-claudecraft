# Phase 10: Recipe ladders and materials content

This phase turns the six deep crafts into real progressions: common to rare tier ladders that
consume the Phase 4 node materials, corpse components, fish, and vendor reagents, backed by a
pinned economy invariant so no recipe ever vendors above its inputs. It is its own slice because
it is almost pure batch content work (hundreds of records across a handful of tables): the one
sanctioned sim touch is wiring the named Phase 2 materialTierBonus hook at its crafting.ts call
site. Everything else it needs (wheel math, masterwork, stations, training) landed in Phases 1
to 9, and everything that consumes it (fishing supply, node tiers, tuning) comes after.

## Context pointers

- `docs/professions-2/state.md`: locked decisions (the six deep crafts, the economy invariant,
  pacing, training-fee placeholders), the validation matrix, and the New surfaces entries for
  Phases 4, 8, and 9 (where the node material tables and masters landed).
- `docs/professions-2/progress.md`: the Phase 10 deliverable checklist.
- `docs/professions-2/implementation-plan.md`: the Review Dispatch Matrix (the one canonical copy).
- `src/sim/content/recipes.ts`: the existing recipe table and record shape; the ladders land here.
- `src/sim/content/items.ts`: `ItemDef` records; every new material and every recipe output.
- `src/sim/content/professions.ts`: `HARVEST_COMPONENT_ITEMS`, where the corpse component
  quest-item collision lives today.
- The Phase 4 material tables (per-rarity node yields; exact paths are recorded in the Phase 4
  entry of `state.md`).
- `src/ui/i18n.catalog/items.ts`: English catalog rows for every new item and recipe name.
- The wiki content generator under `scripts/` (`npm run wiki:content`, freshness-gated by
  `tests/guide.test.ts`) and `src/guide/CLAUDE.md` for any new `guide.*` prose keys.
- `src/sim/CLAUDE.md` and `src/ui/CLAUDE.md` for content and i18n conventions.
- `tests/progression.test.ts`, `tests/professions_crafting.test.ts`,
  `tests/mob_component_tags.test.ts`: the pinned suites this phase must keep green and extend.

## Starter Prompt

```
This is Phase 10 of the Professions 2.0 feature: Recipe ladders and materials content.

Model: Opus 4.8, xhigh effort (reserve max for genuinely frontier problems), 1m context
variant where the file load demands it.
Harness: Claude Code.
ULTRACODE: this phase is batch-heavy (six full recipe ladders plus a material sweep across
the content tables). Add the keyword `ultracode` to this prompt and orchestrate via a
Workflow (per-craft pipeline plus adversarial verification of referential integrity), not
hand-spawned agents.

Goal: give all six deep crafts real common to rare tier ladders consuming real materials
(Phase 4 node yields, dedicated corpse components, fish, vendor reagents), end the corpse
component quest-item collision, and pin the economy invariant that no recipe vendors above
its inputs.

STEP 0 - PRE-FLIGHT:
- Sync with the LATEST release branch FIRST: git fetch origin "+refs/heads/release/*:refs/remotes/origin/release/*"; pick
  the newest by version sort (git branch -r --list "origin/release/*" | sort -V | tail -1). If this phase
  starts a fresh branch or worktree, base it on that branch; if the feature branch already exists, merge
  that release branch into it NOW, resolve conflicts, and run the release-merge-audit skill on the merge
  before proceeding. Never base work on main or an older release branch than the newest.
- Verify `git status` is clean before starting. If not, ask the user (a concurrent session
  may share this checkout).
- Memory scan (if you use Claude Code memory): check your MEMORY.md index and any entries
  relevant to this phase's domain (suggested topics: node25-breaks-jsdom-gate for the gate
  rule, PR 2039 state for the professions foundation, combo-recipes-broken-online for the
  2033 stub trap in the professions wire surface).

STEP 1 - LOAD CONTEXT (do NOT read planning docs directly, save your context):
Spawn an Explore agent to read and summarize:
- docs/professions-2/state.md (locked decisions, validation matrix, the New surfaces
  entries for Phases 4, 8, and 9)
- docs/professions-2/progress.md (Phase 10 status + deliverable checklist)
- docs/professions-2/phase-10-recipe-ladders.md (this prompt); verify the agent has the
  same understanding
- src/sim/content/recipes.ts (recipe record shape, existing recipes, how tiers and
  stations are expressed)
- src/sim/content/items.ts (ItemDef shape, vendor value fields, existing material items)
- src/sim/content/professions.ts (HARVEST_COMPONENT_ITEMS and the current corpse component
  to quest-item collision)
- the Phase 4 node material tables (paths per state.md)
- src/ui/i18n.catalog/items.ts (catalog row conventions for item names)
- CLAUDE.md (root) + src/sim/CLAUDE.md + src/ui/CLAUDE.md + src/guide/CLAUDE.md
The agent must return: the recipe and ItemDef record shapes with the exact fields a new
record needs; the full list of Phase 4 gatherable materials by craft; the current
HARVEST_COMPONENT_ITEMS mapping and every quest that references those items; the Phase 9
master ids and the acquireRecipe training path; the vendor-value convention (buy vs sell
price fields); and the i18n catalog row format for items.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE:
Run this phase as an ultracode Workflow. Give every stage ONLY the Explore summary, never
the raw planning docs. Suggested pipeline (structured outputs between stages):
- Stage 1: the materials/collision agent (its output ids feed every later stage).
- Stage 2: six craft content agents in parallel, one per craft (weaponcrafting,
  armorcrafting, tailoring, leatherworking, cooking, alchemy). Have each return its ladder
  as structured output (recipe records, ItemDef records, English catalog rows against a
  shared schema); a single integration step then writes the shared content files, so the
  parallel agents never edit recipes.ts, items.ts, or the catalog concurrently. If you let
  agents write files directly instead, use isolation: "worktree".
- Stage 3: the economy-test agent (runs after the tables exist).
- Stage 4: the adversarial verify stage (re-derives every reference from the written
  tables; a finding counts only when independently confirmed).

Materials/collision agent deliverables:
- Dedicated material ItemDefs for hide, silk, venomSac, and meat (plus any other corpse
  component the audit surfaces), with HARVEST_COMPONENT_ITEMS remapped so harvesting
  yields the new materials.
- The perfect specimen (2026-07-17 amendment): a rare corpse-component family riding the
  EXISTING rollCorpseMaterialRarity roll and the signable-rarity floor (rare+, always
  signed): corpse harvesting's jackpot fantasy, celebrated by the Phase 4 loot-line
  treatment. No new event system and no proficiency work (monster-harvest proficiency
  stays wave 2).
- Wire the Phase 2 materialTierBonus hook (the named hook in
  src/sim/professions/masterwork.ts): real material-tier values at the crafting.ts call
  site keyed by the consumed materials' rarity, pinned in the masterwork tests. Higher-tier
  materials now visibly raise masterwork odds; the cap and draw order are untouched.
- The old quest items keep their quest roles ONLY: quest drops and quest credit paths
  stay exactly as they are, with a regression test proving quest credit still works and
  that a wolf hide no longer advances a boar quest.
- Cloth sourcing lands: plant fiber from the Phase 4 herbalism tables plus humanoid cloth
  components, so tailoring's input family is complete.
- Never delete an ItemDef players may hold; deprecate by removing sources only.

Craft content agent deliverables (each of the six, for its craft):
- A common to rare tier ladder; epic and above are stubbed as wave-2 hooks only (no
  craftable or trainable epic recipe this phase).
- Each tier's recipes consume Phase 4 node materials, the new corpse component materials,
  fish (cooking: author the recipes and the fish ItemDefs now; Phase 11 lands the supply),
  and vendor reagents.
- Cross-tier composition (2026-07-17 amendment): higher-tier recipes also consume SOME
  lower-tier materials (at least one lower-tier material family per rare recipe) so new
  gatherers keep selling into a mature economy.
- Cooking and alchemy only: combat-worthy consumables at EVERY tier (food and potion
  outputs a raider actually uses), keeping a permanent destruction channel for low-tier
  materials (2026-07-17 amendment).
- Every output is a real ItemDef with an English catalog row and the procedural icon
  fallback (bespoke WebP icon overrides are not required this phase).
- Every new recipe is trained, not known, at the matching master via the Phase 9
  acquireRecipe path, using the state.md fee placeholders (common free, uncommon 25s,
  rare 1g).
- Every recipe that existed before this phase keeps its exact costs and outputs.

Economy-test agent deliverables:
- The pinned economy invariant: a test (suggested: tests/recipe_economy.test.ts) that
  computes the vendor value of EVERY recipe's output against the vendor value of its full
  input list (vendor reagents priced at their purchase price) and fails on any
  gold-positive recipe.
- Referential integrity extensions: every recipe input and output id resolves to a real
  ItemDef; every trained recipe maps to an existing Phase 8/9 master.

Verify stage (adversarial) deliverables:
- Re-derive every reference independently from the written tables: input ids, output ids,
  master and training links, catalog keys, component mappings.
- Confirm every gathered or harvested material introduced by Phases 4 and 10 has at least
  one consuming recipe.
- Confirm the cross-tier rule (every rare recipe consumes at least one lower-tier material
  family) and the every-tier consumable rule (cooking and alchemy output combat-worthy
  consumables at each tier).
- Report every issue including low-severity and uncertain ones; ranking happens later.

INVARIANTS THIS PHASE MUST KEEP:
- Prime directive: nothing existing breaks. Existing recipes are unchanged in cost and
  output; players holding old quest items are unaffected; never delete an ItemDef players
  may hold.
- Determinism: all randomness via Rng; no Math.random / Date.now / performance.now in
  src/sim/. Content records must not introduce nondeterministic evaluation.
- Server authority: the client never decides craft outcomes; this phase is content plus
  tests and must not move any decision client-side.
- Seam: this phase should need no new IWorld surface. If one becomes necessary, it lands
  on a facet file, implemented in BOTH Sim and ClientWorld with the parity pin updated in
  the same change, and verified LIVE, not just shaped (the 2033 stub trap).
- i18n: every new player-visible string is a t() key added in ENGLISH ONLY to
  src/ui/i18n.catalog/items.ts (never edit the locale overlays). This is the M16 watch
  phase: every wordy new English name also needs its five non-Latin fills in the same
  change. Any sim/server-emitted player text gets its matcher rule in src/ui/sim_i18n.ts
  or src/ui/server_i18n.ts in the SAME change (the S3 guard enforces it).
- The referential integrity suites stay green and grow with the new content.

Out of scope (do NOT do in this phase):
- Balance fine-tuning of costs, yields, or fees (Phase 15 tunes against live data).
- Fishing supply, the minigame, or catch tables (Phase 11); author only the fish ItemDefs
  and the cooking recipes that consume them.
- Node tiers and tool tier gating (Phase 12).

STEP 3 - VALIDATION + MULTI-AGENT REVIEW:
- Run the state.md content-only row plus the new economy test:
  npx tsc --noEmit
  npx vitest run tests/progression.test.ts tests/professions_crafting.test.ts
    tests/mob_component_tags.test.ts tests/localization_fixes.test.ts
  npx vitest run tests/recipe_economy.test.ts (or the path you chose for the invariant)
  plus the referential integrity suites for the touched domain.
- i18n keys were added, so also run the state.md i18n row: npm run i18n:gen, then
  npx vitest run tests/i18n_completeness.test.ts tests/localization_fixes.test.ts.
- npm run wiki:content must regen clean; the recipe and station data feeds the professions
  guide page skeleton.
- Spawn review agents per the Review Dispatch Matrix in
  docs/professions-2/implementation-plan.md; check git diff --name-only against the
  phase-start commit and spawn ONLY matching rows (a content, tests, and i18n-catalog diff
  typically triggers qa-checklist at completion and little else; if no row matches, spawn
  none).
- Prompt each agent you spawn for COVERAGE not filtering: report every issue including
  low-severity and uncertain ones; ranking happens in a later step.
- Resume any agent that truncates with: "Stop reading more files. Output the full report
  now based on what you've already seen. No more tool calls. Format: BLOCKING /
  SHOULD-FIX / NICE-TO-HAVE / VERDICT."
- Do not commit while any BLOCKING finding stands.

STEP 4 - COMMIT CADENCE:
Aim for 4 commits with these headlines (Conventional Commits with a scope; EXPLICIT
paths, never git add -A; every commit carries a body; no em dashes or emojis):
- feat(content): weaponcrafting and armorcrafting tier ladders
- feat(content): tailoring and leatherworking tier ladders
- feat(content): alchemy and cooking tier ladders
- feat(content): component materials and the recipe economy invariant
Land the component materials commit FIRST if the ladders reference the new material ids,
so every commit keeps tsc and the suites green.

STEP 5 - ACCEPTANCE CRITERIA (do not mark complete until all check):
- [ ] Each of the six deep crafts (weaponcrafting, armorcrafting, tailoring,
      leatherworking, cooking, alchemy) has a common to rare ladder; the count matches
      the state.md craft list exactly.
- [ ] Every ladder material is obtainable from wave-one sources (fish is the one
      sanctioned forward reference: recipes authored now, supply lands in Phase 11).
- [ ] No recipe vendors gold-positive; the economy invariant test is pinned and green.
- [ ] A wolf hide no longer advances a boar quest; quest credit regression tests green.
- [ ] Every pre-existing recipe is unchanged in cost and output; players holding old
      quest items are unaffected.
- [ ] Every new recipe is trained-not-known at its matching master.
- [ ] Every new item and recipe has an English catalog row; wordy names carry their five
      non-Latin fills (M16).
- [ ] Every rare recipe consumes at least one lower-tier material family; cooking and
      alchemy have combat-worthy consumables at every tier.
- [ ] The materialTierBonus hook is wired with pinned values; higher-tier materials raise
      the masterwork proc chance; the cap and draw-order pins stay green.
- [ ] The perfect specimen family exists, rides the corpse rarity roll, and is always
      signed at rare+.
- [ ] npm run wiki:content regenerates clean.

STEP 6 - DOC UPDATES + MEMORY:
- Update docs/professions-2/progress.md (mark Phase 10 status; note deferrals).
- Update docs/professions-2/state.md: the Phase 10 entry in New surfaces gains the new
  material item id families (hide/silk/venomSac/meat/fiber/cloth), the perfect specimen
  family, the ladder table
  locations, the economy invariant test path, the wired materialTierBonus values, the
  i18n key namespaces added, the fish
  item ids authored ahead of Phase 11, and the per-master trained recipe mapping.
- If you use Claude Code memory, record any surprising rules or current-state notes for
  the next session.

STEP 7 - FINAL RESPONSE FORMAT:
End your turn with: phase status, files touched, validation results, review-agent
verdicts, any deferred items, and a one-line handoff for the QA session.

STOPPING RULES:
- Stop and surface to the user if any recipe material's ONLY source would be wave-2
  content; every wave-one recipe must be satisfiable inside this packet (Phase 11 fish
  supply is the one sanctioned pending source).
- Stop and ask if ending the quest-item collision would require deleting or reshaping an
  ItemDef players may hold (prime directive).
```

## As landed (2026-07-19)

The build followed this file with these as-landed deviations, authoritative
over the older wording above (mirrored in phase-10-qa.md per the
amend-the-twin rule); the full surface record is the Phase 10 entry in
state.md:

- The economy invariant test enumerates every recipe but carries a FROZEN
  14-member LEGACY_GOLD_POSITIVE_RECIPE_IDS exception list (8 wave-one
  commons, the 3 caster-hub rows, the 3 combos): fixing the legacy output
  sellValues inside a content phase would break the prime directive
  (existing item values and live vendor income), so the list is pinned
  three ways (subset of PRE_TRAINING_RECIPE_IDS, every member still
  violates so it self-prunes, exact literals) as a Phase 15 burn-down
  target. No Phase 10 recipe is exempt; strict less-than holds for all 54.
- No fish ItemDefs were authored: the six raw fish already shipped
  (fishing is live pre-Phase-11), and cooking consumes them directly. The
  "author the fish ItemDefs now" deliverable was already satisfied.
- The perfect specimen grants IN ADDITION to the plain component when the
  existing corpse rarity roll clears rare+, and the regular component now
  grants plain when a specimen family exists; specimen-less families
  (fang, cloth) keep the old signed-regular behavior at rare+.
- Every new recipe, including the skillReq-0 rungs, is trainer-taught AND
  station-bound; the grandfathered field commons coexist unchanged. New
  recipes live in the new LADDER_RECIPES table (COMMON_RECIPES and
  FIELD_RECIPES are literally pinned at their nine wave-one entries).
- materialTierBonus is keyed by def-level material tier bands (max-tier
  rule, 0.01 per tier), not consumed-instance rarity: consumption does not
  report which instance was removed, so instance-rarity keying would need
  a consumption-order change. thorium_ore keys tier 1 by vendor price
  band; arcanite_bar keys tier 2 despite not being a node yield.
- tests/professions_grandfather.test.ts's non-combo arm was rescoped (it
  had forbidden ANY non-combo recipe from carrying acquisition), and
  tests/corpse_harvest_sim.test.ts was rewritten off its boar_hide lock;
  the cross-tier rule is encoded negative-form (every rung-50 recipe must
  consume at least one non-rare-band reagent) because fish and vendor
  reagents are unbanded commons.
- No new deeds: recipes, materials, and the specimen family are not
  conquerable content under the docs/design/deeds.md authoring contract;
  rare-find deeds stay Phase 15.
- The wiki generator does not yet enumerate recipe records, so
  npm run wiki:content regenerates with zero diff; the professions guide
  rewrite remains the Phase 15 deliverable.
- Phase 10 QA amendment (2026-07-19): harvestCorpse grants ALL plain
  yields before any signed instance (signed-family instances next,
  specimens last as guarded extras; the rarity draws stay in the first
  loop in yield order, so the draw sequence and the parity goldens are
  byte-identical). The single-pass shape let a jackpot on a
  two-specimen-family corpse (wild_boar hide+meat) consume the slot the
  pre-gate reserved for a later family's plain stack and overflow the
  bag; pinned in tests/corpse_harvest_sim.test.ts.
