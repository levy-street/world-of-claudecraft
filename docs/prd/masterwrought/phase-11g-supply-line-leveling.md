# Phase 11g: The provisioning supply line, leveling tier

### Starter Prompt
```
This is Phase 11g of the Masterwrought feature: farm produce becomes a real reagent family
at the rungs players actually level through. It is the first phase to put farming's output
into a bill that was not written by farming.

Model: xhigh effort. Harness: Claude Code. Worktree: ~/Documents/wocc-masterwrought
(branch feature/masterwrought). ULTRACODE: YES (batch content; the cooking ladder, the
alchemy ladder, the choke point, and the pin recomputation are four independent slices).

Goal: cooking and alchemy consume grain and vegetables at skillReq 0, 25, and 50, plus the
one skillReq-75 choke point every apex dish flows through, so a farmer has a buyer from the
first rung and a cook meets produce on the ladder they were already climbing. Every row is
ADDED beside the herb, meat, or fish it sits with and never substituted for one.

THE GROUNDING FACT, and the reason this phase is additive rather than a rebalance. The
entire cooking tree uses 17 distinct reagents and NOT ONE is a vegetable or a grain. The
full set is spider_leg, cooking_salt, game_meat, prime_cut, silverleaf_herb, goldleaf_herb,
sunpetal_herb, ashwood_log, the six raw fish, seasoned_stock, quickening_catalyst, and
wyrmfall_core. Every shipped dish is meat, fish, herb, salt, a log, or a spider leg.
Farming is not competing for a slot in a full pantry, it is filling a class that has never
existed. Say that in the phase report and in the ledger, because it is what makes "add,
never substitute" cheap to honor: nothing has to move over.

WORKTREE GUARD (do this FIRST; the user runs multiple concurrent sessions): run pwd.
If you are not in /Users/fernando/Documents/wocc-masterwrought, switch this session into
it NOW with the EnterWorktree tool (path: /Users/fernando/Documents/wocc-masterwrought).
If EnterWorktree is unavailable or refuses, STOP and ask the user to relaunch Claude Code
from that directory. Phase work never runs from the main checkout at
~/Documents/world-of-claudecraft.

STEP 0 - PRE-FLIGHT (canonical Team Workflow, docs/prd/masterwrought/implementation-plan.md):
- git status clean, with Phase 11f closed and its QA green. This phase edits tables 11e and
  11f just grew; a half-landed roster makes an authoring bug indistinguishable from a
  missing crop.
- SYNC RELEASE: git fetch origin --prune, discover the newest release branch by version sort
  (git branch -r | grep 'origin/release/' | sort -V | tail -1), merge it, run the
  release-merge-audit skill on the merge.
- Memory scan (MEMORY.md index): the test-pin trap index (READ it before authoring or
  judging any pin: predicted-then-observed, constant-self-comparison, "prove the tests RAN"),
  the i18n reword-staleness entry, new-item-content-hidden-obligations (so the NIL obligation
  list below is proven rather than assumed), and release-merge gate surprises.
- READ THE LIVE ROSTER, not this document's crop list. 11e grew the crop roster: 11e-D-B is
  settled at +4 crops (two tier-3, one of them a LEAF, and two tier-4), so expect TWELVE
  crops on the merged tree, not eight. Open src/sim/content/farm_crops.ts on the merged tree
  and take the crop set, each crop's tier, and farmCropSkillThreshold from there. Every
  default table below is written against the eight shipped crops (T1 vale_wheat,
  brook_carrot; T2 marsh_rice, bog_beet; T3 highland_barley, frost_gourd; T4
  gilded_sunmelon, evergarden_greens) and MAY be substituted
  row for row if 11e shipped a crop that fits a rung better. The three RULES below bind
  whatever the roster is; the table is a default, the rules are the contract.
- THREE DECISIONS, ALL SETTLED 2026-08-20 (the full delegation). The rulings are recorded in
  docs/prd/masterwrought/state.md under "Decisions closed 2026-08-20 (the full delegation)"
  (11b STEP 6 migrates that block into farming/state.md's handoff table). Execute them as
  written and re-state each one in this phase's ledger row as executed. Nothing here is
  confirmed with the maintainer, and a decision that appears to need re-opening is a STOP
  that goes back to the packet record, never a session choice.

  DECISION A, SETTLED 2026-08-20 (R18's obtainability half): READING 1, THE SEEDS. This
  phase adds ZERO vendor rows and ZERO buyValues. R18's obtainability half is already
  satisfied by shipped content: vale_wheat_seed and brook_carrot_seed at farmer_jessica,
  marsh_rice_seed and bog_beet_seed at farmer_teasel, plus brook_carrot itself on Jessica's
  counter under D9. The counterfactually-vendor-fed membership literal in
  tests/recipe_economy.test.ts is PREDICTED UNCHANGED at six ids, and any movement is a STOP.
  WHY: sunpetal_herb carries buyValue 160 and no NpcDef lists it, so on a gathered material a
  buyValue is the ECONOMY BASIS tests/recipe_economy.test.ts reads and not a stock row (the
  items.ts fine-grade comment says so, and tests/professions_master_stock.test.ts pins it for
  the delisted five). R18's "a raider buys grain the way they buy sunpetal_herb" therefore
  describes the World Market, not a counter, and what is vendor-stocked at tiers 1 and 2 is
  the SEED.
  REJECTED, reading 2 (give vale_wheat, marsh_rice and bog_beet a positive buyValue on the
  four-times-sell convention and put them on the farmer counters): defensible, but it carries
  three costs that would all land in the same change and none of them is needed to make a row
  in this phase completable. (i) reagentUnitValue prefers buyValue over sellValue, so every
  produce price move re-prices every pinned input in tests/farm_recipes.test.ts (the arms
  "every dish vendors strictly below its input value, at the exact input pinned" and "no farm
  row mints copper on the RAW sell basis"). (ii) recipe_vale_hearth_loaf and
  recipe_fenbridge_rice_bowl become fully vendor-fed IN LIVE STOCK, because cook_marlow
  already stocks cooking_salt, which reds the arm asserting liveVendorFed is empty, an arm
  whose own comment records that empty set as a fact about the content. (iii) the
  counterfactually-vendor-fed membership literal grows and its non-vacuity floor moves with
  it.

  DECISION B, SETTLED 2026-08-20 (may rung 50 reach tier-3 produce): YES, CONDITIONAL ON A
  CODE READ. Open src/sim/content/zone3.ts, read farmer_hollis's vendorItems ARRAY, and
  confirm the tier-3 seeds sit on the counter with positive buyValues. That read IS the proof
  that 11e's GATE 1 landed: take it from the CODE, never from a plan doc or a ledger row.
  If the read fails, fall back to tier-2 produce at rung 50 and record the substitution at
  the row: recipe_marlows_grand_roast takes vale_wheat 2 plus bog_beet 2 instead of
  highland_barley 2 plus frost_gourd 2, and recipe_elixir_of_the_serpent takes marsh_rice 2
  instead of frost_gourd 2.
  WHY: a crop with no seed source is not a reagent, and tier-3 crops gate at farming 50 only
  if the seed faucet exists. Reading the array is the only proof that survives a phase
  running out of order, which is the whole reason the GATE 1 chain exists.

  DECISION C, SETTLED 2026-08-20 (who owns recipe_seasoned_stock): IT LANDS HERE, with grain
  AND root, marsh_rice 2 plus bog_beet 2. 11h DROPS its GATE F and takes the merged bill AS
  GIVEN, re-deriving its gold-negative arithmetic from it and editing the row for nothing.
  Write the answer into the packet record AND into this phase's report, which is where 11h's
  session reads it, so the row is never half-owned.
  WHY: 11g runs first and the row is a single choke point, so the phase that reaches it first
  must author it or the second phase re-prices a bill the first already sealed. Grain plus
  root is also the better bill on the merits: the stock feeds every apex cooking row (the
  three role plates at 1, recipe_laden_hearth at 3, 11k's apex feasts at 3), so coupling it
  to TWO tier-2 crops spreads the choke point across two vendor-seeded, market-fed supply
  lines instead of making the whole cooking apex ride one paddy. 11h needs no redesign for
  this: its own exclusion pin already carves recipe_seasoned_stock out of the
  no-produce-in-intermediates sweep.
  THE PRE-CHECK STANDS: before the fan-out starts, read recipe_seasoned_stock on the merged
  tree. If it already carries produce, 11h landed first, so STOP and reconcile rather than
  editing the same bill twice.

STEP 1 - LOAD CONTEXT (Explore agent; do not read planning docs or content monoliths in the
main loop):
- docs/prd/masterwrought/state.md (R5 and the Power placement numbers, so the report can say
  out loud that this phase does not touch them; R13; the validation matrix; the Phase 11c
  ledger for the settled Well Fed ladder). progress.md's Phase 11g row. decisions-index.md
  (R is masterwrought, D is farming, (x) is a farming deviation).
- docs/prd/masterwrought/farming/state.md: D9 (the starter fee vegetable and why brook_carrot
  is the one produce row with a buyValue), D11 (every stocked row needs a positive buyValue or
  it renders then refuses), D24 (the displacement guardrail), and the OPEN items list.
- Content: src/sim/content/recipes.ts (LADDER_RECIPES, its cooking and alchemy blocks,
  INTERMEDIATE_RECIPES and recipe_seasoned_stock, FARM_RECIPES and its header rules,
  COMMON_RECIPES for recipe_tough_jerky); src/sim/content/farm_crops.ts (the roster, tiers,
  and farmCropSkillThreshold); src/sim/content/items.ts and profession_items.ts (every
  sellValue and buyValue this phase reasons about, read on the MERGED tree and never carried
  from a parent); src/sim/content/zone1.ts and zone3.ts (cook_marlow's and the farmers'
  vendorItems).
- Tests that pin what this phase touches: tests/recipe_economy.test.ts (THE ECONOMY
  INVARIANT, the counterfactually-vendor-fed membership literal and its non-vacuity floor,
  the live-stock emptiness arm, the INTERMEDIATE bill literal table, the LADDER SHAPE PINS
  block, the MATERIAL DEMAND COVERAGE block including the raw-fish arm);
  tests/farm_recipes.test.ts; tests/ladder_crafting.test.ts (the specimen-consumer arm names
  recipe_marlows_grand_roast); tests/professions_deeds_playthrough.test.ts (hand-granted
  reagents for recipe_silvered_carp_supper); tests/mobile_station_party.test.ts (grants from
  the LIVE reagent list); tests/professions_capacity.test.ts and
  tests/professions_crafting.test.ts (both craft recipe_anglers_feast_platter);
  tests/material_taxonomy.test.ts and tests/material_profession_affinity.test.ts;
  tests/parity/scenarios.ts (the professions_craft scenario, so the report can state which
  recipes it crafts).
- UI and generator: src/ui/i18n.catalog/guide.ts (guide.profPages.craftIntro.cooking,
  craftProse.cooking.*, craftProse.alchemy.*, and farming's profPages.farm.bedsBody);
  scripts/wiki/build_content.mjs; src/guide/pages/professions_craft.ts.
Return: the merged sellValue and buyValue of every reagent named below; the merged reagent
list of every recipe this phase will touch, verbatim; the live crop roster with each crop's
tier and derived skill gate; the exact current text of every guide prose row that names what
the pantry is fed by; and the current sorted membership of the counterfactually-vendor-fed
set.

STEP 2 - EXECUTE (parallel fan-out, explicitly; five agents by vertical slice; Agent 4 runs
LAST, after Agents 1 to 3 have landed, because it recomputes against the finished tables).

THE THREE RULES. Every agent below obeys all three, and Agent 4 pins all three.

RULE 1, THE TIER GATE, and it is the whole answer to "obtainable at the tier where the
recipe unlocks": farmCropSkillThreshold(crop.tier) must be at or below the recipe's skillReq.
The function is (cropTier - 1) * 25 in src/sim/content/farm_crops.ts, so tier 1 clears rung
0, tier 2 clears rung 25, tier 3 clears rung 50, tier 4 clears rung 75. No rung ever asks for
produce gated above it, a player levelling both skills together is never blocked, and the
rule holds for whatever roster 11e shipped. Derive it by calling the function, never by
re-typing the arithmetic.

RULE 2, THE ACCENT COUNT: on a shipped row a crop is a seasoning, never the body. Its count
stays strictly below the row's largest non-produce reagent count, and its share of inputValue
stays at or below that reagent's share. Farming's own dishes own the body role (the hearth
loaf takes wheat 3, the barley bannock takes barley 4); a shipped ladder row takes 1 or 2.

RULE 3, ADD NEVER SUBSTITUTE (R18, and farming's D24): no herb count, no fish count, no meat
count, and no salt count is ever reduced, anywhere, by any agent. Herbalism, fishing, and
skinning lose nothing to this phase. A row that cannot take produce without reducing
something else is a STOP, not a trade.

Agent 1 (THE COOKING LEVELING LADDER, rungs 0, 25, 50):
- Edit reagent lists only. Mint NO recipe row. That is not a preference: LADDER_RECIPES is
  closed at 54 rows, nine per craft, three per rung, pinned as a literal and as a per-craft
  shape in tests/recipe_economy.test.ts, and farming's own FARM_RECIPES header records that
  folding dishes into cooking's nine would break that shape outright. Farming already shipped
  its own plain and buff dishes; this phase makes the EXISTING ladder consume farm produce.
- THE ROW TABLE. It is a planning-time default the LIVE roster may substitute row for row
  (the three RULES bind, this table does not), and it is NOT an open decision: the three
  decisions above are settled. Each row states the add, the crop tier and its derived gate,
  and the input-versus-output arithmetic on the recipe_economy unit basis (buyValue when the
  def carries one above zero, else sellValue). Re-derive every number from the merged tables
  before typing it; the figures below are the planning-time read of the masterwrought tip and
  exist so a mismatch is a discovery rather than a surprise.
  rung 0
  - recipe_hunters_game_skewer: ADD brook_carrot 1. The root between the meat on the skewer.
    Tier 1, gate 0. Input 16 to 32 against output 12.
  - recipe_pan_seared_perch and recipe_herbed_marsh_pike: UNTOUCHED. The rung-0 fish controls.
  rung 25
  - recipe_goldleaf_game_stew: ADD vale_wheat 2 (the grain that thickens it) and bog_beet 1
    (the root that bodies it). Tiers 1 and 2, gates 0 and 25. Input 80 to 96 against output
    50. This is the phase's flagship row: a stew is the dish the absent class was most
    obviously missing, and it is the one place where grain and root both belong.
  - recipe_frostgill_chowder: ADD brook_carrot 2. A chowder's root. Tier 1, gate 0. Input 44
    to 76 against output 40, which widens the second-tightest margin on the whole ladder.
  - recipe_ashwood_smoked_eel: UNTOUCHED. The rung-25 fish control.
  rung 50
  - recipe_silvered_carp_supper: ADD marsh_rice 2. The bed the supper is served on; carp stays
    the headline at 3. Tier 2, gate 25. Input 101 to 117 against output 75.
  - recipe_marlows_grand_roast: ADD highland_barley 2 and frost_gourd 2. A roast's grain and
    root. Tier 3, gate 50, subject to DECISION B; the fallback is vale_wheat 2 plus bog_beet
    2. Input 212 to 272 against output 150.
  - recipe_anglers_feast_platter: UNTOUCHED. The rung-50 fish control, and deliberately so:
    tests/professions_capacity.test.ts and tests/professions_crafting.test.ts both craft it,
    so leaving it alone keeps two suites out of this diff.
- FISH DISHES STAY FISH-FORWARD, stated as a mechanic rather than a taste: on a row carrying
  raw fish, the summed fish count stays strictly greater than the summed produce count, and at
  most ONE crop family joins. A chowder taking a root is still a fish dish; a fish row whose
  vegetables outnumber its fish is not, and Agent 4 pins the difference.
- recipe_tough_jerky is UNTOUCHED and named here so nobody improves it: it is a pre-training
  COMMON_RECIPES row whose margin (input 4 against output 2) is the tightest in the game and
  the one tests/recipe_economy.test.ts's own comment cites.
- Every touched row keeps its skillReq, itemLevelBudget, level, resultCount, acquisition,
  stationType, and result quality exactly as shipped. Only the reagent array grows.

Agent 2 (THE ALCHEMY LEVELING LADDER, the elixir line):
- R17 names cooking AND alchemy, and "at every rung" for alchemy 0 to 50 is this phase. The
  elixir line gives exactly one row per rung, which is the whole coverage in three edits.
  rung 0
  - recipe_elixir_of_the_boar: ADD brook_carrot 1. Tier 1, gate 0. Input 32 to 48 against
    output 10.
  rung 25
  - recipe_venomfire_elixir: ADD bog_beet 2. Tier 2, gate 25. Input 90 to 106 against output
    15.
  rung 50
  - recipe_elixir_of_the_serpent: ADD frost_gourd 2. Tier 3, gate 50, subject to DECISION B;
    the fallback is marsh_rice 2. Input 214 to 244 against output 40 (resultCount 2).
- THE DRAUGHT LINE IS REFUSED, and the reason is mechanical before it is thematic. The
  draughts are the herbalist's pure-herb line, and two of them are load-bearing:
  recipe_goldleaf_mana_draught and recipe_sunpetal_mana_draught are two of the SIX members of
  the counterfactually-vendor-fed set in tests/recipe_economy.test.ts. Adding any reagent that
  carries no buyValue drops them OUT of that set, shrinking the sorted membership literal from
  six to four and pushing the count under its own non-vacuity floor of six. That is not a pin
  to update; it is the silent removal of two loops from the tighter of the two economy bounds.
  If a later phase wants produce in a draught, it uses a crop that carries a buyValue and
  re-derives the membership deliberately. Record this refusal in the ledger so it is not
  re-proposed as an oversight.
- The elixir line is also the right thematic home: it is the hearty stamina line, where a root
  base belongs, and farming already established the direction of trade in the other
  direction with recipe_growth_tonic, the alchemy row brewed from wild Sheenleaf that farming
  consumes as a plant-time knob (D7). After this phase the two professions supply each other.

Agent 3 (THE CHOKE POINT, recipe_seasoned_stock, per DECISION C):
- ADD marsh_rice 2 and bog_beet 2. The result is a stock that is meat plus vegetables plus
  salt, which is what a stock is.
- THE COUNTS ARE DERIVED FROM THE ROW'S OWN SHAPE, not picked: the shipped bill is prime_cut
  1, game_meat 3, cooking_salt 2, quickening_catalyst 1, so the vegetables enter at the salt's
  count of 2, one below the meat count of 3, and the bill still reads meat, then vegetables,
  then salt in that order. Print the derivation beside the row.
- THE TIER IS DELIBERATELY 2 AT BOTH, not 3 or 4, and it is grain AND root rather than one
  crop, which is the load-bearing pair of choices in the slice. Two tier-2 crops spread the
  choke point across two vendor-seeded, market-fed supply lines instead of making the whole
  cooking apex ride one paddy. Everything in the cooking apex tier flows through this one
  row: the three role plates each take seasoned_stock 1, recipe_laden_hearth takes 3, and
  11k's apex feasts take it too.
  Coupling it to the tier 3 or tier 4 seed faucet would put the packet's entire apex kitchen
  behind farming's slowest supply, and R19 makes that supply deliberately slow. Tier 2 is
  vendor-seeded at farmer_teasel and market-fed, so the choke point never chokes.
- Input 98 to 130 against output 30. Re-derive both from the merged table.
- The literal for recipe_seasoned_stock in tests/recipe_economy.test.ts's INTERMEDIATE bill
  table is RECOMPUTED from the merged ALL_RECIPES, never hand-edited to match. The R13
  rung-shape arm beside it still holds unchanged: skillReq 75, itemLevelBudget 20, level 20,
  resultCount 1, acquisition ['trainer'], exactly one quickening_catalyst, no oncePerDay.
  INTERMEDIATE_RECIPES stays at 10 rows.
- R17'S EXCLUSIONS, asserted by Agent 4 rather than intended here: produce goes NOWHERE near
  recipe_quickening_catalyst (the packet's one pacing gate, and a row the professions_craft
  parity scenario crafts twice against the daily stamp, so a reagent there would move a golden
  as well as break the ruling), nowhere near any gear intermediate (billet, plating, cording,
  bolt, setting, chassis, lucent reagent, sablewax vellum), and nowhere near Phase 12's
  Perfecting materials.

Agent 4 (THE INVARIANTS AND THE PINS; runs after 1 to 3 land):
- RECOMPUTE, NEVER HAND-MERGE. tests/recipe_economy.test.ts is edited by BOTH packets and
  carries sorted literal pins. Recompute the INTERMEDIATE bill literal and the
  counterfactually-vendor-fed membership from the merged ALL_RECIPES. PREDICT BEFORE YOU RUN:
  under settled DECISION A the membership must be UNCHANGED at the same six
  ids, because this phase changes no buyValue and every touched row already carried a
  reagent without one. Predict "unchanged", then observe. A moved membership under the default
  means a price basis moved somewhere this phase did not look, and that is a stop.
- THE GOLD-NEGATIVE PROPERTY IS SAFE BY CONSTRUCTION, and say so plainly so the QA twin does
  not go hunting for a balance impact: adding a reagent raises inputValue and cannot touch
  outputValue, which is resultCount times the output def's sellValue, and this phase changes
  no output def and no resultCount. Every touched bill's margin therefore widens
  monotonically. Re-run the invariant anyway (it sweeps ALL_RECIPES and its checked count must
  still equal ALL_RECIPES.length), but the report states the monotonicity argument rather than
  reciting nine margins.
- ADDING REAGENTS CHANGES INPUT COST ONLY, NEVER OUTPUT POWER. No foodHp, no wellFed payload,
  no elixir value, no duration, no resultCount, no output sellValue, and no ItemDef of any
  kind moves in this phase. R5 and Phase 15 are untouched by it, and 11c's settled Well Fed
  ladder is not reopened. Put that sentence in the ledger verbatim.
- NEW SUITE, tests/provisioning_supply_line.test.ts, which owns the cross-packet rule this
  phase creates. Derive the produce id set from the LIVE FARM_CROPS table (base produce and
  fine twins), never from a hand list, so 11e's roster growth is covered automatically:
  - THE TIER GATE, swept over every recipe in merged ALL_RECIPES that consumes any produce id:
    farmCropSkillThreshold(tier) is at or below recipe.skillReq. Call the function; comparing
    a re-typed (tier - 1) * 25 against itself is a constant-self-comparison and proves nothing.
  - RUNG COVERAGE: cooking and alchemy each have at least one produce-consuming recipe at
    skillReq 0, 25, and 50, derived from the live tables rather than a list of ids.
  - THE SUPPLY LINE IS REAL, NOT SELF-REFERENTIAL: at every one of those rungs, at least one
    produce-consuming cooking recipe and one produce-consuming alchemy recipe sits OUTSIDE
    FARM_RECIPES. This single assertion is the phase's thesis and it is the one that would go
    red if a future edit quietly walked the phase back.
  - FISH-FORWARD: on every cooking recipe carrying a raw fish, summed fish count is strictly
    greater than summed produce count. Take the raw-fish set from the same source
    tests/recipe_economy.test.ts pins it against, so the two lists cannot diverge.
  - THE ACCENT RULE: on every row this phase touched, each produce count is strictly below the
    row's largest non-produce reagent count.
  - THE DISPLACEMENT GUARD (R18 and D24), the pin that makes "herbalism loses nothing" a fact
    instead of a promise: pin the TOTAL demand across merged ALL_RECIPES for silverleaf_herb,
    goldleaf_herb, and sunpetal_herb as three integers, predicted then observed, AND pin the
    exact herb reagent entries on every row this phase touched as literals. Totals alone can
    be gamed by moving an herb between rows; the per-row literals close that.
  - THE EXCLUSION SWEEP: no produce id appears in recipe_quickening_catalyst, in any gear
    intermediate, or in any Perfecting material. Assert it as a sweep over the merged tables
    keyed on the derived produce set, not as a list of ids that rots.
- THE BAND-LITERAL VERDICT, SETTLED 2026-08-20: LEAVE LOW_BAND, MID_BAND and RARE_BAND
  ALONE. Produce joins none of them. RECORD, in the ledger, that the LADDER SHAPE arm now
  passes more easily on the two rung-50 rows this phase touches, and confirm in the same
  pass that it still has teeth on the rows it was written for.
  WHY: the arm reads RARE_BAND only, the lists are documented lower tiers, and both rung-50
  rows already satisfied the arm before the edit, so adding produce rows would change a pin's
  meaning without changing what it catches. Recording the weakened-but-still-toothed reading
  is the difference between a pin that was checked and one that was assumed.
- COLLATERAL SUITES, enumerated rather than guessed. Any suite that hand-grants a literal
  reagent list for a touched recipe must gain the new reagent or the craft fails on missing
  reagents; suites that grant from the live recipe.reagents self-heal. Known:
  tests/professions_deeds_playthrough.test.ts hand-grants recipe_silvered_carp_supper's bill
  as literal sim.addItem calls and needs the produce grant;
  tests/mobile_station_party.test.ts derives its grant from the live list
  (KITCHENS_RECIPE_ID is recipe_hunters_game_skewer) and self-heals, so confirm rather than
  edit; tests/ladder_crafting.test.ts's specimen-consumer arm names recipe_marlows_grand_roast
  and stays green because prime_cut remains at count 1, but the sorted consumer list is derived
  from LADDER_RECIPES so confirm rather than assume. Find the rest by grepping every touched
  recipe id and every touched reagent id across tests/.
- VERIFIED NON-MOVERS, stated so the QA twin can check them instead of hunting for them.
  (a) The material taxonomy and the "Used by" affinity line do not move: every crop is ALREADY
  a cooking reagent through FARM_RECIPES, so src/sim/material_taxonomy.ts and
  src/sim/material_profession_affinity.ts derive the same sets before and after. Pin it rather
  than assert it in prose. (b) The LADDER SHAPE pins do not move: no recipe row is minted, so
  54 rows, nine per craft, three per rung all hold. (c) The kitchens work orders collect raw
  materials (game_meat, and farming's wheat and rice orders), never a crafted dish, so no
  work-order payout arithmetic moves. (d) No wire field, no SimEvent, no server file, no sim
  logic, and no rng draw is touched: content tables, tests, and guide prose only. (e) The
  parity goldens do not move, because no scenario crafts a touched row (professions_craft
  crafts recipe_minor_healing_potion, recipe_eastbrook_ritual_vestments, and
  recipe_quickening_catalyst). Run the parity suite anyway and treat ANY movement as a stop.

Agent 5 (WIKI, TOOLTIPS, AND THE GUIDE PROSE):
- WIKI REGEN: npm run wiki:content, with tests/guide.test.ts freshness green. Never hand-edit
  src/guide/content.generated.ts; the bills flow through the generator.
- THE PROSE ROWS THIS PHASE FALSIFIES, each reworded in the same change. The cooking page's
  materials section is written as a two-supplier story: guide.profPages.craftProse.cooking
  .materialsHeading reads "A pantry fed by rod and knife" and its materialsBody enumerates
  fishing, the butcher's side, herbs, one ashwood log, and Cooking Salt. After this phase
  there is a third supplier and the heading is short one word. Rework the heading and the
  body, check craftProse.cooking.ladderBody for any enumerated bill that moved, check
  craftIntro.cooking (its blurb opens on "the day's catch"), and do the same pass for
  craftProse.alchemy.materialsBody, which today lists herbs, glands, and glass.
- FARMING'S OWN ROUTE PROSE, one sentence only: profPages.farm.bedsBody says what a season
  feeds ("What you bring in feeds the kitchens: the produce cooks into dishes at the
  kitchens"). That sentence is now understated, since produce feeds the kitchens' own ladder
  and the apothecary besides. Touch ONLY that sentence. The clause about the top of the dish
  ladder coming "within reach with a later patch's deeper fields" belongs to 11e; if 11e has
  already corrected it, leave it corrected.
- THE REWORD IS THE i18n COST, and it is the trap: every one of those rows is FILLED in five
  non-Latin overlays, and a filled row whose English changed still reads as filled. Contributors
  add ENGLISH only. Record every reworded key on the release-tier fill worklist for Phase 17,
  by key, in state.md. Do not touch src/ui/i18n.locales/.
- NO NEW KEY IS EXPECTED. If a rework genuinely needs one, it lands in the matching
  src/ui/i18n.catalog/ domain module in English, and M16 applies to a wordy new value.
- TOOLTIPS: the crafting window and the wiki both render a bill from the live data, so the
  reagent rows appear with no code change. Compose one touched recipe's tooltip and one
  produce item's tooltip and READ them, so the phase report can state what a player actually
  sees rather than what the data says.

INVARIANTS IN PLAY: R17 (produce feeds the consumable professions and never the gear chain,
the Perfecting materials, or recipe_quickening_catalyst, asserted as a test); R18 (every added
row lands on a market-listable kind 'junk' material, exactly as sunpetal_herb already does in
the same bills, so the requirement never falls on a profession; nothing is ever substituted);
D24 (herbalism loses nothing, pinned); R19 (nothing here shortens or lengthens a growth
timer, adds a daily, or adds a decay: this phase creates demand, never a chore); R13 (no
rung moves); THE R-NUMBER COLLISION (settled 2026-08-20), so any packet R-number this phase
writes into src/, server/, tests/, or a CLAUDE.md reads "masterwrought R<n>" IN FULL, because
a bare R-number in shipped source means the Professions 2.0 series (the R17, R18 and D24 pins
in the new suite are exactly where this bites, and a bare packet R-number in source is a
finding, not a nit); ids append-only and NOTHING here adds, removes, or renames an item id or
a recipe id (tests/shipped_item_ids.test.ts); the LADDER_RECIPES shape is closed at 54 rows;
every player-visible string is a t() key in the matching catalog domain; no generated file is
hand-edited; determinism (this phase adds NO rng draw, and an agent that believes it needs one
is a STOP); data-as-code is exempt from the monolith ratchet, so growing a content table is
correct and no ceiling moves.

CONTENT OBLIGATIONS, all verdicts SETTLED 2026-08-20 and the NIL list PROVEN rather than
skipped (the content-obligations reviewer reads the verdicts, not the diff size, so silence
is the failure mode):
- ZERO new item ids and ZERO new recipe ids. ITEM_ART_PENDING gains nothing, the batch-XOR
  mapping.json ownership rule has nothing to arbitrate, and no M16 name fill is owed because
  no name is minted. State this explicitly in the phase report: a content phase whose
  obligation list is genuinely empty has to prove it.
- THE ONE LIVE OBLIGATION is the REWORD set above, on the release-tier fill worklist by key.
  It is the one that would otherwise vanish: an edited English value whose locales are filled
  still reads as filled, and only a worklist entry catches it at Phase 17.
- Wiki regen via npm run wiki:content with tests/guide.test.ts green.
- Book of Deeds: NO deed. A reagent change is not conquerable content, and prog_field_to_feast
  belongs to 11k. Run the sweep and write the verdict.
- Reliquary: NO page. Nothing unique or conquerable is minted. Run the sweep and write the
  verdict.
- src/ui/world_entity_i18n.ts: nothing owed, no named entity is added. Write that down.
- IP-safe naming: no proper noun is minted, so R15 and D17 have nothing to verify. That IS
  the verdict; record it rather than leaving the row blank.

OWNERSHIP BOUNDARIES, so two phases do not both do a thing or both skip it:
- recipe_seasoned_stock lands HERE per DECISION C, settled 2026-08-20. 11h has DROPPED its
  GATE F and takes the merged bill as given, so the double-claim is closed; write the answer
  into the packet record and this phase's report anyway, because that is where 11h's session
  reads it.
- The three role plates (stonepot_stew, warspice_skewers, sageleaf_chowder) have byte-identical
  bills today and no test pins them identical. Differentiating them is 11h's, not this phase's,
  even though this phase's stock edit flows into all three. Do not touch them.
- Fish into recipe_sageleaf_chowder is 11i's. This phase adds no fish anywhere.
- The tier-4 fine twins' missing consumer is 11h's.
- The R20 sweep and its test are 11j's. This phase's rung-coverage pin is farming-only and is
  the SHAPE 11j generalizes across five gathering professions; leave it in a form 11j can widen
  rather than replace.
- The Well Fed ladder and the two feasts are 11c's and are settled.

Out of scope: new dishes or new crops of any kind; the gain curve and the roster (11e); drop
acquisition and the 75-to-125 farming ladder (11f); the apex tier, the apex feasts, and the
tier-4 twins (11h); fishing (11i); the R20 enforcement pass (11j); the capstone, signatures,
and deeds (11k); Perfecting (12); any UI beauty work (14); the R5 envelope measurement (15).

STEP 3 - VALIDATION + REVIEW (matrix in implementation-plan.md):
npx tsc --noEmit; then npx vitest run tests/recipe_economy.test.ts tests/farm_recipes.test.ts
tests/ladder_crafting.test.ts tests/professions_crafting.test.ts
tests/professions_capacity.test.ts tests/professions_deeds_playthrough.test.ts
tests/mobile_station_party.test.ts tests/material_taxonomy.test.ts
tests/material_profession_affinity.test.ts tests/professions_master_stock.test.ts
tests/professions_zone_rollout.test.ts tests/shipped_item_ids.test.ts tests/guide.test.ts
tests/architecture.test.ts tests/localization_fixes.test.ts plus the new suite. THEN the
parity suite, expecting NO movement at all. THEN the FULL suite (npx vitest run
--maxWorkers=5) before any review round is called done: a wide content edit on a merged tree
is exactly the shape where a hand-granted reagent list reds outside a curated battery. Then
npm run ci:changed on the touched files only. Read the gate LOG, not just its exit code: a
printed FAIL marker overrides a zero exit.
Review Dispatch Matrix: content-obligations-reviewer (the whole content diff: bills, the
economy recomputation, the wiki regen, the NIL obligation list, ids append-only);
frontend-seam-reviewer (the guide prose rework and the tooltip read); qa-checklist when the
deliverable set is complete. architecture-reviewer ONLY if a file under src/sim outside
content/ changed, which the default says none does; if one did, say why in the report. Skip
privacy-security-review, migration-safety, database-performance-reviewer, and
cross-platform-sync: no server, no persisted shape, no SQL call site, no SimEvent, no wire
field, and no matcher rule is touched. State the skips and their reasons in the report, so the
QA twin audits the reasoning rather than the omission. COVERAGE prompts; apply ALL findings,
blocking and should-fix and nits.

STEP 4 - COMMIT CADENCE (explicit paths, bodies, no session trailers):
- feat(content): grain and root join the cooking leveling ladder
- feat(content): the elixir line takes a farm base
- feat(content): vegetables into the seasoned stock
- test(content): the provisioning supply line invariants and the recomputed economy pins
- docs(guide): the pantry gains a third supplier

STEP 5 - ACCEPTANCE:
- [ ] Decisions A, B, and C executed as SETTLED (2026-08-20), re-stated as executed in this
      phase's ledger row, with DECISION B's code read of farmer_hollis's vendorItems printed
      and 11h pointed at DECISION C
- [ ] Cooking has a produce-consuming recipe at skillReq 0, 25, and 50, and so does alchemy,
      each proven by a live-table sweep and each with at least one consumer outside
      FARM_RECIPES
- [ ] RULE 1 holds for every produce-consuming recipe in merged ALL_RECIPES, pinned through
      farmCropSkillThreshold and not through a re-typed arithmetic
- [ ] RULE 2 holds on every touched row; RULE 3 holds everywhere, with the three herb totals
      and the per-row herb literals pinned predicted-then-observed
- [ ] Every touched bill is still strictly gold-negative, and the report states the
      monotonicity argument (input rises, output cannot move) rather than reciting margins
- [ ] The counterfactually-vendor-fed membership PREDICTED unchanged at six ids and observed
      unchanged; the non-vacuity floor intact; the live-stock emptiness arm still green
- [ ] The INTERMEDIATE bill literal RECOMPUTED from merged ALL_RECIPES, never hand-merged;
      INTERMEDIATE_RECIPES still 10 rows and the R13 rung shape unchanged
- [ ] No produce in recipe_quickening_catalyst, any gear intermediate, or any Perfecting
      material, asserted as a derived sweep
- [ ] LADDER_RECIPES still 54 rows, nine per craft, three per rung; no item id or recipe id
      added, removed, or renamed
- [ ] No output value moved: no foodHp, wellFed payload, elixir value, duration, resultCount,
      or output sellValue anywhere in the diff
- [ ] Parity suite shows NO movement; no parity golden appears in the diff
- [ ] Wiki regenerated by the generator; tests/guide.test.ts green; every reworded prose key
      recorded on the release-tier fill worklist
- [ ] The NIL obligation list proven: zero new ids, zero art rows, zero name fills, zero
      world_entity_i18n rows, deeds and Reliquary verdicts recorded
- [ ] Full suite green; ci:changed clean; gate log read, not just its exit code

STEP 6 - DOCS: progress.md Phase 11g row. state.md ledger: the three settled decisions as
executed (with DECISION C written where 11h's session will read it); the final per-row table
with every count and its derivation; the three RULES as shipped; the draught-line refusal and
the vendor-fed membership reason behind it; the seasoned stock's tier-2 and grain-plus-root
reasoning; the recomputed pin table (predicted versus observed per pin); the settled
band-literal verdict with the weakened-but-still-toothed reading recorded; the deeds and
Reliquary verdicts; the reworded i18n keys for the Phase 17 worklist;
and the sentence that this phase changed input cost only and never output power. In
docs/prd/masterwrought/farming/state.md: record that D24's displacement guardrail is now
pinned by a test rather than honored by intention, and close any OPEN row this phase settles.
Memory note for anything that surprised you.

STEP 7 - REPORT: phase status, files, validation results, reviewer verdicts, the re-derived
pin table, the named skips from the review matrix with their reasons, and the handoff line for
Phase 11g QA.

STOPPING RULES: the three decisions are settled, so a decision that appears to need
re-opening is a STOP that goes back to the packet record rather than a session choice; stop
if DECISION B's code read shows the tier-3 seed faucet is not on farmer_hollis's counter (take
the recorded tier-2 fallback and record the substitution, never patch 11e's deliverable from
here); if recipe_seasoned_stock already carries produce when this phase opens it; if a row
cannot take produce without reducing a herb, fish, meat, or salt count
(adding is the whole rule and substitution is refused, so that is a design stop, not a trade);
if the counterfactually-vendor-fed membership moves at all under settled DECISION A, since
under that answer it must not and a movement means a price basis changed where this phase did
not look; if the parity suite moves anything; if RULE 1 cannot be satisfied for a rung without
a crop 11e did not ship; if any output value, foodHp, elixir payload, or duration would have to
move to keep a row balanced, which reopens 11c and Phase 15 and is a stop rather than an edit;
or if the release merge conflicts inside src/sim/content/recipes.ts, src/sim/content/items.ts,
or tests/recipe_economy.test.ts.
```
