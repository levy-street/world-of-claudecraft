# Five-player dungeon rework

Status: design only, nothing here is implemented. Pilot: The Hollow Crypt
(`hollow_crypt.md`). The other four dungeons get their own file after the pilot
is approved and built; their sections below are placeholders on purpose.

Scope: every current 5-player dungeon, normal and heroic. Raids (Nythraxis,
the Ignivar/Varkhul Crucible) are out of scope.

| Dungeon | Id | Levels (finder) | Final boss (kept) | File |
|---|---|---|---|---|
| The Hollow Crypt | `hollow_crypt` | 7 to 10 | Morthen the Gravecaller | `hollow_crypt.md` (pilot) |
| The Sunken Bastion | `sunken_bastion` | 12 to 13 | Vael the Fogbinder (id `vael_the_mistcaller`) | after pilot |
| The Drowned Temple | `drowned_temple` | 16 to 18 | Ysolei, Avatar of the Drowned Moon | after pilot |
| Gravewyrm Sanctum | `gravewyrm_sanctum` | 19 to 20 | Korzul the Gravewyrm | after pilot |
| The Wildheart Basin | `wildheart_basin` | 20 | Zulgar, Voice of the Basin (id `wildheart_high_priest`) | after pilot |

Levels verified against `src/sim/content/dungeon_finder.ts` (`FINDER_ACTIVITIES`);
every heroic is level 20 entry with mobs rebased to level 22
(`HEROIC_DUNGEON_TUNING` in `src/sim/content/dungeon_difficulty.ts`).

## 1. Goals

1. Every dungeon is a place, not a corridor: distinct spaces with their own
   geography (halls, caverns, courtyards, balconies, ramps and overlooks, a wing
   that branches and rejoins), landmarks visible from afar, packs and patrols you
   see coming and plan around, and a memorable arena per boss.
2. Two to four real bosses per dungeon, each with a UNIQUE core gimmick (no two
   bosses in a dungeon share the same core mechanic), readable telegraphs, and a
   job for each role.
3. Heroic is the same dungeon and bosses with higher numbers AND one to two extra
   mechanics per boss that twist its core gimmick.
4. Every boss has its own loot table, normal and heroic. Loot is no longer
   concentrated on the final boss.
5. A good group clears a dungeon in about 15 minutes.

## 2. Binding principles (maintainer and owner rulings)

- **Complete rework is allowed.** Names, layout and even the dungeon's map position
  may change if it makes a better dungeon. Ids stay frozen; renames are
  display-only (`docs/design/naming-audit.md` protocol). Any move of the entrance
  must keep it reachable and list its world-map, portal and quest implications.
- **No skipping.** Every trash pack is mandatory. The route is gated by seals and
  gates that open when the packs behind them die, bridges or stairs that unseal on
  a pack clear, and boss arenas sealed until the packs before them are cleared.
  Gating is spatial (gates in big spaces), never narrow corridors.
  `DungeonDef.bossChainPull` (`src/sim/instances/boss_chain_pull.ts`) stays on as
  the belt-and-braces punish.
- **Unique mechanics per boss.** A boss's core gimmick appears on no other boss of
  the same dungeon. Trash packs exist to TEACH the next boss's gimmick in a
  friendlier form.
- **Classic-era math.** Health and damage come from stated bases: health from a
  target fight length times measured party DPS, damage anchored to the shipped
  mechanic numbers and the existing heroic calibration (the 500-swing floor in
  `dungeon_difficulty.ts`). Numbers in these docs are planning values to be
  calibrated with the meters harness, never shipped unmeasured.
- **Original names.** Every new proper noun is web-checked (exact phrase plus the
  coined token against the major game wikis) before it ships; each design file
  carries its verdict table. Blizzard or any other game may inspire a mechanic
  conceptually, never a name, layout or recognizable replica.
- **Readability over spectacle.** Decoration never out-glows a telegraph (the
  Buried Hoard room rule, `docs/design/boss-rooms/README.md`). Graphics presets
  never hide a telegraph (`docs/design/graphics-settings-fairness.md`).

## 3. The mechanic toolkit

### 3.1 What exists and is reusable today

