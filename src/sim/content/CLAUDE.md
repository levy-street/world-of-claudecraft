<!-- Area-scoped: src/sim/content/ only. Root + src/ + src/sim/ CLAUDE.md already
     loaded — determinism, dependency rules, vanilla-fidelity, large-file norms
     live there. This file covers only the data-as-code conventions here. -->

# src/sim/content/ — data-as-code

Plain exported TypeScript records (mobs, npcs, quests, items, abilities, classes,
dungeons, talents). **No engine logic lives here.** `sim/data.ts` imports every
module and spreads it into the flat tables the engine reads (`ITEMS`, `MOBS`,
`NPCS`, `QUESTS`, `QUEST_ORDER`, `CAMPS`, `GROUND_OBJECTS`, `ROADS`, `ZONES`,
`PROPS`, `DUNGEONS`, plus `CLASSES`/`ABILITIES`). All shapes are typed in
`../types.ts` — add a field there first if you need one.

## Key files
- `classes.ts` — `CLASSES` (per-class base/per-level stats, kit) + `ABILITIES`
  (defs with `ranks[]`) + `abilitiesKnownAt()` (resolves kit + rank + talent mods).
- `talents.ts` — the talent framework (types, validation, precompute, build strings).
- `talents_warrior.ts` / `talents_classic.ts` — the authored trees: warrior lives in
  `talents_warrior.ts`, the other 8 (paladin…druid) in `talents_classic.ts`. Copy
  `talents_warrior.ts` as the template for any new tree.
- `zone1.ts`/`zone2.ts`/`zone3.ts` — one zone each. `zone1` items live in
  `items.ts` (`BASE_ITEMS`); `zone2`/`zone3` export their own `ZONE{N}_ITEMS`.
- `dungeons.ts` — `DUNGEON_MOBS` + spawn lists + `DUNGEON_DEFS`.
- `items.ts` — `BASE_ITEMS` (starter/quest/vendor/junk) + class-archetype groups.
- `professions.ts` — the profession framework: `PROFESSIONS` + `RECIPES`
  registries (`ProfessionDef`/`RecipeDef`/`ProfessionTier`), cloth bands/scrap,
  difficulty coloring, learning-cost helpers, and `validateProfessions` (run at
  `data.ts` load). Merged into `PROFESSIONS`/`RECIPES` flat tables.

## Vanilla fidelity (YOU MUST)
Abilities gain ranks at **real vanilla learn levels** with real values. The
canonical table for levels 1–20, all 9 classes, is `docs/design/spell-ranks.md` —
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
  `objectives[]` of `{type:'kill',targetMobId}` or `{type:'collect',itemId}`,
  `xpReward`, `copperReward`, `itemRewards` keyed by class, optional `requiresQuest`,
  `minLevel`, `suggestedPlayers`), list its id in the giver NPC's `questIds`, and add
  it to `ZONE{N}_QUEST_ORDER`. `$N`/`$C` in text are runtime substitutions.
- **Mob:** add to `ZONE{N}_MOBS`; quest-drop items go in the mob's `loot[]` with the
  matching `questId`. **Camp/spawn:** push `{mobId, center, radius, count}` to
  `ZONE{N}_CAMPS`. Collectible objects → `ZONE{N}_OBJECTS`.
- **Dungeon:** add elites to `DUNGEON_MOBS`, build a `*_SPAWN_LIST: DungeonSpawn[]`,
  register a `DUNGEON_DEFS` entry (unique `index`, `doorPos`, `entry`, `interior`).
- **Item:** add to `BASE_ITEMS` (or `ZONE{N}_ITEMS`); class-locked rewards use
  `requiredClass: WAR|MAG|ROG` (archetype groups — `REWARD_ARCHETYPE` in data.ts
  shares rewards across the group, so lock the whole group, not one class).

## Talents framework (`talents.ts`)
- **Flat-precompute invariant:** an allocation is resolved **once** via
  `computeTalentModifiers` into a flat `TalentModifiers` (stats / per-ability mods /
  global / grants). Hot paths read only those flats — **never walk the tree per tick.**
- Three hook points consume the flats: `recalcPlayerStats` (entity.ts) for stats,
  `abilitiesKnownAt`/`applyTalentMods` (classes.ts) for ability mods + `grants`, and
  the Sim for `global.threatPct`. Add a new effect kind → extend `StatModEffect`/
  `AbilityModEffect`/`GlobalModEffect`, fold it in `accumulate`, then apply it at a hook.
- **Authoring a class tree:** copy an existing tree (Class nodes + per-spec nodes
  with `specId`/`row`/`col`/`requires`/`pointsGate`, `kind: passive|active|choice`,
  + `SpecDef`s with `signature`/`mastery`), then register it in `TALENTS` in talents.ts.
  **All 9 classes are already registered** (warrior in `talents_warrior.ts`, the other
  8 in `talents_classic.ts`). `validateTalentTree` runs at import and **throws on a
  malformed tree** (dup ids, bad prereqs, cycles, unreachable gates) — a broken tree
  won't load.
- Build strings (`exportBuild`/`importBuild`, base64), loadouts (`SavedLoadout`,
  `MAX_LOADOUTS`), dormant-node detection, and respec all live here. Allocation is
  **server-authoritative**: `validateAllocation` re-checks on apply regardless of UI.

## Professions framework (`professions.ts`)
- **Pure data + helpers, no engine logic** (the Sim owns learn/craft/skill-up).
  `PROFESSIONS` (`ProfessionDef`) and `RECIPES` (`RecipeDef`) are flat registries;
  `validateProfessions(ITEMS)` runs at `data.ts` import and **throws** on a bad
  registry (unknown reagent/output item, disordered difficulty thresholds, a recipe
  gated above `maxSkill`), same fail-fast pattern as `validateTalentTree`.
- **Adding a profession:** add a `ProfessionDef` (`kind: primary|secondary`, its
  two `STANDARD_TIERS`, recipe ids) + its `RecipeDef`s here, a trainer NPC
  (`NpcDef.trains: '<profId>'`) in a zone file, and any material/output items in
  `items.ts`. No engine change — the Sim reads the registry.
- **Recipes are trainer-taught, not skill-unlocked:** a recipe must be in the
  character's `learnedRecipes` to craft, even once `requiredSkill` is met. Difficulty
  color (orange→grey, keyed off `requiredSkill`/`yellowAt`/`greenAt`/`greyAt`) drives
  the skill-up chance. Costs come from `tierLearnCost`/`recipeLearnCost` (don't inline
  cost numbers). Learn/craft are **server-authoritative** (validated in `sim.ts`).
- Today only First Aid (secondary) is authored; cloth bands (`CLOTH_BANDS`) and the
  `gatherSkill` type stub are the seams for the gathering/production professions in
  PRs 2–3 — see `docs/prd/professions-and-crafting.md`.

## Never do here
- Never put combat/sim behavior in a content file — it stays declarative data.
- Never reference a mob/item/npc/quest id that isn't defined (ids are matched by
  string at merge/runtime; there's no compile check that a `loot.itemId` exists).
- Content changes are usually tested: `tests/progression.test.ts`,
  `tests/talents.test.ts`, `tests/sim.test.ts`.
