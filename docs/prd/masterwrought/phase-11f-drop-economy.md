# Phase 11f: Farming joins the drop economy

### Starter Prompt
```
This is Phase 11f of the Masterwrought feature: farming's recipes stop being trainer
homework and start dropping, exactly the way the packet's own apex recipes do.

Model: xhigh effort. Harness: Claude Code. Worktree: ~/Documents/wocc-masterwrought
(branch feature/masterwrought). ULTRACODE: yes (content batch; drive the re-tiering, the
pattern table, and the channel wiring through the ultracode Workflow fan-out).

THE MAINTAINER'S DIRECTION, quoted so nothing softens it: "just as raids and dungeons drop
recipes, farming should have the same. That is how integrated it should be."

Goal: close the structural asymmetry. All 14 farming recipes are acquisition ['trainer']
and the ladder flattens at skillReq 50 (4 rows at 0, 3 at 25, 7 at 50, nothing at 75, 100
or 125), while the packet's own 28 apex recipes are pattern drops climbing 75 / 100 / 125.
Seven deliverables, and NOT ONE of them invents machinery:
  1. Pattern items for farming's endgame recipes, on the shipped Phase 02 machinery,
     unchanged.
  2. The channel flip: the top rungs move from ['trainer'] to ['drop'], the low rungs stay
     trainer-taught so a new farmer can still start.
  3. Loot-table placement across raid, dungeon, and rift, append-only and rollGroup-safe.
  4. The deterministic valve: the Heroic Quartermaster sells farming patterns for Heroic
     Marks, so no pattern can fossilize.
  5. High-tier seed DROPS, layered on top of the vendor bootstrap 11e already landed.
     GATE 1 IS NOT THIS PHASE'S TO DISCHARGE: 11e discharges it, and 11e forbids a second
     bootstrap. This arm is additive reach, never a second faucet, and this phase VERIFIES
     the bootstrap still holds rather than re-authoring it.
  6. The rung climb: tier-3 rows to 75, tier-4 rows AND the harvest feast to 100, the
     bannock held at 50. Nothing farming owns lands on cooking 125.
  7. Golden Harvest joins the acquisition system instead of paying out a bigger pile of
     the same crop.

WHY NO NEW MACHINERY IS NEEDED, stated precisely because it is the whole thesis of the
phase and a reviewer will ask: farming's recipes are COOKING and ALCHEMY recipes. They are
already the same kind of object the apex patterns teach. src/sim/professions/pattern_items.ts
resolves a learn through exactly four reads (resolvePatternLearn): the recipe's acquisition
list must include 'drop'; the recipe must not already be known; the player's flat skill in
recipe.professionId must be above zero; and teachTierMet(recipe, meta.craftSkills) must
hold, which is tierForSkill(skill) >= tierForSkill(recipe.skillReq) over the shared
25-point band math in src/sim/professions/wheel.ts. Every one of those reads is already
true of a farm recipe. RecipeItemDef.teachesRecipeId points at a recipe id and does not
care which craft owns it. So this phase is content rows plus channel wiring, and any agent
that finds itself editing pattern_items.ts, training.ts, or wheel.ts has taken a wrong
turn: that is a STOP, not a workaround.

WORKTREE GUARD (do this FIRST; the user runs multiple concurrent sessions): run pwd.
If you are not in /Users/fernando/Documents/wocc-masterwrought, switch this session into
it NOW with the EnterWorktree tool (path: /Users/fernando/Documents/wocc-masterwrought).
If EnterWorktree is unavailable or refuses, STOP and ask the user to relaunch Claude Code
from that directory. Phase work never runs from the main checkout at
~/Documents/world-of-claudecraft.

STEP 0 - PRE-FLIGHT (canonical Team Workflow, docs/prd/masterwrought/implementation-plan.md):
- git status clean, with the absorb phases 11b to 11e CLOSED including their QA twins: the
  merged tree tsc-clean, 11d's export and symbol census green, and every pin 11d re-derived
  recorded predicted-then-observed. If that census has not run, STOP. This phase re-tiers
  and re-channels rows 11b merged and 11c settled, and a dropped merge hunk discovered
  after 11f is indistinguishable from an 11f authoring bug.
- THE RIFT RANK RESIDUAL IS A PRECONDITION, SETTLED 2026-08-20. The record-and-accept on the
  missing rift rank goldens is OVERTURNED: the rank parameter on the riftClearRewards
  factory, three SCENARIOS appends at baseLevel 20/22/28, one coverage arm and an
  UPDATE_PARITY mint each, plus the sibling heroic-claim Nythraxis residual recorded with it,
  all close BEFORE this phase or as this phase's own FIRST commit. Seed hunting is needed
  only for the B/S in-window picks (about 1 in 12 seeds). WHY: DECISION E appends a new draw
  AFTER draw 6 in the rift reward stream on winning B/A/S clears and a rollGroup at the
  nythraxis_boss_arena tail, which is exactly the rank-local insertion those goldens cover;
  half a day of plain addition buys stream-position coverage for the change this phase is
  about to make. If the residual is still open when the fan-out would start, close it first.
  Do not append into an uncovered stream.
- SYNC RELEASE: git fetch origin --prune, discover the newest release branch by version
  sort (git branch -r | grep 'origin/release/' | sort -V | tail -1), merge it, run the
  release-merge-audit skill. A minor-version-or-more jump runs as its own phase first.
- MERGED-TREE DISCOVERY, run BEFORE the fan-out so the settled decisions are EXECUTED
  against facts and not against this document:
  - Print the merged FARM_RECIPES rung table (id, professionId, skillReq, acquisition,
    itemLevelBudget, level, resultItemId). The expected shape is 4 rows at 0, 3 at 25, and
    7 at 50, with recipe_growth_tonic the one alchemy row at 0. If the merged table
    disagrees, the disagreement is the news: record it and re-derive every count below.
  - Print the merged shipped scaffolding tuples per rung from ALL_RECIPES (skillReq ->
    [itemLevelBudget, level]). On the masterwrought tip they read 75 -> [20, 20],
    100 -> [25, 25], 125 -> [25, 25] for the consumable capstones, and the farm rows at 50
    already read [20, 20]. Reuse the shipped points; never mint a new tuple. This phase
    consumes ONLY the 75 and 100 tuples: under DECISION A no farming row reaches 125.
  - Print HEROIC_VENDOR_STOCK. The mark family has exactly TWO price points today, 12 (the
    ring point) and 16 (the neck point). There is no point below 12. DECISION E uses ONLY
    the 12 point, for every farming pattern and every upper-tier seed.
  - grep the four shipped tier-3 and tier-4 seed ids (highland_barley_seed,
    frost_gourd_seed, gilded_sunmelon_seed, evergarden_greens_seed) plus 11e's four new
    upper-tier seed ids across every vendorItems array and every loot table. THE EXPECTED
    ANSWER IS A VENDOR HIT FOR EVERY ONE AND ZERO LOOT HITS: 11e discharged GATE 1 by
    stocking all eight at farmer_hollis and farmer_verbena, so this phase authors NO copper
    floor row and NO vendor row for any seed. If a seed is MISSING from vendorItems, GATE 1
    did not actually land and that is a STOP, not something to patch here. Record the
    observed vendor rows in the ledger as the bootstrap this phase built on.
- SETTLED DECISIONS (2026-08-20, the full delegation). Five decisions gate this phase and
  ALL FIVE ARE ANSWERED. The rulings are recorded in docs/prd/masterwrought/state.md under
  "Decisions closed 2026-08-20 (the full delegation)" (11b STEP 6 migrates that block into
  farming/state.md's handoff table, where every phase from 11e onward is told to read it).
  Execute them as written and re-state each one in this phase's ledger row as executed.
  Nothing here is confirmed with the maintainer, and a decision that appears to need
  re-opening is a STOP that goes back to the packet record, never a session choice.

  DECISION A, SETTLED 2026-08-20 (THE RUNG CLIMB, deliverable 6). Re-tier the farm ladder
  BAND-COMPLETE, and stop it at 100. It also discharges farming's handoff row "tier-3
  rung-50 domination (three rungs for four tiers)".
    - recipe_highwatch_gourd_soup and recipe_highwatch_barley_porridge to skillReq 75,
      scaffolding [20, 20].
    - recipe_evergarden_sunmelon_tart, recipe_evergarden_harvest_platter and
      recipe_evergarden_braised_greens to skillReq 100, scaffolding [25, 25].
    - recipe_harvest_feast to skillReq 100, scaffolding [25, 25]. NOT 125.
    - recipe_highwatch_barley_bannock HELD at 50 as the band-50 anchor. It is the one
      rung-50 dish with no fine twin in it (its own comment says so), the plainest row in
      the set, and holding it is what keeps band 50 non-empty for R20.
    The resulting band table is 0:4, 25:3, 50:1, 75:2, 100:4, 125:0. Still exactly 14 rows,
    still zero new item ids. Farming's ladder is band-complete from 0 through 100 and owns
    no cooking-125 row at all.
    WHY: all 14 FARM_RECIPES rows are cooking rows (13 cooking plus recipe_growth_tonic on
    alchemy), so these rungs are COOKING rungs, and R17 says produce feeds cooking at every
    rung while the shipped ladder traps every produce row below cooking 50. Putting the
    feast at 125 would collide head-on with 11k's apex feasts and falsify 11k deliverable
    2's premise that harvest_feast is "the party-tier rung below"; at 100 the feast ladder
    is a real two-rung climb (party feast at cooking 100, raid feasts at cooking 125).
    Re-tiering advertised rungs costs nothing because farming has not shipped to players:
    it lives on feature/farming-plan and reaches players only through this packet's one PR,
    so this is authoring, not a retune.
    REJECTED, move all seven rows and author a new rung-50 row: a new row is a new item id
    and its whole obligation stack (WebP art, M16 fills, wiki regen, economy pins), bought
    to satisfy a band the shipped bannock already satisfies for free.
    REJECTED, the feast at cooking 125 behind a recorded second-capstone exception: the
    exception is NOT taken and is NOT needed, so DO NOT record one. Produce still reaches
    cooking 125 through 11h's apex bills and 11k's apex feast bill, and taking no exception
    beats taking a defensible one.

  DECISION B, SETTLED 2026-08-20 (THE CHANNEL FLIP SCOPE, deliverable 2). Apply R8's channel
  rule to the re-tiered ladder as ONE rule, never row by row: every farm row at rung 75 or
  above flips to acquisition ['drop'], tradable, bind on learn, and every row at rung 50 or
  below stays ['trainer']. Under DECISION A that is exactly SIX rows flipping (gourd soup,
  barley porridge, sunmelon tart, harvest platter, braised greens, harvest feast) and EIGHT
  staying trainer-taught (four at rung 0 including recipe_growth_tonic, three at 25, and the
  held bannock at 50). Write the acquisition assertions in tests/farm_recipes.test.ts as
  RULE-DERIVED expectations, never as a row list.
  WHY: a rule that derives from the rung cannot drift row by row, which is what makes the
  ladder legible and the test non-vacuous. The six-and-eight split survives the feast moving
  to 100 because the boundary at 75 does the work, not the individual rows, and the rung-0
  growth tonic staying trainer-taught is what keeps the tonic reachable before any drop
  channel exists, so a new farmer can still walk to a trainer and start.
  THE GROWTH TONIC'S APEX RUNG, settled N/A: no alchemy row above rung 50 outputs a farming
  knob on the merged tree. Record that arm N/A with the reason and DO NOT mint one; a new
  alchemy rung is another phase's content and minting it here would double-author it.

  DECISION C, SETTLED 2026-08-20 (THE GOLDEN HARVEST DRAW, deliverable 7). Take ONE
  unconditional contiguous ctx.rng draw at harvest, immediately after the golden-harvest
  roll, spent on EVERY resolving arm (survived, withered, and the defensive retired-crop
  arm) and READ only when the golden roll won. The draw contract becomes: tier 1/2 harvest
  EXACTLY 2 contiguous draws, tier 3/4 harvest EXACTLY 3, every deny arm still 0, plant
  still 2, the tick sweep still 0. Restate the DRAW CONTRACT header in
  src/sim/professions/farming.ts WHOLE; never amend one line of it. Re-record
  tests/parity/golden/farming_session.json in its OWN isolated last commit, with the machine
  classification recorded and no other golden in that commit. architecture-reviewer, on the
  determinism lane, is a REQUIRED dispatch for this slice.
  WHY: farming's mulberry32 path is deliberate SEED EXPANSION of the plant-time yieldSeed
  and never a new source, which is why a harvest can draw zero, but stacking growth, yield,
  tonic, golden and now a golden bonus onto one 32-bit seed asks that seed to carry more
  independent structure than it was sized for. An unconditional contiguous draw is the
  shipped idiom that keeps stream position stable whichever arm resolves, and restating the
  header whole is the shipped discipline that stops a contract being amended into
  incoherence.
  REJECTED, zero new draws by reading further into the mulberry32 expansion of yieldSeed the
  way the growth tonic does: cheaper, and it would leave the draw contract and the
  farming_session golden untouched, but it overloads a seed already carrying four dependent
  reads. Do not re-propose it as an economy.

  DECISION D, SETTLED 2026-08-20 (WHAT THE GOLDEN BONUS PAYS, deliverable 7). On a golden
  harvest the bonus draw pays exactly ONE extra item from a small documented table: a SEED
  (the NEXT tier's seed at tiers 1 to 3, the SAME tier's seed at tier 4, so the golden event
  is itself an upward-drift faucet), or at a lower weight ONE farming pattern from this
  phase's set. Zero new item ids either way.
  THE WEIGHTS ARE DERIVED, NOT CHOSEN, and this is an instruction with an acceptance
  criterion rather than a question: derive the cadence from the SHIPPED rare-event rate the
  golden roll already uses (farming's (bs) cadence read is 1 in 90 per harvest times
  survival), flag the table's constants at their definition in farming's own idiom, and
  record the expected seeds-per-day and patterns-per-day at the ledger row so Phase 15 and
  the R19 model read a number somebody computed. ACCEPTANCE, and it is binding: the pattern
  arm's expected rate is strictly SLOWER than the quartermaster marks route, so the
  deterministic channel stays the real path. A weight set that fails that comparison is
  re-derived, not shipped.
  WHY: D13 makes a luck-gated trigger worth zero Renown and forbids it being the only faucet
  for any pattern, and the marks valve (deliverable 4) is what makes the pattern arm safe at
  all. The upward-drift seed payout makes a lucky tier-2 farmer's first tier-3 seed a moment
  rather than a purchase, without ever being the only way to get one.

  DECISION E, SETTLED 2026-08-20 (SEED AND PATTERN PLACEMENT AND PRICES, deliverables 3, 4,
  5). Mirror Phase 11's recorded channel shape, one appended draw per pillar, with the rung
  labels corrected to DECISION A. Every placement set below is named by RULE and DERIVED
  from the merged FARM_CROPS and the merged flipped set; the parenthesised counts are the
  shipped-roster planning read, and 11e-D-B grows the upper-tier seed roster from four to
  eight, so derive the set and never paste a count from this document.
    - RAID (nythraxis_boss_arena, content/dungeons.ts): ONE new rollGroup appended at the
      table tail, beneath the existing 'nythraxis_patterns' group, carrying
      pattern_harvest_feast (the farm ladder's pinnacle, now rung 100) and every TIER-4 seed
      (two on the shipped roster, four after 11e-D-B). Never insert, never reorder, never
      touch a row above it. The pinnacle farming pattern rides the pinnacle encounter; only
      the rung word moved.
    - RIFT (addRiftClearGearLoot, src/sim/rift/progression.ts): ONE appended draw AFTER the
      existing draw 6 (the apex-pattern roll), over a sorted exported id list in the shape
      RIFT_PATTERN_ITEM_IDS already ships, carrying the OTHER THREE rung-100 patterns and
      every tier-3 and tier-4 seed, on winning B/A/S clears. The C arm still returns after
      draw 0, so C never reaches it, which is the same designed split R8 recorded.
    - DUNGEON (the heroic five-mans): the two rung-75 patterns. Read tests/dungeons.test.ts's
      ungrouped-set pin (the four reins) FIRST and append as a TAIL ROLLGROUP rather than as
      ungrouped HEROIC_BOSS_LOOT entries if that pin would move. On the evidence available it
      WILL move, so plan for the tail group. WHY: the ungrouped set is pinned as an exact set
      precisely so a new ungrouped entry is a visible decision, and a tail group appends
      without moving it and keeps loot draw order stable for the parity goldens. This is the
      pillar the packet has never used for a recipe, so the lowest-risk append shape is the
      right one. Read tests/nythraxis_raid_unit.test.ts's rollGroup pins before writing too.
    - HEROIC QUARTERMASTER (content/heroic_vendor.ts): ALL SIX farming patterns at 12 marks
      and EVERY tier-3 and tier-4 seed at 12 marks, as a bad-luck BACKSTOP on the
      wyrmfall_core precedent (that row's own comment says "a bad-luck backstop for the last
      core, never a farm that outpaces the boss faucet"), so nothing in this phase can
      fossilize. NO farming row sits at the 16 (neck) point, because no farming pattern
      reaches rung 125. Minting a new mark price point below 12 stays reserved and is NOT
      taken here.
      WHY 12 IS DERIVED AND NOT CHOSEN: the shipped mark family has exactly two points, 12
      for the skill-100 patterns and 16 for the skill-125 capstones, and under DECISION A
      every farming pattern teaches a rung-75 or rung-100 row.
    - THE COPPER FLOOR IS NOT IN THIS PHASE. 11e already gave farmer_hollis
      (content/zone3.ts, Highwatch) and farmer_verbena (content/evergarden.ts, Evergarden)
      their eight seed rows with derived positive buyValues, and that IS the copper floor
      and the GATE 1 bootstrap. This phase does not add, re-price, or re-derive a single
      vendor seed row. READ those rows and their recorded base-plus-premium arithmetic so
      the mark prices above sit correctly relative to the copper floor, then leave them
      alone. A price revisit is an 11e amendment made in 11e's ledger, not a second edit to
      the same rows from here.

- Memory scan (MEMORY.md index): new-item-content-hidden-obligations,
  item-art-ownership-batch-xor-entries, the test-pin trap index (READ it before touching
  any pin: predicted-then-observed, constant-self-comparison, comment-gameable source pins,
  vitest -t is a regex), i18n-reword-staleness, m16-wordy-english-requires-nonlatin-fills,
  release-merge-gate-surprises, and the parity and golden entries.

STEP 1 - LOAD CONTEXT (Explore agent; do not read planning docs in the main loop):
- docs/prd/masterwrought/state.md: R8 (the channel doctrine), R13 (skill placement), R15
  (IP naming) and the naming registry, the Phase 11 pre-fan-out ledger with its recorded
  CHANNEL ASSIGNMENT block (the rates, the mark prices, the "acquisition STAYS ['drop']"
  paragraph, and the known pin movements it lists), the Power placement block, the
  validation matrix, and the four NEW rulings R17 (the Provisioner Rule), R18 (the
  Anti-Compulsion Guardrail), R19 (farming is a long-haul skill), R20 (every gathering
  profession reaches the endgame).
- docs/prd/masterwrought/farming/state.md: MAINTAINER GATES item 1 (GATE 1 in its own
  words), D11 (the counter rule and the dead-row trap), D13, D17, D21, D24, the deviations
  (aj) trainer fees on reagent-dormant rungs, (bo) the missing tier 3/4 faucet with its
  four bootstrap options, (bs) the dormant-deed waiver, (bz) the whole-list invariant,
  (ca) the reconciliation, and the OPEN list.
- docs/prd/masterwrought/progress.md (the Phase 11f row) and decisions-index.md.
- Machinery, READ ONLY and NOT modified this phase: src/sim/professions/pattern_items.ts
  (resolvePatternLearn's four arms and their deny ORDER, useRecipePatternItem's consume),
  src/sim/professions/training.ts (teachTierMet, trainingStationTypeFor),
  src/sim/professions/wheel.ts (tierForSkill, TIER_SKILL_STEP),
  src/sim/professions/crafting.ts (acquireRecipe and the wrong-source refusal).
- Content: src/sim/content/recipes.ts (FARM_RECIPES verbatim with every comment,
  INTERMEDIATE_RECIPES, APEX_CONSUMABLE_RECIPES and its header's uniform-bill and
  gold-negative rules, ALL_RECIPES composition); src/sim/content/apex_patterns.ts (the
  pattern_<output item id> contract, the per-craft display prefixes, the def shape);
  src/sim/content/heroic_vendor.ts (HEROIC_VENDOR_STOCK and the two mark points);
  src/sim/content/dungeons.ts (the nythraxis table tail and its never-insert comment,
  HEROIC_BOSS_LOOT); src/sim/rift/progression.ts (the numbered draw order 0 to 6,
  RIFT_PATTERN_ITEM_IDS, RIFT_PATTERN_CHANCE); src/sim/content/farm_crops.ts (FARM_CROPS,
  farmCropSkillThreshold, FARM_CROP_IDS and the persisted-save-key warning);
  src/sim/content/items.ts (every seed, produce, and fine-twin row with its sellValue and
  buyValue); src/sim/content/zone3.ts and evergarden.ts (both farmers' vendorItems arrays).
- Sim: src/sim/professions/farming.ts, and specifically its DRAW CONTRACT header, the
  KNOBS RULE beneath it, resolveFarmHarvest, the seed-back arm, the golden-harvest roll site
  (rollGatherRareEvent) and the mulberry32 yield expansion.
- Surfaces: scripts/build_content.mjs (the generator arm that emits a vendor-channel
  acquisition for recipes whose teaching pattern id is in HEROIC_VENDOR_STOCK) and
  src/guide/pages/professions_craft.ts (guide.profPages.sourceDrop and sourceVendor);
  src/ui/icons.ts (the MERGED ITEM_ART_PENDING set and the mapping.json owner rule).
- Tests that will move: apex_pattern_items, recipe_pattern_items, heroic_vendor,
  nythraxis_raid_unit, dungeons, recipe_economy, farm_recipes, professions_farming,
  professions_zone_rollout, farmer_vendor_purchase, deeds_content, shipped_item_ids, guide,
  and the tests/parity suite.
- src/sim/CLAUDE.md.
Return: the merged FARM_RECIPES rung table; the shipped scaffolding tuple per rung; the two
mark price points and every current stock row; the rift draw indices and the raid table
tail; both farmers' vendorItems arrays verbatim; every seed and produce sellValue and
buyValue off the MERGED table; the merged ITEM_ART_PENDING size and its owner rule; the
EXACT behavior of the wiki source column when a pattern is in a drop table AND in
HEROIC_VENDOR_STOCK at the same time; and the merged draw-contract header text.

STEP 2 - EXECUTE (parallel fan-out, explicitly; six agents by vertical slice):

Agent 1 (THE RUNG CLIMB AND THE CHANNEL FLIP):
- Re-tier per DECISION A and flip per DECISION B, in src/sim/content/recipes.ts
  FARM_RECIPES only.
  Reuse the shipped scaffolding tuples; never mint one. Every moved row keeps its reagents,
  its resultCount, its stationType 'kitchens', and its comment, with the comment AMENDED to
  state the new rung and the channel and why (a stale comment beside a moved number is the
  defect this phase is most likely to leave behind).
- MAGNITUDES ARE FROZEN. This phase changes rungs and channels. It does NOT touch a single
  foodHp value, well-fed magnitude, duration, aura id, charge count, or output quality. 11c
  settled the ladder and R5 is measured against it. If a re-tiered row appears to need a
  power change to make sense, that is a STOP, not an edit.
- Output QUALITY stays exactly as shipped, which means the rung-100 farm dishes will read a
  lower quality than masterwrought's rung-100 apex consumables. That is correct and it is
  recorded, not fixed: farming's dishes are not apex-flagged, their power is 11c's, and the
  climb is about ACCESS and LADDER SHAPE, never about power. Re-derive QUALITY_BY_RUNG in
  tests/farm_recipes.test.ts FROM the shipped defs rather than assigning new qualities.
- Move the pins this touches, all in tests/farm_recipes.test.ts, and re-derive rather than
  hand-edit: SCAFFOLDING_BY_RUNG gains the 75 and 100 tuples; the "is not a rung
  (0, 25, 50)" assertion message becomes the real merged rung set; every
  expect(...acquisition).toEqual(['trainer']) becomes a per-row expectation derived from the
  rung rule (assert the RULE, so a future row cannot land on the wrong channel silently);
  the feast's "capstone content on the rung-50 band" pin moves to 100; and the
  more-than-one-distinct-rung non-vacuity arm stays and widens.
- Add the BAND-COMPLETENESS pin here, not in a test elsewhere, in TWO arms so the intent
  survives a later row: (i) the EXACT expected map over the merged FARM_RECIPES, spelled as a
  derived computation and recorded predicted-then-observed, which under DECISION A reads
  0:4, 25:3, 50:1, 75:2, 100:4 with no row at 125; and (ii) a non-emptiness arm over every
  25-point band from 0 THROUGH 100, which is farming's arm of R20 and is the half that must
  keep biting if a future phase adds a row at 125. Emptying a band reds immediately.
- Discharge deviation (aj) in the same change: the 2500 and 10000 trainer fees on the
  formerly reagent-dormant rungs stop existing, because those rows are no longer
  trainer-taught. Record the closure in farming/state.md's OPEN list; do not leave a
  settled question on the list.
- itemLevelBudget and level move for the climbing rows, which raises their craft gold fee
  and re-indexes their source level. Assert, do not assume, that a food output carries no
  slot and is therefore not item-level ELIGIBLE, so no item-level budget pin moves. If one
  does move, that is a finding and it is recorded before it is fixed.

Agent 2 (THE PATTERN TABLE):
- One RecipeItemDef per flipped recipe, in a NEW sibling content module
  src/sim/content/farm_patterns.ts merged by data.ts beside apex_patterns.ts, with a header
  comment in apex_patterns.ts's own voice stating the id contract, the channel doctrine, and
  why the table is separate. Separate because module-first is this repo's default for new
  tables, because farming's block stays contiguous under the three-tier ordering rule 11b
  established, and because apex_patterns.ts's header is a recorded statement about the 28
  MASTERWROUGHT apex recipes that must stay literally true.
- Def shape copies the shipped one exactly (types.ts RecipeItemDef): kind 'recipe',
  teachesRecipeId, and nothing else. No use, no stackSize, no soulbound, no noMarketList.
  Patterns are ordinary tradable drops that bind by CONSUMPTION at learn time.
- Ids follow the shipped contract pattern_<output item id>. Display names follow the shipped
  per-craft prefix table: cooking and alchemy both take "Recipe:". So every name in this
  phase is "Recipe: " plus an ALREADY SHIPPED item name, which means this phase mints NO new
  proper noun. Run R15 and D17 anyway and RECORD THE VERDICT ("no new coinage; every name is
  a shipped display name behind the registered per-craft prefix") in naming-audit.md, because
  a sweep whose verdict is unwritten is a sweep nobody can audit.
- quality and sellValue, SETTLED 2026-08-20. QUALITY DERIVES from the taught row's OUTPUT
  quality, computed from the merged catalog per pattern and never uniform: farming's dish
  outputs are common, uncommon and rare, unlike the apex set's uniform epic, and recipe
  rarity is pinned monotone to the power of what it teaches. sellValue stays UNIFORM across
  the whole farming pattern set at the shipped point of 100, the same single point all 28
  apex patterns use. Record the derivation beside the table.
  WHY: sellValue on a kind 'recipe' item is a vendor floor for a tradable teaching item, not
  a power statement, and the shipped catalog carries exactly ONE point for that entire class,
  so reusing it keeps the recipe class one-priced and lets the rung be carried by the mark
  price and the channel, which is where the packet already carries it.
  REJECTED: minting a second sellValue point for the farming set. It would be a number nobody
  measured, bought to restate a rung two other surfaces already state.
- THE UNIVERSE PIN, and it is the one that will red first:
  tests/apex_pattern_items.test.ts asserts exactness BOTH ways, that every shipped
  kind:'recipe' def in ITEMS is one of the 28. Adding farming patterns reds it. Re-cut it to
  a UNION over the two tables, derived from APEX_ARMOR_RECIPES / APEX_GEAR_RECIPES /
  APEX_CONSUMABLE_RECIPES plus the flipped farm set, keep both directions, keep the counts
  spelled as predicted-then-observed literals, and keep it non-vacuous (a union pin that
  derives both sides from the same expression proves nothing).
- tests/recipe_pattern_items.test.ts is the generic behavior sweep. Add the farming arms it
  now needs: a farm pattern learns and consumes exactly one copy; the tier gate refuses a
  cooking-75 pattern at cooking 50 and a cooking-100 pattern at cooking 75, without
  consuming; the profession arm refuses a player who has never cooked; already-known refuses
  first; and a farm pattern is market-listable like every other pattern.

Agent 3 (LOOT PLACEMENT, THE VALVE, AND THE WIKI SOURCE LABEL):
- Implement DECISION E's placement exactly. APPEND-ONLY is the contract, not a preference:
  never insert above an existing entry, never reorder, never re-cut an existing rollGroup's
  membership. Every rate and every price is RECORDED in state.md at the row and in the
  ledger, as Phase 11 recorded its 0.04 partition and its 0.08 rift chance.
- The rift arm exports its id list SORTED, the way RIFT_PATTERN_ITEM_IDS is exported and for
  the same stated reason: the rng.int pick indexes it, so the order is part of the draw
  contract and a re-sort is a determinism change.
- Quartermaster rows land at the DECISION E price (the 12 point, every row), appended at the
  tail of HEROIC_VENDOR_STOCK
  under the three-tier ordering rule. The consequences, named so they are re-derived and not
  hand-edited: the stock length pin moves; the PATTERN_PRICES literal in
  tests/heroic_vendor.test.ts moves; that file's test TITLE currently spells the old
  composition ("exactly the eight apex consumable patterns, six at 12 and two at 16") and
  becomes false, so reword it; and its gear-shape loop, which already excludes non-gear rows
  like wyrmfall_core, must exclude the seed rows too. Extend the exclusion by KIND, never by
  a growing id list.
- THE WIKI SOURCE LABEL, and this is a genuine new case nobody has hit: the generator arm in
  scripts/build_content.mjs emits a vendor-channel acquisition for any recipe whose teaching
  pattern id is in HEROIC_VENDOR_STOCK, and professions_craft.ts renders sourceVendor for it.
  Every farming pattern in this phase is in a DROP table AND on the quartermaster, which no
  shipped pattern has ever been (Phase 11 put its consumable patterns in neither drop
  channel). Left alone, the generator silently labels a raid drop as vendor-only, and a
  player reading "From the Heroic Quartermaster" never looks in the raid. FIX IT AT THE
  GENERATOR: emit BOTH channels and render a combined source row (a new English-only
  guide.profPages key beside sourceDrop and sourceVendor), so the copy states what is true.
  Keep the render-level row pin in tests/guide.test.ts honest for all THREE cases now
  (drop-only, vendor-only, both), and regenerate with npm run wiki:content.
- Draw-order proof is a deliverable, not a hope: the parity suite green, and no loot golden
  changed except by append. Predict which goldens can move before running, then run.

Agent 4 (THE SEED DROP ARM, LAYERED ON 11e's DISCHARGED GATE 1):
- The seed entries in the raid, rift and quartermaster placements per DECISION E. NO vendor
  rows: 11e owns the copper floor and already landed it, and re-authoring those rows here
  would be the second bootstrap 11e explicitly forbids. Zero new item ids, no change to the
  seed-back roll, no change to any farmer counter, no change to golden_harvest (that is
  Agent 5's).
- FIRST ACT, BEFORE ANY EDIT: verify 11e's bootstrap is actually in the merged tree (all
  eight upper-tier seeds stocked with positive buyValues at farmer_hollis and
  farmer_verbena, the three named recipes completable, prog_farming_100 and
  feat_book_complete earnable, the (bs) waiver in docs/design/deeds.md already CLOSED with
  11e as its closing phase). If any of that is missing, STOP and raise it; do not fix 11e's
  deliverable from inside this phase.
- THE IDENTITY GUARD, and it is the most important sentence in this agent's brief. Seeds
  dropping from endgame content must never make farming's top tiers CONDITIONAL on raiding.
  Farming's own thesis is that it converts logins into progress for a player who does not
  keep a raid schedule. So: the seeds are tradable and market-listable (kind 'junk'), the
  farmer counters sell them for copper, and the seed-back rolls (tier 3 at 0.08 / 0.40,
  tier 4 at 0.06 / 0.35) remain the thrift path once bootstrapped. PIN IT: a test proves all
  upper-tier seeds are obtainable by a character who never enters a raid, a rift, or a
  heroic five-man, with the seed set derived from FARM_CROPS (four on the shipped roster,
  eight after 11e-D-B) and never from a count in a document. That test is R18's shape applied
  in the reverse direction and it is what makes the drop arm additive rather than
  compulsory.
- The dormancy record, the (bs) waiver, the deed earnability arm, NEVER_STOCKED,
  tests/farmer_vendor_purchase.test.ts, the vendor-walk width pins, and the fine-twin
  buyValue OPEN row are all 11e's, discharged in 11e. This agent RE-READS them to confirm
  they are still green after the drop rows land, and edits none of them. If the drop arm
  moves one of those pins, say which and why in the ledger before touching it.
- WHAT THIS PHASE MUST PROVE INSTEAD, and it is the arm 11e cannot prove: the drop and mark
  channels reach every upper-tier seed WITHOUT making them reachable only that way. A test
  shows each seed obtainable by a character who never enters a raid, a rift, or a heroic
  five-man (the vendor path 11e built), and a second shows the new loot and quartermaster
  rows actually yield the seed. That pair is what makes the drop arm additive rather than
  compulsory, which is R18 read in the reverse direction.
- Guide and wiki: with the drop and mark channels added, a seed now has THREE sources
  (farmer, loot, marks). Regenerate so the guide states all of them, and keep the
  render-level row pin honest for the three-source case. tests/guide.test.ts gates the
  freshness. Any dormancy-disclosure prose was already deleted in 11e; confirm none
  regressed rather than deleting it twice.

Agent 5 (GOLDEN HARVEST JOINS THE ECONOMY):
- Implement DECISION C and DECISION D in src/sim/professions/farming.ts. The draw is
  unconditional, contiguous, and at ONE documented position; the header's DRAW CONTRACT is
  restated whole, not amended in one line; the KNOBS RULE paragraph beneath it is re-read
  and confirmed still true of the new draw.
- The bonus table is data-as-code with its constants flagged at the definition in farming's
  own idiom. The seed arm pays an EXISTING seed id; the pattern arm pays an EXISTING pattern
  id from Agent 2's table. Zero new ids. DECISION D's acceptance criterion is this agent's to
  satisfy and to print: the pattern arm's expected rate is strictly SLOWER than the
  quartermaster marks route, with both rates recorded at the ledger row.
- The golden windfall already lands SIGNED through the node rare-event idiom and already
  writes the gather_event:golden_harvest visit mark. Reuse both. Do not mint a second
  celebration beat, a second zone announcement, or a second Discord card: the merged
  celebration family is shared and Phase 13 has to live beside it.
- The parity re-record is the LAST commit of the phase, isolated, with the machine
  classification recorded and nothing else in it. Predict which scenarios move before you
  run UPDATE_PARITY, then run, then require the observed set to equal the predicted set. A
  scenario that moves and was not predicted is a finding, not a re-record.

Agent 6 (TESTS, RULINGS, AND THE OBLIGATION SWEEP):
- THE REFERENTIAL PIN, both directions, in its own suite: every farming pattern teaches a
  recipe that exists on the merged ALL_RECIPES; every farm recipe whose acquisition includes
  'drop' has exactly one pattern; no orphan either way; and every hosting boss, rift pool,
  and vendor row named by this phase exists in live content. Also the reachability arm: no
  recipe became UNOBTAINABLE, meaning every flipped row is reachable through at least one
  live channel and every unflipped row is still on a real trainer's teach list.
- R17 (THE PROVISIONER RULE) as tests, not intentions: no farm produce, fine twin, or seed
  appears in recipe_quickening_catalyst, in any Perfecting material, or in any gear
  intermediate (billet, plating, cording, bolt, setting, chassis). Assert the absence as a
  sweep over the merged ALL_RECIPES, so a future row cannot violate it quietly. THIS SWEEP
  LIVES IN ITS OWN NAMED FILE, tests/provisioner_firewall.test.ts, and this phase CREATES
  it (qr-R17-SWEEP, state.md row 131): 11h Agent 5's FARM_CROPS-derived firewall EXTENDS
  this same file rather than authoring a sibling, so the one invariant has one guard and
  the carve-out shape cannot fork.
- R18 (THE ANTI-COMPULSION GUARDRAIL) as tests: every farm produce item is kind 'junk' and
  market-listable; the tier-1 and tier-2 seeds stay vendor-stocked; and nothing this phase
  adds SUBSTITUTES a farming row for an herbalism row anywhere (farming rows are added
  alongside herbs, never in place of them, which is also farming's own D24 displacement
  guardrail).
- R20's farming arm: the two-armed band-completeness pin Agent 1 wrote (bands 0 through 100
  non-empty, plus the exact map), plus a recorded count of
  farming's endgame bills (rows at skillReq >= 75 that name a farm reagent) handed forward
  in the ledger, so whichever phase owns R20's cross-profession census reads a number this
  phase measured. Do not author the cross-profession census here; it spans four other
  gathering professions this phase does not touch.
- R19's input, handed forward and not decided here: the seed faucet changes tier-3 and
  tier-4 produce availability, which is an input to the measured calendar-days-to-100 model.
  Record the observed seeds-per-clear, seeds-per-copper, and golden seeds-per-day at the
  ledger.
- tests/recipe_economy.test.ts is edited by BOTH packets and carries two sorted literal pins
  (the intermediate-bill literal table and the counterfactually-vendor-fed membership list).
  BOTH are RECOMPUTED from the merged ALL_RECIPES and never hand-merged: a resolution that
  keeps one side's literal goes green while silently deleting the other side's guard. The
  upper-tier seeds 11e priced (four on the shipped roster, eight after 11e-D-B) already
  moved the buyValue landscape the derivation reads, so recompute against the MERGED tree
  and re-run it AFTER Agent 4 lands, never against a parent's literal. The non-vacuity floor
  beneath the membership pin stays and moves with
  the set. Confirm the (bz) whole-list invariant still holds for every re-tiered row.
- THE OBLIGATION SWEEP for the six new pattern ids, with all four verdicts SETTLED
  2026-08-20 and every sweep still RUN rather than assumed (the content-obligations reviewer
  treats an unwritten verdict as a gap, so silence is the failure mode, not a wrong answer):
  - ART: PARK all six ids on the MERGED ITEM_ART_PENDING allowlist with exactly ONE
    mapping.json owner, and record the park with its reason. Committed WebP art needs the
    maintainer's master SHA, which a phase session cannot produce, so parking is the settled
    packet-wide answer and not a shortcut. THE TRAP: one owner per id, the batch form or the
    entries form, never both, or the six double-own.
  - NAMING: no new coinage. Every pattern name is "Recipe: " plus an already-shipped display
    name behind the registered per-craft prefix, so R15 and D17 are satisfied by
    construction. WRITE that verdict in naming-audit.md, because it is what explains why six
    new ids need no naming audit.
  - DEEDS: none. Re-channelled content is not new conquerable content. Run the sweep, write
    the verdict.
  - RELIQUARY: no page. A recipe pattern is not conquerable unique loot. Run the sweep, write
    the verdict.
  M16 non-Latin fills for the wordy English names land IN THIS CHANGE (several shipped dish
  names are wordy). npm run wiki:content with tests/guide.test.ts freshness green.
  tests/shipped_item_ids.test.ts append-only green. Nothing new in world_entity_i18n.ts,
  because this phase places no entity, stated rather than left blank.

INVARIANTS IN PLAY: no new machinery (pattern_items.ts, training.ts, wheel.ts, and
crafting.ts are READ ONLY; editing one is a STOP); R8 (recipes reach players through the
three pillars and no fourth channel); R9 (the cores-only daily gate is not extended; this
phase adds NO oncePerDay stamp and no daily of any kind); R13 (the shipped skill placement
is the ladder this phase climbs onto, 75 and 100, and nothing farming owns reaches 125);
R14 (no new proc effects and no new aura id); R15 and D17 (naming verdict recorded even
when nothing new is coined); R17, R18, R19, R20 as above; D8 (no mid-growth interaction: a
seed drop is a reward, not a fifth knob); D11 (every stocked row carries a positive
buyValue; produce stays market-listable);
D13 and docs/design/deeds.md (zero Renown on a luck-gated trigger); farming's DRAW CONTRACT
and KNOBS RULE (constant draw count per action, restated whole); loot determinism
(append-only entries, rollGroup rules, draw order is a contract); ids append-only
(tests/shipped_item_ids.test.ts); i18n English-only catalog rows in the matching domain
with M16 fills for wordy new names, and any sim-emitted player text getting its matcher rule
in the SAME change (the S3 guard); no generated file hand-edited; the three-tier ordering
rule applied to every append-only table touched, including src/ui/i18n.catalog/items.ts;
no monolith ceiling raised; THE R-NUMBER COLLISION (settled 2026-08-20), so any packet
R-number this phase writes into src/, server/, tests/, or a CLAUDE.md reads "masterwrought
R<n>" IN FULL, because a bare R-number in shipped source means the Professions 2.0 series
(the R17 and R18 sweeps Agent 6 writes are exactly where this bites, and a bare packet
R-number in source is a finding, not a nit).

CONTENT OBLIGATIONS, enumerated because these are the ones that get missed: one new item id
per flipped recipe (SIX under settled DECISIONS A and B, derived from the flipped set and
never pasted from this sentence), each owing art or a MERGED ITEM_ART_PENDING row with
exactly one mapping.json owner; M16 non-Latin fills for wordy English names in this change;
wiki regen on the merged tree with the three-way source label green; the deed and Reliquary
sweep verdicts written either way; the naming verdict written even though nothing is coined;
and an economy-invariant recheck over tests/recipe_economy.test.ts with BOTH sorted literals
recomputed from the merged ALL_RECIPES.

REJECTION LIST, recorded so none of these is re-proposed, each with its reason:
- Flipping the low rungs to drops as well. A gathering profession whose first recipe is
  luck-gated has no on-ramp. The trainer rungs are the on-ramp and they stay.
- A farming-only pattern kind, a farming-only learn path, or a "seed recipe" item. The
  shipped pattern machinery already teaches any recipe of any craft; a second mechanism is
  the exact "inventing a new dispatch mechanism" the Phase 02 stopping rule forbids.
- Making the golden-harvest pattern roll the ONLY faucet for any pattern. It is luck-gated,
  so under D13 it carries no Renown, and under R8 the marks valve must reach every pattern
  deterministically from day one.
- A daily or weekly seed grant. It manufactures a farming daily, which farming's anti-chore
  contract forbids outright and which the packet's own gate-stack research names as a
  historical failure.
- Raising farming's maxSkill above 100 to make room for the climb. The climb is on COOKING's
  ladder, not farming's; farming's cap is untouched and this phase never reads it. Anyone who
  reaches for maxSkill has confused the two ladders.
- Re-qualitying the farm dish outputs to match masterwrought's rung-100 apex tier. Quality is
  a power statement, 11c settled the power, and R5 is measured against it.
- Putting a farm reagent into recipe_quickening_catalyst or any gear intermediate to "make
  farming matter more". R17 forbids it by name, and it is the compulsion failure the packet
  designs against.
- Minting a new Heroic Marks price point to make the seeds cheap. The mark family has two
  points; a third is a maintainer decision over the whole family, not a convenience taken
  inside a content phase.
- Putting any farming row on the 16 (neck) mark point. No farming pattern reaches rung 125
  under DECISION A, and 16 is the shipped skill-125 capstone point.
- The harvest feast at cooking 125 behind a recorded second-capstone exception. DECISION A
  refused it as unnecessary: at 100 the feast ladder is a real two-rung climb below 11k's
  apex feasts, and taking no exception beats taking a defensible one.
- Reading further into the mulberry32 yieldSeed expansion instead of taking DECISION C's real
  ctx.rng draw. It is cheaper and it overloads a seed already carrying four dependent reads.

Out of scope: any change to the well-fed ladder, the aura id, or any magnitude (11c owns
them and they are settled; a magnitude that looks wrong is a STOP, not an edit); the
Perfecting stage (Phase 12); the farming apex feast arm and the charm advertising (the
sibling absorb phase owns them); UI beauty work on any professions surface (Phase 14); the
R5 envelope measurement (Phase 15); the merged icon and wiki enumeration sweep (Phase 16),
though the rows this phase creates land there; and the cross-profession R20 census over
mining, logging, herbalism, skinning, and fishing, whose measured endgame-bill counts
(mining 21, herbalism 15, skinning 11, logging 6, fishing 1) are the reason R20 exists and
are another phase's deliverable.

STEP 3 - VALIDATION + REVIEW (matrix in state.md):
npx tsc --noEmit; then npx vitest run tests/farm_recipes.test.ts
tests/apex_pattern_items.test.ts tests/recipe_pattern_items.test.ts
tests/heroic_vendor.test.ts tests/nythraxis_raid_unit.test.ts tests/dungeons.test.ts
tests/recipe_economy.test.ts tests/professions_farming.test.ts
tests/professions_zone_rollout.test.ts tests/farmer_vendor_purchase.test.ts
tests/deeds_content.test.ts tests/shipped_item_ids.test.ts tests/guide.test.ts
tests/architecture.test.ts tests/localization_fixes.test.ts plus every new suite, plus the
tests/parity suite (this phase changes an rng draw site). THEN the FULL suite
(npx vitest run --maxWorkers=5) before calling any review round done: a content phase on a
freshly merged tree is exactly the shape where census reds hide outside a curated battery.
npm run ci:changed on the touched files only. Read the gate LOG, not just its exit code: a
printed FAIL marker overrides a zero exit.
Review Dispatch Matrix (implementation-plan.md): content-obligations-reviewer (the whole
content diff: art, M16, wiki regen, deeds, Reliquary posture, ids append-only);
architecture-reviewer (the farming.ts draw site is sim behavior and determinism);
frontend-seam-reviewer (the guide source-label render and any catalog copy);
cross-platform-sync ONLY if a SimEvent, wire field, or matcher rule was added;
qa-checklist when the deliverable set is complete. Skip privacy-security-review,
migration-safety, and database-performance-reviewer unless server/, a SQL call site, or a
characters.state serialize path was touched. COVERAGE prompts; apply ALL findings, blocking
and should-fix and nits.

STEP 4 - COMMIT CADENCE (explicit paths, bodies, no session trailers):
- feat(content): climb the farm recipe ladder onto the 75 and 100 rungs
- feat(content): farming pattern items on the shipped learn-on-use machinery
- feat(content): raid, dungeon, and rift entries for the farming patterns and seeds
- feat(content): the heroic quartermaster valve for every farming pattern and seed
- feat(content): the drop and marks channels for the tier 3 and 4 seeds
- feat(sim): the golden harvest bonus roll at a documented draw position
- feat(guide): label a recipe that both drops and sells on the marks vendor
- test(content): re-derive the moved recipe, pattern, vendor, loot, and economy pins
- test(parity): re-record farming_session for the golden harvest draw (ISOLATED, last)

STEP 5 - ACCEPTANCE:
- [ ] NO machinery invented: the diffs of src/sim/professions/pattern_items.ts, training.ts,
      wheel.ts, and crafting.ts are EMPTY, and the phase states in one line why farming's
      recipes needed none
- [ ] The rung table is band-complete across 0, 25, 50, 75 and 100, pinned in both arms (the
      exact derived map 0:4, 25:3, 50:1, 75:2, 100:4 predicted-then-observed, and the
      non-emptiness arm over bands 0 through 100), with the shipped 75 and 100 scaffolding
      tuples reused and no new tuple minted
- [ ] recipe_harvest_feast landed at cooking 100, no farm row sits at 125, and NO second
      cooking-125 capstone exception was recorded anywhere
- [ ] Every row at rung 75 or above is acquisition ['drop']; every row at 50 or below is
      ['trainer']; the rule is asserted, not the rows
- [ ] Magnitudes, aura ids, charges, and output qualities are byte-identical to what 11c
      settled; the 11c-owned files' diffs are empty
- [ ] One pattern per flipped recipe and one flipped recipe per pattern, referentially
      pinned both directions, with the kind:'recipe' universe pin re-cut as a non-vacuous
      union
- [ ] Every farming pattern is reachable through at least one live channel; no recipe became
      unobtainable; every unflipped row is still on a real trainer's teach list
- [ ] Loot entries append-only and rollGroup-safe; the parity suite green; no golden moved
      except the deliberate farming_session re-record, and that one moved alone
- [ ] Every drop rate and every mark price recorded in state.md, derived from the shipped
      conventions, with the arithmetic printed; every farming mark price is the 12 point and
      no farming row sits at 16
- [ ] The golden bonus weights are DERIVED from the shipped rare-event cadence, and the
      pattern arm's recorded expected rate is strictly SLOWER than the quartermaster route
- [ ] Every pattern's quality DERIVES from its taught row's output quality, and every
      pattern's sellValue is the shipped uniform point of 100
- [ ] The rift rank residual closed before this phase or as its first commit, so the appended
      rift draw lands in a stream the rank goldens actually cover
- [ ] GATE 1 was already discharged by 11e before this phase started, and is UNCHANGED by
      it: no vendor seed row added, re-priced or removed here, the docs/design/deeds.md
      waiver still closed against 11e, and prog_farming_100 plus feat_book_complete still
      earnable through the vendor path alone
- [ ] The drop arm is ADDITIVE, pinned both ways: every upper-tier seed is obtainable by a
      character who never raids, rifts, or runs a heroic five-man, AND the new loot and
      quartermaster rows actually yield it
- [ ] NO copper vendor seed row was added, re-priced, or removed here (DECISION E leaves the
      floor to 11e); NEVER_STOCKED and the per-farmer walk pins are CONFIRMED unchanged
      rather than re-derived, and the quartermaster rows this phase DID add all sit at 12
- [ ] The identity guard is pinned: EVERY upper-tier seed on the merged roster (four on the
      shipped roster, eight after 11e-D-B, derived from FARM_CROPS) is obtainable by a
      character who never enters a raid, a rift, or a heroic five-man
- [ ] The golden bonus draw is unconditional and contiguous at one documented position, the
      DRAW CONTRACT is restated whole, and the deny arms still draw zero
- [ ] R17 and R18 asserted as sweeps over the merged ALL_RECIPES, not as prose
- [ ] The wiki source label states BOTH channels for a pattern that drops and also sells;
      tests/guide.test.ts honest for all three cases; wiki regen fresh
- [ ] All six new ids are PARKED on the merged ITEM_ART_PENDING allowlist with exactly one
      mapping owner each; M16 fills landed; the naming, deed, and Reliquary verdicts are
      written (no coinage, no deed, no page), each from a sweep that actually ran
- [ ] The five settled decisions are executed as written and re-stated in the ledger as
      executed, with no gate re-opened and no default silently substituted
- [ ] Both recipe_economy sorted literals recomputed from the merged ALL_RECIPES with the
      non-vacuity floor intact
- [ ] Full suite green; ci:changed clean; gate log read, not just its exit code

STEP 6 - DOCS: progress.md Phase 11f row; state.md ledger (the five settled decisions as
executed, the
merged rung table before and after, every pattern id with its derived quality and sellValue,
every drop rate and mark price with its derivation, the seed prices with their convention
and premium, the golden bonus table with its derived weights and its expected cadence beside
the marks route it must stay slower than, the REFUSAL of a second cooking-125 capstone
exception with its reason, the closed farming OPEN rows, the R19 inputs handed forward,
farming's endgame-bill count for the R20 census, and the rejection list as recorded design);
farming/state.md's OPEN list updated in place ((aj) discharged; GATE 1 and the fine-twin
doctrine intersection were closed by 11e and are only CONFIRMED here, never re-closed);
memory note for anything that surprised you.

STEP 7 - REPORT: phase status, files, validation results, reviewer verdicts, the re-derived
pin table (predicted versus observed per pin), a one-line GATE 1 verdict, and the handoff
line for Phase 11f QA.

STOPPING RULES: the five decisions are settled, so a decision that appears to need
re-opening is a STOP that goes back to the packet record rather than a session choice; stop
if the rift rank residual is still open when the fan-out would start; if any deliverable
appears to need an edit to pattern_items.ts, training.ts, wheel.ts, or crafting.ts (that is
the phase thesis failing, not a workaround); if a loot table cannot take an append-only
entry without perturbing existing rollGroup draw order; if the rung climb cannot be made
band-complete across 0 through 100 without minting a new item id; if the golden pattern arm
cannot be made strictly slower than the quartermaster route; if a re-tiered row appears to
need a magnitude, aura, or quality change to make sense (11c owns those and they are
settled); if the golden bonus draw cannot be made unconditional without breaking the
constant draw-count law; if a mark price cannot be taken from the shipped two-point family;
or if the release merge conflicts inside src/sim/content/recipes.ts,
src/sim/content/dungeons.ts, src/sim/rift/progression.ts, src/sim/professions/farming.ts,
or tests/recipe_economy.test.ts.
```
