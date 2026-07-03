<!-- Area-scoped: src/sim/content/ only. Root + src/ + src/sim/ CLAUDE.md already
     loaded: determinism, dependency rules, classic-fidelity, large-file norms,
     and the sim-emit -> client-matcher i18n flow live there. This file covers
     only the data-as-code conventions here. -->

# src/sim/content/ - data-as-code

Plain exported TypeScript records (mobs, npcs, quests, items, abilities, classes,
dungeons, talents). **No engine logic lives here.** `sim/data.ts` imports every
module and spreads it into the flat tables the engine reads (`ITEMS`, `MOBS`,
`NPCS`, `QUESTS`, `QUEST_ORDER`, `CAMPS`, `GROUND_OBJECTS`, `ROADS`, `ZONES`,
`PROPS`, `DUNGEONS`, plus `CLASSES`/`ABILITIES`). All shapes are typed in
`../types.ts`: add a field there first if you need one.

## Key files
- `classes.ts`: `CLASSES` (per-class base/per-level stats, kit) + `ABILITIES`
  (defs with `ranks[]`) + `abilitiesKnownAt()` (resolves kit + rank + talent mods).
- `talents.ts`: the talent framework (types, validation, precompute, build strings).
- `talents_warrior.ts` / `talents_classic.ts`: the authored trees: warrior lives in
  `talents_warrior.ts`, the other 8 (paladin…druid) in `talents_classic.ts`. Copy
  `talents_warrior.ts` as the template for any new tree.
- `zone1.ts`/`zone2.ts`/`zone3.ts`: one zone each. `zone1` items live in
  `items.ts` (`BASE_ITEMS`); `zone2`/`zone3` export their own `ZONE{N}_ITEMS`.
- `temple.ts`: the temple zone+dungeon module: `TEMPLE_MOBS`/`TEMPLE_DUNGEON_MOBS`,
  `TEMPLE_NPCS`, `TEMPLE_QUESTS`/`TEMPLE_QUEST_ORDER`, `TEMPLE_ITEMS`, `TEMPLE_CAMPS`,
  `TEMPLE_OBJECTS`, `TEMPLE_PROPS`, `TEMPLE_DUNGEON_DEFS` (all merged in `data.ts`).
- `dungeons.ts`: `DUNGEON_MOBS` + spawn lists + `DUNGEON_DEFS`.
- `items.ts`: `BASE_ITEMS` (starter/quest/vendor/junk) + class-archetype groups +
  `FISHING_TABLES`/`FISHING_RARE_ID`.
- `warlock_pets.ts`: `WARLOCK_PET_MOBS` (summoned demon `MobTemplate`s).
- `augments.ts`: 2v2 Fiesta `AUGMENTS`/`POWERUPS` (flat `TalentEffect` picks + ring
  power-ups) and their eligibility/category helpers.
- `skins.ts`: cosmetic skin-select event data (ranks, roll weights, mech chromas,
  per-class skin counts); host-agnostic gating shared by Sim + HUD.
- `ground_pickup_lines.ts`: `GROUND_PICKUP_LINES` (deny/enough flavor text per
  collectible item id) + `groundPickupDeny`/`groundPickupEnough`.

## Classic-era fidelity (YOU MUST)
Abilities gain ranks at **classic-era learn levels** with era-accurate values. The
canonical table for levels 1 to 20, all 9 classes, is `docs/design/spell-ranks.md`:
cross-reference it; do not invent costs/levels/damage.

## How to add a class ability or a new rank
- **New ability:** add an entry to `ABILITIES` (`id`, `name`, `class`, `learnLevel`,
  `cost`, `castTime`, `cooldown`, `school`, `effects[]`, `icon`…), then **append its
  id to that class's `CLASSES[cls].abilities` array in learn order.**
- **New rank of an existing ability:** push `{ rank, level, cost, effects, [castTime,
  threatFlat] }` onto its `ranks: AbilityRank[]`. `abilitiesKnownAt` keeps the
  highest `rank` whose `level <= playerLevel`; rank rows reuse the base id.