| Piece | Where | Use in the rework |
|---|---|---|
| Timed and threshold boss kit: `aoePulse`, `bigCast` (cast-bar nova), `breathCone` (cast-bar frontal cone), `infernoChannel`, `stomp`, `summonAdds`, `enrage`, `desperateHeal`, `wardAllies`, `warcry`, `rally` | `MobTemplate` in `src/sim/types.ts`; drivers in `src/sim/mob/locomotion.ts`, `mob/boss_mechanics.ts` | Most secondary abilities are pure data on these |
| On-hit affix cascade (venom, stackPoison, frostbite, knockback, silence, mortalStrike...) | `src/sim/mob/mob_swing.ts` | Trash identity and boss melee flavor |
| Interruptible scripted mob channels | `src/sim/mob/healer_channel.ts` (`SCRIPTED_INTERRUPTIBLE_CHANNELS`) | Caster trash and interrupt checks |
| Player interrupts, baseline | `pummel` (L8), `counterspell` (L4), `kick`, `counter_shot`, `rebuke`, `skull_bash` (L10), `spell_lock` | Interrupt checks at heroic; forgiving at low-level normal |
| Brood eggs and pouncing whelps | `broodEgg` / `broodWhelp`, `mob/dragonkin_brood.ts`, `mob/egg_hatchling.ts` | Egg sacs and hatchlings (spider bosses and trash) |
| Hoard ground telegraph wire: `hoardBossCue` (kind `sweep` / `mark`, `warning` then `hazard` phase) | `src/sim/types.ts`, `src/sim/rift/hoard_boss_kits.ts`, `rift/hoard_cave_kit.ts` | The telegraph vocabulary; needs generalizing (G1) |
| Cocoon rescue, silk snare lines, soul-harvest walkers | `rift/hoard_cocoon*.ts`, `rift/hoard_silk_snare.ts`, `rift/hoard_bone_reaper*.ts` | Reused mechanics, re-authored for dungeon claims |
| Interactable channel during a boss immune phase (wardstones) | `src/sim/encounters/nythraxis.ts` (Deathless Rage) | Environment interaction phases |
| Stack/split bomb | `src/sim/nythraxis_soul_rend.ts` | Available; not used by the pilot |
| Cast-bar spacing lock (no two mechanics on one tick) | `src/sim/mob/mechanic_spacing.ts` (rift-stamped today) | Stamp on dungeon bosses too |
| Pack pull identity | `DungeonSpawn.packId`, `mob/dungeon_pack_aggro.ts` | Also the key for gates (G7) |
| Premature boss pull punish | `instances/boss_chain_pull.ts` | Kept on every reworked dungeon |
| Gate-tagged colliders (open/closed per gate id) | `colliders.ts` `setColliderGateOpen`, `transport_gates.ts` | The primitive under dungeon gates (G7) |
| Line of sight vs colliders | `Sim.hasLineOfSight`, `entityLineOfSightClear` | LOS-break mechanics behind pillars. Ordinary mob casts at a target obey it too (`src/sim/mob/cast_sight.ts`, the kit's bars through `mob/trash_kit/kit_cast_sight.ts`): no cast begins or lands without a line of sight, and inside an instance a caster without one walks round the wall to get it (`mob/chase_route.ts`, a bounded and budgeted search), as a melee mob stopped by a wall does. A caster NO route brings to a sight line (its target behind a sealed gate) no longer casts through the wall: it falls to the instance hold like melee (held immune, then through the geometry). Bosses and scripted great bodies (`mob/encounter_body.ts`) are left out of both rules |
| Heroic transform (level 22, health/damage multipliers, `mechanicDamageMult`) | `src/sim/instances/difficulty.ts` | Heroic numbers ride this unchanged |
| Weighted loot partitions | `src/sim/loot/weighted_loot_group.ts`, `HEROIC_BOSS_LOOT` | Per-boss tables |

### 3.2 New generic systems the rework needs

Each is its own module behind the `SimContext` seam (root CLAUDE.md "module-first"),
built once and reused by every dungeon. Effort is for one developer-agent with
reviews, planning grade.

| Id | System | Shape | Effort |
|---|---|---|---|
| G1 | Instance encounter cues | Generalize `hoardBossCue` to any claimed instance (scope by claim, not by rift instance); the renderer's floor-telegraph painter reused | 3 to 4 days |
| G2 | Dungeon phase driver | Declarative phases on hp thresholds: transition cast, immune window, per-phase ability set; resets on evade | 3 days |
| G3 | Encounter interactables | Channel-to-activate objects (candles, levers) interrupted by damage, per-claim state; generalized from the Nythraxis wardstones | 2 to 3 days |
| G4 | Marked persistent hazard | Mark a player, fuse, drop a persistent zone at their position, cap and oldest-collapses rule (the P2 `groundHazard` of `docs/prd/dungeon-mechanic-primitives.md` with a `markedPlayer` placement) | 2 days |
| G5 | Walker adds | Adds that walk to a destination (boss or urn) and empower it on arrival; generalized from Soul Harvest (P9 empowerer role) | 2 days |
| G6 | LOS-gated interruptible nova | `bigCast` variant: `losOnly`, `interruptible`, optional silence, `uninterruptibleEvery` | 1 to 2 days |
| G7 | Dungeon gates and encounter seals | `DungeonDef.gates`: gate-tagged colliders per instance slot, open on pack or boss death, optional seal-while-engaged (the seal lands `BOSS_ROOM_SEAL_DELAY_SECONDS` into the fight, `src/sim/instances/dungeon_gates.ts`); wire field so `ClientWorld` mirrors collision; closes again only on instance reset | 3 to 4 days |
| G8 | Mob patrols | `DungeonSpawn.patrol` waypoint loop for idle mobs, zero rng (escort walker precedent `src/sim/escort.ts`) | 2 days |
| G9 | Authored interior system | See section 4 | 12 to 16 days (sim plus render) |

## 4. Interiors: what the engine supports now vs what big layouts need

**Supported now:**
- `DungeonLayout` rectangular naves (`src/sim/dungeon_layout.ts`): one long
  room, pillar and tomb grids, waist stubs, a raised dais. The Hollow Crypt and
  the Sunken Bastion share one such nave (`CRYPT_LAYOUT`). This is the corridor
  feel the rework replaces.
- Authored room graphs (`src/sim/rift/authored.ts`: `rooms` with per-room `lift`,
  `doors` that become ramps between lifts, `decor` with measured colliders,
  `ledges`). Proven by the rift castle set pieces; axis-aligned boxes only, one
  floor height per room, rift-only consumer today.
- Open-field interiors (`src/sim/wildheart_field.ts` plus
  `src/render/wildheart_terrain.ts` and `wildheart_props.ts`): a per-dungeon height
  function wired into `world.ts` `groundHeight`, boundary walls, prop placements
  with colliders. Proves a 164 by 266 yd dungeon works inside one instance slot
  (slot spacing is 600 yd in x per dungeon index and 500 yd in z per slot,
  `INSTANCE_SLOT_COUNT` 24 in `data.ts`), with pathing, LOS and combat. But it is
  bespoke code per dungeon.
- Buried Hoard valleys and themed boss rooms: render-side cliff perimeters and
  modular Blender kits on a pure plan core (`src/render/hoard_valley_core.ts`,
  `hoard_room_kit_core.ts`), open-air and seeded.
- Gate-tagged colliders (ferry berths) and LOS against colliders.

**Limits that shape the designs:**
- The ground is a single-valued height function. Upper and lower levels are
  terraces side by side with ramps and cliff walls between them; nobody walks
  UNDER a balcony or bridge. Overlooks look onto an adjacent lower terrace.
- Instanced interiors move bodies through `resolveMove`, not the open-world
  physics engine, so one-way drops are designed as a ramp plus a seal behind the
  group, not a free fall. Voxel tunnels (`voxel.ts`) are engine-only and not wired
  to colliders or pathfinding.
- No in-instance gates and no dungeon patrols exist yet (G7, G8).

**What a big WoW-scale layout requires (G9, the Authored Interior system):**
one generic data shape per dungeon, generalizing Wildheart:
`bounds`, `terraces` (polygons with a base height and linear ramp blends),
`walls` (boxes and polyline cliffs; a cliff collider is generated where two
terraces differ by more than the step height), `props` (kit piece key, transform,
measured collider), `gates` (G7), `patrols` (G8), `lightZones` (per-room light
rig and fog). Consumers: one generic arm in `world.ts` `groundHeight`, one interior
collider set in `colliders.ts`, pathfinding and LOS unchanged (they already read
colliders and height), and one render painter (`src/render/authored_interior.ts`
with a pure plan core registered in `RENDER_PURE_CORES`) that builds the terrain
mesh from the height function and instances the dungeon's kit GLB. Wildheart can
migrate onto it later; it does not have to.

Cost: sim side 6 to 8 days with tests (height, colliders, gates, pathing
reachability of every pack and every gate), render side 6 to 8 days (terrain mesh,
kit instancing, light zones, prewarm through the preparation scheduler per
`src/render/CLAUDE.md`), then per dungeon a layout pass (3 days) and a Blender kit
(5 to 8 days).

## 5. Heroic philosophy

- Same dungeon, same bosses, same route. Numbers come from the existing heroic
  transform (level 22, the dungeon's `HEROIC_DUNGEON_TUNING` row, per-mob
  overrides where a boss needs its own).
- Each boss gains one or two heroic-only mechanics that TWIST its core gimmick
  (the normal fight teaches the lesson, heroic tests it under pressure). Never an
  unrelated new mini-game.
- Heroic assumes the group owns interrupts (every class has one by level 10) and
  one dedicated tank; normal at low levels must stay survivable with none.
- Finder previews list heroic extras in a separate heroic encounter array (the
  Nythraxis and Ignivar heroic-array precedent in `dungeon_finder.ts`), so normal
  never advertises a heroic mechanic.

## 6. Difficulty and length targets

| Dungeon | Bosses | Trash pulls | Target clear (good group) | Target boss fights |
|---|---|---|---|---|
| The Hollow Crypt | 4 | 9 | about 15 min (about 16.5 since the playtest pools of 2026-10-12, `hollow_crypt.md` section 4) | 70 s, 80 s, 80 s, 150 s, then the Knellwyrm's 80 s outside Morthen's 150 |
| The Sunken Bastion | 3 to 4 | 9 to 11 | about 15 min | after pilot |
| The Drowned Temple | 3 to 4 | 9 to 11 | about 15 min | after pilot |
| Gravewyrm Sanctum | 4 | 10 to 12 | about 15 to 17 min | after pilot |
| The Wildheart Basin | 3 to 4 | 10 to 12 | about 15 to 17 min | after pilot |

Pacing rule: a trash pull costs about 55 s with walking and recovery; bosses
total 5 to 7 minutes (the Crypt's four are 6.3; its Knellwyrm finale adds about
1.35 on top since 2026-10-12, which is what takes its normal run past 15). Boss health is set as target duration times measured party
DPS at the boss's level (`NormalDungeonTuning.healthMultiplierByMob`), never
guessed.

**Heroic health bands (owner, 2026-10-12).** On heroic the lengths above gave pools
a geared level 20 party killed too fast, so the heroic pools sit in bands instead:
a non-final boss carries about 25,000, a miniboss 15,000 to 20,000 (clearly under
the bosses), and final bosses keep their own pools (28,800 to 36,800). The bosses
that already sat at about 23,000 (the Tideglass Colossus, Velkhar, the Fanglord
Beastmaster and his jaguar, the Gorgebloom) were left unchanged by the owner's
call: "about 25,000" was not read as a floor for them. Which body is which
follows the Dungeon Finder catalogue (`src/sim/content/dungeon_finder.ts`) with
two rulings on top: a body in its dungeon's encounter list is a boss, and a named
solo elite outside it is a miniboss, EXCEPT that the Gaol Turnkey is listed but is
the gaol's miniboss by its own content, and the Mere Hydra is a boss by the
owner's ruling of 2026-10-12 although the list on this branch has no row for it
(the row lands with the tracker branch `fix/dungeon-tracker-hydra-boss`). Normal
BOSS pools keep their designed lengths. On normal the owner's rule (2026-10-12) is
that a miniboss carries clearly less than every boss of its dungeon: at most three
quarters of the weakest one's pool. The designed miniboss pools already sat there,
so they stand; the heroic band factors are NOT carried to normal (a first pass did,
and left the Captain, the Turnkey and the Tusker at about 90 percent of their
weakest boss). Health only:
melee and mechanic factors do not move, and a check sized by a share of the pool
keeps the absolute damage it asked for (the Lady's Frozen Embrace, the Mere Hydra's
regrown head).

The Mere Hydra's heroic fight, measured at the planning 230 (by hand, in real
fights; no suite replays them):
with the heads brought down together (the intended play, and the deed) 63 s became
121 s, with two Tsunamis where there was one and four Combined Breaths where there
were two; killing one head at a time, 98 s became 201 s with seven regrowths where
there were three. Enraged Hydra counts the heads lying dead (two at most), so its
level cannot pass the design, but a group that kills head by head now fights under
it for about 133 s where it was 67 s.

