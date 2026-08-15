<!-- Area-scoped: src/sim/content/ only. Root + src/ + src/sim/ CLAUDE.md already
     loaded: determinism, dependency rules, classic-fidelity, large-file norms,
     and the sim-emit -> client-matcher i18n flow live there. This file covers
     only the data-as-code conventions here. -->

# src/sim/content/ - data-as-code

Plain exported TypeScript records (mobs, npcs, quests, items, abilities, classes,
zones, dungeons, talents, recipes, gather nodes, mounts, deeds, reliquary pages).
**No engine logic lives here.** `sim/data.ts` is the merge point: it spreads the
content modules into the flat tables the engine reads (`ITEMS`, `MOBS`, `NPCS`,
`QUESTS`, `QUEST_ORDER`, `CAMPS`, `ESCORTS`, `GROUND_OBJECTS`, `GATHER_NODES`,
`ROADS`, `PORTALS`, `ZONES`, `PROPS`, `DUNGEONS`, `ITEM_SETS`,
`COMMON_RECIPES`/`ALL_RECIPES`, the graveyard/Spirit Healer surface, plus
`CLASSES`/`ABILITIES`). A few modules feed one sibling sim system directly
instead of the `data.ts` spread: `mailboxes.ts`/`letters.ts` (mail,
`src/sim/mail/post_office.ts`), `tunnels.ts` (`src/sim/voxel.ts`),
`enchants.ts` (`src/sim/professions/enchanting.ts`), `dungeon_difficulty.ts`
(`src/sim/instances/`), `vendor_row_gates.ts` (the vendor buy path in
`src/sim/items.ts` and, sharing the one resolver, the vendor window's pure view
core). All shapes are typed in `../types.ts`: add a field there first if you
need one.

## Where a new thing lands
- **New content RECORD** (mob/quest/item/ability/zone/recipe/node): a declarative
  entry in the matching module, merged via `data.ts`, never a table inline
  in `sim.ts`.
- **New content DOMAIN:** its own `<domain>.ts` here (or a subdirectory with an
  `index.ts` barrel, templates: `delves/`, `rift/`), spread into `data.ts` or
  imported by the one sim system that owns it.
- **New BEHAVIOR reading this data:** never here; a module behind the `SimContext`
  seam (see `src/sim/CLAUDE.md`; profession mechanics: `src/sim/professions/CLAUDE.md`).
- **Tests:** referential integrity + progression in `tests/progression.test.ts`;
  domain suites as `tests/<domain>*.test.ts` (exemplars: `tests/talents.test.ts`,
  `tests/gather_nodes.test.ts`).

## Map: the entries that carry a rule (`ls src/sim/content/` for the live set)
Most modules here are self-describing data. The ones below carry a convention
you cannot infer from the file alone.
- **Zones:** each named zone is its own module (`amberfall.ts`, `willowfen.ts`,
  `frostveil.ts`, ...) exporting `<NAME>_ZONE` plus `<NAME>_MOBS`/`_NPCS`/
  `_QUESTS`/`_QUEST_ORDER`/`_ITEMS`/`_CAMPS`/`_OBJECTS` (and where present
  `_ROADS`/`_PORTALS`/`_ESCORTS`/`_DUNGEON_DEFS`), each merged into the matching
  `data.ts` table and the `ZoneDef` registered in `ZONES`. The `ZONE{N}` naming
  survives only in the legacy trio `zone1.ts`/`zone2.ts`/`zone3.ts` (`zone1`
  items live in `items.ts` as `BASE_ITEMS`; `zone2`/`zone3` export their own
  `ZONE{N}_ITEMS`); a new zone follows the named-module convention, not
  `ZONE{N}`. `temple.ts` packs the temple zone + dungeon in one module;
  `realm.ts` is the Veiled Hollow (portal-only entry, sealed border).
- **Classes + talents:** `classes.ts` (`CLASSES`, `ABILITIES`,
  `abilitiesKnownAt`); the talents modules (see the Talents section below).
