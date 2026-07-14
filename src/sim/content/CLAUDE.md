<!-- Area-scoped: src/sim/content/ only. Root + src/ + src/sim/ CLAUDE.md already
     loaded: determinism, dependency rules, classic-fidelity, large-file norms,
     and the sim-emit -> client-matcher i18n flow live there. This file covers
     only the data-as-code conventions here. -->

# src/sim/content/ - data-as-code

Plain exported TypeScript records (mobs, npcs, quests, items, abilities, classes,
dungeons, talents, recipes, gather nodes). **No engine logic lives here.**
`sim/data.ts` is the merge point: it spreads the content modules into the flat
tables the engine reads (`ITEMS`, `MOBS`, `NPCS`, `QUESTS`, `QUEST_ORDER`,
`CAMPS`, `GROUND_OBJECTS`, `GATHER_NODES`, `ROADS`, `ZONES`, `PROPS`,
`DUNGEONS`, `ITEM_SETS`, `COMMON_RECIPES`/`ALL_RECIPES`, the graveyard/Spirit
Healer surface, plus `CLASSES`/`ABILITIES`). A few modules feed one sibling sim
system directly instead of the `data.ts` spread: `mailboxes.ts`/`letters.ts`
(mail, `src/sim/mail/post_office.ts`), `tunnels.ts` (`src/sim/voxel.ts`),
`enchants.ts` (`src/sim/professions/enchanting.ts`), `dungeon_difficulty.ts`
(`src/sim/instances/`). All shapes are typed in `../types.ts`: add a field
there first if you need one.

## Where a new thing lands
- **New content RECORD** (mob/quest/item/ability/zone/recipe/node): a declarative
  entry in the matching module below, merged via `data.ts`, never a table inline
  in `sim.ts`.
- **New content DOMAIN:** its own `<domain>.ts` here (or a subdirectory with an
  `index.ts` barrel, template: `delves/`), spread into `data.ts` or imported by
  the one sim system that owns it.
- **New BEHAVIOR reading this data:** never here; a module behind the `SimContext`
  seam (see `src/sim/CLAUDE.md`; profession mechanics: `src/sim/professions/CLAUDE.md`).
- **Tests:** referential integrity + progression in `tests/progression.test.ts`;
  domain suites as `tests/<domain>*.test.ts` (exemplars: `tests/talents.test.ts`,
  `tests/gather_nodes.test.ts`). Bug fix rule: reproduce with a failing test
  first, then the smallest change that turns it green.

## Map (domain-grouped; `ls src/sim/content/` for the live set)
- **Classes + talents:** `classes.ts` (`CLASSES`, `ABILITIES`, `abilitiesKnownAt`),
  `talents.ts` (framework), `talents_warrior.ts`/`talents_classic.ts` (the authored
  trees; copy `talents_warrior.ts` as the template for a new one).
- **Zones + dungeons:** `zone1.ts`/`zone2.ts`/`zone3.ts` (one module per zone;
  `zone1` items live in `items.ts` as `BASE_ITEMS`, `zone2`/`zone3` export their
  own `ZONE{N}_ITEMS`), `temple.ts` (the temple zone + dungeon in one module),
  `dungeons.ts` (elites, spawn lists, `DUNGEON_DEFS`), `items.ts` (also fishing
  tables + the `WAR`/`MAG`/`ROG` archetype-group class locks).
- **Delves:** the `delves/` subdirectory (delve defs, `DELVE_MOBS`, companions,
  affixes, shop, lockpick tiers); import through its `index.ts` barrel.
- **Heroic tier:** `dungeon_difficulty.ts` (tuning, read by `src/sim/instances/`),
  `heroic_loot.ts`, `heroic_vendor.ts`, `heroic_variants.ts`. Never hand-author a
  "Heroic X" item: `buildHeroicVariants` generates the variants (`heroicOf`) from
  base items + mob loot tables at `data.ts` assembly.
- **Professions data:** `professions.ts` (`CRAFT_RING`, `GATHERING_PROFESSIONS`,
  `TOOL_EFFECTS`, `PERK_THRESHOLDS`), `recipes.ts` (`COMMON_RECIPES`/`TOOL_RECIPES`/
  `COMBO_RECIPES`/`ALL_RECIPES`), `gather_nodes.ts`, `enchants.ts`. Mechanics live
  in `src/sim/professions/`, never here.
- **Events + world systems:** `augments.ts` (2v2 Fiesta) and `skins.ts` (cosmetic
  skin events), `vale_cup.ts`, `yumi.ts`, `item_sets.ts` (set bonuses),
  `graveyards.ts` (death loop), `letters.ts` + `mailboxes.ts` (mail), `tunnels.ts`
  (voxel volumes), `warlock_pets.ts`, `ground_pickup_lines.ts` (pickup flavor).
