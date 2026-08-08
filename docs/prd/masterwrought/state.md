# Masterwrought: cross-phase state

Current phase: 04 COMPLETE (materials backbone, 2026-08-08; the three chase materials, faucets, gates, extraction, persistence, see the Phase 04 ledger); next is phase 04 QA (phase-04-qa.md). Packet authored 2026-08-07.
Branch: `feature/masterwrought` (worktree `~/Documents/wocc-masterwrought`), based on `origin/release/v0.36.0`.

## Delivery contract (non-negotiable)
- The ENTIRE system ships in ONE branch and ONE PR from `feature/masterwrought`. There are
  no follow-up PRs: an item is either in this packet or explicitly CUT, never "deferred to
  a future PR". Future-content ideas (orange unique effects, next-tier upgrade chains that
  consume this tier's pieces) are recorded in brainstorm.md as future-tier design intent,
  NOT deliverables of this packet.
- Every phase STARTS by syncing the latest release branch: `git fetch origin`, merge the
  newest `origin/release/**` into `feature/masterwrought`, then run the
  `release-merge-audit` skill on the merge before any phase work.
- All ten crafting professions receive equal-shape content: one intermediate (skill 75),
  three apex products (skill 100), one capstone role (skill 125). Parity is equal prestige
  and economic role through DISTINCT levers, never identical mechanics or identical power.

## Locked design rulings (settled with the maintainer 2026-08-07; do not re-litigate)
1. R1 The above-raid step is the PERFECTING STAGE (fork B): a deliberate upgrade performed
   on an existing apex piece, consuming 1 Maker's Ember + Sundered Essence + 1 Prismglass
   Setting per attempt (registry name amended by the Phase 03 audit; same material). It
   BINDS the piece, is fail-forward only (failure consumes materials, never harms or
   downgrades the piece), and the existing craft-time masterwork
   proc on an apex craft grants a head start on the stage instead of a quality bump.
   `src/sim/professions/masterwork.ts` and its locked constants are NOT modified.
2. R2 Base apex pieces are freely tradable. A piece binds at the moment Perfecting begins.
3. R3 Orange is prestige and process only in v1: unique name via Deed of Making, distinct
   visuals, crafter signature, deed credit. No unique combat effects. Sub-cap: at most ONE
   legendary-quality crafted piece equipped, inside the global cap.
4. R4 Keystone: "Maker's Ember", soulbound, 1 per week per character, BANKABLE (missed
   weeks accrue), earnable from any endgame pillar (raid, heroic five-mans, rifts).
5. R5 Power envelope: full kit (2 Perfected pieces + apex enchants + flask + food) at most
   5 percent total throughput over pre-packet raid BiS, measured via
   `docs/design/spell-balance-framework.md` before merge. Heroic raid and S-rift clear
   difficulty is the protected asset.
6. R6 A two-hander consumes ONE of the two Masterwrought cap slots.
7. R7 Boots enchant is stats only. No movement speed in v1 (rift racing).
8. R8 Recipe channels: raid and rift patterns are tradable drops (bind on learn); heroic
   five-man patterns are sold deterministically for Heroic Marks (the day-one catch-up
   valve).
9. R9 Rift core faucet: Wyrmfall Cores from A and S rank first clears, once per character
   per day (rifts have no lockout; this is the cap).
10. R10 Jewelcrafting and inscription get their BASE catalogs (0 to 50) inside this packet,
    before their apex content.
11. R11 Explicit ruling supersedes the "masterwork stays below the raid band" design intent
    for the Perfecting stage ONLY; the shipped masterwork proc math is untouched. Recorded
    here as the amendment `docs/design/professions.md` requires.
12. R12 Apex crafted epics disenchant to the standard 1 arcane_shard. Revisit only if shard
    prices misbehave post-launch.
13. R13 Skill placement: intermediates at 75, apex recipes at 100, Perfecting requires 125
    in the craft that made the piece. maxSkill stays 125. The profession XP tables are NOT
    changed; pacing lives in the new rungs' progress curve if needed.
14. R14 v1 apex items carry PURE STATS and bounded utility only. No new proc effects
    anywhere in this packet. Jewelry (stat-light slots) is pure primary stats + stamina
    with rating allocations pinned to the same-band heroic-vendor jewelry.
15. R15 IP naming: never reuse a coined term or full item name distinctive to another game.
    Every new proper noun is web-verified against the major game wikis at authoring time
    and recorded in the naming registry (below). Pre-existing shipped collisions (arcanite,
    silverleaf, and any others the audit finds) get display-name-only renames in the
    dedicated naming phase (ids are frozen and never change).
16. R16 Duplicate apex pieces: wearing two copies of the same apex item is allowed inside
    the cap (v1 pieces are pure stats, so copies are harmless). Revisit if v2 adds effects.

## Power placement (the numbers every content phase authors against)
- Budget formula: `src/sim/item_budget.ts` `primaryStatBudget`; crafted source level =
  `recipe.level` (`src/sim/item_level.ts` bumps at the ALL_RECIPES loop).
- Base apex: `recipe.level: 25`, quality `epic` -> ilvl 31 -> chest budget 22
  (heroic five-man parity, below raid 33/23).
- Perfected: instance-level bonus stats worth the delta to source 28 at epic quality
  (ilvl 34 -> chest 24), one to two points over the raid chest per slot, on at most 2 slots.
- Existing legendaries (ilvl 33 to 37, budgets 44 to 49) remain the untouched ceiling.
- Ratings (`hitRating`/`critRating`/`hasteRating`/`spellPower`) are OFF the primary budget:
  every apex piece's rating allocation is pinned against the same-band raid or
  heroic-vendor equivalent in tests. This is the throttle-proof surface; treat it as
  budgeted even though the formula does not.

## Naming registry (web-verified by the Phase 03 audit, 2026-08-07)
Cap tag: "Unique-Equipped: Masterwrought (2)". Stage: "Perfecting".
Shared items: Wyrmfall Core (tradable making-core), Sundered Essence (bound, from breaking
down any raid epic of the tier), Maker's Ember (keystone), Apex Patterns (recipe items).
Per profession: Duskforged Billet / Forgefold Plating / Wyrmhide Cording / Sunspun Bolt /
Prismglass Setting / Precision Chassis / Quickening Catalyst / Seasoned Stock / Lucent
Reagent (intermediates); Ridgebreaker (2H), Gyrelens Array (gadget), Master's Field Forge,
Voidbound Grimoire, Grand Cauldron, The Laden Hearth (feast), Deed of Making (codex),
Lucent Infusion (Perfected-only enchant). Rejected for collisions: Vanquisher, Radiant,
Arcanite (new uses), Quintessent, Grand Banquet, Colossus Splitter, Aetherlens, Apex (tag).
Phase 03 amendments: Prismstone Setting RENAMED to Prismglass Setting (FFXIV ships a real
'Prismstone' crafting material in the same component role, plus WoW's Prismstone Ring;
Prismglass verified zero-hit). Phase 03 QA amendment (v0.36.0 merge supersession): the
release's own IP-safe honor-title re-cut (PR #3133, maintainer-merged) supersedes the
phase's honor-ladder verdicts: the ladder ships as Linebreaker / Fieldreaver / Warcrowned
(ids unchanged); the phase's Banneret never ships, and the Sergeant / Field Marshal keeps
lost their subjects. Later phases author against the release names. Wyrmhide Cording and Sunspun Bolt KEPT with recorded
caveats (Wyrmhide is a D2 armor base and a WoW arena-set family, cross-franchise material
vocabulary; Sunspun's only use is FFXIV's cash-shop Sunspun Cumulus mount); all other
registry names verified CLEAR or GENERIC. Full verdicts: naming-audit.md.

## Validation matrix (per change type)
- sim-only: `npx tsc --noEmit` + affected `npx vitest run tests/<file>.ts` +
  `npx vitest run tests/architecture.test.ts`; parity suite when rng draw sites change.