| Dungeon | Bosses at about 25,000 (was) | Minibosses in 15,000 to 20,000 (was) | Normal minibosses (share of the weakest normal boss) |
|---|---|---|---|
| Hollow Crypt | Sexton Marrow 24,996 (16,099), Lady of the Bonechill 24,999 (18,382), Cantor Ilvane 24,996 (14,687) | Ossuary Drake 15,872 (7,936), Knellwyrm 18,403 (7,254) | Drake 2,079 (was 1,040) and Knellwyrm 2,357 (was 1,081): 66 and 75 percent of Marrow's 3,152 |
| Sunken Bastion | Knight-Commander Olen 24,999 (18,382), Gaoler Ossick 24,999 (19,530) | Shipwreck Captain 16,996 (13,801), Gaol Turnkey 15,994 (11,041) | Captain 4,495 and Turnkey 3,599, unchanged: 75 and 60 percent of Olen's 5,995 |
| Drowned Temple | Choirmother Selthe 25,004 (20,650); Mere Hydra 8,333 a head, 24,999 in all (4,306 a head); Tideglass Colossus 23,003 unchanged | none | none |
| Wildheart Basin | Beastmaster and jaguar 23,005, Gorgebloom 23,003, all unchanged | Great Saurian 14,998 unchanged | Great Saurian about 10,000, unchanged: about two thirds of the 15,000 bosses |
| Gravewyrm Sanctum | Korgath the Bound 25,004 (18,391), shackles unchanged; Velkhar 22,991 unchanged | Sledge Tusker 16,002 (13,796) | Tusker 8,992, unchanged: 75 percent of Korgath's 12,007 |