- **Dungeons:** `dungeons.ts` (elites, spawn lists, `DUNGEON_DEFS`);
  `dungeon_finder.ts` is the explicit Dungeon Finder activity registry: every
  fact the finder enforces or previews is authored THERE, never derived from
  spawn lists or mob names (loot previews deliberately excepted: the UI reads
  the canonical loot tables keyed by the encounter ids it declares).
- **Delves:** the `delves/` subdirectory (delve defs, `DELVE_MOBS`, companions,
  affixes, shop, lockpick tiers, the Collapsed Reliquary and Drowned Litany
  delves); import through its `index.ts` barrel.
- **Rifts:** the `rift/` subdirectory: `themes.ts` (per-floor environment
  archetypes the generator picks from), `mobs.ts` + `monster_index.ts` (the
  index is selection METADATA; combat still resolves through the static `MOBS`
  table, never runtime-built templates), `items.ts` (the rift gear id lists the
  Reliquary also reads), `infernal_citadel.ts` (a hand-authored set-piece floor
  a fraction of seeds opens; rank sets level/marks/loot, never the content).
  The generator itself is `src/sim/rift/rift_gen.ts`.
- **Heroic tier:** `dungeon_difficulty.ts` (tuning, read by `src/sim/instances/`),
  `heroic_loot.ts`, `heroic_vendor.ts`, `heroic_variants.ts`. Never hand-author a
  "Heroic X" item: `buildHeroicVariants` generates the variants (`heroicOf`) from
  base items + mob loot tables at `data.ts` assembly.
- **Professions data:** `professions.ts` (`CRAFT_RING`, `GATHERING_PROFESSIONS`,
  `TOOL_EFFECTS`, `PERK_THRESHOLDS`), `recipes.ts` (`COMMON_RECIPES`/`TOOL_RECIPES`/
  `CASTER_HUB_RECIPES`/`COMBO_RECIPES`, merged into `ALL_RECIPES`),
  `gather_nodes.ts`, `enchants.ts`, `vendor_row_gates.ts` (per-item proficiency
  requirements on NPC vendor rows, plus the one resolver both the authoritative
  buy path and the vendor view call), `profession_items.ts` (corpse-harvest
  components, Pristine specimens, master-stocked reagents; crafting materials
  are common/white ON PURPOSE so the junk sweep never vendors a reagent).
  Mechanics live in `src/sim/professions/`, never here.
- **Mounts:** `mounts.ts`, the declarative mount catalog (`MountKey` keyed),
  shared by the Sim's gates/hooks, the renderer's GLB mapping, and the HUD
  Mounts window. Every mount is a GROUND mount by design (no flying); the
  mechanics live in `src/sim/mounts.ts`.
- **WARFARE gear:** `pvp_honor.ts`, the ONE canonical honor-vendor stock both
  quartermasters (FURY and Warmarshal Draven Kole) sell from; its three shaping
  fractions are named constants so tests pin the constant, not a magic number.
- **Weapon skins:** `weapon_skins.ts` (Season 1 Armory catalog; skin ids double
  as economy SKU ids, so they must stay in lockstep with the service catalog;
  cosmetic only) + `weapon_skin_rules.ts` (weapon-type classification: every
  `kind:'weapon'` item in the merged `ITEMS` table must classify, guarded by
  `tests/weapon_skins.test.ts`; heroic variants reuse their base row).
- **`deeds.ts`, the Book of Deeds catalog:** `DEEDS` (`DeedDef` records; APPEND
  new deeds at the END of the table, since `DEED_ORDER` derives from table
  order; never reorder or retro-edit an existing trigger) + `DEEDS_ERA`.
  Cosmetic-only rewards, closed trigger vocabulary; the add-a-deed recipe and
  the every-new-conquerable-content rule live in `docs/design/deeds.md`, and
  `tests/deeds_content.test.ts` pins the catalog against the real content tables.
- **`reliquary.ts`, the Reliquary catalog** (see the Reliquary section below).
- **Dev-gated content:** `ptr_dev_vendor.ts` (the `/dev vendor` free-epic
  vendor, spawned on demand under `ALLOW_DEV_COMMANDS` only, never placed as
  permanent world content) and `dev_kit_roles.ts` (per-spec stat weightings for
  the `/dev kit` picker; a testing convenience, NOT a balance statement).