- content-only: `npx tsc --noEmit` + `npx vitest run tests/progression.test.ts
  tests/recipe_economy.test.ts tests/itemization_coverage.test.ts tests/item_level.test.ts`.
- player text: `npx vitest run tests/localization_fixes.test.ts` (S3 guard) in the SAME change.
- wire/snapshots: `npx vitest run tests/snapshots.test.ts tests/env_protocol.test.ts
  tests/bandwidth.test.ts`.
- ui/render: `npx tsc --noEmit` + affected view-core tests + a mobile screenshot script.
- any code change: `npm run ci:changed` (Biome on changed files only; NEVER whole-tree --write).
- pre-merge / phase close: `node scripts/gate_select.mjs`; full `npm run gate` before the PR.

## Key existing seams (from the research; verified against v0.35.0, re-verify on v0.36.0 drift)
- v0.36.0 re-verify (phase 03 QA merge audit): the drift check ran; two NEW mandatory
  seams landed with the merge that later phases must obey: (a) `src/sim/inventory_sort.ts`
  KIND_RANK / QUALITY_RANK are TOTAL Records, so any new ItemKind or quality tier fails
  tsc until ranked there in the same change (the merge ranked 'recipe' at 10 with a test
  fixture); (b) SimContext gained `bumpCommissionOrderBoardRev`, which every
  commission-board mutation site must call. Also from the merge: every daily rollover now
  keys on `ctx.resetDay` (realm-local reset window); `utcDay` is a calendar stamp only.
  The two-hand/offhand displacement rule gained a worn arm: a worn offhand
  (`occupiesHand: false`, the hunter quivers) COEXISTS with a two-hander in both
  directions and budgets on WORN_OFFHAND_STAT_MULT (0.45), so the phase 01 ledger's
  "a two-hander equip empties the offhand" exemption is now conditional on
  `occupiesHand`, and the phase 06/09 offhand authoring must decide the worn arm
  explicitly.
- Recipes: `src/sim/content/recipes.ts` (`ALL_RECIPES`), shape `ProfessionRecipeRecord`
  (`src/sim/professions/types.ts`). SUPERSEDED BY PHASE 02 (the research-era premise said
  zero users and no kind): `acquireRecipe` now has its first real caller (source 'drop',
  `src/sim/professions/pattern_items.ts`) and the `'recipe'` ItemKind exists
  (`RecipeItemDef`, `src/sim/types.ts`); no shipped content carries the kind until phase 11.
- Unique-equipped: `src/sim/equipment_rules.ts` `isUniqueEquipped` is hardcoded
  `quality === 'legendary'`; the counted Masterwrought family is NEW machinery beside it.
- Masterwork: `src/sim/professions/masterwork.ts` (pure leaf, locked constants); proc site
  `crafting.ts` (one rng draw per successful craft). DO NOT MODIFY; Perfecting is a new
  sibling module.
- Keystone template: `heroic_mark` + `awardHeroicMarks` (`src/sim/instances/dungeons.ts`),
  soulbound currency with mail overflow.
- Rift hooks: `rift_essence`/gems (`src/sim/content/rift/items.ts`, `noMarketList`),
  `craftingMaterialBias` (`src/sim/rift/types.ts`).
- Binding: `ItemDef.soulbound` (def-level) + Maker's Bond `bindOnTrade`/`boundTo`
  (`src/sim/professions/commission.ts`); no BoP/BoE concept exists.
- Item instances: `ItemInstancePayload` (`src/sim/types.ts`), `rolled.stats` is how
  Perfected bonus stats persist; `boundTo`/`charges` never leave the server.
- Consumable exclusivity: `src/sim/exclusive_aura.ts` (scrolls/flasks share elixir families).
- Stations: `STATION_TYPE_BY_CRAFT` (`src/sim/content/professions.ts`); enchanting,
  jewelcrafting, inscription have NO station today; their recipes need explicit
  `stationType` or new station content (decide in phases 05/06, record here).

## Per-phase ledger (append as phases complete)
- New IWorld members: NONE (Phase 01 decision: the client pre-check reuses the existing
  IWorldInventory reads `equipment`, `equipmentInstances`, and `inventory`; the parity pin
  is untouched).
- New SimEvents / wire fields: none (both refusals ride the existing `error` event).
- New item ids: none (Phase 01 tests use runtime-injected synthetic ids only; ids are
  frozen once shipped, append-only goldens apply).
- New i18n keys / matcher rules: `error.masterwroughtCap` + `error.masterwroughtLegendary`
  (sim matcher rows, real translations in all 20 non-en DICT blocks; the sim scope is
  invisible to the release fill worklist so English-only rows would ship forever);
  `hudChrome.itemMasterwrought` = 'Unique-Equipped: Masterwrought ({count})' with {count}
  fed from MASTERWROUGHT_EQUIP_CAP through itemNumber (five non-Latin fills in-change
  per M16; 15 Latin overlays pending for the release fill, en_CA is NOT one of them, it
  auto-resolves from en); glossary category
  `masterwroughtSystem` pins the coined per-locale renderings.
- New tests: `tests/masterwrought_cap.test.ts` (pure matrix, enforcement, guard order,
  auto-equip skip, legacy-save tolerance incl. a two-legendary over-cap save, constants +
  DICT.en cross-pins, per-locale refusal coverage over all 20 non-en DICT blocks,
  content-shape pin with isEquipSlot); `tests/masterwrought_tooltip.test.ts` (the tag
  arm on the real itemTooltip: presence, absence, coexistence with the unique tag);
  extended `tests/equip_drop_core.test.ts` (mirror cases incl. the displaced-slot
  exemption, two Sim-authority checks that assert the refusal strings, char_window
  call-site source pins); `tests/equipment_instances_wire.test.ts` (the einst
  self-snapshot decode: wire-null clears to empty map, absent keeps prior, real map
  replaces).
- Client API surface (QA addendum): `PaperdollDropAction` gained
  `'blockedMasterwroughtCap' | 'blockedMasterwroughtLegendary'` (an exhaustive switch on
  the union must add both arms) and `paperdollDropAction` gained optional params 7/8
  (`instances`, `inventory`); all three char_window.ts call sites pass both, and a source
  pin holds that wiring (omitting them silently degrades the mirror to def quality).
  src/net/online.ts einst decode hardened to `s.einst ?? {}` (a wire null can never leave
  the mirror's equipmentInstances null; delta semantics unchanged, absent keeps prior).
- Phase 01 API decisions: `masterwroughtConflictSlot(item, equipment, lookup, ignoreSlots,
  instances?, incomingQuality?)` returns `{ slot, reason: 'cap' | 'legendary' } | null`
  (the reason picks the refusal line; instance rolled.quality overrides def quality, a
  DELIBERATE difference from isUniqueEquipped which stays def-only); the unit-selection
  rule lives in equipment_rules as `equipCandidateIndex`/`equipCandidateQuality` so the
  sim consume, the sim pre-check, and the client mirror share one selection. The two
  refusal emits in items.ts MUST each stay on ONE physical line. Mechanism (QA-verified
  against the real scanner regexes, twice): on the plain-literal form a biome wrap adds
  a TRAILING COMMA that the scanner's closing-paren anchor does not match (the regex
  classes themselves span newlines); the ternary/notice forms exclude newlines outright.
  A SINGLE-LINE ternary IS visible (the `ert` regex); the original "cannot see a
  ternary" wording was wrong.