Pinned from live spawns by `tests/hollow_crypt_boss_pools.test.ts`,
`tests/hollow_crypt_knellwyrm_pool.test.ts` and the four
`tests/*_health_bands.test.ts` suites.

## 7. Loot philosophy

- **Every boss has its own table**, normal and heroic.
- **Normal:** each boss drops one guaranteed equipment piece from its own table
  (uncommon or rare), one armor type per class archetype across the table
  (cloth caster, leather agile, mail heavy), plus a small rare chase row. The final
  boss keeps its existing bonus group. Item level = source level (boss level) plus
  the quality bump (`QUALITY_ILVL_BONUS`), stats exactly at `primaryStatBudget`
  (`src/sim/item_budget.ts`).
- **Heroic:** one equipment item per boss kill, the cadence of
  `docs/design/instance-loot-budgets.md` (one item per five intended players per
  boss kill). Heroic epics read source level 25 (`HEROIC_LOOT_SOURCE_LEVEL`, item
  level 31); base drops upgrade through `heroicOf` variants (never hand-authored).
  A four-boss heroic therefore pays four items per clear instead of one: an
  economy decision for the maintainer (section 10).
- **Trinkets:** one primary stat each, a use or passive effect of their own, never
  "+stats on use", never a duplicate of an effect in `src/sim/content/trinkets.ts`.
  Heroic only (every trinket is level 20).
