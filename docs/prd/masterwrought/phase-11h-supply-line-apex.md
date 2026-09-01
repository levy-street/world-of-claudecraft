# Phase 11h: The provisioning supply line, apex tier

### Starter Prompt
```
This is Phase 11h of the Masterwrought feature: the provisioning supply line at the rungs
this packet's own thesis is about. Phase 11g put grain and vegetables into the cooking and
alchemy bills at skillReq 0, 25 and 50, and its DECISION C carried it to the 75 rung's one
choke point as well. This phase carries the same rule up to 100 and 125, where the raid
actually eats and drinks, so a level-100 farmer's output is what a raid consumes rather than
a leveling curiosity that stops at rung 50.

Model: xhigh effort. Harness: Claude Code. Worktree: ~/Documents/wocc-masterwrought
(branch feature/masterwrought). ULTRACODE: yes (content batch; four independent bill-editing
slices across three rungs of two professions, then one economy recomputation and one derived
firewall sweep over all of it).

Goal: six deliverables, and THIS PHASE MINTS ZERO NEW ITEM IDS. Every row it writes adds a
reagent to a bill that already ships. (1) The 75 rung: VERIFY ONLY. recipe_seasoned_stock is
11g's row (11g DECISION C landed marsh_rice 2 plus bog_beet 2); this phase reads the merged
bill, re-derives the arithmetic above it, and edits the row for nothing. (2) The 100 rung,
cooking: the three role plates each gain their OWN crop, so bills that are byte-identical
today read as three dishes rather than one dish with three names. (3) The 100 rung, alchemy:
the three apex flasks gain a crop as base or stabilizer, standing BESIDE their sunpetal_herb
count and never replacing any of it. (4) The 125 rung: recipe_laden_hearth and
recipe_grand_cauldron take the tier-4 showcase crops and become the two tier-4 fine twins'
capstone consumer. (5) recipe_quickening_catalyst STAYS UNTOUCHED, on purpose, and the ledger
says why. (6) The gear firewall (R17) restated and asserted by a DERIVED sweep, not by
intention.

THE APEX FEASTS ARE NOT IN THIS PHASE. They were CUT from it on 2026-08-20 and belong to Phase
11k (DECISION E below). What is left is the cheapest remarkable phase in the block: it changes
what the game's four best consumable families are MADE OF, and adds not one item id.

WHY THIS PHASE SITS HERE, so nobody re-sequences it:
- It is authored bottom up. 11g settled the leveling rungs of the same supply line; a
  bill edit at 100 that contradicts a bill edit at 25 is a ladder with two authors.
- Phase 15 seals R5's numbers. Every bill this phase touches is inside the kit Phase 15
  measures, so a row added after it forces a re-measurement of the packet's defining gate.
- Phase 11i (the angler's endgame) appends raw fish into these same apex bills, starting
  with recipe_sageleaf_chowder, and Phase 11k builds the three apex feasts on top of the
  bills this phase settles. Both depend on this phase existing first.
- If the program was re-lettered after this file was authored, the phase FILE is the
  authority per the state.md program record. Read the neighbours by ROLE, not by letter:
  the same supply line at the leveling rungs below, the angler's endgame after, and the
  provisioning capstone last.

WORKTREE GUARD (do this FIRST; the user runs multiple concurrent sessions): run pwd.
If you are not in /Users/fernando/Documents/wocc-masterwrought, switch this session into
it NOW with the EnterWorktree tool (path: /Users/fernando/Documents/wocc-masterwrought).
If EnterWorktree is unavailable or refuses, STOP and ask the user to relaunch Claude Code
from that directory. Phase work never runs from the main checkout at
~/Documents/world-of-claudecraft.

STEP 0 - PRE-FLIGHT (canonical Team Workflow, docs/prd/masterwrought/implementation-plan.md):
- git status clean, with the previous phase's QA closed and its verdict recorded.
- SYNC RELEASE: git fetch origin --prune, discover the newest release branch by version
  sort (git branch -r | grep 'origin/release/' | sort -V | tail -1), merge it, run the
  release-merge-audit skill. A minor-version-or-more jump runs as its own phase first.

- HARD DEPENDENCY, check it before anything else and STOP if it fails. This phase writes
  bills that consume TIER 3 and TIER 4 produce. THE FAUCET DECISION IS SETTLED (2026-08-20, the
  delegated rulings; 11b DECISION 1, recorded in state.md's GATE 1 row): the tier 3 and tier 4
  seed faucet is FIXED as vendor stock at farmer_hollis and farmer_verbena, EIGHT rows after
  11e DECISION B (the four shipped seeds plus the four new crops' seeds), executed once in 11e
  and priced per 11e DECISION D. What no ruling can settle is whether that code has landed yet.
  PROVE the faucet by reading the merged vendorItems arrays at both farmers IN CODE, never by
  reading a ledger row that claims it, and STOP if the rows are not there: every row authored
  here would ship reagent-dormant on arrival and the packet's Economy checklist row fails at
  Phase 17. Prove the same for any crop 11e added: FARM_CROPS is the roster and
  farmCropSkillThreshold is the gate, and a crop with no seed source is not a reagent.

- SETTLED DECISIONS, 2026-08-20. The maintainer delegated every open call to the packet, so
  NOTHING in this phase is confirmed at STEP 0 any more. Four decisions govern the work and all
  four are ANSWERED below, written as instructions this session executes. Two others are gone:
  the apex feasts are CUT to Phase 11k (DECISION E) and recipe_seasoned_stock is DROPPED to
  Phase 11g (DECISION F). The authoritative record is state.md's "Decisions closed 2026-08-20
  (the full delegation)" section; this file carries the same rulings in executable form. A
  session that finds the merged tree contradicting a ruling STOPS and reports it, and never
  re-decides it.

  DECISION A, SETTLED 2026-08-20: THE UNIFORM-BILL RULE FOR THE FOOD FAMILY.
  RULING: differentiate the FOOD family only, holding the ADDED crop row at equal or nearly
  equal summed value across the three plates, so the differentiation is flavor and never cost.
  AMEND the APEX_CONSUMABLE_RECIPES header in src/sim/content/recipes.ts IN THE SAME CHANGE,
  with this EXACT scope: the food family's bills differ by exactly one crop row and are
  identical in every other reagent; the flask family stays byte-identical. Record the resulting
  cost spread in the packet record and PIN it, so a later retune cannot widen it. Deliverable 2
  is NOT cut.
  WHY: no test pins the three role plates byte-identical, so the change is mechanically
  available, but the header states the rule and amending a written rule is a deliberate act
  that belongs where the rule lives.
  WHY THE SCOPE IS THAT NARROW: "differs by exactly one crop row" is what keeps Phase 11i's
  uniform fish row legal on the same three arrays (11i DECISION D adds the SAME fish row to all
  three plates), and it stops a later contributor reading the amendment as open season on the
  food family. A looser amendment ("the food family is exempt") is refused.
  REJECTED: leaving all three plates byte-identical and dropping deliverable 2. Cheaper, and it
  costs the phase its most player-visible improvement.
  ACCEPTANCE: the header amendment lands in the same commit as the rows; the three plates differ
  in exactly one reagent row and in nothing else; the cost spread is recorded AND pinned.

  DECISION B, SETTLED 2026-08-20: WHICH CROP GOES ON WHICH PLATE.
  RULING: the tier-3 leaf EXISTS, because 11e DECISION B mints four crops under a composition
  constraint that requires exactly one of the two new tier-3 crops to be a LEAF. Take the clean
  branch: the gourd to recipe_stonepot_stew (the tank plate, buff_sta), the grain to
  recipe_warspice_skewers (the physical plate, buff_ap), 11e's new tier-3 leaf to
  recipe_sageleaf_chowder (the caster plate, buff_int), all three at the SAME count of 2. READ
  THE MERGED ROSTER FIRST (src/sim/content/farm_crops.ts, FARM_CROPS) and take the leaf's real
  id off it; never carry an id out of this paragraph.
  WHY: the three added rows are then value-identical, so the differentiation costs exactly
  nothing and DECISION A's cost-spread pin is trivially satisfied, and all three plates ask
  the same of a farmer, farming 50 plus a tier-3 hoe that wields at 70, so a role choice is never also an economy choice OR a skill-gate
  choice.
  SUPERSEDED, not a fallback: the tier-4 halving branch (frost_gourd 2, highland_barley 2,
  evergarden_greens 1). It spreads 30, 30 and 40 of added value and asks farming 75 for one
  plate; 11e DECISION B was composed precisely to make it unnecessary.
  REJECTED: giving the caster plate the fine twin of the crop the tank plate does not use.
  Exactly cost-equal and gate-equal, but two of the three plates then read off the same crop
  line, which is most of the reason to differentiate them at all.
  ACCEPTANCE: three distinct crop ids, one per plate; every crop obtainable at the tier its
  recipe unlocks, derived through max(farmCropSkillThreshold(tier),
  wieldRequirementForTier(tier)) and ASSERTED by test, never argued.
  AMENDED IN PLACE 2026-09-01 by qr-19-obtainability-ruling-wield-rung (Phase 19, under
  qr-19-best-for-project): the plant path runs three gates and the hoe is the binding half,
  70 at tier 3 and 85 at tier 4, so the threshold alone was a partial derivation. The amended
  sentence is what 11i, 11j and 11k inherit.
  IF 11e DID NOT MINT A TIER-3 LEAF: that is a STOP, not a branch. 11e owes it under a settled
  ruling, so a session that finds it missing reports the gap rather than falling back.

  DECISION C, SETTLED 2026-08-20: THE FLASK CROP.
  RULING: ONE tier-3 grain (highland_barley on the shipped roster) at count 2, added
  IDENTICALLY to all three apex flask bills. It stands BESIDE sunpetal_herb at that reagent's
  own count and REPLACES NONE of it. The flask family stays byte-identical. Assert the
  sunpetal_herb count before and after, per bill.
  WHY: the flask chain is the DAILY-GATED one (recipe_quickening_catalyst is oncePerDay, so a
  flask costs a catalyst-day), and a bill difference on a daily-gated chain is a real gate
  rather than flavor, which is exactly where the uniform-bill rule earns its keep. Standing
  beside the herb rather than displacing it is R18 and farming's D24: herbalism loses nothing.
  REJECTED: splitting the two tier-3 crops one per family (frost_gourd as the flask stabilizer).
  It would hand the alchemy family a gourd for no reason but symmetry.

  DECISION D, SETTLED 2026-08-20: THE CAPSTONE SPLIT.
  RULING: recipe_laden_hearth (cooking 125) takes evergarden_greens 3 plus
  fine_evergarden_greens 1; recipe_grand_cauldron (alchemy 125) takes gilded_sunmelon 3 plus
  fine_gilded_sunmelon 1. Re-read both shipped source bills off the MERGED tree and carry the
  IDIOM, not this paragraph's literals.
  WHY: no number is invented. 3 base plus 1 fine is farming's own shipped showcase idiom, used
  twice (recipe_evergarden_harvest_platter, recipe_evergarden_sunmelon_tart). The greens go to
  the COOKING capstone because the platter is farming's own capstone plate, and the split gives
  each 125 capstone one showcase crop rather than making both read off the same line.
  SAME-CHANGE OBLIGATION THIS PHASE OWNS: the stale src/sim/content/items.ts comments claiming a
  tier-4 fine twin is structurally never a reagent are corrected HERE, unconditionally. 11h runs
  before 11j and 11k, so their sessions find the comment already corrected and must not
  re-correct it.

  DECISION E, SETTLED 2026-08-20: THE APEX FEASTS ARE CUT FROM THIS PHASE.
  RULING: 11h mints no apex feasts, no feast patterns, and no new item ids at all. The three
  apex feasts are Phase 11k's, at cooking 125, per 11k K1 to K5. This is a CUT with its reason
  recorded, never a later item, and the phase's feast slice is deleted with it.
  WHY: 11k owns every piece of machinery the feasts need (widening placeFeastAction off the
  hard-coded FARM_FEAST_ITEM_ID, the three templateIds, the membership helper, and the four
  keyed sites), so minting the items here would ship three placeable entities that no code can
  place. 11k's bill is also the better one: at cooking 125 it can take both tier-4 fine twins
  and 11i's new high-band catch, which is the first bill in the game where a fish leaves fishing
  and reaches the raid, and this phase's own reason for excluding the twins at rung 100
  evaporates once the rung is 125.
  CONSEQUENCES THIS PHASE CARRIES: no new pattern, no HEROIC_VENDOR_STOCK row, no marks price,
  no new proper noun, no art, no M16 fill, and no count pin anywhere moves for a new row.

  DECISION F, SETTLED 2026-08-20: recipe_seasoned_stock IS DROPPED TO 11g.
  RULING: 11g DECISION C owns the row and lands marsh_rice 2 plus bog_beet 2. This phase takes
  the merged bill AS GIVEN, re-derives the gold-negative arithmetic above it from the merged
  numbers, and edits the row for nothing.
  WHY: exactly one phase may edit a choke point, 11g runs first, and grain plus root is the
  better bill: the stock feeds every apex cooking row, so coupling it to TWO tier-2 crops
  spreads the choke point across two vendor-seeded, market-fed supply lines instead of making
  the whole cooking apex ride one paddy.
  PRE-CHECK: if recipe_seasoned_stock carries NO produce when this phase opens it, 11g has not
  landed. STOP and reconcile; do not author the row here.

- Memory scan (MEMORY.md index): the test-pin trap index (READ it before touching any pin:
  predicted-then-observed, constant-self-comparison, comment-gameable source pins, vitest -t
  is a regex), the i18n reword-staleness entry (the header amendment is a reword),
  release-merge gate surprises, and the gate-env DATABASE_URL entry (never source a whole
  .env around a gate or vitest run). new-item-content-hidden-obligations and
  item-art-ownership-batch-xor-entries are read for one purpose only under DECISION E: to
  confirm they have nothing to bite, because this phase mints no item id.

STEP 1 - LOAD CONTEXT (Explore agent; do not read planning docs in the main loop):
- docs/prd/masterwrought/state.md: R5, R8, R13, R14, R17 to R20 in full, the Power placement
  block, the professions completion program record, the validation matrix, the Phase 10
  apex-consumable ledger, and the "Decisions closed 2026-08-20 (the full delegation)" section,
  which is where the decisions above are recorded and where 11g DECISION C and 11k K1 to K5 are
  recorded as the two rulings this phase hands work to. R15 and the naming registry are read
  only far enough to confirm this phase coins nothing.
- docs/prd/masterwrought/farming/state.md: D11, D16, D21, D24, deviations (ad), (bo), (bz),
  (ca), and the OPEN list, which is this packet's one open-item collection point (until 11b's
  doc move creates it, the delegated-rulings block at the end of state.md is that collection
  point). Plus progress.md's Phase 11h row, decisions-index.md, and the 11g ledger, which is the
  authority for the merged recipe_seasoned_stock bill.
- Content: src/sim/content/recipes.ts (INTERMEDIATE_RECIPES and recipe_seasoned_stock as 11g
  left it; APEX_CONSUMABLE_RECIPES and its header's uniform-bill, gold-negative, batch-output
  and transitive-pacing rules; APEX_ARMOR_RECIPES and APEX_GEAR_RECIPES for the firewall sweep;
  the merged farming rows, including recipe_evergarden_harvest_platter and
  recipe_evergarden_sunmelon_tart, which are the showcase idiom DECISION D copies).
  src/sim/content/farm_crops.ts (FARM_CROPS as 11e left it, farmCropById, farmCropSkillThreshold
  and its 25-point band math: tier 1 gates at 0, tier 2 at 25, tier 3 at 50, tier 4 at 75).
  src/sim/content/profession_items.ts (the three role plates, the three flasks, seasoned_stock,
  the foodHp-1392 header).
  src/sim/content/items.ts (the crop rows, the fine twins and their buyValues, laden_hearth,
  grand_cauldron, and the stale tier-4-fine-twin comments this phase owns correcting).
- Tests that will move: tests/recipe_economy.test.ts (BOTH sorted literal pins, the intermediate
  literal bill table, the non-vacuity floor, MATERIAL DEMAND COVERAGE) and
  tests/farm_recipes.test.ts (the fine-twin consumer arms and the hoe-twin exclusion arm), plus
  tests/guide.test.ts for wiki freshness. Tests that must NOT move, and are run to prove it:
  tests/masterwrought_budget.test.ts, tests/heroic_vendor.test.ts, tests/apex_pattern_items.test.ts,
  tests/bag_filter.test.ts, tests/shipped_item_ids.test.ts with its golden, and
  tests/item_icons.test.ts with the ITEM_ART_PENDING allowlist.
Return: the merged reagent bill and sellValue of every recipe and item named above, read off the
MERGED table and not carried from either parent; the merged FARM_CROPS roster with each crop's
tier and its derived skill gate, NAMING the tier-3 leaf 11e minted; both farmers' merged
vendorItems arrays; the exact current text of the APEX_CONSUMABLE_RECIPES header rule this phase
amends; the merged recipe_seasoned_stock bill; and the current values of every pin listed above.

STEP 2 - EXECUTE (parallel fan-out, explicitly; five agents by vertical slice). Agents 1
through 4 are independent and run together. Agent 5 runs LAST, because the economy
recomputation must read every other agent's rows.

Agent 1 (THE 75 RUNG, VERIFY ONLY: this slice edits nothing):
- Read recipe_seasoned_stock in INTERMEDIATE_RECIPES off the merged tree. Under DECISION F the
  row is 11g's and carries marsh_rice 2 plus bog_beet 2. If it carries no produce at all, 11g
  has not landed: STOP and reconcile, because every rung above it is priced against that bill.
- Re-derive and PRINT the arithmetic the rungs above inherit from it: the stock's summed input
  against its output of 30, and what 11g's rows did to the gold-negative margin of the three
  role plates and The Laden Hearth. Print it from the merged table, never from a sentence in a
  planning file.
- Record why the choke point is the right place for farming to enter the apex tier, because the
  ledger carries the reasoning even though the row is not this phase's: the stock is what the
  three role plates, The Laden Hearth and 11k's three apex feasts all run through, so one row
  makes farming the supply line for everything above it while the plates keep the shape
  DECISION A and DECISION B give them.
- Compulsion is avoided by construction and the ledger says how (R18): produce is kind 'junk'
  and market-listable, so the requirement lands on a MATERIAL exactly as sunpetal_herb already
  does in the same tier, never on a profession; both crops in the stock are tier 2, whose seeds
  are vendor-stocked, so a non-farmer buys them on the market; and the counts stay small beside
  the meat bill so a thin farming market cannot brick raid food.
- THE PIN THAT IS NOT YOURS: tests/recipe_economy.test.ts carries a full LITERAL bill table for
  every INTERMEDIATE_RECIPES row ("every intermediate row consumes its exact authored reagent
  bill"). That table exists because a quantity retune once stayed green everywhere except the
  wiki mirror, and 11g edits it with its row. Confirm it already matches the merged bill and
  LEAVE IT ALONE; a mismatch is a STOP, because it means one of the two phases moved the row
  without the pin.
- recipe_quickening_catalyst sits in the same array and its bill is pinned in the same table.
  Confirm it is byte-identical and move on.

Agent 2 (THE 100 RUNG, COOKING: the three role plates):
- Under DECISION A and DECISION B, give each role plate its own crop row: the gourd to
  recipe_stonepot_stew, the grain to recipe_warspice_skewers, 11e's new tier-3 leaf to
  recipe_sageleaf_chowder, all three at count 2, with every id read off the merged FARM_CROPS
  roster. The three bills stop being byte-identical to each other; nothing else about them
  moves.
- Amend the APEX_CONSUMABLE_RECIPES header in the same change to DECISION A's exact scope: the
  food family's bills differ by exactly one crop row and are identical in every other reagent;
  the flask family stays byte-identical. Write the reason where the rule lives. A rule silently
  contradicted by the rows under it is worse than a rule changed on purpose, and the looser
  amendment is refused because it would read as open season and would not tell 11i what its
  fish row has to satisfy.
- Print the derivation beside every row: the count, why it is that count, and the summed added
  value. The three added rows are value-identical by construction, so record that spread as the
  pinned number DECISION A asks for. Then print the gold-negative arithmetic re-derived from the
  merged table (today input about 422 against an output of 360, four plates at 90) and confirm
  the margin WIDENS, which is the whole safety argument for adding a reagent to a tight row.
- The three plates keep their identical foodHp, their identical wellFed magnitude and duration
  (the ladder 11c settled: the apex role plates at 6 for 900 seconds on the single well_fed
  aura id), and their identical sellValue. This agent moves the INPUT side only.
- INTERLOCK, stated so the two phases do not collide: Phase 11i appends the SAME raw fish row to
  all three plates and to recipe_laden_hearth (11i DECISION D), and it runs after this phase.
  Both edits append to the same reagents arrays, so leave them in a state 11i can append to,
  record that in the ledger, and note that 11i re-derives the economy arithmetic from the merged
  row rather than carrying this file's numbers. The amended header is written to be true AFTER
  11i lands, not just today: the crop row differentiates, the fish row unifies.

Agent 3 (THE 100 RUNG, ALCHEMY: the three apex flasks):
- Under DECISION C, add ONE tier-3 grain row (highland_barley on the shipped roster, read off
  the merged FARM_CROPS) at count 2 to all three flask bills IDENTICALLY. The three flask bills
  stay byte-identical to each other.
- ADDED, never substituted: the sunpetal_herb count does not move by one, in any of the three
  bills. That is R18 and D24 together, and it is the single most checkable line in this phase,
  so assert it (the herb count before and after) rather than stating it.
- Print the gold-negative arithmetic re-derived from the merged table (today input about 424
  against an output of 50, two flasks at 25). The margin here is enormous; say so and move on.
- The flasks' elixir payload (value 15, duration 1200) is NOT touched. If a slice believes a
  magnitude needs to move to make a row work, that is a STOP, not an edit.
- Say out loud in the ledger why the flask family keeps the uniform bill while the food family
  does not, because the amended header now depends on it: the flask chain is the daily-gated
  one, so a bill difference between roles there would be a real gate rather than flavor.

Agent 4 (THE 125 RUNG: the two capstones and the fine twins):
- Under DECISION D, add the tier-4 showcase crop and its fine twin to each capstone:
  recipe_laden_hearth takes evergarden_greens 3 plus fine_evergarden_greens 1;
  recipe_grand_cauldron takes gilded_sunmelon 3 plus fine_gilded_sunmelon 1. Re-read both
  shipped source bills (recipe_evergarden_harvest_platter and recipe_evergarden_sunmelon_tart)
  off the merged tree and carry the IDIOM, not this file's literals.
- READ THE MERGED TREE BEFORE WRITING THE LEDGER CLAIM, because the loose version of it may
  already be false by the time this phase runs: 11e added crops to the platter and the tart, and
  11f re-tiered the farm ladder to 0/25/50/75/100. Record what consumes each tier-4 fine twin,
  at what rung, on the MERGED tree, and make the ledger's claim the accurate narrow one: this
  phase gives both twins their CAPSTONE consumer at skillReq 125, the top of the catalog, which
  is the R20 shape the packet exists to close.
- SAME-CHANGE OBLIGATION THIS PHASE OWNS (DECISION D): correct the stale
  src/sim/content/items.ts comments that say a tier-4 fine twin is structurally never a reagent
  (each hoe rung consumes the twin one tier below it under farming's deviation (ad), so the
  comment concluded a tier-4 twin has no possible consumer). This correction happens HERE, once;
  11j and 11k find it already corrected.
- Print the gold-negative arithmetic for both rows re-derived from the merged table (today the
  hearth is about 606 against 380 and the cauldron about 1010 against 380). Both margins widen.
- Neither capstone's output, skillReq, acquisition, stationType or itemLevelBudget moves.

Agent 5 (THE FIREWALL, THE PINS, AND THE OBLIGATIONS; runs LAST):
- THE GEAR FIREWALL (R17), asserted by a DERIVED sweep and never by a hand-typed list, because a
  hand list goes stale the moment a phase adds a crop. THE SWEEP EXTENDS
  tests/provisioner_firewall.test.ts, the file 11f Agent 6 created (qr-R17-SWEEP, state.md
  row 131): one invariant, one guard file, never a sibling with its own carve-out shape;
  this agent upgrades that file's hand-named barred set to the derivation below and keeps
  every 11f arm green. Derive the farm item set from FARM_CROPS
  (every row's seedItemId, produceItemId and fineProduceItemId), then assert that not one of
  those ids appears as a reagent in: any APEX_ARMOR_RECIPES row, any APEX_GEAR_RECIPES row, any
  INTERMEDIATE_RECIPES row EXCEPT recipe_seasoned_stock, or recipe_quickening_catalyst. Assert
  separately that no farm id is a Perfecting material (makers_ember, sundered_essence,
  prismglass_setting), written so it still binds when Phase 12 lands the Perfecting stage on top
  of it.
  The carve-out is deliberate and the test comment says why: recipe_seasoned_stock is the
  CONSUMABLE chain's intermediate, the one row of INTERMEDIATE_RECIPES whose output is eaten
  rather than worn, so produce there is R17 working exactly as written. The six gear
  intermediates (duskforged_billet, forgefold_plating, wyrmhide_cording, sunspun_bolt,
  prismglass_setting, precision_chassis) plus lucent_reagent and sablewax_vellum are the barred
  set, named in the comment so the carve-out can never widen by accident. The GATHERING-TOOL
  question is NOT this sweep's and must not be pre-answered inside it: it is settled at 11j
  DECISION F, scoped by text to the hoe ladder alone, and executed there (see the scope record
  below).
- recipe_quickening_catalyst UNTOUCHED, and the ledger states the reason rather than implying
  it: it is the packet's ONE pacing gate, oncePerDay and keyed per recipe id, and every apex
  gear row plus the whole flask chain pays a catalyst-day through it. Routing produce into it
  would put a wall-clock-gated input in front of the gate that paces the entire packet, which
  makes farming mandatory for the whole tier. That is the compulsion failure mode R18 exists to
  prevent, and it is a mechanical refusal, not a preference.
- ECONOMY RECOMPUTATION, the merge hazard this agent exists for.
  tests/recipe_economy.test.ts is edited by BOTH packets and carries sorted literal pins: the
  counterfactually-vendor-fed membership list and the frozen legacy list. BOTH are RECOMPUTED
  from the merged ALL_RECIPES and NEVER hand-merged; a resolution that keeps one side's literal
  goes green while silently deleting the other side's guard. The non-vacuity floor under the
  membership pin stays and moves with the set. Watch the specific hazard this phase creates: the
  tier-4 FINE twins carry a buyValue while the base crops do not, so adding a fine twin to a
  bill changes that bill's counterfactual classification only if EVERY other reagent also
  carries one. Re-derive the membership, do not reason about it.
- Every material still has a consumer (the MATERIAL DEMAND COVERAGE arm), and every source
  comment this phase falsifies is corrected in the same change rather than left stale. Agent 4
  owns the tier-4 twin comments; sweep for any other farming comment this phase's rows falsify.
- THE PIN worth reading rather than tripping over: tests/farm_recipes.test.ts asserts that
  fine_vale_wheat, fine_marsh_rice and fine_highland_barley (the HOE twins) are NOT consumed by
  any farm DISH, because "a dish slot would double-book the twin". DECISION D puts a TIER-4 twin
  into an APEX_CONSUMABLE_RECIPES row, which is neither a hoe twin nor a farm dish, so the arm
  neither trips nor should. Record that reading in the ledger instead of relying on the scope by
  accident, and add a cross-table arm only if a later decision actually needs one.
- COUNT PINS: not one of them moves, and that is an ASSERTION rather than an expectation,
  because this phase appends no row anywhere. Confirm each is UNCHANGED and record it: the
  APEX_CONSUMABLE_RECIPES length pin (8, "six apex rungs plus two capstones", whose title stays
  true), the local APEX_CONSUMABLES table in tests/masterwrought_budget.test.ts (6) and the
  sweep that walks it, the HEROIC_VENDOR_STOCK length and the PATTERN_PRICES literal in
  tests/heroic_vendor.test.ts, tests/apex_pattern_items.test.ts, the pattern id list in
  tests/bag_filter.test.ts, tests/shipped_item_ids.golden.json, and the merged ITEM_ART_PENDING
  allowlist. Any of these MOVING is a signal to stop: it means a row was appended that
  DECISION E cut.
- Wiki and guide: bills changed, so npm run wiki:content is MANDATORY and tests/guide.test.ts
  gates the freshness. Read the regenerated cooking and alchemy pages and confirm the new
  reagent rows render. No new guide.* prose is owed, because this phase names nothing new.

INVARIANTS IN PLAY: R5 (see the block below: this phase moves input cost, not output power);
R8 (no new recipe is authored, so no new channel is opened); R13 (the rungs it edits are the
shipped ones, apex at 100 and capstones at 125); R14 (no new proc effects: this phase mints no
effect at all); R15 and D17 (nothing to web-verify, because this phase coins no proper noun, and
that verdict is WRITTEN rather than inferred); R17 (the gear firewall, asserted by a derived
sweep); R18 and D24 (added alongside, never substituted; produce stays listable junk); R20 (this
phase is a large part of how farming's OUTPUT reaches skillReq 100 and above, and 11j lands the
guard test); D16 (the feast lifecycle is feast.ts's and is not touched here at all, because the
feasts are 11k's); determinism (this phase adds NO rng draw; if a slice believes it needs one,
that is a STOP); ids append-only, in its strongest reading here: this phase's ADDITION SET IS
EMPTY (tests/shipped_item_ids.test.ts and its golden unchanged, asserted); no generated file
hand-edited; and no append-only table is touched at all, so the three-tier ordering rule has
nothing to apply to, including in src/ui/i18n.catalog/items.ts.

R5 AND WHAT THIS PHASE DOES NOT MOVE. State this in the ledger in these terms, because the QA
twin's job is to CONFIRM it rather than to re-measure balance:
- Every slice here adds REAGENTS. A reagent changes what a craft COSTS and never what it
  produces. No foodHp, no Well Fed magnitude or duration, no elixir value or duration, no stat,
  no rating and no item budget moves anywhere in this phase. R5 measures the full kit's
  throughput against pre-packet raid BiS, so an input-cost change cannot reach it, and the kit
  stays at flask 15 plus food 6 equals 21 stamina, exactly the number Phase 15 was authored
  against.
- UPTIME does not move here either, and that is a consequence of DECISION E. The apex feasts
  were the one place in this phase's old shape where ACCESS could change, and they are 11k's
  now. Phase 15's R5 premise was re-authored on 2026-08-20 to "the best available food, always
  on, delivered by feast", and the feast that delivers it is 11k's row, measured there. If any
  slice believes a magnitude must change for a row to work, that is a STOP, not an edit.

CONTENT OBLIGATIONS. This phase mints ZERO new item ids, so the whole stack collapses to a
written NIL, and it is WRITTEN rather than left inferred, because the content-obligations
reviewer treats an unwritten verdict as a gap:
- No art and no ITEM_ART_PENDING row, so there is no mapping.json ownership to arbitrate; assert
  the merged allowlist is unchanged.
- No M16 non-Latin name fills, because no English name is authored.
- No R15 or D17 verdict beyond the sentence that says so: no coinage, nothing to verify.
- No row in src/ui/i18n.catalog/items.ts, and nothing in src/ui/world_entity_i18n.ts.
- The Reliquary sweep RUNS anyway and its verdict is written down: no page, because this phase
  adds no conquerable content.
- NO Book of Deeds record here, recorded as a POINTER rather than as silence: prog_field_to_feast
  is Phase 11k's deliverable.
- npm run wiki:content is MANDATORY because bills changed, with tests/guide.test.ts freshness
  green. No new guide.* prose is owed.
- THE ONE LIVE OBLIGATION: the APEX_CONSUMABLE_RECIPES header amendment is a REWORD. Put every
  key whose English moves with it on the release-tier fill worklist BY KEY, because a filled row
  whose English changed still reads as filled. If the amendment turns out to touch no
  player-visible or wiki string, write that verdict down as none rather than leaving it
  inferred.
- The economy-invariant recheck above.

EXPLICIT SCOPE RECORDS, written down so nothing is dropped in silence and nothing is
re-proposed:
- THE APEX FEASTS, CUT 2026-08-20 (DECISION E), with the reason recorded there. Two questions
  travel with them rather than being deleted, so the trail from 11h to 11k stays visible:
  the feast output PRICE is MOOT here and survives once, as 11k DECISION K2 (quality epic, and a
  sellValue DERIVED strictly above harvest_feast's 250 and strictly below laden_hearth's 380, at
  a multiple of 10, gold-negative against the merged bill); the three feast NAMES are MOOT here
  and are ruled in 11k. This phase mints no proper noun and its naming verdict is "no coinage,
  nothing to verify", written down.
- recipe_seasoned_stock, DROPPED to 11g 2026-08-20 (DECISION F). This phase reads the merged
  bill, re-derives the arithmetic above it, and edits the row for nothing.
- THE 150 RUNG. The only skillReq 150 rows in the game are the three engineering apex gathering
  tools (arcanite_mining_pick, elderwood_axe, sunpetal_sickle), and they are grandfathered
  history rather than a reachable rung. Whether produce in a gathering-TOOL bill is inside R17 is
  SETTLED, but not here: 11j DECISION F rules that the carve-out STANDS, scoped BY TEXT to the
  hoe ladder alone, recorded as an R17 clarification and never as a change to R17. The shipped
  recipe_osmium_hoe (it already consumes fine_highland_barley under farming's deviation (ad)) is
  the evidence for 11j, not a licence for this phase: 11h's bills are consumables under R17's
  plain reading, and this phase does not touch the 150 rung or the tool ladder at all.
- Farming's own recipe rungs at 75 and 100 are Phase 11f's, and 11f-GATE-A stops the farm
  ladder there, so nothing farming owns reaches 125. This phase puts produce into
  COOKING and ALCHEMY bills; it does not author farming recipes.
- The deed, the titles and the player-visible R18 copy are Phase 11k's.
- The fish in the three role plates and in recipe_laden_hearth is Phase 11i's.
- Substituting a farming row for a herb or meat row anywhere, at any rung. Refused by R18 and by
  farming's D24, and refused mechanically: herbalism just got its best decade from this packet's
  ten crafts, and a substitution would take it back.
- A produce row in recipe_quickening_catalyst, in any gear intermediate, in any apex gear bill,
  or among the Perfecting materials. Refused by R17 and asserted by Agent 5's sweep.
- Raising any consumable magnitude to make a bill feel worth its new cost. R5 is measured, not
  felt, and Phase 15 owns the envelope.

Out of scope: the well-fed ladder and the aura id (11c owns them and they are settled at one
aura id, well_fed, with the apex role plates at 6 for 900 seconds; if this phase believes a
magnitude is wrong, that is a STOP, not an edit); the apex feasts and their prestige surface
(11k); the Perfecting stage (Phase 12); UI beauty work on any professions surface (Phase 14);
the R5 envelope measurement (Phase 15); the merged icon and wiki enumeration sweep (Phase 16),
though the rows this phase edits land there.

STEP 3 - VALIDATION + REVIEW (matrix in implementation-plan.md):
npx tsc --noEmit; then npx vitest run tests/recipe_economy.test.ts tests/farm_recipes.test.ts
tests/professions_farming.test.ts tests/flask_consumables.test.ts tests/consumables.test.ts
tests/masterwrought_budget.test.ts tests/heroic_vendor.test.ts tests/apex_pattern_items.test.ts
tests/bag_filter.test.ts tests/shipped_item_ids.test.ts tests/item_icons.test.ts
tests/guide.test.ts tests/architecture.test.ts tests/localization_fixes.test.ts plus every new
suite. Six of those are in the battery for the OPPOSITE reason to usual, and they must come back
UNCHANGED: masterwrought_budget, heroic_vendor, apex_pattern_items, bag_filter, shipped_item_ids
and item_icons. Running them is how this phase proves it minted nothing. THEN the FULL suite
(npx vitest run --maxWorkers=5) before calling any review round done: a content phase that edits
shared tables is exactly the shape where a red hides outside a curated battery. npm run
ci:changed on the touched files only. Read the gate LOG, not just its exit code: a printed FAIL
marker overrides a zero exit.
Review Dispatch Matrix: content-obligations-reviewer (the whole content diff, and specifically
the WRITTEN NIL verdicts: no art, no M16, no new names, the Reliquary verdict, the deed pointer,
the empty addition set); frontend-seam-reviewer ONLY if a player-visible or wiki string moved
with the header amendment; architecture-reviewer ONLY if a non-data file under src/sim/ moved
(this phase should touch content tables only, so a src/sim/professions/ diff is a signal to stop
and ask); qa-checklist when the deliverable set is complete. Skip privacy-security-review,
migration-safety and database-performance-reviewer unless server/ or a SQL call site was
touched; skip cross-platform-sync unless a SimEvent, wire field or matcher rule was added.
COVERAGE prompts; apply ALL findings, blocking and should-fix and nits.

STEP 4 - COMMIT CADENCE (explicit paths, bodies, no session trailers):
- feat(content): give each apex role plate its own crop
- feat(content): a farm crop enters the three apex flask bills
- feat(content): the two capstones take the tier-4 showcase crops and their fine twins
- test(content): assert the R17 gear firewall and re-derive the moved economy pins

STEP 5 - ACCEPTANCE:
- [ ] The seed faucet is PROVEN IN CODE at STEP 0 (both farmers' merged vendorItems arrays carry
      the tier 3 and tier 4 seed rows), and every crop this phase consumes is obtainable by a
      player, proven end to end rather than argued
- [ ] The three role plates are genuinely differentiated: three distinct crop ids, one per
      plate, each matching its role flavor, with the DECISION A header amendment landed in the
      same change and the cost spread recorded AND pinned
- [ ] The amended header reads exactly as DECISION A scopes it (the food family differs by
      exactly one crop row and is identical in every other reagent; the flask family stays
      byte-identical), and 11i's uniform fish row is still legal under it
- [ ] Every crop consumed is available at the tier its recipe unlocks (tier gate derived through
      farmCropSkillThreshold, never hand-set), asserted
- [ ] NO herb or meat count dropped anywhere: the before and after sunpetal_herb count is
      asserted per touched bill (R18, D24)
- [ ] The three apex flask bills are byte-identical to each other; the plates are deliberately
      not, and the header says which rule applies where
- [ ] The two tier-4 fine twins have a consumer at skillReq 125, and the stale
      hoe-reagent-only comments beside them are corrected in THIS change
- [ ] recipe_seasoned_stock diff EMPTY: 11g's merged bill read, the arithmetic above it
      re-derived, the row unedited
- [ ] recipe_quickening_catalyst diff EMPTY, with the reason recorded
- [ ] The R17 firewall sweep is DERIVED from FARM_CROPS and green: no farm id in any apex gear
      or armor bill, in any gear intermediate, or among the Perfecting materials, with
      recipe_seasoned_stock the one documented carve-out and the hoe ladder left to 11j
- [ ] Every touched row re-derived gold-negative with the arithmetic PRINTED beside it and the
      margin shown to widen, not narrow
- [ ] ZERO new item ids: tests/shipped_item_ids.golden.json diff EMPTY and no ITEM_ART_PENDING
      row added, asserted rather than assumed
- [ ] NO count pin moved anywhere (no row appended to APEX_CONSUMABLE_RECIPES,
      HEROIC_VENDOR_STOCK or apex_patterns.ts), and each was checked rather than presumed
- [ ] Both recipe_economy sorted literals RECOMPUTED from the merged ALL_RECIPES with the
      non-vacuity floor intact; the intermediate literal bill table confirmed to match the
      merged row and left alone
- [ ] Wiki regenerated on the merged tree; guide freshness green
- [ ] The header amendment's reword set is on the release-tier fill worklist by key, or the
      verdict "no player-visible string moved" is written down
- [ ] The NIL content verdicts are all WRITTEN (art, M16, naming, Reliquary, the deed pointer)
- [ ] R5 statement recorded as written above; no magnitude anywhere in the packet moved
- [ ] Full suite green; ci:changed clean; gate log read, not just its exit code

STEP 6 - DOCS: progress.md Phase 11h row; state.md ledger (the four decisions as EXECUTED, plus
the two that are gone recorded as what they are, one CUT to 11k and one DROPPED to 11g; every
bill and count with its derivation; the DECISION A header amendment with the recorded, pinned
cost spread; the R5 statement; the firewall sweep and its one carve-out; the written NIL
obligation verdicts; the explicit scope records; and the 11i and 11k interlocks); the packet's
open-item record updated in place (farming/state.md's OPEN list once 11b's doc move has created
it, and the dated delegated-rulings block at the end of state.md until then), because the
tier-4 fine-twin consumer question CLOSES here; memory note for anything that surprised you.

STEP 7 - REPORT: phase status, files, validation results, reviewer verdicts, the pin table
(predicted versus observed, including every pin this phase asserts is UNCHANGED), the four
decisions as executed plus the CUT and the DROP, and the handoff line for Phase 11h QA.

STOPPING RULES: stop and ask if the merged tree contradicts a settled decision, because that is
a finding and not a licence to re-decide; if the tier 3 and tier 4 seed rows are not in the
merged vendorItems arrays, because every row here would ship dormant; if recipe_seasoned_stock
carries no produce when this phase opens it, because 11g has not landed and this phase does not
author that row; if 11e did not mint the tier-3 leaf DECISION B consumes; if a bill cannot be
made gold-negative without inventing a price point outside the shipped curve; if the merged
roster has no crop that satisfies a decision as ruled (do not substitute a crop from another
tier on your own authority); if any deliverable here appears to need an rng draw, a magnitude
change, or a new item id; if any count pin MOVES, because this phase appends no row anywhere; if
the firewall sweep finds a farm id already inside a barred bill (that is a defect in an earlier
phase, not something to fix quietly here); or if the release merge conflicts inside
src/sim/content/recipes.ts, src/sim/content/profession_items.ts, or
tests/recipe_economy.test.ts.
```
