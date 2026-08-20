# Phase 11e: A true skill, farming's mastery curve and crop roster

### Starter Prompt
```
This is Phase 11e of the Masterwrought feature: the phase that turns farming from a
provisional curve over a short crop shelf into a skill with real content at every rung.
First of the seven gathering-half phases (11e to 11k), and the first phase to APPEND to the
tables 11d just re-derived.

Model: xhigh effort. Harness: Claude Code. Worktree: ~/Documents/wocc-masterwrought
(branch feature/masterwrought). ULTRACODE: not needed for this phase.

Goal, five deliverables:
(1) THE GAIN CURVE. FARMING_GAIN_SCHEDULE (1 / 0.5 / 0.1 / 0.02 by band, marked in source
    as "TUNING, PROVISIONAL, FLAGGED FOR THE MAINTAINER") is replaced by a curve DERIVED
    from a measured calendar-days-to-100 model built out of real bed counts, real cycle
    times, and the real teaching ceilings, per R19, tuned to the SETTLED calendar target of
    about 10 weeks (STEP 0, DECISION A). The METHOD is the deliverable and it is recorded in
    state.md so the tune is reproducible from the doc.
(2) THE ANTI-CHORE PROOF. A slower curve changes PACING and never OBLIGATION, and that is
    pinned rather than asserted.
(3) THE CROP ROSTER. Two crops per tier becomes 2 / 2 / 4 / 4: two new tier-3 and two new
    tier-4 crops, so the two bands where a leveled farmer actually lives have real variety.
    Twelve new item ids, each with a faucet and a consumer. Exactly one of the two new tier-3
    crops is a LEAF and no tier repeats a plant class (DECISION B); 11h GATE B reads that
    composition, so it is a deliverable and not flavor.
(4) THE TOOL-EFFECT RECONCILIATION. The Maker's Charm already slots into a hoe and is never
    advertised as such, and its quantity bonus of 2 exactly equals FARM_TONIC_BONUS_PICKS
    and stacks with it. Both are settled here, deliberately, with pins.
(5) GATE 1, THE SEED FAUCET, SETTLED AS CLOSED-BY-11e. The four shipped tier 3 and tier 4
    seeds are vendor-stocked, so three trainer-visible recipes stop being uncompletable and
    two parked deeds become earnable; the four new seeds from deliverable 3 ride the same rows
    and the same convention, EIGHT rows in one edit at the prices DECISION D fixes. Every
    downstream phase (11f STEP 0, 11g DECISION B, 11h, 11k) proves the faucet by reading the
    merged vendorItems arrays IN CODE, never a ledger row.

WHY GATE 1 SITS HERE, so nobody re-sequences it: farming's own state.md gates the D11/(bo)
tier 3 and 4 seed bootstrap as something that MUST be covered before that branch ever merges
to a release, and this packet IS that release merge. It is also this phase's own dependency:
deliverable 3's four new upper-tier crops need a first seed, and the vendor row that gives
them one is the same content edit at the same two farmers. Splitting them would author the
same convention twice.

WORKTREE GUARD (do this FIRST; the user runs multiple concurrent sessions): run pwd.
If you are not in /Users/fernando/Documents/wocc-masterwrought, switch this session into
it NOW with the EnterWorktree tool (path: /Users/fernando/Documents/wocc-masterwrought).
If EnterWorktree is unavailable or refuses, STOP and ask the user to relaunch Claude Code
from that directory. Phase work never runs from the main checkout at
~/Documents/world-of-claudecraft.

STEP 0 - PRE-FLIGHT (canonical Team Workflow, docs/prd/masterwrought/implementation-plan.md):
- git status clean, with Phase 11d QA CLOSED: the merged tree tsc-clean, every 11d pin
  PREDICTED then observed, and the export and symbol census GREEN. If that census has not
  run, STOP. This phase appends to tables 11d just re-derived, and a dropped merge hunk
  found after 11e is indistinguishable from an 11e authoring bug.
- SYNC RELEASE: git fetch origin --prune, discover the newest release branch by version sort
  (git branch -r | grep 'origin/release/' | sort -V | tail -1), merge it, run the
  release-merge-audit skill. A minor-version-or-more jump runs as its own phase first.
- Memory scan (MEMORY.md index): new-item-content-hidden-obligations (every new item id owes
  art AND M16 fills in the SAME change), item-art-ownership-batch-xor-entries, the test-pin
  trap index (READ before touching any pin: predicted-then-observed, constant-self-
  comparison, comment-gameable source pins, vitest -t is a regex), the i18n reword-staleness
  entry, release-merge gate surprises, and the gate-env DATABASE_URL entry (never source the
  whole .env around a parity re-record).

- SETTLED DECISIONS (2026-08-20, the full delegation). The six decisions that used to gate
  this phase at STEP 0 are ANSWERED. The binding record is the "Decisions closed 2026-08-20
  (the full delegation)" section of docs/prd/masterwrought/state.md, which 11b STEP 6 migrates
  into farming/state.md's handoff table. READ that record at STEP 0, then EXECUTE the rulings
  below. Nothing here is confirmed with the maintainer and no session re-decides any of it; if
  the record and this file ever disagree, the record wins and the mismatch is a STOP.

  - DECISION A, THE CALENDAR TARGET. SETTLED 2026-08-20. The model's one free parameter is
    fixed at about 10 weeks, 70 to 75 days, for the REFERENCE FARMER defined in STEP 2 Agent
    1, with a floor of about 5 weeks at maximum dedication (all 23 beds, two visits, about 44
    successful harvests a day). DERIVE the four gain values from the measured model and record
    them; never paste a gain literal out of a doc. FREEZE the four belowProficiency boundaries
    at 25 / 50 / 75 / 100: they do not move.
    ACCEPTANCE: a derivation test reproduces FARMING_GAIN_SCHEDULE from the model inputs; the
    recorded model prints harvests-per-band and days-to-100 for BOTH farmers; and a derived
    span materially under a month re-opens this gate instead of shipping. The output shape to
    re-derive against is 0.25 / 0.125 / 0.0625 / 0.03125 (100 / 200 / 400 / 800 harvests per
    band, about 74 days).
    WHY: R19 forbids tuning from feel and requires the measured calendar model, so fixing the
    span is what makes the schedule stop being provisional. The boundary freeze is
    load-bearing: farmingTeachingCeilingFor reads belowProficiency, so a moved boundary
    silently moves which crop tier grays out at which skill.
    REJECTED, do not re-propose: a span materially under a month. Skill 100 stops being a
    long-haul achievement, and the shipped curve's defect is its FRONT (about 6 days for the
    first fifty points), not its total.

  - DECISION B, ROSTER SCALE. SETTLED 2026-08-20. +4 crops (two tier-3, two tier-4), 12 new
    item ids, ITEM_ART_PENDING 44 to 56. The roster COMPOSITION is ruled too, because
    downstream bills read it: exactly ONE of the two new tier-3 crops is a LEAF, and no tier
    repeats a plant class. On the shipped roster that gives tier 3 = grain, gourd, leaf, plus
    one root or legume; tier 4 = melon, leaf, plus one root or tuber and one fruit or gourd.
    WHY: +2 would leave the upper tiers at two crops each, the shape that forced 11h GATE B
    into a cross-tier halving. Minting a tier-3 leaf makes 11h's cost-equal branch available,
    so the three apex role plates differentiate at no cost, and distinct plant classes per
    tier keep twelve crops legible as a roster rather than a list.
    REJECTED, do not re-propose: +2 crops (6 ids, pending 44 to 50), because it costs 11h the
    cost-equal branch. Anything beyond +4 stays rejected: art, M16, wiki, and icon obligations
    scale linearly with ids and this is not the art phase.

  - DECISION C, THE CHARM VERSUS TONIC OVERLAP. SETTLED 2026-08-20. Step farming's charm
    contribution to +1, in farming's OWN quantity-to-bonusPicks mapping (a farming-owned
    constant beside FARM_TONIC_BONUS_PICKS), NEVER in TOOL_EFFECTS.makers_charm.bonus. Move
    the "+2 yield per harvest while charged" tooltip line in the SAME change so it stops being
    false on a hoe, and add a test arm proving the cap BITES. Record the consequence honestly:
    on a hoe the Maker's Charm and the Gatherer's Cache now pay the same bonus (the cache's
    catalog bonus is already 1), while the charm keeps its full +2 on mining, logging, and
    herbalism.
    WHY: this is a SUPPLY control under R21 and not a power nerf. makers_charm's +2 exactly
    equals FARM_TONIC_BONUS_PICKS and stacks with it for +4 picks on a base of 3 lives, which
    more than doubles yield per harvest against a fixed demand. Capping in farming's mapping,
    never in the catalog, is what keeps mining, logging, and herbalism untouched.
    NO INTERACTION WITH DECISION A: the cap changes UNITS per harvest, never harvests per day,
    so the calendar model is unaffected and is not re-run for it.
    REJECTED, do not re-propose: accepting +4 picks as a deliberate ceiling with a ledger
    ruling and a pin. It leaves the alchemy growth tonic with no reason to exist and doubles
    produce supply against the market R21 exists to sustain.

  - DECISION D, SEED PRICING. SETTLED 2026-08-20. Tier 3 seeds buyValue 32, tier 4 seeds
    buyValue 64: the shipped four-times-sell convention (sellValue 4 and 8) plus a two-times
    bootstrap premium. Apply it to all EIGHT tier 3 and 4 seed rows (the four shipped plus
    DECISION B's four) across zone3.ts and evergarden.ts, and update NEVER_STOCKED and the
    per-farmer walk pins in the same change. Read every sellValue off the MERGED items table
    and print the arithmetic at the row; never carry a number from this prompt into code
    unread.
    WHY: both inputs are measured (the shipped sellValues, and profession_items.ts's
    documented "sellValue is the floor(buyValue / 4) staple ratio"), and the premium's reason
    is measured too: the vendor is the BOOTSTRAP and not the steady-state supply, because a
    tier-3 harvest expects 0.48 seeds back and a tier-4 harvest 0.41, so an at-convention
    price would make the counter the cheaper permanent source and kill the seed loop.
    REJECTED, do not re-propose: the bare four-times convention with no premium (16 and 32),
    for exactly that reason.

  - DECISION E, THE DEED. SETTLED 2026-08-20. ONE cosmetic deed for growing the whole roster:
    category 'collection', renown 5, NO title, no border, riding the shipped visit-mark family
    farming already uses for its four zone chronicles, with a per-crop mark namespace.
    DEED_ORDER's tail pin moves off 'prog_farming_100' here. THE TRAP APPLIES AND IS
    MANDATORY: register the namespace in VISITED_MARK_NAMESPACES in src/sim/deeds.ts and pin
    the save/load round trip, because an unregistered namespace serializes fine and is DROPPED
    ON LOAD, so the deed could never refill. migration-safety is a REQUIRED reviewer.
    WHY: a single crop is not conquerable content, but a ROSTER is a collection, and
    'collection' is the shipped category for exactly that; renown 5 is the shipped first-rung
    point on the gathering ladder (prog_first_harvest, prog_first_mine and their siblings all
    sit at 5). It is the one thing that makes +4 crops legible as a set rather than a longer
    list, and deeds are cosmetic-only (docs/design/deeds.md), so it carries no power.
    REJECTED, do not re-propose: no new deed this phase. It would leave the tail pin on
    'prog_farming_100' and push the append to 11f for no design gain.

  - DECISION F, THE RULING-NUMBER COLLISION. SETTLED 2026-08-20. The packet doc numbers stand
    and are never renumbered, and every R-number this phase writes into src/, server/, tests/,
    or a CLAUDE.md reads "masterwrought R<n>" IN FULL. A bare R-number in source means the
    Professions 2.0 series, permanently, and a bare packet R-number in source is a reviewer
    FINDING, not a nit. decisions-index.md's owed namespace row for the professions-tuning R
    series belongs to 11d, in its derived-artifacts commit (11d is the doc-truing phase and it
    runs before every phase that would cite an R-number in source): this phase does NOT edit
    decisions-index.md, and a missing row when 11e opens is a report line handed back to 11d,
    never an edit here.
    WHY: the collision is measured. Shipped source cites the other R series at R1, R4, R8, R9,
    R14, R19, R22, R30, R35, R37, and R39 to R50; shipped R19 is the fishing teaching-ceiling
    ruling (cited from src/sim/professions/fishing.ts, src/sim/professions/CLAUDE.md,
    docs/design/professions.md, and a farming test title) and shipped R22 is the wield gate.
    This phase writes "masterwrought R19" into farming's gain-schedule comment one screen from
    a test that means the other one.

STEP 1 - LOAD CONTEXT (Explore agent; do not read planning docs in the main loop):
- docs/prd/masterwrought/state.md: the "Decisions closed 2026-08-20 (the full delegation)"
  section FIRST, because it is the binding record for this phase's six decisions and for
  GATE 1; then R15 and the naming registry (including its rejected-for-collisions row), R17 to
  R23 as recorded with the ruling-number collision standing rule, the validation matrix, and
  the Phase 11d ledger with the re-derived pin table.
- docs/prd/masterwrought/farming/state.md: D5 (the locked duration bands), D6 (the survival
  ramp), D7 (the harvest-lives model and one-knob-one-job), D8 (front-loaded only, no
  mid-growth interaction), D9 (the watch fee paid in kind), D10 (the hoe ladder), D11 (crops,
  the dead-row trap, the same-phase-consumer rule), D13 (deeds), D17 (IP-safe naming), D21
  (work orders), D24 (the displacement guardrail); the MAINTAINER GATES block and GATE 1,
  which is now recorded closed-by-11e (11b STEP 6 migrates the delegation record into this
  file's handoff table, so read it here if 11b has already run);
  deviations (bo), (bs), (ca); the OPEN items list, which is this packet's one open-item
  collection point.
- docs/prd/masterwrought/farming/qa-checklist.md, the five-row anti-chore audit, verbatim.
  It is the contract deliverable 2 pins.
- Sim: src/sim/professions/farming.ts (FARMING_GAIN_SCHEDULE, farmingHarvestGain,
  farmingTeachingCeilingFor, farmingHarvestGainAt, FARM_HARVEST_LIFE_FLOOR /
  FARM_HARVEST_PICK_CAP / FARM_KEEP_CHANCE_*, FARM_FINE_CHANCE_*, FARM_TONIC_BONUS_PICKS,
  FARM_SEED_BACK_*, the plantCrop gate order and its TWO-draw block, harvestCrop's draw block
  and its slotted-effect arm where quantity maps to bonusPicks, and the withered arm that
  grants NO proficiency); src/sim/professions/farm_projection.ts (farmSurvivalChance and
  FARM_SURVIVAL_*); src/sim/professions/farm_watch_fee.ts (the fee predicate and its
  DETERMINISTIC consumption order, derived from the catalog); src/sim/professions/gathering.ts
  (queueGatheringGrant, applyGrantClamped, drainGatheringGrants);
  src/sim/professions/tools.ts (slotToolEffectRefused, applyToolEffectUse, RARITY_DURABILITY_
  BONUS).
- Content: src/sim/content/farm_crops.ts (the eight rows, farmCropSkillThreshold,
  FARM_CROP_IDS as the load-side allowlist, every TUNING banner); farm_patches.ts (the 4 / 5 /
  6 / 8 tier-scaled bed counts and the per-player private-plot model); items.ts (every seed,
  produce, and fine-twin row with its sellValue and the produce buyValue rule); recipes.ts
  (FARM_RECIPES, all 14 rows, their skillReqs and bills); zone3.ts (farmer_hollis) and
  evergarden.ts (farmer_verbena) vendorItems; professions.ts (TOOL_EFFECTS); deeds.ts (the
  append-only tail and the visit-mark trigger shape); src/sim/deeds.ts (the registered
  mark-namespace list and restoreDeedStats).
- UI: src/ui/icons.ts (ITEM_ART_PENDING and the per-id procedural icon recipes beside the
  farming rows); src/ui/tool_effect_tooltip.ts (the module header, which today reasons only
  about fishing) and the toolEffectTooltip block in src/ui/i18n.catalog/hud_chrome.ts (its
  howToSlot line IS the advertised-slot list); src/ui/i18n.catalog/items.ts.
- Tests that will move: professions_farming, professions_farming_state, farm_recipes,
  farm_watch_fee, farmer_vendor_purchase, professions_zone_rollout, farm_patch_placement,
  farming_zones, item_icons, shipped_item_ids, recipe_economy, deeds_content,
  tool_effect_tooltip, professions_tools, guide, and tests/parity/golden/farming_session.json.
Return: the merged FARMING_GAIN_SCHEDULE rows verbatim; every crop duration literal; every
seed, produce, and fine-twin sellValue and buyValue; both farmers' current vendorItems arrays;
the exact current NEVER_STOCKED literal and its size pin; the exact current howToSlot English;
the shape of farming's existing tool-effect pins; and the exact current ITEM_ART_PENDING size
pin in tests/item_icons.test.ts.

STEP 2 - EXECUTE (parallel fan-out, explicitly; five agents by vertical slice, each owning its
own test files so two agents never edit one suite):

Agent 1 (THE CURVE AND THE MODEL; owns src/sim/professions/farming.ts and the
FARMING_GAIN_SCHEDULE arms of tests/professions_farming.test.ts):

- BUILD THE MODEL FIRST, TUNE SECOND. Never pick a number by feel. The model is a table with
  one row per band and it is the phase's actual deliverable; the four literals are its output.
  Every input below is read from the tree, not from this prompt:
    - band width 25, four bands: 0 to 25, 25 to 50, 50 to 75, 75 to 100.
    - the crop plant gate: farmCropSkillThreshold, (tier - 1) * 25.
    - the TEACHING CEILING per tier: farmingTeachingCeilingFor, which indexes the SCHEDULE'S
      OWN boundary column at min(tier, rows - 1), so tier 1 teaches to 50, tier 2 to 75, and
      tier 3 and tier 4 to the cap of 100.
    - beds per hub: 4 Eastbrook (tier 1), 5 Mirefen (tier 2), 6 Thornpeak (tier 3), 8
      Evergarden (tier 4), 23 total. Plots are PER PLAYER on shared beds, so one farmer can
      hold every bed at once, and there is no bed-tier gate: any crop the farmer's skill and
      hoe allow can go in any bed.
    - cycle times: the authored durationMs literals, roughly 35 and 45 minutes at tier 1, 130
      and 135 at tier 2, 240 and 270 at tier 3, 600 and 630 at tier 4 (the D5 bands: 30 to 60
      minutes, about 2 hours, about 4 hours, overnight).
    - survival: farmSurvivalChance, 0.85 at a crop's own gate ramping to 1.0 one full band
      above it. A WITHERED harvest grants NO proficiency (harvestCrop's failure arm says so in
      its own comment), so survival multiplies the grant rate directly.
- THE REFERENCE FARMER (this is DECISION A's subject, SETTLED 2026-08-20; state it in
  state.md as the model's one assumption): two check-ins a day, far enough apart that any
  crop of the tier is ready between them (every shipped duration is at most 10.5 hours, so
  both gaps of a morning-and-evening rhythm clear it), planting every TEACHING bed available
  in the band, meaning the union of the hubs whose crop tier still teaches at that skill.
  That yields:
    band 0 to 25:  teaching tiers 1;    hubs Eastbrook;              4 beds;  8 attempts/day
    band 25 to 50: teaching tiers 1, 2; Eastbrook + Mirefen;         9 beds; 18 attempts/day
    band 50 to 75: teaching tiers 2, 3; Mirefen + Thornpeak;        11 beds; 22 attempts/day
    band 75 to 100:teaching tiers 3, 4; Thornpeak + Evergarden;     14 beds; 28 attempts/day
  with mean survival per band computed from the crop mix (a crop planted a full band above
  its gate is 1.0; a crop planted in its own band averages 0.925), giving roughly 7.4, 17.2,
  21.1, and 26.8 SUCCESSFUL harvests per day. Re-derive all of it; do not paste these.
- days(band) = (25 / gain) / grantsPerDay. Run it against the CURRENT curve first and put the
  result in the ledger, because it is the evidence for the re-tune: 25 / 50 / 250 / 1250
  harvests is about 3.4, 2.9, 11.8, and 46.6 days, roughly 65 days total, of which the first
  FIFTY points of the ladder are about 6 days, under ten percent of the calendar. The front is
  the defect, not the total.
- THE RE-TUNE RULE, and DECISION A froze it: CHANGE THE GAIN COLUMN ONLY. The belowProficiency
  column IS the teaching-ceiling source (farmingTeachingCeilingFor reads
  FARMING_GAIN_SCHEDULE[min(tier, length - 1)].belowProficiency), so moving a boundary, adding
  a row, or removing one silently re-maps tier to ceiling and changes when a crop grays out
  for every farmer alive. Never do it. The pin "derives each tier ceiling from the schedule
  boundaries, never a second table" must stay green WITHOUT being edited; only the
  row-literals pin moves.
- PICK THE LITERALS FROM THE DYADIC SET (negative powers of two and their sums): grants
  accumulate by plain float addition in applyGrantClamped with no rounding anywhere, so a
  non-representable literal drifts and a band boundary can be missed by one harvest. Today's
  0.1 and 0.02 are both non-representable in binary floating point, so the shipped curve
  already drifts; the re-tune fixes that as a side effect and owes a pin that says so.
  RECOMMENDED OUTPUT at DECISION A's SETTLED span (about 10 weeks, 70 to 75 days for the
  reference farmer), to be re-derived and not pasted:
    0.25 / 0.125 / 0.0625 / 0.03125, which is exactly 100 / 200 / 400 / 800 harvests per band
    and about 13.5 / 11.6 / 19.0 / 29.9 days, roughly 74 days, with the first fifty points now
    about 25 days, a third of the calendar. Total harvests move 1575 to 1500: the ladder is
    not lengthened, it is STRAIGHTENED. Note in the ledger that band 2 reads slightly faster
    in DAYS than band 1 because the second hub doubles the bed count; that is a reward for
    progress, and the harvest ladder itself is strictly doubling.
  Also record the envelope, because DECISION A fixes a floor as well as a target: at
  maximum dedication (all 23 beds, two visits, about 44 successful harvests a day) the same
  1500 harvests take about 34 days, and a player who returns as often as the timers allow
  rather than twice a day compresses it further. State that bound; do not design against it.
- Every literal keeps a TUNING banner in the farm_crops.ts and farming.ts house style, and the
  banner now names the model and the state.md section instead of saying "provisional": the
  whole point of this phase is that these numbers stop being felt.
- ZERO new rng draws. The gain path is pure and draw-free at both halves and stays that way;
  the plant two-draw and harvest draw-count contracts are untouched. If any part of this
  deliverable seems to need a draw, that is a STOP.
- Tests owed: the schedule row literals re-pinned; the boundary column pinned SEPARATELY from
  the gain column so a future tune cannot move a ceiling by accident; an EXACTNESS pin that
  accumulates one band's gain exactly N times and lands on the boundary with a strict equality
  (never toBeCloseTo); the composition arm (gain zeroed at or past the crop's teaching ceiling)
  still green; and a derivation test that recomputes days-to-100 from the model's inputs and
  asserts the curve the tree ships is the curve the model produces, so the doc and the code
  cannot drift.

Agent 2 (THE CROP ROSTER; owns src/sim/content/farm_crops.ts, the new rows in
src/sim/content/items.ts and src/ui/icons.ts, src/ui/i18n.catalog/items.ts, and the crop-
catalog arms of tests/professions_farming.test.ts):

- Two new tier-3 crops and two new tier-4 crops, so the roster is 2 / 2 / 4 / 4. Each ships
  seed, produce, and fine twin: 12 new item ids. COMPOSITION IS RULED, not free (DECISION
  B): exactly ONE of the two new tier-3 crops is a LEAF, and no tier repeats a plant class,
  which on the shipped roster gives tier 3 = grain, gourd, leaf, plus one root or legume,
  and tier 4 = melon, leaf, plus one root or tuber and one fruit or gourd. 11h GATE B
  assigns one tier-3 crop per apex role plate and needs the leaf to make its cost-equal
  branch available, so a roster of two more grains would silently force 11h back to a
  cross-tier halving. GATES ARE DERIVED, NEVER SET: a crop carries a tier and
  farmCropSkillThreshold turns it into 50 and 75 respectively, and farmSurvivalChance
  re-derives the same threshold from FARM_SURVIVAL_BAND_SPAN. A crop gated at an arbitrary
  skill (90, say) is NOT AVAILABLE and this phase does not attempt one: the binding pin
  "binds the catalog band math to the survival ramp span (two independent 25s)" exists
  precisely to red on that.
- CROP IDS ARE PERSISTED SAVE KEYS (the farm_crops.ts header): FARM_CROP_IDS is the load-side
  allowlist and drops any plot whose crop id it does not carry. New ids are additive and safe;
  renaming or retiring one destroys plots. Author each id once, correctly, forever.
- DURATIONS: distinct from every sibling in the tier (the shipped rule is that two crops of a
  tier never share a duration; with four per tier it binds across all four), inside the D5
  band for that tier, and NEVER BELOW the tier's current minimum. The floor matters: a shorter
  upper-tier crop would let a bed turn over faster and quietly accelerate the ladder Agent 1
  just tuned. SETTLED 2026-08-20: tier 3 at 250 and 260 minutes, tier 4 at 615 and
  645 minutes. Re-derive them at authoring against the MERGED table rather than pasting them,
  and carry the shipped farm_crops.ts TUNING banner idiom at each row, naming the D5 band and
  the floor the value may not undercut. Verify all three constraints against the shipped table
  BEFORE a row is written: no two crops in a tier share a durationMs; every value sits inside
  its D5 band (tier 3 about 4 hours, tier 4 the 8 to 11 hour overnight band); and none
  undercuts the tier's current minimum. WHY this set: the shipped values are 240 and 270 at
  tier 3 and 600 and 630 at tier 4, so it collides with nothing and stays inside both bands
  (645 minutes is 10.75 hours, an hour under the ceiling).
- PRICES: no new price point anywhere. The shipped ladder is seed 1 / 2 / 4 / 8 by tier,
  produce 4 / 8 / 15 / 40, fine twin exactly twice its base. New rows take the value their tier
  already uses. Produce is kind 'junk' and market-listable (R18), and new PRODUCE is never
  vendor-stocked, which is what keeps the "no farm recipe is craftable from vendor stock
  alone" arm true.
- FAUCET: the four new seeds are vendor rows at farmer_hollis (tier 3) and farmer_verbena
  (tier 4) under DECISION D's convention, authored by Agent 3 in the same edit as GATE 1's
  four, never as a second convention. Seed-back rolls (FARM_SEED_BACK_*, tier 3 and up) pick
  the new crops up from the catalog with no edit.
- CONSUMER: every new crop needs one in THIS phase (D11's every-material-has-a-consumer
  rule, and the packet's contract has no "parked" status). The consumer is an ADDED reagent
  row on the shipped tier-matched farm dish, base grade and fine twin together, which is
  exactly the shipped bill shape (recipe_eastbrook_root_pottage takes brook_carrot x2 plus
  fine_brook_carrot x1). THE FOUR BILLS ARE SETTLED 2026-08-20, not candidates: the two new
  tier-3 crops go into recipe_highwatch_barley_bannock and recipe_highwatch_gourd_soup, the
  two new tier-4 crops into recipe_evergarden_sunmelon_tart and
  recipe_evergarden_harvest_platter, each as a base-plus-fine reagent pair. ADDED ALONGSIDE,
  NEVER SUBSTITUTED (R18): no existing reagent row is removed or reduced.
  - The reachability of those dishes DOES NOT MOVE, and assert it rather than claim it: each
    already requires a crop of the same tier, so the farming skill and hoe rung a cook needs
    are unchanged and only the material cost widens.
  - FORBIDDEN BILLS, because other phases own them and a double edit is a silent conflict:
    recipe_highwatch_barley_porridge and recipe_evergarden_braised_greens (11f's re-tier
    anchors), recipe_harvest_feast (11f climbs it to cooking 100; these three are the rows
    GATE 1 proves end to end below), recipe_seasoned_stock (11g owns it: 11g DECISION C lands
    marsh_rice 2 plus bog_beet 2 and 11h dropped its GATE F on 2026-08-20), and every
    masterwrought apex bill (11h and 11k). If a consumer cannot be found outside that set,
    STOP rather than editing into another phase's row.
  - DECONFLICTION WITH 11g, stated so neither phase re-authors the other's work: 11g's subject
    is the GENERAL cooking and alchemy tree, the 17-reagent tree that today carries no
    vegetable and no grain. The four FARM_RECIPES dishes above are THIS phase's rows and this
    phase's obligation (a new crop may not ship without a consumer, D11). If 11g later reaches
    one of them, it ADDS alongside under R18 and never re-prices or re-authors what landed
    here. Record the four bills by id in the ledger so 11g can see them.
  - Gold-negative moves in the safe direction (input rises, output is unchanged) but is
    re-derived from the merged table anyway, and tests/recipe_economy.test.ts's two sorted
    literal pins are RECOMPUTED from the merged ALL_RECIPES, never hand-merged: both packets
    edit that file.
- NAMES: four new proper nouns, so R15 and D17 run BEFORE they are typed. THE METHOD AND THE
  CONSTRAINTS ARE SETTLED 2026-08-20; the names themselves are DERIVED by this phase, and no
  name is typed before its verdict exists in naming-audit.md. Each id pairs an ALREADY
  REGISTERED zone-flavored word (Vale, Brook, Marsh, Bog, Highland, Highwatch, Frost, Gilded,
  and Evergarden are all in the registry) with a common plant noun, on the shipped shape, with
  fine_ and _seed affixes, which puts the entire R15 risk on the plant noun alone. Check the
  registry's rejected-for-collisions row FIRST, web-verify every candidate against the major
  game wikis at authoring, take the next candidate on anything that does not come back CLEAR
  or GENERIC, record every verdict in naming-audit.md, and add the accepted names to the
  registry. WHY the constraint rather than a name list: the verdicts need web verification
  that does not exist yet, and reusing a registered zone word makes twelve ids cost one
  verification each instead of two. FARM_CROP_IDS members are persisted save keys, so each id
  is authored once, correctly, forever.
- ART AND ICONS. PARK IS SETTLED 2026-08-20 for every phase from 11e to 11k: this packet
  ships NO committed WebP art, and the art wave runs on the maintainer's own schedule after
  the packet, because the master SHA is an artifact a phase session cannot produce and
  blocking a content phase on it would break the one-branch-one-PR contract. 12 new ids, so
  ITEM_ART_PENDING moves from 44 to 56, and every new id parks on that allowlist with exactly
  ONE art owner (the pending row; the batch form and the entries form are never both used for
  one id), and the A3 arm in tests/item_icons.test.ts pins the set's EXACT SIZE: predict 56,
  then run, then require equality. Each pending id must ALSO get its own procedural icon
  recipe in src/ui/icons.ts beside the shipped farming rows, because that arm asserts the id
  resolves to no static url and composes a drawn icon instead. A pending id takes no
  public/ui/items/mapping.json entry: art ownership is claimed when the WebP lands. Confirm
  which arm of tests/item_art_consistency.test.ts binds pending ids rather than assuming.
- i18n: English-only names and any new prose in src/ui/i18n.catalog/items.ts under the
  three-tier ordering rule, with M16 non-Latin fills for wordy English names in the SAME
  change. Nothing in world_entity_i18n.ts (crops are items, not named entities); record that
  verdict rather than leaving it unstated.
- The watch fee predicate derives its legal produce set and its DETERMINISTIC consumption
  order from the catalog (ascending crop tier, then catalog id, base before fine), so the new
  produce joins with no edit AND the spend order for tier-3-and-up plants changes. Move
  tests/farm_watch_fee.test.ts's order pin DELIBERATELY, with the new expected order written
  out, never regenerated to match.

Agent 3 (GATE 1 AND THE SEED COUNTERS; owns src/sim/content/zone3.ts,
src/sim/content/evergarden.ts, tests/farmer_vendor_purchase.test.ts, and the NEVER_STOCKED arm
of tests/professions_zone_rollout.test.ts):

- GATE 1 IS SETTLED AS CLOSED-BY-11e (2026-08-20): fix the faucet here, in one edit, at the
  DECISION D prices, and every downstream phase verifies it by reading the merged vendorItems
  arrays in code rather than trusting this ledger row.
- farmer_hollis (Highwatch, tier 3) gains vendorItems rows for highland_barley_seed,
  frost_gourd_seed, and Agent 2's two new tier-3 seeds. farmer_verbena (Evergarden, tier 4)
  gains gilded_sunmelon_seed, evergarden_greens_seed, and the two new tier-4 seeds. Eight rows
  across two counters, one convention.
- EVERY STOCKED ROW CARRIES A POSITIVE buyValue or it is a DEAD ROW that renders and then
  refuses (D11's trap). Derive each from DECISION D as settled (tier 3 buyValue 32, tier 4
  buyValue 64), print the base arithmetic AND the premium at the row, and state the
  comparison the premium exists for (a bought seed against a seed-back seed: a tier-3
  harvest expects 0.48 seeds back, a tier-4 harvest 0.41) rather than asserting it.
- Discharge the dormancy record in the SAME change: the (bs) waiver in docs/design/deeds.md is
  CLOSED with its date and closing phase; the self-clearing honesty arm in
  tests/deeds_content.test.ts over the purchase surfaces must SELF-CLEAR rather than be
  deleted, and its inverted assertions re-read so that green means "earnable" and never "the
  arm went vacuous"; prog_farming_100 and the transitively parked feat_book_complete are
  recorded EARNABLE; farming teaching stops graying at 75.
- Re-derive, never hand-edit: NEVER_STOCKED in tests/professions_zone_rollout.test.ts loses
  exactly the four shipped tier 3 and 4 seed literals and gains none of the four new ones, and
  its size pin and its FARM_RECIPES length companion are re-derived from the merged tables with
  the per-table non-vacuity arms intact. tests/farmer_vendor_purchase.test.ts buys every new
  row at its farmer through Sim.buyItem (count up, copper down by the price) and keeps its
  too-far and wrong-counter negatives. Each per-farmer vendor-walk width pin moves by exactly
  four.
- The farming OPEN row "Fine-twin buyValue doctrine intersection (priced tier-4 twin above
  unpriced tier-4 seed)" is CLOSED by this change, because the tier-4 seed is now priced.
  Record the closure in farming/state.md's open list; do not leave a settled question open.
- GATE 1 IS PROVEN END TO END, not argued: a fresh character buys a tier-3 seed at Hollis,
  plants, harvests, and completes highwatch_barley_porridge; the tier-4 arm at Verbena
  completes evergarden_braised_greens; a third arm reaches recipe_harvest_feast; and
  prog_farming_100 plus feat_book_complete are shown reachable.
- Wiki and guide: (bo)'s addendum says the guide advertises dormant dishes with no seed
  source. Regenerate with npm run wiki:content, make the seed source visible, and delete any
  dormancy-disclosure prose that is now false. tests/guide.test.ts gates the freshness.

Agent 4 (THE TOOL-EFFECT RECONCILIATION; owns src/ui/tool_effect_tooltip.ts, the
toolEffectTooltip block in src/ui/i18n.catalog/hud_chrome.ts, the farming effect mapping in
src/sim/professions/farming.ts's harvestCrop arm, tests/tool_effect_tooltip.test.ts, and the
tool-effect arms of tests/professions_farming.test.ts):

- VERIFIED, and it is why this costs almost nothing: slotToolEffectRefused has exactly two
  arms, professionId 'fishing' and any effect whose catalog kind is 'respawnSpeed'.
  makers_charm is kind 'quantity'. Farming already consumes the slot (it reads
  meta.toolEffectSlots.farming, calls applyToolEffectUse, maps quantity to bonusPicks and
  quality to a flat fine-chance bump, and settles the R42 charge against the same-seed
  counterfactual). Do NOT wire anything: verify it on the merged tree and PIN it.
- THE REAL GAP IS ADVERTISING. The advertised-slot list is the English of
  hudChrome.professions.toolEffectTooltip.howToSlot, today "Slot onto a mining, logging, or
  herbalism tool from the Professions window. Consumed when slotted." Farming is missing, so
  the charm is slottable on a hoe and never advertised as such. Add the farming row, and
  update the src/ui/tool_effect_tooltip.ts header comment, which today reasons only about
  fishing and states the closed set wrongly.
- PIN IT TO THE POLICY, NEVER TO ITSELF: tests/tool_effect_tooltip.test.ts already pins the
  landOnly line by asserting slotToolEffectRefused('fishing', ...) is true. Add the twin in
  the same shape asserting the farming arm is NOT refused for makers_charm, so copy and policy
  cannot drift. The verbatim copy pin in that file moves with the reword; move it
  deliberately.
- i18n consequence, a real cost and not a formality: this is a REWORD of an existing key, so
  every locale fill for it goes stale while still reading as filled (the reword-staleness
  trap). Contributors add ENGLISH only; the key joins the release-tier fill worklist for Phase
  17. Record the row. The resolved bundles are regenerated by the owning step, never
  hand-edited.
- THE OVERLAP, per DECISION C as SETTLED 2026-08-20 (step the charm's farming contribution to
  +1). Implement the ruling as given; it is not re-decided here.
  - Stepping to +1 lands in farming's OWN quantity-to-bonusPicks mapping (a farming-owned
    constant beside FARM_TONIC_BONUS_PICKS, banner-flagged like its neighbours), NEVER in
    TOOL_EFFECTS.makers_charm.bonus, which would silently re-tune mining, logging, and
    herbalism and break the pin tying the "+2" prose back to the catalog.
  - Farming's existing arms assert armed.picks equals unarmed.picks plus
    TOOL_EFFECTS.gatherers_cache.bonus. A cap of 1 keeps every one of them green BY
    CONSTRUCTION (the cache's bonus is already 1), which is exactly why a new arm is owed
    proving the cap BITES for makers_charm at bonus 2. There is no makers_charm arm in
    farming's suite today: the charm-on-a-hoe path is entirely unpinned, which is how the
    overlap survived two packets.
  - THE TOOLTIP MUST STAY HONEST (docs/design/tooltip-writing.md, and use the
    write-game-tooltips skill): the bonus line reads "+2 yield per harvest while charged" for
    every profession, and a hoe that pays +1 makes it false. The copy moves in the SAME
    change, not as a follow-up.
  - REJECTED on 2026-08-20 and not re-proposed: accepting +4 picks as a deliberate ceiling. It
    leaves the alchemy growth tonic with no reason to exist and doubles produce supply against
    a fixed demand. If a session finds itself arguing for +4, that is a STOP and a report line,
    never an edit.
- Artisan's Eye on a hoe is not this phase's business and is not a merge regression: it ships
  on the farming branch already. Record the read as one maintainer line (its bonus times
  FARM_FINE_CHANCE_EFFECT_BONUS doubles the cap-skill fine rate and quintuples the skill-0
  rate, and 11h is about to create real demand for fine twins) and change nothing.

Agent 5 (THE ANTI-CHORE PROOF, THE MODEL RECORD, AND THE CROSS-CUTTING PINS; owns the new
anti-chore suite, the state.md model section, and the golden re-record):

- THE PROOF, and it is the phase's conscience. A slower curve is only acceptable because it
  changes PACING and never OBLIGATION. Take farming/qa-checklist.md's five anti-chore rows
  verbatim and give each a pin or a stated proof against the re-tuned curve:
    two visits per cycle (no mid-growth interaction exists at all, D8);
    nothing rots (a fully grown crop waits indefinitely and a late harvest pays exactly what
      an on-time one pays);
    absence is never punished (growth runs on ctx.lockoutNowMs while logged out; the login
      notice fires for finished crops);
    risk is opt-in (survival is untouched by this phase; one band above the gate is always
      safe);
    the timer UI exists and is honest.
- The decisive new pin: proficiency granted by a harvest is a function of PROFICIENCY and CROP
  TIER only, never of elapsed time, so a plot harvested days late grants exactly what an
  on-time harvest grants. Drive it through the real harvest path with two clocks, not by
  reading the pure function.
- The structural companion: the gain schedule is read at the HARVEST GRANT SITE and nowhere
  else. Assert there is no read at expiry, at login, or in the tick sweep, and that no daily
  reset, decay, or wither path exists anywhere in the farming module. Strip comments before
  any source-text assertion (a comment naming a call must not satisfy a pin).
- RECORD THE MODEL IN state.md so it is reproducible from the doc alone: the inputs with the
  symbol each was read from, the reference-farmer assumption as SETTLED under DECISION A,
  the per-band table (teaching tiers, hubs, beds, attempts per day, mean survival, successful
  harvests per day), the days-per-band arithmetic for BOTH the old and the new curve, the
  total-harvest counts (1575 to 1500 at the default), the maximum-dedication floor, and the
  dyadic-literal rule with its reason. A later reader must be able to move DECISION A's span
  and re-derive the curve without opening a source file.
- THE GOLDEN, predicted before it is run: this phase adds NO draw, so
  tests/parity/golden/farming_session.json keeps its draw count and its draw digest, and only
  the sampled farming proficiency moves, by exactly the new gain. Predict the composition,
  then re-record ONCE, isolated, in its own reviewed commit with UPDATE_PARITY=1 and
  DATABASE_URL kept out of the environment. ZERO other goldens may move: nothing here shifts
  entity-id allocation or the rng stream. A second moved golden is a STOP, not a re-record.
- Predict the flat pins too, then run: IWorld parity stays at 11d's re-derived totals (no
  facet member is added), the command schema and delta-key counts do not move, no SimEvent is
  added, no monolith ceiling moves (this phase adds content rows and data, never coordinator
  lines; if a ceiling moves, extract first, and never raise a literal to make room).
- THE FOUR SWEEP VERDICTS ARE SETTLED 2026-08-20, and each sweep still RUNS rather than being
  assumed, because the content-obligations reviewer treats an unwritten verdict as a gap and
  silence is the failure mode, not a wrong answer:
    Reliquary: NO page. A crop is not conquerable unique loot.
    Book of Deeds beyond DECISION E: NONE. A crop is not conquerable content.
    Work orders: NO new rows. This is the verdict with real teeth:
      WORK_ORDER_PAYOUT_FRACTION is a flat 0.5 of summed vendor sellValue, so pointing it at
      top-of-curve produce mints copper, and it would be found later as an economy bug rather
      than as a decision.
    Market filter: NO new chip. The shipped 'material' chip already covers kind 'junk' produce
      and seeds.
  Nothing is owed in src/ui/world_entity_i18n.ts either (Agent 2 records that verdict with the
  crop rows).

INVARIANTS IN PLAY: determinism (this phase adds NO rng draw anywhere; the plant two-draw and
the harvest draw-count contracts are byte-identical afterwards; if any deliverable seems to
need a draw, STOP); the schedule's boundary column is the teaching-ceiling source and never
moves; crop gates derive from tier through the shared 25-point band math and the survival ramp
re-derives the same number (two independent 25s, bound by a pin); ids are append-only and crop
ids are persisted save keys (tests/shipped_item_ids.test.ts, FARM_CROP_IDS); R15 and D17 (every
new proper noun web-verified and registered before it is typed); R17 (produce feeds cooking and
alchemy, never the gear chain, never the Perfecting materials, never recipe_quickening_
catalyst); R18 (produce stays market-listable kind 'junk', rows are added alongside and never
substituted, no profession is ever required); R19 (the curve comes from the measured model, not
from feel); D8 (front-loaded only: the seed faucet is a purchase, never a fifth knob); D11 (a
positive buyValue on every stocked row; every material has a consumer in the same phase); D24
(no cultivated twin of any wild herb, and herbalism loses nothing); i18n English-only catalog
rows with M16 fills in the same change, and any sim-emitted player text getting its matcher
rule in the same change (S3); no generated file hand-edited; the three-tier ordering rule
applied to every append-only table touched.

CONTENT OBLIGATIONS, enumerated because these are the ones that get missed: 12 new item ids
(4 seeds, 4 produce, 4 fine twins), each owing a row on the MERGED ITEM_ART_PENDING allowlist
(44 to 56, predicted then observed) AND its own procedural icon recipe in src/ui/icons.ts; M16
non-Latin fills for wordy English names in this change; wiki regen via npm run wiki:content
with tests/guide.test.ts freshness green; the roster deed DECISION E settled, with its mark
namespace REGISTERED in src/sim/deeds.ts and its save/load round trip pinned, plus the
recorded verdict for the crops themselves; the four settled sweep verdicts written down
(Reliquary none, deeds none beyond DECISION E, work orders none, market chip none); nothing in
world_entity_i18n.ts, recorded; and the recomputed tests/recipe_economy.test.ts sorted literal
pins, which BOTH packets edit and which are never hand-merged.

REJECTION LIST, recorded so none of these is re-proposed, each with its reason. The
alternatives rejected WITH the six decisions on 2026-08-20 are recorded at each decision in
STEP 0 and are equally closed: +2 crops, accepting +4 picks on a hoe, the bare four-times seed
price with no bootstrap premium, no roster deed, and any calendar span materially under a
month. The list below is the pre-existing set:
- A prestige crop gated at an arbitrary skill (90, or any non-band number). Not available:
  farmCropSkillThreshold derives the gate from the tier and farmSurvivalChance re-derives the
  same threshold independently, with a pin binding the two. A hand-set gate would have to
  break that invariant, which exists so a crop can never disagree with the profession's ladder.
- Tier-5 crops and a fifth hoe rung. PARTIALLY OVERTURNED 2026-08-20 (kept in place per the
  never-delete rule; qr-DOC-DRIFT, state.md row 132): the maintainer OVERTURNED the
  fifth-hoe-rung half, and Phase 11j Decision A ships the apex hoe at engineering 125 with
  the overturn's reason recorded there (the charm is an effect slot, not a tool, and a
  farmer capped at a rare hoe runs it at a strictly lower charge ceiling). Do NOT record
  this row into the ledger as live rejected design; cite 11j for the hoe. The TIER-5 CROPS
  half of the rejection STANDS as written: the hoe ladder's frozen wield-gate thresholds are
  load-bearing, and each new crop tier drags art, M16 fills,
  wiki regen, and deed obligations for no design win.
- Raising farming's maxSkill above 100. It manufactures a new asymmetry inside the gathering
  tier to fix an optics problem in the crafting tier. If 125 is ever wanted it is the
  gathering-wide cap climb proficiency_bands.ts already comments forward room for, in its own
  packet, for all five professions at once.
- A cultivated twin of any wild herb. D24's displacement guardrail, and masterwrought just
  multiplied sunpetal and goldleaf demand across ten crafts.
- Making the curve faster in exchange for a daily quota, a login streak, a rested bonus, or
  any catch-up mechanic. Every one of them converts pacing into obligation, which is the exact
  thing deliverable 2 exists to forbid.
- Shortening an upper-tier crop's duration to soften the tail. It would quietly raise the
  ceiling on harvests per day and undo Agent 1's tune through the back door.
- A second faucet for tier 3 and 4 seeds beyond the vendor rows (a seed-back rate bump, a
  quest grant, a work-order payout in seeds). GATE 1 needs exactly one bootstrap; a second one
  makes the seed-back thrift path pointless.

Out of scope: farming's entry into the drop economy and any recipe above skillReq 50 (11f);
produce into cooking and alchemy bills at any rung (11g and 11h); the tier-4 fine twins'
apex consumers (11h GATE D); the apex feasts (11k, since 11h GATE E was cut on 2026-08-20);
fishing (11i); the R20 enforcement test and the apex gathering-tool family (11j); the
capstone and its prestige (11k); the well-fed ladder and the aura id, which 11c settled (if
this phase believes a magnitude is wrong, that is a STOP, not an edit); the Perfecting stage
(12); UI beauty work on any farming surface (14); the R5 envelope measurement (15); the
merged icon and wiki enumeration sweep (16).

STEP 3 - VALIDATION + REVIEW (matrix in implementation-plan.md):
npx tsc --noEmit; then npx vitest run tests/professions_farming.test.ts
tests/professions_farming_state.test.ts tests/farm_recipes.test.ts tests/farm_watch_fee.test.ts
tests/farmer_vendor_purchase.test.ts tests/professions_zone_rollout.test.ts
tests/farm_patch_placement.test.ts tests/farming_zones.test.ts tests/farm_ready.test.ts
tests/item_icons.test.ts tests/item_art_consistency.test.ts tests/shipped_item_ids.test.ts
tests/recipe_economy.test.ts tests/deeds_content.test.ts tests/tool_effect_tooltip.test.ts
tests/professions_tools.test.ts tests/guide.test.ts tests/architecture.test.ts
tests/localization_fixes.test.ts tests/world_api_parity.test.ts plus every new suite; then the
parity suite; then the FULL suite (npx vitest run --maxWorkers=5) before any review round is
called done, because a content phase on a freshly merged tree is exactly where a census red
hides outside a curated battery. npm run ci:changed on the touched files only. Read the gate
LOG, not just its exit code: a printed FAIL marker overrides a zero exit.
Review Dispatch Matrix: architecture-reviewer (the gain schedule, the farming effect mapping,
and the harvest grant site are sim behavior); content-obligations-reviewer (the whole content
diff: art, icons, M16, wiki regen, deeds, Reliquary posture, ids append-only);
frontend-seam-reviewer (src/ui/tool_effect_tooltip.ts, the catalog reword, the 12 icon
recipes); migration-safety (crop ids are persisted save keys read by the load-side allowlist,
and DECISION E's deed mark namespace touches the characters.state deserialize path, where an
unregistered namespace is dropped on load); qa-checklist when the deliverable set is complete.
Skip privacy-security-review and database-performance-reviewer unless server/ or a SQL call
site was touched; add cross-platform-sync ONLY if a SimEvent, wire field, facet member, or
matcher rule turns out to be needed (predict: none). COVERAGE prompts; apply ALL findings,
blocking and should-fix and nits.

STEP 4 - COMMIT CADENCE (explicit paths, bodies, no session trailers):
- feat(content): stock the tier 3 and 4 farm seeds and discharge the dormancy waiver
- feat(sim): re-tune the farming gain curve from the measured calendar model
- feat(content): four upper-tier crops with their seeds, fine twins, and consumers
- feat(ui): advertise the farming slot for the maker's charm and settle the tonic overlap
- test(sim): the curve derivation, the anti-chore pins, and the re-derived vendor and crop pins
- chore(parity): re-record farming_session for the re-tuned gain (isolated, predicted)

STEP 5 - ACCEPTANCE:
- [ ] Every one of the six decisions was EXECUTED as recorded in state.md's "Decisions closed
      2026-08-20 (the full delegation)" section, and the report shows each ruling beside what
      shipped. A code-versus-ruling mismatch stopped the phase; none was re-decided in session
- [ ] The curve is DERIVED: the model table exists in state.md with every input traced to a
      real symbol, and a test recomputes days-to-100 and asserts the shipped curve is the
      model's output. No literal in FARMING_GAIN_SCHEDULE is defensible only by feel
- [ ] Only the GAIN column moved: the belowProficiency boundaries and the row count are
      byte-identical, and the tier-ceiling derivation pin is green WITHOUT being edited
- [ ] Every gain literal is exactly representable, and an accumulation pin lands on a band
      boundary with strict equality
- [ ] The five anti-chore rows each carry a pin or a stated proof; late harvests grant exactly
      what on-time harvests grant, proven through the real path with two clocks; no daily
      reset, decay, or wither path exists, and the schedule is read at the grant site only
- [ ] Roster is 2 / 2 / 4 / 4 with every gate DERIVED from tier; exactly one of the two new
      tier-3 crops is a LEAF and no tier repeats a plant class (DECISION B, which 11h GATE B
      reads); the two-independent-25s binding pin is green; four durations per tier all
      distinct, inside the D5 band, and none undercutting the tier's current minimum
- [ ] Every new crop has a faucet (a vendor row with a positive derived buyValue: 32 at tier
      3, 64 at tier 4, arithmetic printed at the row) and a consumer (an ADDED reagent row on
      one of the four settled bills, none of them a forbidden bill), and no new price point
      was invented
- [ ] GATE 1 DISCHARGED end to end: seeds bought at both farmers, the three dormant recipes
      completed, prog_farming_100 and feat_book_complete earnable, the docs/design/deeds.md
      waiver CLOSED, the honesty arm self-cleared without going vacuous, NEVER_STOCKED and the
      per-farmer walk pins re-derived
- [ ] ITEM_ART_PENDING 56, predicted then observed, with one art owner per id and no
      committed WebP attempted; 12 procedural icon recipes; M16 fills for wordy names; wiki
      regen fresh; the four settled sweep verdicts recorded
- [ ] The roster deed shipped at category 'collection', renown 5, no title, with its mark
      namespace registered in VISITED_MARK_NAMESPACES and a save/load round trip pinned, and
      DEED_ORDER's tail pin moved off prog_farming_100
- [ ] Every R-number this phase wrote into src/, server/, tests/, or a CLAUDE.md reads
      "masterwrought R<n>" in full, never bare; decisions-index.md was NOT edited here (11d
      owns its professions-tuning namespace row)
- [ ] The advertised slot line names farming, pinned against slotToolEffectRefused rather than
      against itself; the reword is on the release-tier fill worklist; DECISION C implemented
      where it belongs, with a new arm proving it bites and a tooltip that is honest about what
      a hoe pays
- [ ] Zero new rng draws; farming_session re-recorded ONCE with its composition predicted
      (draws and draw digest unchanged); zero other goldens moved
- [ ] IWorld parity, command schema, delta keys, SimEvents, and every monolith ceiling
      unmoved, each predicted before it was run
- [ ] Full suite green; ci:changed clean; gate log read, not just its exit code

STEP 6 - DOCS: progress.md Phase 11e row; state.md ledger (the six decisions as EXECUTED
against the 2026-08-20 delegation record, the CALENDAR MODEL in full, the old and new curves
with their day arithmetic, the four new crops with their tiers, durations, prices, faucets,
consumers and R15 verdicts, the seed prices with their derivations, the charm ruling and
where it landed, the roster deed and its registered mark namespace, the
predicted-versus-observed pin table, and the rejection list as recorded design);
farming/state.md's OPEN list updated in place (GATE 1 closed-by-11e, the fine-twin doctrine
intersection closed, D5 and D11 amended in place with dated AMENDED lines for the roster and
the durations, never renumbered, AND a dated AMENDED line on D21 per qr-DOC-DRIFT, state.md
row 132: the work-order rotation stays at the original eight crops, with this phase's
no-new-rows sweep verdict as the recorded reason, so D21's universal claim does not narrow
silently); docs/design/deeds.md waiver closure; memory note for
anything that surprised you.

STEP 7 - REPORT: phase status, files, validation results, reviewer verdicts, the model table as
recorded, the predicted-versus-observed pin table, and the handoff line for Phase 11e QA
(including the exact numbers 11f, 11g, and 11h inherit: the roster ids, the seed prices, and the
gain curve).

STOPPING RULES: stop if state.md's "Decisions closed 2026-08-20 (the full delegation)"
record is missing when the fan-out would start, or if the code, this file, and that record
disagree on any of the six decisions (the mismatch is blocking on its own and is never
resolved by re-deciding in session); if the derived calendar span lands materially under a
month, which re-opens DECISION A instead of shipping; if the calendar model needs an input
the tree does not carry (a felt number is a stop, not a workaround); if the re-tune appears
to need a boundary move, a new schedule row, or a removed one; if a crop cannot be gated by
tier alone; if a new crop cannot find a consumer outside the forbidden-bill list; if the
charm step cannot be expressed without editing TOOL_EFFECTS.makers_charm.bonus; if any
deliverable appears to need an rng draw; if any golden other than farming_session moves; if
a monolith ceiling would have to be raised; or if the release merge conflicts inside
src/sim/content/farm_crops.ts, src/sim/professions/farming.ts, or
tests/recipe_economy.test.ts.

```
