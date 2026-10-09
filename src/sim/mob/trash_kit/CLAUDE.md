# src/sim/mob/trash_kit: dungeon trash mechanics

Simple, readable pack mechanics for five-man trash, in the style of classic
dungeon trash: an interruptible bolt, a raise or a call you must stop, a stun
shriek, a leap onto the healer, an add that grows if left alive, a statue that
dives off its perch, a flier that lands when pulled. Declared per template as
`MobTemplate.trashKit` (`src/sim/types.ts` `TrashKitDef`); first consumer: the
Hollow Crypt trash (`src/sim/content/hollow_crypt_trash.ts`).

| Module | Role |
|---|---|
| `cast_ids.ts` | Leaf: the cast ids and the interruptible ones' schools (`TRASH_KIT_CAST_SCHOOLS`, spread into `mob/healer_channel.ts` `SCRIPTED_INTERRUPTIBLE_CHANNELS`). |
| `targets.ts` | Pure: the hashed "random" victim, the leap's farthest-caster pick, the cone test. |
| `spawn.ts` | The zero-rng kit add spawner (raise, call, growth), with the claim's difficulty transform. |
| `cast_hold.ts` | A telegraphed area never moves with its caster: `holdAreaCast` plants the mob on the spot and the facing its area bar began with (screech, wing gust, tail lash, lane; and the template's breath cone where `DungeonDef.areaCastsPlant`), undoing the mob AI's step every tick until the bar lands or breaks. |
| `flier_call.ts` | `callDownLastFlier`: an idle flying patrol lands on the nearest player once every OTHER pack of a gate that waits on its pack is dead, so a gate can never stay shut behind a flier nobody pulled. |
| `sanctum_kit.ts` / `sanctum_cast_ids.ts` | The Gravewyrm Sanctum's keys: `goad` (an interruptible damage-done aura on one ally), `toss` (a ring locked under the farthest player, landing when the bar ends; physical, planted), `stoke` (a no-bar attack-speed pulse that gutters with its summoner); the Rime Whelp's slowing pop rides the shared `deathBurst` (`slow`). |
| `crypt_kit.ts` / `crypt_hooks.ts` | The Hollow Crypt trash mechanics pass: `reassemble` (a fallen Ossuary Warrior's bones lie as a `bonePile` mob and stand again while a necromancer of its pack lives; the risen body pays nothing twice via `Entity.regrown` and holds its first loot), `rupture` (the necromancer's kickable corpse burst, a ring object under the corpse, a heroic pool), `granite` (the gargoyle's stacking ward a stun shatters into a vulnerability), `eye` (the Crow Caller's mark that turns every crow), `scorch` (heroic: the drake's breath cone left burning), the Cutthroat's heroic releap. `crypt_hooks.ts` is the dependency-light leaf the mob lifecycle (`deathThroes.shrapnel`, the Bone Minion's Splinter Burst) and the breath bar (`noteBreathLanded`) call. Long-lived state rides `Entity.trashLife`. Tests: `tests/hollow_crypt_trash_mechanics.test.ts`. |
| `bastion_kit.ts` | The Sunken Bastion trash mechanics pass: `hook` (the Watchman's lane that drags whoever it catches; heroic brings its sweep at once), `wall` (heroic: watchmen side by side ward each other), `fallBack` (the Arbalest leaps back from a melee; a stun, root or slow holds it), `gorge` (a crawler feeding by a corpse grows its death burst, `deathBurst.perStack`), `fogBank` (the Mist Chanter's kickable fog patch that wards its allies inside), `column` (the Acolyte's kickable channel that roots and drowns one player), `unshackle` (a prisoner low on health stops fighting, kneels and leaves). Tests: `tests/sunken_bastion_trash_mechanics.test.ts`. |
| `kit_extension.ts` | The `TrashKitExtension` seam: a dungeon's own key block (`trashKit.temple`, `trashKit.wildheart`) lends the driver its casts (run on the driver's own cast machinery: stagger, swing hold, stun / silence / lockout breaks; an area cast plants through `cast_hold.ts` `isPlantedCast`) and its per-tick upkeep, and cleans up when a pull ends. A new dungeon block is a new extension, never another branch in `driver.ts`. |
| `temple_kit_types.ts` / `temple_extension.ts` / `temple_choir.ts` / `temple_tide.ts` | The Drowned Temple block (`trashKit.temple`): the Shrine Vigil the pilgrims keep on their singer, the heroic Moonset Oath (a guard takes half a casting singer's hits; `combat/damage.ts` calls `oathShare`), the heroic Lullaby Echo, the Prism Glare gaze (turn your back), the Spiral Whirlpool round a sheltering snapper, the kickable Arcing Spark that leaps between players, and the heroic Swollen Tide (touching wisps merge). Kept-up auras are wound tick by tick and dropped explicitly when their cause ends. The second wave adds `temple_lure.ts` (the Siren's kickable Call of the Shallows: a drag and a half-speed slow on one player, broken outright when she loses sight of them, a stun when it lands) and `temple_pearl.ts` (heroic: a BROKEN Nacre Cocoon rolls the ray's Heartpearl out as its `walker`, launch 'event'). |
| `bastion_kit_types.ts` / `bastion_extension.ts` / `bastion_order.ts` | The Sunken Bastion's second-wave block (`trashKit.bastion`; its first pass stays core keys in `bastion_kit.ts`): the Drowned Sergeant's kickable Loose on My Mark, which sends every arbalest of its own pack (`dungeonPackId`) at one player past the tank; a wall between a shooter and the mark stops that bolt (the G6 sight rule). Each bolt rides the SHOOTER's mechanic multiplier. |
| `wildheart_kit_types.ts` / `wildheart_extension.ts` / `wildheart_hunt.ts` | The Wildheart Basin block (`trashKit.wildheart`): the Quarry Mark (the stalker sets its raptors on someone past the tank), the once-a-pull kickable War Roar, the kickable Toad Hex, the binder's alternating totems, the Dread Totem's Rattling Dread (flee straight away from it), and the Snaring Tongue (a locked lane that reels its catch in). |
| `driver.ts` | `tickTrashKits`: one pass per tick over every claim's roster, after the mob AI (called from `instances/dungeons.ts` `updateInstances`). |

Rules:
- Every cast is a real cast bar on the mob; an interrupt, a stun or a silence
  cancels it, and the effect lands only when the bar runs out.
- An AREA cast (a ring, a cone, a lane) plants its caster for the whole bar
  (`cast_hold.ts`): the area lands where it was drawn, so stepping out of it is
  the counterplay. A targeted cast (bolt, mend, ward, lullaby) still tracks.
- Zero rng for targets and cadence; the only draws are a landing cast's damage
  rolls, in roster order.
- A pack's same-type casts alternate: each mob's first cast of an ability is
  offset by its pull rank over one interval (`../pack_cast_stagger.ts`, also
  used by the breath-cone seed); cadence and a lone mob's timing are unchanged.
  Tests: `tests/pack_cast_stagger.test.ts`.
- Kit state rides `Entity.trashKit` and dies with the pull (evade, reset,
  death). Flying patrols (`DungeonSpawnPatrol.altitude`) are flown by
  `mob/patrol.ts`; the landing and the perch dive are this module's.
- A flying patrol on the wing is nobody's target: the mob AI keeps `hostile`
  false while it waits more than `FLIER_OUT_OF_REACH` over the floor
  (`mob/patrol.ts` `flierWaitingAloft`, read in `mob/locomotion.ts`), so no
  swing, charge or spell reaches it from the ground; every pull path (its own
  sight, its pack, the boss chain pull, `flier_call.ts`) makes it a target the
  tick it is pulled. Its sight is its whole
  authored `aggroRadius` whatever the player's level (`flierSightRadius`), and
  pack pulls and the boss chain pull still take it (`patrolFlierAloft`). The
  renderer hides the ground reticle under it (`render/selection_ring.ts`).
- Tests: `tests/trash_kit.test.ts`; the Temple and Basin blocks:
  `tests/drowned_temple_trash_mechanics.test.ts`, `tests/wildheart_trash_mechanics.test.ts`.

## Engine pieces (generic keys any dungeon adopts by data)

Built for the Gravewyrm Sanctum's trash pass (2026-10-04) as GENERIC
`TrashKitDef` keys: a new dungeon adopts one by writing the record on its
template, registering a kickable cast id in its own `*_KIT_CAST_SCHOOLS`
table, and giving the object templates a look in the renderer. Every piece is
its own module behind the driver; the shared encounter objects (hazard pools,
combat walls, walkers) ride `Entity.kitObject` and are stepped once per tick
after the claim's mobs, in object-roster order (`kit_objects.ts`).

| Key / module | What it does | Adopt it |
|---|---|---|
| `usable` / `encounter_use.ts` (G3) | A body a player targets and uses with the INTERACT press: a non-spell channel (`KIT_USE_CAST_PREFIX` cast id: a landed hit, a step or a stun breaks it), validated on the authoritative sim at the press (`interaction.ts`), every tick (`casting_lifecycle.ts` updateCasting) and at completion. Effect `topple`: the body dies credited to the user and spills a hazard past it. No wire change: online it is the ordinary `interact` command. | `usable: { castId: 'kituse_<id>', name, channel, range, effect }` |
| `toss.leavesWall` / `combat_walls.ts` + `instances/combat_wall_state.ts` | A temporary COMBAT WALL: an object whose template names an OBB shape (`COMBAT_WALL_SHAPES`), published per slot into every interior collision reader (`interior_collider_sets.ts`), so it blocks bodies and line of sight; the online client mirrors it from the entity (`src/net/combat_wall_wire.ts`). Shatters after `seconds`. | add a shape row, then `leavesWall: { objectTemplate, name, seconds }` (or call `spawnCombatWall`) |
| `nova` / `kit_nova.ts` (G6) | A bar, then a blast on every player in `radius` who can SEE the caster (walls, pillars, combat walls shield); kickable through the cast table, every `unstoppableEvery`-th bar under an unregistered `unstoppableCastId`; optional `silence`. Consumer: the Gravecaller Adept's Gravespark Volley. | `nova: {...}` + register `castId` |
| `walker` / `kit_walker.ts` (G5) | An orb that drifts to the nearest fighting ally and empowers it (a damage-done aura and/or a `healPct` heal, `heroicDamagePct` for a heroic-only arming, `shieldPct` for an absorb); the first player within `interceptRadius` (after a 0.5 s arming) takes it instead (damage, the empower when `grantsEmpower`, a whole-group absorb when `groupShield`). Launched at death, by a bar, or by its dungeon's own module (`launch: 'event'`); `allies` narrows who it rolls to, `lingers` keeps it waiting for a taker when nobody is left, `eject` drops it yards out on the side away from the mob's foe. Consumers: the Bastion Revenant's Throatlight, the Moonmantle Ray's Heartpearl. | `walker: {...}` + an orb look |
| `cone.freezeStack` / `freeze_stacks.ts` | The "freeze at N stacks" slow: each application deepens one slow aura (`stacks`), the N-th freezes (a stun) and clears it. `applyFreezeStack` serves any hit. | `freezeStack: {...}` on a `cone` (or call it from any landing) |
| `cone` (driver) | A short-bar frontal cone at the one it fights, planted, never kickable. | `cone: {...}` |
| `split` / `kit_split.ts` | Once per pull under a health share it splits: the original shrinks and a copy (a summoned add, no loot) steps out, each with a share of what was left; a split body's death burst shrinks; an evade restores the original. | `split: {...}` |
| `reanimate` / `reanimate.ts` | An interruptible rite on the nearest unraised corpse of the listed templates: the summon climbs out where it lies. | `reanimate: {...}` + register `castId` |
| `brand` / `brand.ts` | An interruptible bar at a player in sight (never the tank while others stand in reach): a dot that the dungeon's quench zones (`DungeonDef.quenchZones`) put out the moment the victim stands in one; out of sight at the end, it fizzles. | `brand: {...}` + `quenchZones` |
| `breathPool` / `breath_pool.ts` + `kit_hazard.ts` | Where a template breath cone lands, a hazard pool ahead of the mob (`heroicOnly` optional). `KitHazardDef` is the shared pool: burns players (rolls) or the claim's trash (rolls, or `pctMaxHp` with no draw), never a boss or a control-immune great body. | `breathPool: {...}`; any module can `spawnKitHazard` |
| `TrashKitCast.heroicOnly` (driver) | A cast the driver never starts on normal (the Gravecaller Adept's Grave Bolt, which its normal volley replaces). | `heroicOnly: true` on any kit cast |
| `engine_demo.ts` | The demonstration kit (a nova and a walker) `/dev trashkit demo` lends a mob through `Entity.devTrashKit`, never a template. | dev and tests only |

Dev helpers: `/dev trashkit` (`src/sim/dev/trash_engine_dev.ts`). Tests:
`tests/trash_engine.test.ts` (every piece, the server-validated use, the wall's
movement and sight block, determinism) and
`tests/gravewyrm_sanctum_trash_mechanics.test.ts` (the first consumer).
