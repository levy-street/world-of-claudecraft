# Phase 11k: The provisioning capstone and prestige

### Starter Prompt
```
This is Phase 11k of the Masterwrought feature: the top of the provisioning arc, where
farming, fishing, and cooking meet the raid. It is the last phase of the 11-block and the
one that makes the packet's "every gathering skill feeds the craft economy" thesis true at
the cap rather than only in the low bands.

Model: xhigh effort. Harness: Claude Code. Worktree: ~/Documents/wocc-masterwrought
(branch feature/masterwrought). ULTRACODE: not needed for this phase.

Goal: five deliverables, none of which invents a new mechanic. (1) Three apex Harvest
Feasts at cooking 125, one per combat role, byte-identical bills, each serving the matching
SHIPPED apex role plate through the feast.dishItemId indirection farming already built, so
a serving IS the apex plate and re-tuning the plate re-tunes the feast. (2) harvest_feast
stays the party-tier rung below, AS 11f LEFT IT (recipe_harvest_feast at cooking 100,
acquisition ['drop']), untouched here: its diff in this phase is asserted EMPTY. The feast
ladder is then a real two-rung climb, the party feast at cooking 100 and the three apex
feasts at 125, and it coexists with The Laden Hearth, which shares a word with it and
nothing else. (3) Prestige for near-free, claimed exactly as far as it is TRUE: the feast is
rare-or-better so it rides the shipped craft-signing rule, and the placed entity carries the
PLACER's name, so when a cook places their own feast a raid sees whose feast it is in two
independent places with no new machinery. The signature lives on the item instance and the
placer's name lives on the entity, and the two coincide in that common case; carrying the
crafter's signature onto a feast placed by someone else is a recorded CUT (Agent 3).
(4) One cross-packet deed that cannot be earned
without touching both halves of the merged program. (5) One spoiler-safe wiki page telling
the provisioning story end to end.

WHY THIS PHASE IS LAST IN THE 11-BLOCK, so nobody re-sequences it:
- Its bill names content three earlier phases mint: the tier-4 fine twins (farming, absorbed
  at 11b), the seed faucet that makes tier-4 produce reachable, and the new high-band fish
  the fishing arm adds. Authoring the bill before those land means authoring against ids
  that do not exist.
- It is the packet's single strongest R20 contribution. FISHING has exactly ONE recipe at
  skillReq >= 75 today (recipe_tidewrought_fishing_rod, a fishing rod: fishing feeds only
  itself). This row is the first bill in the game where a fish leaves fishing and reaches
  the raid, and R20 is enforced by a test, so the row and the test must agree in one tree.
- Phase 15 seals the balance numbers. A new apex consumable changes real food uptime, which
  is an R5 input, so it lands before the measurement rather than after it.
- THIS PHASE IS THE SOLE MINTING PHASE FOR THE APEX FEASTS (settled 2026-08-20). 11h's GATE E
  was CUT: 11h lands the apex bills' REAGENTS and mints no item id at all, because every
  piece of machinery three placeable feasts need lives HERE (the placeFeastAction widening
  off the hard-coded FARM_FEAST_ITEM_ID, the three templateIds, the membership helper, and
  the four keyed sites). Minting them in 11h would have shipped three placeable entities no
  code could place, and at cooking 125 this phase's bill can take BOTH tier-4 fine twins and
  11i's new high-band catch, which is the packet's strongest masterwrought R20 statement.

WORKTREE GUARD (do this FIRST; the user runs multiple concurrent sessions): run pwd.
If you are not in /Users/fernando/Documents/wocc-masterwrought, switch this session into
it NOW with the EnterWorktree tool (path: /Users/fernando/Documents/wocc-masterwrought).
If EnterWorktree is unavailable or refuses, STOP and ask the user to relaunch Claude Code
from that directory. Phase work never runs from the main checkout at
~/Documents/world-of-claudecraft.

STEP 0 - PRE-FLIGHT (canonical Team Workflow, docs/prd/masterwrought/implementation-plan.md):
- git status clean, with the preceding 11-block phase and its QA CLOSED. This phase appends
  to tables (deeds, patterns, the marks vendor, the recipe arrays, ITEM_ART_PENDING) that
  every earlier 11-phase also appended to, so a dropped row found after 11k is
  indistinguishable from an 11k authoring bug.
- SYNC RELEASE: git fetch origin --prune, discover the newest release branch by version sort
  (git branch -r | grep 'origin/release/' | sort -V | tail -1), merge it, run the
  release-merge-audit skill. A minor-version-or-more jump runs as its own phase first.
- CONFIRM THE PREREQUISITE CONTENT EXISTS on the merged tree before the fan-out starts, by
  reading the tree and not by trusting this file or any ledger row: the tier 3 and 4 seeds
  are vendor-stocked (read the merged vendorItems arrays on farmer_hollis and farmer_verbena
  IN CODE; the faucet ruling of 2026-08-20 makes 11e stock EIGHT rows and forbids every
  downstream phase from treating a ledger row as proof), fine_gilded_sunmelon and
  fine_evergarden_greens exist and are reachable, and the fishing arm's new high-band catch
  exists with a real id and a real sellValue. If the fish is missing, that is a STOPPING RULE
  below, not a substitution.
- DECISIONS SETTLED 2026-08-20 (THE FULL DELEGATION). All FIVE decisions that once gated this
  phase are ANSWERED. Nothing below is confirmed with the maintainer: the phase EXECUTES
  these rulings. Read them, and the "Decisions closed 2026-08-20 (the full delegation)"
  section of docs/prd/masterwrought/state.md, BEFORE writing any code. A disagreement between
  that record and this file is a STOP and a ledger line, never a fresh decision.
  - Decision K1, SETTLED (the placed-entity identity). MINT THREE new templateIds, one per
    role, all drawn with the SHIPPED farm_feast prop, all reached through ONE exported
    membership helper in src/sim/professions/feast.ts. Re-point all four keyed sites to that
    helper: src/ui/entity_display_name.ts, src/render/farm_patches.ts (the applyFeasts filter
    AND the shadow-cap sweep), src/game/feast_interact.ts, and the contract comment in
    src/render/quest_objects.ts. After this change nothing may key on a bare string literal.
    Three new title keys land in the farming block of src/ui/i18n.catalog/hud_chrome.ts with
    their M16 fills.
    WHY: the placed title is composed client-side off templateId and reads "{name}'s Harvest
    Feast" for farm_feast, so reusing it labels an apex feast as the rung below it, and one
    helper is what makes a fifth feast impossible to half-wire across four keyed sites.
    REJECTED: one shared apex templateId (the role vanishes from the title, so a raider must
    inspect the entity to learn which plate is on the table); reusing 'farm_feast' outright
    (it mislabels the apex tier).
  - Decision K2, SETTLED (the output quality and price point). Quality is 'epic', matching the
    skill-125 capstone rung and the epic pattern that teaches it. The sellValue is DERIVED,
    against a binding ACCEPTANCE CRITERION rather than a number pasted from this file:
    strictly above 250 (harvest_feast, the rare party rung) and strictly below 380
    (laden_hearth, the epic permanent station), at a granularity the catalog already uses (a
    multiple of 10), and gold-negative against the MERGED bill with the arithmetic printed at
    the row. Quality stays rare-or-better whatever else moves, because deliverable 3's
    craft-signing prestige rides that threshold.
    WHY: both bounds are shipped points and the reasoning between them is structural, an apex
    feast being a rung above the party feast and consumed where the Hearth is permanent; the
    bill is not authored yet, so the gold-negative half genuinely cannot be computed until
    the row exists.
    REJECTED: a new price point outside those bounds, and any value not reached from the
    merged sellValue table.
  - Decision K3, SETTLED (the storefront achievement mapping). NO storefront entry. This is a
    CUT, recorded ONCE at packet level rather than per deed: it covers every deed this packet
    adds (the 13 absorbed farming deeds, 11e's roster deed, 11i's rod-craft deed, and this
    phase's prog_field_to_feast). No ACHIEVEMENT_MAP row in server/steam/ or server/epic/,
    the tests/epic_achievement_map.test.ts pins STAY at 84 against MAX_EPIC_ACHIEVEMENTS 100,
    and privacy-security-review is NOT triggered by this phase. Phase 16 writes the
    packet-level record; this phase writes the pointer to it in its own ledger.
    WHY: the launch set is a curated list rather than a mirror of the catalog, and these are
    untitled cosmetic rows, so mapping them spends curated headroom on the least
    storefront-worthy entries; the exhaustive-coverage arm is scoped to col_reliquary_* deeds,
    so an unmapped deed goes green silently and only the written record catches it.
    REJECTED: mapping the deed (it spends one of the remaining headroom slots and drags
    server/ into a content phase); saying nothing (silence is not available under the
    delivery contract).
  - Decision K4, SETTLED (the one-live-feast-per-placer rule). KEEP it exactly as shipped and
    TIER-AGNOSTIC, and PIN that reading in BOTH directions: a cook holding an apex feast and
    a harvest_feast can place only one, in either order.
    WHY: feast.ts sweeps ctx.feasts by ownerKey, so tier-agnostic is what the code already
    does, and pinning it turns an accident into a decision.
    REJECTED: one live feast per tier (it needs a second key on the sweep and doubles the
    live entity bound per player, which drags FEAST_SHADOW_CAP and the 1 Hz despawn sweep
    into a content phase).
  - Decision K5, SETTLED (charges and duration). Take the shipped harvest_feast values:
    charges 10, durationTicks 3600.
    WHY: the phase thesis is that nothing is invented and the only differences from the rung
    below are the tier, the dish and the bill; feast.ts's per-player ledger, its 1 Hz despawn
    sweep and FEAST_SHADOW_CAP were all built for these numbers, and feast uptime is an R5
    input Phase 15 owns.
    REJECTED: raid-scale charges (refused, not deferred: it drags a perf read into a content
    phase and moves an R5 input out from under Phase 15).
- Memory scan (MEMORY.md index): new-item-content-hidden-obligations (EVERY new item id owes
  WebP art AND non-Latin name fills in the same change), item-art-ownership-batch-xor-entries,
  the test-pin trap index (READ before touching any pin: predicted-then-observed,
  constant-self-comparison, comment-gameable source pins, vitest -t is a regex), the i18n
  reword-staleness entry, m16-wordy-english-requires-nonlatin-fills, and release-merge gate
  surprises.

STEP 1 - LOAD CONTEXT (Explore agent; do not read planning docs in the main loop):
- docs/prd/masterwrought/state.md (R8, R13, R14, R15, R17, R18, R19, R20; the naming registry
  INCLUDING its "Rejected for collisions" row, which already carries Grand Banquet; the Phase
  10 apex-consumable ledger; the Phase 11 pattern and Heroic Quartermaster ledger; the
  validation matrix; and the ledger row of whichever phase last moved the deed totals).
- docs/prd/masterwrought/farming/state.md (D8, D11, D13, D16, D17, D21, D24; the MAINTAINER
  GATES block, whose rows the 2026-08-20 delegation closed and which now point at that
  record; and the OPEN items list, which is the packet's ONE open-item collection point, so
  read what is still genuinely open rather than what was open when this file was written).
  Plus progress.md's Phase 11k row and decisions-index.md.
- Sim: src/sim/professions/feast.ts WHOLE (FARM_FEAST_ITEM_ID, FARM_FEAST_TEMPLATE_ID,
  FeastState, feastOwnerKey, placeFeastAction with its gate order and its lock-aware
  per-copy spend, consumeFeastAction, the 1 Hz despawn sweep, and the two teardown rosters:
  instanceAt(...).objectIds for a claimed dungeon instance and delveRunForPlayer(...).objectIds
  for a delve run, both of which exist because the entity outlived its room without them);
  src/sim/items.ts useItem (the `if (def.feast)` route, which is ALREADY generic on the def);
  src/sim/professions/crafting.ts (the craft-credit arm where ctx.markVisited writes
  craft_rare and the masterwork marks, and the rare-or-better craft-signing rule at
  ctx.addItemInstance); src/sim/deeds.ts (VISITED_MARK_NAMESPACES and restoreDeedStats).
- Content: src/sim/content/recipes.ts (APEX_CONSUMABLE_RECIPES and its header, which today
  says "The two skill-125 CAPSTONE rungs sit at the end" and states the uniform-bill and
  gold-negative rules; the three role plates recipe_stonepot_stew / recipe_warspice_skewers /
  recipe_sageleaf_chowder and their identical bills; recipe_seasoned_stock;
  recipe_harvest_feast); profession_items.ts (the three role plates, harvest_feast, and the
  foodHp ceiling header); items.ts (wyrmfall_core, the fine twins, the raw fish);
  apex_patterns.ts (the pattern_<output item id> contract and cooking's "Recipe:" prefix);
  heroic_vendor.ts (HEROIC_VENDOR_STOCK, the 12-marks skill-100 rung and the 16-marks
  skill-125 capstone rung); deeds.ts (the append-only tail and the visit-trigger shape).
- UI, render, game: src/ui/entity_display_name.ts, src/ui/i18n.catalog/hud_chrome.ts (the
  farming block with feastTitle and its comment), src/ui/feast_tooltip_view.ts,
  src/render/farm_patches.ts (the templateId filter, FEAST_HEIGHT, FEAST_SHADOW_CAP),
  src/render/quest_objects.ts (the no-item pick proxy and its farm_feast contract comment),
  src/game/feast_interact.ts (the templateId scan).
- Guide: src/guide/pages/professions.ts (the dispatcher's titleFor and render arms plus the
  'economy' and 'faq' fixed pages), professions_economy.ts as the shape precedent,
  src/guide/routes.ts, src/guide/head.ts (canonicalization off GUIDE_PROF_PAGES),
  scripts/wiki/build_content.mjs (the profPages array), scripts/build_sitemap.mjs (the
  professions deep-path loop), src/ui/i18n.catalog/guide.ts.
- Tests that will move: recipe_economy, heroic_vendor, apex_pattern_items, deeds_content,
  professions_feast, feast_online, feast_interact, entity_display_name, farm_patches_adapter,
  farm_patches_core, item_icons, missing_painted_icons_wave, shipped_item_ids, guide,
  epic_achievement_map, and whichever suite the R20 band-coverage test lives in.
Return: the MERGED sellValue of every reagent named below (seasoned_stock, wyrmfall_core,
both fine twins, the new high-band fish); the shipped harvest_feast def and recipe verbatim;
the exact FeastState and feast payload field names; every site that reads
FARM_FEAST_TEMPLATE_ID or FARM_FEAST_ITEM_ID; the current HEROIC_VENDOR_STOCK length and the
PATTERN_PRICES literal; the current DEED_ORDER length, summed renown, tail id, and
FROZEN_CATALOG_SHA256; and the current GUIDE_PROF_PAGES tail.

STEP 2 - EXECUTE (parallel fan-out, explicitly; five agents by vertical slice):

Agent 1 (THE PLACEABLE APEX TIER: the sim seam, and the only real code in this phase):
- placeFeastAction today hard-codes ONE item: `const def = ITEMS[FARM_FEAST_ITEM_ID]` and
  every count, selection, and spend below it names that same constant. useItem already routes
  generically on `if (def.feast)`, so the ONLY thing standing between the shipped action and
  four placeable feasts is that constant. Thread the item id through the action and read
  `ITEMS[itemId].feast`, changing nothing else about the gate order, the tri-state
  item_copy_ref selection, the lock-aware spend, or the refusal reasons. This is a widening
  of an existing action from one authored id to a small authored set. It is NOT a new wire
  arm, NOT a new command, and NOT a new interaction surface.
- THE DEDICATED COMMAND KEEPS ITS MEANING. src/net/online.ts sends `{ cmd: 'place_feast' }`
  with no item id, and server/farming_commands.ts and server/game.ts route it. Leave that
  command's default at FARM_FEAST_ITEM_ID so no wire field moves, and PIN it: a bare
  place_feast still places harvest_feast and can never place an apex feast. The apex feasts
  reach the ground through the use_item path, which already carries the clicked slot, so the
  clicked copy is the one spent.
- ONE TEMPLATE FAMILY, per decision K1. Export the membership from feast.ts (the shipped
  FARM_FEAST_TEMPLATE_ID stays, joined by the apex ids and one helper the four keyed sites
  import), then re-point all four: src/ui/entity_display_name.ts, src/render/farm_patches.ts
  (both the applyFeasts filter and the shadow-cap sweep), src/game/feast_interact.ts, and the
  contract comment in src/render/quest_objects.ts. Nothing may key on a bare string literal
  after this change; the helper is the single source, so a fifth feast cannot be half-wired.
- THE TEARDOWN CLASS IS INHERITED, NOT REWRITTEN, and this is the highest-risk detail in the
  slice. The shipped placement registers the entity on TWO rosters (a claimed dungeon
  instance's objectIds and the placer's delve run's objectIds) precisely because without them
  the table outlived the room and stood there, still edible, for the next claiming party. The
  generalization must keep every apex feast on the SAME code path, and the acceptance asserts
  it by behavior: place an apex feast inside a claimed instance, free the instance, and the
  entity, the FeastState, and the placer's one-active slot are all reclaimed. Same for a
  delve run, including the module-advance drop.
- The respawnTimer Infinity sentinel, the lootable-false object contract, and the
  objectItemId null contract are inherited verbatim. If any apex feast reaches the ground by
  a path that does not set all three, the object-respawn sweep re-arms it and the generic
  object arm eats the interact press. Pin all three on an apex feast, not only on
  harvest_feast.
- Decision K4 as ruled: the one-live-feast-per-placer sweep stays tier-agnostic. Pin it in
  both directions (an apex placement while a harvest_feast stands is refused, and the
  reverse), so the reading is deliberate.
- DRAW CONTRACT UNCHANGED: this module draws ZERO rng today and must draw zero after. If any
  part of this slice appears to need a draw, that is a STOP.

Agent 2 (THE THREE FEASTS, THEIR BILLS, AND THE MARKS CHANNEL):
- Three items, kind 'junk', carrying ItemDef.feast on OtherItemDef (11b's port put it there;
  it cannot sit on BaseItemDef, which is what FoodItemDef's own doc comment forbids one field
  over, and OtherItemDef is the only union member admitting kind 'junk'). Each
  feast.dishItemId points at a DIFFERENT shipped apex role plate: stonepot_stew (buff_sta),
  warspice_skewers (buff_ap), sageleaf_chowder (buff_int), each at whatever 11c settled them
  to. A serving IS the apex plate, so the feast can never drift from the bagged plate and
  re-tuning the plate re-tunes the feast. These mint NO aura of their own and touch no aura
  id. charges 10 and durationTicks 3600 per decision K5, quality 'epic' per decision K2.
- Three recipes appended to APEX_CONSUMABLE_RECIPES: cooking, skillReq 125 (the capstone
  rung, beside recipe_grand_cauldron and recipe_laden_hearth), acquisition ['drop'] (R8),
  stationType 'kitchens' so the per-craft wiki station field stays unanimous, resultCount 1
  (the shipped feast precedent), itemLevelBudget feeding only the craft gold fee. The three
  bills are BYTE-IDENTICAL to each other, which is the array header's own rule: a role choice
  is never also an economy choice.
- THE HEADER IS NOW FALSE and must be reworded in the same change: it says "The two skill-125
  CAPSTONE rungs sit at the end". Reword it to name the capstone FAMILIES (the two mobile
  stations plus the three apex feasts) rather than a count that rots, per the anchor rule.
- THE BILL: seasoned_stock, 1 wyrmfall_core, fine_gilded_sunmelon, fine_evergarden_greens,
  and the fishing arm's new high-band catch. All three provisioning skills meet here, which
  is the whole point of the row.
- COUNTS ARE DERIVED, NOT PICKED, and the derivation is printed beside the row.
  - seasoned_stock: the CAPSTONE idiom is THREE of the craft's own intermediate
    (recipe_laden_hearth and recipe_grand_cauldron both use 3); the skill-100 consumable idiom
    is ONE (the three role plates). These rows sit at 125, so they take the capstone idiom.
    Do not invent a third number; record which precedent was taken.
  - wyrmfall_core: 1, per the maintainer's ruling, and the row records the comparison rather
    than hiding it: the two shipped capstones take 2, and the feast takes 1 because a feast
    is spent per raid night while a station is permanent. The core is the deliberate rate
    limiter and it lives OUTSIDE the farm (R9: A and S rift first clears, once per character
    per day, tradable), so NO farming daily is ever minted and a farmer with no rift access
    buys cores on the market.
  - The two fine twins: derive from the shipped recipe_harvest_feast bill (gilded_sunmelon x4
    plus evergarden_greens x4) under the fine-grade value rule (a fine twin sells for twice
    its base produce: fine_gilded_sunmelon 80 against gilded_sunmelon 40), so the
    value-equivalent count is half the base count. This is also what finally gives the two
    tier-4 fine twins a consumer. The stale items.ts comments claiming a tier-4 twin is
    structurally never a hoe reagent have ONE owner and it is 11h (settled 2026-08-20, since
    11h runs first and its own apex bill falsifies the same sentence): VERIFY they are
    already corrected on the merged tree and do NOT re-correct them here. If they are somehow
    still stale, correct them and record that 11h missed it.
  - The high-band fish: derive its count the same way, against the raw-catch counts cooking's
    own shipped bills already use, off the MERGED sellValue table. Read every value; carry no
    number from either parent branch.
- GOLD-NEGATIVE WITH THE ARITHMETIC PRINTED: summed reagent unit value times count must
  exceed resultCount times output sellValue, where unit value is buyValue when finite and
  positive, else sellValue (the shipped convention). Work it against the real merged numbers
  (on the tips read for this file: seasoned_stock 30, wyrmfall_core 50, each fine twin 80,
  plus the fish) and DERIVE the output sellValue inside decision K2's binding window: strictly
  above 250, strictly below 380, a multiple of 10, and gold-negative against this bill with
  the arithmetic printed at the row. A value outside that window, or one that cannot be
  reached from the merged sellValue table, is a STOP and not a judgment call. Flag every
  derived value maintainer-facing at its row, the way farming flags each tuning constant at
  its definition.
- PATTERNS AND CHANNEL per R8 on the shipped machinery: three defs in apex_patterns.ts under
  the pattern_<output item id> contract, kind 'recipe', quality 'epic', sellValue 100,
  teachesRecipeId, names on cooking's "Recipe:" prefix. Three HEROIC_VENDOR_STOCK rows at the
  CAPSTONE marks price the two shipped skill-125 cooking and alchemy rows occupy (16), not
  the skill-100 price (12). Re-derive both moved pins rather than editing a literal by hand:
  HEROIC_VENDOR_STOCK.length and the vendor-view row-count pin each move by exactly three,
  and the PATTERN_PRICES literal in tests/heroic_vendor.test.ts gains exactly three rows all
  at 16. Its test title names a count and a split ("exactly the eight apex consumable
  patterns, six at 12 and two at 16"); that title is a rotting anchor, so REWORD it to state
  the rule (every skill-100 pattern at 12, every skill-125 pattern at 16) and derive the
  numbers from the table.
- THE ECONOMY RE-DERIVATION, and the reason it is called out separately:
  tests/recipe_economy.test.ts is edited by BOTH packets and carries sorted literal pins (the
  intermediate-bill literal table and the counterfactually-vendor-fed membership list). BOTH
  are RECOMPUTED from the merged ALL_RECIPES and NEVER hand-merged: a resolution that keeps
  one side's literal goes green while silently deleting the other side's guard. The
  non-vacuity floor beneath the membership pin stays and moves with the set. Confirm the new
  rows stay OUT of the vendor-fed set (the fine twins and the core carry no buyValue, so they
  cannot be bought into existence at a counter).
- R17 AND R18, asserted rather than intended: no farm produce reaches
  recipe_quickening_catalyst (the packet's one pacing gate) or any gear intermediate (billet,
  plating, cording, bolt, setting, chassis); the produce rows in this bill are ADDED
  alongside the herb and meat families rather than substituted for them, so herbalism loses
  nothing (D24's displacement guardrail); and every produce item stays kind 'junk' and
  market-listable, so a raider who farms nothing buys the twins on the market exactly as they
  buy sunpetal_herb today. Write these as tests.
- R20: this row is the fishing arm's endgame bill. Re-run the band-coverage test with these
  rows counted and confirm fishing is present at skillReq >= 100 through a bill that is NOT a
  fishing rod.
- NAMES: the DIRECTION is settled 2026-08-20, the VERDICTS are still derived and no name is
  typed before its verdict exists. DERIVE each apex feast's name by compounding the SHIPPED
  apex plate name it serves (Stonepot, Warspice, Sageleaf) with one table or gathering word,
  so the role is legible from the placed title BY CONSTRUCTION and the phase coins no new
  proper noun at all: only the shared table word needs web verification, once, instead of
  three times. Role legibility is a functional requirement and not flavor, because decision
  K1 puts the name in the placed entity's title and that title is how a raider standing at
  the table knows which plate is on it. Check the state.md naming registry INCLUDING its
  rejected-for-collisions row FIRST (Grand Banquet is already rejected), web-verify the
  shared word at authoring against the major game wikis, put the verdict in naming-audit.md,
  and put the accepted names in the registry. The 11c vocabulary ruling binds and is what
  makes the word available: "feast" names only the real placed-entity mechanic, so THESE
  names may use it and The Laden Hearth's copy may not. If 11c's reword has not landed, these
  names wait.

Agent 3 (PRESTIGE, THE TITLES, AND THE TOOLTIPS):
- PRESTIGE IS NEAR-FREE AND IT IS FREE IN TWO INDEPENDENT PLACES. Verify both on the merged
  tree and PIN both; do not build either.
  - The CRAFTER's name: professions/crafting.ts stamps any output whose DEF quality is
    rare-or-better with its crafter's name via ctx.addItemInstance (the same signable-rarity
    threshold gathering.ts's harvestCorpse uses for monster materials). Decision K2 keeps the
    feast above that threshold, so the crafted copy is signed the day it exists. Assert the
    threshold with a test rather than assuming it.
  - The PLACER's name: the shipped placement already builds the entity with
    createGroundObject(..., meta.name, ...), carrying the placer's raw name as a VALUE, and
    the client composes the localized title around it. That is what makes "a raid that eats
    at a feast sees whose feast it is" literally true with zero new machinery, and it is the
    packet's answer to a capstone that is a ROLE rather than a stat.
  - THE CUT IS SETTLED 2026-08-20, and it is a CUT rather than a later item: the crafter's
    signature is NOT carried onto a feast placed by someone else. It would need a new
    FeastState field and a new wire field, which is a cross-platform change
    (cross-platform-sync dispatch) for a case that arises only when a cook sells a feast and
    a stranger places it. RECORD THE SEAM HONESTLY in the ledger and NARROW deliverable 3's
    prestige claim in the same change to what is actually true: the signature lives on the
    item instance, the placer's name lives on the entity, and the two coincide when a cook
    places their own feast. Shipping the broad claim while cutting the mechanism would leave
    a false sentence in the record.
- THE TITLES, per decision K1. src/ui/entity_display_name.ts today has one templateId arm; it
  becomes a lookup from the template family Agent 1 exported to its title key. Add the keys
  in the farming block of src/ui/i18n.catalog/hud_chrome.ts beside feastTitle, in the same
  "{name}'s <Feast Name>" shape, and update the block comment above them, which today
  reasons about exactly one template. English only per the contributor rule; wordy values owe
  their M16 non-Latin fills in THIS change. The existing feastTitle row is NOT reworded, so
  no filled locale row goes stale here.
- tests/entity_display_name.test.ts gains one case per apex template, asserting the composed
  title and that the raw wire name is never translated (the i18n invariant: the text is the
  key, the name is the value).
- THE FEAST TOOLTIP: src/ui/feast_tooltip_view.ts reads the dish def off feast.dishItemId, so
  every apex feast renders its plate's real effect with no view change. VERIFY that on the
  merged tree and pin one apex feast's tooltip against the matching bagged plate's, per
  docs/design/tooltip-writing.md (resolved values, live mechanic, stated limits: charges, the
  duration, one bite per player).
- The well-fed exclusivity story is 11c's and is not re-opened: one aura id, last eaten wins,
  so eating from an apex feast after a harvest_feast replaces rather than stacks. Pin that
  once here, because this phase is the first time two feasts of different tiers can stand in
  the same room.

Agent 4 (THE CROSS-PACKET DEED):
- One deed, prog_field_to_feast, category 'progression', renown 5, NO title, no border,
  granted on the first completed apex feast craft. It cannot be earned without touching both
  halves of the merged program, because the bill names farm produce AND a Wyrmfall Core AND a
  fishing catch. Cosmetic with zero rng, satisfying D13, docs/design/deeds.md, and the
  CLAUDE.md deeds obligation. No power, ever.
- Trigger: the shipped { kind: 'visit', markId: ... } family, written at the SAME craft-credit
  arm in professions/crafting.ts that already writes craft_rare and the masterwork marks. The
  markId interpolation must be BOUNDED by the authored recipe set exactly as craft_rare's is
  (an unbounded key source writes permanent ledger noise nothing can read back).
- THE TRAP, already bitten twice in this codebase with the bug written into the file's own
  comments: a mark whose namespace is not in VISITED_MARK_NAMESPACES (src/sim/deeds.ts)
  serializes fine and is DROPPED ON LOAD, so the deed can never refill. Register the
  namespace with its own comment saying why, and pin the save/load round trip asserting the
  mark SURVIVES, not merely that it was written.
- APPEND under the ordering rule 11b established and 11d re-derived against: release rows
  first, masterwrought's committed rows next with positions frozen, farming's block last and
  contiguous, then the 11-block's own appends in phase order. This deed appends at the tail,
  so DEED_ORDER[len - 1] and the tail pin in tests/deeds_content.test.ts move with it.
- RE-PIN THE TOTALS BY PREDICTION, NEVER BY PASTE, and this is the method that distinguishes
  a legitimate append from a lost row: read the deed count and the summed renown the
  immediately preceding phase's state.md ledger recorded, predict base plus this phase's
  delta (exactly one deed, exactly its renown), run the suite, and REQUIRE observed equals
  predicted. If they disagree, an earlier row was lost or double-counted and that is the
  finding, not a pin to update. DEED_IMAGE_IDS, the deed_i18n manifest, and
  BOOK_COMPLETE_REQUIREMENTS move by the same method; BOOK_COMPLETE_REQUIREMENTS grows by one
  by construction, which is correct precisely because the deed is earnable. The untitled deed
  may ride DEED_ART_PENDING (a title-bearing deed may never trail its art; this one has no
  title).
- FROZEN_CATALOG_SHA256 in tests/deeds_content.test.ts re-baselines on any append, which its
  own comment permits. Do it the auditable way: reconstruct the PRE-append row list, confirm
  it reproduces the existing digest exactly, then re-mint with the one appended tuple and
  record in the comment which deed appended and that no shipped trigger or renown changed. A
  re-mint without that reconstruction cannot tell an append from an edit.
- Decision K3 as ruled and SETTLED: NO ACHIEVEMENT_MAP row, in server/steam/ or server/epic/.
  The tests/epic_achievement_map.test.ts pins do NOT move (they stay at 84 against
  MAX_EPIC_ACHIEVEMENTS 100), no server/ file is touched by this deed, and
  privacy-security-review is not triggered. The CUT is recorded ONCE at packet level and
  covers every deed this packet adds, so this phase writes the POINTER to that record in its
  ledger rather than a per-deed reason, and Phase 16 writes the packet-level record itself.
  Silence is still not an option: the pointer IS the record here, because the
  exhaustive-coverage arm is scoped to col_reliquary_* deeds and an unmapped deed goes green
  in silence.

Agent 5 (THE PROVISIONING STORY IN THE WIKI):
- One new spoiler-safe detail page at /wiki/professions/provisioning, explaining how the
  gathering lines feed the raid: what each line contributes (farm produce, fishing catches,
  herbs, and corpse-harvest meat), where they converge in cooking, and how the ladder reads
  from levelling dishes up through the role plates to the party feast at cooking 100 and the
  three apex feasts above it. This is the page that makes the packet's thesis legible to a
  player.
- THE SEAM, which already exists: 'provisioning' joins 'economy' and 'faq' in the profPages
  array in scripts/wiki/build_content.mjs, which generates GUIDE_PROF_PAGES; the sitemap loop
  in scripts/build_sitemap.mjs and the head canonicalization in src/guide/head.ts both read
  that constant, so both come free. Add the dispatcher arms (titleFor and render) in
  src/guide/pages/professions.ts and the page module itself in
  src/guide/pages/professions_provisioning.ts, on the professions_economy.ts shape.
- NEVER HAND-LIST CONTENT. Every id, count, and number the page shows comes from the
  GUIDE_PROF_* generated data (regenerated with npm run wiki:content), and every sentence
  comes from a guide.* t() key in src/ui/i18n.catalog/guide.ts. A hand-listed reagent list
  goes stale the first time a bill moves; a generated table cannot.
- SPOILER-SAFE means the shipped guide vocabulary and nothing more: reuse the existing source
  cells (guide.profPages.sourceDrop, sourceVendor, sourceKnown) for how a pattern is
  acquired, and name no drop table, no boss, and no instance. The professions pages publish
  EXACT numbers under the transparency policy, so real skill gates and real counts are
  correct and expected here; instanced spoilers are not.
- The GUIDE_PROF_PAGES pin in tests/guide.test.ts gains the row (derived from the generated
  data, not retyped), and the "renders every detail page with exactly one h1 and real
  generated tables" sweep covers the new page automatically the moment it is registered. Add
  one page-specific arm asserting the three gathering lines each appear with their real
  contribution, so an empty story section cannot pass.
- OWNERSHIP BOUNDARY: 11c owns the one guide reword that makes "feast" name only the real
  mechanic. Do not re-word the cooking route body here; link to it and stay consistent with
  it. If this page's prose contradicts it, that is a finding against this page.

INVARIANTS IN PLAY: R8 (apex recipes reach players through the pillars; these ride the Heroic
Marks valve); R13 (the capstone rung is 125 and maxSkill stays 125); R14 (no new proc
effects: these feasts mint an EXISTING aura and nothing else); R15 and D17 (every new proper
noun web-verified and registered before it is typed); R17 (farm produce feeds the CONSUMABLE
professions only, never the gear chain, the Perfecting materials, or
recipe_quickening_catalyst); R18 (produce stays market-listable kind 'junk'; rows are ADDED
beside herbs, never substituted; no profession is ever required to raid); R19 (nothing here
mints a farming daily, a reset, or a decay: the rate limiter is the Wyrmfall Core, outside the
farm); R20 (fishing reaches skillReq >= 100 through this bill, enforced by the test, not by
intention); D8 (no mid-growth interaction); D13 and docs/design/deeds.md (cosmetic,
append-only, zero Renown on luck-gated triggers); determinism (this phase adds NO rng draw;
if an agent believes it needs one, that is a STOP); sim purity (no DOM, Three, or ui import
under src/sim/); ids append-only (tests/shipped_item_ids.test.ts); i18n English-only catalog
rows in the matching domain with M16 non-Latin fills for wordy new names, any sim-emitted
player text getting its matcher rule in the same change (S3); no generated file hand-edited;
the three-tier ordering rule applied to every append-only table touched, including
src/ui/i18n.catalog/items.ts; the monolith ratchet (no ceiling raised for this phase's code,
extraction first); and THE R-NUMBER NAMESPACE RULE (settled 2026-08-20): every packet
R-number this phase writes into src/, server/, tests/ or a CLAUDE.md reads "masterwrought
R<n>" IN FULL, because a bare R-number in those files means the shipped Professions 2.0
series permanently (that series already occupies R1, R4, R8, R9, R14, R19, R22, R30, R35,
R37 and R39 to R50). A bare packet R-number in source is a finding at QA, not a nit.

CONTENT OBLIGATIONS, enumerated because these are the ones that get missed: six new item ids
(three feasts, three patterns), each owing committed WebP art or a row on the MERGED
ITEM_ART_PENDING allowlist with exactly ONE mapping.json owner (the batch-XOR rule; PARKING
IS SETTLED 2026-08-20, because committed art needs the maintainer's master SHA that no phase
session can produce: all six ids park on the MERGED allowlist with one owner each, and the
art wave runs on the maintainer's own schedule after the packet); M16 non-Latin fills for
wordy English names IN THIS CHANGE; the three new placed-entity title keys with their fills;
wiki regen via npm run wiki:content with tests/guide.test.ts freshness green; the Book of Deeds
record above with its totals re-derived; a Reliquary obligations sweep whose verdict is
SETTLED 2026-08-20 as NO PAGE (a consumable feast is not conquerable unique loot, which is
the Reliquary's whole admission rule, and the
packet already ruled at Phase 10 QA that crafted epic tools stay out on the same ground); the
sweep RUNS anyway and the verdict is written, because the content-obligations reviewer treats
an unwritten verdict as a gap; the economy-invariant recheck in
tests/recipe_economy.test.ts with both sorted literals RECOMPUTED; and nothing new in
src/ui/world_entity_i18n.ts, because the feast title is composed client-side off templateId
rather than read from the entity dictionary (confirm that on the merged tree; if 11b moved
it, follow it there).

REJECTION LIST, recorded so none of these is re-proposed, each with its reason:
- Converging the two feasts, or either feast with The Laden Hearth. The Hearth is kind 'tool',
  never consumed, a PlayerMeta scalar with no world entity, no render seam, and no wire
  object; a feast is a consumed one-shot that spawns a real entity with charges, a tick-domain
  expiry, and a per-player ledger. They are not substitutes, and converging them deletes a
  shipped skill-125 capstone to solve a vocabulary problem 11c already solved with one reword.
- A distinct apex feast prop. A new GLB is a full asset-pipeline item with fingerprint pins,
  and a feast reads by its title, its charges, and its buff, never by its mesh. The shipped
  farm_feast prop serves all four.
- A role-pick interaction at the table (one feast, choose your plate). It is a new interaction
  surface, a new wire arm, and a new refusal family, to replace something three items already
  express. The dishItemId indirection exists precisely so the role is authored, not chosen.
- Raid-scale charges by default. See decision K5: the ledger, the sweep, and the render
  shadow cap were all sized for the shipped numbers.
- A second oncePerDay recipe to pace the feast. The daily stamp is keyed per RECIPE ID, so a
  second row literally doubles the packet's one pacing gate. Mechanical refusal, not taste.
- Any power on the deed. Deeds are cosmetic (D13); a capstone that is a role rather than a
  stat is the entire design claim of deliverable 3, and paying it in stats refutes it.
- Differentiating the three apex feast bills. The array header's own rule is that a role
  choice is never also an economy choice, and the role here is carried by dishItemId. (11h's
  amended header differentiates the three bagged FOOD plates by exactly one crop row and
  leaves every other reagent identical; that amendment is scoped to the plates and does not
  reach these feast bills.)
- Minting the apex feasts in 11h. Settled 2026-08-20: 11h's GATE E is CUT, because every
  piece of machinery three placeable feasts need lives in this phase, and minting them there
  would ship three placeable entities no code could place.
- Splitting the storefront CUT into a per-deed decision. One packet-level record covers every
  deed this packet adds; sixteen copies of one reason is not a stronger record, it is a
  longer one.

Out of scope: any change to the well-fed ladder, the aura id, or the cooking route body (11c
owns them and they are settled; if this phase believes a magnitude is wrong, that is a STOP,
not an edit); harvest_feast's def, recipe, charges, dish, or price (11f owns its rung: it
sits at cooking 100 with acquisition ['drop'] and stays exactly as 11f left it, and THIS
phase's diff on it is asserted EMPTY); the tier 3 and 4 seed faucet and the farming gain
curve (their own phases); the
fishing catch ladder itself (the fishing arm's phase; this phase only CONSUMES its output);
the Perfecting stage (Phase 12); UI beauty work on any professions surface (Phase 14); the R5
envelope measurement (Phase 15); the merged icon and wiki enumeration sweep (Phase 16),
though the rows this phase creates land there.

STEP 3 - VALIDATION + REVIEW (matrix in implementation-plan.md):
npx tsc --noEmit; then npx vitest run tests/professions_feast.test.ts tests/feast_online.test.ts
tests/feast_interact.test.ts tests/entity_display_name.test.ts tests/farm_patches_adapter.test.ts
tests/farm_patches_core.test.ts tests/recipe_economy.test.ts tests/heroic_vendor.test.ts
tests/apex_pattern_items.test.ts tests/deeds_content.test.ts tests/epic_achievement_map.test.ts
tests/item_icons.test.ts tests/missing_painted_icons_wave.test.ts tests/shipped_item_ids.test.ts
tests/guide.test.ts tests/architecture.test.ts tests/localization_fixes.test.ts plus every new
suite and the R20 band-coverage suite. THEN the FULL suite (npx vitest run --maxWorkers=5)
before calling any review round done: a content phase at the end of an append-heavy block is
exactly the shape where census reds hide outside a curated battery. npm run ci:changed on the
touched files only. Read the gate LOG, not just its exit code: a printed FAIL marker overrides
a zero exit.
Review Dispatch Matrix rows to dispatch: content-obligations-reviewer (the whole content diff:
art, M16, wiki regen, deeds, Reliquary posture, ids append-only); architecture-reviewer (the
feast.ts widening, the template family, the crafting.ts mark site: sim behavior and the
SimContext seam); migration-safety (registering a deed mark namespace touches the
characters.state deserialize path, and an unregistered namespace is dropped on load);
frontend-seam-reviewer (entity_display_name.ts, farm_patches.ts, quest_objects.ts,
feast_interact.ts, and the guide page); cross-platform-sync ONLY if a SimEvent, wire field, or
matcher rule moved (the templateId VALUE set widening rides the existing entity snapshot and
is not itself a new wire field, so confirm before dispatching); qa-checklist when the
deliverable set is complete. Skip privacy-security-review and database-performance-reviewer:
decision K3 is settled as a CUT, so no server/ file and no SQL call site is touched by this
phase. Say so explicitly in the report rather than leaving the skip unstated. COVERAGE
prompts; apply ALL findings, blocking and should-fix and nits.

STEP 4 - COMMIT CADENCE (explicit paths, bodies, no session trailers):
- refactor(sim): place any feast def, not only the harvest feast
- feat(content): three apex harvest feasts, their patterns, and the marks vendor rows
- feat(ui): apex feast titles, and the craft signature pinned at its threshold
- feat(content): the field-to-feast deed and its craft mark
- feat(guide): the provisioning page, from the gathering lines to the raid
- test(content): re-derive the moved economy, vendor, deed, and guide pins

STEP 5 - ACCEPTANCE:
- [ ] All five settled decisions (K1 to K5) were read from the state.md "Decisions closed
      2026-08-20" record before any code edit, and that record agrees with this file
- [ ] Three apex feasts serve stonepot_stew, warspice_skewers, and sageleaf_chowder through
      feast.dishItemId; a serving mints an aura IDENTICAL to eating that plate from bags,
      proven in both directions and through the real tick path
- [ ] Bills byte-identical to each other; every count derived from a named shipped precedent;
      each row gold-negative with the arithmetic printed against MERGED sellValues
- [ ] NO new aura id, NO new proc effect, NO new wire arm, NO oncePerDay stamp, NO farming
      daily, NO rng draw added anywhere
- [ ] harvest_feast diff EMPTY IN THIS PHASE (def, recipe, charges, dish and price all
      untouched here; its cooking 100 rung and ['drop'] acquisition are 11f's and stay as 11f
      left them)
- [ ] The output sellValue is DERIVED inside decision K2's window (above 250, below 380, a
      multiple of 10) and is gold-negative against the merged bill with the arithmetic
      printed at the row
- [ ] placeFeastAction places any feast-carrying def; a bare place_feast command still places
      harvest_feast and nothing else, pinned
- [ ] The template family is reached through ONE exported helper at all four keyed sites; an
      apex feast placed in a claimed dungeon instance and in a delve run is torn down with the
      room, with the FeastState and the one-active slot reclaimed, asserted by behavior
- [ ] respawnTimer Infinity, lootable false, and objectItemId null all pinned on an apex feast
- [ ] Decision K4 pinned in both directions (tier-agnostic one-live-feast-per-placer)
- [ ] Craft signing pinned at its threshold; the placed entity carries the placer's name; the
      crafter-signature-on-someone-else's-table CUT is recorded with its reason, and
      deliverable 3's prestige claim was narrowed in the same change to what is true
- [ ] Three patterns on the pattern_<output item id> contract; three Heroic Quartermaster rows
      at the skill-125 marks rung; both length pins and PATTERN_PRICES re-derived and the
      count-naming test title reworded to state the rule
- [ ] Both recipe_economy sorted literals RECOMPUTED from the merged ALL_RECIPES with the
      non-vacuity floor intact; no produce in recipe_quickening_catalyst or any gear
      intermediate, asserted; the fine twins' stale hoe-reagent-only comments verified
      ALREADY CORRECTED by 11h and not re-corrected here
- [ ] masterwrought R20 re-run with these rows counted: fishing present at skillReq >= 100
      through a bill that is not a fishing rod
- [ ] prog_field_to_feast appended at the tail; mark namespace REGISTERED with its save/load
      survival pinned; deed totals reached by PREDICTION then observation, with the digest
      re-minted only after the pre-append reconstruction reproduced the prior value
- [ ] Decision K3 landed as the CUT: no ACHIEVEMENT_MAP row in either table, the
      epic_achievement_map pins unmoved at 84, no server/ file touched, and the ledger points
      at the packet-level CUT record rather than restating it
- [ ] /wiki/professions/provisioning renders from generated data and guide.* keys, is
      registered in profPages, and its GUIDE_PROF_PAGES pin is derived rather than retyped;
      wiki regen fresh; no drop table, boss, or instance named
- [ ] All six new item ids PARK on the merged allowlist with exactly one mapping owner
      (parking is settled; this packet commits no WebP art); M16 fills for wordy names; the
      three title keys filled; the settled Reliquary verdict written with the sweep run
- [ ] Every packet R-number this phase wrote into src/, server/ or tests/ reads
      "masterwrought R<n>" in full, with no bare packet R-number left in source
- [ ] Full suite green; ci:changed clean; gate log read, not just its exit code

STEP 6 - DOCS: progress.md Phase 11k row; state.md ledger (the five decisions as EXECUTED,
each pointing at the 2026-08-20 delegation record rather than restating it, the
three feast names with their R15 verdicts, every bill count with its derivation and the printed
gold-negative arithmetic, the output price point and its derivation, the template family and
its four keyed sites, the two prestige seams and the one CUT between them, the deed with its
mark and namespace, the predicted-versus-observed totals table, the storefront verdict, the
Reliquary verdict, and the rejection list as recorded design); farming/state.md's OPEN list
updated in place if a row closed here (the tier-4 fine-twin consumer question closes with this
bill); brainstorm.md if any scope line is owed; memory note for anything that surprised you.

STEP 7 - REPORT: phase status, files, validation results, reviewer verdicts, the re-derived pin
table (predicted versus observed per pin), and the handoff line for Phase 11k QA.

STOPPING RULES: stop if the state.md record of the 2026-08-20 delegation disagrees with any
of the five settled decisions in this file, or if that record is missing when the fan-out
would start (either is a records defect and a ledger line, never a fresh decision); if the
fishing arm's high-band catch is not on the merged tree (the bill cannot name an
id that does not exist, and substituting a shipped low-band fish silently retires the R20
contribution this row exists to make); if placing an apex feast cannot be expressed without
adding a wire field, a command arm, or an rng draw; if a bill cannot be made gold-negative
without a sellValue inside decision K2's window; if the teardown rosters cannot be inherited
without forking the placement path; if the deed totals disagree with the prediction
(that is a lost or double-counted row, and it is a finding, not a pin to update); or if the
release merge conflicts inside src/sim/professions/feast.ts, src/sim/content/recipes.ts,
src/sim/content/deeds.ts, or tests/recipe_economy.test.ts.
```