- **`deeds.ts`: the Book of Deeds catalog:** `DEEDS` (`DeedDef` records; append new
  deeds at the END of the table, since `DEED_ORDER` derives from table order;
  never reorder or retro-edit an existing trigger) + `DEEDS_ERA`. Cosmetic-only
  rewards, closed trigger vocabulary; the add-a-deed recipe and the
  every-new-conquerable-content rule live in `docs/design/deeds.md`, and
  `tests/deeds_content.test.ts` pins the catalog against the real content tables.

## Classic-era fidelity (YOU MUST)
Abilities gain ranks at **classic-era learn levels** with era-accurate values. The
canonical table for levels 1 to 20, all 9 classes, is `docs/design/spell-ranks.md`:
cross-reference it; do not invent costs/levels/damage.

## How to add a class ability or a new rank
- **New ability:** add an entry to `ABILITIES` (`id`, `name`, `class`, `learnLevel`,
  `cost`, `castTime`, `cooldown`, `school`, `effects[]`, `icon`...), then **append its
  id to that class's `CLASSES[cls].abilities` array in learn order.**
- **New rank of an existing ability:** push `{ rank, level, cost, effects, [castTime,
  threatFlat] }` onto its `ranks: AbilityRank[]`. `abilitiesKnownAt` keeps the
  highest `rank` whose `level <= playerLevel`; rank rows reuse the base id.

## How to add quest / mobs / camps / dungeon / item / gather node
- **Quest:** add to `ZONE{N}_QUESTS` (`giverNpcId`, `turnInNpcId` (or `turnInNpcIds`
  for multiple valid turn-ins), `text`, `objectives[]` of `{type:'kill',targetMobId}`,
  `{type:'collect',itemId}`, or `{type:'interact'}` with `targetObjectItemId` (ground
  object) or `targetNpcId` (NPC), `xpReward`, `copperReward`, `itemRewards` keyed by
  class, optional `requiresQuest`, `minLevel`, `suggestedPlayers`; `retired` keeps a
  quest finishable but not newly acceptable, `shareable: false` opts out of quest
  links), list its id in the giver NPC's `questIds`, and add it to
  `ZONE{N}_QUEST_ORDER`. `$N`/`$C` in text are runtime substitutions (player
  name / class), the client maps them to `{playerName}`/`{className}` (see i18n below).
- **Mob:** add to `ZONE{N}_MOBS`; quest-drop items go in the mob's `loot[]` with the
  matching `questId`. **Camp/spawn:** APPEND `{mobId, center, radius, count}` at the
  END of the merged `CAMPS` array in `data.ts`: camps spawn in array order, each
  drawing world-gen RNG, so an entry inserted earlier moves every later camp's spawn
  (determinism; see the comment above `CAMPS`). Never insert into a `ZONE{N}_CAMPS`
  list mid-array. Collectible objects -> `ZONE{N}_OBJECTS`.
- **Dungeon:** add elites to `DUNGEON_MOBS`, build a `*_SPAWN_LIST: DungeonSpawn[]`,
  register a `DUNGEON_DEFS` entry (unique `index`, `doorPos`, `entry`, `interior`).
- **Item:** add to `BASE_ITEMS` (or `ZONE{N}_ITEMS`). `requiredClass` is a
  `PlayerClass[]`; the `WAR`/`MAG`/`ROG` constants in `items.ts` are the ready-made
  archetype-group lists (`REWARD_ARCHETYPE` in `data.ts` shares rewards across the
  group, so lock the whole group, not one class). Every non-heroic item also needs
  its English name in the i18n catalog (see below), or CI fails.
- **Gather node:** add a `GatherNodeDef` (typed in `../types.ts`) to
  `gather_nodes.ts`; `level` is a one-time snapshot of the zone's `levelRange`
  midpoint, not a live lookup. Yield/respawn per node TYPE lives in
  `NODE_HARVEST_TABLE` (`src/sim/professions/gathering.ts`); rendering in
  `src/render/gather_nodes.ts` (a new node TYPE also needs `NODE_ASSET_URL`,
  `gather_nodes_lookup.ts`, and the `GatherNodeType` union). Respawn is per
  VIEWER. Tests: `tests/gather_nodes.test.ts`, `tests/gather_node_harvest.test.ts`.