- **Never delete a shipped item id.** Items move between bosses by editing loot
  tables; nothing is removed from `ITEMS`.

### 7.1 Loot redistribution (maintainer ruling, 2026-10-08)

The reworked dungeons have enough bosses to carry loot the raid table was
diluting, and final bosses were carrying most of each dungeon's heroic epics.

- **Nythraxis keeps a short table.** The raid's shared roll keeps the two
  legendaries (still exactly 3% each) and its common pieces; its low-weight pieces
  (`NYTHRAXIS_RELOCATED_ITEM_IDS` in `src/sim/content/nythraxis_loot.ts`) moved to
  the dungeons, and its four class trinkets (`NYTHRAXIS_RELOCATED_TRINKET_IDS`)
  left the heroic raid roll, which now pays only the bespoke heroic weapons.
- **Each relocated piece has one home boss** in the Gravewyrm Sanctum or the
  Wildheart Basin. Its Normal copy rides that boss's one bonus roll (so a kill
  never pays an extra item) and its Heroic copy drops from the same boss's heroic
  roll, which keeps the Reliquary rule that a dungeon page's relics are paid on
  both difficulties. Most pieces also drop as their Heroic copy from one Hollow
  Crypt, Sunken Bastion or Drowned Temple heroic boss (`THORNPEAK_SHARE` there,
  `THORNPEAK_HOME_SHARE` at home; `src/sim/content/heroic_loot.ts`). The trinkets
  went to the heroic bosses whose fights they echo (the Mooring Stone to Gaoler
  Ossick, the Echoing Lens to the Tideglass Colossus, the Hunter's Tally to the
  Wildheart Beastmaster, the Wellspring Seed to the Gorgebloom).
- **Moved pieces keep their raid tier.** `item_level.ts` (`buildSourceIndex`,
  the heroic-raid index) and `heroic_variants.ts` anchor the relocated ids at the
  raid source, so every owned copy keeps its item level, stats and Sundering
  standing. Pinned by `tests/nythraxis_relocation.test.ts`.
