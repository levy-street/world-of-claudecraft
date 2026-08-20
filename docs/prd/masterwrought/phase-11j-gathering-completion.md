# Phase 11j: The gathering completion pass

### Starter Prompt
```
This is Phase 11j of the Masterwrought feature: the gathering completion pass. It runs
after 11e through 11i, the phases that build the ladders it certifies, and before the
capstone. Its job is to turn "every gathering profession feeds the crafts, at every level"
from a state this packet happens to reach into a property the codebase ENFORCES.

Model: xhigh effort. Harness: Claude Code. Worktree: ~/Documents/wocc-masterwrought
(branch feature/masterwrought). ULTRACODE: not needed. This phase is narrow and
high-judgment, which is the opposite of the wide batch shape ultracode is for.

Goal: five deliverables.
(1) THE SUPPLY-COVERAGE INVARIANT AND ITS TEST (masterwrought R20).
    tests/gathering_supply_coverage.test.ts asserts that every gathering profession appears
    in at least one recipe at skillReq 100 or above, and in at least one recipe in every
    25-point band below it. This is the phase's most valuable deliverable: it converts
    design intent into a permanent guard, at zero runtime cost, so the gap cannot reopen
    after this packet closes.
(1b) THE DEMAND-COVERAGE INVARIANT AND ITS AUDIT (masterwrought R21), the other half of the
    same invariant and the half that catches what (1) structurally cannot. Deliverable 1
    proves every gathering profession FEEDS the crafts. This one proves the world EATS what
    the crafts make. Extend tests/gathering_supply_coverage.test.ts with a demand arm whose
    ONLY numeric assertion is PRESENCE: every craft reagent has at least one consumer, the
    count is RECORDED rather than asserted, and the failure message names the material.
    Then run the demand audit across all fifteen professions and record it in state.md as a
    RATIO TABLE (consumers and unit demand per material, by family, with outliers reported
    against their family's own median): what does the endgame consume from each, per raid
    night, and is that enough to keep a crafter employed. THE FLOOR IS SETTLED 2026-08-20 AT
    PRESENCE and nowhere else (decision E below, and the same ruling governs 11m's sweep):
    zero is a structural fact, everything above zero is a balance number nobody measured,
    and a numeric floor turns a correctness guard into a content quota that passes on
    padding.
    THE WORKED EXAMPLE, which is why this arm exists and which the phase must cite, in its
    CORRECTED form: the enchanting reagent ladder runs arcane_dust, arcane_essence,
    arcane_shard, lucent_reagent (apex). The census that once called arcane_shard a dead-end
    rung (2 recipes, 10 units, both consumers skill-25 tool charms) scanned
    src/sim/content/recipes.ts ONLY and missed src/sim/content/enchants.ts, which carries ten
    more arcane_shard consumer rows (nine at count 1, one at count 2), three of them apex
    rows pairing it with lucent_reagent. Live demand is 12 consumers and 21 units, not 2 and
    10. THAT correction is the lesson this arm exists to teach: a hand-scoped census is the
    instrument the demand arm replaces, and the ratio table is what makes a genuine outlier
    (12 consumers against arcane_dust's 41) reportable without asserting a threshold nobody
    measured. Re-derive every number here over ALL reagent sources rather than restating any
    of them; 11m re-derives them again before it writes a row.
    Respect masterwrought R21's line: the fix for thin demand is a consumer at the rung that
    PRODUCES the material, never tuning content so hard around the full kit that arriving
    without it means you cannot clear.
(2) THE BAND AUDIT. Run the invariant over the merged tree, report EVERY empty band per
    profession at once, and fill what it finds. The audit output goes in state.md so the
    result is reproducible rather than asserted.
(3) THE APEX HOE. Farming is the only hole in the shipped engineering apex-tool family:
    arcanite_mining_pick 150, elderwood_axe 150, sunpetal_sickle 150,
    tidewrought_fishing_rod 125, and farming's ladder ends at osmium_hoe at engineering 75.
    This is joining an existing family, not inventing a rung.
(4) THE SUPPLY MATRIX in docs/design/professions.md, the canonical shipped-system doc,
    which farming never amended despite adding a fifth gathering profession and the game's
    first between-sessions mechanic.
(5) THE SCOPE LINE in brainstorm.md, recording a gathering-wide apex-tier expansion beyond
    what this packet ships as future-tier design intent, so the no-deferral contract is
    satisfied by an explicit record and never by silence.

WHY THIS PHASE SITS HERE, so nobody re-sequences it:
- It can only certify a ladder the phases before it have finished building. 11f gives
  farming drop rows at 75 and 100 (11f-GATE-A re-tiers the ladder band-complete to
  0/25/50/75/100 and stops there, so nothing farming owns reaches 125); 11g and 11h build the
  provisioning supply line at
  the leveling and apex tiers; 11i puts fish into the bills fishing should already be in.
  A sweep run before them measures a tree nobody was finished with.
- The thin ladders the sweep exposes (logging's 6 endgame bills is the known one) are
  topped up HERE and not later, because a bill added after Phase 15 forces a re-measurement
  of the R5 envelope.
- The apex hoe belongs with the sweep and not with 11e's tool work, because it is not a
  farming decision. It is the fifth member of a family whose other four already ship, and
  the same evidence that finds the empty bands finds the empty family slot.
- Any gathering-content phase that lands AFTER this one inherits the guard for free and
  cannot reopen a band without reddening it. That is the whole reason this phase ships a
  test and not only an audit, and it is why the test is written to be found by a
  contributor who has never read this packet.

WHY THE MAKER'S CHARM DOES NOT ALREADY CLOSE THE TOOL GAP, since a previous draft of this
program rejected a rung-5 hoe on exactly that ground and the maintainer has overturned it:
the charm is an EFFECT slot, not a tool. Every other gathering profession has BOTH a
tier-5 base tool and the slot; farming has only the slot. The two are complements and not
substitutes, and the code says so: startingDurabilityFor (src/sim/professions/tools.ts)
reads the BASE TOOL's rarity and pays RARITY_DURABILITY_BONUS extra charges per rarity
rung, and ratchetCeilingForUse prices the refill ceiling off the same rarity. A farmer
capped at the rare osmium_hoe therefore runs the same charm at a strictly lower charge
ceiling than a miner running it on an epic pick. Record that as the overturn's reason.

WORKTREE GUARD (do this FIRST; the user runs multiple concurrent sessions): run pwd.
If you are not in /Users/fernando/Documents/wocc-masterwrought, switch this session into
it NOW with the EnterWorktree tool (path: /Users/fernando/Documents/wocc-masterwrought).
If EnterWorktree is unavailable or refuses, STOP and ask the user to relaunch Claude Code
from that directory. Phase work never runs from the main checkout at
~/Documents/world-of-claudecraft.

STEP 0 - PRE-FLIGHT (canonical Team Workflow, docs/prd/masterwrought/implementation-plan.md):
- git status clean, with Phase 11i QA closed. If 11i is still open, STOP: this phase
  certifies fishing's ladder and cannot distinguish "11i has not landed yet" from "11i
  landed and left a hole".
- SYNC RELEASE: git fetch origin --prune, discover the newest release branch by version
  sort (git branch -r | grep 'origin/release/' | sort -V | tail -1), merge it, run the
  release-merge-audit skill. A minor-version-or-more jump runs as its own phase first.
- DECISIONS SETTLED 2026-08-20 (THE FULL DELEGATION). All SIX decisions that once gated this
  phase are ANSWERED. Nothing below is confirmed with the maintainer: the phase EXECUTES
  these rulings. Read them, and the "Decisions closed 2026-08-20 (the full delegation)"
  section of docs/prd/masterwrought/state.md, BEFORE any code and before the fan-out starts.
  A disagreement between that record and this file is a STOP and a ledger line, never a
  fresh decision.
  - Decision A, SETTLED (the apex hoe's rung). AUTHOR the apex hoe recipe at engineering
    skillReq 125, acquisition ['trainer'], stationType 'toolworks', on the
    recipe_tidewrought_fishing_rod precedent, and leave PRE_TRAINING_RECIPE_IDS frozen at 21.
    RECORD the family reading in state.md and in the tool-family section of
    docs/design/professions.md: three grandfathered rows at 150 that are HISTORY, and two
    authored rows at 125 that are REACHABLE. The 150 rung is not a target.
    FORWARD CARRY (2026-08-20, qr-11o-150, state.md row 120): Phase 11o, which runs after
    11n, re-tiers those three grandfathered rows from 150 to 125 and amends the family
    reading in docs/design/professions.md with the date. This phase still records the
    reading as it stands at its own runtime; it does NOT pre-apply 11o's re-tier.
    WHY: tierForSkill(150) is 6 while engineering's cap of 125 resolves to tier 5, and BOTH
    acquisition channels gate on the same teachTierMet, so a row authored at 150 is
    permanently unlearnable; ROD_RECIPES states this in its own header.
    REJECTED: skillReq 150 to match the three land siblings (it ships a recipe no player can
    ever learn); growing PRE_TRAINING_RECIPE_IDS to reach 150 (it would make a recipe
    authored in 2026 claim to predate training).
  - Decision B, SETTLED (the non-crafter route), and it goes one row FURTHER than the old
    default. ADD BOTH hoe rungs to DELVE_SHOPS.drowned_litany: osmium_hoe at 24 marks with
    gate 'clears:3', and the apex hoe at 56 marks with gate 'heroicClear', matching the
    shipped land and rod tools exactly. NARROW farming's craft-only pin to hoe rungs 1 to 3
    rather than deleting it, and write the narrowing out loud with its reason. DISCHARGE the
    deliberate self-clearing tripwire in tests/delve_shop.test.ts; never widen it to keep the
    arm green. The tier-4 osmium_hoe Marks question is CLOSED by this ruling, not narrowed.
    WHY: the counter already carries all four tier-4 tools at 24/clears:3 and all four tier-5
    tools at 56/heroicClear, masterwrought R18 says nobody must have TAKEN a profession to
    get a thing, and this counter is the gathering family's one non-crafter route, so leaving
    farming half-in makes it the only gathering profession with no such route at the tier-4
    rung. Five and five is also a more drift-resistant pin than four and five, and a hoe
    carries no combat power, so there is no R5 interaction to weigh.
    REJECTED: the apex rung alone (it leaves the tier-4 arm lopsided and the question open);
    deleting the craft-only pin rather than narrowing it (it still guards rungs 1 to 3).
  - Decision C, SETTLED (the masterwrought R20 subject list). BIND all SIX families: the five
    profession ids plus corpse harvesting. DERIVE the subject list from
    GATHERING_PROFESSION_IDS so a sixth gathering profession joins the guard automatically,
    and never hand-list it. Skinning's eleven endgame bills are inside the guard.
    WHY: masterwrought R20 says the guarantee is a test or it does not exist, and a family
    that is reported but not bound is exactly the leave-it-to-intention shape R20 forbids.
    REJECTED: five families with corpse harvesting reported only.
  - Decision D, SETTLED (the self-feeding arm). The skillReq >= 100 arm REFUSES to count a
    recipe whose result is a gathering tool of that same profession, derived through the
    item's own use record and never a hand-written exclusion list. On this tree it should
    bite NOTHING, and confirming that is part of the audit; if it bites, a profession's
    endgame contribution is still self-feeding and this phase has work left.
    WHY: on the pre-11i tree it bit exactly one family, fishing, whose entire endgame
    contribution was recipe_tidewrought_fishing_rod, a fishing rod, and that one measured hit
    is what proves the arm is calibrated rather than decorative.
    REJECTED: presence only at the top arm (it calls a profession that feeds only its own
    tool covered).
  - Decision E, SETTLED (thin ladders). ASSERT PRESENCE ONLY. No numeric floor anywhere in
    tests/gathering_supply_coverage.test.ts, on the supply arm or the demand arm. RECORD the
    per-family per-band bill counts in state.md as a judgment surface, and LIST every
    thin-ladder top-up with its reason. For logging, the known thin one, add timber rows
    ALONGSIDE existing reagents in the placeable capstone stations and the tool-side bills
    where the material story already supports wood; never substitute (masterwrought R18).
    WHY: a numeric floor is a balance number nobody measured and converts an invariant guard
    into a content quota, which is worse than no guard because it passes on padding;
    presence is a structural fact a decorative row cannot game.
    REJECTED: "at least three bills per band", or any other count, inside the test.
  - Decision F, SETTLED (the masterwrought R17 gathering-tool carve-out). THE CARVE-OUT
    STANDS. Scope it by TEXT to the hoe ladder alone, recorded in state.md as a masterwrought
    R17 CLARIFICATION beside the ruling and never as a change to R17's own text. Every other
    exclusion stays asserted by the same sweep (no produce in any gear intermediate, in any
    apex gear bill, among the Perfecting materials, or in recipe_quickening_catalyst), and
    the sweep's carve-out text names the hoe ladder and nothing else.
    WHY: judged on the merits, a gathering tool is not gear in R17's sense (no equip slot, no
    item-level budget contest, no R5 interaction), and the precedent is shipped rather than
    invented here: recipe_osmium_hoe already consumes fine_highland_barley x4 under farming's
    deviation (ad), and the hoe ladder's one-tier-below closed circuit is what makes it
    structural rather than incidental.
    REJECTED: refusing the carve-out and giving the apex hoe a non-produce reagent (it breaks
    a shipped closed-circuit invariant in a phase with no other reason to touch it); amending
    R17's own text (the carve-out would then widen by drift).
- Memory scan (MEMORY.md index): the test-pin trap index (READ it before writing or moving
  any pin: predicted-then-observed, constant-self-comparison, comment-gameable source pins,
  vitest -t is a regex), the source-scan guard cluster (a discovery query blind to named
  constants, a floor set ABOVE the flat value, prompt-leaf blind spots),
  new-item-content-hidden-obligations, item-art-ownership-batch-xor-entries,
  m16-wordy-english-requires-nonlatin-fills, release-merge-gate-surprises, and
  gate-env-database-url-poisons-goldens.

STEP 1 - LOAD CONTEXT (Explore agent; do not read planning docs in the main loop):
- docs/prd/masterwrought/state.md: the "Decisions closed 2026-08-20 (the full delegation)"
  section FIRST (the packet's one collection point for every settled gate, including all six
  of this phase's), then R13, R15 and the naming registry (including the "Rejected for
  collisions" row and the recorded Osmium display register), R17 to R20 as the lane that
  owns them wrote them, the Power placement block, the validation matrix, and the ledgers
  for 11e through 11i so this phase knows what was already filled.
- docs/prd/masterwrought/farming/state.md: D8, D9, D10 (the hoe ladder and the frozen
  wield-gate thresholds), D11, D17, D24, deviation (aa) (the craft-only acquisition
  doctrine the delve exclusion cites), and the OPEN items list, which is this packet's one
  open-item collection point (its rows closed by the 2026-08-20 delegation point at that
  record; read what is still genuinely open, including the tier-4 osmium_hoe Marks row this
  phase CLOSES).
- Content tables the supply map derives from, read whole: src/sim/content/professions.ts
  (GATHERING_PROFESSIONS, GATHERING_PROFESSION_IDS, HARVEST_COMPONENT_ITEMS,
  HARVEST_COMPONENT_SPECIMENS, TOOL_EFFECTS), src/sim/professions/gathering.ts
  (NODE_MATERIAL_TABLE, NODE_HARVEST_TABLE), src/sim/professions/material_grades.ts
  (MATERIAL_GRADE_ROWS, the nine node yields and their fine twins),
  src/sim/content/items.ts (FISHING_TABLES_BY_BAND and the raw catch defs, the hoe block
  and its comment claiming the tier-4 fine twins are structurally never a hoe reagent, the
  tier-4 and tier-5 land tool defs and their price register),
  src/sim/content/farm_crops.ts (FARM_CROPS produceItemId and fineProduceItemId).
- Recipes: src/sim/content/recipes.ts TOOL_RECIPES and its self-gating invariant,
  ROD_RECIPES and its header's unlearnable-above-the-cap lesson, HOE_RECIPES and its
  one-tier-below closed-circuit rule, INTERMEDIATE_RECIPES, APEX_CONSUMABLE_RECIPES and its
  uniform-bill and gold-negative headers, FARM_RECIPES as 11f through 11i left them.
- Sim seams: src/sim/professions/wheel.ts (TIER_SKILL_STEP, tierForSkill),
  src/sim/professions/training.ts (teachTierMet, PRE_TRAINING_RECIPE_IDS, trainingFeeFor,
  trainingStationTypeFor), src/sim/professions/pattern_items.ts (resolvePatternLearn's tier
  arm), src/sim/professions/tools.ts (canGatherTier, bestOwnedGatherToolFor,
  rarityLadderIndex, RARITY_DURABILITY_BONUS, startingDurabilityFor, ratchetCeilingForUse,
  slotToolEffectRefused), src/sim/professions/wield_gate.ts (WIELD_REQUIREMENT_BY_TIER and
  TIER5_TOOL_WIELD_PROFICIENCY), src/sim/content/delves/shop.ts (the eight tool rows and
  their comment).
- Tests that will move or that the new one must not duplicate: tests/recipe_economy.test.ts
  (MATERIAL DEMAND COVERAGE and its anti-rot pins, the counterfactually-vendor-fed
  membership literal and its non-vacuity floor), tests/professions_hoe_recipes.test.ts,
  tests/delve_shop.test.ts (the derived crafted-tools arm, the farming exclusion and its
  self-clearing tripwire, both exact per-tier arms), tests/material_grades.test.ts,
  tests/professions_tool_gate.test.ts (the knife-edge rule against the LIVE gain curve,
  which 11e re-tuned), tests/professions_tools.test.ts, tests/professions_grandfather.test.ts,
  tests/professions_zone_rollout.test.ts, tests/item_icons.test.ts (arm H's exact-equality
  sweep over ITEM_IMAGE_IDS, arm F's mapping.json provenance, and the merged shape of the
  art-pending arm), tests/shipped_item_ids.test.ts, tests/gather_tool_tooltip.test.ts,
  tests/guide.test.ts.
- docs/design/professions.md whole, especially its head anchor rule and the sections
  "Gathering, rare events, corpse harvesting", "Fishing", and "Tools and the mastery
  curve", plus docs/prd/masterwrought/brainstorm.md's "Future-tier design intent" block,
  which is the shape deliverable 5 copies.
Return: the merged image of every table the supply map derives from (ids, not prose); the
merged HOE_RECIPES and TOOL_RECIPES rows verbatim; the merged delve tool-row block and the
exact text of the farming exclusion and its tripwire; the merged shape of the item-art
pending arm (masterwrought pinned that set at size 0, farming parks 44 ids, so read what
11b and 11d actually resolved rather than assuming either); and the current per-family
endgame bill counts as the merged tree stands.

STEP 2 - EXECUTE (parallel fan-out, explicitly; four agents by vertical slice).
Agent 1 starts alone by one beat, because the audit IS its reporter output and a
hand-rolled second scan is exactly how an audit and its guard come to disagree. Agents 3
and 4 start immediately alongside it; Agent 2 starts the moment Agent 1's derivation
compiles.

Agent 1 (THE INVARIANT AND ITS TEST; this is the deliverable that outlives the packet):
- New file tests/gathering_supply_coverage.test.ts. Content scan only: no Sim, no rng, no
  fixtures, no runtime cost, imports content tables and pure leaves.
- THE SUPPLY MAP IS DERIVED, NEVER HAND-LISTED. One family per subject:
  - mining, logging, herbalism: the NODE_MATERIAL_TABLE yields for that profession's node
    type (resolved through NODE_HARVEST_TABLE, never by hard-coding ore/wood/herb), plus
    each yield's fine twin from MATERIAL_GRADES.
  - fishing: every item id in FISHING_TABLES_BY_BAND, excluding grey junk by its DEF
    (quality 'poor'), never by an id list. Grey junk is a coin drop, not supply.
  - farming: FARM_CROPS produceItemId and fineProduceItemId.
  - corpse harvesting: HARVEST_COMPONENT_ITEMS values plus HARVEST_COMPONENT_SPECIMENS
    values.
- THE BANDS ARE DERIVED TOO: band index is tierForSkill(recipe.skillReq) from
  src/sim/professions/wheel.ts, which is the shared 25-point band math the whole codebase
  uses and the same math farming's crop gates derive from. Never write 25 as a literal in
  this file, so a TIER_SKILL_STEP change moves the test and the game together.
- The assertions, in this shape:
  - For each family, for each band below 100: at least one recipe in that band whose
    reagents include one of the family's ids.
  - For each family: at least one recipe at skillReq 100 or above, with decision D's
    self-feeding refusal applied (a recipe whose result is that same profession's gathering
    tool does not count, resolved through the item's own use record).
  - THE DEMAND ARM, PRESENCE ONLY per decision E: every derived supply id has at least ONE
    consumer, counted over ALL reagent sources on the merged tree (src/sim/content/recipes.ts
    AND src/sim/content/enchants.ts, because a census scoped to one file is the exact error
    deliverable 1b's worked example records). The per-material counts are COLLECTED and
    printed for the ledger's ratio table; they are never asserted.
  - DIRECT REAGENTS ONLY. Transitive credit is refused and the refusal is stated in the
    file: if a row at band 75 could satisfy every band above it through an intermediate,
    one reagent would satisfy the whole ladder and the guard would be decorative.
- THE FAILURE MESSAGE IS PART OF THE DELIVERABLE. It names the profession, the exact band,
  the ids that family supplies, and where the rule lives (masterwrought R20 in
  docs/prd/masterwrought/state.md, restated in docs/design/professions.md), so a
  contributor who reds it in two years knows exactly what they broke and what would fix it.
  WRITE THE R-NUMBER IN FULL as "masterwrought R20" (settled 2026-08-20): shipped source and
  docs/design/professions.md already cite a DIFFERENT R series, Professions 2.0, which has
  its own R19, R20 and R22, so a bare number in a test message points a reader at the wrong
  ruling.
- IT REPORTS EVERY HOLE AT ONCE, never the first. Collect the empty cells and assert the
  collected list is empty, so the failure output IS the audit table. A first-failure-only
  message turns the band audit into a whack-a-mole loop and is a finding at QA.
- ANTI-VACUITY ARMS, each one because a scan guard that matches nothing passes:
  - every family's supply set is non-empty, and every id in it resolves in ITEMS;
  - the derived supply sets are pinned against the live tables in the same file (the
    MATERIAL DEMAND COVERAGE anti-rot idiom in tests/recipe_economy.test.ts, which pins its
    literal lists to NODE_MATERIAL_TABLE and the component tables so the literal cannot
    rot): a table row added without a supply mapping reds here;
  - the recipe corpus is non-empty and actually populates every band the loop iterates, so
    the band loop can never run zero times;
  - the two arms of the self-feeding rule are both populated (decision D), so neither
    branch is dead.
- Do NOT restate what tests/recipe_economy.test.ts already owns. That file asserts every
  material has at least ONE consumer somewhere; this file is the band-aware strengthening
  and lives in its own file so the economy file's two sorted literals stay untouched by it.

Agent 2 (THE BAND AUDIT AND THE FILLS):
- Run Agent 1's derivation over the merged tree and capture the FULL matrix (family by
  band, with the count of qualifying recipes per cell), not just the empty cells. Obtain it
  during authoring with a temporary log, record it in state.md, and remove the log before
  the commit. The shipped test asserts the empty-cell list is empty; the matrix is the
  ledger record that makes the result reproducible.
- Record BEFORE and AFTER. The BEFORE column is the maintainer's own measured audit (mining
  21, herbalism 15, skinning 11, logging 6, fishing 1 endgame bills at skillReq >= 75,
  farming 0), which is the authoring basis. CARRY qr-CENSUS (state.md row 130) beside it:
  under Agent 1's own derivation fishing measures 2 (stormreel also consumes koi at 75;
  both rows are rods) and mining measures 20, and the corpse-harvest family list was never
  pinned, so a BEFORE-column mismatch inside those margins is read as the recorded erratum,
  not as a lost row; anything OUTSIDE those margins is a finding. The AFTER
  column is this phase's measurement on the merged tree after 11e through 11i.
- PREDICT before you run, then require the prediction to hold, and treat a mismatch as a
  finding rather than a re-record. Standing predictions: farming and fishing are already
  full because 11f through 11i filled them, and logging is the one at risk, because its 6
  endgame bills are counted at skillReq >= 75 and whether ANY of them sits at 100 or above
  is exactly what this audit answers. If none does, logging is a live R20 violation.
- FILL what the audit finds, under two rules that are not negotiable. R18: every fill is a
  row ADDED alongside what is already in the bill, never a substitution, so no profession
  loses a consumer to another one. R17: farm produce feeds the CONSUMABLE professions only
  and never the gear chain, the Perfecting materials, or recipe_quickening_catalyst, which
  stays the packet's one pacing gate. Fills for the node professions are not produce and
  R17 does not constrain them.
- Every edited bill re-states its gold-negative arithmetic in the row comment, the same way
  the shipped rows do.
- THE TRAP THAT WILL BITE: a fill reagent that carries a copper buyValue can pull its
  recipe into the counterfactually-vendor-fed set in tests/recipe_economy.test.ts, whose
  membership is a sorted literal of six with a non-vacuity floor beneath it. elderwood_log
  is buyValue 160 and sunpetal_herb is 160, so this is a live hazard and not a hypothetical.
  Re-derive BOTH sorted literals from the merged ALL_RECIPES, never hand-merge them, name
  every recipe that moved into or out of the set and why, and re-derive the floor so it
  cannot outlive its teeth.
- Thin-ladder top-ups per decision E: listed with reasons, no numeric floor anywhere in the
  test, and each one is a real material story rather than a quota row.
- THE DEMAND RATIO TABLE is recorded in state.md beside the band matrix: consumers and unit
  demand per material, by family, with outliers named against their family's own median. It
  is the judgment surface decision E deliberately keeps OUT of the test, and it is what makes
  a thin rung visible without asserting a threshold nobody measured.

Agent 3 (THE APEX HOE):
- One new item id and one new recipe id. The item joins the tier-5 land-tool shape exactly:
  kind 'tool', quality 'epic', use { type: 'gatherTool', professionId: 'farming', tier: 5 },
  sellValue 150, NO buyValue, no noVendorSell and no noMarketList (those two belong to the
  tier-1 quest-granted rung only). Read the three sibling defs and match them; do not invent
  a price point.
- The recipe joins HOE_RECIPES, not TOOL_RECIPES, which stays pinned at 6. It satisfies the
  hoe ladder's own stated invariant with no change to that invariant: the fine TWIN of a
  crop one tier below its result, plus the hoe one rung down, at the toolworks. Result tier
  5, so the twin is a TIER-4 twin, which is exactly the pair (fine_gilded_sunmelon,
  fine_evergarden_greens) farming documented as having no possible consumer.
- THE BILL IS SETTLED 2026-08-20: fine_evergarden_greens count 2, plus osmium_hoe count 1.
  COUNT 2 AND NOT 4, and the derivation goes in the row comment: every tier-4 land tool takes
  its fine grade at 4 (fine_iron_ore, fine_ashwood_log, fine_goldleaf_herb) and every tier-5
  land tool HALVES it to 2 (fine_elderwood_log, fine_sunpetal_herb, fine_thorium_ore), so the
  hoe ladder's shipped 4 is the tier-4 convention and an apex hoe at 4 would be the only apex
  tool in the game that did not halve. WHICH TWIN follows the name (see NAMING below): the
  tool is named for the reagent it consumes. The hoe count stays 1, which the existing pin
  already asserts.
  REJECTED: count 4 (it breaks the halving the family states); fine_gilded_sunmelon as the
  first choice (it is the SECOND candidate and moves in only if the naming verdict forces
  the flip).
- skillReq 125 and acquisition ['trainer'] per decision A. stationType 'toolworks', so Tinker
  Gizzel teaches it with no content edit (trainingStationTypeFor derives the trainer from the
  station). itemLevelBudget and level match the sibling tier-5 rows.
- THE STALE items.ts COMMENT HAS EXACTLY ONE OWNER, AND IT IS NOT THIS PHASE (settled
  2026-08-20). src/sim/content/items.ts states that the tier-4 fine twins are "STRUCTURALLY
  never a hoe reagent: a tier-4 twin would need a tier-5 hoe... the ladder tops at 4". PHASE
  11h owns correcting it, because 11h runs first and its own apex bill falsifies the same
  sentence. VERIFY on the merged tree that it is already corrected and that the corrected
  text covers the apex hoe this phase ships; if it is somehow still stale, correct it here
  and record that 11h missed it. Do NOT re-correct a sentence 11h already fixed: three phases
  were once each told to fix this one comment, and a single named owner is the fix.
- WHAT THE APEX HOE ACTUALLY BUYS, stated honestly in the row comment rather than implied,
  because a player will ask: it opens no new crop tier, exactly as the tier-5 rod opens no
  new catch band (four crop tiers exist and the tier-4 hoe already reaches the last one,
  and the rod block in items.ts already says that plainly about itself). What
  it buys is the epic rarity rung on the tool-effect economy: startingDurabilityFor pays
  RARITY_DURABILITY_BONUS more charges per rarity rung and ratchetCeilingForUse prices the
  refill ceiling off the same rarity, so rare to epic is one rung for both. Derive the exact
  charge delta from the constants at authoring; do not restate a number from this file.
- THE WIELD GATE NEEDS NOTHING. WIELD_REQUIREMENT_BY_TIER already carries a tier-5 row at
  TIER5_TOOL_WIELD_PROFICIENCY of 100 and it already applies to every land profession
  (only fishing is exempt, structurally). Farming's maxSkill is 100, so the apex hoe wields
  at the cap and nowhere below it, which is the correct gate and costs no table change.
  VERIFY, do not assume: tests/professions_tool_gate.test.ts pins the knife-edge rule
  against the LIVE gain curve, and 11e re-tuned FARMING_GAIN_SCHEDULE, so the new tier-5
  farming row must be shown reachable on the ground a tier-4 hoe already works.
- DECISION B'S TWO MARKS ROWS AND THE TRIPWIRE, executed deliberately and in the open. Add
  BOTH rows beside their siblings in DELVE_SHOPS.drowned_litany (osmium_hoe at marks 24, gate
  'clears:3'; the apex hoe at marks 56, gate 'heroicClear'), then DISCHARGE farming's
  self-clearing tripwire in tests/delve_shop.test.ts by re-deciding the exclusion, never by
  widening it to keep the arm green. FIVE things move with the rows and none of them is
  optional: both exact per-tier arms go from four tier-4 tools to five and four tier-5 tools
  to five; the literal stock pin grows by exactly two rows; the at-least floor on
  craftedTools.length is re-derived upward (a greater-than-or-equal floor left at its old
  value silently stops guarding as the set grows); the shop file's own "These eight are the
  tier-4 and tier-5 picks, axes, sickles and rods" comment becomes ten; and the craft-only pin
  in tests/professions_hoe_recipes.test.ts NARROWS to hoe rungs 1 to 3 with its reason written
  beside it. Re-derive every one of them; hand-editing a literal here is how a lost row hides.
- ASSERT, DO NOT ASSUME, two cross-surface consequences: the apex hoe cannot join the
  counterfactually-vendor-fed set, because osmium_hoe carries no buyValue (pin it); and the
  hoe raises a farmer's best wieldable ANY-profession tool tier, which feeds the
  corpse-harvest premium gate through MONSTER_MATERIAL_TIERS, where every shipped family is
  tier 1 today so nothing changes. Both are one-line pins and both are the kind of thing
  that is discovered later if nobody writes them down now.
- NAMING (masterwrought R15 and farming D17): THE CANDIDATE IS SETTLED 2026-08-20, THE
  VERDICT IS STILL DERIVED. The candidate is evergarden_hoe, "Evergarden Hoe". It follows the
  tier-5 land convention exactly (each tier-5 tool is named for the fine reagent its rung
  consumes: Elderwood Axe from fine_elderwood_log, Sunpetal Sickle from fine_sunpetal_herb,
  Evergarden Hoe from fine_evergarden_greens), it mints NO new coin because Evergarden is
  already a registered proper noun in this packet (evergarden_greens, recipe_evergarden_*,
  src/sim/content/evergarden.ts), so the R15 risk is close to zero, and it tells the player
  where the tool comes from, which the metal register (Bronze, Skysilver, Osmium) never did.
  NEVER type it before its verdict exists: check the registry's "Rejected for collisions" row
  FIRST, web-verify at authoring against the major game wikis, record the verdict in the
  state.md registry with its evidence in naming-audit.md, and take the NEXT candidate if it
  does not come back CLEAR or GENERIC. The next candidate in order is the crop-word form
  built from gilded_sunmelon, which FLIPS the bill's twin to fine_gilded_sunmelon; if that
  flip happens, say so in the row comment and in the ledger, because the tool is named for
  the reagent it consumes.

Agent 4 (THE DESIGN DOC AND THE SCOPE RECORD):
- docs/design/professions.md is the canonical shipped-system doc and it is amended in place
  the way masterwrought already amends it (surgical prose edits citing symbols; see the
  jewelcrafting and inscription base-catalog edits). Farming never touched this file at all,
  which is why the fifth gathering profession is invisible in the one document a future
  contributor reads first.
- Add, and nothing beyond it:
  - the fifth gathering profession in the "Gathering, rare events, corpse harvesting"
    section: farming, its cap, its wall-clock growth loop as the game's first
    between-sessions mechanic, its hoe ladder, and the fact that its fine grade comes from
    a harvest roll rather than from the node fine-grade path;
  - the completed apex tool family in "Tools and the mastery curve", including the apex hoe
    and the reachable-rung reading decision A settles;
  - THE SUPPLY MATRIX: every gathering family against the crafts and bands it feeds. Cells
    name the craft and the band and the recipe FAMILY by symbol, never counts and never
    line numbers, because this file's own head anchor rule forbids numbers that rot. The
    matrix ends with one sentence naming tests/gathering_supply_coverage.test.ts as the
    LIVE authority: when the table and the test disagree, the test is the truth and this
    table is what gets fixed;
  - masterwrought R17 the provisioner rule, masterwrought R18 the anti-compulsion guardrail,
    masterwrought R19 the long-haul pacing (a deliberately slower curve because harvests are
    wall-clock gated, tuned against a measured calendar-days model and never against feel,
    with no daily reset, no decay, and a late harvest costing only opportunity), and
    masterwrought R20 the coverage invariant, each stated as a rule with the file that
    enforces it. WRITE ALL FOUR R-NUMBERS IN FULL (settled 2026-08-20), and this is not a
    style note: THIS VERY FILE already cites a different R series, Professions 2.0, at R19
    (the fishing gain schedule), R20 (the rod-ladder review ruling) and R22 (the wield gate),
    so a bare "R19" or "R20" added here collides head-on with a rule that already lives in
    the same document;
  - THE RECIPROCAL LOOP, plainly, because it is the part a reader will otherwise miss:
    herbalism feeds farming through the alchemy-crafted growth tonic, farming feeds cooking
    and alchemy back, and neither displaces the other because every farming row is added
    beside the herb rather than in place of it.
- SCOPE BOUNDARY, recorded rather than left ambiguous: 11j amends this file for the
  GATHERING half. The apex crafting tier's own amendment belongs to Phase 16's content
  surface sweep, which is inside this packet, so pointing there is a sequencing statement
  and not a deferral. Say so in the phase ledger.
- brainstorm.md gains ONE line in the existing "Future-tier design intent (NOT deliverables
  of this packet)" block, in exactly the shape the orange unique effects line already has: a
  gathering-wide apex-tier expansion beyond what this packet ships (new node and water
  tiers, the tier-6 tool rung the wield table has no row for, and the maxSkill 150 climb
  proficiency_bands.ts already comments forward room for) is real future-tier design intent
  and is not this packet. That record is what satisfies the no-deferral contract; silence
  would not.

INVARIANTS IN PLAY: R13 (rungs unchanged; the apex hoe joins an existing rung, it does not
move one); R15 and D17 (no proper noun typed before its web verdict exists); R17 (produce
never in the gear chain, the Perfecting materials, or recipe_quickening_catalyst); R18
(every fill ADDED, never substituted; every produce item stays market-listable kind 'junk');
R20 (the new invariant, enforced by the test this phase writes); D10 (the hoe ladder's own
one-tier-below closed-circuit rule holds for the new rung without amendment); the
append-only ordering rule 11b established for every content table; determinism (this phase
adds NO rng draw, and an agent that believes it needs one is a STOP); ids append-only
(tests/shipped_item_ids.test.ts); the pre-training record stays frozen at 21;
docs/design/professions.md's own anchor rule (stable paths, exported symbols and pinned
tests, never counts or line numbers); i18n English-only catalog rows for any new
player-visible string, with M16 non-Latin fills for a wordy new English name; no generated
file hand-edited; and THE R-NUMBER NAMESPACE RULE (settled 2026-08-20): every packet
R-number this phase writes into src/, server/, tests/, a CLAUDE.md, or
docs/design/professions.md reads "masterwrought R<n>" IN FULL, because a bare R-number in
those files means the shipped Professions 2.0 series permanently. A bare packet R-number in
source is a finding at QA, not a nit.

CONTENT OBLIGATIONS, enumerated because these are the ones that get missed:
- One new item id owes a row in ITEM_IMAGE_IDS, because tests/item_icons.test.ts arm H is
  an EXACT-EQUALITY sweep over every non-weapon item, and then EITHER committed WebP art
  with its mapping.json provenance row (arm F) OR a row on the MERGED ITEM_ART_PENDING
  allowlist with exactly one mapping owner (the batch-XOR rule). PARKING IS SETTLED
  2026-08-20: this packet ships NO committed WebP art, every new id parks with exactly one
  mapping owner, and the art wave runs on the maintainer's own schedule after the packet
  (committed art needs the maintainer's master SHA, which no phase session can produce, so
  requiring it would block a content phase on an artifact outside the branch and break the
  one-branch-one-PR contract). READ the merged shape of that arm first: masterwrought pinned
  the pending set at size 0 while farming parks 44 ids, and 11b resolved it to farming's
  art-subject split with both literals re-derived, so re-derive against the PREVIOUS phase's
  observed value rather than assuming either parent's number.
- tests/shipped_item_ids.golden.json re-minted with UPDATE_SHIPPED_ITEMS=1 and the diff
  reviewed for ADDITIONS ONLY. A removed line means a shipped id died.
- M16: if the new English name is wordy by the guard's own measure, its non-Latin fills land
  in this change. RUN THE GUARD rather than judging "Evergarden Hoe" by eye; the guard's
  measure of wordy is not a human's.
- npm run wiki:content, with tests/guide.test.ts freshness green, plus any new guide.* prose
  the tool ladder page needs.
- Deeds, SETTLED 2026-08-20 by precedent: the four sibling apex tools carry no deed, so the
  apex hoe carries NONE either, and that symmetry IS the recorded answer. Read the precedent
  to confirm it still holds on the merged tree, then write the verdict down. A
  precedent-derived verdict takes one read to produce and is stronger than a judged one.
- world_entity_i18n.ts: nothing owed, because this phase places no named entity. State it.
- Reliquary, SETTLED 2026-08-20: NO page, because a crafted gathering tool is not
  conquerable unique loot. The sweep RUNS anyway and the verdict is written, because the
  content-obligations reviewer treats an unwritten verdict as a gap.
- The economy invariant recheck in tests/recipe_economy.test.ts, whose two sorted literals
  BOTH packets edit and which is never hand-merged.

REJECTION LIST, recorded so none of these is re-proposed, each with its reason:
- A tier-6 tool rung for anyone. WIELD_REQUIREMENT_BY_TIER has no tier-6 row and
  wieldRequirementForTier fails OPEN at 0 for an unknown tier, so a tier-6 tool would ship
  ungated; the world's highest node and water tier is 3; and the delve shop's own re-check
  trigger says the patch that ships the first tier-4 node turns these prices into access
  items and re-derives the wield table in that same change. That is the gathering-wide
  expansion recorded in brainstorm.md, not this phase.
- A numeric floor on bills per band inside the coverage test, on the supply arm or the
  demand arm. It is a balance number nobody measured and it converts a correctness guard
  into a content quota that passes on padding (decision E, settled 2026-08-20; the same
  ruling governs 11m's demand sweep, so the two files cannot drift apart).
- The apex hoe at engineering 150 "to match the family". The three land rows at 150 are
  grandfathered HISTORY; a row authored there is unlearnable through every shipped channel
  (decision A).
- Leaving osmium_hoe off the Marks counter while the apex hoe joins it. It would leave
  farming the only gathering profession with no non-crafter route at the tier-4 rung, and a
  four-and-five per-tier pin drifts more easily than five and five (decision B).
- Re-correcting the items.ts tier-4 fine-twin comment after 11h corrected it. One owner, one
  edit; a second pass at the same sentence is how two phases claim the same line.
- An exemption list inside the coverage test. A guard with an exemption list is a guard
  someone will edit instead of fixing the hole. If a family genuinely cannot reach a band,
  that is a design finding and a STOP, not a list entry.
- Raising farming's maxSkill above 100 to make the apex hoe "fit". The apex hoe wields at
  100 because the tier-5 wield row reads 100 and farming's cap is 100. That is the ladder
  agreeing with itself, which is the point.
- Substituting a farming row for an herbalism or meat row anywhere. R18, and farming's D24
  displacement guardrail: herbalism loses nothing in this packet.
- Growing PRE_TRAINING_RECIPE_IDS to put the apex hoe at 150. The list is a frozen
  historical record of the pre-training world, pinned by two arms of
  tests/professions_grandfather.test.ts, and growing it would make a recipe authored in 2026
  claim to predate training.
- A second coverage test that re-derives the same supply map for a different question. One
  derivation, one file. A second copy is how two guards come to disagree.

Out of scope: farming's gain curve and crop roster (11e); farming's drop rows and patterns
(11f); the leveling and apex supply lines themselves (11g, 11h); fishing's catch content and
its skill-200 reward (11i); the capstone, its signatures, deeds and Reliquary pages (11k);
the Perfecting stage (Phase 12); any UI beauty work on professions surfaces (Phase 14); the
R5 envelope measurement (Phase 15); the merged wiki, icon and storefront enumeration sweep
(Phase 16). If this phase believes a number 11e through 11i settled is wrong, that is a
STOP and a ledger line, never an edit.

STEP 3 - VALIDATION + REVIEW (matrix in implementation-plan.md):
npx tsc --noEmit; then npx vitest run tests/gathering_supply_coverage.test.ts
tests/recipe_economy.test.ts tests/professions_hoe_recipes.test.ts tests/delve_shop.test.ts
tests/material_grades.test.ts tests/professions_tool_gate.test.ts tests/professions_tools.test.ts
tests/professions_grandfather.test.ts tests/professions_zone_rollout.test.ts
tests/item_icons.test.ts tests/shipped_item_ids.test.ts tests/gather_tool_tooltip.test.ts
tests/guide.test.ts tests/architecture.test.ts tests/localization_fixes.test.ts. THEN the
FULL suite (npx vitest run --maxWorkers=5) before calling any review round done: a content
phase that edits shipped bills is exactly the shape where a red hides outside a curated
battery. Confirm `env | grep -c DATABASE_URL` prints 0 before any vitest run. npm run
ci:changed on the touched files only. Read the gate LOG and not just its exit code: a
printed FAIL marker overrides a zero exit.
PROVE THE NEW TEST BEFORE TRUSTING IT: in a scratch copy, delete one family's reagent row
from one band and confirm the test reds, that the message names that family and that band,
and that it still lists every OTHER hole in the same run. A guard nobody has seen fail is a
guard nobody has tested.
Review Dispatch Matrix: content-obligations-reviewer (the whole content diff: art, M16,
wiki regen, deeds and Reliquary posture, ids append-only); architecture-reviewer ONLY if a
src/sim/ behavior file changed (the expected diff is content tables and tests, so the
default is skip and say so in the report); frontend-seam-reviewer only if a src/ui/ surface
moved (a new tool changes what the tool tooltip and the professions window render, so check
before skipping); qa-checklist when the deliverable set is complete. Skip
privacy-security-review, migration-safety, cross-platform-sync and
database-performance-reviewer unless server/, a persisted shape, a wire field or a SimEvent
was touched, and say which. COVERAGE prompts; apply ALL findings, blocking and should-fix
and nits.

STEP 4 - COMMIT CADENCE (explicit paths, bodies, no session trailers):
- test(content): the gathering supply coverage invariant (R20)
- feat(content): fill the empty supply bands the audit found
- feat(content): the apex hoe completes the gathering tool family
- test(content): re-derive the hoe ladder, delve shop, and economy pins
- docs(professions): the fifth gathering profession and the supply matrix

STEP 5 - ACCEPTANCE:
- [ ] All SIX settled decisions (A to F) were read from the state.md "Decisions closed
      2026-08-20" record before the fan-out, and that record agrees with this file
- [ ] tests/gathering_supply_coverage.test.ts exists, derives every supply set and every
      band from live tables with no hand-written id list and no literal 25, and has been
      PROVEN to fail by mutation with a message naming the profession and the band
- [ ] It reports every empty cell in one run, and its anti-vacuity arms make an empty
      supply set, an unresolvable id, or an empty corpus RED rather than green
- [ ] The band audit matrix is recorded in state.md with its BEFORE and AFTER columns, its
      predictions stated before the run, and any mismatch treated as a finding
- [ ] Every empty band the audit found is FILLED by an added row, never a substitution
      (R18), and no farm produce entered the gear chain, the Perfecting materials, or
      recipe_quickening_catalyst (R17)
- [ ] Both tests/recipe_economy.test.ts sorted literals re-derived from the merged
      ALL_RECIPES, every membership move named with its reason, and the non-vacuity floor
      re-derived rather than left behind
- [ ] The apex hoe matches the tier-5 family shape and price register exactly, sits at a
      rung a player can actually learn (decision A), and satisfies the hoe ladder's
      one-tier-below invariant with that invariant unchanged
- [ ] The apex hoe's bill is fine_evergarden_greens x2 plus osmium_hoe x1, with the halving
      derivation and the naming link stated in the row comment (or the recorded flip to
      fine_gilded_sunmelon if the naming verdict forced it)
- [ ] The stale items.ts comment claiming a tier-4 twin can never be a hoe reagent was found
      ALREADY CORRECTED by 11h and was not re-corrected here, and the tier-4 fine twin now
      has a named consumer
- [ ] BOTH hoe rungs carry their Marks row (osmium_hoe 24 / clears:3, the apex hoe 56 /
      heroicClear), the tripwire was re-decided in the open per decision B, both exact
      per-tier arms read five and five, the stock literal and the craftedTools floor were
      re-derived, the shop file's tool-row comment now reads ten rather than eight, and the
      craft-only pin narrowed to hoe rungs 1 to 3 with its reason written
- [ ] The wield gate needed no table change, and the tier-5 farming knife-edge is shown
      reachable against 11e's re-tuned curve
- [ ] Every content obligation discharged: ITEM_IMAGE_IDS row, art PARKED with exactly one
      mapping owner (parking is settled; this packet commits no WebP art), shipped-id golden
      re-minted additions-only, M16 guard run, wiki regen fresh, and both settled verdicts
      written with their sweeps actually run (no deed, by sibling precedent; no Reliquary
      page)
- [ ] docs/design/professions.md carries the fifth profession, the completed tool family,
      the supply matrix with no rotting counts, masterwrought R17 to R20 written in full so
      they cannot be read as that file's own Professions 2.0 R-numbers, and the reciprocal
      loop, and names the test as the live authority
- [ ] brainstorm.md carries the gathering-wide apex-tier scope record in the future-tier
      block
- [ ] The demand arm asserts PRESENCE only, counted over recipes.ts AND enchants.ts, and the
      ratio table with its outliers is recorded in state.md rather than asserted in the test
- [ ] Every packet R-number this phase wrote into src/, tests/ or docs/design/professions.md
      reads "masterwrought R<n>" in full, with no bare packet R-number left in source
- [ ] Full suite green; ci:changed clean; gate log read, not just its exit code

STEP 6 - DOCS: progress.md Phase 11j row; state.md ledger (the SIX decisions as EXECUTED,
each pointing at the 2026-08-20 delegation record rather than restating it, the audit matrix
with BEFORE and AFTER, the demand ratio table, every fill with its bill arithmetic, the apex
hoe's rung derivation and its naming verdict, the two delve Marks rows and the tripwire
re-decision, every re-derived pin as predicted-then-observed, the Phase 16 boundary for the
crafting half of professions.md, and the rejection list as recorded design);
farming/state.md's OPEN list updated in place (the tier-4 osmium_hoe Marks question CLOSED
by decision B, the fine-twin consumer hole closed), AND the dated AMENDED line added to D10
itself in farming/state.md (qr-DOC-DRIFT, state.md row 132: the hoe ladder is FIVE rungs,
the maintainer's overturn recorded with its reason, per the decisions-index amend-in-place
rule; updating only the OPEN list would leave D10's "four-rung ladder" text silently
contradicted); docs/design/professions.md and
brainstorm.md as above; memory note for anything that surprised you.

STEP 7 - REPORT: phase status, files, validation results, reviewer verdicts, the audit
matrix, the re-derived pin table (predicted versus observed per pin), the mutation proof
for the new test, and the handoff line for Phase 11j QA.

STOPPING RULES: stop if the state.md record of the 2026-08-20 delegation disagrees with any
of the SIX settled decisions in this file, or if that record is missing when the fan-out
would start (either is a records defect and a ledger line, never a fresh decision); if the
apex hoe cannot be authored at a rung a player can learn without
growing PRE_TRAINING_RECIPE_IDS; if a band can only be filled by substituting a row rather
than adding one, or by putting produce somewhere R17 forbids; if the coverage test can only
be made green by weakening the invariant (an exemption list, a narrowed subject set, or a
band the test stops iterating) rather than by filling a hole; if a thin-ladder top-up would
require inventing a numeric floor; if this phase's evidence contradicts a number 11e
through 11i recorded; or if the release merge conflicts inside src/sim/content/recipes.ts,
src/sim/content/items.ts, or tests/recipe_economy.test.ts.
```