- **Interactables:** `noticeboards.ts` (town noticeboards; the active
  WorldContent supplies the list so spawn, collision, and interaction share one
  authority), `card_master.ts` (the Card Duel NPC gate constants).

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
**Placement rule for every coordinate below.** An authored `pos` is a WORLD
FIXTURE, not just data, so it inherits the screens `generateDecorations`
(`src/sim/world.ts`) applies to procedurally seated props: a yard of freeboard
over the water surface, walkable slope, no collider overlap, clear of a road, and
outside a reserved venue footprint such as `SOWFIELD_EXCLUDE` (the boarball
ground). Two guards own parts of that: `tests/placement_integrity.test.ts` walks
the calm-pad roster for classic ground and road reachability, and
`tests/gather_node_placement.test.ts` holds every gather-node coordinate to the
full list. Neither covers a NEW fixture category by itself, so a new authored
placement type needs its own coordinate arm in the same change. Skipping this has
shipped twice: six herb patches on a lake floor, and a sheenleaf patch growing
inside the Vale Cup pitch.
- **Quest:** add to the owning zone module's `<NAME>_QUESTS` (legacy trio:
  `ZONE{N}_QUESTS`) with `giverNpcId`, `turnInNpcId` (or `turnInNpcIds`
  for multiple valid turn-ins), `text`, `objectives[]` of `{type:'kill',targetMobId}`,
  `{type:'collect',itemId}`, or `{type:'interact'}` with `targetObjectItemId` (ground
  object) or `targetNpcId` (NPC), `xpReward`, `copperReward`, `itemRewards` keyed by
  class, optional `requiresQuest`, `minLevel`, `suggestedPlayers`; `retired` keeps a
  quest finishable but not newly acceptable, `shareable: false` opts out of quest
  links), list its id in the giver NPC's `questIds`, and add it to that zone's
  `<NAME>_QUEST_ORDER`. `$N`/`$C` in text are runtime substitutions (player
  name / class), the client maps them to `{playerName}`/`{className}` (see i18n below).
- **Mob:** add to the zone module's `<NAME>_MOBS`; quest-drop items go in the mob's
  `loot[]` with the matching `questId`. **Camp/spawn:** APPEND `{mobId, center,
  radius, count}` at the END of the merged `CAMPS` array in `data.ts`: camps
  spawn in array order, each drawing world-gen RNG, so an entry inserted earlier
  moves every later camp's spawn (determinism; see the comment above `CAMPS`).
  Never insert into a zone's `_CAMPS` list mid-array. Collectible objects go in
  the zone's `<NAME>_OBJECTS`.
- **Dungeon:** add elites to `DUNGEON_MOBS`, build a `*_SPAWN_LIST: DungeonSpawn[]`,
  register a `DUNGEON_DEFS` entry (unique `index`, `doorPos`, `entry`, `interior`),
  and give it a `dungeon_finder.ts` registry entry.