## i18n: English names/text here are the source, localized at the client
This dir carries **no `t()`/i18n imports** (it's sim-side data) but its `name:`,
`description:`, `greeting:`, quest `text`/`completionText`, and the ground-pickup
flavor lines are **player-visible English**. They are re-localized at the client
boundary, so any new/changed player string is a same-change two-file edit (the S3
guard `tests/localization_fixes.test.ts` enforces it):
- **Mob / NPC / quest / zone / dungeon names + narratives:** the canonical English
  source is **`src/ui/world_entity_i18n.ts`**, which reads `MOBS`/`NPCS`/`QUESTS`/
  `ZONES`/`DUNGEONS` from `../sim/data` via fixed **id lists**. Adding an entity here
  means **adding its id to that module's list**; runtime localization resolves
  through `src/ui/entity_i18n.ts` (`tEntity`). `$N`/`$C` are rewritten to the
  `{playerName}`/`{className}` placeholders there: preserve them in every locale.
- **Item names:** append the item id to `ITEM_ENTITY_IDS` in
  `src/ui/i18n.catalog/items.ts` and its English name at the SAME index of the `en`
  `itemTranslations([...])` list (positional). `tests/localization_coverage.test.ts`
  ("every item translation in every locale") fails on any `ITEMS` entry without one;
  heroic variants are exempt (they share the base name via `heroicOf`).
- **Talent node/spec/mastery `name`+`description`:** localized via
  `src/ui/talent_i18n.ts` (reads `TALENTS`/`ABILITIES`); a talent name must be an
  ability name or get an explicit per-locale title override (guard tests fail
  otherwise).
- **Fiesta `AUGMENTS`/`POWERUPS` (augments.ts):** their English `name`/`description`
  are hand-mirrored into the `fiesta.augment.*`/`fiesta.powerup.*` keys in
  `src/ui/i18n.catalog/index.ts`: add the matching key when you add an augment.
- **Ground-pickup deny/enough + sim-emitted flavor:** the sim emits these as English
  through `this.error` (`def.pickupDeny ?? '...'` etc.). The **default fallback** strings
  have RULES in **`src/ui/sim_i18n.ts`** (`cannotTakeYet`/`offersNothingMore`/relic
  lines, via the `ITEM_EXTRA` table): register any new sim-emit literal there. The
  **custom per-item `GROUND_PICKUP_LINES` lines** are emitted via a variable, so the
  literal-only S3 guard can't see them and they currently ship English; treat that as
  a known English backstop, not a wired translation.
- **English only here**, per the root i18n rule (never edit the
  `src/ui/i18n.locales/<lang>.ts` overlays). Numbers baked into `description` copy
  (e.g. "15% harder") are part of the copy; don't hand-build money/number strings as
  gameplay data: the engine formats those for display.

## This data also feeds the public Guide/wiki
The Guide at `/wiki` (`src/guide/`) is generated from THIS directory, so player-facing
content you add here should reach it in the same change:
- After adding or renaming a class, ability, talent, zone, dungeon, delve, mob, NPC,
  warlock pet, or deed, run `npm run wiki:content` and commit the regenerated
  `src/guide/content.generated.ts`. It also runs in `pretest`/`build`, and
  `tests/guide.test.ts` fails CI if the committed file is stale, so a forgotten
  regen is caught.
- A new (or retinted) creature/class/pet model also needs its still rendered: run
  `npm run wiki:stills` and commit the new `public/guide-stills/*.webp`. Unlike `wiki:content`
  this needs a headless browser, so it is NOT in `pretest`/`build`; `tests/guide.test.ts` fails
  CI if a figure's baked still is missing on disk, and a second guard fails on an orphan WebP
  that no figure references.
- Only spoiler-safe, high-level facts surface (names, roles, level bands, signature kits,
  POI labels): no balance numbers, mechanics, loot, the raid boss, or encounter scripts.
- A brand-new content TYPE or system needs more than a regen (a generator change, a Guide
  page, route, and `guide.*` prose). See `src/guide/CLAUDE.md` for that contract.

## Talents framework (`talents.ts`)
- **Flat-precompute invariant:** an allocation is resolved **once** via
  `computeTalentModifiers` into a flat `TalentModifiers` (stats / per-ability mods /
  global / grants). Hot paths read only those flats: **never walk the tree per tick.**
- Three hook points consume the flats: `recalcPlayerStats` (entity.ts) for stats,
  `abilitiesKnownAt`/`applyTalentMods` (classes.ts) for ability mods + `grants`, and
  the Sim for `global.threatPct`. Add a new effect kind: extend `StatModEffect`/
  `AbilityModEffect`/`GlobalModEffect`, fold it in `accumulate`, then apply it at a hook.
- **Authoring a class tree:** copy an existing tree (Class nodes + per-spec nodes
  with `specId`/`row`/`col`/`requires`/`pointsGate`, `kind: passive|active|choice`,
  + `SpecDef`s with `signature`/`mastery`), then register it in `TALENTS` in talents.ts.
  **All 9 classes are already registered** (warrior in `talents_warrior.ts`, the other
  8 in `talents_classic.ts`). `validateTalentTree` runs at import and **throws on a
  malformed tree** (dup ids, bad prereqs, cycles, unreachable gates): a broken tree
  won't load.
- Build strings (`exportBuild`/`importBuild`, base64), the loadout type
  (`SavedLoadout`, `MAX_LOADOUTS`), and dormant-node detection live here; the respec
  and loadout save/delete operations are Sim methods (`respec`/`saveLoadout`/
  `deleteLoadout` in `sim.ts`). Allocation is **server-authoritative**:
  `validateAllocation` re-checks on apply regardless of UI.

## Never do here
- Never reference a mob/item/npc/quest id that isn't defined. Ids are matched by
  string at merge/runtime (no compile check), but `tests/progression.test.ts` fails
  CI on any dangling id ("all loot tables, vendor stock, camps and dungeon spawns
  resolve"; a collect objective also needs an acquisition source). Run
  `npx vitest run tests/progression.test.ts` after wiring new content.