- Open items: JC/inscription station decision (phase 05/06); slot coverage audit results
  (phase 08); web-verified name confirmations (each content phase); tooltip does not yet
  state the legendary sub-cap, add the line when promotion makes it reachable (phase
  13/14); `rolled.quality` is RETIRED for new writes (crafting.ts), so the Perfecting or
  promotion phase must pick the field that carries instance legendary before the craft
  phases assume one (ruling needed by phase 12; QA sharpening: the only live writers
  stamp 'epic' on rift shell ids, so the ENTIRE sub-cap instance-override machinery is
  INERT until that ruling lands, and the phase-12 field decision should come BEFORE the
  first legendary-flagged def; keep masterwrought item ids disjoint from the rift shell
  id set, whose writer stamps rolled.quality on worn instances); promotion of a WORN
  piece bypasses the sub-cap entirely, nothing re-validates after equip, so the
  Perfecting/promotion phase must re-run the family check at promotion time or a
  character wearing two flagged epics promotes both to legendary-effective with no
  refusal (phase 12/13); when flagged content lands, extend the
  `tests/crafted_item_tooltip_coverage.test.ts` list, give the double gold tooltip line a
  copy pass, and re-check dev_kit/pbe_boost preset slot counting (phases 03/08; QA
  sharpening: pbe_boost's bisKitForRole scores by budget with no family awareness and
  buildBoostedCharacterState HARD-THROWS `boost equip failed` when a kit slot does not
  take, per class, so a flagged-heavy BiS kit is a boot-time crash, not a quiet miscount);
  the /wiki guide gear page explains unique-equipped but has no Masterwrought section
  yet, add one when content makes the tier visible (phase 08+); the packet PR's
  before/after screenshot for the tooltip tag needs a synthetic flagged item (nothing
  shipped carries the flag), decide the capture approach at PR time; the S3
  scanner's blindness to WRAPPED emits is a repo-wide guard gap worth a durable
  hardening outside this packet (a single-line ternary is visible, see the API
  decisions entry); the sim_i18n BASE_NEW locale blocks re-declare themselves after the
  `...BASE_NEW` spread and each MUST begin with its own inner `...BASE_NEW.<lang>`
  spread or every BASE_NEW fill silently shadows to English with nothing red
  (QA-verified all 8 current blocks do; the per-locale coverage test in
  masterwrought_cap.test.ts guards only the two masterwrought keys; a durable
  whole-DICT passthrough guard is a hardening candidate beside the S3 one);
  `tests/anim_pipeline_hunter_ghost.test.ts` is red AT the
  v0.36.0 release tip (inherited, files byte-identical), fix belongs upstream.
- Design notes recorded by QA (behavior as shipped, not defects): auto-equip passes
  empty ignoreSlots to the family check (mirroring the unique-rule precedent), so at
  the cap a lootable in-slot UPGRADE is silently declined where the explicit equip
  path would swap it; a player report of "my Masterwrought upgrade stopped
  auto-equipping" is designed behavior. An OVER-CAP legacy character cannot swap
  WITHIN the family at all (ignoreSlots exempts one worn slot, two others still meet
  the cap), so a three-piece legacy loadout is frozen until the player unequips down
  to the cap; acceptable for v1, flag for a ruling if legacy telemetry says otherwise.
  MasterwroughtConflict.slot is production-write-only (consumers branch on reason);
  kept for symmetry with uniqueEquipConflictSlot and future swap affordances.

## Phase 02 ledger (pattern items; two reviewed fix rounds applied 2026-08-07)
- Representation decision: a REAL new ItemKind 'recipe' via a dedicated RecipeItemDef union
  member carrying a REQUIRED teachesRecipeId (types.ts; OtherItemDef excludes 'recipe' so a
  pattern def cannot omit it). Rationale over the cheaper use.type-variant route: kind drives
  the tooltip label, junk-sell exclusion, material-taxonomy exclusion, stacking (patterns are
  in UNSTACKED_KINDS, one per slot), and the market browse bucket; a use-variant on junk/tool
  would need per-site special cases at every one of those by phase 11. Patterns join the
  market 'other' bucket (dedicated chip is phase 11's call; one-per-slot means the chip case
  strengthens as pattern count grows).
- Gate decomposition RULING: no profession-membership concept exists anywhere in the sim
  (mastery_reset seeds every ring craft at 0; resolveTrain has no wrong-profession arm), so
  the spec's three gates land as already-known (isRecipeKnown) -> profession-not-practiced
  (craftSkills value 0) -> tier-unmet (the shared teachTierMet). Deliberate divergence, on
  record: a trainer can teach a never-practiced character a tier-0 recipe; a pattern requires
  the craft to have been practiced. Deny order mirrors resolveTrain replay discipline;
  invalid content (unresolvable teachesRecipeId, or a recipe without 'drop' acquisition) is a
  SILENT no-op, guarded by the content-shape sweep below. The learn path draws zero rng.
- Learn flow: src/sim/professions/pattern_items.ts (pure resolvePatternLearn + apply arm
  behind SimContext), dispatched from the useItem kind chain BELOW the dead gate (use while
  dead is a silent no-op; usable in combat and while swimming, the potions precedent, on
  record). acquireRecipe gained its first real caller (source 'drop'); consume is exactly one
  copy by the dispatch itemId, only after acquire ok. Success emits the existing text-free
  trainResult ok event (the HUD logs training.learned and the TrainLearnTracker confirmed
  overlay flips the train row Known); NO lastTrainResult write (that stays the train-command
  probe, pinned by identity) and NO event on refusals (they are ctx.error-only, or the deny
  would double-print). Known consequence, fails closed: a pattern learn transiently
  over-reserves that recipe's trainer fee in availableTrainCopper for one broadcast.
- New i18n keys + matcher rows: error.patternKnown 'You already know that recipe.' (fills
  copied VERBATIM per locale from resolved hudChrome.training.alreadyKnown so hover and click
  agree byte for byte), error.patternProfession 'You have not practiced that profession.',
  error.patternSkill 'Your skill is too low to learn that pattern.'; all three placeholder
  free (EXACT self-registration, no RULES rows), real fills in every non-en locale block
  across BOTH dict tables (BASE_DICT in sim_i18n.ts plus BASE_NEW in sim_i18n.newlocales.ts),
  en_CA on the English floor, each emit its own single-line
  ctx.error (S3 coverage PROVEN by a byte-mutation probe; the professions directory glob at
  the corpus assembly covers pattern_items.ts, no explicit entry needed). English vocabulary
  mix is deliberate: you KNOW a recipe, you HOLD a pattern. hudChrome.pattern.teaches 'Use:
  Teaches you how to craft {item}.' with its M16 non-Latin fills, the remaining Latin
  overlays pending for the release fill. itemUi.kind.recipe 'Pattern' English plus one-word
  fills in every full overlay IN-CHANGE (deliberate deviation from English-only: keeps each locale's
  pattern-word consistent with its sim DICT refusal rows; the release fill should still
  REVIEW those words). Register clash inherited verbatim in three locales (de_DE Sie vs du,
  pl_PL plural, tr_TR formal): reconcile at the trainer key during the release fill, not here.
- Tooltip: pure core src/ui/recipe_pattern_tooltip_view.ts (UI_PURE_CORES registered) + a
  thin kind-gated hud branch (craftingIdentity read gated on kind === 'recipe' for hover
  cost). Teaches line gates on the SAME drop-acquisition predicate the resolver uses (a
  non-drop pattern renders nothing, so the hover never advertises a click the sim refuses),
  suppresses requirement/known lines while !synced, and the requirement met-state mirrors
  BOTH sim gates (practiced && tier band via tierForSkill). Reuses skillReqLine and
  training.alreadyKnown; known-state reads craftingIdentity.knownRecipes. Residual preview
  gap, on record: a skillReq-0 pattern for a never-practiced viewer previews nothing while
  the click refuses; no such content exists or is planned. Icons: recipe kind renders the
  parchment/scroll family, arm placed ABOVE the substring fish-name arm (two-sided pin).
- New IWorld members: NONE (tooltip reads the existing IWorldProfessions.craftingIdentity
  incl. its synced flag; the use round-trip rides IWorldInventory.useItem and the cprof
  delta; parity pin untouched). No wire, server-handler, or SimContext changes.
- New item ids: none (synthetic test_pattern_ ids injected at runtime only; frozen-id golden
  untouched). NO shipped content carries kind 'recipe' yet: every arm this phase adds is
  reachable in play only when phase 11 authors patterns.
