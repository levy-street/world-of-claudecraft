# Masterwrought: cross-phase state

Current phase: 05 QA COMPLETE (2026-08-10, see the Phase 05 QA ledger: v0.37.0 sync + release-merge-audit clean, eight-auditor fan-out with zero blocking anywhere, all four queued rulings taken, fix round incl. the ruled deed pair authored, fresh review applied); next is Phase 06 (inscription base catalog, phase-06-inscription-base.md), which starts with its own release sync per the delivery contract and records its OWN station decision. Packet authored 2026-08-07.
Branch: `feature/masterwrought` (worktree `~/Documents/wocc-masterwrought`), based on `origin/release/v0.37.0`.

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
Phase 05 amendments (2026-08-10, all web-verified at authoring time): the nine
jewelcrafting base-catalog names, all CLEAR: Hammered Copper Band, Polished Copper
Loop, Coiled Copper Torc, Riveted Iron Signet, Etched Iron Loop, Iron Link Choker,
Weighted Osmium Band, Gleaming Osmium Loop, Burnished Osmium Amulet (the rung-50
DISPLAYS use the shipped Osmium register; their frozen ids keep thorium, matching
thorium_ore whose display is Osmium Ore). The Osmium display forms were verified
SEPARATELY after review (2026-08-10): zero exact hits for all three; nearest
neighbors are different full names (BG3 Burnished Necklace and Burnished Ring, WoW
Refined Gleaming Ore, Cabal Osmium Armorset; the Neko Chan Discord game ships a
plain "Osmium Amulet", judged shared material vocabulary, not a coined term). All
three CLEAR. Deed: Polished to Brilliance (prog_jewelcrafting_rare), CLEAR, follows the
prog_*_rare family pattern. Rejected for collisions: Copper Torc (Dungeons of
Dredmor), Iron Signet (Pirate101, LOTRO variants), Polished to Perfection (Trove
achievement, plus our own Plated to Perfection), Heavy Thorium Band (WoW's
Heavy-material-ring jewelcrafting register, discarded at design time).
Phase 05 QA amendment (2026-08-10): Facet and Filigree (prog_jewelcrafting_50),
CLEAR (exact-phrase zero-hit; the words appear only in unrelated single-word uses:
Binding of Isaac's Filigree Feather, GW2's The Missing Facet, Lost Ark's Facet of
Another Level; shared jewelry vocabulary, not a coined term). Grandmaster
Jewelcrafting (prog_grandmaster_jewelcrafting title) follows the shipped mechanical
Grandmaster-craft family, generic by construction.

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
- Consumable exclusivity: the aura id scheme in `src/sim/items.ts` (the `def.kind ===
  'elixir'` arm): the aura id is `elixir_${elx.kind}`, keyed on the effect KIND, so every
  elixir of one stat shares one id and `applyAura` same-id replacement makes them
  exclusive, last drunk wins. A buff scroll joins an elixir family by emitting the SAME
  `elixir_${kind}` aura id (alternative source, replaces in both orders, never stacks);
  the items.ts comment documents the family-component extension (`elixir_battle_...`) if
  a family ever needs to split within one stat kind. `src/sim/combat/exclusive_aura.ts`
  + `exclusiveGroup` is the ABILITY self-buff machinery (shouts/aspects/stances), not
  the consumable path; a flat `src/sim/exclusive_aura.ts` never existed. (AMENDED at the
  Phase 06 release-merge audit; the row previously misstated both path and mechanism.)
- Stations: `STATION_TYPE_BY_CRAFT` (`src/sim/content/professions.ts`); enchanting,
  jewelcrafting, inscription have NO station today; their recipes need explicit
  `stationType` or new station content (decide in phases 05/06, record here).
  PHASE 05 DECISION (jewelcrafting): every jewelcrafting recipe carries an explicit
  `stationType: 'forge'`; the craft stays OUT of `STATION_TYPE_BY_CRAFT` and no new
  station type is minted. Full rationale in the Phase 05 ledger. Inscription still
  records its own decision in phase 06.

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
  with clearEnchantCastSession + the two consume helpers from enchanting.ts;
  SUPERSEDED at the phase 04 QA sync: consumeSelectedInventorySlot and the pin,
  now itemCopyPin, live in the release's src/sim/item_copy_ref.ts and sundering
  imports them from there, see the sync ledger), no
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
  The parity sampler sees both DIRECTLY (QA correction: canonical() in
  tests/parity/trace.ts EXPANDS Set contents into a sorted array, only an empty
  set drops; the nythraxis golden records the stamped source tokens verbatim, so
  the golden gate discriminates which sources are stamped, stronger than the
  original "divergence surfaces via sampled inventory" claim).
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
- New tests: tests/masterwrought_materials.test.ts (26 cases at phase close;
  the review rounds and the QA fix round grew it, the suite itself is the
  count of record: week math incl.
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
- Phase 04 QA release sync (2026-08-10, merge f75f5611c9; the QA audit itself
  had not started when this landed). Re-merged origin/release/v0.36.0 (1151
  commits: the paladin, priest, warlock, druid, and rogue reworks, the CC band
  system, the selected-slot item_copy_ref wave, the item-art consistency
  repaint). ~100 conflicts hand-resolved: release structure adopted everywhere;
  the phase 03 registry names re-applied over every release reintroduction
  (Zealwing, Tolling Hammer, Smokefade, Flitstep, Duskmurk, Fleetmend,
  Frostglobe, Rimeneedle, Drakesting, Vaulting Charge, Oathstrike, Spiritcall
  prose), proven by the three naming guards green after regen. ONE supersession
  the other way, the Fieldreaver rule: holy_nova ships the release's own re-cut
  Sunburst Canticle over the phase's Hallowburst (originality pin re-pointed,
  NAME-MAP chain row added, Hallowburst armed). Sundering re-bound to
  item_copy_ref (consumeSelectedInventorySlot + itemCopyPin, the release's
  byte-identical extraction of the helpers phase 04 had exported from
  enchanting.ts; exports for beginEnchantFamilyCast and
  consumePreferredDisenchantVictim kept on enchanting). Equip adopted the
  release's slotIndex arm; bag menu carries both the release's salvage
  slotIndex and the sunder arm. Parity pin composed to 309 members (release
  +5, extractEssence rides on top), command schema to 196 send / 209 dispatch
  (the release's bg_respond and pet pair, plus extract_essence). Parity goldens re-minted (release reworks move
  them; wyrmfall keys and the nythraxis draw ride along), eastbrook provenance
  re-minted via its script, i18n + wiki regenerated (TURBO_FORCE=1).
  Release-merge audit findings: branch seams verified intact (extract_essence
  dispatch in game.ts, heroic_vendor wyrmfall row, sunder matcher rows + V07
  seed row + castingReadout arm, ctx bindings, masterwrought cap machinery);
  the release's new tests/appearance_broadcast.test.ts db mock is safe (the
  branch adds no server/db exports) and green; phase 05 premise files
  (professions/types, recipes, item_budget, item_level, inventory_sort,
  content/professions) untouched by the release, premises hold. Locale-row
  decisions on record: release-added vanish/crusader_strike name rows and the
  cs holy_shock row DROPPED (translations of superseded names, back to
  pending); release swiftmend.name rows KEPT as closest-translations for
  Fleetmend (REVIEW at release fill, obligation-3 style); release's fresh
  rework re-translations (rupture/swiftmend/chain_heal descriptions,
  nightPlaceNotes) kept over the stale copies; abyssalChainDesc demon name
  re-pointed per locale to the mob row's Duskmurk renderings (ja katakana, zh
  暮影, ru declension; ko was already consistent); dead duskborn and
  wraithborn rows dropped. Observed, no action: the release's devotion_ward
  paladin content names 'Devotion Aura' (WoW verbatim) but the coin predates
  this merge at the last sync base and the phase 03 audit did not flag it;
  recorded here so a future auditor sees it was seen, re-raise only with the
  audit's evidence bar.