- **Final bosses no longer hoard the heroic epics.** Each heroic roll stays one
  item per kill, but the epics spread over the dungeon: Korzul's moved to Korgath
  and Velkhar (`tests/gravewyrm_sanctum_loot.test.ts`), two of Vael's to the Gaol
  Turnkey, two of Ysolei's to the Mere Hydra's center head (the head that carries
  the fight's one roll), and Morthen's Shadowpulse Slippers to Cantor Ilvane
  beside their Handwraps.
- **Heroic pays heroic gear only (2026-10-09).** A Heroic kill never pays a piece
  of gear that also drops on Normal: the dungeons' uncommon pieces left every
  heroic roll and drop on Normal alone, and each roll's other rows keep their
  ratios over the freed share, still one item per kill. Pinned per boss by
  `tests/heroic_loot_budget.test.ts` ("pays no Normal gear on a Heroic kill").
  The Hollow Crypt Reliquary page keeps Morthen's four uncommon brand pieces, so
  its clear meter counts Normal clears; Heroic runs count on the Heroic page.

## 8. Content obligations checklist (every dungeon)

- Deeds: new records APPENDED at the end of `DEEDS` (`src/sim/content/deeds.ts`),
  cosmetic only, `docs/design/deeds.md`; pinned by `tests/deeds_content.test.ts`.
- Reliquary: new rare-plus uniques get relic slots with structured source hints
  per boss (`docs/design/reliquary.md`); pages are append-only.
- Wiki: `npm run wiki:content` regen; new creature models need `npm run wiki:stills`.
- i18n: English only in the catalog modules: entity ids in
  `src/ui/world_entity_i18n.ts`, item names in `src/ui/i18n.catalog/items.ts`,
  mechanic and aura names, boss yells through `src/ui/sim_i18n.ts` matchers, finder
  mechanic labels; M16 non-Latin fills for wordy new English names.
- Item art: one `public/ui/items/<id>.webp` per new item plus `mapping.json`
  provenance (`docs/design/item-icon-art-style.md`).
- IP: verdict table per dungeon file, recorded before the name ships.
- Shipped-id golden re-mint (`tests/shipped_item_ids.test.ts`) in the same commit
  that mints an item id.
- Parity goldens touching the dungeon re-recorded with the canonical harness.

## 9. Environment performance budget (proposed, confirm with `render-performance-reviewer`)

- One kit GLB per dungeon, meshopt compressed, at most 4 MB; repeated pieces
  instanced.
- Room-level visibility: only the current room and its neighbors render (rooms
  are the light zones of G9).
- At most 8 dynamic point lights live per light zone (torch rig), one
  shadow-casting key light; candles are emissive cards, not lights.
- Floor dressing inside a boss arena is dark and flat; lit dressing stays in the
  wall band (telegraph readability).
- Every new material and light is prewarmed through the preparation scheduler;
  no free draws after boot.

## 10. Roadmap

Build ONE dungeon at a time. The Hollow Crypt goes first: it is the first
dungeon every player sees, it has the smallest and cheapest encounter numbers to
iterate on, its heroic is live, and it forces every generic system (G1 to G9) into
existence at low risk.

| Phase | Content | Effort (planning) |
|---|---|---|
| 0 | Generic systems G7 gates, G8 patrols, G9 authored interior; Hollow Crypt graybox playable with its current mobs | 3 to 4 weeks |
| 1 | Hollow Crypt encounters (G1 to G6 built as each boss needs them), one boss per step with tests | 2 to 3 weeks |
| 2 | Hollow Crypt loot, items, art, i18n, deeds, reliquary, wiki | 1 week |
| 3 | Hollow Crypt Blender kit, render painter polish, lighting, perf pass | 2 weeks |
| 4 | Heroic extras, meters-harness tuning, parity re-record, playtest | 1 week |
| Next | Sunken Bastion, Drowned Temple, Gravewyrm Sanctum, Wildheart Basin, each 4 to 6 weeks reusing the systems | |

Risks: the authored interior is the largest single build (render plus sim);
gates must mirror on the online client or movement desyncs; the Sunken Bastion
shares the current `crypt` interior key, so the Hollow Crypt must move to its own
key without touching the Bastion; heroic loot volume rises with boss count;
Hollow Crypt is in the parity goldens (`heroic_five_man_clear`), which will be
re-recorded.

Decisions the maintainer and owner must make are listed at the end of each
dungeon file.
