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
- Tests: `tests/trash_kit.test.ts`.