- **Item:** add to `BASE_ITEMS` (or the owning zone's items table). `requiredClass`
  is a `PlayerClass[]`; the `WAR`/`MAG`/`ROG` constants in `items.ts` are the
  ready-made archetype-group lists (`REWARD_ARCHETYPE` in `data.ts` shares rewards
  across the group, so lock the whole group, not one class). Every non-heroic item
  also needs its English name in the i18n catalog (see below), or CI fails. It
  also needs one exactly named `public/ui/items/<item-id>.webp` and one current
  provenance owner in `public/ui/items/mapping.json`, following the canonical
  `docs/design/item-icon-art-style.md` (`woc-item-icon-v1`) intake and review
  contract. Read the item's live name, quest/recipe relationship, set, and tier
  data before approving art; old icon subject matter is not authoritative when it
  contradicts content. Generated Heroic variants intentionally inherit their base
  item's painting.
- **Gather node:** add a `GatherNodeDef` (typed in `../types.ts`) to
  `gather_nodes.ts`; `level` is a one-time snapshot of the zone's `levelRange`
  midpoint, not a live lookup. Yield/respawn per node TYPE lives in
  `NODE_HARVEST_TABLE` (`src/sim/professions/gathering.ts`); rendering in
  `src/render/gather_nodes.ts` (a new node TYPE also needs `NODE_ASSET_URL`,
  `gather_nodes_lookup.ts`, and the `GatherNodeType` union). Respawn is per
  VIEWER. The COORDINATE carries the placement rule above and then some:
  `tests/gather_node_placement.test.ts` holds it to dry ground both under the
  prop AND across its whole `INTERACT_RANGE` harvest reach (a gatherer never
  wades to work a patch), plus slope, burial, hub reachability, zone containment,
  spacing, named-mob clearance, and the Sowfield screen. Run it after moving any
  `pos`. Tests: `tests/gather_nodes.test.ts`, `tests/gather_node_harvest.test.ts`,
  `tests/gather_node_placement.test.ts`.

## i18n: English names/text here are the source, localized at the client
This dir carries **no `t()`/i18n imports** (it's sim-side data) but its `name:`,
`description:`, `greeting:`, quest `text`/`completionText`, and the ground-pickup
flavor lines are **player-visible English**, re-localized at the client boundary.
The S3 guard mechanism and its blind spots are documented in `src/sim/CLAUDE.md`
(Player-facing text); what is content-specific here:
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
- **Talent spec/mastery/row-option `name`+`description`:** localized via
  `src/ui/talent_i18n.ts` (reads `TALENTS`/`ROW_TREES`);
  `tests/talent_tooltip_accuracy.test.ts` pins tooltip coverage and holds
  non-grant English row tooltips byte-equal to the authored source.
- **Fiesta `AUGMENTS`/`POWERUPS` (augments.ts):** their English `name`/`description`
  are hand-mirrored into the `fiesta.augment.*`/`fiesta.powerup.*` keys in
  `src/ui/i18n.catalog/index.ts`: add the matching key when you add an augment.
- **Ground-pickup deny/enough + sim-emitted flavor:** the sim emits these as English
  through `this.error` (`def.pickupDeny ?? '...'` etc.). The **default fallback**
  strings have RULES in **`src/ui/sim_i18n.ts`** (via the `ITEM_EXTRA` table):
  register any new sim-emit literal there. The **custom per-item
  `GROUND_PICKUP_LINES` lines** are emitted via a variable, so the literal-only S3
  guard can't see them and they currently ship English; treat that as a known
  English backstop, not a wired translation.
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

## Talents: specs plus choice rows (`talents.ts` + `talent_rows.ts`)
The live model has NO talent trees: no nodes, no `requires`, no `pointsGate`.
- **Shape:** a class's talents are `ClassTalents = { class, specs }` (each
  `SpecDef` carries a `signature` ability and a `mastery` effect) plus ONE
  class-wide row tree: one choice per row at `ROW_LEVELS` (5/8/11/14/17/20),
  `OPTIONS_PER_ROW` options each. `TalentAllocation` is `{ spec, rows }`.
- **Authoring files:** specs in `talents_warrior.ts` (warrior) and
  `talents_classic.ts` (the other eight); row trees in `warrior_rows.ts` and
  `choice_rows_classic.ts`, registered in `ROW_TREES` (`talent_rows.ts`, which
  `talents.ts` re-exports); per-spec passive floors in `spec_baselines.ts` (the
  v0.28 hotfix baseline, deliberately absent for some classes, see its header);
  row-granted active-ability defs in `talent_abilities_v2*.ts`, spread into
  `ABILITIES` by `classes.ts`. An option whose mechanic is not built yet ships
  `effect: {}` (folds to nothing; see the PHASING note in `warrior_rows.ts`).
- **Validation throws at import**, so a malformed registration cannot load:
  `validateTalentTree` (duplicate spec ids, spec/class match, signature/mastery
  presence) and `validateRowTree` (row levels, option shape, duplicate option
  ids).
- **Flat-precompute invariant:** an allocation is resolved **once** via
  `computeTalentModifiers` into a flat `TalentModifiers` (stats / per-ability
  mods / global / grants / the `selected` option-id map). Hot paths read only
  those flats: **never walk talent state per tick.** Three hook points consume
  them: `recalcPlayerStats` (entity.ts) for stats, `abilitiesKnownAt`/
  `applyTalentMods` (classes.ts) for ability mods + `grants`, and the Sim for
  `global.threatPct`. Add a new effect kind: extend `StatModEffect`/
  `AbilityModEffect`/`GlobalModEffect`, fold it in `accumulateTalentEffect`,
  then apply it at a hook.
- Build strings (`exportBuild`/`importBuild`, base64) and the loadout type
  (`SavedLoadout`, `MAX_LOADOUTS`) live here; the allocation verbs
  (`selectTalentRow`, `setTalentSpec`, `respecTalents`, loadout ops) live in
  `src/sim/progression/talents.ts`. Allocation is **server-authoritative**:
  `validateAllocation` re-checks on apply regardless of UI.
- Tests: `tests/talents.test.ts`, `tests/talent_rows_core.test.ts`, the
  per-class `tests/choice_rows_*.test.ts` suites, and
  `tests/talent_tooltip_accuracy.test.ts` (i18n section above).

## Reliquary catalog (`reliquary.ts`)
Data-as-code shelves, pages, and relic slots plus pure projections; runtime
marks and completion math live in `src/sim/reliquary.ts`, and the authoring
contract is `docs/design/reliquary.md`.
- **The page table is append-only once product pages ship:** append new pages
  at the END, never reorder or remove an id.
- **Curation, not scraping:** every relic is hand-listed (rare+ chase uniques,
  signature dungeon brand pieces, heroic boss gear, epic set members).
  Heroic upgraded variants (`heroic_<base>`) are NOT catalogued: discovery
  credits the base id, so listing both double-counts completion.
- **Source hints are structured ids, never prose** (`ReliquarySourceHints`; a
  relic with several comparable live routes names ALL of them). A relic may
  carry no hint only where content names no route; those slots live in
  `SOURCE_PENDING_RULING` in `tests/reliquary_content.test.ts`, a visible
  maintainer decision rather than an invented answer.
- **`excludeFromCompletion` (`'retired' | 'personal'`)** drops a page from BOTH
  sides of every completion pair; use it instead of deleting a shipped page.
- New conquerable unique loot authors its Reliquary page in the SAME change
  (root new-content obligations); `tests/reliquary_content.test.ts` pins the
  catalog.

## Never do here
- Never reference a mob/item/npc/quest id that isn't defined. Ids are matched by
  string at merge/runtime (no compile check), but `tests/progression.test.ts` fails
  CI on any dangling id ("all loot tables, vendor stock, camps and dungeon spawns
  resolve"; a collect objective also needs an acquisition source). Run
  `npx vitest run tests/progression.test.ts` after wiring new content.
- **Never delete or rename a SHIPPED item id.** Once an id exists on main or any
  `release/**` branch it may have reached a deployed realm, and player saves keep
  raw item ids in equipment, bags, bank, mail attachments, and market listings,
  loaded verbatim with no validation: an id that stops resolving in `ITEMS` renders
  as an Empty slot with zero stats while sitting dormant in the save (v0.25.0
  deleted four heroic defs this way and 18 prod characters lost visible gear). To
  remove an item from the game, RETIRE it: keep the def and remove every
  acquisition path (exemplar: `RETIRED_HEROIC_ITEMS` in `heroic_loot.ts`). Renames
  are display-only through the i18n catalog; the id stays frozen. Watch the
  generated tier too: dropping a base item from a mob's `loot[]` also deletes its
  generated `heroic_<id>` variant def, which players may hold. Only an item that
  never left your unmerged feature branch may be deleted outright.
  `tests/shipped_item_ids.test.ts` pins every shipped id against `ITEMS`
  (append-only golden; after a release re-mint with `UPDATE_SHIPPED_ITEMS=1` and
  review the diff as additions-only).