- New tests: tests/recipe_pattern_items.test.ts (learn/consume both hosts incl. the real
  'use' wire command, routeEvents fan-out of the trainResult event, cprof + ClientWorld
  mirror; three refusal literals with items intact; tier boundary both sides; deny-order pin;
  silent invalid guards; dead-gate placement; zero-rng observer; real marketList; unstacked
  one-per-slot; order-insensitive 'other'-bucket pin; lastTrainResult identity pin; DICT.en +
  20-locale coverage; the vacuous-today content-shape sweep requiring teachesRecipeId to
  resolve AND the recipe to carry 'drop', with a companion pin holding the synthetic skip
  honest); tests/recipe_pattern_tooltip_view.test.ts (model/lines, dual-shape Sim +
  bareClient projections, synced and acquisition arms, sub-tier profession-gate arm both
  ways, real Hud.itemTooltip reachability); extensions to item_icons, item_kind_line,
  item_name_color, bags_view (transfer-mode matrix against literals), bag_filter (ALL-only),
  crafted_item_tooltip_coverage (pure-builder EFFECT_SOURCES row + compose pin).
- Traps recorded for later phases: ALL_RECIPES exists twice, content/recipes.ts is the array
  recipeById scans and data.ts re-exports a COPY, so tests must push the content array; the
  sim DICT is a literal-key union, so a test reading DICT.en['error.x'] is a COMPILE error
  until the matcher row lands (cross-arm coupling); adding 'drop' to a previously
  acquisition-less recipe flips isRecipeKnown from known-to-all to must-be-learned, so never
  retrofit 'drop' without grandfather care.
- Phase 11 obligations from this ledger: every authored pattern's recipe must carry 'drop'
  acquisition (the content sweep enforces it and goes live then; add a count floor); rod
  recipes must NEVER gain 'drop' or the rodFeePaid metric needs a fee-bearing discriminator
  (comment at the metric); re-point the tooltip suite's real-recipe silence arm when
  sunpetal-class content gains drops; pattern items need committed icon art or
  ITEM_ART_PENDING entries; revisit a dedicated market/bag chip as pattern count grows;
  author pattern skillReqs ON the TIER_SKILL_STEP tier boundaries or first decide the
  requirement number question (the pattern hover prints the raw skillReq while the trainer
  surfaces print the tier-band floor tierForSkill(skillReq) * TIER_SKILL_STEP; identical for
  every on-step recipe, divergent copy for an off-step one).

## Phase 02 QA ledger (audited 2026-08-07; fix round 6175c95836)
- Audit shape: seven fresh auditors (correctness + a surfaces child, rng-and-golden,
  test-decisiveness, cleanup, architecture-reviewer, cross-platform-sync, qa-checklist) over
  git diff 80d4afd062..b873eac88e on the tree with release/v0.36.0 re-merged (0fc4e544d6).
  ZERO blocking findings; every should-fix and nit applied or recorded below, none deferred.
- Refutations THIS round, both settled with the file open plus a live probe (do not
  re-raise): (1) "pattern_items.ts is not in the S3 corpus" re-raised by a sync auditor who
  read only the hand-kept readFileSync list and missed the socialSourceUnder professions
  glob; settled BOTH directions by live byte probes (DICT row edit reds s3_registered, emit
  literal edit reds s3_registered). (2) "no online-arm test exists": the online describe
  drives the real {cmd:'use'} wire command through GameServer.handleMessage with the
  routeEvents fan-out and the cprof mirror. (3) "the rod-fee invariant is unguarded prose":
  tests/professions_rod_recipes.test.ts pins each rod recipe's acquisition to exactly
  ['trainer']; the pin's message now names the rodFeePaid metric and the server comment
  cites the pin.
