# Phase 11i: The angler's endgame

### Starter Prompt
```
This is Phase 11i of the Masterwrought feature: the phase that makes fishing feed something
other than its own rod. Fishing is the deepest gathering profession in the game (maxSkill
200) and the only one whose back half unlocks nothing at all.

Model: xhigh effort. Harness: Claude Code. Worktree: ~/Documents/wocc-masterwrought
(branch feature/masterwrought). ULTRACODE: YES. This is batch content: three catch bands,
three new catches, a rod rung, four patterns, four cooking rows, and roughly a dozen
same-change obligations per new id. Run it as a batch with an explicit fan-out, not as a
sequence of one-off edits.

THE MEASURED PROBLEM (state.md, "The professions completion program"; these numbers are the
authoring basis and are not to be re-derived or contradicted):
- Fishing ships maxSkill 200 with FISHING_GAIN_SCHEDULE bands at 50/100/150/200.
- Six raw fish exist (raw_mirror_trout, raw_river_perch, raw_marsh_pike, raw_bog_eel,
  raw_frostgill_trout, raw_stonescale_carp) across THREE catch bands, and rod tier 3
  already reaches the last band. src/sim/content/items.ts says so in its own rod comment:
  "What the top two rungs actually buy: no new catch band ... and no new zone."
- Endgame bills (skillReq >= 75) per gathering profession: mining 21, herbalism 15,
  skinning 11, logging 6, FISHING 1. That one row is recipe_tidewrought_fishing_rod, a
  fishing rod, so fishing feeds only itself. (AMENDED 2026-08-20, qr-CENSUS, state.md row
  130: the fishing count measures 2 on this tree, recipe_stormreel_fishing_rod at
  engineering 75 also consumes glimmerfin_koi; BOTH rows are rods, so the conclusion
  stands exactly as written.)
- recipe_sageleaf_chowder is a CHOWDER whose reagents are seasoned_stock, prime_cut,
  game_meat, sunpetal_herb and cooking_salt. There is no fish in it.
- Fishing 200 grants prog_master_angler: the Master Angler title and 25 renown. That is the
  whole reward for 150 points of grind.

Goal: seven deliverables. (1) Extend the catch ladder with THREE new high bands so the back
half of the skill and the top half of the rod ladder both pay, with the nine shipped cells byte
identical. (2) Extend the rod ladder with an apex rung that completes the engineering apex tool
family through a channel that can actually be learned. (3) Put fish in the apex kitchen, starting
with the chowder that has none. (4) Put fish recipes into the drop economy at cooking 75 / 100 /
125 on the shipped pattern machinery. (5) A capstone worth 200 that is a ROLE (the master angler
is the sole faucet of a good the raid wants), never a new stat. (6) ONE new Book of Deeds record,
for the apex rod craft, because the shipped gathering deed ladder is complete and is NOT missing
intermediate rungs (the deed ruling, settled 2026-08-20, is in Agent 5 below). (7) THE PACING
ARM (DECISION F below, added 2026-08-20 by the quality-review adoption pass): re-derive
FISHING_GAIN_SCHEDULE's values from a measured casts-to-200 model, because a destination at the
top of an 11-hour 0.02-per-catch tail is still an 11-hour tail, and fixing fishing's reward
while shipping its pacing debt untouched was the plan's one unaddressed chore.

WORKTREE GUARD (do this FIRST; the user runs multiple concurrent sessions): run pwd.
If you are not in /Users/fernando/Documents/wocc-masterwrought, switch this session into
it NOW with the EnterWorktree tool (path: /Users/fernando/Documents/wocc-masterwrought).
If EnterWorktree is unavailable or refuses, STOP and ask the user to relaunch Claude Code
from that directory. Phase work never runs from the main checkout at
~/Documents/world-of-claudecraft.

STEP 0 - PRE-FLIGHT (canonical Team Workflow, docs/prd/masterwrought/implementation-plan.md):
- git status clean, with Phase 11h QA closed. This phase edits APEX_CONSUMABLE_RECIPES and
  tests/recipe_economy.test.ts, which 11g and 11h also edit; if their pins have not been
  re-derived, STOP, because a fish row added on top of an unsettled bill is indistinguishable
  from a lost produce row.
- SYNC RELEASE: git fetch origin --prune, discover the newest release branch by version sort
  (git branch -r | grep 'origin/release/' | sort -V | tail -1), merge it, run the
  release-merge-audit skill. A minor-version-or-more jump runs as its own phase first.
- SETTLED DECISIONS, 2026-08-20. The maintainer delegated every open call to the packet, so
  nothing here is confirmed at STEP 0 any more: six decisions govern this phase and all six
  are ANSWERED below, written as instructions this session executes (DECISION F was added
  2026-08-20 by the quality-review adoption pass, state.md row 121). DECISION A is the one
  state.md carried as an open maintainer gate ("the fishing band and rod-ladder shape"); its
  state.md row is now CLOSED and corrected to THREE new bands. B to E are its consequences and
  are settled with it. The authoritative record is state.md's "Decisions closed 2026-08-20 (the
  full delegation)" section. A session that finds the merged tree contradicting a ruling STOPS
  and reports it, and never re-decides it.

  DECISION A, SETTLED 2026-08-20: THE BAND AND ROD-LADDER SHAPE.
  RULING: GROW the catch ladder by THREE new bands, 3, 4 and 5, riding the shipped gate that
  catch band b takes rod tier b + 1, so band 3 takes the shipped stormreel_fishing_rod (tier 4),
  band 4 takes the shipped tidewrought_fishing_rod (tier 5), and band 5 takes a NEW tier-6 apex
  rod. The nine shipped cells stay byte identical; FISHING_TABLES_BY_BAND grows from three
  entries to six; three new catch ids are minted; and the fishing band union (band: 0 | 1 | 2)
  plus server/fishing_telemetry.ts's label set widen with their cardinality comments.
  WHY: the measured defect is not that the ladder is short, it is that rod tier 3 already reaches
  the last band, so stormreel_fishing_rod and tidewrought_fishing_rod buy an angler nothing in
  the catch table today. Three bands on the shipped gate retroactively give both SHIPPED rods a
  reason to exist, which is a bigger win than the new content itself.
  REJECTED: the existing three bands take new fish behind the shipped tier-3 rod. It puts every
  new catch where the ladder already ends, leaves the top two rods still buying nothing, and
  cannot be done without editing the shipped band-2 cells, which is the one edit this phase's QA
  twin forbids.
  REJECTED: two new bands (3 and 4) with no new rod. It would CUT the apex rung and leave the rod
  ladder's top rung unpaid, which is the defect this phase exists to fix.
  REJECTED OUTRIGHT: a new rod that carries no band, because that repeats verbatim the defect
  items.ts already documents against itself.

  DECISION B, SETTLED 2026-08-20: THE PROFICIENCY LADDER THE NEW BANDS SIT ON.
  RULING: fishing gets its OWN threshold ladder,
  FISHING_CATCH_BAND_THRESHOLDS = [0, 100, 150, 200, 200, 200], in a NEW pure leaf module,
  src/sim/professions/fishing_bands.ts. The SHARED PROFICIENCY_BAND_THRESHOLDS in
  src/sim/professions/proficiency_bands.ts stays literally [0, 100, 200] and is NOT touched.
  Move tests/professions_fishing.test.ts's [0, 100, 200] literal and its toHaveLength(3) pin onto
  the new leaf, re-derived there against the six-entry ladder, and keep a separate arm proving
  the SHARED ladder is unchanged. Re-record
  tests/parity/golden/professions_fishing_session.json, predicted before observed.
  ACCEPTANCE: the no-regression claim is PROVEN by an exhaustive walk over proficiency 0 to 200
  crossed with rod tier 1 to 6, with the moved-pair set PREDICTED in the ledger before the walk
  runs and observed after. No pair may resolve lower than it does today.
  WHY: PROFICIENCY_BAND_THRESHOLDS is shared. src/sim/professions/proficiency_display_heal.ts
  and the land gather-cast duration read the same array, so gating fishing catches through it
  would silently retune land gathering. Under this ladder band 2 drops its gate from 200 to 150,
  which makes every (proficiency, rod tier) pair resolve at or above today, and it fills the
  empty 100-to-200 stretch instead of leaving it barren.
  REJECTED: [0, 100, 100, 100, 150]. It buys the "100 and 150" phrasing literally but drops band
  2's gate from 200 to 100 and leaves nothing new at the cap, which is the wrong end to leave
  empty in an endgame phase.
  REJECTED: [0, 100, 200, 200, 200, 200]. It moves nothing at all and leaves 100 to 200 exactly
  as barren as it is today.

  DECISION C, SETTLED 2026-08-20: THE APEX ROD'S RUNG.
  RULING: the new rod's recipe sits at engineering skillReq 125, acquisition ['drop'],
  pattern-taught on the phase 11 machinery, quality EPIC, use tier 6, stationType 'toolworks'.
  recipe_tidewrought_fishing_rod is NOT moved and its recipe is not touched. RE-VERIFY the
  finding below in code at STEP 1 rather than taking it on trust, write it into state.md, and
  HAND IT TO 11j.
  WHY: the finding is not merely re-derivable, it is already WRITTEN in shipped source. The
  ROD_RECIPES header states that skillReq 150 resolves to tier 6 while engineering's cap of 125
  resolves to tier 5, so a taught recipe at 150 is permanently unlearnable through BOTH channels
  (teachTierMet in src/sim/professions/training.ts and the 'tier' deny arm in
  professions/pattern_items.ts run the same gate), and the three land tools at 150 escape only
  because they are grandfathered in the frozen PRE_TRAINING_RECIPE_IDS. The reachable top rung is
  125, which is exactly where APEX_CONSUMABLE_RECIPES already puts its two capstones.
  WHY EPIC AND NOT LEGENDARY: rod rarity feeds FISH_REEL_WINDOW_RARITY_BONUS_SEC (0.25 seconds
  per rarity ladder index) and the session-cap budget arm in tests/fishing_zones.test.ts, so a
  legendary rod is a silent throughput change. Epic also keeps the new rung inside the shipped
  apex-tool rarity line.
  REJECTED: any rung at skillReq 150. It is dead content that no test would red on, because there
  is no craft-time skill admission gate.
  DOWNSTREAM: 11j DECISION A is settled on this same finding (the apex hoe sits at engineering
  125), so the hand-off is a confirmation the two phases share rather than a question 11j is
  still holding open.

  DECISION D, SETTLED 2026-08-20: HOW FAR THE FISH REACH INTO THE APEX KITCHEN.
  RULING: the SAME fish row goes into ALL THREE role plates (recipe_stonepot_stew,
  recipe_warspice_skewers, recipe_sageleaf_chowder) AND into recipe_laden_hearth, ADDED alongside
  the shipped reagents and never substituted for one. This decision governs the FISH row ONLY:
  11h's per-plate crop rows stay exactly as 11h DECISION B leaves them. Re-derive the
  gold-negative arithmetic from the MERGED rows, after 11h's crop rows and this fish row, never
  from 11h's file.
  WHY: recipe_sageleaf_chowder is a chowder with no fish in it, which is the headline defect, but
  fixing only the chowder would leave an int-role player needing fish while an ap-role player
  does not, and that compulsion asymmetry is exactly what R18 exists to prevent. The uniform fish
  row also composes cleanly with the header 11h amended: the crop row differentiates, the fish
  row unifies, and the amended rule ("the food family's bills differ by exactly one crop row and
  are identical in every other reagent") reads true in both directions.
  REJECTED: chowder only. It fixes the smell in one row and hands the completion pass a
  half-differentiated family.

  DECISION E, SETTLED 2026-08-20: THE CHANNEL FOR THE FOUR NEW PATTERNS.
  RULING: all four (the three cooking patterns and the apex rod's schematic) ride the Heroic
  Quartermaster as deterministic Heroic Marks stock, the same channel phase 11 gave the eight
  apex consumable patterns. PRICE them in the shipped two-point marks family BY THE RUNG EACH
  TEACHES, read off HEROIC_VENDOR_STOCK at authoring: the shipped family holds exactly two
  points, 12 marks for the skill-100 patterns and 16 for the skill-125 capstones, so the rung-75
  and rung-100 cooking patterns take 12 and the rung-125 cooking pattern and the engineering-125
  schematic take 16. Confirm that mapping against the shipped rows before writing it. No new
  marks price point is minted here.
  WHY: R18 decides it. A gathering TOOL behind a luck gate is the compulsion R18 forbids, and the
  rod is the gate on band 5, so a luck-gated schematic would put the whole top band behind luck.
  REJECTED: the apex rod's schematic as a band-5 catch, so the master angler fishes up their own
  rod. Better flavor, and it loses twice: it luck-gates the top band, and docs/design/deeds.md
  puts luck-gated deeds at zero Renown, so the deed attached to it would lose its Renown too.

  DECISION F, SETTLED 2026-08-20 (qr-11i-PACE, state.md row 121; added by the quality-review
  adoption pass): THE PACING ARM.
  RULING: FISHING_GAIN_SCHEDULE's four VALUES are replaced by values DERIVED from a measured
  casts-to-200 model, the same R19 discipline 11e applies to farming's curve, with the model
  recorded in state.md so the tune is reproducible from the doc alone. The model's inputs are
  all shipped numbers: casts per active hour from the cast-cycle timing (the bite-delay
  ladder, the reel window, the recast), and the teaching-catch share per band per zone from
  the D9 cell tables (this phase's own extended cells included, so the model runs over the
  six-band ladder it ships). THE TARGET SPAN, settled: the reference angler reaches 200 in
  about 10 to 12 ACTIVE hours total, and no single band costs more than about a third of the
  total. The four band BOUNDARIES (50/100/150/200) are FROZEN, because
  fishingTeachingCeilingFor derives the water teaching ceilings from them; only the VALUES
  move, and the derivation test reproduces them from the recorded model (the 11e idiom).
  Grey-junk and zero-character-XP behavior are UNTOUCHED. The parity golden
  professions_fishing_session may move; predict its composition before observing it.
  WHY: the measured shipped tail is 0.02 per catch above 150, roughly 2500 teaching catches,
  on the order of 5000 casts and 11 hours for the last 50 points, with zero character XP; the
  review named it the program's one outright chore, and the maintainer's standard is NOTHING
  that is a chore. The bite-reel minigame is genuinely fun; the fix is the rate, never the
  loop.
  REJECTED: leaving the schedule untouched (this file's own rejection list did exactly that
  and is OVERTURNED below); moving the band boundaries (the teaching ceilings derive from
  them); adding character XP to fishing (the zero-XP design is pinned and deliberate).

- Memory scan (MEMORY.md index): new-item-content-hidden-obligations (every new item id owes
  WebP art AND non-Latin name fills in the same change), item-art-ownership-batch-xor-entries,
  the test-pin trap index (READ it before touching any pin: predicted-then-observed,
  constant-self-comparison, comment-gameable source pins, vitest -t is a regex), the i18n
  reword-staleness entry, m16-wordy-english-requires-nonlatin-fills, release-merge gate
  surprises, and observer-recorder-swallows-signature-drift (the telemetry label set below is
  exactly that shape).

STEP 1 - LOAD CONTEXT (Explore agent; do not read planning docs in the main loop):
- docs/prd/masterwrought/state.md: R8 (recipe channels), R13 (skill placement, maxSkill stays
  125), R14 (pure stats, no new proc effects anywhere in this packet), R15 and the naming
  registry including the "Rejected for collisions" row, R17 (the gear firewall, which applies
  to fish by the same logic that applies it to produce), R18 (anti-compulsion: listable,
  added-never-substituted), R20 (every gathering profession reaches the endgame), the Power
  placement block, the Phase 10 apex-consumable ledger, the Phase 11 pattern and Heroic
  Quartermaster ledger, the validation matrix, and "The professions completion program".
- docs/prd/masterwrought/progress.md (the 11i row) and decisions-index.md.
- Sim, fishing: src/sim/professions/fishing.ts in full (the draw contract in its header,
  fishingRodBandFor, effectiveFishingBand, fishingBandFor, FISHING_BAND_THRESHOLDS,
  FISHING_GAIN_SCHEDULE, fishingTeachingCeilingFor, fishingCatchGainAt, the reel-window and
  bite-delay ladder functions); professions/proficiency_bands.ts (the SHARED ladder and who
  else reads it); professions/fishing_zones.ts (FISHING_ZONE_ROD_TIERS, rodTierRequiredForZone,
  the "requiredBand is rodTier - 1" doctrine, the R37 named progression inversion);
  professions/tools.ts (canGatherTier, bestOwnedGatherToolTier, rarityLadderIndex,
  slotToolEffectRefused's fishing arm); professions/gathering.ts (queueGatheringGrant and its
  use of proficiencyBandFor for the gather-cast duration, which must NOT move).
- Content: src/sim/content/items.ts (FISHING_TABLES_BY_BAND and the D9 authoring axis comment
  above it, FISHING_TABLES, FISHING_RARE_ID, RAW_COOKING_CATCH_IDS, isRawCookingCatch, the four
  shipped rod defs and the two load-bearing comments above them: the "top two rungs buy no new
  catch band" paragraph and the rod-rarity collinearity paragraph); content/recipes.ts
  (ROD_RECIPES and its whole header, the fish cooking rows at skillReq 0 / 25 / 50,
  APEX_CONSUMABLE_RECIPES and its header's uniform-bill, gold-negative and acquisition rules,
  the three role plates, recipe_laden_hearth); content/apex_patterns.ts (the
  pattern_<output item id> contract, the per-craft display prefixes, quality epic and the
  uniform sellValue); content/heroic_vendor.ts (HEROIC_VENDOR_STOCK, the marks ladder, the
  stock-length pin); content/deeds.ts (prog_fishing_100 and prog_master_angler, the
  { kind: 'gathering', professionId, amount } trigger, the append-only tail and the three-tier
  ordering rule 11b established); content/reliquary.ts (SPECIMEN_PROFESSIONS and the
  glimmerfin_koi row, which is the precedent any new catch is judged against).
- Sim, elsewhere: src/sim/deeds.ts (ZONE_FISH and onFishCaughtForDeeds, plus the registered
  mark-namespace list); src/sim/types.ts (the four fishing SimEvent variants and their
  `band: 0 | 1 | 2` field); src/sim/combat/casting_lifecycle.ts (the two effectiveFishingBand
  call sites on the event path); src/sim/professions/crafting.ts (the header's "There is still
  NO skillReq admission gate" paragraph, which is what makes DECISION C's reasoning correct);
  professions/training.ts teachTierMet and professions/wheel.ts tierForSkill / TIER_SKILL_STEP;
  professions/pattern_items.ts (the deny order and its 'tier' arm).
- Server and UI: server/fishing_telemetry.ts (FISHING_BANDS, fishingBandLabel's 0 | 1 | 2
  signature, the "zones x bands is 3 x 3" cardinality paragraph, ROD_FEE_RECIPE_IDS derived
  from ROD_RECIPES); the four fishingBandLabel call sites in server/game.ts;
  src/ui/gather_tool_tooltip.ts (it indexes PROFICIENCY_BAND_THRESHOLDS with
  fishingRodBandFor's result, which is a live defect the moment the two ladders differ).
- Local conventions: src/sim/professions/CLAUDE.md (its FISHING_TABLES_BY_BAND paragraph),
  src/sim/CLAUDE.md, and tests/parity/CLAUDE.md.
- Tests that will move: tests/professions_fishing.test.ts (the literal [0, 100, 200] pin, the
  toHaveLength(3) pin, the band mapping cases, the B0_ROWS image), tests/fishing_zones.test.ts
  (EMPTY_HOOK_AT_OR_ABOVE, EMPTY_HOOK_SHORT, KOI_BY_BAND, the shortfall and surplus clamps, the
  `band < 3` loops, the session-cap budget arm, the rod-tier-ladder-distinguished arm),
  tests/recipe_economy.test.ts, tests/apex_pattern_items.test.ts, tests/heroic_vendor.test.ts,
  tests/deeds_content.test.ts, tests/professions_tools.test.ts, tests/shipped_item_ids.test.ts,
  tests/item_icons.test.ts and tests/missing_painted_icons_wave.test.ts (ITEM_ART_PENDING),
  tests/guide.test.ts, tests/professions_zone_rollout.test.ts, and
  tests/parity/golden/professions_fishing_session.json.
Return, verbatim where it is a number: the three shipped band cell tables; the exact current
values of EMPTY_HOOK_AT_OR_ABOVE, EMPTY_HOOK_SHORT and KOI_BY_BAND and where the surplus and
shortfall clamps live; TIER_SKILL_STEP; the shipped sellValue of every raw catch and of the
four rods; the shipped role-plate bill and the Laden Hearth bill; the Heroic Quartermaster
stock length and its marks rungs; the exact text of the rod tooltip line that names a band
threshold; and the composition of professions_fishing_session (which proficiency and which rod
tier it fishes at), because that determines whether the DECISION B ladder moves it.

STEP 2 - EXECUTE (parallel fan-out, explicitly; five agents by vertical slice):

Agent 1 (THE BAND LADDER, sim):
- Extract, do not grow. The catch-band ladder becomes its own pure leaf module,
  src/sim/professions/fishing_bands.ts, holding FISHING_CATCH_BAND_THRESHOLDS, the exported
  band type, fishingCatchBandFor(proficiency) and fishingRodBandFor(rodTier). No SimContext, no
  content-table import, no rng, explicit arguments only, so a Vitest imports it directly. This
  is the same extraction proficiency_bands.ts already is, done for the same reason, and it is
  the module-first answer to adding a ladder to a 675-line coordinator. effectiveFishingBand
  stays in fishing.ts as the thin consumer (it reads PlayerMeta and ITEMS, so it is not a leaf),
  and fishing.ts re-exports the old names so every existing importer resolves unchanged.
- Export a named band type (FishingCatchBand) and use it at every site that today writes
  `0 | 1 | 2`: the four SimEvent variants in src/sim/types.ts, effectiveFishingBand's return,
  fishingRodBandFor's return, and server/fishing_telemetry.ts's fishingBandLabel parameter.
  Widening the ladder again must be one edit, not seven.
- fishingRodBandFor keeps riding canGatherTier and the band-b-takes-tier-b-plus-1 rule. Do NOT
  invent a second gating rule for the new bands; if the shipped rule cannot express a band, that
  is a STOP.
- PROFICIENCY_BAND_THRESHOLDS is NOT edited. Prove it: an arm asserting the shared ladder is
  still literally [0, 100, 200] and that gathering.ts's gather-cast duration for a land
  profession is unchanged at the same proficiency values.
- THE REGRESSION PROOF, and it is a test, not a paragraph: an exhaustive walk over proficiency
  0 to 200 crossed with rod tier 1 to 6, comparing the band each pair resolves to against the
  band the pre-phase ladder resolved to (hard-code the old ladder in the test as the reference,
  never import the new constant and compare it to itself). Assert new >= old for every pair,
  and assert the pairs that MOVE are exactly the set the ledger predicts. That test is what
  makes DECISION B's "nobody loses access" claim true rather than asserted.
- Zero new rng draws. The draw contract in fishing.ts's header (one draw at cast start, one at a
  landed reel, none on any deny arm) is unchanged by this phase. If an agent believes it needs a
  draw, that is a STOP.
- THE PACING ARM (DECISION F): build the casts-to-200 model from the shipped timing constants
  and the extended cell tables, record it in the ledger with the resulting hours per band,
  derive the four FISHING_GAIN_SCHEDULE values against the 10-to-12-hour target span with no
  band over a third, and land a derivation test that reproduces the values from the recorded
  model (the 11e idiom: the model in the doc is the authority the literals are checked
  against). Boundaries frozen; fishingTeachingCeilingFor's derivation and the zero-XP pin
  untouched; the moved parity golden predicted before observed.

Agent 2 (THE CATCH TABLES AND THE NEW CATCHES, content):
- Grow FISHING_TABLES_BY_BAND from three entries to six. The nine shipped cells are BYTE
  IDENTICAL afterwards: same rows, same order, same weights. FISHING_TABLES keeps aliasing
  FISHING_TABLES_BY_BAND[0] and stays the SAME object, never a copy.
- Extend the D9 authoring schedule that the cells are derived from, in
  tests/fishing_zones.test.ts beside the shipped rows: EMPTY_HOOK_AT_OR_ABOVE, the per-zone junk
  schedule and KOI_BY_BAND each gain rungs, and the surplus clamp moves off 2. Derive, never
  author by feel. The constraints the derivation must satisfy, all of which the shipped cells
  already satisfy: every cell sums to exactly 100; the empty-hook null row is present with
  weight at least 1 in every cell; the empty-hook and grey-junk rows are non-increasing per band
  step; the koi row is non-decreasing per band step and reads skill alone (same weight in every
  zone); and the AGGREGATE cooking-catch weight is non-decreasing per band step. The new catch
  rows are funded first out of what the empty-hook and junk rows give up as the surplus deepens,
  and only then out of a proportional trim of the zone's shipped fish rows, which is the same
  "whatever is left, split in each zone's shipped proportion" rule the shipped cells use. Print
  the arithmetic for every new cell in the ledger.
- The new catches read SKILL alone, the glimmerfin_koi precedent: one id per new band, present in
  every zone's cell for that band at the same weight, so a recipe can name one reagent id
  regardless of which water it came out of. Three new catch ids, one each for bands 3, 4 and 5.
  Do NOT author a per-zone new fish: recipes take a flat reagent list with no alternates
  concept, so three zone-specific ids would need machinery this phase is not building.
- Every new catch id owes, all of it SETTLED 2026-08-20 so none of it is a session's call: an
  ITEMS row shaped like the shipped raw catches (kind 'junk'); a sellValue DERIVED from the
  shipped raw-catch curve with the derivation recorded beside the row; NO buyValue, so no new
  row joins the counterfactually-vendor-fed set in tests/recipe_economy.test.ts and that
  membership literal stays still; membership in RAW_COOKING_CATCH_IDS, with isRawCookingCatch
  confirmed to cover all three, so eating one is refused and the material labels and icons
  resolve; ZONE_FISH: YES, all three join, because leaving them out would make the first-cast
  deed marks silently incomplete for the only zones the new bands are authored against, which is
  the harder bug to find later; RELIQUARY: NO page, and the verdict is WRITTEN rather than
  skipped, because glimmerfin_koi carries a fishing hint in SPECIMEN_PROFESSIONS and makes the
  question a real one.
- R18 BINDS THE APEX ROD ITEM HARDEST, because the rod is what gates band 5: it stays
  market-listable, never soulbound and never noMarketList, exactly like the shipped
  tidewrought_fishing_rod def it follows (kind 'tool', quality epic, a `use.gatherTool` record
  and nothing else). A fisher who never took engineering reaches band 5 by BUYING the rod, and
  a bound apex rod would make having TAKEN engineering a precondition for a fishing band, which
  is precisely what R18 forbids. Assert it, do not assume it.
- R18 applies to fish exactly as it applies to produce: every new catch stays market-listable
  kind 'junk', never soulbound and never noMarketList, so a raider buys the fish the way they buy
  sunpetal_herb. R17's firewall applies too: fish feed CONSUMABLES. The one exception is fishing's
  own tool ladder, which is not the gear chain and which already consumes fish today
  (recipe_tidewrought_fishing_rod); say that out loud in the ledger so nobody reads the rod bill
  as a firewall breach later.

Agent 3 (THE ROD RUNG AND ITS SCHEMATIC):
- One new rod item: kind 'tool', use { type: 'gatherTool', professionId: 'fishing', tier: 6 },
  quality epic, sellValue derived from the shipped tool ladder (60 at tier 4, 150 at tier 5) with
  the derivation recorded, never vendor-sold, same shape as the four shipped rods.
- One new recipe in ROD_RECIPES: professionId 'engineering', skillReq 125, acquisition ['drop'],
  stationType 'toolworks', a bill that consumes tidewrought_fishing_rod plus the new high-band
  catches, gold-negative with the arithmetic printed. tidewrought's own def and recipe diff EMPTY.
- One pattern item on the phase 11 contract: pattern_<output item id>, kind 'recipe', quality
  epic, the engineering display prefix "Schematic:", teaching the new rod recipe. It is stocked
  on the Heroic Quartermaster per DECISION E, at the shipped marks point for the rung it teaches.
- UPDATE THE TWO LOAD-BEARING COMMENTS in items.ts, because a stale one is a finding and both are
  now false: the paragraph saying the top two rungs buy no new catch band, and the paragraph
  saying rod rarity is perfectly collinear with rod tier (a tier-6 epic breaks the collinearity,
  which is fine and is exactly why the ruling was expressed as rarity in the first place).
  REWRITE ROD_RECIPES' header so it covers THREE rungs rather than two, with DECISION C's
  unlearnable-at-150 finding written into it in its own words.
- Re-derive the session-cap budget arm in tests/fishing_zones.test.ts against the new rung: the
  worst legal session over every shipped rod tier must still reel inside FISHING_SESSION_CAP_SEC,
  and the test must RE-DERIVE it rather than restate the old number.
- server/fishing_telemetry.ts's ROD_FEE_RECIPE_IDS derives from ROD_RECIPES, so a third rod recipe
  extends the label set by construction. Confirm the exporter pre-seeds it, and confirm the fee
  arithmetic for a drop-taught recipe (trainingFeeFor over a recipe nobody trains) is sane rather
  than merely defined.

Agent 4 (THE APEX KITCHEN AND THE DROP LADDER):
- Per DECISION D: add the fish reagent row to recipe_stonepot_stew, recipe_warspice_skewers,
  recipe_sageleaf_chowder and recipe_laden_hearth. ADDED, never substituted, so no shipped
  reagent leaves any bill (R18's addition rule, and it is also what keeps 11g's and 11h's produce
  rows intact). The three plates carry the SAME fish row as each other; they are no longer
  byte-identical overall, because 11h already gave each one its own distinct crop, and that is
  the state to leave them in. Every edited row is re-checked gold-negative with the arithmetic
  printed from the merged row, and the reagents still carry no buyValue.
- Three new cooking rows at skillReq 75, 100 and 125, acquisition ['drop'], stationType
  'kitchens', each with its result food item and its "Recipe:" pattern on the
  pattern_<output item id> contract. These are what put fishing into the 75-and-above band on its
  own account rather than through a rod, which is the R20 property the completion pass will pin.
- The 125 row IS the capstone (deliverable 5). Its keystone reagent is the band-5 catch, which
  requires proficiency 200 AND the tier-6 rod, so the master angler is the sole faucet. That is
  the ROLE: not a new stat, not a new aura, not a proc. Its output serves the SHIPPED apex role
  food buff and nothing else, in the batch size the ledger derives.
- POWER IS NOT THIS PHASE'S TO MOVE. The well-fed ladder and the aura id are settled at one aura
  id (well_fed) with the apex role plates at 6 for 900 seconds, and the endgame kit is flask 15
  plus food 6 equals 21 stamina. No new aura id, no new magnitude, no new duration anywhere in
  this phase. If an agent believes a magnitude is wrong, that is a STOP, not an edit. R14 forbids
  a new proc effect anywhere in this packet, and this phase authors none.
- Channel per DECISION E: four Heroic Quartermaster rows, priced in the shipped two-point marks
  family by the rung each pattern teaches (12 for the rung-75 and rung-100 patterns, 16 for the
  two rung-125 ones), read off HEROIC_VENDOR_STOCK rather than pasted from this file. That moves
  HEROIC_VENDOR_STOCK's length pin and PATTERN_PRICES; re-derive both, predicted then observed.
- Recompute tests/recipe_economy.test.ts's sorted literal pins FROM THE TREE. Never hand-merge
  them: both packets edit that file and the pins are sorted literals. Keep the non-vacuity floor
  intact, and assert directly that no new catch appears in recipe_quickening_catalyst or in any
  gear intermediate (R17's firewall, stated as a test).

Agent 5 (RECOGNITION, WIRE, TOOLTIPS, AND THE PINS):
- DEEDS, SETTLED 2026-08-20: do NOT add fishing rungs at 50 and 150. The shipped per-profession
  ladder is measured and complete (a first-gather rung at renown 5, a 100 rung at renown 10, a
  cross-profession master at 25, and a CAP rung at 25 with a title where the cap exceeds 100,
  which is prog_master_angler at fishing 200), and its spacing is 5 / 10 / 25 with no 50 or 150
  rung anywhere in the game. Adding them to fishing alone would make fishing the only five-rung
  gathering ladder there is, which is the asymmetry R20's coverage test exists to stop from
  recurring quietly.
- Mint EXACTLY ONE new deed instead: the apex rod CRAFT, on the shipped craft trigger, renown 10
  (the shipped per-profession 100-rung point, because the craft is deterministic and
  skill-gated), and NO title, because prog_master_angler already owns fishing's title. Deeds are
  cosmetic and never power (docs/design/deeds.md).
- If this phase also wants a first-catch deed for a band-5 fish, it is LUCK-GATED and therefore
  ZERO Renown and purely cosmetic. That is the only shape it may take.
- One row rather than three also keeps DEED_ORDER, the summed renown, DEED_IMAGE_IDS, the
  deed_i18n manifest, DEED_ART_PENDING and FROZEN_CATALOG_SHA256 moving by ONE. Append under the
  three-tier ordering rule (release rows first, masterwrought's committed rows next with
  positions frozen, farming's block last and contiguous), and re-derive the deed count, the
  Renown total, DEED_IMAGE_IDS and the deed_i18n manifest by PREDICTION then observation from the
  tip's totals plus this phase's delta. Do not paste a total from any earlier ledger: 11e through
  11h move it first. A title-bearing deed may never trail its art; this untitled one rides
  DEED_ART_PENDING.
- STOREFRONT ACHIEVEMENTS: settled packet-wide and NOT this phase's call. Every deed this packet
  adds, this one included, is CUT from ACHIEVEMENT_MAP in server/steam/ and server/epic/; Phase
  16 writes the single packet-level record, the pins in tests/epic_achievement_map.test.ts do not
  move, and privacy-security-review is not triggered by it.
- This deed rides the shipped craft trigger, so it registers NO mark namespace and
  migration-safety is not triggered. If a slice believes it needs a craft or catch MARK instead,
  register its namespace in src/sim/deeds.ts and pin the save/load round trip in the same change
  (an unregistered namespace serializes fine and is DROPPED ON LOAD, and this codebase has been
  bitten by that twice), and migration-safety becomes a required reviewer.
- Wire and telemetry. The four fishing SimEvent variants carry `band: 0 | 1 | 2`; widen them to
  the exported band type. server/fishing_telemetry.ts's FISHING_BANDS is a hand-written label set
  whose comment says a fourth band "is a design change that should redden this pin rather than
  silently widen every fishing series", and its cardinality paragraph says "zones x bands is
  3 x 3". Both are now wrong: update the label set, the signature, and BOTH comments, and state
  the new bounded cardinality (zones times bands, plus the rod-fee family) in the ledger. The
  membership guard that drops an off-list value stays exactly as it is.
- Tooltips. src/ui/gather_tool_tooltip.ts indexes PROFICIENCY_BAND_THRESHOLDS with
  fishingRodBandFor's result. The moment the two ladders differ that line is wrong, and at band 5
  it indexes off the end of the shared array. Re-point it at the fishing ladder. The rod tooltip
  must state what the new rung actually unlocks, per docs/design/tooltip-writing.md and the
  write-game-tooltips skill; if the English changes, that is a REWORD and every locale fill for
  the key goes stale, so record the row on the release-tier fill worklist (the reword-staleness
  trap: a filled row whose English changed still reads as filled).
- Update src/sim/professions/CLAUDE.md's FISHING_TABLES_BY_BAND paragraph in the same change.

INVARIANTS IN PLAY: the nine shipped cells byte identical and FISHING_TABLES still the SAME
object as band 0; PROFICIENCY_BAND_THRESHOLDS untouched and the land gather-cast duration
unchanged; the shipped band gate (band b takes rod tier b + 1) reused, never replaced; zero new
rng draws and the fishing draw contract unchanged; R8 (apex rungs reach players through the
pillars, not the trainer); R13 (maxSkill stays 125, and a rung above it is unlearnable by
construction); R14 (no new proc effects, no new aura id, no new magnitude); R15 (every new proper
noun web-verified at authoring and recorded in the naming registry before it is typed); R17 (fish
feed consumables; fishing's own tool ladder is the recorded exception, and nothing new enters the
gear chain, the Perfecting materials, or recipe_quickening_catalyst); R18 (every new catch stays
market-listable kind 'junk'; rows are ADDED to bills, never substituted); R20 (fishing must end
this phase present at skillReq 100 and above and in every 25-point band below, on its own account
and not through a rod); ids append-only (tests/shipped_item_ids.test.ts); i18n English-only
catalog rows in the matching domain with M16 non-Latin fills for wordy new names, and any
sim-emitted player text getting its matcher rule in the SAME change (S3); no generated file
hand-edited; the three-tier ordering rule applied to every append-only table touched, including
src/ui/i18n.catalog/items.ts.

NAMING (R15, and it happens BEFORE any id is typed): the phase DERIVES the names, and no name is
typed before its verdict exists in naming-audit.md, because the verdicts need web verification
that does not exist yet. Under the one-deed ruling the naming load is about NINE verdicts rather
than eleven: three catches, one rod, one schematic, three foods, three patterns and one deed, of
which the three patterns and the schematic are a shipped display name behind a registered
per-craft prefix ("Recipe:", "Schematic:") and coin nothing at all. That leaves about five real
coinages plus one untitled deed name. Every proper noun is web-verified against the major game
wikis at authoring time, recorded in state.md's naming registry with its verdict, and the full
evidence goes in naming-audit.md. Consult the registry's "Rejected for collisions" row FIRST.
Fish, rod and dish names are the highest-collision class in the packet (real world fish names are
shared vocabulary, and "Master Angler" is already taken by our own shipped deed), so the audit
gets the ADVERSARIAL second pass phases 08 and 09 used. Do NOT carry a working label into an id,
and take the next candidate on anything that does not come back CLEAR or GENERIC.

CONTENT OBLIGATIONS, enumerated because these are the ones that get missed: roughly eleven new
item ids (three catches, one rod, one schematic, three foods, three recipe patterns), each owing
committed WebP art or a row on the merged ITEM_ART_PENDING allowlist with exactly one
mapping.json owner (the batch-XOR rule: the batch form or the entries form, never both). ART
PARKS, and that is settled at packet level 2026-08-20: this packet ships no committed WebP art,
because committed art needs the maintainer's master SHA and a phase session cannot produce one,
so every new id here parks and the merged pending count grows by this phase's delta, re-derived
from the previous phase's observed value. Plus: M16 non-Latin name fills for every wordy English
name in THIS change; wiki regen via npm run wiki:content with tests/guide.test.ts freshness
green; the ONE Book of Deeds record above, with its totals re-derived and no ACHIEVEMENT_MAP row;
the recorded Reliquary verdict (no page) and ZONE_FISH verdict (all three join) for the new
catches; nothing new in src/ui/world_entity_i18n.ts (this phase places no named world entity);
and the economy recheck through tests/recipe_economy.test.ts with its sorted literals recomputed
from the tree.

REJECTION LIST, recorded so none of these is re-proposed, each with its reason:
- Re-tiering any zone's water to rod tier 4 or 5 to carry the new bands. The zone tier is pinned
  as the max GATHER_NODES tier in that zone ("content and gate cannot drift apart"), and a second
  arm pins every zone tier at or below FISHING_GAIN_SCHEDULE.length - 1 or the teaching ceiling
  clamps silently. Re-tiering water means re-tiering ground, which moves mining, logging and
  herbalism node tiers and the fine-material column with them. The new bands do not need it: the
  effective band is min(proficiency band, rod band) and never consults the zone.
- Editing FISHING_GAIN_SCHEDULE. OVERTURNED 2026-08-20 (qr-11i-PACE, state.md row 121; kept
  in place per the never-delete rule): this entry was right to protect the teaching-ceiling
  derivation and wrong to leave the rate, and DECISION F above is the amended instruction:
  the band BOUNDARIES stay frozen (the ceiling derivation is untouched, which is what this
  entry was protecting) and the four VALUES are re-derived from the measured model. The
  original reasoning stands for the boundaries only.
- Raising fishing's maxSkill above 200, or engineering's above 125. R13 fixes the craft cap, and
  fishing at 200 is already twice every other gathering profession. The problem is that 200 pays
  nothing, not that 200 is too low.
- Putting any recipe at skillReq 150. Unlearnable by construction through both channels
  (DECISION C). Anything authored at 150 is dead content that tests will not catch, because there
  is no craft-time skill admission gate to red on it.
- Moving recipe_tidewrought_fishing_rod's skillReq. Up is unlearnable; down or sideways re-gates a
  shipped recipe live players already hold, for no design win.
- A new fish per zone. Recipes take a flat reagent list with no alternates concept, so per-zone
  ids would need machinery this phase is not building and would make every apex bill water-locked.
- Editing any shipped band-0, band-1 or band-2 cell. That is the one edit the QA twin exists to
  catch, and every design goal here is reachable without it.
- A new well-fed magnitude, duration, or aura id for the new dishes. Settled elsewhere; a
  disagreement is a STOP.
- Making any new catch soulbound, unlistable, or bound to a quest. R18, flatly.
- Fishing deed rungs at 50 and 150. No shipped gathering profession has them and the ladder's
  spacing is 5 / 10 / 25, so adding them to fishing alone would make it the only five-rung
  gathering ladder in the game.
- A legendary apex rod. Rod rarity feeds FISH_REEL_WINDOW_RARITY_BONUS_SEC and the session-cap
  budget arm, so a legendary rung is a silent throughput change. Epic is the ruling.
- Editing the SHARED PROFICIENCY_BAND_THRESHOLDS to carry fishing's new bands. It is read by
  proficiency_display_heal.ts and by the land gather-cast duration, so moving it retunes land
  gathering silently (DECISION B).

Out of scope: farming's produce rows in the same bills (11g and 11h own them; this phase ADDS a
fish row to a bill they have already added a produce row to, and touches nothing of theirs);
differentiating the three role plates (11h owns it and has already landed it by the time this
phase runs, so read the three DISTINCT crop rows as they stand and do not re-derive them;
DECISION D governs only how far this phase's FISH row reaches across the same three bills); the
R20 guard TEST itself (the completion pass lands it; this phase's job is to leave fishing already
satisfying it); the apex tool family's farming hole (11j, whose DECISION A already shares
DECISION C's unlearnable-at-150 finding); the Perfecting stage (Phase 12); UI beauty work on any
professions surface (Phase 14); the R5 envelope measurement (Phase 15); the merged icon and wiki
enumeration sweep (Phase 16), though every row this phase creates lands there.

STEP 3 - VALIDATION + REVIEW (matrix in state.md):
npx tsc --noEmit; then npx vitest run tests/professions_fishing.test.ts tests/fishing_zones.test.ts
tests/recipe_economy.test.ts tests/apex_pattern_items.test.ts tests/heroic_vendor.test.ts
tests/deeds_content.test.ts tests/professions_tools.test.ts tests/professions_zone_rollout.test.ts
tests/shipped_item_ids.test.ts tests/item_icons.test.ts tests/guide.test.ts
tests/architecture.test.ts tests/localization_fixes.test.ts plus every new suite; the wire set:
npx vitest run tests/snapshots.test.ts tests/env_protocol.test.ts tests/bandwidth.test.ts; the
parity suite, because professions_fishing_session is a golden this phase can legitimately move
(PREDICT its new composition in the ledger BEFORE running it, then observe). THEN the FULL suite
(npx vitest run --maxWorkers=5) before calling any review round done: a content phase this wide is
exactly the shape where a census red hides outside a curated battery. npm run ci:changed on the
touched files only. Read the gate LOG, not just its exit code: a printed FAIL marker overrides a
zero exit.
Review Dispatch Matrix (implementation-plan.md): content-obligations-reviewer (the whole content
diff: art parking and its single mapping owner, M16, wiki regen, the one deed and its written
storefront CUT, Reliquary and ZONE_FISH verdicts, ids append-only); architecture-reviewer (the
extracted fishing_bands leaf, the draw contract, the band type widening in sim);
cross-platform-sync (the SimEvent band union is a sim behavior and wire shape change, and the
server label function moves with it); privacy-security-review (server/fishing_telemetry.ts and the
server/game.ts call sites, plus the metric cardinality change); frontend-seam-reviewer
(src/ui/gather_tool_tooltip.ts and the catalog reword); migration-safety is NOT triggered by the
ruled deed, which rides the shipped craft trigger, and becomes required only if a mark namespace
is registered after all; database-performance-reviewer only if a SQL call site or stored-data
growth appears (the metrics cardinality growth is not one, and is covered by an acceptance item
instead); qa-checklist when the deliverable set is complete. COVERAGE prompts; apply ALL findings,
blocking and should-fix and nits.

STEP 4 - COMMIT CADENCE (explicit paths, bodies, no session trailers):
- refactor(sim): extract the fishing catch-band ladder into its own leaf
- feat(sim): three high catch bands on the shipped rod gate
- feat(content): the high-band catches and their extended cell schedule
- feat(content): the apex fishing rod, its schematic, and the rod-ladder comments
- feat(content): fish in the apex kitchen and three drop-taught fish rows
- feat(content): a Book of Deeds record for the apex rod craft
- feat(net): widen the fishing band type across the event and telemetry surface
- test(content): re-derive the band, cell, economy, vendor, deed and pin sets

STEP 5 - ACCEPTANCE:
- [ ] The nine shipped cells are BYTE IDENTICAL, FISHING_TABLES is still the SAME object as
      FISHING_TABLES_BY_BAND[0], and no shipped catch weight moved anywhere
- [ ] FISHING_TABLES_BY_BAND holds six entries and every new band is reachable through the
      shipped gate (band b takes rod tier b + 1) and REFUSES below it, proven by test at each
      rung, not by reading
- [ ] FISHING_CATCH_BAND_THRESHOLDS is [0, 100, 150, 200, 200, 200] and lives in its own leaf
      (src/sim/professions/fishing_bands.ts); the fishing pin moved onto the leaf and the shared
      ladder keeps its own arm
- [ ] The exhaustive proficiency-by-rod-tier walk shows no pair resolving lower than today, and
      the pairs that MOVE are exactly the predicted set
- [ ] PROFICIENCY_BAND_THRESHOLDS still literally [0, 100, 200]; the land gather-cast duration
      unchanged at the same proficiency values
- [ ] The apex rod recipe is engineering 125, ['drop'], 'toolworks', quality epic, use tier 6;
      recipe_tidewrought_fishing_rod's def and recipe diff EMPTY
- [ ] Every new catch has at least one consumer, and every consumer is reachable (learnable and
      craftable) by a player at the shipped caps
- [ ] All three new catches: sellValue derived from the shipped raw-catch curve with the
      derivation recorded, NO buyValue, present in RAW_COOKING_CATCH_IDS and in ZONE_FISH, with
      the Reliquary verdict written
- [ ] recipe_sageleaf_chowder contains fish, and so do the other two role plates and
      recipe_laden_hearth, at the SAME count on all three plates; 11h's per-plate crop rows are
      untouched; every edited row re-checked gold-negative with the arithmetic printed from the
      merged row
- [ ] All four new patterns are Heroic Quartermaster marks stock, priced in the shipped two-point
      family by the rung each teaches, with no new price point minted
- [ ] Fishing appears in bills at skillReq 100 and above on its own account, not only through a
      rod, and in every 25-point band below (the R20 property, stated with the row ids)
- [ ] No new recipe anywhere in the diff carries skillReq 150; DECISION C's finding is written
      into state.md and handed to 11j
- [ ] No new rng draw; the fishing draw contract unchanged; professions_fishing_session predicted
      before it was observed, with the prediction recorded
- [ ] DECISION F executed: FISHING_GAIN_SCHEDULE's values re-derived from the recorded
      casts-to-200 model against the 10-to-12-active-hour span with no band over a third,
      the band boundaries literally unchanged, the derivation test green, and the model
      recorded in state.md so the tune reproduces from the doc alone
- [ ] The band type is ONE exported type used at every site; the telemetry label set, its
      signature, and BOTH of its stale comments updated, with the new bounded cardinality stated
- [ ] The rod tooltip reads the fishing ladder, states what the new rung unlocks, and any reword
      is on the release-tier fill worklist
- [ ] No new aura id, no new well-fed magnitude or duration, no new proc effect
- [ ] The apex rod ITEM is market-listable, not soulbound and not noMarketList, asserted by
      test, so band 5 never requires having TAKEN engineering (R18)
- [ ] Every new catch is market-listable kind 'junk'; no new id is soulbound or noMarketList; no
      new id appears in recipe_quickening_catalyst or any gear intermediate, asserted by test
- [ ] Every new item id has a merged-allowlist row with exactly one mapping owner (art PARKS);
      M16 fills for wordy names; wiki regen fresh
- [ ] EXACTLY ONE new deed (the apex rod craft, renown 10, no title), no rung at fishing 50 or
      150, no ACHIEVEMENT_MAP row; deed totals, DEED_IMAGE_IDS and the deed_i18n manifest
      re-derived by prediction then observation from the tip
- [ ] Every new proper noun web-verified, registered, and evidenced in naming-audit.md
- [ ] Full suite green; ci:changed clean; gate log read, not just its exit code

STEP 6 - DOCS: progress.md Phase 11i row; state.md ledger (the SIX settled decisions as
EXECUTED, DECISION F's casts-to-200 model and derived values included, and the state.md
band-shape row closed and corrected to three bands; the final
threshold ladder with the regression walk's moved-pair set; every new cell with its arithmetic;
every new id with its sellValue derivation; DECISION C's unlearnable-at-150 finding and its
handoff to 11j; the naming verdicts; the one deed with its Renown derivation and the written
storefront CUT; the new telemetry cardinality; the predicted-then-observed pin table including
professions_fishing_session; the rejection list as recorded design); decisions-index.md rows for
the six decisions as executed; memory note for anything that surprised you, and the
unlearnable-at-150 finding is a strong candidate for one.

STEP 7 - REPORT: phase status, files, validation results, reviewer verdicts, the re-derived pin
table (predicted versus observed per pin), the R20 statement for fishing with its row ids, and the
handoff line for Phase 11i QA.

STOPPING RULES: stop and ask if the merged tree contradicts a settled decision, because that is a
finding and not a licence to re-decide; if a new band cannot be expressed through the shipped
band-b-takes-tier-b-plus-1 gate; if the extended cell schedule cannot satisfy every listed
constraint at once without editing a shipped cell; if any deliverable here appears to need an rng
draw, a new aura id, or a well-fed magnitude change; if the apex rod cannot be made learnable at
any reachable rung (which would mean DECISION C's finding is wrong and the whole apex tool family
needs re-judging before 11j runs); if the session-cap budget cannot be re-derived to clear
FISHING_SESSION_CAP_SEC with the new rung; if 11h's per-plate crop rows are not in the merged
bills, because 11h has not landed and the fish row is priced against them; or if the release
merge conflicts inside src/sim/content/recipes.ts, src/sim/content/items.ts,
src/sim/professions/fishing.ts, or tests/recipe_economy.test.ts.
```
