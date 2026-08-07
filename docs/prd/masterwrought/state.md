# Masterwrought: cross-phase state

Current phase: none started. Packet authored 2026-08-07.
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
   on an existing apex piece, consuming 1 Maker's Ember + Sundered Essence + 1 Prismstone
   Setting per attempt. It BINDS the piece, is fail-forward only (failure consumes
   materials, never harms or downgrades the piece), and the existing craft-time masterwork
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

## Naming registry (provisional until each phase's web verification)
Cap tag: "Unique-Equipped: Masterwrought (2)". Stage: "Perfecting".
Shared items: Wyrmfall Core (tradable making-core), Sundered Essence (bound, from breaking
down any raid epic of the tier), Maker's Ember (keystone), Apex Patterns (recipe items).
Per profession: Duskforged Billet / Forgefold Plating / Wyrmhide Cording / Sunspun Bolt /
Prismstone Setting / Precision Chassis / Quickening Catalyst / Seasoned Stock / Lucent
Reagent (intermediates); Ridgebreaker (2H), Gyrelens Array (gadget), Master's Field Forge,
Voidbound Grimoire, Grand Cauldron, The Laden Hearth (feast), Deed of Making (codex),
Lucent Infusion (Perfected-only enchant). Rejected for collisions: Vanquisher, Radiant,
Arcanite (new uses), Quintessent, Grand Banquet, Colossus Splitter, Aetherlens, Apex (tag).

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
- Recipes: `src/sim/content/recipes.ts` (`ALL_RECIPES`), shape `ProfessionRecipeRecord`
  (`src/sim/professions/types.ts`), `acquisition: ['drop']` typed + `acquireRecipe`
  plumbed (`src/sim/professions/crafting.ts`) with zero users; NO recipe item kind exists.
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
  fed from MASTERWROUGHT_EQUIP_CAP through formatNumber (five non-Latin fills in-change
  per M16; 16 Latin overlays pending for the release fill); glossary category
  `masterwroughtSystem` pins the coined per-locale renderings.
- New tests: `tests/masterwrought_cap.test.ts` (23 cases: pure matrix, enforcement, guard
  order, auto-equip skip, legacy-save tolerance, constants pin, content-shape pin);
  extended `tests/equip_drop_core.test.ts` (mirror cases + two Sim-authority checks).
- Phase 01 API decisions: `masterwroughtConflictSlot(item, equipment, lookup, ignoreSlots,
  instances?, incomingQuality?)` returns `{ slot, reason: 'cap' | 'legendary' } | null`
  (the reason picks the refusal line; instance rolled.quality overrides def quality, a
  DELIBERATE difference from isUniqueEquipped which stays def-only); the unit-selection
  rule lives in equipment_rules as `equipCandidateIndex`/`equipCandidateQuality` so the
  sim consume, the sim pre-check, and the client mirror share one selection. The two
  refusal emits in items.ts MUST stay single-line literals: the S3 scanner cannot see a
  wrapped or ternary emit (proven empirically; mutation-verified end to end).
- Open items: JC/inscription station decision (phase 05/06); slot coverage audit results
  (phase 08); web-verified name confirmations (each content phase); tooltip does not yet
  state the legendary sub-cap, add the line when promotion makes it reachable (phase
  13/14); `rolled.quality` is RETIRED for new writes (crafting.ts), so the Perfecting or
  promotion phase must pick the field that carries instance legendary before the craft
  phases assume one (ruling needed by phase 12); when flagged content lands, extend the
  `tests/crafted_item_tooltip_coverage.test.ts` list, give the double gold tooltip line a
  copy pass, and re-check dev_kit/pbe_boost preset slot counting (phases 03/08); the S3
  scanner's blindness to wrapped/ternary emits is a repo-wide guard gap worth a durable
  hardening outside this packet; `tests/anim_pipeline_hunter_ghost.test.ts` is red AT the
  v0.36.0 release tip (inherited, files byte-identical), fix belongs upstream.