- Type hardening: RecipeItemDef now bars `use` and `stackSize` outright (never-fields
  beside armorType/weapon): a use payload would resolve ABOVE the recipe kind arm and the
  click would never learn; an explicit stackSize wins over UNSTACKED_KINDS in stackSizeOf.
  The suite fixtures dropped their casts so tsc guards the def shape; the one union-spread
  casualty (stack_size_tooltip_view's explicit-stackSize probes) narrows to the potion arm
  before spreading.
- New decisive pins this round, each proven by a live mutation probe (restore by EDIT,
  never checkout): the grandfathered no-acquisition fixture on BOTH suites (sim silence +
  copy intact + invalid-before-already_known on the real path; tooltip model null; reds a
  dropped optional chain on either side), the hover-click cross-check matrix (model.skillMet
  vs resolvePatternLearn cell for cell; reds a raw-compare teachTierMet), positive controls
  on the zero-rng observer plus a draw-free sweep over EVERY refusal arm (red on a neutered
  Rng observer), and the def-level tradable-drop sweep (quality not 'poor' because
  junkSellableSlot gates on QUALITY not kind; no soulbound; no noMarketList; vacuous today
  like its siblings, live the moment phase 11 ships a def).
- Kind-sweep completeness: 'recipe' joined the two stale every-non-quest-ItemKind lists
  (tests/bag_quest_mark_view.test.ts, tests/quest_item_tooltip_view.test.ts); the phase had
  updated the other two sibling lists, these two were the missed pair.
- Rulings recorded (settled, do not re-raise): patterns are NOT hotbar-placeable (comment at
  isHotbarItemId beside the reins rationale: a one-shot unlock would leave a dead button
  after its first press; elixir precedent); discard of an unlearned pattern stays the
  generic confirm (patterns are ordinary tradable items, the escalated confirm keys on
  instance payloads, classic-correct); PatternLearnResult stays exported with zero external
  consumers (it names the public resolver's return type, the training.ts TrainResult idiom);
  removeItem-by-dispatch-itemId vs def.id is unpinnable without an unshippable
  table-key-vs-def-id mismatch fixture (recorded, no change); the frozen-id golden
  (tests/shipped_item_ids.test.ts over shipped_item_ids.golden.json, a .json golden a
  .snap-only search misses) is a DELETION guard only, so "no shipped pattern ids" is
  actually held by the zero kind:'recipe' content greps plus the content-shape sweep,
  not the golden; the stale_client_rollout snapshot is a separate golden scoped to
  HEROIC_BOSS_LOOT and does not cover the catalog either.
- Docs/comment corrections: the Key existing seams recipes row (the phase itself
  superseded its zero-users/no-kind premise); the professions CLAUDE.md module map gained
  its pattern_items.ts row; the hud.ts tooltip gate comment now says WHICH host pays the
  craftingIdentity rebuild (offline Sim; the ClientWorld read is a mirrored field); the
  defense-in-depth !learned.ok comment now says unreachable today; the
  isGatheredProvenanceKind docstring places kind 'recipe' outside the signed universe; the
  market_query 'other' comment cites where the recipe arm is actually pinned; train_view's
  not-trainer-taught comment notes the mechanism now exists while content does not.
- Phase 11 obligations ADDED by this QA round (beyond the build ledger's list): decide
  vendorCountForced for a vendor-sold pattern before one ships (the count row would show
  5x/10x; surplus patterns are tradable unlike reins, so it is a decision, not a copy of
  the mount arm); scripts/mediawiki/build_seed.mjs interpolates raw item.kind into wiki
  prose and categories, so the first shipped pattern needs kind-aware wording there; add
  the 'recipe' census row to tests/material_taxonomy.test.ts when content lands (adding it
  now would red on the empty catalog); extend tests/stack_size_tooltip_view.test.ts's
  UNSTACKED-kind probe with a shipped pattern id then; icon art remains a hard landing
  blocker (ITEM_IMAGE_IDS auto-enters every non-weapon id and ITEM_ART_PENDING is
  deliberately empty, so a shipped pattern with no art 404s and reds item_icons; the
  procedural parchment arm serves only ids parked in ITEM_ART_PENDING).

## Phase 03 ledger (IP naming sweep; audited and renamed 2026-08-07)
- Scope executed per phase-03-naming-sweep.md: 2846 name rows / 2605 unique shipped
  proper nouns enumerated programmatically (33 domains) and web-verified by a 20-agent
  ultracode workflow (19 shards + the registry) against the WoW/RuneScape/FFXIV/GW2/ESO/
  Diablo/PoE wikis, then an adversarial verify pass (two lenses per flagged name) and 4
  hunter re-sweeps of the CLEAR set. Final dispositions: 52 RENAMED display strings, 15
  maintainer borderlines (recorded, not renamed), 92 flagged-kept, 290 CLEAR, 2157
  GENERIC. Every verdict, with evidence and the applied bar, is in naming-audit.md (the
  acceptance deliverable); replacement names were themselves web-verified (8 first
  candidates were taken; verified alternates adopted).
- The rename protocol per rename: content def + English catalog moved together;
  sim_i18n matcher rows in the same change (the Vandric dialogue RULES regex + the
  Wintergnaw aura rows; single-line emits preserved); the 5 non-Latin overlays refreshed
  with REAL translations of the new name (several old rows were the other game's
  OFFICIAL localized coins: zh 十字军打击/迅捷治愈/神圣新星/乘胜追击, ko 성전사의
  일격/신성 충격/폭풍 망치/마법 훔치기, ru Ледяные жилы; the knight-lieutenant
  renderings among these, the phase's Banneret set, were themselves replaced wholesale
  at the v0.36.0 merge by the release's Fieldreaver renderings); stale Latin overlay rows
  stripped to pending (720 rows at phase close; 694 after the v0.36.0 merge refill, see
  obligation 1) for the release fill; semantically-still-valid
  non-Latin renderings deliberately KEPT (87 rows: zh 绞湖镇/古辉镇/霜鬃/雾铸/墓花 etc.,
  recorded as intentional); guide regenerated; new literals pinned in
  tests/originality_renames.test.ts ("phase 03" describe); old names armed in
  tests/ip_scrub.test.ts HARDCODED_VERBATIM + a NAME-MAP amendment section (40 id rows:
  the phase's 37, which encode 36 unique old-to-new pairs since Winterbite maps to
  Wintergnaw at two ids, plus the three QA-round rows: the Fieldreaver supersede, the
  Pitfire Citadel rename, and the dead Hellfire Brand strip).
- Parity: 5 goldens legitimately shifted (frost_proc_orb, warlock_pet, pet_commands,
  talents_progression, warrior_row_capstones); re-minted via UPDATE_PARITY=1 and proven
  display-only by the rename state proof with the NEW slice-scoping mode
  (RENAME_PROOF_SECTION="MASTERWROUGHT PHASE 03"; the proof harness previously reversed
  the WHOLE locked map + C2 pet ids, which only works for the original pivot wave; the
  scoping change is documented in tests/parity/rename_state_proof.test.ts). The golden
  token inspector passes with 0 violations under --allow-state-hashes (proof-gated).
- Residual-coin strip (pre-rename commit 6e93deadc1): the v0.29.0-era locale fills had
  reintroduced 91 collision-carrying overlay rows across 11 Latin locales after the
  c55bf057c2 rename (de_DE Arkanit/Silberblatt/Thoriumerz officials; fused
  Arkanit/Arcanite/Arcanita loanwords; it_IT Fogliaargento/Polvere Arcana; 17 collision
  prose rows); stripped to pending.
- RELEASE-FILL OBLIGATIONS recorded for the i18n-locale-fill pass: (1) the 720 Latin
  rows this phase stripped (they list under pending; 694 remain after the v0.36.0 merge:
  the release's honor-title re-cut refilled the 26 pvp_honor_knight_lieutenant name and
  title rows across the 13 Latin deed locales with real Fieldreaver translations);
  (2) the 219 stale-calque item rows
  + 23 calque prose rows from the OLD rename wave (translations of pre-rename names, no
  foreign coin; per-locale list in the residual audit, tr/vi/cs/da/nl/pl/sv/id/it/fr/es
  worst); (3) talent_i18n Latin values for the four renamed rows (Victor's Surge,
  Thunderhurl, Zealwing, Spiritcall) carried over as closest-translations, REVIEW at
  fill; (4) deed_i18n Latin rows stripped for the 5 touched deeds (64 rows at phase
  close; 38 remain, the v0.36.0 merge refilled knight-lieutenant's 26); (5) the
  ru_RU chr_nightbloom_first_cast DESC row is pre-existing romanized junk ("Poymay
  rybu..."), name row fixed here, desc left for the fill; (6) sv_SE split-vintage rows
  and the register-clash trio (de/pl/tr) remain from earlier ledgers.
- Maintainer borderlines recorded in naming-audit.md (stopping rule, no unilateral
  rename): the zones The Amberfall / The Frostveil Reach / The Nightbloom, the Galecrest
  zone family (verifiers confirmed Stonemaier's Libertalia: Winds of Galecrest coined
  the word), the Highwatch town family (refuted as TERA-distinctive), the Voidscar zone
  family (WoW Midnight's Voidscar Arena is contemporaneous; ours shipped 2026-07-07),
  Moonrest, the 'Enchant <Slot> - <Stat>' formula scheme (verbatim WoW formula names;
  scheme-wide convention call), and the timing-parallel coins Brutok / Brother Halven /
  Aetherwell / Gravelight / Emberkin.
- Known intentional keeps that will look like misses to a future auditor: Chain Heal,
  Blazing Barrier, Ice Lance, Fingers of Frost, Bladestorm, Barrow Wight (1869
  folklore), Hat Trick Hero, Anger Management and the other idiom/multi-property rows in
  naming-audit.md "Notable keeps"; do not re-raise without NEW evidence.
- Phase 03 QA: v0.36.0 merge audit (merge ed51716964; 9-agent sweep, 32 findings, all
  triaged). Fixed on the branch: the honor-title supersession (docs above), three
  release-side old-name reintroductions (shaman attackByAbility comment block,
  frozen_orb_fx describe title, shaman anim spec-name comment), the recipe kind ranked
  into the release's new inventory_sort ladder, the eastbrook seals re-minted on the
  merged tree. Recorded UPSTREAM follow-ups (release-owned, out of this branch's scope,
  do not fix here): server/pbe_boost.ts fillHands still hardcodes the pre-quiver
  displacement rule (and tests/server/pbe_boost.test.ts:196 pins the old behavior);
  tests/visual_manifest.test.ts wildheart re-cut reads donor GLBs twice with a stale
  comment; tests/delves.test.ts:1226 + tests/honor.test.ts:210,234 titles still say UTC
  day while bodies drive resetDay; the release's hudChrome.fct.absorbed reword left all
  18 translated overlays stale (the reword-staleness blind spot: rows are translated,
  not pending, so no gate or worklist lists them). PACKET follow-ups: the branch-added
  tests/recipe_pattern_items.test.ts db mock (like the release's wire-cadence siblings)
  carries fewer './db' keys than the canonical shape and stays green only while its
  paths avoid them; the masterwrought suites (masterwrought_cap, recipe_pattern_items,
  recipe_pattern_tooltip_view) predate the EMPTY_TEST_WORLD gate-perf trim and could
  adopt it with per-suite validation.
- Phase 03 QA round 2 (the QA fan-out over the phase + merge, 4 auditors + the
  cross-platform-sync and qa-checklist reviewers; 25 + 3 + 6 findings, all triaged,
  every fix applied). BLOCKERS found and fixed: the rift set-piece pool composed 'The
  Hellfire Citadel' (WoW verbatim, same role) for 1 in 4 seeds, renamed to Pitfire and
  pinned over pool AND composed surface; four Latin overlay rows still carried Wyrmcult
  verbatim (id_ID x3, nl_NL fused), fixed in place per the sibling-row precedent; the
  zh_TW/ja_JP sim matcher frostbite renderings were swapped (review-round regression),
  unswapped. Also applied: legacy aliases for the two wire-carried renamed strings
  (Winterbite, the Varric delve line; the Venomfire precedent, drop after v0.36.0),
  Spiritcall's five non-Latin talent renderings, the dead Punishing Blows talent rows
  (Crusader Strike coins) and the dead detonateHellfireBrand key stripped, the inert
  abilities.ts locale arms refreshed, wrapped-comment and living-doc stragglers swept.
  NEW GUARD: tests/overlay_ip_scrub.test.ts (coin denylist over every non-English
  overlay/deed/matcher value + per-locale script-family checks, locale sets derived
  from the live registries; both blockers proven red under it by mutation probe, and
  the originality pin proven decisive the same way). Cleanup-phase notes: the three
  dead detonate siblings (PactSeal/BloodRite/PitSentence, no coin); the pre-phase
  shaman-kit old-name residue in comments and test fixtures (~20 files, earlier rename
  wave, none player-visible); talent_i18n Latin semantic staleness for
  Thunderhurl/Zealwing stays under obligation 3; the abilities.ts inert per-locale
  arms (dead code, the overlay layer wins assembly) still carry roughly 143 stale
  renderings per non-Latin locale from the EARLIER rename tracks; QA refreshed only
  the six phase 03 coins, so the block is a strip-or-refresh cleanup candidate.
- Phase 03 QA round 3 (the fresh reviewer over the fix round, per the phase QA file):
  9 findings, all applied. The overlay guard gained RAID_EXTRA (was unscanned), the
  six missing phase 03 coins (Holy Shock, Swiftmend, Nightkin, Varric, Okku,
  Moonwell), derivation canaries + non-zero scan counters (the toEqual([]) no-op
  hole), a hard fail on a missing per-language matcher table, and reverse
  script-family rules for the Latin locales; the Hellfire Citadel arm joined the
  ip_scrub teeth fixture (36 entries); the two deploy-window aliases got pins beside
  the Venomfire precedent; the NAME-MAP QA rows moved their annotations to a footnote
  so the bare flags arm.
- Standing rule codified per the maintainer's mid-phase instruction: every NEW
  player-visible proper noun is IP-checked at authoring time in the same change (root
  CLAUDE.md content bullet + src/sim/content/CLAUDE.md "Naming originality" section).
- Traps hit this phase, on record: the locale transformer is NOT idempotent (a second
  pass re-strips Latin rows it already swapped; recovered by resetting locale files to
  HEAD and running ONE fresh pass); ability display names live at ids that do not match
  (vanish='Smokefade', counterspell='Spellsever', blink='Flitstep', avenging_wrath=
  'Zealwing', ice_barrier='Frostveil'); the mediawiki seed (mediawiki/seed/pages.xml)
  has NO freshness gate and now carries pre-rename names (staleness predates this phase
  for the c55bf057c2 wave; regen is `npm run wiki:seed`, deferred with the phase 11
  build_seed.mjs obligation); sim_i18n.ts:8240's 'Venomfire Vigor' legacy alias ("drop
  after v0.29.0") is overdue dead code, left for a cleanup phase.
- Phase 03 review round (cross-platform-sync + qa-checklist, both COVERAGE-prompted;
  the QA verdict was NOT READY on one blocker, all items resolved in the fix round):
  FIXED: four em dashes on renamed lines (zone3 quest text x2, a zone3 comment,
  build_seed.mjs) that the range-diff copy scan would have counted as added; two
  Victor's-Surge escape artifacts in sim comments; 12 stale aura.frostbite sim DICT
  locale rows (they still translated the ORIGINAL 'Frostbite'; now render Wintergnaw
  per locale, matching the skin's renderings); the hud.css Rimeneedle comment and the
  asset-pipeline weapon_vfx.js viewer copy (the rename driver only filtered
  .ts/.mjs/.md/.json, missing .css/.js: extension gap on record); two plural 'Frozen
  Orbs' comments the word-boundary replace missed; public/ui/*/mapping.json art
  provenance records (25 token swaps; public/ is deployed verbatim, so old coins there
  were live IP surface); README.md + the 20 docs/i18n mirrors' 'Deacon Varric'
  (proper-noun swap only, no translation touched); the mediawiki seed regen was ATTEMPTED and REVERTED: npm run wiki:seed produces a
  coin-free seed, but re-baking the zone prose re-adds 95 grandfathered em-dash lines
  as new lines and the pre-push/CI copy scan does not exclude mediawiki/, so the regen
  is blocked until a content-prose dash chore lands; the seed stays stale-on-record
  with the phase 11 build_seed.mjs obligation (and still has no freshness gate,
  hardening candidate); the naming-audit 2605-vs-2606 count reconciled (the +1 is
  shard 10's un-articled 'Wildheart Basin' duplicate row).
  RECORDED, pre-existing, not this phase's regressions (QA follow-ups for a cleanup or
  QA phase, do NOT re-raise as phase defects): last-write-wins reverse-map collisions
  in sim_i18n (Raised Bonewalker, Rime Elemental, Aether Surge, Patch Up); ability
  def-vs-catalog English divergence (shadowform def 'Gloamveil' vs catalog 'Gloamveil
  Form'; meteor def 'Meteor' vs catalog 'Skystone': fixing shifts parity goldens, needs
  its own proof round); the family-wide rift mechanic-name matcher gap (Pitsteel Sweep,
  Pitfire Ring, Hoof of Ruin, Wing Buffet and siblings render raw English in all
  locales; closing it means new aura.* keys + 20-locale fills per name); the positional
  item catalog (ITEM_ENTITY_IDS vs name array, length-checked only) wants a
  derived-or-pinned guard; the rename state proof is env-gated so CI never runs it
  (hardening candidate); release-tier pending=0 stays red by design until the fill.
- Phase 03 pin-audit round (test-coverage-auditor, applied in 6b90a3d908) + gate
  fallout (17e5934a8c): the auditor proved two ip_scrub arms DEAD (the scanner never
  walked deed names/reward titles or graveyard labels; Sanctum Sprint,
  Knight-Lieutenant, and Eldershine Rest were guarded only by literal pins) and two
  renames UNPINNED at their source (sim DICT aura.frostbite English row, the armory
  catalog skin literal): both scan surfaces added, all pins added, POI pins now
  resolve by frozen poi id, and a new teeth test replays every phase 03 old name so
  an inert hardcoded arm fails the gate. The rename state proof gained a scoping
  self-check plus the committed-slice invocation recipe (base = the mint commit's
  parent 233bd5bed0~1, NOT HEAD~1; re-run green 7/7 post-commit). The stale-tree gate
  run also surfaced the zh_CN mount-name pin (CJK literals need their own pass beside
  the English-token driver; sweep found exactly one) and the eastbrook polish
  fingerprint (folds renderer.ts; re-minted via its own script, stale-pin verdict
  applied). GATE INFRASTRUCTURE GOTCHA hit twice: the turbo i18n:gen task cache is
  SHARED ACROSS WORKTREES in the main checkout and its input list omits
  src/sim/content plus the sim/server DICTs, so a warm cache replays stale resolved
  bundles the local regen cannot reproduce; run the gate with TURBO_FORCE=1 on this
  branch until the input-list fix (on feature/bank-storage) merges. Memory updated
  ([[turbo-i18n-gen-stale-dict-cache]]).
- Phase 03 close: the full-suite gate went green at tip 1bcb55ae75 (gate_select with
  TURBO_FORCE=1: 2341 passed / 10 skipped, zero red). The last two fallout commits:
  the accepted-art provenance manifest took the same 36 token swaps its paired
  public mapping.json files did (missing_painted_icons_wave holds them byte-equal),
  and the eastbrook artifact-integrity suite's three remaining pin literals were
  applied from the re-mint script's printed values (its town source fingerprint
  untouched per the script's own warning).

## Phase 04 ledger (materials backbone; built 2026-08-08)
- Pre-flight release sync: merge b84d5f0b1b took the moved v0.36.0 tip (81804a179e,
  the two wiki-refresh PRs; only conflicts were four generated i18n bundles, resolved
  by regeneration). The release-merge audit found ONE drift no shipped guard could
  see: the release's new landing-grid zone teaser (guide.home.world.hauntBlurb) was
  authored pre-rename, so the merged tree said Gallowmere (en plus fresh ja/ko/ru
  transliterations; the zh rows already matched because phase 03 kept the descriptive
  绞湖镇 rendering). Fixed in 4c52eda7db and the three release-minted transliterations
  (ガロウミア / 갈로미어 / Гэллоумир) armed into tests/overlay_ip_scrub.test.ts so a
  future release fill cannot reintroduce them. The merge also brought two NEW guide
  gates that later guide-prose phases must satisfy: tests/guide_key_coverage.test.ts
  (every guide.* catalog key must render on a guide surface) and
  tests/guide_level_cap_drift.test.ts.
- New item ids (FROZEN from this commit on): wyrmfall_core (kind junk, quality rare,
  stackSize 20, sellValue 50, freely tradable and market-listable per R2's catalyst
  design; in ALLOWED_UNCLASSIFIED_JUNK until the first apex recipe classifies it,
  move it out in that change), sundered_essence and makers_ember (soulbound tool
  tokens on the heroic_mark shape: quality epic, stackSize 20, sellValue 0,
  noDiscard). All three ship the per-item obligations: original 128px SVG-rasterized
  WebP icons (woc_original_svg mapping rows + CREDITS.md line) and the five non-Latin
  name fills (坠龙核心/斷裂精華-family renderings matched to the shipped
  arcane_essence / rift_essence vocabulary).
- Faucet decisions (recorded numbers): boss faucet rolls ONE ctx.rng.int(1,3) per
  credited eligible final-boss kill and every participant of that kill shares the
  rolled count; eligible kills are the HEROIC instances (five-mans + heroic raid,
  the awardHeroicMarks set) plus the raid at normal difficulty; the income gate is
  the per-character per-source reset-day window (source key dungeonId:difficulty),
  NEVER the lockout (the raid's kill-time lockout also strikes door-campers, and
  the daily gate is what R9 mandates for rifts anyway). Delivery mirrors the marks
  split: present at corpse to bags, entered-but-absent by raven (new letter
  wyrmfall_core_reward, sender the Heroic Quartermaster, system parcel, never
  expires), roster-only unpaid. Rift arm: A/S rank FIRST clears only (claim.event
  present), deterministic and draw-free, A pays 1 and S pays 2, once per character
  per reset day across all rifts under the shared 'rift' source token. Quartermaster
  catch-up row: { itemId: 'wyrmfall_core', marks: 12 } (the ring price point,
  deliberately a bad-luck backstop rather than an alternative farm; revisit at
  phase 15 power verification).
- Maker's Ember decisions: the weekly boundary is DERIVED from ctx.resetDay by pure
  civil-date integer math (Howard Hinnant days_from_civil, no Date/Intl anywhere):
  emberWeekAnchorOf = the most recent TUESDAY (EMBER_WEEK_RESET_DOW = 2, the classic
  weekly reset day) on or before the reset day, so the realm keeps exactly ONE reset
  clock and the phase's stopping rule (no new clock) is satisfied without stopping.
  First eligible completion ever grants 1 (no realm-age windfall); after that every
  elapsed week since the last granted week banks one more, UNCAPPED per R4 (a
  vetoable ruling: a returning character gets weeks-elapsed embers in one grant).
  Eligible completions = exactly the core faucet arms plus rift A/S clears on BOTH
  race outcomes (losing the race forfeits cores, not the keystone: mercy, not a
  race prize). Ember grants to PRESENT participants only; absent participants lose
  nothing because the accrual banks their week for the next completion. A stored
  anchor AHEAD of the current week (rolled-back realm clock) grants nothing and
  self-heals.
- Extraction decisions: sundering (SUNDER_CAST_ID 'sundering', in isNonSpellCast)
  rides the enchant-family session seam (beginEnchantFamilyCast widened; exported
  with clearEnchantCastSession + the two consume helpers from enchanting.ts), no
  profession gate (the TBC-tailoring access-stacking lesson), eligibility =
  quality epic AND itemFromRaid (the item_level source index; rift legendaries and
  five-man epics excluded by the index itself, currently 14 raid epic ids), yield =
  exactly 1 sundered_essence, deterministic, ZERO rng. The completion ships the
  phase 03 QA amendment's pinned-slot re-check verbatim (disenchantVictimPin
  compare; a mid-cast splice or sort consolidation denies with its own line).
  Victim preference on an unpinned sunder = consumePreferredDisenchantVictim
  (plain copies die first, enchanted last). The bags-full arm of the shared
  admission is defense-in-depth only: an unstacked epic frees its own slot, so the
  refusal is unreachable today and deliberately untested.
- New SimContext members (five-site rule applied, both test stub hosts extended):
  awardWyrmfallCores (death-hub call after awardHeroicMarks; late-bound arrow, the
  N1 idiom), mailWyrmfallCores (PostOffice binding), completeSunderCast (casting
  lifecycle route).
- New IWorld member: extractEssence (IWorldProfessions, method; parity pin re-cut
  to 303 with the five-edit protocol). New wire command: extract_essence
  (COMMAND_NAMES; command_schema counts re-pinned 193/206; dual-shape facade
  signature like disenchantItem; server validates item/slot untrusted). No new
  SimEvent kinds, no new snapshot deltas (grants ride the existing loot event, a
  HEAVY_SELF_EVENTS member; gate state is server-private).
- PlayerMeta/persistence: wyrmfallDaily { date, sources: Set } + emberWeekAnchor
  string; CharacterState optional twins (sources as array), zero-default omission
  on write (the honor idiom) so untouched saves stay byte-equal, defaults on load.
  The parity sampler sees both (the delveDaily/heroicDaily precedent; Set contents
  canonicalize empty like heroicDaily.marked, divergence surfaces via sampled
  inventory).
- New i18n: sim DICT rows error.sunderTarget/sunderHeld/sunderMoved (EXACT) +
  log.sunderResult (RULES, {item} via locItem) filled in ALL 20 non-en blocks
  across BOTH dict tables (the busy refusal deliberately has NO sim row: the
  hud's own localizeErrorText map wins for 'You are busy.' first, see the
  round-2 record); the sunder /casting readout joins the V07 English-backstop
  registry (scripts/i18n_blocked_seed.mjs); hudChrome.itemMenu.sunder +
  hudChrome.enchanting.sunderConfirm{Title,Body,BodySpecial} +
  abilityUi.cast.sundering with M16 five non-Latin fills;
  entities.items.*.name fills x3; entities.letters.wyrmfall_core_reward.* fills x5.
  Latin overlays for all of these ride the release fill as usual.
- UI: the bag context menu gained the Sunder row (bag_item_context_menu pure core
  isSunderable arm; destroyConsumesSpecialCopy widened to the sunder action sharing
  the disenchant skip-enchanted order; bag_item_action_menu confirm through the
  shared destroy-confirm family passing the pinned slotIndex); the cast bar and
  craft-cast audio cue arms cover SUNDER_CAST_ID.
- Parity: deliberate re-mint in its own commit (d1ec91228c) with the movement
  characterized: 59/60 goldens changed only in sampled state shape; exactly
  nythraxis_full_pull moved rng digests (the appended raid-kill count draw) and its
  golden records wyrmfall_core in the discovery ledger.
- New tests: tests/masterwrought_materials.test.ts (26 cases: week math incl.
  month/year edges, boss faucet shared count + seed determinism + daily gate flip +
  mail arm + zero-draw refusal arms with a one-draw positive control, rift A/S/B on
  a REAL raced event via spawnNaturalRiftPortal with the event tier pinned,
  ember accrual/no-calendar/rolled-back-clock, extraction success/refusals/busy/
  dead/pin-splice/SORT-consolidation/preferred-victim/cancel, JSONB round-trip +
  legacy defaults + omission pin; the pin re-check and daily gate proven decisive
  by live mutation probes, restored by edit); the extract_essence over-the-wire
  case in tests/professions_enchant_salvage_arc.test.ts (selected-slot pin honored
  by the server, the sunder line on the wire; note the log filter matches the
  'You sunder ' prefix because the join broadcast contains the player name);
  runSunder + the sundering arm in tests/helpers/enchant_family_cast.ts;
  tests/heroic_vendor.test.ts stock pin re-cut (11 rows = 10 gear + the material
  row with its own pins incl. itemLevel undefined); tests/dungeons.test.ts marks
  test re-cut (+2 slots: marks + cores land together); ALLOWED_UNCLASSIFIED_JUNK
  gained wyrmfall_core.
- Phase 05+ obligations minted here: when the first apex recipe consumes
  wyrmfall_core, move it out of ALLOWED_UNCLASSIFIED_JUNK (it derives IN through
  the reagent table); phase 12 (Perfecting) consumes sundered_essence + makers_ember
  and should re-read the yield/accrual decisions above; the phase 14 UX pass may
  want a client-visible daily/weekly gate readout (none shipped: the gate state is
  server-private today), a tooltip line on the core naming its faucets, and a
  dedicated sunder completion cue (the grant is silent + callerLogs, so the sunder
  log line is the only completion feedback today; the cast start plays the
  workbench wind-up).
- Gate + review round 3 (2026-08-08; the fix round reviewed by a fresh
  qa-checklist agent per the standing rule: 0 blocking, 2 should-fix, 1
  obligation, 6 nits, ALL applied or recorded). Applied: the wyrmfallDaily load
  clamp now bounds the blob too (64-char token cap, 32-entry set cap; the field
  sits outside the professions byte ceiling so the load clamp is what bounds
  it, the knownRecipes doctrine; oversized-junk arm added); the death-hub
  placement invariant is PINNED (FINAL_BOSS_TEMPLATE_IDS exported, the suite
  asserts every worldBoss template is outside it with positive controls, so
  "no kill reaches both a wyrmfall draw and a world-boss roll" is enforced,
  not prose); EMBER_ACCRUAL_GRANT_CAP tied to the ember def's stackSize in the
  defs test; two pin-quality fixes (the doubled-A-count arm and the capped-
  accrual anchor now assert literals, not derived values); the ledger's i18n
  bullet corrected (three EXACT rows, not four). Recorded, accepted: the
  sundering completion is deliberately the one silent craft-family completion
  (the #2458 pairing; the dedicated cue stays a phase 14 obligation, already
  listed); the audio-wiring pin family is comment-gameable across all seven
  arms (inherited shape, hardening belongs upstream); the rift rig pins the
  rank through its own baseLevel input (the intended consequence of the
  re-sourcing; RIFT_TIER_INFO derives both faces from one table); the sibling
  heroicDaily.marked load keeps its identical unclamped hole (pre-existing,
  the shared-sanitizer cleanup candidate from round 1 covers it). Also for the
  record: the fix-round reviewer confirmed the ORIGINAL phase commits were red
  on professions_silent_loot (the suite reads the professions directory off
  disk, so vitest-related can never select it; the earlier per-slice "green"
  claims never ran it), which is exactly why the full gate is the phase-close
  floor. QA pointers for the phase 04 QA session: dispatch migration-safety
  over the F1 clamp and test-coverage-auditor over the fix-round pins.
- Gate + review round 2 (2026-08-08; architecture-reviewer 0 blocking / 9
  should-fix / 9 notes, cross-platform-sync 1 critical / 4 warnings, ALL applied
  or recorded; the fix round reviewed by a fresh qa-checklist agent). Applied:
  the death-hub call moved BELOW the world-boss loot block (the old comment
  claimed an invariant false for world bosses; parity green against UNCHANGED
  goldens proves the move draw-order neutral) plus a FINAL_BOSS_TEMPLATE_IDS
  precheck so trash deaths never scan the instance slots; castingReadout gained
  the sundering arm (the raw cast id leaked through the generic fallback tail,
  which also carries the banned em dash) with its V07 blocked-seed row and the
  casting_command case; the craft-cast-id and audio-wiring pins learned the
  sixth family member; error.sunderBusy and its 20 fills DELETED as unreachable
  (hud.localizeErrorText's own EXACT map wins for 'You are busy.' before
  localizeSimText runs; the emit stays, localized through hud.errors.busy; the
  incidental discovery that the same hud arm already covered seven other sim
  busy emits is recorded here); the winning rift arm re-sourced to
  riftRankForBaseLevel (the creditRiftClearDeeds precedent, so the two ember
  arms can never disagree); WYRMFALL_RIFT_COUNT typed against RiftTier with
  EMBER_ELIGIBLE_RIFT_TIERS stated separately (R4 and R9 are independent
  rulings); the ember anchor load normalizes through emberWeekAnchorOf (an
  off-anchor or garbage stored value can no longer stall the weekly grant);
  the letters.ts reorder restored the marks comment to its declaration; sim.ts
  moved to the named-Impl import convention; the professions/CLAUDE.md module
  map gained both rows. New tests: both raid arms named (normal pays cores with
  no marks; heroic pays through the tuning row), the door-camper exclusion
  (no cores, no letter, gate unstamped), the no-instance world-boss shape
  (zero draws), the off-anchor load normalize, and the losing-race ember end
  to end (two racing instances, loser gets the ember and no cores). Recorded,
  accepted as-is: the instance scan still runs once in awardWyrmfallCores and
  once in awardHeroicMarks on a final-boss death (deduping means changing the
  release-owned marks signature; the template precheck removed the cost that
  mattered, the per-trash-death scan); the Heroic Quartermaster signs the
  normal-raid core letters too (one materials postman, noted at the letter);
  isSunderable's first bag right-click pays the one-time itemFromRaid index
  build (the isDisenchantable precedent); dev-portal rift clears pay nothing
  and the RL env sees a one-shot faucet (both now stated in the module
  header). The xplat report also confirmed: no wire mirror needed for the two
  meta fields (the heroicDaily precedent), extract_essence correctly outside
  COMMAND_FACETS (the enchanting-family rule), and no phase 04 key in any
  release-tier failure.
- Gate + review round 1 (2026-08-08). The full-suite gate caught the silent-loot
  registry (#2430/#2458) reaching the new professions modules (the heroic-marks
  precedent lives in instances/, OUTSIDE that sweep, so the phase plan never named
  it): fixed by documenting the four material grants as NO_RESULT_EVENT_GRANTS
  (one marker per delivery arm) and flipping the sundering grant to silent +
  callerLogs. migration-safety review (3 warnings, 3 infos, ALL applied or
  recorded): the two new persisted keys joined NON_PROFESSIONS_BLOB_FIELDS (the
  blob-growth scrape cannot see omission-spread keys, a pre-existing scrape
  weakness it shares with seven older fields); the load path hardened against
  corrupt rows (malformed anchor = permanent weekly stall since unparseable reads
  as same-week; non-array sources = a throw inside addPlayer); the ember accrual
  payout capped at EMBER_ACCRUAL_GRANT_CAP = 20 per completion with the anchor
  advancing only as far as the grant paid (R4's total stays uncapped, the backlog
  stays banked). Recorded, not fixed here (reviewer-verified pre-existing or
  accepted): the sibling heroicDaily/delveDaily loads carry the same non-iterable
  throw exposure (third copy now; a shared sanitizeDailySources helper is a
  cleanup-phase candidate); the 30s autosave saves characters, market, and mail
  as three independent writes, so a crash between them can duplicate or drop a
  mailed-cores letter relative to the gate (same shape as mailHeroicMarks,
  accepted; the leave/shutdown flush is transactional). Deploy note for the PR:
  a rollback to a pre-materials binary drops both keys on load and erases them at
  its next save; roll-forward then reopens the daily gate (bounded duplicate
  income: at most nine sources, 1-3 cores each) and restarts the ember anchor
  (exactly one extra ember, no retroactive accrual); granted items survive both
  legs (unknown-id stacks stay dormant recoverable data).