## How to add quest / mobs / camps / dungeon / item
- **Quest:** add to `ZONE{N}_QUESTS` (`giverNpcId`, `turnInNpcId`, `text`,
  `objectives[]` of `{type:'kill',targetMobId}`, `{type:'collect',itemId}`, or
  `{type:'interact',targetObjectItemId}`,
  `xpReward`, `copperReward`, `itemRewards` keyed by class, optional `requiresQuest`,
  `minLevel`, `suggestedPlayers`), list its id in the giver NPC's `questIds`, and add
  it to `ZONE{N}_QUEST_ORDER`. `$N`/`$C` in text are runtime substitutions (player
  name / class), the client maps them to `{playerName}`/`{className}` (see i18n below).
- **Mob:** add to `ZONE{N}_MOBS`; quest-drop items go in the mob's `loot[]` with the
  matching `questId`. **Camp/spawn:** push `{mobId, center, radius, count}` to
  `ZONE{N}_CAMPS`. Collectible objects -> `ZONE{N}_OBJECTS`.
- **Dungeon:** add elites to `DUNGEON_MOBS`, build a `*_SPAWN_LIST: DungeonSpawn[]`,
  register a `DUNGEON_DEFS` entry (unique `index`, `doorPos`, `entry`, `interior`).
- **Item:** add to `BASE_ITEMS` (or `ZONE{N}_ITEMS`); class-locked rewards use
  `requiredClass: WAR|MAG|ROG` (archetype groups: `REWARD_ARCHETYPE` in data.ts
  shares rewards across the group, so lock the whole group, not one class).

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
- **Talent node/spec/mastery `name`+`description`:** localized via
  `src/ui/talent_i18n.ts` (reads `TALENTS`/`ABILITIES`); a talent name must be an
  ability name or get an explicit per-locale title override (guard tests fail
  otherwise).
- **Fiesta `AUGMENTS`/`POWERUPS` (augments.ts):** their English `name`/`description`
  are hand-mirrored into the `fiesta.augment.*`/`fiesta.powerup.*` keys in
  `src/ui/i18n.catalog/index.ts`: add the matching key when you add an augment.
- **Ground-pickup deny/enough + sim-emitted flavor:** the sim emits these as English
  through `this.error` (`def.pickupDeny ?? '…'` etc.). The **default fallback** strings
  have RULES in **`src/ui/sim_i18n.ts`** (`cannotTakeYet`/`offersNothingMore`/relic
  lines, via the `ITEM_EXTRA` table): register any new sim-emit literal there. The
  **custom per-item `GROUND_PICKUP_LINES` lines** are emitted via a variable, so the
  literal-only S3 guard can't see them and they currently ship English; treat that as
  a known English backstop, not a wired translation.
- **Contributors add ENGLISH only.** Never edit the 20 `src/ui/i18n.locales/<lang>.ts`
  overlays here: the build English-fills omissions and the maintainer batch-fills at
  release. Numbers baked into `description` strings (e.g. "15% harder") are part of the
  copy; don't hand-build money/number strings as gameplay data: the engine formats
  those for display.

## This data also feeds the public Guide/wiki
The Guide at `/wiki` (`src/guide/`) is generated from THIS directory, so player-facing
content you add here should reach it in the same change:
- After adding or renaming a class, ability, talent, zone, dungeon, mob, or warlock pet,
  run `npm run wiki:content` and commit the regenerated `src/guide/content.generated.ts`.
  It also runs in `pretest`/`build`, and `tests/guide.test.ts` fails CI if the committed
  file is stale, so a forgotten regen is caught.
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
  the Sim for `global.threatPct`. Add a new effect kind -> extend `StatModEffect`/
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
- Never reference a mob/item/npc/quest id that isn't defined (ids are matched by
  string at merge/runtime; there's no compile check that a `loot.itemId` exists).
- Content changes are usually tested: `tests/progression.test.ts`,
  `tests/talents.test.ts`, `tests/sim.test.ts`.