- Phase 04 QA sync gate fallout (2026-08-10; gate_select GREEN all 8 steps at
  the closing tip after two fix rounds). The full suite surfaced seven
  release-side inventory gates the merge had left unreconciled, all applied:
  extract_essence joined the release's NEW tests/item_copy_addressing_guard.ts
  ADDRESSED_COMMANDS registry (every item command must name its copy or carry
  a written exemption; future item commands owe a row); the Spiritcall rename
  was re-applied to the canonical ability prose (the catalog-side sweep alone
  trips tests/owned_class_tooltip_clarity.ts, which diffs catalog against
  def copy); the paladin skills mapping dropped the release's pre-rename
  duplicate rows and re-synced generated entries from the accepted-art
  manifest (the manifest merged coherent: our names plus the release's new
  references; it is the authority both missing-painted arms compare against);
  the items mapping re-synced three manifest-owned direction texts the
  release's generatedBatches restructure had reverted to pre-rename copy.
  STANDING OBLIGATION MINTED BY THE RELEASE'S ITEM-ART WAVE: every live item
  id must appear in the item-art audit catalog with OPAQUE 128px art and an
  owner-reviewed verdict row; the three material placeholders were flattened
  onto the opaque house ground (they carried alpha corners), reviewed, and
  admitted (counts 822 to 825 / live 837 to 840, verdict + evidence digests +
  test pins re-cut per the class-overhaul-additions precedent) so EVERY
  FUTURE PHASE THAT SHIPS AN ITEM ID owes the same admission in-change. The
  mob portrait source manifest fingerprints the sim+render browser bundle,
  so ANY branch content change stales it: re-minted through its own receipt
  flow (all 230 portraits re-rendered byte-identical; only the fingerprint
  moved) and the placeholder-art ledger's digest pin moved with it; expect
  this re-mint at EVERY future release sync. Also: two release-side
  useOptionalChain lint errors and two merge-produced format drifts cleared
  the changed-files biome floor; the warrior_intervene fix is behavior-equal.
