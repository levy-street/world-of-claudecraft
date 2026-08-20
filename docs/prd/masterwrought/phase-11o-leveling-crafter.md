# Phase 11o: The leveling crafter

### Starter Prompt
```
This is Phase 11o of the Masterwrought feature: the leveling crafter. It exists because the
packet's own standing quality review (professions-quality-review.md, first run 2026-08-20,
adopted in full by the maintainer) measured three defects no phase 01 to 17 owned: the
crafted rare tier is administratively locked out of the longest leveling band, engineering
cannot be leveled at all from zero, and three live recipes advertise a skill tier no player
can attain. All three are cheap data fixes with outsized player impact, which is exactly
what an inserted phase is for.

Model: xhigh effort. Harness: Claude Code. Worktree: ~/Documents/wocc-masterwrought
(branch feature/masterwrought). ULTRACODE: not needed. This phase is narrow and
high-judgment: a re-level sweep, three rows, two new ids, and the tests that pin them.

Goal: three deliverables.
(1) THE MID-BAND WEARABILITY RE-LEVEL (qr-11o-WEAR, state.md row 118): the rung-50 crafted
    rares become wearable at the character levels where their stats are competitive, and
    the rung-75 rares follow, without any magnitude moving anywhere.
(2) THE ENGINEERING ON-RAMP (qr-11o-ENG, state.md row 119): engineering becomes levelable
    from skill 0, for attuned and unattuned characters alike, through content of its own.
(3) THE 150 RUNG RETIRES (qr-11o-150, state.md row 120): the three grandfathered land-tool
    recipes re-tier from skillReq 150 to 125, the reachable cap tier, and the family
    reading in docs/design/professions.md is amended with the date.

WORKTREE GUARD (do this FIRST; the user runs multiple concurrent sessions): run pwd.
If you are not in /Users/fernando/Documents/wocc-masterwrought, switch this session into
it NOW with the EnterWorktree tool (path: /Users/fernando/Documents/wocc-masterwrought).
If EnterWorktree is unavailable or refuses, STOP and ask the user to relaunch Claude Code
from that directory. Phase work never runs from the main checkout at
~/Documents/world-of-claudecraft.

STEP 0 - PRE-FLIGHT (canonical Team Workflow, docs/prd/masterwrought/implementation-plan.md):
- git status clean, with Phase 11n QA closed. This phase edits recipes.ts rows that 11l and
  11n also sit near; it runs on the settled table.
- SYNC RELEASE: git fetch origin --prune, discover the newest release branch by version
  sort (git branch -r | grep 'origin/release/' | sort -V | tail -1), merge it, run the
  release-merge-audit skill. A minor-version-or-more jump runs as its own phase first.
- THE DECISIONS ARE SETTLED (2026-08-20, the quality-review adoption pass, state.md rows
  117 to 120). Nothing here is confirmed at STEP 0. Read rows 117 (qr-11o-ADMIT), 118
  (qr-11o-WEAR), 119 (qr-11o-ENG) and 120 (qr-11o-150) and execute them. A disagreement
  between this file and that record is doc drift to fix before any edit, never a licence
  to pick.
- Memory scan (MEMORY.md index): the test-pin trap index (READ before touching any pin),
  new-item-content-hidden-obligations, item-art-ownership-batch-xor-entries,
  m16-wordy-english-requires-nonlatin-fills, and the reusable-gotchas content cluster.

THE MEASURED FAULTS (the review's numbers; re-derive each in STEP 1, these are the shape):

FAULT A, the required-level cliff. src/sim/item_level_req.ts gates rare-and-above quality
by item SOURCE level, and a crafted item's source level IS recipe.level
(src/sim/item_level.ts, the bump at the ALL_RECIPES loop). Every rung-50 and rung-75
recipe ships recipe.level 20, so every crafted rare requires character level 20 to wear.
Measured consequence: thoriumscale_cuirass (score 23.2) would top the level-15 chest table
(best obtainable drop 18.3, at a 4 percent chance) but cannot be worn until 20, where the
epic shelf (26 and up, dungeon and heroic) obsoletes it on arrival. Levels 14 to 19 are
the LONGEST leveling band (113,100 XP of a 167,200 total) and crafting contributes zero
wearable upgrades to it. The crafted rung-25 uncommons (ungated, requiredLevel 1) are
best-in-slot at levels 8 to 13 and prove the shape works when the gate does not fight it.

FAULT B, the engineering on-ramp. Engineering has NOTHING craftable below skillReq 75 (the
merged tree's cheapest engineering rows are the farm branch's bronze_hoe at 25 and
skysilver_hoe at 50, both trainer-taught and therefore unlearnable below their own tier
via teachTierMet). Its cheapest pre-absorb recipe is tier 3, ABOVE the unattuned archetype
ceiling of 2, so an unattuned character can never gain a single point of engineering, and
an attuned major levels 0 to 75 exclusively on the grandfathered thorium-pick ladder
(about 300 fine_iron_ore, one recipe family, zero choices).

FAULT C, the fictional tier. recipe_arcanite_mining_pick, recipe_elderwood_axe and
recipe_sunpetal_sickle carry skillReq 150 while engineering's cap of 125 resolves to tier
5. All three are acquisition-less (known to everyone) and craftable (there is no
craft-time skill admission gate), so the 150 is pure fiction: it prints an unattainable
number on three live recipes, zeroes their skill gain for non-majors (tier 6 exceeds
every non-major ceiling), and the ROD_RECIPES header already documents the
unlearnable-above-cap lesson against them.

DECISIONS, settled 2026-08-20; execution notes per deliverable:

DELIVERABLE 1, THE RE-LEVEL (row 118).
- SCOPE IS DERIVED, never hand-listed: every recipe with skillReq 50 whose OUTPUT IS
  EQUIPPABLE (a slot, weapon or armor record) moves recipe.level 20 to 15; every recipe
  with skillReq 75 whose output is equippable moves 20 to 17 (on the current tree that is
  the three grandfathered rares: wardweave_cowl, duskhide_wraps, sootscale_mantle; the
  rung-75 intermediates and tools are NOT equippable and do not move). Consumable outputs
  (potions, scrolls, foods) are out of scope: their gating is not the requiredLevel
  derivation and their pacing was tuned elsewhere.
- SHARED-DEF OUTPUTS ARE SKIPPED, checked per row: an output that ALSO drops from a mob or
  sits on a vendor (the combo rares boundstone_helm and gravewyrm_gauntlets are the known
  case) derives its source level from every source, so re-leveling the recipe would move a
  dropped item's gate or do nothing; either way it is not this phase's fix. Sweep for
  shared sources before moving any row and record the skip list.
- WHAT MOVES AND WHAT MUST NOT: recipe.level feeds (a) the derived item level and
  therefore requiredLevel, which is the point; (b) craftActionXp's green/gray falloff,
  which shifts slightly and is accepted (a level-20 character gets grayer XP from rung-50
  crafts; skill GAIN is unaffected, it reads skillReq); (c) NOTHING else: itemLevelBudget
  is a separate field and the gold sink does not move, stats are authored literals and do
  not move, skillReq does not move. PREDICT the new derived ilvl and requiredLevel per
  touched output from item_level.ts and item_level_req.ts BEFORE running anything, then
  observe. If any pinned test carries an ilvl or score literal for a touched item,
  re-derive it predicted-then-observed and name it in the ledger.
- ACCEPTANCE IS THE WINDOW, not the literal: every re-leveled rung-50 output is wearable
  at or before character level 16, every re-leveled rung-75 output at or before 18, and
  the LEVEL-20 SHELF IS UNMOVED (no apex, heroic, raid or vendor item's requiredLevel or
  ilvl changes anywhere in the diff), so R5 inherits no re-measurement (Phase 15 verifies
  this construction independently, per its Premise 3).
- THE NEW TEST, tests/crafted_wearability.test.ts: derives the equippable-output set per
  band from ALL_RECIPES (no hand list), asserts the two windows with the derivation in
  the failure message, asserts the shelf (an exact-set pin over the apex outputs'
  requiredLevel), and is proven by mutation (raise one recipe.level back to 20, expect
  red naming the row; restore).

DELIVERABLE 2, THE ON-RAMP (row 119). Three edits:
- recipe_bronze_hoe re-tiers skillReq 25 to 0. Trainer acquisition kept; the hoe ladder's
  one-tier-below reagent invariant is untouched (the bill does not move); the teach fee
  drops to the tier-0 fee by the shipped fee ladder, which is correct for an on-ramp row
  and is noted in the ledger. tests/professions_hoe_recipes.test.ts pins re-derived.
- ONE new PART: a trainer-taught engineering recipe at skillReq 0 producing a junk-kind
  component (new item id; the identity and name are the session's derivation under R15
  web-verification, with the mechanical-parts register and no coined collision). The part
  joins the shipped recipe_precision_chassis bill as an ADDED reagent row (R18's
  add-never-substitute shape), so it has a real consumer inside engineering's own chain.
  Re-check the chassis bill gold-negative with the arithmetic in the row comment, and
  report the materialTierBonusForReagents delta the added row causes on the chassis's
  masterwork odds (a low-tier reagent moves the average; measure it, do not guess).
- ONE new GADGET: a trainer-taught engineering recipe at skillReq 25 producing either a
  cosmetic-use trinket (R14 forbids procs and new combat effects; a cosmetic use on the
  gyrelens precedent is legal) or an equippable offhand with formula-exact band stats that
  does NOT duplicate inscription's caster-offhand identity (if statted, pick the stat
  shape inscription does not own). The session derives the identity; the constraint set is
  the ruling. No vendor twin may exist (R23).
- ACCEPTANCE, pinned by test: an UNATTUNED character has at least one learnable engineering
  row at skill 0 whose recipe tier is inside the unattuned gain ceiling, so engineering
  0 to 25 is gainable unattuned; and the attuned climb 0 to 75 is satisfiable without any
  grandfathered tier-3 tool craft (walk the ladder by tiers in the test: learnable rows
  exist at 0 and 25, and skysilver_hoe covers 50, so full-gain rows exist at every band
  below 75).

DELIVERABLE 3, THE RE-TIER (row 120).
- The three rows move skillReq 150 to 125. Verify and record the three side effects: the
  craft cast-duration band (both 150 and 125 sit in the top band; expect no change, verify),
  the masterwork tiersAboveRecipe term for a capped major (tier 6 to tier 5 moves the term
  by one; measure the proc-chance delta and record it), and skill gain for non-majors
  (tier 6 exceeded every ceiling; tier 5 still exceeds the unattuned ceiling, so expect no
  behavior change for them, verify).
- Amend the TOOL_RECIPES and ROD_RECIPES header lessons IN PLACE: the
  unlearnable-above-cap rule STANDS for new rows; the three historical rows were re-tiered
  by this phase, dated. Amend docs/design/professions.md's tool-family reading (11j wrote
  "three grandfathered rows at 150 that are HISTORY"; it now reads re-tiered to 125 by
  masterwrought Phase 11o, dated), with the R-number rule respected.
- Re-derive every pin that carries the 150 literal (tests/professions_tools.test.ts,
  tests/professions_grandfather.test.ts and any source-text pin on the headers), predicted
  then observed. PRE_TRAINING_RECIPE_IDS does not change (the rows stay grandfathered;
  only the printed tier moves).

STEP 1 - LOAD CONTEXT (Explore agent; do not read planning docs in the main loop):
- state.md rows 117 to 120, R5, R13, R14, R15, R18, R23, the Power placement block, the
  validation matrix, and the 11l/11n ledgers (the tables this phase appends after).
- src/sim/item_level.ts (the ALL_RECIPES bump and itemSourceLevel), src/sim/item_level_req.ts
  (GATED_QUALITIES and the requiredLevel derivation), src/sim/items.ts
  (meetsLevelRequirement reads the DEF, which is why masterwork instances never raise
  their gate), src/sim/professions/profession_xp.ts (craftActionXp reads recipe.level),
  src/sim/professions/crafting.ts (the no-admission-gate header, the masterwork terms),
  src/sim/professions/wheel.ts, training.ts (teachTierMet, TRAINING_FEE_BY_TIER,
  PRE_TRAINING_RECIPE_IDS), archetype.ts (the unattuned ceiling), content/recipes.ts
  (every rung-50/75 row, TOOL_RECIPES and ROD_RECIPES headers, HOE_RECIPES,
  INTERMEDIATE_RECIPES and recipe_precision_chassis), content/items.ts (the touched defs).
- Tests that will move: tests/recipe_economy.test.ts (the chassis bill),
  tests/professions_hoe_recipes.test.ts, tests/professions_tools.test.ts,
  tests/professions_grandfather.test.ts, tests/item_level.test.ts,
  tests/itemization_coverage.test.ts, tests/shipped_item_ids.test.ts,
  tests/item_icons.test.ts (two new ids park), tests/guide.test.ts.
Return: the equippable rung-50/75 recipe list with each output's shared-source verdict;
the predicted ilvl and requiredLevel per touched output; the exact current pins carrying
the 150 literal; and the chassis bill verbatim.

STEP 2 - EXECUTE (three slices, small enough for one session; fan out only if the re-level
sweep's pin fallout is wide):
- Slice 1: the re-level sweep, its predictions, tests/crafted_wearability.test.ts, and the
  shelf pin.
- Slice 2: the on-ramp (the hoe re-tier, the part, the gadget, the chassis row, the
  acceptance test), with both new ids through the full obligation set: R15 web-verified
  names in the registry with evidence in naming-audit.md, ITEM_ART_PENDING rows with
  exactly one mapping.json owner (art PARKS, ip-16-ICON), M16 fills for wordy names, wiki
  regen, ids append-only under the three-tier ordering rule.
- Slice 3: the 150 re-tier, its header amendments, the professions.md amendment, and the
  pin re-derivations.

INVARIANTS IN PLAY: NO magnitude moves anywhere (no stat, no armor, no dps, no potion or
food value: this phase moves levels and tiers only, and a sweep proves it); the level-20
shelf unmoved (R5-safe by construction, verified); R13 (maxSkill stays 125 everywhere);
R14 (no new proc or combat effect on the gadget); R15 and the naming registry for both new
ids; R18 (the part is ADDED to the chassis bill, never substituted; both new outputs stay
market-listable); R23 (no vendor twin for either new output); ids append-only
(tests/shipped_item_ids.test.ts); determinism (no rng, no sim behavior change; say so
plainly rather than have the QA twin hunt for a draw impact); no generated file
hand-edited; i18n English-only catalog rows with M16 fills; the R-number namespace rule in
every doc or comment this phase writes.

NAMED REDS THIS PHASE EXPECTS: tests/item_level.test.ts and any ilvl-literal pin until
slice 1's re-derive; the hoe and grandfather pins until slices 2 and 3 land; the economy
pins until the chassis recompute; the guide freshness gate until the wiki regen. Any OTHER
red is a real finding.

STEP 3 - VALIDATION + REVIEW (matrix in state.md):
- npx tsc --noEmit; npx vitest run tests/crafted_wearability.test.ts tests/item_level.test.ts
  tests/itemization_coverage.test.ts tests/recipe_economy.test.ts
  tests/professions_hoe_recipes.test.ts tests/professions_tools.test.ts
  tests/professions_grandfather.test.ts tests/shipped_item_ids.test.ts
  tests/item_icons.test.ts tests/guide.test.ts tests/architecture.test.ts
  tests/localization_fixes.test.ts. THEN the FULL suite (npx vitest run --maxWorkers=5):
  a phase that moves derived item levels is exactly the shape where a red hides outside a
  curated battery. npm run ci:changed on touched files only. Read the gate LOG, not just
  its exit code.
- Dispatch per the Review Dispatch Matrix: content-obligations-reviewer (two new ids and
  their full obligation set, mandatory), test-coverage-auditor (the new wearability test
  and the shelf pin are exactly its class), architecture-reviewer ONLY if a src/sim/
  behavior file changed (the expected diff is content tables and tests; if one did change,
  that is itself worth reporting). qa-checklist LAST. COVERAGE prompts; apply ALL
  findings: blocking, should-fix, and nits.

STEP 4 - COMMIT CADENCE (explicit paths, bodies, no session trailers):
- feat(content): re-level the crafted rung-50 and rung-75 rares into their bands
- test(content): the crafted wearability windows and the level-20 shelf pin
- feat(content): the engineering on-ramp (part, gadget, and the tier-0 hoe)
- feat(content): retire the skill-150 tool tier to the reachable cap
- docs(professions): the tool-family reading amended for the re-tier

STEP 5 - ACCEPTANCE:
- [ ] Rows 117 to 120 executed as settled, with the phase report citing the state.md
      record rather than re-deciding anything
- [ ] The re-level scope was DERIVED (equippable outputs only), shared-def outputs skipped
      with the skip list recorded, and every touched output's new ilvl and requiredLevel
      predicted before observed
- [ ] Every re-leveled rung-50 output wearable at or before 16, rung-75 at or before 18,
      pinned by tests/crafted_wearability.test.ts and proven by mutation
- [ ] The level-20 shelf is byte-unmoved (apex, heroic, raid, vendor), pinned, so Phase 15
      inherits no re-measurement
- [ ] No stat, armor, dps or consumable magnitude moved anywhere, proven by sweep
- [ ] An unattuned character can gain engineering 0 to 25, and the attuned 0 to 75 climb
      needs no grandfathered tier-3 craft, both pinned by test
- [ ] The part is consumed by the chassis (ADDED row, gold-negative re-checked, the
      masterwork material-tier delta measured and recorded); the gadget honors R14 and R23
- [ ] Both new ids carry their full obligation set (R15 verdicts, parked art with one
      mapping owner, M16, wiki regen, append-only ordering)
- [ ] The three tool rows sit at skillReq 125; both header lessons amended in place with
      the date; every 150-literal pin re-derived predicted-then-observed;
      PRE_TRAINING_RECIPE_IDS untouched
- [ ] docs/design/professions.md's family reading amended, dated, R-numbers in full
- [ ] Full suite green; ci:changed clean; gate log read, not just its exit code

STEP 6 - DOCS: progress.md Phase 11o row; state.md ledger (rows 117 to 120 as EXECUTED,
the re-level table with predictions beside observations, the skip list, the on-ramp
identities with their naming verdicts, the chassis delta, the re-tier side-effect
measurements, and every re-derived pin); memory note for anything that surprised you.

STEP 7 - REPORT: phase status, files, validation results, reviewer verdicts, the
prediction-versus-observation table, and a one-line handoff for the Phase 11o QA session.

STOPPING RULES:
- The decisions are settled; STOP instead if this file and state.md rows 117 to 120
  disagree: that is doc drift, fixed before any edit.
- Stop if the requiredLevel derivation does not land the windows (it means the
  item_level_req mapping differs from the review's reading, and the re-level values need
  re-deriving from the real mapping, not forcing).
- Stop if any touched output turns out to be shared with a drop or vendor source beyond
  the known two: moving it would move a non-crafted gate.
- Stop if the level-20 shelf moves by ANY amount: that is an R5 interaction this phase is
  ruled not to have.
- Stop if the gadget cannot be authored inside R14 and R23 at once: the on-ramp does not
  ship a rule violation to fill a band.
- Stop if a new id's name cannot clear R15 verification: take the next candidate, never
  ship a working label.
```