- Phase 04 QA (2026-08-10, the phase-04-qa.md session; verdict recorded in the
  progress.md row). SECOND RELEASE SYNC FIRST: v0.36.0 had moved 246 commits
  (the Reliquary packet, PR 2976, incl. its 10970-row locale fill); merge
  f14b6a4e0a resolved 87 conflicts hunk-level. Sync outcomes: IWorld pin
  composed to 320, command schema to 197/210 (a REAL silent off-by-one: both
  sides read 196/209 pre-merge and git auto-merged the identical constants;
  the release's own NOTE in tests/command_schema.test.ts warns of exactly
  this, suite runs confirmed both pins); 65 parity goldens re-minted (51
  state-shape only, 13 more moved per-frame events hashes each matching
  exactly one parent, only nythraxis_full_pull moved rng digests: the
  branch's appended wyrmfall draw); portrait manifest re-blessed via its
  receipt flow (230/230 byte-identical) with the accepted-art digest pin
  moved; the release fill reintroduced Gallowmere verbatim in ten Latin
  hauntBlurb rows, caught by tests/overlay_ip_scrub.test.ts and swapped to
  Gibbetmere in place. Release-merge audit (4 cluster agents): CLEAN, zero
  dropped behavior (sim cluster byte-identical to the clean three-way; the
  release's movement:true addItem flag is a no-op for every branch grant
  today since no masterwrought id is a catalogued relic; the release-authored
  db-mock factories are structurally partial but complete for their paths,
  the established pattern). QA FAN-OUT: six auditors (correctness,
  gate-abuse, migration-safety on the F1 clamp, test-coverage-auditor on the
  fix-round pins, architecture-reviewer, cross-platform-sync): ZERO blocking
  anywhere; ~12 should-fix + ~14 nits + ~15 records, ALL applied or recorded.
  Fix round (621ad83a36, b9c58930f7, b68b601af6, 9794ece007, reviewed by a
  fresh agent per the standing rule): the winning rift arm's ember now gates
  on EMBER_ELIGIBLE_RIFT_TIERS instead of riding the core table's early
  return (the two-rulings independence was prose before; the widen-and-
  restore probe pins it); both rift arms filter meta.leaving (the boss-
  faucet roster rule; a disconnect in the persistence window silently ate a
  clear); grantRiftClearEmbers takes the instance eventId and refuses null
  locally (the dev-portal no-pay guarantee no longer rests on another
  module's return shape, and the dev portal is pinned end to end on BOTH
  arms); the week-anchor renderer pads the year and bails out of range
  (renderWeekAnchor), making anchor normalization SINGLE-PASS: before, a
  year-below-1000 anchor normalized to an unparseable value that stalled
  the weekly grant for a session before the next load healed it (measured:
  the stall was one session, not permanent; the fix removes it entirely);
  wyrmfallDaily.date gained the 64-char load cap its tokens had (a corrupt
  date re-saved verbatim forever); completeSunderCast gained its sibling's
  empty-session guard and fires onInventoryChangedForQuests after the
  consume (latent: the grant's addItem fired it, but the destroy half must
  not lean on that coupling); items.ts dropped the unused
  equipCandidateIndex import. New decisive pins (each proven against the
  trap catalog): the recorded faucet numbers as literals (1-3 roll, 1:1
  yield, the core def row: the boss range and yield were pure constant-
  self-comparisons, a silent retune passed 268 tests); ember-rides-
  completion (anchor-rewind probe with the core gate closed); present-only
  ember (the raven absentee banks the week); rank re-roll no-top-up; the
  deliberate normal+heroic two-source day on one character; the sunder
  eligibility boundary (raid LEGENDARIES refuse via the quality clause,
  which was deletable with all tests green); the isConsuming busy arm; the
  client extract_essence FRAME SHAPE (slot rides targeted, absent
  untargeted: the ADDRESSED_COMMANDS registry row was proven VACUOUS, its
  220-char sender window bleeds into the next method's comment, so the
  behavior pin is what protects the online path; the guard's client-half
  window is a RELEASE-owned hardening follow-up); a malformed wire slot
  degrades to the unpinned victim order; sundering joined
  tests/professions_destroy_trade_races.test.ts as the fourth destroy
  command (three orders, conservation); the quartermaster material row buy
  path; the two meta fields joined the blob-growth armed fixture + survival
  floor; the nythraxis parity scenario gained a live calendar (resetDay
  set), so the golden now pins the ember anchor and material grants
  cross-host (the sampler saw them in principle but no scenario reached an
  eligible completion; the re-mint moved ZERO rng digests, 78 state digests
  plus one events digest, and minted col_first_epic for all ten raiders:
  the ember is the first epic-quality item to enter bags in that scenario).
  Fix-round review (fresh agent, 0 blocking, 2 should-fix + 3 nits, ALL
  applied): the glossary ru edit was a REGRESSION and was reverted (the
  masterwroughtSystem note cites the SHIPPED masterworkSeal renderings
  verbatim and ru ships the standalone Шедевр; the release's masterwork
  category note now says it cites the lemma), the golden characterization
  corrected as above, the frame pin tightened to toStrictEqual (toEqual
  cannot see slot: undefined), the sunder quest hook moved above the
  consume bail to the resolveDisenchant shape. The qa-checklist phase gate
  (READY, 0 blocking) caught that the phase plan's own trigger owed a
  privacy-security-review dispatch (server/game.ts changed): dispatched,
  verdict CLEAN (0 blocking, 0 should-fix; server authority, IDOR,
  event scoping, secrets, SQL, dev gating, logging all pass; the
  wyrmfallDaily/emberWeekAnchor server-private claim re-verified, zero
  occurrences under server/); its one nit applied (the malformed-slot
  wire test now also sends slot -1 and 4096, the integer shapes that
  pass Number.isInteger and rely on the sim's own bound). RECORDED,
  accepted (do not re-raise): the bagSlot -1 sentinel collision is
  unreachable (admission refuses negative slots before any cast starts)
  and precedent-identical to disenchantItem; the ordering
  half of the death-hub invariant is pinned by the parity golden, not the
  disjointness suite (moving the call above rollLoot reddens parity_g); the
  wyrmfall draw is taken BEFORE the per-recipient gate check, so divergent
  or empty resetDay can change grants but never desync the rng stream (the
  load-bearing determinism property); the rift participants fallback
  ([...inst.memberIds] when the floor region finds nobody) can pay members
  not present, the creditRiftClearDeeds convention; the FINAL_BOSS precheck
  is a perf guard with no behavioral signature (Check 6 exemption); the
  completion-side sunderAdmitted re-check is behaviorally equal in every
  reachable state (probed); sundering ignores instance.boundTo (the
  disenchant precedent); the ITEMS[itemId] lookup is unguarded like its
  siblings (not exploitable); normalRaidFinal's !== 'heroic' arm routes a
  future third difficulty to the normal arm (closed union today);
  itemSourceLevel('wyrmfall_core') = 20 from the vendor bump, inert twice
  over (junk is never equippable, tooltip gates on gear kinds), pinned
  inert in heroic_vendor; EMBER_ACCRUAL_GRANT_CAP can take two slots on a
  partial stack (comment corrected in round 3's spirit, accepted); mail is
  the SECOND never-expiring reward-parcel source (mailHeroicMarks shape,
  ~7 letters/day ceiling); dying mid-sunder is code-verified safe (damage
  teardown clears the session); the mid-cast pin protects cast-start to
  completion, not menu-click to confirm-OK (family-wide, release-owned);
  bags_window forwards a raw -1 stale index where the destroy sibling
  falls back to undefined (family-wide, wrong toast only); itemCopyPin
  does not cover count (unreachable: all 14 eligible ids are stack 1;
  becomes real if a stackable sunderable ships); the capped-backlog
  branch can blank the anchor and re-arm the first-grant only when
  resetDay itself is year 9999 with a 21-plus-week-behind anchor
  (effectively unreachable, the range bail's own edge, on record); a
  leaving-but-entered character's mail-arm gate stamp lands after the
  leave snapshot so that source can re-pay on relog (byte-identical to
  the release's mailHeroicMarks + lockToHeroicClaim exposure, inherited
  and accepted, not a phase regression).
- Phase 04 QA open items and obligations MINTED (append to the working set):
  (1) RULING TAKEN at Phase 05 QA (2026-08-10): heroic-raid epics ARE
  sunderable, aligning with the settled any-raid-epic-of-the-tier model
  (the normal-only boundary was an accident of the item_level.ts
  raid: false registration, not a decision). IMPLEMENTATION LANDS WITH
  PHASE 12, where Perfecting pricing and the widened faucet are tuned
  together: phase 12 flips the eligibility (the registration or the
  isSunderable predicate) AND moves the phase 04 boundary pin in
  tests/masterwrought_materials.test.ts in the same change. Until then
  the pinned normal-only behavior stands deliberately (essence has no
  consumer before Perfecting exists). (2) The Perfecting/apex
  re-mint arm (phase 12) MUST pass movement: true on its re-mint addItem
  (the release's obtain-tally doctrine; no branch precedent shows the
  flag, the doctrine lives in the Sim.addItem header and reliquary.ts).
  (3) The present/absent wyrmfall delivery straddles the movement
  boundary (mail rides grantCopies movement:true, present is a direct
  grant): inert until a masterwrought id becomes a catalogued relic;
  re-check if a Masterwrought reliquary shelf lands. (4) Maker's Ember
  must NEVER become tradable (soulbound is what keeps the uncapped R4
  accrual from becoming a supply vector; standing constraint, stated at
  the def). (5) The core faucet is per-account-unbounded through alts
  (up to eight sources per character per day, tradable output): phase 15
  power-verification input, on record. (6) Release-owned upstream
  follow-ups, do not fix here: the addressing guard's client-half sender
  window is comment-bleed-prone (bound it at the next method like the
  server half); the orphaned sortedJson JSDoc above beginEnchantFamilyCast
  (the item_copy_ref extraction left it); the release-authored reliquary
  db-mock factories are partial (8/12 keys of 26; a future phase making
  join/snapshot call a new db export surfaces there first); the zh locales
  have no armed transliteration patterns in overlay_ip_scrub (they
  translate semantically today, no live gap). (7) The masterwrought
  suites still predate the EMPTY_TEST_WORLD gate-perf trim (carried
  forward). (7b) Epic-and-up MATERIALS trip the first-quality collection
  deeds (makers_ember minted col_first_epic for all ten raiders in the
  parity golden; cosmetic, renown 0): phases 12/13 mint more epic and
  legendary materials and col_first_legendary has the identical shape, so
  decide per material whether a token counting as the character's first
  epic or legendary is intended, and characterize the deed in any golden
  it moves. (8) tests/professions_silent_loot.test.ts reads the
  professions DIRECTORY off disk: vitest-related can never select it, the
  full gate stays the only floor for disk-scan guards (carried forward,
  bit again this session as the M5 mutation-probe noise).
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
  income: at most eight sources (six heroic keys incl. the heroic raid, the
  normal raid, the rift token; the original "nine" over-counted), 1-3 cores
  each) and restarts the ember anchor
  (exactly one extra ember, no retroactive accrual); granted items survive both
  legs (unknown-id stacks stay dormant recoverable data).

## Phase 05 ledger (jewelcrafting base catalog, 2026-08-10)
- STATION/TRAINING DECISION (the serial decision this phase owed): every jewelcrafting
  recipe carries an explicit `stationType: 'forge'`; jewelcrafting itself stays OUT of
  `STATION_TYPE_BY_CRAFT` (no new station type, no new trainer NPC). Rationale: (1) the
  only shipped recipes of a station-less craft (enchanting's recipe_artisans_eye and
  recipe_gatherers_cache) chose exactly this shape, foreign-bound to the toolworks, so
  the seam is proven; (2) training derives entirely from the recipe's station
  (trainingStationTypeFor in src/sim/professions/training.ts), so Forgemistress Darva's
  forge teaches the catalog with zero new NPCs, props, layout rows, station i18n, or
  StationType union widening in a content-only phase; (3) thematically the base catalog
  is wrought metal (ores plus smithing flux), and the Bladewright archetype pair already
  couples jewelcrafting to weaponcrafting at the forge; (4) reversible: a later world
  phase can seat a dedicated jeweler's bench (the GLB exists; its Eastbrook placement is
  disposition 'removed') and repoint the recipes' stationType without changing the
  record shape. Cost paid here: the foreign-bound literal pin in
  tests/professions_crafting_hub.test.ts grows the new jewelcrafting recipe ids; the
  craft-absent pin (stationTypeForCraft('jewelcrafting') undefined) deliberately stays
  green; the gossip Crafting-shortcut tie-break reads STATION_TYPE_BY_CRAFT key order,
  which this decision leaves untouched.
- VENDOR FLUX DECISION: the catalog reuses the existing `smithing_flux` (buyValue 20,
  already stocked by Forgemistress Darva at the forge the recipes bind to). The phase
  file authorized adding a vendor flux row if none existed; one does, sold at the right
  station, and weaponcrafting/armorcrafting already share it, so no new staple id, art,
  or vendor row is minted.
- PREMISE CORRECTION (recorded per the release-merge-audit doctrine, before
  implementing): the phase file's "gems-from-salvage" input class does not exist in the
  game. There are NO gem materials, no salvage-gem outputs, and no prospecting:
  SALVAGE_MATERIAL_BY_QUALITY yields bone_fragments/linen_scrap/spider_leg, and the only
  gem-flavored junk defs (deepfen_pearl, pale_pearl, inert_storm_shard, bogiron_nugget)
  are quality 'poor' (sellAllJunk sweeps them, unusable as reagents) and sit in no
  source table. The salvage-DERIVED material family that does exist is the disenchant
  ladder (arcane_dust / arcane_essence / arcane_shard). The catalog reads
  "gems-from-salvage" as that ladder: arcane_dust on the 0 rung, arcane_essence on the
  25 and 50 rungs, and arcane_shard deliberately NOT consumed (Phase 04 sized epic
  disenchant 1:1 against the heroic faucet; a leveling catalog must not add a consumer
  to that scarce faucet, and shards stay reserved for the apex band, phase 09). No new
  gathered material is invented, so the phase's stopping rule is not tripped. QA
  re-judges this reading.
- QUALITY-LADDER DEVIATION (ruling APPROVED at Phase 05 QA 2026-08-10, see the
  rulings bullet below): the phase file's
  "(common/uncommon/rare)" gloss is unshippable at rung 0 for jewelry: QUALITY_STAT_MULT
  is 0 for common and jewelry has no armor axis, so a common ring would carry literally
  nothing, and the recorded content doctrine (profession_items.ts ladder headers) says
  common-rung pieces are armor-only BECAUSE common quality carries no primary-stat
  budget. Classic-era jewelcrafting also starts its equip jewelry at uncommon. The
  catalog therefore ships uncommon(0) / uncommon(25) / rare(50), the two uncommon rungs
  separated by recipe level (10 vs 15, ring budgets 3 vs 4); rare stays exclusive to
  rung 50 so the deed rare-tier derivation and the training-fee ladder land exactly like
  the other crafts. Every budget remains exactly formula-derived; the quality-per-rung
  pin in recipe_economy covers LADDER_RECIPES only and does not move.
- EXECUTION RECORD (what shipped): nine items in profession_items.ts (new jewelcrafting
  section; kind armor, slot ring/neck, no armorType/ratings/buyValue/requiredLevel;
  budgets 3/4/8 at ilvl 11/16/23, splits 2+1, 3+1, 5+3 with sta the minor stat), nine
  recipes in the new JEWELCRAFTING_RECIPES array in recipes.ts (id = recipe_ +
  resultItemId; skillReq/budget/level = 0/10/10, 25/16/15, 50/20/20; all stationType
  'forge', acquisition ['trainer'], resultCount 1). Reagents: rung 0 copper_ore 4-5 +
  arcane_dust 2-3 + smithing_flux 1; rung 25 iron_ore 3-5 + arcane_essence 1-2 + flux 1;
  rung 50 thorium_ore 4 + essence 2-3 + flux 2 + iron_ore 2 (the 4th line was
  RE-AUTHORED at the coverage review: the original fine_thorium_ore choice violated the
  material-grades disjointness invariant, a recipe listing a base material AND its fine
  grade double-counts one bag pool because hasRecipeMaterials checks lines
  independently, so a player holding only fine ore would craft one reagent short;
  resonant_steel stays rejected as bind-on-trade, iron ore is the solder line, margins
  52/70/22). Economy margins 16 to 70 copper, strict, both
  exception lists still empty, no recipe fully vendor-fed. Item ids: hammered_copper_band,
  polished_copper_loop, coiled_copper_torc, riveted_iron_signet, etched_iron_loop,
  iron_link_choker, weighted_thorium_band, gleaming_thorium_loop, burnished_thorium_amulet.
  Deed prog_jewelcrafting_rare appended at the DEEDS tail (renown 10, visit mark
  craft_rare:jewelcrafting), crest art committed (DEED_ORDER 271 to 272). i18n:
  entities.items.<id>.name rows via APPENDED_ITEM_NAMES (never the positional array),
  all nine names filled in the five non-Latin overlays (M16), guide keys
  craftIntro.jewelcrafting + craftProse.jewelcrafting x8 added with non-Latin fills,
  SEVEN falsified guide.professions/craftProse lines reworded (whatBody, ringBody,
  ringWaveNote, stationsBody, deedsBody, weaponcrafting.identityBody,
  enchanting.identityBody) with their non-Latin fills refreshed; 13 Latin overlays now
  carry stale rows for those seven keys (release-fill obligation; ringWaveNote and both
  identityBody rows are outright FALSE in Latin locales until refilled). Art: nine
  opaque 128px WebPs (1016 to 1794 bytes) + mapping.json woc_original_svg rows +
  CREDITS.md lines + audit admission (counts 825 to 834 art / 840 to 849 live, verdict
  re-cut, script census literals moved in scripts/item_art_audit.mjs). Tests: NEW
  tests/jewelcrafting_catalog.test.ts (rungs, forge, trainer, flux, quality ladder,
  formula-exact budgets, no-rating sweep, no-shard, slot split); pins moved in
  professions_crafting_hub (foreign-bound 2 to 11), recipe_economy (identity sum),
  deeds_content (272/3155/58, tail order, positive deed shape pin, catalog sha
  re-baselined), crafting_view (jewelcrafting hints at Darva's forge), deed_i18n
  (manifest 272*2+42), deed_icons + missing_painted_icons_wave + release_art_audit_v036
  + deeds_view (271 to 272 family), professions_blob_growth (ceiling re-mint, measured
  9734, new band 10240), guide.test literals (earnable + content-empty + overview link),
  material_profession_affinity(+bootstrap) + hint_view (dust/essence two-craft rows),
  professions_crafting (recipeList surface). Wiki regenerated (jewelcrafting page +
  sitemap row). Portrait manifest re-minted via the receipt flow at phase close.
- REVIEW ROUND (2026-08-10, applied in full): frontend-seam-reviewer (0 blocking, 2
  should-fix, 4 notes), a three-agent stale-claims/art/i18n audit fan-out (30 + 6 + 9
  findings), and a 16-item comment/docs reword batch. Everything applied: (a) the wiki
  generator now derives a craft card's station from the unanimous recipe stationType
  when the craft is absent from STATION_TYPE_BY_CRAFT (enchanting deliberately keeps
  the null card: its enchant channel is station-free), so the jewelcrafting page names
  the forge and Forgemistress Darva instead of the false "No station needed"; pinned in
  tests/guide.test.ts (positive jewelcrafting card + enchanting negative control + the
  grounding test re-derives the same rule). (b) The seven falsified guide.professions /
  craftProse keys plus faq.a2 ("eight earnable crafts") were reworded in English where
  still stale and STRIPPED from the 13 Latin overlays (91 + 13 rows to pending; the
  five non-Latin overlays' condensed values carried no falsified claim except the five
  already refreshed). (c) hudChrome.materialHint.arcaneDust/arcaneEssence leads
  reworded to the craft-neutral "Crafting reagent." with the five non-Latin fills
  refreshed in-change and the 13 Latin rows stripped (2 x 13); the hint-view pin
  updated with a not-toContain arm. (d) prog_jewelcrafting_rare deed locale fills
  authored for the five non-Latin chunks (family-idiom names: 打磨至璀璨 / 磨かれた輝き /
  광채를 향한 연마 / Отполирован до блеска); the 13 Latin chunks ride the release fill
  (the deed channel is outside the pending registry, worklist reminder below). (e) Art
  provenance record docs/achievements/masterwrought-phase05-art/ (crest source SVG
  committed + accepted sha256/bytes for all ten assets) closing the deed-crest
  provenance gap; dated amendment appended to the release-art-audit README's 271-line.
  (f) The derived Trapper-pair hobby flip (cooking+leatherworking now defaults to
  jewelcrafting over weaponcrafting, CRAFTS_WITH_CONTENT reads ALL_RECIPES) pinned in
  tests/professions_archetype.test.ts with a skill-preference control. (g) The catalog
  suite gained an i18n parity arm (nine catalog rows byte-match the defs, Osmium
  register pinned). (h) Fifteen stale comments/docs reworded (archetype, professions
  station header, training, heroic_vendor "only jewelry source", deeds block,
  hint-view rationale, guide pages, three test rationales, professions.md, deeds.md,
  maintainer-notes, generator comments).
- COVERAGE REVIEW ROUND 2 (2026-08-10, the fresh-subagent diff review; applied in
  full): the review recomputed every budget and every economy margin by hand (all
  exact), verified the deed trigger mechanism end to end (craft_rare derives from
  professionId at the emit site, cannot drift), and found what the phase missed
  OUTSIDE its own spec's suite list: (1) REAL DEFECT, fixed: the rung-50 recipes
  listed thorium_ore AND fine_thorium_ore, whose shared grade pool let a
  fine-ore-only bag pass the check and craft one reagent short (material_grades
  disjointness guards were red); re-authored to iron_ore x2 solder, guide materials
  prose + five non-Latin fills refreshed, wiki regenerated. (2) Stale pins in
  tests/train_view.test.ts (Darva teaches three crafts; locked rows 14 to 20) and
  tests/dev_kit.test.ts: buildDevKit derives best-in-slot from the item tables, so
  the three jewelry slots FILLED THEMSELVES when the catalog landed (neck
  burnished_thorium_amulet; physical rings weighted_thorium_band +
  riveted_iron_signet; caster rings gleaming_thorium_loop + etched_iron_loop),
  consistent with the crafted armor and weapons the kits already wear; judged
  correct-by-derivation (the Trapper-flip doctrine), zero source change, the pin
  re-pointed at the picks. An earlier keep-empty call was reversed when its premise
  (that the slots were still empty) proved false.
  (3) Jewelcrafting was the only gear-capable craft whose masterwork earned no
  Reliquary trophy (masterworkByCraft listed five crafts and the guard iterates the
  list itself, structurally blind to this drift): the jewelcrafting row + markFind
  i18n + a derivation-based guard added (craftIsGearCapable sweeps CRAFT_RING
  through masterworkBonusStats over ALL_RECIPES, so a craft turning gear-capable
  without a slot reds it). DISCOVERY recorded for future mark work: a reliquary
  mark's display name lives in THREE hand-maintained tables, the client catalog
  (hudChrome.reliquary.markFind), the server RELIQUARY_MARK_ENGLISH in
  server/character_sheet.ts (cross-pinned bidirectionally by
  tests/character_sheet.test.ts), and RELIQUARY_MARK_GUIDE_NAMES in
  scripts/wiki/build_content.mjs; all three carry Jewelcrafting Masterwork, the
  masterwork glossary row extended, reliquary pins moved 375 to 376 slots / 29 to
  30 marks (incl. tests/profile_page.test.ts, a pin the brief never named), and
  tests/parity stayed green (draw-order neutral). The server/character_sheet.ts
  touch is one row in an English-by-design table; flagged for the QA reader since
  the phase was otherwise server-free. (4) A new end-to-end behavior suite
  tests/jewelcrafting_flow.test.ts (train at Darva's forge with fee assertions,
  craft at the station, reagent consumption exact, deed grant via the tick,
  station_required refusal). (5) Pin-quality nits: exact per-rung flux counts,
  multi-key R14 positive controls, no-buyValue arm, per-rung trainingFeeFor arm.
  (6) Recorded INTENDED, no change: the rung-0 dust round trip is material-positive
  (2 to 3 dust in, 3 to 4 back on disenchant) and gold-negative, the classic-era
  shuttle-craft dust economy exactly (crafting cheap uncommons to disenchant IS the
  canonical enchanting supply loop; gold is the sink); flagged to phase 15 beside
  the essence note. (7) The Osmium display forms web-verified post-hoc (registry
  above). Adversarial leftovers recorded for QA: hubCraftsPerformed now counts a
  ninth craft's station work (correct, unremarked widening); catalog reachability
  (rung 50 at 125-cap pacing) is stated in guide prose but unpinned. Two dev-kit
  scorer facts pinned-with-notes rather than changed: druid/feral (the one TANK_AGI
  role, sta-led) picks the rung-50 INT ring for its stamina over the rung-25 str
  ring, the scorer working as designed; and the PHYS_AGI ring2 pick rests on an
  IEEE754 hair (riveted_iron_signet vs gleaming_thorium_loop tie at exactly 1.8 in
  real arithmetic, split only by float summation order in roleItemScore), so any
  reordering of the weight-sum terms silently flips twelve specs' ring2; the pin
  makes that visible, and an epsilon-aware tiebreak is a cleanup-phase candidate.
- RULINGS WANTED AT PHASE 05 QA, ALL TAKEN 2026-08-10 (Fernando, via the QA session):
  (1) the Trapper pair's default hobby flip to jewelcrafting: KEEP (correct-by-derivation
  stands; the pin already holds it). (2) prog_jewelcrafting_50 and
  prog_grandmaster_jewelcrafting: AUTHOR BOTH NOW; authored in the QA fix round (Facet
  and Filigree renown 5 / Grandmaster Jewelcrafting renown 25 + title, DEED_ORDER 273
  and 274, in-family crests with committed SVG sources, five non-Latin deed-chunk
  fills, live-gain-path flow arm; deed pins re-cut 274/3185/60 progression/43 titles,
  catalog sha re-baselined). The quality-ladder deviation above was likewise APPROVED:
  uncommon(0)/uncommon(25)/rare(50) ships as authored. The phase 04 sunderability
  carry-over was also taken; see the Phase 04 QA open items bullet (heroic-raid epics
  sunderable, implementation with phase 12).
- RELEASE-FILL OBLIGATIONS MINTED THIS PHASE (the pending registry sees the first
  group; the deed group it structurally cannot see). CORRECTED AT QA: the original
  bullet said 18 keys and 130 total stripped rows were misadded as 104. (a) 19 new
  keys x 15 Latin locales pending normally: 9 item names + craftIntro.jewelcrafting +
  8 craftProse.jewelcrafting keys + hudChrome.reliquary.markFind.masterwork_jewelcrafting
  (the last was added by coverage round 2 and never reconciled into the old count).
  (b) 130 stripped stale Latin rows (7 guide.professions/craftProse keys + faq.a2 + 2
  materialHint keys = 10 keys x 13 locales) pending after the strip. (c) The deed
  chunks, INVISIBLE to pending=0, add to the release worklist by hand:
  prog_jewelcrafting_rare name+desc in the 13 Latin chunks, PLUS (minted at QA)
  prog_jewelcrafting_50 name+desc and prog_grandmaster_jewelcrafting name+desc+title
  in the same 13 chunks (26 + 65 = 91 deed-channel rows total). (d) Minted at QA: the
  reworded guide.professions.deedsBody rides the existing stripped-pending rows (the
  13 Latin strips already happened in the phase; the fill translates the NEW English).
  (e) Minted at QA: the five non-Latin guide.profPages.faq q1-a8 block is an OLD
  GENERATION answering an earlier English question set (the QA corrected only the
  falsified craft count inside a1); regenerate the whole block against the current
  English at the release fill.
- QA FOLLOW-UPS (Phase 05, non-blocking): (1) the rung-50 recipes consume
  arcane_essence while rare-band disenchants are their only faucet; watch the essence
  economy when phase 15 verifies power/economy. (2) tests/item_art_audit_builder
  "fresh-checkout rebuild" test measured 16s isolated against a 20s ceiling under
  another session's load; contention-borderline, judge by CI per the standing memory.
  (3) The ru craftProse.jewelcrafting.materialsBody mixes translated and English ore
  registers inside one paragraph (matches the existing ru weaponcrafting precedent);
  settle the register in the release locale-fill pass. (4) SESSION INCIDENT, recorded
  for the QA reader: a mid-phase usage-limit restart silently reset the shell cwd from
  the worktree to the main checkout; one script ran in the wrong repo (13 locale files
  contaminated there, restored to HEAD the same hour) and several wrong-repo READS
  briefly produced false "work missing" conclusions, all voided after re-entering the
  worktree. No worktree work was lost; re-run EnterWorktree after any session restart.

## Phase 05 QA ledger (2026-08-10)
- PRE-FLIGHT: release moved to v0.37.0 (20 commits: AI-architecture CLAUDE.md refresh,
  the v0.36.0 locale staleness fill, CI shard bounds, tests/monolith_budget.test.ts,
  server/parse actor roster, docker fixes). Merge b70c9f7aeb: 40 conflict files, all
  resolved deliberately (root CLAUDE.md hand-merged, keeping the branch's
  naming-originality block inside the release's rewritten content-obligations bullet;
  18 overlays took the release side per hunk after verifying every conflicted key was a
  same-key staleness rewrite and all 12 branch-added keys survive; resolved bundles
  regenerated via i18n:gen, never hand-merged). release-merge-audit CLEAN: four
  auto-merged doc overlaps read against both parents (README kept the release refresh
  plus the branch's Vandric rename; both sim CLAUDE.md files kept the branch sections),
  no migrated arms, no injected-helper rebinds, no new db-mock sites, no lockfile
  change; merged-tree tsc + the release's new monolith_budget test green; the v0.36.0
  fill ate ZERO phase 05 pending rows (verified per-key); portrait source manifest
  --check FRESH both at the merge and after the QA's own deed additions (deeds are
  outside its bundle graph). Monolith headroom noted for phase 12: sim.ts 85 lines
  under its ceiling, server/game.ts 185 under.
- RULINGS: all four taken (see the amended bullets above): quality ladder APPROVED,
  Trapper flip KEEP, deed pair AUTHOR NOW (done in this QA), heroic-raid epics
  SUNDERABLE with implementation at phase 12.
- AUDIT FAN-OUT (eight auditors, ZERO blocking anywhere): five-agent workflow (budget,
  coverage, progression, test-decisiveness in an ISOLATED worktree for mutation probes,
  blast-radius) plus content-obligations-reviewer, frontend-seam-reviewer, and
  qa-checklist (verdict READY). Dispatch rationale recorded: privacy-security-review
  and architecture-reviewer deliberately skipped (server surface = one English
  ReadonlyMap row; sim surface = data plus comment-only edits, parity suite green),
  per the phase spec's dispatch matrix and the qa-checklist's own judgment.
- FINDINGS APPLIED (6 commits after the merge): (1) three stale authoring comments
  (the recipes.ts fine_thorium_ore header, found independently by four auditors; the
  reliquary.ts phantom trinket slot; the icons.ts pendant/sparkle comment). (2) The
  material_profession_hint_view supersede arm rebuilt as an explicit
  CRAFT_NAMING_HINT_KEYS allowlist with exported predicate and direct pins (the
  craft-neutral dust/essence leads made the old exclusion-shaped check latently wrong
  for single-craft consumer sets). (3) The five non-Latin faq.a1 rows count-swapped
  eight to nine (the phase falsified a number inside a pre-existing old-generation
  block; whole-block regen recorded as a release-fill obligation). (4) The catalog
  suite hardened: full nine-recipe reagent-literal table (mutation probe f proved a
  silent ore/dust re-author passed every sim-side suite), WARFARE pvp-rating liveness
  controls, and the derived equip-gate pin (rare rung-50 requires level 20 via the
  recipe source registration, uncommon ungated). (5) dev_kit bestBy gained a relative
  epsilon tie band with the id tiebreak owning real ties (probe h proved a
  rounding-equivalent refactor flipped seven agility-camp ring2 picks on one ulp);
  gleaming_thorium_loop is now the stable documented agility-camp ring2, the strength
  camp keeps riveted_iron_signet on a real score gap; dev-only surface. (6) The ruled
  deed pair authored (see the rulings bullet for the full record).
- TEST-DECISIVENESS RECORD: 8 mutation probes in the isolated worktree, 7 reddened the
  exact guarding test with quoted failure names (rating key, budget formula, forge
  binding, deed mark drift, reliquary derivation guard, golden both directions,
  IEEE754 tie), probe f exposed the reagent-count gap fixed above. Pins judged
  decisive across both new suites; no constant-self-comparisons. The crafting-hub
  foreignBound pin is membership-only BY DESIGN (the catalog suite solely guards the
  binding TYPE; recorded so nobody deletes its forge literal believing the hub pin
  covers it).
- RECORD-ONLY FACTS the auditors verified (no code change): budget derivation runs off
  recipe.level + QUALITY_ILVL_BONUS through primaryStatBudget (itemLevelBudget feeds
  ONLY the craft gold-sink fee; the rung-25 16 = derived-ilvl-16 equality is
  coincidence). Rung-50 recipes are sell-positive on a self-gathered basis under the
  locked buyValue-else-sellValue economy rule, same shape as the pre-existing forge
  ladder (recorded for the phase 15 essence watch). tests/itemization_coverage.test.ts
  is structurally blind to the nine by its own prior-change charter; jewelry coverage
  lives in tests/jewelcrafting_catalog.test.ts (plus item_level.test.ts's sweeps
  exclude crafted outputs by sourceLevel filter). The nine ids are NOT yet in
  tests/shipped_item_ids.golden.json: the re-mint (UPDATE_SHIPPED_ITEMS=1, review as
  additions-only) is a RELEASE CLOSE-OUT step for this packet, add it to the PR
  checklist. XP curve verified: 25 full-gain crafts per rung, 50 minimum to rung 50,
  cap 125 reachable on the nine recipes alone (225 crafts best path), byte-identical
  scaffolding to the LADDER_RECIPES crafts, R13 untouched; the 50-deed flow arm now
  drives ONE live gain step (49 + craft = 50). Dust round trip verified gold-negative
  in every branch with live numbers (40c hard cash out per loop vs at most 24c dust
  back, expected all-in -47c; vendor branch -36c; material-positive +1 to +2 dust as
  designed). tests/professions_hobby_craft.test.ts change was comment-only (citation
  retarget); tests/item_art_consistency.test.ts was a REAL pin move the build ledger
  never named (the nine-WebP art-audit admission, self-checking digests), recorded
  here as its justification. The nine jewelry pieces now enter the PBE boost BiS
  ring/neck pools (outcome unchanged today: 2-to-8-point pieces cannot outscore the
  epic picks; a future big-stat rung would silently change boost kits through
  server/pbe_boost.ts bisKitForRole). npm run asset:budget overages (env, textures,
  models/*) are pre-existing repo-wide debt untouched by this phase (the ten phase
  WebPs live under ui/, outside those groups). Pre-existing, not ours, left alone:
  the icons.ts:5278 console.warn em dash (repo no-dash debt) and the
  cs_CZ.dgn_sanctum_speed.name release-tier deed_i18n red.
- GATE CLOSE (2026-08-11): node scripts/gate_select.mjs PASS, all 8 steps green at
  93a2dd16b3 (the content-heavy diff made the planner fall back to the FULL suite,
  36k tests). The first gate run FAILED on tests/overlay_ip_scrub.test.ts: the
  v0.36.0 staleness fill the sync merged carried two pre-rename coins inside its
  rewritten rows, Gloomshade (24 rows: summon_voidwalker name+desc across 12 Latin
  overlays) and Moonwell (one vi_VN night-notes row), both phase 03 renames
  (Duskmurk, Moonspring); token-swapped in place keeping the fill's newer mechanics
  text (93a2dd16b3). THIRD release-fill reintroduction the scrub guard has caught
  (Gallowmere twice before). SYNC LESSON for every future release-fill merge: after
  taking a fill's overlay rows, run the three naming guards BEFORE the gate; the
  per-hunk resolution verified branch keys survived but never re-screened the
  release text against the rename registry.
- DEED-AUTHORING OBLIGATION DISCOVERED (durable, for every future TITLE deed): the
  locked titles-page rule means a new non-hidden title deed ALSO owes a
  horizons_titles slot in src/sim/content/reliquary.ts in the same change (the
  Grandmaster Jewelcrafting title reddened the derivation pin in
  tests/reliquary_content.test.ts exactly as designed; slot appended, totals
  re-pinned 377 slots / 342 full / 313 character, wiki regenerated). The deed
  authoring recipe in docs/design/deeds.md does not name this coupling; phase 06+
  should treat title-deed = deeds.ts + reliquary titles slot as one unit.
- FIX-ROUND REVIEW (both reviewers reported; every finding applied or judged with the
  file open): the fresh reviewer found 2 blocking + 6 should-fix + 7 nits; the deed
  obligations pass found 0 blocking + 1 should-fix + 3 nits. Dispositions: (1) biome
  red on the hint view, fixed. (2) THE QA'S OWN faq.a1 count swap was WRONG and is
  REVERTED: that "eight" counts RAISEABLE crafts (nine content crafts minus the
  Engineering holdout whose ladder waits for the Bombardier oath), so jewelcrafting
  did not falsify it and the swap contradicted whatBody in the same locales; the
  original frontend-seam finding's falsified-premise was itself mistaken. The
  non-Latin profPages.faq q1-a8 block desync stands recorded for the release fill
  (obligation (e) above, corrected wording). (3) The dev-kit epsilon band initially
  flipped seven agility-camp ring2 picks to a dead-stat int ring on the id
  alphabet; re-cut with an IDENTITY-FIRST tiebreak (a tied pick prefers the item
  carrying the role's weighted stats), which restores every shipped pick while
  keeping the one-ulp robustness. Net dev-kit behavior change across the whole QA:
  ZERO. (4) The hint-view allowlist gained its two-way contract pin against the
  resolved English leads. (5) Deed earnability is now DERIVED in deeds_content:
  for every craftSkill deed, some shipped rung must grant one point short of the
  threshold under the craft-as-major ceiling (enchanting via the soft disenchant
  arm); the cap-only check would have greenlit a gain-path-less deed. (6) The three
  Masterwrought crest hashes are pinned beside the provenance record and CREDITS
  (the PR #3295 authored-art lesson). (7) deedsBody's jewelcrafting parenthetical
  dropped in English + five overlays (eight of nine crafts have a rare-tier deed,
  so the singling-out misled). (8) Reachability prose gained the attunement caveat
  in deeds.ts + deeds.md. (9) Comment re-cuts: deed_i18n lead line, dev_kit tie
  notes (anchor bound, order caveat, NaN seed), "nothing about the picker changed".
  Recorded, no change: server/pbe_boost.ts bestBySlot keeps a first-wins tie policy
  distinct from dev_kit's identity-then-id (untouched, out of scope, noted for the
  next reader); the state.md build-ledger EXECUTION RECORD keeps its historical
  272/3155/58 and manifest numbers as written (the QA re-cut lives in this ledger).

## Phase 06 ledger (inscription base catalog, 2026-08-11)
- STATION/TRAINING DECISION (the serial decision this phase owed): every inscription
  recipe carries an explicit `stationType: 'apothecary'`; inscription stays OUT of
  `STATION_TYPE_BY_CRAFT` (no new station type, no new trainer NPC, no StationType
  union widening). Rationale, the four phase 05 legs re-argued for this craft: (1) the
  foreign-binding seam is proven twice over (enchanting's tool-effect charms at the
  toolworks, jewelcrafting's nine at the forge); (2) training derives entirely from the
  recipe's station (trainingStationTypeFor), so Alchemist Verane's Highwatch apothecary
  teaches the catalog with zero new NPCs, props, layout rows, or station i18n; (3)
  thematically the catalog is ink and pigment work: the reagent ladder is the SAME
  herb ladder the apothecary's alchemy draughts consume (silverleaf/goldleaf/sunpetal
  plus the glass_vial staple already stocked there), and the scroll half of the catalog
  is literally an alternative source of the elixir aura family alchemy brews at that
  bench, so the two exclusive sources train at one master; (4) reversible: the
  decorative inscription_lectern prop already stands in Eastbrook's artisan row
  (eastbrook_layout.ts), so a later world phase can seat a real scriptorium station and
  repoint each recipe's stationType without changing any record shape. Cost paid here:
  the foreign-bound allowlist pin in tests/professions_crafting_hub.test.ts grows the
  six inscription recipe ids; the craft-absent pin (stationTypeForCraft('inscription')
  undefined) deliberately stays green; faq.a8's six-station-type list stays TRUE; the
  gossip Crafting-shortcut tie-break (STATION_TYPE_BY_CRAFT key order) is untouched.
- TOME QUALITY LADDER: uncommon(0)/uncommon(25)/rare(50), applying the Phase 05 QA
  APPROVED ruling by its own recorded mechanism: QUALITY_STAT_MULT.common = 0 and
  HeldOffhandItemDef pins armorType?: never AND weapon?: never, so a common tome
  carries literally nothing at every ilvl (the jewelry no-armor-axis case exactly).
  The two uncommon rungs separate by recipe level (10 vs 15); rare stays exclusive to
  rung 50 so the deed rare-tier derivation and the training-fee ladder land like the
  other crafts. QA re-judges this extension of the ruling.
- SCROLL KIND DECISION: scrolls ship as a NEW ItemKind 'scroll' (ScrollItemDef reusing
  the SAME `elixir` effect field), and the items.ts consumable arm widens from
  `kind === 'elixir'` to accept both kinds with a per-kind log line ("You read" vs
  "You quaff"). Rationale: the kind line and use line are player-facing text, and a
  scroll labelled and logged as an elixir is wrong text under the i18n invariant; the
  'recipe' kind (phase 02) is the direct precedent with the obligation list already
  mapped (KIND_RANK compile-forced rank, itemUi.kind row + overlays, kind-sweep
  suites). The aura application is byte-identical to the elixir arm: same
  `elixir_${kind}` aura id, same applyAura call, no new stacking path, zero changes to
  aura_stacking.ts or combat/exclusive_aura.ts.
- SCROLL FAMILY MEMBERSHIP: all three scrolls join the ONE existing family
  (elixir_buff_sta) at the family's same-band magnitudes AND the same aura display
  names, so either source grants the indistinguishable buff and the exclusivity is
  visible to players: rung 0 common 'Might of the Boar' +6 sta 600s, rung 25 uncommon
  'Vipersear Vigor' +9 sta 900s, rung 50 rare 'Might of the Serpent' +12 sta 900s.
  The authored family ceiling (buff_sta <= 12 for <= 900s) is respected at every rung;
  no new family is minted, so the phase's stopping rule is not tripped and no new
  sim_i18n aura rows are owed (all three names already have matcher rows).
- PROG_RINGWRIGHT RE-DECISION: the recorded deferral rationale ("inscription alone has
  zero recipes") dies with this phase, but the deed itself has NO recorded design
  anywhere: no trigger shape, no threshold, no name text, no renown value, and its two
  reserved companions (prog_three_paths, prog_ninefold) are equally unspecced. Decision:
  RE-RECORD the deferral with the new rationale (the hold is now an unwritten design,
  not a missing engine surface) in deeds.md, maintainer-notes.md, and both deeds.ts
  doctrine comments, keep the tests/deeds_content.test.ts:478 absence pin, and QUEUE a
  design ruling for Fernando at Phase 06 QA: trigger shape (craftSkill count-arm?),
  threshold, renown, and whether the three reserved ids ship as a family.
- PHASE 06 NAMING REGISTRY (R15, web-verified 2026-08-11; AMENDED at the content review
  to certify the SHIPPED displays): items 'Sheenleaf Primer' / 'Goldleaf Folio' /
  'Sunpetal Grimoire' (tomes, ids silverleaf_primer / goldleaf_folio / sunpetal_grimoire)
  and 'Sheenleaf Scroll' / 'Goldleaf Scroll' / 'Sunpetal Scroll' (scrolls, ids
  silverleaf_scroll / goldleaf_scroll / sunpetal_scroll). Verification record: the
  Goldleaf/Sunpetal compounds returned no full-name hit in any indexed game; the
  'Silverleaf ...' compounds were verified clean too but do NOT ship (the id/display
  split renders silverleaf ids as 'Sheenleaf', our own Phase 03 coin, and a compound of
  our own coin plus a generic noun cannot collide with an external full name, the Osmium
  register's reasoning). The frozen ids keep the verified silverleaf spellings.
  REJECTED for collision: 'Scroll of the Boar' (EverQuest item 35022, allakhazam).
  Deeds: 'Written in Fine Ink' (prog_inscription_rare) CLEAR; 'Quill and Pigment'
  (prog_inscription_50) CLEAR with a recorded neighbor caveat (WoW Dragonflight ships
  the 'Ink and Quill I-IV' achievement family, a different full name);
  'Grandmaster Inscription' is the formulaic title the earnability arm derives.
- EXECUTION LEDGER (built 2026-08-11): new item ids silverleaf_primer / goldleaf_folio /
  sunpetal_grimoire (held_offhand tomes, CASTER_ALL, budgets 3/5/10 at ilvl 11/16/23) and
  silverleaf_scroll / goldleaf_scroll / sunpetal_scroll (NEW ItemKind 'scroll'); recipe ids
  recipe_<itemId> x6 in INSCRIPTION_RECIPES. Family membership: all three scrolls join
  elixir_buff_sta at the band payloads (boar 6/600, vipersear 9/900, serpent 12/900), same
  aura display names as the band elixirs, so no new sim_i18n aura rows. New sim surface:
  ItemKind 'scroll' + ScrollItemDef (required elixir payload, use barred), the widened
  items.ts consumable arm with the 'You read {name}.' log line (log.read matcher: flat
  base + RULES regex + all 20 non-en DICT blocks incl. the eight sparse ones; the quaff
  row's own sparse-block gap predates the phase and is recorded below). KIND_RANK scroll=6
  (consumables run), market consumable browse arm + bag consumable chip gained the kind.
  No new IWorld members, wire fields, SimEvents, or server handlers; the parity pin is
  untouched at 321.
- NEW i18n KEYS: entities.items.<sixIds>.name (Sheenleaf display register on the two
  silverleaf ids), itemUi.kind.scroll, hudChrome.reliquary.markFind.masterwork_inscription,
  guide.profPages.craftIntro.inscription, guide.profPages.craftProse.inscription.{identity,
  materials,ladder,route}{Heading,Body}, log.read (sim DICT scope). REWORDED English:
  whatBody, ringBody, ringWaveNote, stationsBody, deedsBody, faq.a2,
  craftProse.tailoring.identityBody, craftProse.enchanting.identityBody (the 13-Latin
  stale rows for tailoring.identityBody stripped to pending; the other seven had no Latin
  rows; en_CA divergence-only, nothing to update).
- NEW TESTS: inscription_catalog (14, the JC catalog template incl. the full reagent
  literal table and both quality ladders), inscription_flow (8, live train/craft/deed at
  the apothecary incl. the resultCount 2 scroll batch and the 49-to-50 live-gain arm),
  inscription_scroll_exclusivity (6, the headline both-orders pin across all three bands
  plus cross-band weaker-included, the read log line, and the derived-stats liveness),
  elixir_tooltip_view scroll arm (byte-identical Use line vs the band elixir),
  market_filters scroll rows; plus the absorbed neighbor pins (see the
  test(professions) commit body for the full list).
- RELEASE-FILL OBLIGATIONS (phase 06 rows, the pending registry sees the Latin ones):
  (a) 17 new keys x 15 Latin locales pending normally: 6 item names + itemUi.kind.scroll
  + craftIntro.inscription + 8 craftProse.inscription keys + markFind.masterwork_inscription;
  (b) the 8 reworded keys' Latin rows (13 stripped tailoring.identityBody rows + the seven
  keys whose Latin rows were already pending);
  (c) INVISIBLE to pending=0, add by hand at the fill: prog_inscription_rare name+desc +
  prog_inscription_50 name+desc + prog_grandmaster_inscription name+desc+title in the 13
  Latin deed chunks (35 rows), and the log.read sim DICT row is already filled in all 20
  blocks (no obligation) but the PRE-EXISTING log.quaff gap in the eight sparse blocks
  (cs/nl/pl/id/tr/sv/vi/da render English quaff lines) is recorded here as an OLD gap the
  release fill should close alongside log.read consistency;
  (d) the five non-Latin guide.profPages.faq q1-a8 block stays the recorded old-generation
  whole-block regen from the phase 05 QA ledger.
- RELEASE CLOSE-OUT: the shipped_item_ids golden re-mint (UPDATE_SHIPPED_ITEMS=1,
  additions-only review) now covers the nine jewelry ids PLUS the six inscription ids.
- RELEASE-OWNED FOLLOW-UPS surfaced by this phase's merge audit (do NOT fix on this
  branch): (1) turbo.json build:bundle inputs omit scripts/build_bundle_pregen.mjs (and the
  gate_task_cache mirror), a warm-cache staleness hazard for pregen-step edits; (2)
  qa-gate.md/gate_steps/gate_task_cache prose says cacheable steps run through npx while
  the code spawns node_modules/.bin/turbo directly; (3) gate.mjs/gate_select.mjs lost
  cwd-independence (fails loud, likely intentional); (4) the mob-portrait render
  environment ping-pong: the release's CI rerender re-encoded all 230 portraits with byte
  drift this Mac's renderer does not reproduce, so every sync re-mints; the two
  environments should converge or the acceptance should carry an env fingerprint.
- DURABLE LESSONS: a ternary inside an emit's text field would blind the S3 scanner
  (split into two literal emits); market_filters' All-only reachability sweep is the guard
  that catches a new ItemKind with no browse category (it caught 'scroll'); the
  hobby-default flip and the apothecary two-craft train view are correct-by-derivation
  consequences QA re-judges (the Trapper precedent); usage-credit exhaustion kills
  workflow agents mid-run and the resume-from-runId flow recovers them with cached
  results (three rounds this phase).
- ART DIGESTS + LOCALE NOTES (post-fan-out): item icons + deed crests committed with SVG
  sources, rasterizer, and accepted hashes under docs/achievements/masterwrought-phase06-art/
  (item audit 834 to 840, deed art 274 to 277, crest sha pins in tests/deed_icons.test.ts).
  Locale register note for the release fill: the ru_RU overlay renders craft names
  INCONSISTENTLY across guide prose (native in ringBody/stationsBody, English inside the
  identity bodies including the phase 05 jewelcrafting row this phase's fills mirrored);
  a whole-file craft-name register pass belongs to the release fill, recorded here so the
  inconsistency is a known debt, not a phase 06 regression. The zh_CN faq q1-a8 staleness
  beyond a2 re-confirms the recorded old-generation whole-block regen obligation.
- RULINGS QUEUED FOR PHASE 06 QA (from the content-obligations review; recorded, not
  changed unilaterally): (1) SCROLL COST PARITY vs the alchemy line it alternates with:
  recipe_sunpetal_scroll (190 input, resultCount 2) undercuts
  recipe_elixir_of_the_serpent (214 input, resultCount 2) for the byte-identical buff,
  and the elixir is pristine_venom_gland's ONLY crafting sink, so the cheaper scroll
  route competes with that rare specimen's sole consumer; rung 0 is ~19 percent cheaper
  (26 vs 32) and rung 25 identical (90 vs 90). Options at QA: accept (two doors, the
  specimen sink keeps its resultCount value), re-price the rung-50 scroll inputs, or
  give the scroll a pristine-adjacent 4th line. (2) TOME MODELS: the three tomes joined
  the model-less held_offhand pin (the lantern/orb/quiver precedent renders nothing in
  hand); decide whether the packet PR owes tome GLBs (the image-to-glb pipeline) or the
  debt rides until the visible-offhand pass. (3) PROG_RINGWRIGHT design ruling (trigger
  shape, threshold, renown, the three reserved ids as a family), carried from the
  re-recorded deferral.
- PHASE-ORDERING LESSON (recorded): npm run wiki:content derives each deed row's crest
  url from DEED_IMAGE_IDS, so the wiki regen must run AFTER the deed-art commit; this
  phase regenerated before the crests landed and needed a follow-up regen commit.
- REVIEW FIX-ROUND RECORDS (all four reviewer reports applied 2026-08-11): (1) RELEASE
  NOTE for deploy: a legacy Bombardier save with NO persisted hobbyCraft and equal
  retained skill in both opposites re-derives its hobby at load and silently moves from
  enchanting to inscription (normalizeArchetypeState; persisted hobbies and real skill
  preferences are unaffected). (2) No-test-possible records: the dev_kit dual-wield
  held-offhand fallback's tie argument is unreachable for shipped content (every
  dualWield spec resolves a real second weapon first; bestBy is module-private), and
  the elixir_${kind} id-derivation's per-kind half has no live case (every shipped
  elixir and scroll is buff_sta, and useItem resolves through the real ITEMS so a
  synthetic-kind arm has no seam); both recorded rather than force-tested. (3) The bag
  hover hint (bags_view) has no arm for elixir OR scroll: a pre-existing family gap the
  scroll inherits, deferred to QA with the mobile-tray fix now making the two consumable
  surfaces otherwise agree. (4) The tooltip replacement clause landed family-wide on
  itemUi.tooltip.useElixir/useElixirAura (tooltip-writing.md item 7); the five non-Latin
  refreshes and Latin strips of those two keys plus the faq q1/a1 subject change ride
  the wave 3 locale round, adding those four keys to the release-fill worklist.
- FRESH-REVIEWER ADDENDA (round two, applied): the dev_kit caster-offhand liveness floor
  re-pinned at the REAL count (13; paladin contributes zero, shields/none); the crafting
  signing comment restored to the four single-copy precedents with the platter, serpent
  elixir, and sunpetal_scroll as the three accepted-cost cases; the exclusivity suite
  anchors its non-family-aura baseline so the total-count arm cannot degrade. WIDENED
  RELEASE-FILL NOTE: beyond the four keys wave 3 touched, the WHOLE non-Latin
  guide.profPages.faq q3-a8 block (12 rows x 5 locales) still translates the pre-rewrite
  English subjects (zh a3 even claims bare-handed tier 1 gathering, contradicted by the
  live q7 answer): the recorded old-generation whole-block regen covers q1-a8 and the
  release fill must treat it as such, not as the four wave 3 keys only. RECORDED, no
  change: defaultHobbyForPair's contentSet stays a prose-guarded test-only parameter (a
  type-system-enforced seam would be an API redesign out of fix-round scope).
- PHASE 06 GATE CLOSE (2026-08-11): gate_select TURBO_FORCE=1 PASS, all 8 steps green at
  tip 3c732e20d6 via the full-suite fallback (2659 files / 36697 passed, browser suite,
  tsc, all builds), tree clean. Two tip-level catches on the way: the portrait source
  manifest went stale AGAIN at the phase tip (content commits move the stills bundle
  graph; a content phase re-mints at its FINAL tip, not only at the sync; rerender was
  byte-identical, fingerprint rows only), and guide.professions.comingSoon joined
  LIVE_OFF_SWEEP_KEYS (no live surface renders it with every seat content-bearing; the
  synthetic-seat arm keeps it exercised). HANDOFF for Phase 06 QA
  (phase-06-qa.md, fresh session): sync the release first per the delivery contract;
  the queued rulings are (1) scroll cost parity vs the pristine_venom_gland sink,
  (2) tome GLBs vs the model-less debt, (3) prog_ringwright design, plus the recorded
  correct-by-derivation flips to re-judge (Bombardier hobby, apothecary two-craft train
  view, dev-kit caster offhand pick) and the deferred bags_view hover-hint family gap;
  the validation surface is the suite list in this ledger plus the four reviewer
  reports' verified-clean sections.
