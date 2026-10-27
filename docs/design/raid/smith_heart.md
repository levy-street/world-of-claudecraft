# The Smith's Heart: raid design

Status: phase 1 (playable blockout), phase 2A (the structure: the final boss in a
separate room reached by a portal, bigger themed guardian rooms, the structural VFX) and
phase 2B (the Hammer vein dressed: its Blender kit, its floor, air and light, the Hammer
guardian's and the Slab's effects, section 5.9) and phase 2C (the Hammer vein's polish
round and the North Stair, section 5.10), through the Breath (phase 2G, section 5.14), the
Quench (phase 2H, section 5.15), the Heat, now the Hearth (phase 2I, section 5.16), the Heart (phase 2J) and the Hammer Council's playable prototype (the first boss as three, sections 5.18 and 7.1) implemented on `feature/smith-heart-raid`, dev builds only. The per-room phases (Blender
kits, own creatures, set pieces, boss kits), the quest and the loot are specified here
and not built. The name is provisional and has not been IP-checked yet.

At a glance: a ten-player level 20 raid (2 tanks, 2 healers, 6 damage), one
instance slot inside Stormcrag holding two areas no floor joins: the main map (the
Cleft, the four guardian rooms round the Ring, the heart seal on its dais) and the
Heart (the final room). Five boss fights: the Hammer Council (the Guardian of the Hammer, the
Slabwright and the Seam Singer, section 7.1) always first, then the
Breath, Quench and Heat guardians in any order; with all four lit and the Ring clear
the seal opens into a portal to the Heart and the final boss. Twenty mandatory trash
packs. Target clear: 90 to 120 minutes on normal.

Sources of truth, in order:

1. The owner-approved design pages (Spanish, outside the repo): the map design
   ("El Corazon del Herrero") and the lore and final-boss page ("Tres raids
   elementales", option A "La Confluencia" chosen), plus the phase 1 brief.
2. The phase 1 code, which this doc MATCHES. Where the code deviates from the pages,
   section 3.6 says so and why.

| Piece | Where |
|---|---|
| Field: coordinates, heights, surfaces, props, anchors, light rivers, vein colours | `src/sim/content/smith_heart_layout.ts` (`SMITH_HEART_FIELD`, `SMITH_HEART_HEIGHTS`, `SMITH_HEART_ANCHORS`, `LIGHT_RIVERS`, `SMITH_HEART_VEIN_COLORS`) |
| Mobs (sketch kits), spawns, packs, gates, seal markers, `DungeonDef`, door | `src/sim/content/smith_heart.ts` (`SMITH_HEART_MOBS`, `SMITH_HEART_SPAWNS`, `SMITH_HEART_PACKS`, `SMITH_HEART_GATES`, `SMITH_HEART_SEAL_MARKERS`, `SMITH_HEART_DUNGEON_DEFS`, `SMITH_HEART_DOOR_POS`) |
| Gating readout, the heart seal and the portal's state | `src/sim/encounters/smith_heart/seal.ts` (`smithHeartProgress`, `tickSmithHeart`, `SMITH_HEART_PORTAL_BIT`) |
| The portal hop (both ways) | `src/sim/encounters/smith_heart/portal.ts` (`tickSmithHeartPortal`) |
| Areas (score, fog, sky) | `smithHeartAreaAt` in the layout; `src/game/smith_heart_music.ts`; `src/render/smith_heart/heart_environment.ts` |
| Dev-only entry | `src/sim/encounters/smith_heart/entry.ts` (`SMITH_HEART_PLAYABLE`, `smithHeartEntryOpen`) |
| Gate collision and state engine (shared) | `src/sim/instances/dungeon_gates.ts` |
| Authored open-air field engine (shared) | `src/sim/instances/authored_field/` (see its `CLAUDE.md`) |
| Placeholder looks (the one list phase 2 replaces) | `src/render/characters/smith_heart_placeholder_looks.ts` |
| The Hammer vein's Blender kit (sources, build, plan, painter) | `docs/design/raid/kit/build_smith_heart_hammer_kit.py` (the sculpted quarry rock: `hammer_cliff.py`), `scripts/assets/smith_heart_hammer_kit/build.mjs`, `src/render/smith_heart/hammer_kit_plan_core.ts`, `src/render/smith_heart/heart_kit.ts` |
| The Hammer vein's air and light | `src/render/smith_heart/hammer_air_core.ts`, `src/render/smith_heart/heart_environment.ts` (`smithHeartHammer`) |
| The mountain's rock kit (sources, build, plan, painter) | `docs/design/raid/kit/build_smith_heart_rock_kit.py` (the sculpts: `rock_sculpt.py`), `scripts/assets/smith_heart_rock_kit/build.mjs`, `src/render/smith_heart/heart_rock_plan_core.ts`, `src/render/smith_heart/heart_rock.ts` |
| The Gallery's walk (paving, kerb, chain rail, fallen blocks) | the `paving` ground (`field_textures.ts` `pavingDetail`), `docs/design/raid/kit/walk_pieces.py`, `src/render/smith_heart/hammer_walk_plan_core.ts`, `sh_fallen_block` in the layout |
| The Hammer guardian's and the Slab's effects | `src/render/smith_heart_fx/` (`HammerFx`) |
| The Quench vein's Blender kit (sources, build, plan, painter) | `docs/design/raid/kit/build_smith_heart_quench_kit.py` (the pieces: `quench_pieces.py`), `scripts/assets/smith_heart_quench_kit/build.mjs`, `src/render/smith_heart/quench_kit_plan_core.ts`, `src/render/smith_heart/quench_kit.ts` |
| The Quench vein's floors, frost, air and light | `rime`, `lake_ice` grounds, `src/render/smith_heart/quench_lake_ice.ts`, `quench_frost_core.ts`, `quench_air_core.ts` / `quench_air.ts`, `heart_environment.ts` (`smithHeartQuench`) |
| The Quench guardian's effects | `src/render/smith_heart_fx/quench_fx.ts` (`QuenchFx`) |
| The Heat vein's Blender kit (sources, build, plan, painter) | `docs/design/raid/kit/build_smith_heart_heat_kit.py` (the pieces: `heat_pieces.py`), `scripts/assets/smith_heart_heat_kit/build.mjs`, `src/render/smith_heart/heat_kit_plan_core.ts`, `src/render/smith_heart/heat_kit.ts` |
| The Heat vein's floors, basalt, air, light and the pour | the `hearth` ground, `src/render/smith_heart/heat_hearth_floor.ts`, `heat_soot_core.ts`, `heat_air_core.ts` / `heat_air.ts`, `heat_pour_core.ts` / `heat_pour.ts`, `heart_environment.ts` (`smithHeartHeat`) |
| The Heat guardian's effects | `src/render/smith_heart_fx/heat_fx.ts` (`HeatFx`) |
| The Hammer Council (the first boss: three members, the pillars) | `src/sim/encounters/smith_heart/council*.ts` (`tickHammerCouncil`, `COUNCIL_TUNING`, `COUNCIL_DIFFICULTY`); its look `src/render/smith_heart_fx/council_fx.ts` and `council_bodies.ts`; its alert `src/ui/hud/dungeon/council_alert_view.ts` |
| Dev commands | `src/sim/dev/smith_heart_dev.ts` (`/dev heart`) |

## 1. Summary and lore

Built on what the world already says (`docs/design/world-lore.md`, "Thornpeak
Heights: the Jailer's Body"): the Smith bound his eldest dragon Korzul beneath a
range raised for the purpose, then lay down and became Thornpeak. The storms and
elementals of Stormcrag are his unquiet strength; Thunzharr is his splintered wrath.

The new piece: before he lay down, the Smith split his strength in four so the
seal would hold for centuries. They are the four acts of his craft, the same four
as the Sanctum's rune creed:

| Strength | Element | Vein | Colour (`SMITH_HEART_VEIN_COLORS`) |
|---|---|---|---|
| The Heat of the forge | fire (the first flame: white-gold, never volcanic) | west, the Hearth, level | `0xffe6a0` white-gold |
| The Breath of the bellows | storm | north, climbs to a cornice | `0x5ab8e8` storm blue |
| The Hammer that shapes stone | earth | south, the entrance, descends | `0xc8903c` ochre |
| The Quench of the cold water | frost | east, descends to a frozen lake | `0x9ad8ff` ice pale |

Each strength sleeps in a vein of the mountain that runs down to its heart, and
each vein has a guardian. Players have just fought Korzul in the Gravewyrm
Sanctum; the mountain stirred and the four strengths woke. Without their master,
each guardian carries out its last order with blind force: seal, crush, freeze,
burn whatever enters. In the Heart the pieces are gathering into a mindless forge
body, the strength without its master, which wants to finish the Smith's last job:
seal the mountain forever, with everything that breathes inside.

The four altars in the Heart are the mouths of the four veins: drag the final boss
onto one and it drinks that strength. That is why the final boss works.

Quest giver: the Vigil of Highwatch. Captain Thessaly's order has watched a wall
for forty generations without knowing why; here she learns her order was posted to
watch the mountain, not what comes from outside.

Duskwick, the dusk flame, is the Smith's last ember, the one he left burning when he
lay down, like a candle left lit on going to sleep. The final boss drops it, so the
staff needs no dusk altar of its own.

Fire is one strength of four and never the lead: Ignivar is already the fire raid.
The Heat vein is the Hearth (phase 2I, the owner's decision; section 5.16): the Smith's
first flame, white-gold fire sealed in living crystal and in the mountain's dark basalt.
It is no smithy (no anvil, bellows, crucible, chain, coal or tool) and never lava; the
Smith never appears as a character. Varkhul's Last Flame was a spark stolen from this
vein: a scorched, empty socket in the Hearth's crystal shows where.

## 2. Instance facts

| Fact | Value | Source |
|---|---|---|
| Dungeon id | `smith_heart` | `SMITH_HEART_DUNGEON` |
| Instance band | overflow `index` 15; the whole field (both areas) stays inside one slot (abs x under 300, abs z under 250) | `SMITH_HEART_DUNGEON_DEFS` |
| Field bounds | see `SMITH_HEART_FIELD.bounds` (the Smith's Forge reaches furthest west, the Basin and the Heart furthest east) | `SMITH_HEART_FIELD` |
| Claim footprint | its own half width, wider than the generic envelope and still inside the 600 yd band | `instanceHalfWidthOf` (`src/sim/instances/instance_footprint.ts`) |
| Void | height `SMITH_HEART_VOID_HEIGHT`, map void `mist`, `cliffStep` 1.1 | `SMITH_HEART_FIELD` |
| Group | `suggestedPlayers` 10; raid-only claim | `RAID_ALLOWED_DUNGEON_IDS` (`src/sim/instances/dungeons.ts`), `RAID_REQUIRED_DUNGEON_IDS` (`src/sim/instances/reset_cooldown_policy.ts`) |
| Interior key | `smith_heart` (authored field) | `src/sim/instances/authored_field/registry.ts` |
| Flags | `areaCastsPlant` on; `bossChainPull` off (a raid pulls each guardian on its own, `tests/smith_heart_pull.test.ts`); `guideVisible` false | `SMITH_HEART_DUNGEON_DEFS` |
| Entry, exit | the Cleft (`SMITH_HEART_ANCHORS.entry`, `.exit`) | `SMITH_HEART_ANCHORS` |
| Boss exit portal | on the Anvil of the World, opens when the final boss dies | `bossExitPortal` |
| Entry gate | dev builds only while `SMITH_HEART_PLAYABLE` is false | `entry.ts` |

Axes: instance-local yards, north +z, east +x, heights in yards with the Ring at 0.
Compass angles are degrees clockwise from north (`ringPoint`).

## 3. Layout

Open air throughout: every vein is a fissure open to the storm sky, never a roofed
tunnel, so the camera never meets a vault (the reworked dungeons' authored-field
precedent: Hollow Crypt, Wildheart Basin). Floors end in cliffs that drop into the
misted void; cliffs are walls, nobody falls, with one exception: the Storm Cornice's four
broken gaps (`CORNICE_GAPS`, the throats of four wind channels), where the rim's wall has
fallen and the lip lies open to the void for the Guardian of the Breath's fight (section
7.2). A body walked or blown into one falls and dies, on every difficulty
(`tests/smith_heart_route.test.ts` pins that the void is open there and nowhere else, and
that neither the walk to the guardian nor the corpse run crosses a gap).

```
                    b3 (+40) ---- CORNICE CLIMB ---- STORM CORNICE (+60)
                    /  wind bridge                    Breath guardian
          b2 (+16) - chimney - b1 (0)                          THE HEART (separate area,
                                 |                             north-east corner, walled
 SMITH'S FORGE (0) - casting - forge hall -( RING 0 )- q1 (-8)  off by the mountain):
 Heat guardian      f2 f3      f1           seal dais     q2 (-16)   ARRIVAL TERRACE (+4)
 great hearth, anvil                        (-4, portal)   SINGING ICE (-24, q3)  | bridge
                                            GRAND STAIR       QUENCH BASIN (-30)  ANVIL OF THE WORLD (0)
                                            BALCONY (+20)     Quench guardian     final boss, 4 altars,
                                              |  the Slab                          4 roots, the core 
 CLEFT (+44) - h1 (+40) - h2 (+34) - h3 (+28) - SMITH'S QUARRY (+14)
 world entrance           the Hammer Gallery    Hammer guardian (always first)
```

### 3.1 The main map

Every constant lives in `src/sim/content/smith_heart_layout.ts`; the table names them
rather than repeating numbers that would rot.

| Section | Shape | Constant |
|---|---|---|
| The Cleft (entrance landing) | disc, south-west corner | `CLEFT` |
| The Hammer Gallery | three landings joined by descending paths | `GALLERY_LANDINGS` |
| The Smith's Quarry (Hammer arena) | a carved ellipse about 92 by 80 yd, deep under four stepped terraces on its east and south sides (unreachable ledges, each several bodies tall), the colossi carved out of the terraces, kneeling on the first step (`QUARRY_COLOSSUS_OUT`) so the play camera on the pit floor frames them | `HAMMER_PIT`, `QUARRY_TERRACES` |
| The Slab, the Balcony | stair from the Quarry up to the Balcony | `SLAB`, `BALCONY` |
| The Grand Stair | one broad stair (16 yd) from the Balcony's tip down across the chasm to the dais | `GRAND_STAIR` |
| The North Stair | the dais's second way in (phase 2C): a broad stair (16 yd) from the Ring's inner edge at its north (the Breath's mouth) straight down across the chasm to the dais, a gentle fall from the Ring to the dais | `NORTH_STAIR` |
| The Ring | flat annulus sector round the seal, two curved stairs to the Balcony | `RING`, `RING_ARC` |
| The Seal Dais | a round island a little below the Ring, floating over the chasm; the seal at its centre, the portal over the seal | `SEAL_DAIS`, `HEART_SEAL`, `RING_PORTAL` |
| The Breath | b1, the chimney, b2, the Wind Bridge, b3, the climb | `BREATH`, `WIND_BRIDGE` |
| The Storm Cornice (Breath arena) | a cracked plateau about 100 by 80 yd at the top of the mountain, its rim cut by five wind channels; the throats of four of them are broken gaps open to the void (the eastern channel keeps its wall) | `BREATH.cornice`, `CORNICE_CHANNELS`, `CORNICE_GAPS` (field `lipOpenings`) |
| The Quench | q1, q2, the Singing Ice, the lake descent | `QUENCH` |
| The Quench Basin (Quench arena) | a rock shelf about 96 by 92 yd with the frozen lake on it | `QUENCH.shelf`, `QUENCH.lake` |
| The Heat | the hall, the casting floor, the Pour Channel, the bridge (the layout's ids keep their forge names: `forge_hall`, `anvil_bridge`) | `HEAT`, `POUR_CHANNEL` |
| The Hearth (Heat arena, the layout's `smiths_forge`) | an eight-sided hall about 82 by 92 yd, the Hearth's mouth in its west wall, the great altar-stone before it | `HEAT.forge`, `GREAT_HEARTH`, `GIANT_ANVIL` |

Each room reads its theme by shape first (kit placeholders in
`src/render/smith_heart/heart_plan_core.ts`): the Quarry's kneeling colossi, cut blocks,
derrick, ochre geodes and the five columns (the Hammer Council's starting pillars, section 7.1);
the Cornice's lightning rods and stone wind-horns (phase 2G, section 5.14); the Basin's great
blades of ice sunk in the lake, heaped old ice, steaming vents and carved fire bowls (phase 2H,
section 5.15); the Hearth's mouth framed by radiating basalt columns, its altar-stone (on
the old anvil's footprint, its crystal crown north), the ember boulders, the clusters of
the first flame's crystal and the seams of fire in its floor (phase 2I, section 5.16).

### 3.2 The Heart (the separate final room)

| Section | Shape | Constant |
|---|---|---|
| The Arrival Terrace | a small round island, a little above the platform, south-west of it | `HEART_TERRACE`, `HEART_ARRIVAL` |
| The return portal | on the terrace's west side, beside the arrival (never behind it) | `HEART_RETURN_PORTAL` |
| The Heart Bridge | a short bridge from the terrace onto the platform; its gate seals while the final boss fights | `HEART_BRIDGE_GATE`, gate `heart_bridge` |
| The Anvil of the World | the final boss's round platform (84 yd across), hung over the chasm | `HEART_ROOM` |
| The four altars | at the platform's compass points, each gripped by its root of the mountain | `HEART_ALTARS` |
| The chasm | open air round the platform, down to the Smith's glowing heart | `HEART_ROOM_CHASM_R` |

**Why a platform over a glowing core.** The brief offered a chamber inside the mountain
or a platform over a core; the Heart is both: the platform is held by four colossal
roots of the mountain over the Smith's own heart, a bed of white-gold crystal beating
deep in the chasm, inside a crown of mountain rock open to a sky of embers and stars.
It reads as its own place (no vein's colours dominate; the four meet here), it keeps
the open-air rules (no ceiling, the camera never meets rock), the roots give the room
its silhouette and carry each vein's light down into its altar (the altars' meaning in
the final fight), and the chasm round the platform gives every drag and every
knockback a wall, never a fall (the platform's lip is a balustrade cliff). Until phase
2J the roots were four iron chains; the raid has no metal (section 5.17).

**Separate, not walkable, not visible.** No floor joins the Heart to the main map; the
portal is the only way in. The mountain's crown round the Heart is deeper and taller
than the veins' rock, and no line of sight crosses from any main-map eye into the Heart
(pinned, section 10).

### 3.3 The route, in order

1. **The Cleft**, the **Hammer Gallery** (h1, h2, h3), the **Pit Mouth**, the
   **Smith's Quarry**: the Hammer Council, always first.
2. **The Slab** breaks when the whole Hammer Council has fallen; the Slab Stair climbs to **the
   Balcony**, the first view: the Grand Stair falling to the seal on its dais, the Ring
   round it, the three vein mouths.
3. **The Ring** (eight packs) by the two Balcony Stairs; then in ANY order the
   **Breath** (to the Storm Cornice), the **Quench** (to the Quench Basin) and the
   **Heat** (to the Hearth), each behind its own three packs.
4. Each guardian's death lights its vein's **light river**; the river runs to the seal
   and its quarter fills. With all four lit and the Ring clear, the seal **opens into
   the portal**.
5. Down the Grand Stair (or the North Stair, from the Ring's north) to the dais, into
   the portal: the raid lands on the Heart's
   **Arrival Terrace**, crosses the **Heart Bridge** to the **Anvil of the World** and
   the final boss. The exit portal opens there when it dies.

Corpse run: a released spirit rises at the raid's entrance (the instance death model),
walks the main map (Gallery, Quarry, Slab, Balcony, Grand Stair) to the portal, which
stays open for the claim's life, and steps through. The return portal walks the raid
back to the dais at any time.

### 3.4 Heights

| Area | Heights (yards) | Feel |
|---|---|---|
| Hammer | Cleft 44, Gallery 40 to 28, Quarry 14 under terraces to 42, Balcony 20 | the descent from the entrance into a deep pit |
| Ring and dais | Ring 0, dais -4 | the Ring looks down onto the seal |
| Breath | 0, 16, 40, Cornice 60 | climbs into the wind, a summit |
| Quench | -8, -16, -24, Basin -30 | sinks into the cold |
| Heat | 0 throughout | the Hearth's level |
| Heart | terrace +4, platform 0 | the arrival looks down onto the platform |

Every path's slope stays under the authored field's limit
(`src/sim/instances/authored_field/CLAUDE.md`); `tests/smith_heart_route.test.ts` proves
no walked step exceeds `MAX_STEP_HEIGHT` or `cliffStep` on either area.

### 3.5 Sightlines and the reveals

- **The Balcony.** The Slab splits and opens onto the Balcony: the Grand Stair falls
  straight to the seal, the dais's four tines round it, the Ring beyond, the vein
  mouths. The rivers already lit cross the chasm to the seal.
- **The seal from the Ring.** The dais floats in an open chasm a little below the Ring:
  nothing stands between any Ring point and the seal or the portal's eye; the tines
  stand on the diagonals, between the rivers and clear of every ray (pinned). The two
  stairs that cross the chasm (the Grand Stair from the Balcony, the North Stair from
  the Ring's north) fall gently enough to stay under every Ring eye's line to the seal
  (pinned in `tests/smith_heart_walls.test.ts`).
- **The portal opening.** Seen from anywhere on the Ring and from the Balcony: the
  tines charge, a pillar of light stands up, a four-colour shockwave races across the
  chasm to the Ring, and the vortex and its funnel grow out of the parted seal.
- **The arrival.** The terrace faces the platform across the short bridge: the boss at
  its centre, the four altars, the roots rising into the crown, the core's light from
  below, the ember sky above.
- **Lighting.** One light zone per section (`SMITH_HEART_FIELD.lightZones`), each vein
  keyed in its colour; the Heart lit from below by its core.

### 3.6 World entrance

`SMITH_HEART_DOOR_POS` in Thornpeak Heights (`src/sim/content/zone3.ts`), at the foot of
the Stormcrag cliffs past the end of the Stormcrag road, north-east of Highwatch;
leaving sets the raid down to the west, away from the rock face. While
`SMITH_HEART_PLAYABLE` (`src/sim/content/smith_heart.ts`) is false the door is NOT built
(`overworldDoor` follows the flag), the raid is entered only through `/dev heart`, and
any other entry is refused with `SMITH_HEART_CLOSED_TEXT`.

### 3.7 Deviations from the approved pages

| Pages | Code | Why |
|---|---|---|
| One stair from the Balcony to the dais | The Grand Stair plus the North Stair from the Ring's north (owner, phase 2C) | A raid finishing in the north (the Breath, the vein mouth furthest from the Balcony) reaches the portal without walking round the Ring. |
| Balcony +25, Pit +20 | Balcony +20, Quarry floor +14 | The curved Balcony Stairs exceed the slope limit from +25; the Quarry drops with it. |
| One wide stair from the balcony to the Ring | Two curved stairs along the Ring's circle | ONE floor height per point: the Ring cannot pass under the Balcony. |
| Ring 14 yd wide | 16 yd | Room for packs of three plus a raid passing; see open questions. |
| The final room on the main map (the heart caldera) | A separate Heart reached by a portal from the seal (owner, phase 2A) | The final fight gets its own identity and room; the seal stays the main map's centrepiece. |
| One altar before each vein mouth | The four altars ring the Heart's platform, each gripped by its root | The altars moved with the final boss. |
| Map about 420 by 420 yd | the slot's whole width | Bigger themed rooms and the Heart; still one instance slot. |
| About 22 packs | 20 (3 + 8 + 3 x 3) | The pages' figure was an estimate. |

## 4. Packs

Every pack is three elites held in formation until pulled (`idleStationary`), level
20, sketch numbers. Trash composition per vein: Hammer and Ring are three warders;
the other veins are warder, caller, warder.

| Pack | Location | Floor | Composition | Gate that waits on it |
|---|---|---|---|---|
| h1 | Gallery landing h1 | +40 | 3 Hammer Vein Warder | `hammer_pit_mouth` |
| h2 | Gallery landing h2 | +34 | 3 Hammer Vein Warder | `hammer_pit_mouth` |
| h3 | Gallery landing h3 | +28 | 3 Hammer Vein Warder | `hammer_pit_mouth` |
| r1 to r8 | Ring at the eight `RING_PACK_DEGREES` | 0 | 3 Ring Forge Warder | the portal (with the four guardians) |
| b1, b2, b3 | Breath landings | 0, +16, +40 | 2 Breath Vein Warder, 1 Breath Vein Caller | `cornice_mouth` |
| q1, q2 | Quench landings | -8, -16 | 2 Quench Vein Warder, 1 Quench Vein Caller | `lake_mouth` |
| q3 | the Singing Ice | -24 | same | `lake_mouth` |
| f1 | the forge hall | 0 | 2 Heat Vein Warder, 1 Heat Vein Caller | `anvil_mouth` |
| f2, f3 | the casting floor, either side of the Pour Channel | 0 | same | `anvil_mouth` |

Trash sketch kits: warders swing a frontal arc cleave every third swing (Stone,
Forge, Gale, Rime, Ember Sweep); callers cast a two-second school bolt (Gale Bolt
nature, Rime Bolt frost, Ember Bolt fire). Phase 2 rule (dungeon rework README,
"Binding principles"): trash TEACHES its vein's guardian in a friendlier form.

## 5. Gating

### 5.1 Gate states

Every gate is a `DungeonGateDef` driven by the shared engine
(`src/sim/instances/dungeon_gates.ts`): closed until every listed pack and boss is
dead; sealed once the listed boss has fought for `BOSS_ROOM_SEAL_DELAY_SECONDS`
and while it stays engaged; open otherwise. Every gate is at least 12 yd wide.

| Gate id | Kind | Where | Waits on | Seals for |
|---|---|---|---|---|
| `hammer_pit_mouth` | `stone_slab` | the Pit descent, near its top | packs h1, h2, h3 | the Hammer Council (any of the three fighting: `sealWithBodies`) |
| `the_slab` | `stone_slab` | the Slab Stair | bosses: the Hammer Council's three | nothing |
| `cornice_mouth` | `forge_seal` | the Cornice climb, near its top | packs b1, b2, b3 | Breath guardian |
| `lake_mouth` | `forge_seal` | the lake descent | packs q1, q2, q3 | Quench guardian |
| `anvil_mouth` | `forge_seal` | the anvil bridge | packs f1, f2, f3 | Heat guardian |
| `heart_bridge` | `forge_seal` | the Heart Bridge | nothing (the portal is its door) | final boss |

`the_slab` carries the `openText` line the raid reads when it opens. Gate entities are
spawned by `SMITH_HEART_GATE_OBJECTS`.

The `forge_seal` look (phase 2J; it read as a bronze sill with light bars, metal in every
vein): the Smith's carved granite threshold across the passage with crystal growing in a
channel down its top, a rough-hewn standing stone with a crystal crown at each end (the
gate kit, `public/models/props/smith_heart_gate_kit.glb`, from
`docs/design/raid/kit/build_smith_heart_gate_kit.py`), and a curtain of crystal light
rising out of the channel in the vein's colour (the Breath's teal, the Quench's ice, the
Heat's white-gold; the Heart Bridge's braids all four round a white-gold heart,
`heartGateTint`). Shut it burns, sealed it flares and beats, opening it drains into its
channel and the threshold sinks. Visual only: the ids, the states, the colliders and the
timing are the gate engine's as before; the curtain is light (never a solid in the
sightline pins), blended over the scene so it reads over the pale Breath and the dark
Hearth alike, and drawn the same on every tier.

### 5.2 The heart seal and the portal

The seal is a lit-vein mask, one bit per dead guardian (`SMITH_HEART_VEIN_BITS`):
Hammer 1, Breath 2, Quench 4, Heat 8; `SMITH_HEART_SEAL_FULL` is 15. The portal is one
more bit, `SMITH_HEART_PORTAL_BIT` (16): set when the mask is full AND the Ring's eight
packs are dead (or forced by `/dev heart portal`). Both are derived every tick from the
claim's roster (`smithHeartProgress`), never a timer and never stored, so a lit vein
stays lit and the open portal stays open for the claim's life. `tickSmithHeartSeal`
writes the value into the template id of every seal marker (`smithHeartSealTemplate`,
prefix `smith_heart_seal_`), so every client mirrors the seal and the portal with no
wire change; the renderer reads it back with `smithHeartSealMaskOf`. The markers
(`SMITH_HEART_SEAL_MARKERS`) are spread so every floor of both areas stands within the
client's interest radius of at least one (pinned). Each newly lit vein sends its line
from `SMITH_HEART_VEIN_LIT_LOG`, and the opening sends `SMITH_HEART_PORTAL_OPEN_LOG`
(re-localized by `src/ui/sim_i18n.ts`).

### 5.3 The portal hop

`tickSmithHeartPortal` (`src/sim/encounters/smith_heart/portal.ts`), once a tick per
live claim, draws no rng and uses the shared displacement recipe (`displacePlayer`):
a living player standing in the Ring's portal (`RING_PORTAL`) while it is open is set
down at `HEART_ARRIVAL`, facing the platform, far outside the final boss's reach; a
player standing in the return portal (`HEART_RETURN_PORTAL`) is set down at
`RING_PORTAL_LANDING` on the dais, facing the Grand Stair, clear of the portal. The
return portal always works (the Heart is only ever reached through the open portal).
A corpse never crosses. Each crossing sends its own line
(`SMITH_HEART_PORTAL_HOP_TEXT`, `SMITH_HEART_PORTAL_RETURN_TEXT`).

### 5.4 The derived readout

`smithHeartProgress(ctx, inst)` returns `SmithHeartProgress`:

| Field | Meaning |
|---|---|
| `mask` | lit-vein mask |
| `slabOpen` | Hammer bit lit: the Slab is split, the Ring and the three veins open |
| `sealLit` | mask is full: all four colours burn |
| `ringClear` | packs r1 to r8 are dead |
| `portalOpen` | `sealLit` and `ringClear` (or forced by `/dev heart portal`): the seal is a portal |

### 5.5 Free order, proved

- Only `the_slab` lists a guardian among the gates, and only the Hammer. The portal
  waits on all four. No gate orders the Breath, Quench and Heat against each other.
- Each arena mouth waits only on its own vein's three packs, and those packs stand on
  floor reachable from the Ring once the Slab is open.
- Pinned by `tests/smith_heart_route.test.ts`, "the Slab open: the Ring, the dais and
  all three veins in any order", and by `tests/smith_heart_gating.test.ts`.

### 5.6 Reset

Dead instance mobs stay dead for the claim's life, so a lit vein stays lit, the portal
stays open and an opened gate stays open (a corpse run always has a path). A fresh
claim respawns everything: every gate closes and the markers start at
`smith_heart_seal_0`. The dungeon is in `RAID_REQUIRED_DUNGEON_IDS`, so a replacement
claim skips the five-minute reset cooldown; the raid lockout is the rate limit (wired
later, see the Shipping checklist).

### 5.7 The structural VFX (phase 2A)

Every piece is built with the interior, so the renderer's compile gate links its
programs before the first frame (a hidden mesh's material links too); none reads a
texture, nothing is added to the scene later, no light but the budgeted point lights.
The seal, the portal, the bursts and the hop draw on every graphics tier (they show
progress and the way); only cosmetic motes and embers thin on the low tier
(`heartPortalMoteCount`, `heartEmberCount`, read from the static preset).

| Moment | Look | Where |
|---|---|---|
| A vein lights | its river runs to the seal; its quarter fills rim to centre behind a white-hot front; a column of its colour stands up off it | `heart_rivers.ts`, `heart_seal.ts` (`heartSealQuarterFill`, `heartSealColumn`) |
| The seal opens | the tines charge and arc, a pillar of light and a bloom stand up, a four-colour shockwave races across the chasm to the Ring, the quarters part | `heart_portal.ts` (`heartPortalStage`) |
| The living portal | a floor vortex of four spiral arms round a white-gold eye, a funnel of light over it, motes spiralling up | `heart_portal.ts`, `heart_fx_materials.ts` |
| The hop | a column and a floor ring at the landing, a brief white-gold wash over the view, the sky turning (storm to ember night) | `heart_portal.ts`, `heart_sky.ts` (`heartHopLanding`, `heartAreaBlend`) |
| The Heart | the core beating in the chasm, its shafts, the chains, each vein's pour down its chain, the rune rings, rising embers | `heart_room.ts` |

### 5.8 Areas: score, air, sky

`smithHeartAreaAt` names the area of any point (hammer, ring, breath, quench, heat,
heart). The score follows it (`SMITH_HEART_AREA_MUSIC`: each vein and the Heart borrow
an existing cue whose brief fits until the raid has its own score). The Heart has its
own fog and light state, `smithHeartCore` (`heart_environment.ts`), and so does the
Hammer vein, `smithHeartHammer` (phase 2B: a warm quarry dusk, the key low from the
south-west raking the terraces, the realm's blue sky light all but off), the Ring
(`smithHeartRing`, phase 2F), the Breath (`smithHeartBreath`, phase 2G) and the Quench
(`smithHeartQuench`, phase 2H), and so does the Heat (`smithHeartHeat`, phase 2I).

### 5.9 The Hammer vein dressed (phase 2B)

| Piece | Look | Where |
|---|---|---|
| The Cleft | two flanks of ochre granite leaning together to a crack open to the sky, a chockstone jammed in it, the way back to the world cut as a doorway of the Smith's dressed stone (jambs, a lintel with the hammer rune, steps), the vein's glow at its foot | `Kit_CleftGate` on `sh_cleft_mouth` |
| The Gallery | quarried lips leaning out over the void along every ledge, chain hoists hung off them, the Smith's rough statues on the rims (one standing, one kneeling, scaffold poles), geodes of amber crystal, chips on the landings | the edge plan, `sh_rough_statue`, `sh_geode` |
| The collapse spot (6.1) | a great flake of rock split from the mountain hanging out over the lower Gallery nine yards up, iron straps across its crack, chains back to the rock, the masons' red warning chevrons, grit trickling steadily onto the walk | `Kit_CollapseOverhang` at `collapseSpot()`, `hammer_air_core.ts` |
| The Smith's Quarry | three colossi in the Smith's likeness carved out of the terraces (the Vigil kneels with his hammer planted, the Waking heaves himself out of the step on his hands, the Bearer kneels with the hammer on his shoulder), worked quarry faces on every riser and a flat worked rim round the pit floor, a cut-bedrock floor (`quarry` ground), carved columns in square sockets (made to sink: the rising and falling columns of 7.1 stand in them), cut blocks, the derrick, a scaffold against the Vigil, spoil heaps on the steps | `planHammerKit()` |
| The Slab | a frame of dressed monoliths with the Smith's tools and the hammer rune; the slab itself two carved halves with the hammer rune across its split | `Kit_SlabFrame`, `Kit_SlabHalfL`, `Kit_SlabHalfR` |
| The Balcony | two lookouts, kneeling Smiths on corbels at its sides holding bowls of the vein's coals toward the heart | `Kit_LookoutStatue` |
| The air | dust in the low sun, grit off the terrace lips and the colossi, a warm haze over the pit, the geodes' halos | `hammer_air.ts` |

Effects (`src/render/smith_heart_fx/`, presentation only, the sim untouched):

| Moment | Look |
|---|---|
| Mountain's Wrath, on its bar | molten cracks race out from the guardian's feet, loose stones lift and hang round it, dust is drawn in toward it, grit shakes down |
| Mountain's Wrath, landing | a wall of rock dust rides the sight field's wave out to the nova's radius, the floating stones and a spray of rubble fly outward, shock rings, a flash, grit pours off the terraces, the quarry shakes |
| Hammerfall | a fan of cracks torn open in its arc, rubble and dust thrown along it, a short shake |
| The Slab breaking | the split flares, the stone bursts both ways along the stair, a dust cloud rolls out, shock rings, grit pours off the lintel while the halves part and sink |
| The Pit Mouth sealing | a dust skirt along its foot as it slams shut behind the raid |

Readability: the telegraph of Mountain's Wrath stays the trash engine's sight field (the
nova's ring and the hatched safe shadow behind each column) on every graphics tier; the
cracks draw over its fill, under its wave. The effects, the air and the rubble are
cosmetic and thin on the low tier and under reduced motion. Everything is built with
the interior or under one compile-gated root, so nothing links on first use. Kit piece
names (Vigil, Waking, Bearer, lookout) are internal node names, never shown to a player. The sky blends from storm to the
Heart's ember night as the camera arrives.

### 5.10 The Hammer vein's polish round and the North Stair (phase 2C)

The owner's review of 2B: the vein read monochrome (floor, walls, statues and light all one
orange-tan), the quarry's back wall read as stacked boxes, the colossi were crude up close,
the floor read as big flat tiles and the Cleft (back to the sun) was too dark. The round
follows the painted world's look bar (warm key, cool blue-violet shadows never black, a
three-value read, muted stone with few rich accents; detail at medium frequency).

| Piece | Now | Where |
|---|---|---|
| The grade | A strong warm low key, a slate-violet sky fill and a dark ground bounce, a neutral grey dust for the fog and the pit's haze: shadows fall cool, the lit faces, the vein's glow, the geodes and the colossi's warm rims pop | `smithHeartHammer` (`heart_environment.ts`), `hammer_air.ts` |
| The stone | Stormcrag's cool grey granite, warm and cool grey beds mixed, crevices dark but never black; the warm lives in the light, the dust and the accents (bronze, vein light, braziers) | `shkit.py` palette, `heart_mountain.ts`, `heart_cliff_paint_core.ts` (the vein's cliff faces) |
| The back wall | Every terrace riser, the pit's rim and the Gallery's lips are sculpted rock cut in benches (wide blocks, faint partings, a few deep cracks, an overhang, spoil at the foot), and great cliffs of the mountain itself, cut in giant benches with a block half split out on its drill line and a seam of the vein's light, crown the top step behind the colossi and break the skyline | `hammer_cliff.py`, `Kit_QuarryFace*`, `Kit_QuarryRim*`, `Kit_QuarryLip*`, `Kit_GreatCliff*` (`HAMMER_CROWN`) |
| The colossi | A finer head (its own sculpt field): a knitted brow, heavy lids and drilled pupils, crow's feet, the nose's wings, a lower lip, a beard of carved locks ending in plaited braids; hands with fingers (stacked on the pommel, flat and heaving, hanging, gripping the haft); claw-chisel strokes and pointing holes where the carving stops | `hammer_sculpt.py` |
| The floor | Bedrock panels of every size on a broad tile, faint partings with a few open ones, the point's pocking and short claw scars, worn patches, wandering cracks, warm dust drifts in the vertex paint; fine fracture inlays on the pit floor (under the telegraphs' lift) | `paintQuarry` (`field_textures.ts`), `quarryColor`, `Kit_FloorCrack*` |
| The Cleft | Two braziers flanking the doorway, amber crystals breaking out of the flanks' foot, shafts of late sun through the crack with dust in them, the door's glow and a warm bounce on the flanks. The lights stand past the landing's lip at the landing's height (`HeartLightSpot.y`): 2B's door light had been planted on the void's height | `cleft_gate` (kit), `planHeartLights`, `planCleftShafts` |
| The North Stair | The dais's second way in, from the Ring's north (section 3.1) | `NORTH_STAIR` |

Readability: unchanged. The sight field of Mountain's Wrath is the trash engine's on every
tier; the floor's crack inlays stay under its lift (pinned), and the new dressing (cliffs,
cracks) is cosmetic and shed on the low tier.

### 5.11 The Hammer vein's last weak points (phase 2D)

The owner's ask after 2C: no weak point left in the Hammer vein. Every item 2C flagged, and
what a walk with the play camera (Cleft, Gallery, descent, pit, Slab) found next to the
Wildheart Basin and the Gravewyrm Sanctum:

| Weak point | Now | Where |
|---|---|---|
| The terrace faces read as a wall of blocks from the side and far | Each riser is a few continuous lifts at the SAME heights on every module (the benches run on unbroken round the quarry), the beds in one strata tone per lift, splits cut into the rock instead of gaps between boxes, the lip broken by spalls, rare wide bosses; the spoil lies flat | `cut_benches` (`hammer_cliff.py`), `Kit_QuarryFace*`, `Kit_QuarryRim*`, `Kit_QuarryLip*` (whose lower rock is now tall leaning shards) |
| The crown cliffs' crests ran straight like a broken wall | A mountain crest on each: low shoulders at both ends, a few asymmetric domed peaks, notches, a jagged ridge, the summit falling back from the face, an overhanging slab, scree laid on the benches where the rock is flat; pinned by the crests' silhouette test | `great_cliff` (`hammer_cliff.py`), `tests/smith_heart_hammer_kit.test.ts` |
| The Waking's braids read as beads on his chest | True three-strand plaits (a long one in the middle, shorter ones at the corners) gathered out of the beard, each with one snug bronze cuff and a combed tassel; every bronze part of the figures is now its own crisp shell, so no band breaks into a zigzag | `plait`, `bronze_shell` (`hammer_sculpt.py`) |
| The descent's foreground rock was too dark | The vein's grade lifts its fill to a slate-violet shadow (never black), the field's cliff faces and the shared strata texture take a true mid granite and soft relief, so the rock frames the pit | `smithHeartHammer` (`heart_environment.ts`), `heart_cliff_paint_core.ts`, `strataDetail` |
| The Cleft's shafts were too subtle | A fan of shafts of late sun (a broad one, lesser ones beside it, thin blades) with bright dust hanging in them, warm pools where they land, the amber crystals at the gate's foot glowing with halos and two small lamps | `planCleftShafts`, `HEART_CLEFT_CRYSTALS` (`hammer_air_core.ts`), `HEART_CLEFT_GLOW_LIGHTS` |
| The Gallery walked between smooth sandy slopes of the shared mountain and prism crags | In the Hammer vein the mountain climbs in flat ledges and sheer risers (never above the smooth slope, so no clearance moves), banded in granite beds, risers a value darker, each step its own shade; the crags are no longer drawn deep in the vein | `heartHammerTerrace` (`heart_mountain_core.ts`), `hammerRockBed`, `hammerRiserShade`, `heart_props.ts` |
| The cut blocks were pale boxes; the Slab a white board | The cut blocks are split stone with drill flutes down a fresh face; the Slab's halves are carved granite (a raised border round a pick-dressed field, the rune cut deep with the light in its groove, the split torn rough) under a sculpted frame | `cut_stone`, `slab_half_sculpt`, `slab_frame_sculpt` (`hammer_cliff.py`) |
| Small things | Motes fade near the lens (never blots), the grit falls as tight threads (never rain), the floor cracks lie paper thin (never sticks) | `hammer_air.ts`, `floor_crack` |

Readability: unchanged. The new light is grade only (Mountain's Wrath's sight field is the
trash engine's on every tier); the Cleft's lamps sit inside its light zone's budget; the
stepped mountain only ever stands lower than the smooth one.

### 5.12 The mountain's rock and the Gallery's walk (phase 2E)

The owner's ask: "AAA, and the Hammer not weak". After 2D the mountain's walls, every
room's, were still the heightfield's huge flat facets, and the Gallery walked on a plain
pale slab.

**The rock kit, and why bands on the heightfield.** One Blender kit of sculpted granite
(`rock_sculpt.py`): tall faces, faces, crests (broad low peaks), a rib standing out of
the face, boulders, and the lips that hang under the walks. Each face is the band's own
mass with the beds' plates stacked on it, each plate broken to its own outline, dipping
and overlapping (never a grid), cracks through them, an overhang now and then, the crest
falling back into the mountain, scree on the ledges; the weather paints big value groups
(pale worn crests, mid faces, cool joints never black, rain streaks under ledges, dust
and lichen only on the tops). 2D's sculpted walls were buried because they stood at a
fixed height at the walk's edge while the mountain climbed a hundred yards behind them.
Here the heightfield stays (the clearance, the open air and the sightline pins rest on
it) and becomes the dark mass BEHIND the rock: the plan (`planHeartRock`) lays the pieces
in bands along contours of the clearance (the yards past it), each piece's front plane
on its contour, its foot sunk into the slope, scaled so its crest reaches past the slope
behind it to the next band (its beds never stretched past half again), and a second pass
fills the bends a broad face cannot take with narrower pieces. The slope itself steps
back behind the first band, a ledge under the floor (`HEART_MOUNTAIN_RECESS`,
`HEART_MOUNTAIN_LEDGE`), so the first faces stand clear instead of buried. Rejected:
rebuilding the mountain from the kit (it would move the clearance every pin rests on,
for no visible gain).

**The walks' sides.** Every walk falling into the chasm (not the floating islands) takes
a hanging lip under its brink (`planHeartLips`): the same granite, leaning out over the
void past the field's own flaring face, following a stair's slope, its brink under the
lowest floor along it, and none where it would stand through another floor. The
quarried lips of 2B and 2D gave way to them (their worked face stood inside the field's
rock and never read); the chain hoists hang where they were.

**The Gallery's walk.** Its paths and landings are paved (`paving`): dressed flags in
courses, each its own tone, worn arrises, chipped corners, a crack here and there, dust
in the joints. A worn kerb runs along every lip over the chasm, broken into a rubble edge
about one module in four, and the masons' chain rail stands past it over the drop (none
where the lip bends onto another floor). Three blocks fallen from the Smith's work lie at
the walk's edges, on colliders (`sh_fallen_block`).

**Budget and tiers.** The rock is one lit material for the whole mountain (a heavier
triplanar fracture, a broad tile), instanced per piece in wide culling cells: measured
from the play camera the whole mountain adds about 75 to 85 draws and 1 to 1.4 million
triangles (the Ring view: about 410 draws and 3.2 million triangles in all, under the
Gravewyrm Sanctum's court's draws and half the Wildheart Basin's triangles). The bands
from the fourth up draw far builds of the same sculpts at about a third of the
triangles; the low tier keeps the first two bands (the walls the walks see) and sheds
the rest. The rock casts no shadow. Its material and its program warmers link with the
interior (the kit is awaited with the Hammer kit), so nothing compiles on first view.
The rock is cut away within a few yards of the camera (`heart_rock_cutaway.ts`), so a
camera zoomed out past an arena's rim never sees a wall: cosmetic, every tier.
Readability unchanged: no light, nothing over a walked floor, every key sightline pinned
with the rock in it.

### 5.13 The Ring, the seal and the portal (phase 2F)

The owner's ask: the Ring is the hub every vein crosses and the place of the raid's
biggest reveal; make it the raid's best space. Everything the Ring had was the field's
own geometry (a slate annulus, two ramps, a disc) and box placeholders (bronze tines,
forge pillars). Now it is one Blender kit (`docs/design/raid/kit/ring_pieces.py`,
`ring_sculpt.py`, built by `build_smith_heart_ring_kit.py` and shipped as
`public/models/props/smith_heart_ring_kit.glb`), primal and divine: living granite and
crystal, no metal, no machinery (the raid's line against Varkhul's).

| Piece | Look | Where |
|---|---|---|
| The Ring's walk | Dressed granite flags in nine courses round the seal, every course's joints staggered at the modules' ends, a band of dark basalt running the whole circle, worn arrises, chipped corners, a crack here and there, grit in the joints; a 6 degree module each, Start and End closing the arc square | `Kit_RingPave*`, `planRingPaving` |
| The Ring's edges | Over the chasm a curb under a hand on a carved fascia three lifts deep (none where the Quench's and the Heat's light leap); against the mountain a gutter of setts and the scree and fallen blocks heaped at the rock's foot | `Kit_RingCurb*`, `Kit_RingFoot*`, `planRingEdges` |
| The light-rivers | A channel inlaid where each river crosses the Ring (two carved lips, a polished dark bed the ribbon burns on), the dais's four channels from its rim to the seal's notches, a chute down the middle of both stairs | `Kit_RingChannel`, `Kit_SealDais`, `Kit_StairChute` |
| The two stairs | The Grand Stair and the North Stair laid tread by tread: two or three blocks a tread, worn hollow, nosings rounded and chipped; every tread's top on the walked ramp at its middle (half a riser either way), short treads on the Grand Stair, long low ones on the gentle North Stair; carved stringers three lifts deep and a low coped parapet (0.8, with newels) down both sides of every stair to the seal (the Balcony Stairs keep their field ramp and take the parapets) | `Kit_StairTread*`, `Kit_StairParapet*`, `planRingStairs`, `planRingStairSteps` |
| The Seal Dais | Its walk in courses round the seal (the seal's basalt ring first), the two stairs' landings out to their first treads, a rim of carved face and a low coped parapet open where the stairs land and where the Quench's and the Heat's light leap on; under it an inverted mountain some 46 yards deep, ledged and fissured, the four veins' crystal breaking out of it under each channel and crystal hanging from its root | `Kit_SealDais` |
| The seal | Four quarters of raw granite, each a rough rim (notched where its channel runs in), ribs along its sides and a bed of crystal cells; a crystal boss at the middle. The crystal is the runtime's own shader (`heartCrystalMaterial`): smoky and dark until its vein lights | `Kit_SealQuarter`, `Kit_SealHeart`, `heart_seal.ts` |
| The spires | The four bronze tines became four crystal spires (`sh_portal_tine`, collider 1.6): a banded drum of rough granite and a cluster of great crystal leaning in over the seal, the tallest's tip 16 yards up; each burns for its vein. The southern two stand a breath off the diagonals (`RING_SPIRE_BEARINGS`) so the Ring's two ends see past them to the portal | `Kit_SealSpire`, `ringSpireSpots` |
| The pack spots | A cairn at the rim behind each of the eight packs (`sh_ring_cairn`, collider 2): a block fallen from the mountain with a crystal lamp in a rock cradle, or a toppled standing stone broken in two with its lamp in the break, rubble round both | `Kit_RingCairn*` |
| The standing stones | The forge pillars became rough-hewn standing stones, chevrons carved in a band, a warm crystal lamp in the cleft of each one's head; the one that stood on the east Balcony Stair's edge is gone | `Kit_RingMonolith` |
| The vein mouths | A threshold of dark stones flush across each mouth and a pair of standing stones flanking it, each its vein's: the Breath's slender, twisted and holed by the gale, a pale teal crystal in its crown; the Quench's squat, frost-cracked, ice crystal growing out of its seams; the Heat's dark and sooted, split by seams of white-gold fire, a crystal ember at its head; the Hammer's (`sh_hammer_jamb`, on colliders at the Grand Stair's head on the Balcony) broad and heavy with ochre geodes broken open in it | `Kit_Jamb*`, `Kit_RingSill`, `planRingMouths` |

**How it sits on the field.** The field keeps every floor the sim walks; the kit
draws over it. The Ring's, the dais's and the two stairs' field tops are left out once
the kit has landed (`RING_KIT_OMIT_TOPS`, the field terrain's `omitTops`: neither drawn
nor cutting the ground under them), so the paving's joints show its own grit and the
treads never fight a ramp; the paving lies a breath over the walk, the curbs and
thresholds under a hand, the parapets, fascias, feet and mouth stones past the lips,
and every solid a body can touch on a layout collider (pinned against the shipped
GLB). Without the kit (it failed to land) the field's tops, its keel under the dais and
the placeholders stand, as before. The mountain's hanging lips start under the
fascias and stringers (`RING_KIT_FASCIA_DEPTH`).

**The Ring's rock (the 2E kit seen from the Ring).** Close up it read as squared slabs
with hooked cut-outs and saturated navy shade. The plates are now broken every way and
crossed by a second block turned its own way (never a rectangle), spalls knocked off
them, the weather deeper; the lips' brink no longer cut flat at the walk's height (its
cross-sections were the hooks): it rounds over and falls away out over the void. The
navy was light, not paint: the storm sky's reflection and joints sinking to black.
The rock's material keeps a shade floor of its own colour, a breath cooler, that no
occlusion takes away (`HEART_ROCK_SHADE_FLOOR`), the sky's reflection is a trace in the
Hammer's grade, and the Ring has its own state (`smithHeartRing`, out to
`SMITH_HEART_RING_LIGHT_R` past its rim): the same low warm sun as the quarry over a
neutral grey sky fill. The crest gained its landmarks: up to nine needles of stacked
beds (`Kit_RockNeedle*`, `planHeartNeedles`) on the deepest points of the mountain
round the Ring, 60 to 100 yards tall. A band piece whose body would reach over a walk
behind it is never placed (`backOverFloor`).

**The moments (VFX).** Every material is built with the interior (the seal's late
pieces carry hidden carriers of their crystal, plain and instanced), nothing reads a
texture, no light is added; all draw on every tier but the shards (fewer on the low
tier, `heartShardCount`) and the shake (reduced motion).

| Moment | Look | Where |
|---|---|---|
| A colour arrives | the river's ribbon flows toward the seal with a white-hot surge riding the light's front (`heartRiverSurgeHead`); the spire of its vein ignites foot to tip with a white flare (`heartSpireIgnite`); the quarter's crystal fills rim to centre under a flush light; its column stands up; a shockwave of its colour runs out across the chasm and the whole Ring (`heartSealArrivalWave`); the camera thuds | `heart_rivers.ts`, `heart_seal.ts`, `seal_shake.ts` |
| The seal splits | the four spires flare, the tines' arcs blaze from their crystal tips, a beam stands up out of the seal to the sky (`HEART_PORTAL_SKY_BEAM`), the bloom, the quarters part like petals (`heartQuarterPose`), the boss bursts into shards that lift out of the seams tumbling (`heartShardPose`), a four-colour ring wave and a wall of light ride out across the whole Ring, the camera trembles, jolts on the flash and shakes again as the shards lift (`HEART_PORTAL_SHAKES`) | `heart_portal.ts`, `heart_seal.ts`, `seal_shake.ts` |
| The living portal | the vortex and the funnel in the four colours, a slower wider sleeve round them, the shards turning round the funnel for good over every head, the four spires burning, a thin beam to the sky marking it from the whole main map | `heart_portal.ts`, `heart_seal.ts` |
| The hop | the arrival's column and ring, and the four colours whirling up round whoever arrives | `heart_portal.ts` |

### 5.14 The Breath vein (phase 2G)

The owner's ask: the Breath to the Hammer's level and above, primal and divine (living
granite, crystal and storm; nothing metal, no machinery). Before it the vein walked the
borrowed storm grade on slate, its props boxes and gold poles. Now it is one Blender kit
(`docs/design/raid/kit/breath_pieces.py`, built by `build_smith_heart_breath_kit.py` and
shipped as `public/models/props/smith_heart_breath_kit.glb`), its own floor, light, sky and
weather, and its guardian's effects.

| Piece | Look | Where |
|---|---|---|
| The floor | Every Breath walk from the mouth to the Cornice is storm-scoured pale granite: broad slabs parted by narrow cracks, wind flutes polished down the prevailing wind, wet hollows, sparse lichen; cooler and a value paler than the quarry | `scoured` ground (`paintScoured`, `scouredColor`) |
| The lightning rods | Five great drums of granite stacked and turned, leaning in one arc, the wind's bores through two, the Smith's carved collar of chevrons, a forked crown of two horns cradling a cluster of the vein's crystal, the strikes' fused glass running down in dark veins; a star of fused glass at each foot | `Kit_StormRod`, `Kit_StrikeScar` on `sh_lightning_rod` |
| The wind-horns | The "broken bellows" became two great stone horns lying on cradles, their bells (rolled lips) open to the rim, two carved bands of chevrons, a slow growth flute, the body curling up and over into a coil; the vein's light deep in the throat. The wind sounds them | `Kit_WindHorn` on `sh_broken_bellows` |
| The wind channels | Each notch in the Cornice's rim flanked by two cheek stones (tall blades fluted by the updraft, bored near the head, a crystal shard in the crown, on colliders) and a groove the Smith cut in the floor leading the updraft in toward the middle | `Kit_ChannelJamb` on `sh_channel_jamb`, `Kit_WindGroove` |
| The Wind Bridge | A natural arch of the mountain's granite under the ramp: its rib stepping out bed by bed as it falls, a great wind-eye under its middle, its legs flaring into the mist; the field keeps only a shallow keel under the deck and no mountain lip hangs there. Its two shelters are thick windbreaks on footings, scalloped on the windward face, the Smith's chevron in the lee | `Kit_WindBridge`, `Kit_WindShelter` on `sh_wind_shelter`, `BREATH_KIT_SHALLOW` |
| The low walls | Every Breath lip over the void, the bridge and the Cornice's rim included, takes a knee-high wall of rough storm granite under rounded pale copings (a coping blown off now and then), walked along the lip in short modules past its bow, never over a walk | `Kit_BreathWallA`, `Kit_BreathWallB`, `planBreathWalls` |
| The landings | Wind-carved standing stones at the landings' rims (twisted, scalloped, bored, a crystal crown, on colliders), the cracked plateau's fissures on the Cornice and the landings (flat, every telegraph draws over them) | `Kit_StormStone` on `sh_storm_stone`, `Kit_PlateauCrack*` |
| The light | Its own state, `smithHeartBreath`: a cold teal-white key high in the north-west over a neutral grey fill and a cool storm air, so the pale granite's shade is a cool grey, never navy; it wins north of the Ring's mouth (the first landing and the chimney), the Ring keeps its rim | `heart_environment.ts` (`SMITH_HEART_BREATH_LIGHT`, `inBreathLight`) |
| The sky | The summit inside the storm: a paler, lower deck racing in from the north-west, a rift where the key breaks through, lightning walking the cloud and, every few seconds, a distant bolt | `heart_sky.ts` (`setBreath`) |
| The weather | The gale's streaks and the grit it carries over every Breath walk; cloud banks rolling past under the Cornice's rim and through the bridge's chasm; the bridge's gusts in a steady rhythm (a band of wind sweeping down the ramp from the summit, a curtain on its front, the streaks surging); lightning striking the Cornice's rods in turn (a bolt from the cloud, the crown's flash) | `breath_air.ts` (`breathGustAt`, `breathStrikeAt`) |

Effects of the Breath guardian (`src/render/smith_heart_fx/breath_fx.ts`, presentation
only, the sim untouched):

| Moment | Look |
|---|---|
| Bellows Gust, on its bar | its footprint (a ring at the gust's exact radius) fills with the bar; the breath is drawn in along the floor from past the ring, loose stones lift into a whirl that tightens and quickens, a funnel of wind twists up round the guardian |
| Bellows Gust, landing | a wall of wind rides out past the ring to where the shove ends, the stones and a spray of grit flung outward, streaks bursting out, two rings, a short shake |
| Storm Lance, on its bar | its footprint (a lane at the lance's exact length and width, aimed where the bar locked it) fills; lightning crackles round the guardian, sparks run down the lane |
| Storm Lance, landing | a bolt falls from the cloud onto the guardian and a spear of lightning runs down the lane (never past its width), the stone scorched along it, smouldering a few seconds |

Readability: the two footprints are the shared floor telegraph (threat colour `danger`,
the vein's teal as the accent) on every graphics tier; before 2G these casts had only
their bars. The wind, the lightning, the debris, the clouds and the gusts are cosmetic:
the low tier keeps a third of the particles, reduced motion drops the shake. The wind
bridge's gusts are its set piece's look only (section 6.2's mechanic is not built); the
strikes on the rods are harmless scenery. Every effect is built with the interior or
under one compile-gated root, so nothing links on first use. The new cheek stones and
standing stones stand on layout colliders at the rims, clear of every walking line. No
boss mechanic and no number changed.

### 5.15 The Quench vein (phase 2H)

The owner's ask: the Quench to the Breath's and the Hammer's level and above, primal and
divine (living granite, ice and the cold; nothing metal, no machinery). Before it the vein
walked the borrowed storm grade on plain snow and ice, its props boxes and steel bars. Now
it is one Blender kit (`docs/design/raid/kit/quench_pieces.py`, built by
`build_smith_heart_quench_kit.py` and shipped as
`public/models/props/smith_heart_quench_kit.glb`), its own floors, light, sky, frost and
weather, the Singing Ice's look and its guardian's effects. The kits gained a third slot,
KitIce (`heart_kit.ts`'s ice slot, `heart_ice_sheen.ts`: glossy, a cold sheen at grazing
angles and a breath of inner light, so thick ice never reads as blue stone).

| Piece | Look | Where |
|---|---|---|
| The floors | Every Quench walk from the mouth to the shelf is frost-bound granite: the freeze's slabs parted by joints packed with rime, long frost cracks, a hoar film, soft snow drifts in the vertex paint. The Frozen Lake and the Singing Ice are clear lake ice drawn with depth: dark water under it, bubbles at three depths and old straight-run cracks shifting with the view, the pale sky at grazing angles, paler over the shallows, snow drifted in at every edge; the Singing Ice crazed with fine frost cracks and rougher (no sun glare over a telegraph) | `rime` and `lake_ice` grounds (`paintRime`, `paintLakeIce`, `rimeColor`), `quench_lake_ice.ts` (the field terrain's `topMaterial` seam) |
| The fire bowls | The four braziers are the Smith's carved fire bowls: a stepped plinth, a fluted pedestal, a wide bowl with a rolled rim, the chevrons cut round it and four lugs, a bed of live coals; the rime melted off its top and its rim sooted, its meltwater frozen under the belly. Body-wide colliders (1.5); a warmer budgeted light each | `Kit_LakeBrazier` on `sh_brazier` (`LAKE_BRAZIERS`) |
| The sunk blades | The Smith's great blades of ice sunk point first in the lake: a broad flat blade, deep blue in its thick heart and milky at its keen chipped edges, a fuller down both faces with the vein's light in it, a crossguard of two swept horns of ice, a frost-wrapped grip, a crystal pommel; the lake heaved up round each in broken plates | `Kit_SunkBlade` on `sh_sunk_blade` |
| The heaped ice | Old lake ice shoved up against the basin's walls past the shelf's rim: broken plates lying low in front and upended in a jagged crest behind, dust-banded, snow in their hollows, icicles under their brows, a glacier tongue plunging into the mist | `Kit_IceShelfA`, `B` on `sh_ice_shelf` |
| The landings | Frost-cracked standing stones on the landings' rims (two blocks, a chevron band, ice grown in three wandering cracks, a crystal deep in one, snow on the head, on colliders), and low walls along every Quench lip over the void (frost granite a knee high under snow-pillowed copings, icicles off the outer face; the Breath's lip planner, now shared: `lip_walls_core.ts`), snow banked at their foot on the flat floors | `Kit_FrostStone` on `sh_frost_stone`, `Kit_QuenchWallA`, `B`, `planQuenchWalls`, `Kit_SnowDriftA`, `B` |
| The vein's walls | Frozen falls hung on the mountain's first band of rock where it climbs well over a Quench walk: fused columns of ice bulging in freeze rings, deep blue in their grooves, an icicle beard, a frozen splash at the foot, a snowy notch of rock at the head | `Kit_FrozenFallA`, `B`, `planQuenchFalls` (`QUENCH_FALL_RULES`) |
| The vents and the Singing Ice | The shelf's vents are rings of wet dark stone the steam keeps free of frost, pale mineral crust, a faint light down the throat; the Singing Ice takes crack webs and long cracks (flat inlays) and two clusters of blades heaved up through it | `Kit_SteamVent` on `sh_steam_vent`, `Kit_IceCrackA`, `B`, `Kit_IceBlade` on `sh_ice_blade`, `planQuenchDressing` |
| The rock's frost | The mountain stays calm (2G's big masses): in the Quench its rock, its heightfield and the field's own cliffs take frost in big value groups only, a cold film a value paler and bluer, rime and old snow on every ledge in broad drifts, faint glaze streaks down the faces | `quench_frost_core.ts` (`quenchFrostWeight`, the rock material's `quenchFrostGlsl` from the slot's origin, `quenchCliffPaint`) |
| The light | Its own state, `smithHeartQuench`: a pale cold sun low in the south-east through a thin overcast, a pale blue-grey sky fill over a cool ground bounce, so the frost reads pale and every shade a clean cold blue-grey, never navy; a pale-blue mist thin across the lake. It holds east of the Ring as soon as the camera is past its rim | `heart_environment.ts` (`SMITH_HEART_QUENCH_LIGHT`, `SMITH_HEART_QUENCH_FOG`, `inQuenchLight`) |
| The sky | Calm and cold: a pale overcast thinning to a wash of cold blue overhead, high thin veils and cirrus drifting slowly, the low sun behind them with the ice crystals' 22 degree halo round it | `heart_sky.ts` (`setQuench`) |
| The weather | Snow drifting down over every Quench walk with frost motes glinting in it, steam rising off the vents and out of the rock past the rim, a pale mist lying in the void under the walks; each fire bowl burning a tall flame with embers, a halo that marks it from across the lake and a warm pool on the snow (the one warm thing in the cold) | `quench_air.ts` (`planQuenchAir`) |
| The Singing Ice | Its set piece's look (section 6.3's mechanic is not built): every few seconds a crack creaks out across the sheet (a dark seam opening under a white-hot line of the vein's light, brightest at its running front) and bursts into frost at its end; the creaks wear the vein's pale light, never a threat colour, and lie under every telegraph | `quench_air.ts` (`quenchCreakAt`, `quenchCreakLook`, `planSingingCracks`) |

Effects of the Quench guardian (`src/render/smith_heart_fx/quench_fx.ts`, presentation
only, the sim untouched):

| Moment | Look |
|---|---|
| Quenching Breath, on its bar | its footprint (a cone at the breath's exact angle and range, aimed where the bar locked it) fills with the bar; the cold is drawn in to the guardian's maw, frost creeps out over the cone's floor under the fill, glints wink in it |
| Quenching Breath, landing | a freezing gust of mist sweeps out to the cone's end, ice rips up out of the floor behind its front and shatters, glints are flung out, the floor stays frosted a few seconds (plates of crust, feathers of hoar), a ring, a short shake |
| Tempering Strike | (a swing cleave with no bar, like Hammerfall) spikes of ice thrust up out of the floor in its arc and reach, hold, then shatter into shards and mist; the floor frosted where it struck, a ring, a short shake |

Readability: the cone is the shared floor telegraph (threat colour `danger`, the vein's pale
ice as the accent) on every graphics tier; before 2H the breath had only its bar. The frost,
the mist, the ice, the snow, the steam, the creaks and the fire are cosmetic: the low tier
keeps a third of the particles (the fire and the creaks stay), reduced motion drops the
shake. Every effect is built with the interior or under one compile-gated root, so nothing
links on first use; the creaks and the fire pools are floor marks on the ground rung, the
frost on the encounter band under the telegraph's fill front. The new stones stand on
layout colliders at the landings' rims, clear of every walking line; the braziers' colliders
grew to a body's width. No boss mechanic and no number changed.

### 5.16 The Heat vein, now the Hearth (phase 2I)

The owner's decision (2026-10-25, the "no repetir a Varkhul / Ignivar" note of the
design decisions): the Heat is no longer a forge. It is the Hearth, the Smith's first
flame: white-gold fire (never volcanic red) sealed in living crystal and in the
mountain's dark basalt, cooled into the bundled hexagonal columns the whole vein is known
by. No anvil, bellows, crucible, chain, coal or tool; the Smith never appears. Visual
only: every layout id, constant, collider, gate, pack spot and mechanic the sim uses
keeps its place (`HEAT`, `HEAT.forge`, `GREAT_HEARTH`, `GIANT_ANVIL`, `POUR_CHANNEL`,
`sh_pour_crucible`, `anvil_mouth` and the rest keep their forge names); only what the
player sees changed. The kit is `docs/design/raid/kit/heat_pieces.py`, built by
`build_smith_heart_heat_kit.py` and shipped as `public/models/props/smith_heart_heat_kit.glb`
(two slots: KitStone, KitGlow).

| Piece | Look | Where |
|---|---|---|
| The floors | Every Heat walk is the heads of the basalt columns (a jittered hexagonal lattice, a yard and a half to two across, each its own warm dark grey, worn to a low dome), deep joints with ash packed into stretches of them, and in a few wandering bands the joints burn: the floor's material finds their painted hue and lights them with the first flame, breathing slow and uneven (never a pulse that reads as a warning), the heads either side baked umber. The cliffs under the floors are rock, not masonry | `hearth` ground (`paintHearth`, `HEARTH_SEAM_PAINT`, `hearthColor`), `heat_hearth_floor.ts` (the field terrain's `topMaterial` seam) |
| The Hearth's mouth | The old great hearth: a vast natural mouth in the mountain behind the Forge's west wall, framed by a fan of basalt columns radiating round its pointed arch (as basalt cools round a vent), soot climbing the face over it; its throat full of the first flame's crystal, great white-gold prisms rising from its floor, hanging from its roof, crowding a faceted heart burning at the back. By the left jamb, a cluster of crystal with its heart torn out, its socket scorched black and cracked: the spark Varkhul's Last Flame was. Render only, past the floor's lip, no shadow | `Kit_HearthMouth` on `sh_great_hearth` |
| The altar-stone | On the old giant anvil's footprint and height: a dolmen of the mountain's basalt, three pairs of columns in a bed of stumps carrying one great capstone, a crack of white-gold fire down its table and over its edges, crystal breaking out of its north end (where the anvil's horn was) and rising under it from the ground | `Kit_AltarStone` on `sh_giant_anvil` |
| The wellspring | The pour crucible's spot: a cracked mound of column stumps brimming with the first flame (a low dome of white-gold fire, crust riding on it), crystal crowding its back, its lip split toward the Pour Channel where a tongue of fire spills down a chute to the channel's head | `Kit_Wellspring` on `sh_pour_crucible` (`HEAT_WELL_FIRE`) |
| The Pour Channel and its spill | The groove the fire has worn across the casting floor (its bed one dark glassy skin of the cooled pour, a residue glowing faint down its middle, worn lips of the floor's columns a hand proud), and at the floor's south lip the notch it pours through, cheek stones either side and the glaze the pours ran down the cliff in | `Kit_PourChannel`, `Kit_PourSpill`, `planHeatChannel` |
| The crystal, the boulders | The old crucibles are clusters of the first flame's crystal on beds of column stumps; the old bellows long boulders of basalt split open by a seam of fire, crystal grown in the split; the old casting channels seams of fire laid along the Forge's floor | `Kit_FireCrystalA`, `B`, `Kit_EmberBoulder`, `Kit_FireCrackA`, `B` |
| The hall's sides | Bundles of basalt columns rising out of the chasm at ten of the Forge's corners (the two by the mouth are its jambs), their heads stepped, fire in a joint, crystal breaking out of a side: the eight-sided hall as carved mountain. Past the lips, never over a walk | `Kit_HearthPillar`, `planHeatPillars` |
| The bridge and the walls | The anvil bridge stands on a natural arch of columnar basalt, its eye glazed warm by the chasm's fire (the field keeps only a shallow keel under the deck, `HEAT_KIT_SHALLOW`, and no mountain lip hangs there); every Heat lip over the void takes a rank of basalt columns, their heads a knee high, ash on them, never across the spill; drifts of ash banked at their feet | `Kit_HeatBridge`, `Kit_HeatWallA`, `B`, `planHeatWalls`, `Kit_AshDriftA`, `B` |
| The mountain | Calm (2G's big masses): in the Heat its rock, its heightfield and the field's cliffs turn to sooted basalt in big value groups only, broad vertical bands of its columns, faint soot up the faces, ash on the ledges | `heat_soot_core.ts` (`heatSootWeight`, the rock material's `heatSootGlsl`, `heatCliffPaint`) |
| The light | Its own state, `smithHeartHeat`: a warm white-gold key low from the west (the Hearth's side), over a cool slate smoke fill and a dim umber bounce (the fire below), so the basalt's shade is a cool dark grey, never black, and the warm lives in the key and the fire; a smoke haze a breath of grey-brown. The Hearth's own point light lays its gold across the Forge; another burns deep in the chasm under the bridge | `heart_environment.ts` (`SMITH_HEART_HEAT_LIGHT`, `SMITH_HEART_HEAT_FOG`, `inHeatLight`), `heart_plan_core.ts` (`hearth`, `chasm:heat`) |
| The sky | The smoke of the first flame climbing out of the fissure and drifting east in slow billows, lit gold from below near the rim, a hazy white-gold sun low in the west behind it, a deep warm slate overhead | `heart_sky.ts` (`setHeat`) |
| The weather | Embers rising over every Heat walk and out of the chasm, thick in the Hearth's throat; tall tongues of the first flame among its crystal; smoke climbing out of the chasm and off the Hearth's crown; the fire deep in the chasm glowing under the walks; a halo round every cluster of crystal; the heat's shimmer over the mouth, the wellspring and the bridge's chasm | `heat_air.ts` (`planHeatAir`), the shared fire shaders `heart_fire_glsl.ts` |
| The pour | The set piece's look (section 6.4's mechanic is not built): every 26 seconds the wellspring brims and glows, the channel's bed lights from its head to the lip, then white-gold fire runs down it, fills it, falls off the lip into the chasm and drains, cooling dark | `heat_pour.ts` (`heatPourLook`, `HEAT_POUR`) |

Effects of the Heat guardian (`src/render/smith_heart_fx/heat_fx.ts`, presentation only,
the sim untouched):

| Moment | Look |
|---|---|
| Molten Pour, on its bar | its footprint (a lane at the pour's exact length and width, aimed where the bar locked it) fills; the first flame gathers at the guardian, the floor's seams light down the lane toward its end, sparks run along it |
| Molten Pour, landing | white-gold fire pours down the lane behind a wave of flame (never past its width), spatter and sparks thrown up, the lane left molten, cooling to a dark crust in plates and smoking a few seconds, a ring, a short shake |
| Searing Knell, on its bar | its footprint (a ring at the stun's exact radius) fills; the fire is drawn into a sphere over the guardian, cracks of fire run out over the floor to the ring's edge |
| Searing Knell, landing | a flash, a wall of white-gold fire ringing out to the stun's edge (never past it), the cracks flaring and fading, three rings of the toll, sparks and ash flung out, a short shake |

Readability: the two footprints are the shared floor telegraph (threat colour `danger`,
the vein's white-gold as the accent) on every graphics tier; before 2I these casts had
only their bars. The pour's warning glow and its flow draw on every tier; the embers,
sparks, smoke and haze are cosmetic (the low tier keeps a third of the particles and
no haze; the flames, the halos and the chasm's glow stay), reduced motion drops the
shake. Every effect is built with the interior or under one compile-gated root, so
nothing links on first use; the channel's glow is a floor mark on the ground rung, the
molten lane and the seams on the encounter band under the telegraph's fill front. No
new collider: every solid stands on the layout's old ones or past the lips. No boss
mechanic and no number changed.

Player-visible text: the guardian's knell was "Anvil Clang"; it is now "Searing Knell"
(the English source in `src/sim/content/smith_heart.ts`, `src/ui/sim_i18n.ts` and
`src/ui/i18n.catalog/merge.ts`; its ids unchanged; the name was web-checked and collides
with no other game's). The anvil bridge's gate reads "Hearth Mouth" (it read "Anvil
Mouth"; its id `anvil_mouth` unchanged). The pour keeps "Molten Pour".

### 5.17 The Heart, the final room (phase 2J)

The owner's ask: the separate final room to the raid's level, primal and divine, its own
light and sky, and the APPROVED arrival scene (DECISIONES_DISENO.md, "jefe final"): the
heart rising, tearing rocks out of the room and binding them into the colossus. The room
is one Blender kit (`docs/design/raid/kit/heart_pieces.py`, built by
`build_smith_heart_heart_kit.py` and shipped as `public/models/props/smith_heart_heart_kit.glb`;
three slots: KitStone, KitGlow, KitIce), placed by `heart_room_kit_plan_core.ts` and painted
by `heart_room_kit.ts`; the body and its effects are `../smith_heart_fx/final_fx.ts`.

| Piece | Look | Where |
|---|---|---|
| The Anvil of the World | A vast carved rock disc: dressed granite flags in courses round a basalt hub, three bands of dark basalt where the rune rings burn (14, 26, 38.5), four channels from the hub to the altars carrying each vein's light, a carved fascia two lifts deep and a coped balustrade round the lip (newels crowned with crystal lamps, open where the bridge lands); under it the mountain's rock as an inverted peak, a carved drum of the Smith's chevrons under the fascia, buttressed under each altar, each vein's crystal breaking out of it under its altar, crystal hanging from its root | `Kit_AnvilFloor`, `Kit_AnvilKeel` |
| The Arrival Terrace | The same carved disc, smaller, its keel, the return portal's basin and kerb with crystal studs, two tall standing stones past the lip behind it | `Kit_TerraceFloor`, `Kit_TerraceKeel` |
| The Heart Bridge | A carved stone bridge: its deck in courses down the field's own ramp, a coped parapet each side (a gap for the gate's stones), a segmental arch of voussoirs with a crystal keystone, its spandrels in courses, its abutments falling into the keels | `Kit_HeartBridge` |
| The altars | On a shared stepped plinth carved with chevrons, each in its vein's stone: the Hammer's ochre granite split round a geode, the Breath's twisted storm stone bored by the wind with two blades over its crystal, the Quench's frost granite under three fused columns of clear ice (the ice slot), the Heat's bundled basalt bursting with fire crystal. Taller than their colliders (r 3, never wider), so a body hidden behind one reads hidden from Forge Wrath. Their crystal lights and dims per vein (`setVein`, for the later altar drags) | `Kit_Altar*`, `heart_room_kit.ts` |
| The roots | The four chains are gone (my call: the raid is primal and divine and has no metal). Four colossal roots of the mountain, braided strands of rock knotted where they bind, rise out of each altar's crown, their fingers gripping it, and arch out over the walk (well over head height) into the crown's rock, their crystal veins carrying the vein's light down into the altar | `Kit_HeartRoot`, `HEART_ROOT_SPINE` |
| The heart's bed | Deep in the chasm, a crater of the deep's dark rock lined with white-gold crystal round the hollow the heart rises from, drawn past the platform's lip so a raid looking over the balustrade sees it burning; its crystal dims when the heart dies | `Kit_CoreBed`, `HEART_CORE_BED_SCALE` |
| The crown | The mountain round the chamber in a dark warm granite, a breath of violet in its shade, thin veins of crystal wandering through its faces in each quarter's vein colour, the heart's light from below on every face turned down to it | `heart_crown_core.ts` |

The field omits the tops the kit paves (`HEART_KIT_OMIT_TOPS`), keeps a shallow keel under
the bridge (`HEART_KIT_SHALLOW`) and drops the lathe keels the kit replaces; without the kit
the blockout stands as before. Every piece a body can touch is on a layout collider (the
altars) or past a lip; no new collider.

**Light and sky.** The ember-violet night with its slow stars (`setCore`) stays; the key now
falls high from the terrace's side (`SMITH_HEART_CORE_LIGHT.keyDirection`), so the raid
crossing the bridge sees the colossus lit and the crown in shade; each altar's budgeted light
reaches its quarter; the core's light rises from the bed, the shafts climb out of the chasm.

**The arrival.** The one sim signal: the first tick a living player stands in the Heart the
seal markers take the arrival bit (`SMITH_HEART_AWAKE_BIT`, 32) and keep it for the claim's
life (`tickSmithHeartSeal`; no rng, no clock, no mob touched; `/dev heart arrival` replays it).
The renderer's seal memory reads it (`awakeSince`): seen waking, the scene plays from there;
first seen awake (a late arrival, a reconnect) it is long past and the body is whole. Online it
rides the markers' template id like the veins (no wire change). The timeline (`ARRIVAL`,
`final_fx_core.ts`): a breath while the hop's wash clears; a pillar of the heart's light stands
up out of the chasm and the heart rides it up past the platform's far rim, swollen with light,
and glides in over the platform; one by one the room's rocks (eleven resting on the walk
between the altars and the channels, off the bridge's line, and ten shards under the lip)
tremble, tear free of the paving with a burst of dust and broken stone (leaving a scar,
`Kit_TornSocket`), lift, spiral in round the heart tumbling with a trail of light and lock into
the body with a flash and a thread of a vein's light; as the last locks, the four-colour
shockwave races over the platform and the chasm and the camera thuds (reduced motion drops
the shakes). A pull during the scene runs it on to its end in under a second. Nothing is
attached later than the interior and the effects' own gated root; the kit's pieces draw with
the kit's own linked slot materials.

**The body.** A bodyless target (`smith_heart_colossus` in the manifest, its nameplate over the
head) with a colossus of the kit's rock pieces bound to the crystal heart, some twenty yards
tall: torso, hip, head with a crown of peaks and a cleft of light for eyes, shoulders, two arms
on a two-bone reach, fists, a skirt of shards and more over its back; it hovers and breathes.
Its joints and timeline are its own (`COLOSSUS_SLOTS`, `colossusArmIk`), so the final creature
model (the official pipeline) replaces the pieces and keeps them.

| Moment | Look |
|---|---|
| A swing (the tank) | one arm swings down at the tank |
| Forge Fist (arc cleave) | both fists up and down into the floor ahead: dust, broken stone thrown out across its arc, a ring, a short shake |
| Forge Wrath, on its bar | the arms flung up, the pieces parting off their joints, the heart blazing, the room's light drawn into it (the sight field telegraph is the trash engine's, every tier: hide behind an altar) |
| Forge Wrath, landing | a blinding flash from the heart, sparks flung out, a wall of light riding out on the engine's wave clock to the nova's radius, a shake |
| Forge Pour, on its bar | its cone at the exact range and arc through the shared floor telegraph on EVERY tier (threat colour `danger`, white-gold accent; before 2J it had only its bar); the body leans in, hands cupped |
| Forge Pour, landing | a torrent of white-gold fire out of the hands down the cone, the floor burning in it behind its front (never past its arc or range), crusting dark and smoking |
| The death | the threads snapping, every piece falling, crumbling to rubble on the platform or tumbling off the lip into the chasm, the heart flickering as the veins go out and sinking dark into its bed; the room goes dark with it (the bed, the core, the rune rings, the altars, the roots and the channels, `heart_final_core.ts`) |

Readability: the Pour's cone and the Wrath's sight field draw on every tier; the dust, sparks,
trails and smoke thin on the low tier; the shakes go under reduced motion. No mechanic and no
number changed; no player-visible text added.

### 5.18 The Hammer Council's look (prototype)

The council's effects are `src/render/smith_heart_fx/council_fx.ts` (pure plan
`council_fx_core.ts`) and its two new bodies `council_bodies.ts` (pure plan
`council_bodies_core.ts`), both hosted by `rift_death_zone.ts` and read from IWorld only.

| Moment | Look |
|---|---|
| The Slabwright, the Seam Singer | Provisional bodies of the kits' own stone, floating pieces stitched by ochre threads of the vein's light like the Heart's colossus: the Slabwright broad and blocky with slab shoulders, the Seam Singer tall and slender with glowing amber seam crystals; both about 2 to 2.5 times a player. Idle breath, a swing, cast poses (the Slabwright raises its arms and slams for Wake the Stone and the rock; the Singer lifts its arms and its crystals flare with the bar), a hunch and white-gold threads when one holds the Wrath, a fall into rubble. Their joints are kept apart from the pieces, so the official pipeline's models replace the pieces only |
| The pillars | The quarry's carved columns (the Hammer kit's) and the risen stone (the rock kit's needles), each drawing its integrity on the model: a network of seams cracking open and burning hotter, a growing lean, and its pips round its foot: an arc of light on the floor for each piece it started with and, on it, a carved stone socket holding a gem of the vein's light (a spent one a dark stone; the last one throbs; a flash as one is lost) |
| A pillar rising | Bursting out of the floor in under a second with a shudder, a ring of dust, shards thrown out and a shock ring at the knockback's reach |
| A pillar losing a piece | Its seams flash, chips and dust off its face, a short shake |
| A pillar falling | It tips, breaks and sinks into the floor in a cloud, shards flung; its rubble then lies as a hazard footprint (the danger colour) with the kits' rubble pieces until it is gone |
| Mountain's Wrath | 2B's (cracks, lifted stones, dust wall) for whichever member holds it; the sight field (the trash engine's, every tier) shows the hatched safe shadow behind each pillar, faded out right at the camera's lens; over it, the REAL shadow behind each pillar the Wrath cannot see past: a strong dark wedge on the floor (between the two tangents from the caster, from the pillar's far face out to the reach, a hair inside the sim's own cover) with a bright pale rim and a faint curtain of light standing along its edges, so a player at ground level reads exactly where they are safe (`council_shelter_fx.ts`) |
| The energy | A gauge on the floor round the holder filling with the energy (white-hot past 80) and a glow over its head with rising embers |
| Hammer's Weight | A slab of stone dropping onto the tank and shattering (a lethal-coloured ring), then the tank's mark: a ring at its feet showing the time left and a stone hanging over its head |
| Wake the Stone | The circle round its player at the knockback's reach (the control colour, ochre accent), filling with the mark, and the ghost of the pillar growing in it |
| The heir's rising stone | The same circle locked on the floor (the danger colour) for its 2 s |
| Falling Rock | The soak round its player (gold: gather in it) filling with the mark, motes drawn in; a thick bright rim at the soak's edge cut into one segment per second, each going dark as its second runs out, a white head sweeping to the end; a beacon of gold light over its player; the boulder hanging high over the soak from the moment the mark goes on, sinking, then dropping over its last 1.2 s while its shadow on the floor grows and darkens; the impact's dust, shards and rings (`council_soak_fx.ts`) |
| Seam Bolt | An ochre crystal shard thrown on an arc with sparks, bursting on its mark |
| Resonance | A notched ring round the player at the 3.5 yd reach and a shimmer round the body; while it cracks a pillar, a thread of light to that pillar and the pillar humming (shaking, its seams glowing) |
| The stone remembers | A river of beads of stone light arcing from the fallen to each survivor, a flare on arrival |
| Heroic pulse | A ring out to each pillar's reach every 2 s |
| Mythic: the soul taking the stone | A river of beads in the soul's own colour from the fallen into the most intact pillar, a flare as it tears free, and on arrival the stone wakes: a burst of its light and two shock rings |
| Mythic: a soul pillar | Its cracks always open and burning in the soul's colour (the Guardian an ember red-orange, the Slabwright jade green, the Seam Singer sky blue: none of them a mark's colour), a sheath of that light climbing the stone, three soul pips in it round the foot, motes rising off it; it brightens as its behaviour charges |
| Mythic: a pip struck off | The stone flashes and chips, the pip's light tears out of its foot in sparks and a ring |
| Mythic: a soul pillar bursting | A flare of the soul's light, a slow column of it climbing away (the soul dissipating), rings, then the usual fall into rubble |
| Mythic: Echo of Wrath | While its bar runs: a lethal ring out to the Echo's 45 yd filling with it, the real shadow behind every other pillar as the Wrath's (a dark wedge with a bright rim and a light curtain, never wider than the sim's cover), embers drawn into the pillar; on landing rings race out, a wave of dust rolls over the floor, a flash and a shake |
| Mythic: the Walking Slab | Its own look (the Heart kit's `Kit_SlabCollar`, `Kit_SlabClaw` and `Kit_SlabFace`, `council_slab_fx.ts`): a collar of root rock heaped round its foot, five stone claws round it (the front pair reach out, slam down and bite, then haul the stone forward while the rear three push), a face of cracks on its front with the jade burning in its eyes and mouth, turned the way it drags; the stone lurching and rocking forward on each pull, gouges raked into the floor where the talons bite, grinding dust, its two footprints riding with it (the crush lethal, the grind danger); a crush throws shards and dust off its player and jolts the ground. Still a soul pillar first: its jade cracks, sheath and three jade pips |
| Mythic: the Endless Song | A notched ring on the floor round the pillar that widens and brightens with every pulse sung, a clock ring closing on the stone until the next pulse, and the pulse's sound rings racing out over the whole Quarry, more of them and brighter as the song grows |

Readability: every footprint (the floor telegraph), ring, gauge, pip, crack and lean draws
on every tier; the static preset sheds only dust, grit and debris; reduced motion drops the
shakes. On mythic the soul colours, the sheath, the soul pips, the Echo's ring and its
shelter wedges, the slab's footprints and the song's rings draw on every tier too (which
pillar holds a soul is never shed); only the motes, embers and dust thin. Every material is built with the effects' root under one gated attach (the kits'
pieces draw with their shared slot materials, warmed with the interior), no light, fixed
pools. The council's own cues are claimed (`councilClaims`), so no generic burst doubles
them; the marks and cues are mirrored entity state, so online looks the same. The Hammer
kit's plan keeps only the columns' sockets: the column itself is the council's.

**Sound and voice (the polish pass, 2026-10-26).** The council's moments have their own
sampled sounds (`heart_council_*`, ElevenLabs through `scripts/gen_sfx.mjs`, catalogued in
`docs/design/sound_effects.md`), played by `src/game/smith_heart_council_audio.ts` off the
council's own cues, bars and marks (the HUD's generic nova never doubles them): the Wrath's
charge fitted to its bar and its blast, a pillar rising, cracking and falling, the rock's fall
as it drops and its impact, the Seam Bolt, the song's swell; on mythic the soul flowing in,
the Echo's charge and blast, the Walking Slab's grinding loop while it drags and its crush,
each Endless Song pulse louder and deeper as it grows, a pip struck, a soul pillar bursting.
The heroic pulse is one soft hum, cooled. The members speak as boss yells
(`council_voice.ts`, `hudChrome.council.say.*`); their voices are auditions only until the
designer picks one (`scripts/audition_raid_boss_voices.mjs --set council`).

### 5.19 The Guardian of the Breath's look (prototype)

The fight's effects are `src/render/smith_heart_fx/breath_fight_fx.ts` (pure plan
`breath_fight_fx_core.ts`) and its provisional body `breath_body.ts` (pure plan
`breath_body_core.ts`), both hosted by `rift_death_zone.ts` beside `BreathFx` (which keeps
Storm Lance and Bellows Gust) and read from IWorld only. The vein's art rule holds: living
granite, crystal and storm, no metal, no machinery; the "bellows" is a creature that
breathes (the old brass chains are gone with 2G's rule).

| Moment | Look |
|---|---|
| The body | A living bellows of storm granite and crystal, about 3.5 players tall: a barrel chest between two bellows plates that swell and empty, a wind-horn mouth, fluted wind-blade wings, crystal spines, rock arms ending in wind-carved claws, a whirl of loose stones for legs, held by threads of the vein's teal. Built from the Breath and Heart kits' pieces; its joints are kept apart from the pieces so the official pipeline's model replaces the pieces only |
| Its motion | Idle breathing, a swipe on each swing; as a blow gathers it turns its mouth to the coming bearing and fills, through the blow it exhales down it; it swells past full on the indrawn breath and hunches, then throws itself wide, on Bellows Gust; on its casts it raises one arm and thrusts the other |
| The storm breaks | On its bar it draws the wind in, freezes with every seam blazing, then tears open: from then on every stone rings in three orbits round a core of living lightning (a storm figure, two lightning wings, a white heart, arcs to the shards). A player arriving late sees the storm body whole at once; on its fall the pieces drop |
| The wind | A field of chevrons and streaks over the whole Cornice floor, on every tier: during the gather the arrows build toward the coming bearing behind a leading edge sweeping across; through the blow they are full; they die in the calm; while it draws breath (and while the storm breaks) they point inward at the guardian |
| The gaps | A lethal red light curtain and floor band on each gap's open lip (read off the field's own open cliff runs), on every tier, flaring when the wind blows toward it; past the lip, broken wall stubs, a coping block tumbled over the edge, flat chips |
| Pinned | A danger arc at the player's feet facing the wall, grit off the coping |
| Thessaly's circle | Its footprint at its exact radius in mint (the shared floor telegraph): filling while it lands under a falling beam of light, then holding with a pip for each seat still free, dim when spent; a calm dome on the high tier. An anchored player wears a mint ring; a mint arc of light runs from Thessaly as the anchor takes them |
| The indrawn breath | The vortex at its exact radius (danger), the inward field, the streaks drawn in |
| The storm's strikes | Each spot at its exact radius (danger), filling with its warning; then a bolt from the sky, a scorch, sparks and a ring |
| Leaping Bolt | Its 8 yd jump reach round its first target while the bar runs; jagged beams leg by leg |
| Thunder's Cradle | The cradle spot while the bar runs, then the gather circle at its exact radius in the soak's gold, filling with the hold, and a crown of storm round the lifted player; the discharge's bolt and ring |
| Drawn Lightning | A red ring and a tall lightning beacon on the conductor, each strike's warning at their feet, the charged ground at its exact radius (danger) |
| The swelling storm | A ring across the whole Cornice each pulse and a lightning flicker over the floor that grows with the stacks |
| Heroic | The loose gales' footprints at their exact radius (control) under translucent funnels; the storm gusts as a blow |

Readability: the wind's direction, the gaps' lips, every footprint and every mark draw on
every tier; the low tier sheds only particles, the dome and the streaks' detail; reduced
motion drops the shakes. Everything is built in the constructors under one gated root
(`attachSceneGroupGated`, the kits' program warmers), fixed pools, no light. The fight's
cues are claimed so no generic burst doubles them (Bellows Gust stays `BreathFx`'s).

**Sound.** Sampled cues through the SFX pipeline (`heart_breath_*`, catalogued in
`docs/design/sound_effects.md`), played by `src/game/smith_heart_breath_audio.ts`: the
gather's call before each blow, the gale's loop through it and a sigh into the calm, the
indrawn breath and the storm's breaking fitted to their bars, the exhale, the tear, a
strike, the Leaping Bolt, the discharge, a loose gale's loop at the nearest, a toss, the
circle landing, the swell, a fall over the lip. The guardian's and Thessaly's lines are
boss yells (`breath_voice.ts`, `hudChrome.breathGuardian.say.*`); the guardian's voice is
a later audition.

### 5.20 The Guardian of the Quench's look (prototype)

The fight's effects are `src/render/smith_heart_fx/quench_fight_fx.ts` (pure plan
`quench_fight_fx_core.ts`), the Smith's four blades `quench_blades_fx.ts`, and its
provisional body `quench_body.ts` (pure plan `quench_body_core.ts`), hosted by
`rift_death_zone.ts` beside `QuenchFx` (which keeps Quenching Breath's and Tempering
Strike's own looks and lends them to the echoes, `echoAt`), all read from IWorld only. The
vein's art rule holds: living stone, ice and the cold, no metal, no machinery (the old
"black iron plates" are gone).

| Moment | Look |
|---|---|
| The body | An ice guardian of the lake, about three and a half players tall: frost-bound granite (the Heart kit's colossus rock repainted pale), clear lake ice on its chest, a crest of ice blades off its back and a crown on its head, pauldrons of heaved ice, forearms and shins of frozen falls, the lake's blue light in a crystal heart, threads of it between the joints, two eyes of it. Joints kept apart from the pieces so the official pipeline's model replaces the pieces only |
| Its motion | A slow breath with a plume of frost on every out-breath; a swipe on each melee hit; Tempering Strike's two-fisted slam on the ice; Quenching Breath rears back, heart blazing, then throws the cold out; at half health both arms rise to the sky through the bar and are thrown down as the blades wake; its crest burns brighter while they are awake; the death drops every piece to the ice |
| The cold | Frost crystals climbing every player's body with their bar, a rime ring under them, pulsing past three quarters (every tier); the personal cold bar over the action bar (`src/ui/hud/dungeon/quench_alert_view.ts`, never hidden by the hints setting) |
| The warmth | A warm gold glow under every huddled player, threads of warm light between them, embers rising (the one warm colour on the lake) |
| Encased in Rime | A block of clear ice round the frozen player, cracks climbing it, the shatter's splash ring at its exact radius filling to the shatter (every tier); the shatter's shards, mist and rings |
| The ice | A crack's footprint at the hole's exact radius (danger) under a web of cracks racing out with light in them; the hole: dark deep water, slush and floes, a thin lip of broken white ice; a trapped player held to the waist in churning water; the plunge's and climb's splashes |
| The blades | The kit's sunk blades; waking, they tremble, light runs up their fullers, they are wrenched up out of the ice (the lake bursting upward, their points shown) and stand upright floating, a blue light in each, their broad faces turned the way the echoes run with a chevron of light on the ice before them, blazing while an echo is held; a ring of broken ice where each was sunk; flying (heroic) they lean into the flight with a wake of frost |
| The echoes | Each footprint at the attack's exact arc and reach at its blade (danger, filling to its landing), the lee behind every blade in a sanctuary's mint while they wait; landing, the guardian's own gust or ice |
| The crossing | The lane between the two blades (danger) through its warning, the flight's wake, then the cracks along it |
| The shore ice | Slabs of jagged lake ice heaving up round the lake at the pull, standing through the fight, sinking at its end; the lake refreezing in a wave of frost at the guardian's fall |

Readability: the frost on bodies, the cold bar, every crack, hole, echo footprint, lee, lane
and the splash ring draw on every tier; the low tier sheds only particles (mist, embers,
glints, splashes); reduced motion drops the shakes. Everything is built in the
constructors under one gated root (`attachSceneGroupGated`, the kits' program warmers,
staged kit swaps through the compile gate), fixed pools, no light.

**Sound.** Sampled cues through the SFX pipeline (`heart_quench_*`, catalogued in
`docs/design/sound_effects.md`), played by `src/game/smith_heart_quench_audio.ts`: a
freeze, a shatter, a crack groaning, a hole opening, a plunge and a climb, the awakening's
charge fitted to its bar and the blades tearing free, an echo, the crossing, the shore ice
heaving, and a frosty breath in the player's own ear as their bar passes three quarters.
The guardian's lines are boss yells (`quench_voice.ts`, `hudChrome.quenchGuardian.say.*`);
its voice is a later audition.

## 6. Set pieces (phase 2 specs)

None of these is built in phase 1; their floors, props and anchors are. Every
hazard telegraphs through the shared ground-cue vocabulary (warning phase, then
hazard phase) and is deterministic (`Rng` only).

**Readability at every tier (binding).** The hazard decal, its warning phase and
any cast bar render identically at every graphics preset; presets may shed only
cosmetic richness (dust, sparks, snow, smoke, bloom). Tier knobs read the static
preset (`src/game/ui_effects_profile.ts`), never the FPS governor
(`docs/design/graphics-settings-fairness.md`). Vein dressing never out-glows a
telegraph, and a hazard colour is never the vein's ambient colour (the Buried Hoard
room rule, `docs/design/boss-rooms/README.md`).

### 6.1 Hammer: the collapsing gallery

- Where: the Gallery from h2 to h3 (`gallery_middle`, `gallery_lower`).
- Trigger: once per claim, when the raid passes h2 after pack h2 dies.
- Behaviour: rock overhangs (the fissure is open to the sky, the rims are not)
  shed falls in marching bands BEHIND the raid, pushing it forward like a short
  flight. A band telegraphs as a ground strip before it lands; a hit hurts and
  briefly slows, never kills from full health.
- Rule: rubble never blocks the path for good (the gate engine's corpse-run
  promise); it settles to the rims or clears after the chase.
- Low tier: dust and debris particles shed; the strip and its warning stay.

### 6.2 Breath: the wind bridge

- Where: `wind_bridge` (13 yd wide, +24 to +36), shelters `sh_wind_shelter` on the
  windward edge.
- Behaviour: gusts arrive in a steady rhythm across the arch. A gust pushes players
  toward the windward shelters, never off the arch; a player behind a shelter is
  not pushed. Cross between gusts. Balustrade edges plus field cliffs mean nobody
  falls on the bridge (the only falls in the raid are the Storm Cornice's four gaps,
  section 7.2). When it is built it rides the same kernel wind as the Cornice
  (`src/sim/wind_drift.ts`).
- Telegraph: a visible wind band sweeping in plus an audible bellows intake before
  each gust.
- Low tier: cloud and spray shed; the band and audio cue stay.

### 6.3 Quench: the singing ice

- Where: `singing_ice` (-24), where pack q3 is fought.
- Behaviour: the ice creaks under the raid and cracks spread visibly toward
  players standing close together. If too many stand bunched for too long, a crack
  telegraph resolves into a hole of freezing water that roots and chills for a few
  seconds. It is a hazard zone, never a drop into the void. Teaches spreading.
- Low tier: frost particles shed; the crack decal and its warning stay.

### 6.4 Heat: the pour

- Where: `POUR_CHANNEL` across the casting floor, fed by the wellspring (the layout's
  `sh_pour_crucible`, at (-150, 31)); the Heat light river crosses it at z 0.
- Behaviour: the wellspring brims and pours the first flame's fire down the channel on a
  fixed cycle. Cross between pours, and fight f2 and f3 without standing in the
  channel.
- Telegraph: the wellspring brims and glows and the channel's bed lights from its head
  down to the lip before the flow arrives.
- Low tier: sparks and heat haze shed; the channel's warning glow and the flow stay.
- Look (phase 2I, section 5.16; the mechanic is not built): the whole cycle plays on the
  shared clock (`heat_pour_core.ts`), in the vein's white-gold, never a threat colour.

## 7. Boss kits

All bosses are level 20 elite raid bosses at sketch numbers. Phase 1 ships one or
two readable mechanics each on the shared trash-kit engine (`MobTemplate.trashKit`,
`arcCleave`), enough to walk and pull every fight; none of its casts is in a kick
table. Phase 2 replaces every kit. Tuning follows classic-era raid practice: boss
health from a target fight length times measured raid DPS, damage anchored to the
tanks' mitigated intake and the healers' throughput, every number calibrated with
the meters harness, never shipped unmeasured.

### 7.1 The Hammer Council (always first)

The Quarry's first boss is three stone beings that share the Hammer's strength: the
**Guardian of the Hammer** (`heart_hammer_guardian`, id frozen: the tank boss), the
**Slabwright** (`heart_slabwright`: the pillar maker) and the **Seam Singer**
(`heart_seam_singer`: the caster), standing round the Quarry's middle among its five
columns. Designed with the owner (2026-10-25) and built as a playable prototype: every
number below is a SKETCH, unmeasured, to be calibrated with the meters harness.

| Piece | Rule | Where |
|---|---|---|
| One pull | The three are one authored pack (`SMITH_HEART_COUNCIL_PACK`): pulling one pulls all three; a member whose foe fell is put back on the fight with its siblings' hate while any of them fights | `council.ts` (`keepTogether`) |
| One wipe | The fight ends when no living member fights: every fallen member stands up whole at its place (`Entity.regrown`: no reward twice), the five columns stand whole again, the risen pillars, marks, rubble, Weight and stacks go | `council.ts` (`resetCouncil`), `council_pillars.ts` (`restorePillars`) |
| One kill | Complete only when all three are dead: the Slab (`the_slab` waits on `SMITH_HEART_COUNCIL`), the heart seal's Hammer vein (`smithHeartVeinWon`) and every credit wait on all three; the risen pillars sink back into the floor | `content/smith_heart.ts`, `seal.ts`, `council_pillars.ts` (`settlePillars`) |
| Pillars | The five carved columns (claim objects at `QUARRY_PILLAR_SPOTS`) plus the risen ones, at most 7 standing. A carved column has 2 integrity (whole, then cracked) and a risen pillar 1 (`councilPillarFull`), in its template id and stands as a round combat wall (`COMBAT_WALL_SHAPES`): it blocks bodies and the Wrath's sight line, offline and online (`net/combat_wall_wire.ts`). At 0 it falls: its wall goes that tick, rubble lies 8 s and bites 90 to 110 a second, then it is gone. The columns are the field's `encounterOwned` props: the field builds no collider for them | `council_pillars.ts` |
| Energy | 0 to 100, full in 55 s; the holder's energy bar is its resource (the target frame draws it, the snapshot carries it); after the 4th Wrath it fills 2.5 times faster (the soft enrage) | `council_wrath.ts` |
| Mountain's Wrath | At 100 (cast id kept, `heart_mountains_wrath`): a 4 s bar, then 440 to 520 to everyone in the Quarry (45 yd) the caster can see; every pillar that stood between it and at least one player loses a piece (once, however many it shielded) | `council_wrath.ts` (`landWrath`), `council_pillars.ts` (`pillarBetween`) |
| Hammer's Weight | Every 18 s (first at 10): a 1.5 s bar at the tank, then 2.2 times a swing through armor and +100 percent physical damage taken for 25 s: swap tanks | `council_wrath.ts` |
| Hammerfall | Kept: the frontal arc reads well and keeps the raid off the Guardian's side (110 degrees, 9 yd, 0.7 of a swing, every third swing) | template `arcCleave` |
| Wake the Stone | Every 30 s (first at 14): a 1.2 s bar, then 1 player (2 on heroic, never more than the cap allows) wear a circle for 5 s; a fresh pillar bursts out where each STANDS (nudged to the nearest clear spot: on the floor, 6.5 yd from another pillar, 4.5 from a council body), 120 to 150 and a throw to everyone within 3 yd | `council_stone.ts`, `council_pillars.ts` (`raisePillar`) |
| Falling Rock | Every 25 s (first at 9): a 1.2 s bar, then one player wears the soak for 5 s; 1,350 split between everyone within 6 yd (fewer than 3 under it: each takes half as much again and the whole raid takes 140 to 170, the Rockfall Tremor); every pillar within 6 yd of its face loses a piece | `council_stone.ts` |
| Seam Bolt | Every 8 s: a 2 s kickable bar at a random player in sight, 300 to 340 nature; it lands only on a player still in sight | `council_song.ts` |
| Song of the Seam | A 3 s kickable bar: sung out, Resonance on 3 players; kicked, on 1. Normal: it starts 1 s after a Wrath lands, so its Resonance (15 s) is over long before the next Wrath (at least 22 s away even in the soft enrage). Heroic: its own clock (first at 20, every 24), so the two overlap | `council_song.ts` |
| Resonance | 15 s, a ring round the player; standing within 3.5 yd of a pillar's face for 3 s in a row knocks a piece off it, then the 3 s start again; nothing cleanses it (the play: hide behind the most damaged pillar at Wrath, keep off the whole ones). Not a walk-to-cleanse mark (Ignivar's Brand of the Pyre is one) | `council_song.ts` |
| The stone remembers | When one falls, every survivor gains a stack of Memory of Stone (+15 percent damage dealt each) and takes up its job in a worse form: the Slabwright's pillars rise under RANDOM players on a locked spot with a 2 s warning (the Falling Rock stops with it); the Singer's song is sung by a survivor on 3 players and no kick stops it (the bolt stops with it); the Guardian's energy passes to a survivor (from empty) with a shorter Wrath (fills in 35 s, a 3 s bar, 380 to 450; Hammer's Weight stops with it). The heir is the first survivor in `JOB_HEIRS`; the last one carries every job | `council_scope.ts` (`jobHolder`), `council.ts` |
| Heroic | All the above, plus Resonance overlapping the Wrath, Wake the Stone marking 2, every standing pillar pulsing 60 to 75 nature on whoever stands within 3 yd of its face every 2 s (Restless Stone), and every council number 25 percent higher. The raid has no heroic tier yet (`HEROIC_DUNGEON_IDS`), so a dev run switches it on (`/dev heart council heroic`) | `council_ids.ts` (`COUNCIL_DIFFICULTY`) |
| Mythic | A prototype behind a dev switch until the game has a mythic tier: one more `COUNCIL_DIFFICULTY` row (see "Mythic" below) | `council_ids.ts`, `council_soul.ts` |

**Health (sketch, unmeasured).** Planning raid DPS about 600 (ten players at level 20;
Varkhul's measured adds DPS was a median of 696 on heroic), a 4.5 minute fight at about 85
percent uptime (the Wraths, the soaks, the moves): about 137,000 after the elite factor,
split by role: the Guardian 22,000 base (50,600), the Slabwright 19,500 (44,850), the Seam
Singer 18,000 (41,400). The old guardian's single 32,000 (73,600) was a one-mechanic
blockout's.

**Damage (sketch, unmeasured).** Anchored to the level-20 cloth reference (about 1,135 to
1,345 health, `docs/design/class-health-table-2026-09-11.md`) and the dungeon rework's
bands (a must-avoid hit 35 to 45 percent, a raid pulse 8 to 15): the Wrath about 40 percent
of a cloth pool, a full soak's share about 35 percent with 3 under it, a thin soak or a
second Weight a fumble that does not one-shot from full on normal.

Kill order is the strategy: the Guardian first leaves the energy with a survivor on a
shorter cycle; the Slabwright first trades chosen cover for random pillars on a 2 s warning;
the Singer first makes Resonance unstoppable on three. Every order runs to the finish
(pinned for all six in `tests/smith_heart_council.test.ts`); survivability on normal is to be
measured in the playtest.

Role jobs: tanks swap on Hammer's Weight and keep the three off the pillars the raid needs;
healers recover after each Wrath and each soak; damage dealers kick the Song (and the bolt),
put the Wake marks where cover is needed and gather three for the rock away from cover;
Resonance carriers wait out the Wrath by the most damaged pillar.

IP check (2026-10-25, exact phrase plus coined token on the major game wikis): Slabwright,
Seam Singer, Hammer Council, Hammer's Weight, Wake the Stone, Seam Bolt, Song of the Seam,
Memory of Stone, Rockfall Tremor, Crumbled Stone and Restless Stone returned no game use
(CLEAR); Falling Rock (already shipped by the Buried Hoards) and Resonance are generic
English.

#### Mythic: Soul in the Stone (prototype, behind a dev switch until the game has a mythic tier)

Designed with the owner (2026-10-26). The game has no mythic tier, so the council's own
difficulty gained a `'mythic'` row reached only through `/dev heart council mythic on`
(dev-gated like `heroic`; turning one on turns the other off). No global difficulty, no
instance selector, and normal and heroic resolve exactly as before (their tests are
unchanged, and `tests/smith_heart_council_mythic.test.ts` pins that neither ever holds a
soul pillar). Every number here is a SKETCH, unmeasured.

| Piece | Rule | Where |
|---|---|---|
| Heroic and more | Everything heroic has: Resonance overlapping the Wrath, Wake the Stone marking 2, the pillars' pulse, every number 25 percent higher | `COUNCIL_DIFFICULTY.mythic` |
| Stronger inheritances | The Slabwright fallen: the random pillars rise under 2 players on a 1.5 s warning (`heirRiseWarn`; the locked spot's template carries it, `councilRiseSpotTemplate`, so every client fills the warning to the moment it rises). The Singer fallen: the unbroken song rings on 4 (`heirSongMarks`). The Guardian fallen: the heir's energy fills in 30 s, its Wrath a 3 s bar (`heirFillSeconds`). The last one carries every job | `council_stone.ts`, `council_song.ts`, `council_wrath.ts` |
| The rock and Resonance never stop | With the Slabwright fallen, its first living heir keeps casting Falling Rock on its timer (`rockOutlivesSlabwright`, `rockCaster`); Resonance already outlives the Singer through the song's heir. They are the only things that break a soul pillar, so a living member always supplies both (pinned for all six kill orders) | `council_stone.ts` |
| Soul in the Stone | When a member falls, its soul flows into the most intact standing pillar (highest integrity; on a tie the nearest to the body, then the lower id; `soulHost`). With no pillar standing, a fresh one rises where the body lies to hold it. It counts toward the cap of 7 but is never refused. A second fall while one stands takes a second pillar: two soul pillars at once is the punishment | `council_soul.ts` (`takeSoul`) |
| The soul pillar | Its template id carries the soul, the pillar's kind and its 3 soul pips (`councilSoulTemplate`), so every client draws it with no wire change. Immune to every normal blow (`crackPillar` refuses it; pillars are objects, never targetable). It shields nobody from Mountain's Wrath or the Echo (its wall still stands: a player it alone hides is struck), but it keeps its collider | `council_soul.ts`, `council_wrath.ts` |
| Its pips | Only two things strike one off: a Falling Rock landing within 6 yd of its face, and a Resonance carrier standing within 3.5 yd of it for 3 s (the timer restarts; by the Singer's soul, 1.5 s) | `council_stone.ts`, `council_song.ts` (`strikeSoulPip`) |
| At 0 pips | It bursts (its soul dissipates, the usual collapse and rubble) and its behaviour stops. No reward: the survivors keep their Memory of Stone and their mythic inheritance | `council_soul.ts` |
| The end and the wipe | The last fall crumbles every soul pillar with the council (no rubble left). A wipe stands the five columns whole again (a column a soul took is a plain column again, a walked one goes back to its socket) and the risen ones go | `council_soul.ts` (`crumbleSouls`), `council_pillars.ts` (`restorePillars`) |
| Guardian's soul: Echo of Wrath | Every 20 s (first 12 s after the soul takes the stone) the pillar's own 3 s bar (`heart_echo_of_wrath`, never kicked), then 60 percent of a Wrath's roll on every player within 45 yd with no other (soulless) pillar between them and it; each pillar that shields someone loses a piece, like the Wrath. With the energy inherited too, the raid needs cover from two sources at once | `council_soul.ts` (`landEcho`) |
| Slabwright's soul: the Walking Slab | The pillar drags itself at 1.5 yd a second toward the largest group (the player with the most others within 8 yd, roster order on a tie; its group's centre), re-picked every 3 s, swerving round other pillars and the council's bodies and kept on the pit floor. Its wall moves with it (offline and online: the entity's position rides the snapshot and the combat-wall view follows it, its collider anchored on a half-yard grid in both worlds, `wallAnchor`, so the slot's collider index rebuilds a few times a second rather than every tick). Within 1.5 yd of its face: 380 to 440 and a throw, once per player every 1.5 s (Walking Slab); within 4 yd: 70 to 85 each second (Stone Drag). It shields nothing | `council_soul.ts` (`largestGroup`) |
| Singer's soul: the Endless Song | A raid-wide pulse every 3 s (first 3 s after), 45 to 55 nature, each pulse 12 percent of the first louder, capped at 4 times it (`endlessSongMult`). The pulse count is a stack of an aura on the pillar and the clock to the next pulse is the pillar's own bar (`heart_endless_song`), so clients read both | `council_soul.ts` |

The Resonance and Falling Rock tooltips (and the personal alert while a soul pillar stands)
state the mythic soul-pip rule. The Echo's cover is pillars only (the Quarry floor is open, so
no terrain hides anyone from it). Switched mid-fight (the dev lines), mythic applies whole
(`council_soul.ts` `syncSoulsToTier`): off mythic every soul leaves its pillar, which stands
plain, whole and quiet where it was; onto it every member already fallen takes its soul, in
fall order, and a soul whose pillar burst is never taken again.

The cover's fairness (polish pass): the line of sight is not widened. The Wrath's cover is the
pillar's wall (radius 2.6 for a column, 2.2 for a risen pillar) and the carved column's shaft
is only 1.5 yd round (its plinth 2.2), so a player who sees the stone between them and the
caster is always covered, with room to spare; the Echo's (`pillarBetween`) is the wall plus a
0.35 breath. The fix was the drawing: the shelter was a needle from the pillar's centre a full
pillar narrower than the real shadow, and is now the real shadow.

The Walking Slab's moving wall (polish pass): its half-yard anchor never held (its floor
height and yaw changed every tick, so the slot republished and the whole field's cell index
rebuilt every step, about 0.25 ms a tick on a ten-player claim). A walking round wall now
anchors its height and yaw too (`combat_wall_state.ts` `wallPlacement`), and a walled list
is indexed as its base's cells with only the walls filed over them
(`interior_collider_cells.ts` `noteAppendedColliders`): about 0.03 ms a tick.

Deterministic: every pick is ordered (integrity, distance, id; the group by roster order);
the only rng draws are the damage rolls, in claim-player order, and only on mythic (no
soul pillar ever stands on normal or heroic, so their draw order is untouched).

The play it asks for: kill order now also decides which soul the raid carries; the soak
and the Resonance carriers have a second duty (bring the rock and the marked to the soul
pillar, away from the cover the Wrath and the Echo need); the Echo and the inherited Wrath
want cover from two directions; the Walking Slab punishes a stacked raid; the Endless Song
is a clock that only breaking its pillar stops.

IP check (2026-10-26, exact phrase plus coined token on the major game wikis): Soul in the
Stone, Echo of Wrath, Walking Slab and Endless Song returned no game use (CLEAR; the
nearest were a Hytale "SoulStone" mod, Hearthstone's Echo keyword, Remnant 2's Ruin Slab,
Final Fantasy's Nameless Song, all different). The grind's working name "Grinding Stone"
sat too close to Guild Wars 2's "Grinding Stones" skill and shipped as Stone Drag (CLEAR).

### 7.2 Guardian of the Breath

The Storm Cornice's boss (`heart_breath_guardian`, id frozen: its death lights the Breath
vein and the seal's quarter exactly as before), one body and two halves, with Captain
Thessaly fighting beside the raid. Designed with the owner (2026-10-26) and built as a
playable Normal and Heroic prototype: every number below is a SKETCH, unmeasured, to be
calibrated with the meters harness. The code is `src/sim/encounters/smith_heart/breath*.ts`
(the leaf `breath_ids.ts`: ids, rules, tuning; the geometry `breath_geometry.ts`, pure, for
the bots to reuse later).

| Piece | Rule | Where |
|---|---|---|
| The bellows breathes | From the pull, a calm of 3 s, then the wind's telegraph (2.5 s: the coming bearing drawn across the floor, the guardian turning), a 10 s blow toward one bearing across the whole Cornice, then a calm whose last 2.5 s telegraph the next bearing. The calm (telegraph included) is 5 s at full health and shortens to 3 s at half (`calmSeconds`). The bearings turn through `BLOW_BEARINGS` (182, 22, 300, 128, 332, 75: four at a gap's throat, two at a walled stretch, each a wide turn from the last), the start hashed per pull | `breath_gale.ts` |
| The push | Every non-anchored player on the Cornice (its plateau and the climb's top inside the gate) wears the kernel's wind aura: 3.2 yd a second on normal, 3.6 on heroic (a run is 7). The shared motion kernel adds it to the step through the same gates and collision (`src/sim/wind_drift.ts`), so a player walks against it, keeps casting while it carries them (it is no input), and both hosts step the same push: the online client PREDICTS it (only a blow's first and last ticks are ever replayed) | `breath_gale.ts`, `player_motion.ts` |
| The rim | Where the wall stands, a body the wind presses against it (the floor ends within 1.3 yd downwind, no gap there) takes 90 to 110 nature every second (Pressed to the Rim). At a gap there is no wall: the body walks off the lip and falls into the void, on every difficulty; a body come to rest down there (a fall, or a throw that carried it over) is dead | `breath_gale.ts`, `breath_geometry.ts` |
| Captain Thessaly | The Highwatch captain (an NPC, `heart_captain_thessaly`, no quests) stands at the head of the Cornice climb, inside the gate (the wind never moves her). Through the Wind half only, every 20 s (first at 9) she plants a circle of calm (3.5 yd) 12 yd upwind of the guardian for the blow now blowing or the next: a 2 s telegraph where it lands, then 6 s holding. The first three players to step in are anchored for 15 s: no wind, pull, blast or throw moves them (damage still lands). Then it reads spent. She speaks at the pull, each circle (three lines in turn), the indrawn breath, the storm, a fall, the victory and a wipe | `breath_thessaly.ts`, `breath_voice.ts` |
| The indrawn breath | About every 45 s (first at 38), only between blows: a 5 s bar, planted, the guardian turned toward the raid (the tank aside). The wind turns and draws everyone toward it at 4 yd a second (the kernel's pull aura, stopping 3.5 yd short); a vortex 7 yd before its mouth (4.5 yd) bites 90 to 110 every half second. Then Bellows Gust (its old id: the old gust merged into the exhale), a 1.5 s bar, then 160 to 200 to everyone on the Cornice and an 18 yd throw outward (the anchored keep their feet; a throw through a gap is a fall). The wind then comes back from a calm | `breath_gale.ts` |
| Storm Lance | Kept, unchanged: the trash kit's own line (34 yd, 2.5 yd half width, every 11 s, 240 to 280), in both halves; the fight's bars wait for it | content `trashKit.line` |
| The storm breaks | At half health, the guardian free: a 4 s bar, planted. The wind stops at once (no blow, pull or circle; the anchors already given run out), the guardian draws it in and freezes, then tears open into its body of lightning (`heart_breath_storm_unbound` on it). For 10 s a volley of strikes every 0.8 s: one on a player where they stand, one hashed over the floor (never at a gap), each a 1.6 s warning, then 320 to 380 within 3.5 yd (Breaking Storm) | `breath_storm.ts` |
| Leaping Bolt | Phase 2, every 22 s: a 2.5 s bar at a hashed non-tank, then 240 to 280 on them, jumping to the nearest player not yet struck within 8 yd, again and again (up to nine jumps): spread | `breath_storm.ts` (`forkPath`) |
| Thunder's Cradle | Phase 2, every 40 s: a 1.5 s bar at a hashed non-tank; they are lifted 5 yd into the storm (carried, an unbreakable stun) over a 6 yd gather circle. 6 s on, the discharge: 2,600 split between everyone under it, the lifted included. Fewer than 4 under it (5 on heroic): each share 60 percent heavier and everyone on the Cornice takes 180 to 220 (Cradle Backlash): lethal for one or two. Then they are set down | `breath_storm.ts` (`cradleShare`) |
| Drawn Lightning | Phase 2, every 30 s: a 1 s bar at a hashed non-tank; for 10 s a strike falls where they stand every 2 s (a 1.2 s warning, 280 to 320 within 3 yd), each leaving charged ground (3 yd, 60 to 75 every second for 18 s): they walk the edge to keep the floor clean | `breath_storm.ts` |
| The swelling storm | After the barrage, every 5 s: 35 to 42 nature to everyone on the Cornice, each pulse 8 percent harder than the first, without end (a stack of `heart_breath_swelling_storm` on the guardian): the soft enrage | `breath_storm.ts` (`swellMult`) |
| Heroic | Every number 25 percent higher, the wind 3.6 yd a second, the Cradle wants 5, plus: Calm Spent (an anchor that ran out leaves its player unable to take another for 60 s: the raid rotates them); loose gales (three wander the Cornice on deterministic paths for 20 s after each exhale, 120 to 150 and an 11 yd toss to whoever they touch, once per player per gale in 2 s; a toss can carry a body out through a gap); storm gusts (in phase 2, every 24 s: a 2 s telegraph, then a 3.5 s gust toward a bearing, pushing like a blow, no circles). The raid has no heroic tier yet, so a dev run switches it on (`/dev heart breath heroic`) | `breath_ids.ts` (`BREATH_DIFFICULTY`) |
| Mythic | Not now: one more `BREATH_DIFFICULTY` row, today heroic's whole (the circle rule included), behind its own dev switch (`/dev heart breath mythic`); a later mythic-only mechanic is one more field there and its own module | `breath.ts` (`setBreathDevTier`) |
| One wipe | The fight ends when the guardian stops fighting: the wind still, every circle, anchor, spent mark, pin, vortex, gale, strike, patch and cradle gone, the lifted set down, the stone body back. Thessaly stays at her post; the gaps are the Cornice's, they stay | `breath.ts` (`resetBreath`) |

**Health (sketch, unmeasured).** 43,000 base (about 99,000 after the elite factor) for a
4.5 minute fight at about 85 percent uptime and the bot raid's measured 400 to 460 a
second (the council's anchor): the Wind half runs to about 2.2 minutes, the Storm after.

**Damage (sketch, unmeasured).** Anchored to the level-20 cloth reference (about 1,135 to
1,345 health) and the dungeon rework's bands: the pin about 8 percent a second (leave the
wall), the vortex about 15 percent a second (never stand before the mouth), a strike about
30 percent (a must-avoid), the Leaping Bolt about 20 percent per player it reaches, a full
Cradle share about 55 percent with four under it, the swell's first pulse about 3 percent
rising without end.

Role jobs: tanks keep the guardian in the middle and turn it from the raid for the indrawn
breath; everyone walks against the blows and keeps off the walls and away from the gaps
the wind points at; three take Thessaly's circle when the wind is strongest (on heroic in
turns); healers recover the exhale and the Cradle; in phase 2 the raid spreads for the
bolt, gathers under the lifted, spreads again, and the marked conductor leads the strikes
to the edge.

IP check (2026-10-27, exact phrase plus coined token on the major game wikis): Thunder's
Cradle, Drawn Lightning, Storm Unbound, Circle of Calm, Anchored in Calm, Calm Spent, Loose
Gale, Breath Vortex, Bellows Wind, Indrawn Breath, Pressed to the Rim, Breaking Storm and
Cradle Backlash returned no game use (CLEAR; the nearest were Pathfinder's spell "Draw the
Lightning", Skyrim's "Unbounded Storms", Guild Wars 2's "Gale Breath", all different).
Swelling Storm appears only as a fan homebrew spell on a D&D blog: generic English, kept.
The bolt's working name "Forking Bolt" sat too close to Magic: The Gathering's "Forked Bolt"
(and its Korean fill matched the shaman's Chain Lightning) and shipped as Leaping Bolt
(CLEAR; the nearest, Baldur's Gate 3's "Leaping Static", is different). The brief's own
warnings were kept: no "Eye of the Storm", "Lightning Rod", "Squall Line", "Static Shock",
"Wind Burst" or "Cyclone". Bellows Gust, Storm Lance, Charged Ground (the Buried Hoard's)
and Captain Thessaly were already shipped.

### 7.3 Guardian of the Quench

The Frozen Lake's boss (`heart_quench_guardian`, id frozen: its death lights the Quench vein
and the seal's quarter exactly as before), "together, but not for too long": warmth comes
from huddling, and huddling breaks the ice. Designed with the owner (2026-10-27) and built
as a playable Normal and Heroic prototype: every number below is a SKETCH, unmeasured, to
be calibrated with the meters harness. The code is `src/sim/encounters/smith_heart/
quench*.ts` (the leaf `quench_ids.ts`: ids, rules, tuning; the geometry
`quench_geometry.ts`, pure, for the bots to reuse later: the huddles, the holes and where a
body climbs out, the echoes' reach, the lee behind a blade, the crossing's lanes). It
avoids the other bosses' patterns: no cover (the Council), no constant movement (the
Breath), no walk to a spot to clear a debuff (Ignivar; the shelf's braziers stay scenery),
no plates broken by the boss's fire (Korzul: here the RAID breaks the ice, in round holes).

| Piece | Rule | Where |
|---|---|---|
| The shore ice | At the pull the lake's edge heaves up into a ring of jagged ice (28 slabs, 2.5 s rising, then oriented combat walls), so the whole fight stays on the lake's ice (the shelf's rock never cracks, and a raid could otherwise huddle on it for ever). A body still on the shelf when it closes is set down inside. It falls at a wipe and at the kill | `quench_rim.ts`, layout `QUENCH_RIMEWALL` |
| The cold | Every player in the basin carries a cold bar (0 to 100; an aura whose `value` is the bar and `value2` its trend). Alone it rises 100 / 30 a second (full in about 30 s); within 6 yd of 2 or more other players (a huddle, the warmth aura) it falls 6 a second instead. Frozen and trapped players give no warmth | `quench_cold.ts` |
| Encased in Rime | At full: frozen solid 4 s (an unbreakable stun; its ring shows the splash on the ice) and the bar resets. Then the ice shatters: 220 to 260 Frost to them (Shattering Cold), +25 cold to everyone within 6 yd, and Frost-Brittle (+20 percent damage taken, 15 s). A splash that fills a bar freezes that player too (a chain) | `quench_cold.ts` |
| The ice gives way | A huddle (3+ warm players together, `huddlesOf`) strains the ice where it stands; a spot loaded 8 s (its middle within 4 yd of where it began) cracks: 2.5 s of groaning ice (its footprint at the hole's exact 3.5 yd), then a round hole of freezing water. An unloaded spot heals at half a second a second, so a group that keeps moving never breaks through. The holes stay the whole fight (past 30 the oldest skins over), so the safe ice shrinks | `quench_ice.ts` |
| Under the Ice | A body whose middle goes inside a hole's rim (walking in, standing where one opens, a crossing's lane) falls in: held 4 s (an unbreakable root, re-applied if a class escape breaks it), 150 to 180 on the plunge and 100 to 120 each second, +30 cold (the bar stops one short of full in the water), then set on the rim 1 yd past it, with 1.5 s before the water can take it again. The water never kills on its own: its hits stop one point short (`survivableHit`). The guardian walks over the water (its own cold) | `quench_ice.ts` |
| Quenching Breath | Kept: 2.5 s bar every 14 s (first at 6), planted, its 22 yd 70 degree cone locked toward the tank at the start (the tank turns it from the raid), 240 to 280 Frost and +20 cold. The record is encounter-driven now (the fight starts and lands it) | `quench_attacks.ts` |
| Tempering Strike | Kept: the template's swing cleave (every 4th landed swing, 100 degrees, 8 yd); the fight watches for it to raise its echoes | content `arcCleave`, `quench_attacks.ts` |
| The blades wake | At half health, a 4 s bar (planted, arms raised): the Smith's four blades of ice sunk round the lake (claim objects, round combat walls) tear free and float upright at their places, a blue light in each; objects, never bodies, so nothing can target or harm them | `quench_blades.ts` |
| The echoes | Phase 2: every Quenching Breath and Tempering Strike is repeated by each standing blade 3 s after the guardian's own lands (2 s below a quarter health), from the blade's place and facing the way the guardian's attack faced (the tank aims them). All four footprints show the moment the guardian begins (the breath's bar, the strike's swing). Echo of the Breath 260 to 300 and +20 cold; Echo of the Strike 200 to 240 and +10 cold | `quench_blades.ts`, `quench_attacks.ts` |
| The lee | Behind each blade (the half disc on the side away from the way the attacks face, the blade's back to its own echo) within 5 yd is always safe: the cold breaks on the blade's ice, the guardian's own breath and every echo alike | `quench_geometry.ts` `inBladeLee` |
| Deepening Cold (soft enrage) | Through phase 2, every 20 s the cold rises 10 percent faster, without end (a stack on the guardian) | `quench_cold.ts` |
| Heroic | Every damage number 25 percent higher, plus: contagious cold (a shatter splashes 10 yd and adds 45 cold, so one careless player sets off a chain) and the crossing (phase 2, every 40 s, first 20 s after the wake: two blades, a hashed pair never the same twice running, swap places in a straight line (across the lake or along its side): 3 s lane telegraph, a 1.2 s flight that strikes anyone in its 2.5 yd lane for 300 to 350 and +20 cold, then the lane cracks into holes every 7 yd) | `quench_ids.ts` `QUENCH_DIFFICULTY` |
| Mythic | Not now: one more `QUENCH_DIFFICULTY` row, today heroic's whole, behind its own dev switch (`/dev heart quench mythic`). The seam for a mythic-only mechanic is the rules' `echoRule` (today `copy` on every tier; the candidate, true mirrors where two blades copy and two reverse by colour, is one more value) | `quench.ts` `setQuenchDevTier` |
| One wipe | The fight ends when the guardian stops fighting: every bar, cold mark, crack, hole, echo and lane gone, the held set out of the water, the blades sunk at home, the shore ice down | `quench.ts` (`resetQuench`) |
| Its fall | The Quench vein and the seal's quarter light as before (seal.ts reads the guardian's death); the shore ice falls and the lake refreezes whole (every hole gone), so the walk back is safe | `quench.ts` (`finishQuench`) |

**Health (sketch, unmeasured).** 43,000 base (about 99,000 after the elite factor), the
Breath's anchor: a 4 to 5 minute fight at the bot raid's measured 400 to 460 a second.

**Damage and cold (sketch, unmeasured).** Anchored to the level-20 cloth reference (about
1,135 to 1,345 health): a shatter about 20 percent (plus Frost-Brittle), the water about
55 percent over its 4 s and never lethal alone, an echo about 22 percent, the crossing
about 27 percent. The cold rewards huddling about a third of the time: an 8 s huddle buys
back about 14 s alone, so the raid huddles, moves, and huddles again.

Role jobs: the tank keeps the guardian where its breath and, in phase 2, its echoes point
away from the raid; everyone keeps their bar down by huddling in threes and fours and moves
the huddle before the ice gives; nobody stands next to a frozen player; in phase 2 the
huddles form behind the blades when an attack comes; healers cover the water and the
shatters.

IP check (2026-10-27, exact phrase plus coined token on the major game wikis): Quenching
Cold, Huddled Warmth, Shattering Cold, Frost-Brittle, Deepening Cold, Crossing Blade,
Echo of the Breath, Echo of the Strike and Encased in Rime returned no game use (CLEAR).
"Frozen Solid", the first name for the freeze, is a World of Warcraft boss mechanic (the
Frostwrought Dominator's and Melidrussa Chillworn's, the former also a "stand near two
others" rule) and was renamed Encased in Rime before shipping; "Echoed Strike" sat close to
Diablo II's "Echoing Strike" and became Echo of the Strike. Under the Ice, Freezing Water,
Groaning Ice, Open Water, Shore Ice, Smith's Blade and The Blades Wake are plain English
(generic, kept). The brief's warnings were kept: no "Frostbite", "Flash Freeze", "Biting
Cold", "Frost Beacon", "Unchained Magic", "Ice Tomb", "Icebound" or "Mirror Image".
Quenching Breath and Tempering Strike were already shipped.

### 7.4 Guardian of the Heat

The Hearth's boss (`heart_heat_guardian`, id frozen: its death lights the Heat vein and the
seal's quarter exactly as before), "the flame that grows". **A PROPOSAL, not an approved
design:** the owner went to sleep before answering the last questions on this boss and gave
free rein; it is built as a playable Normal and Heroic prototype for him to judge in game.
Every number below is a SKETCH, unmeasured, and every tunable (heat rate, pulse, crystal
count and life, the ray's reach and cool, burn stacks and decay, the channel, the embers)
lives in one table, `HEAT_TUNING` and `HEAT_DIFFICULTY` in
`src/sim/encounters/smith_heart/heat_ids.ts`, so a change is one number. The code is
`src/sim/encounters/smith_heart/heat*.ts` (the geometry `heat_geometry.ts` is pure, for the
bots to reuse: the floor, the channel and its halves, the crystal sockets, a ray's pick).

One phase, no change at half health (the Breath and the Quench already change at 50 percent).
It avoids the other fire bosses: no falling anvils, red-hot metal absorbing healing or fire
fields that grow (Varkhul), no brand cleansed in water, meteors or cone (Ignivar), no strike
split among a group (the Council's Falling Rock). The crystals are Baleroc's (Firelands) as a
concept only; the overheat is inspired by Teostra's Supernova (Monster Hunter).

| Piece | Rule | Where |
|---|---|---|
| The heat | 0 to 100 on the guardian (its resource: the target frame's bar), starting at 0 at the pull and rising 1 a second on its own. Every player on the Hearth's floor wears a quiet marker carrying it (its `value` the heat, `value2` the trend over the last second), which the heat gauge over the action bar reads | `heat_gauge.ts` |
| Hearth Pulse | Every 3 s, Fire to everyone on the floor: 12 + 1.3 per point of heat (a tenth either way), so about 15 cold, about 90 at 60, about 130 at 90: the raid's healing check, heavy when the Hearth runs hot | `heat_gauge.ts` |
| The wind-up | From 90 the guardian wears Overheating (the gauge flashes, the body burns white), with a raid warning and a line; it clears if the heat falls back under 85 | `heat_gauge.ts` |
| Hearthburst | At 100 the Hearth overheats: 900 to 1,000 Fire to everyone on the floor on Normal (a near wipe against level-20 health, worse on a burned soaker), 2,400 to 2,600 on Heroic (a wipe). Then the Hearth has vented: the heat starts again from 0 | `heat_gauge.ts`, `HEAT_DIFFICULTY` |
| Stoked Hearth (soft enrage) | Every 40 s the heat rises 20 percent faster, without end (a stack on the guardian) | `heat_gauge.ts` |
| Shed Heat | Every 30 s (first at 14) a 2.5 s bar, planted: the guardian pours its heat into the floor and the rise spots show where crystals will tear up. Two crystals on Normal (one each side of the channel), three on Heroic (the third alternating sides wave by wave), from six hashed sockets | `heat_crystals.ts`, layout `HEARTH_CRYSTAL_SOCKETS` |
| Kindled Crystals | Stand 20 s; objects, never bodies, so nothing can target or harm them. Every 2 s (first 1.5 s after rising) each fires a Kindled Ray at the NEAREST living player within 10 yd: 50 to 65 Fire, a stack of Crystal Burn, and 3 heat off the guardian. Nobody within 10 yd: the ray goes back into the guardian and adds 3 heat. So the raid keeps one soaker in every crystal's reach and rotates them as their burns stack | `heat_crystals.ts` |
| Crystal Burn | 6 percent more spell damage taken a stack (Fire, Frost, Nature, Shadow and Arcane: a `spellvuln`, and all of the fight's fire is spell damage), at most 20; one stack fades 6 s after the last change on Normal, 10 s on Heroic. A soaker who takes every ray of one crystal ends its 20 s at 10 stacks (+60 percent) | `heat_crystals.ts` |
| The channel | The wellspring's pour made part of the fight: a seam of the first flame across the Hearth's floor from its north wall to its south lip, through the hall's middle (layout `HEARTH_CHANNEL`, x = -215; the wellspring's own channel crosses the casting floor outside the Hearth, so the fight has its twin inside). Still the whole fight (a dull seam); every 26 s (first flow at 20) it brims 4 s (a raid warning), then flows 6 s: anyone within 3 yd of its line takes 90 to 110 Fire every half second. While it flows the floor is split in two, so a soaker can be cut off from their swap partner on the other side | `heat_channel.ts` |
| Molten Pour | Kept: the trash kit's line (2 s bar every 12 s, first at 5, a 30 yd lane 6 yd wide, 240 to 280 Fire; step out) | content `trashKit.line` |
| Searing Knell | Kept: the trash kit's screech (2.5 s bar every 20 s, first at 12, everyone within 10 yd stunned 2 s and struck for 140 to 170) | content `trashKit.screech` |
| Heroic | Every fight damage 25 percent higher, three crystals, burns fade every 10 s, and Searing Knell leaves Knell Embers where each player it stunned stood (2.5 yd, 25 s, 70 to 85 Fire a second to anyone in them; at most 30 at once), so the melee and the tank move the fight after every knell | `HEAT_DIFFICULTY`, `heat_knell.ts` |
| Mythic | Not now: one more `HEAT_DIFFICULTY` row, today heroic's whole, behind its own dev switch (`/dev heart heat mythic`), the seam for one later mythic-only mechanic | `heat.ts` `setHeatDevTier` |
| One wipe | The fight ends when the guardian stops fighting: every bar, rise spot, crystal, burn, ember and heat marker gone, the heat back to 0, the channel's seam gone | `heat.ts` (`resetHeat`) |
| Its fall | The Heat vein and the seal's quarter light as before (seal.ts reads the guardian's death); the Hearth settles and everything of the fight goes | `heat.ts` (`finishHeat`) |

**Health (sketch, unmeasured).** 43,000 base (about 99,000 after the elite factor), the
other guardians' anchor: a 4 to 5 minute fight at the bot raid's measured 400 to 460 a
second (it was 30,000 as a phase-1 sketch).

**The heat's arithmetic (sketch, unmeasured).** The heat rises 30 a cycle of 30 s; two
crystals soaked perfectly take off 60 (20 rays of 3), so early on a good raid keeps the
Hearth cool and the pulse light. Every missed ray costs 6 (3 not taken off, 3 added), the
stoking adds 20 percent every 40 s, and the soakers' burns cap how long one player can
stand in a ray, so the heat creeps up through the fight and Hearthburst is the hard end at
about 6 to 7 minutes for a perfect raid, much sooner for a sloppy one. Heroic's third
crystal cools faster but needs a third soaker, and the slower fading burns a real rotation.

Role jobs: the tank keeps the guardian off the channel and turns Molten Pour away; one
soaker per crystal stands within its 10 yd (nearest to it), handing the ray to a partner
around 5 stacks; everyone else stays out of every crystal's reach unless soaking; nobody
crosses the channel while it flows; healers carry the pulse, harder as the heat climbs, and
everyone saves a defensive for Hearthburst if the heat gets away.

IP check (2026-10-27, exact phrase plus coined token on the major game wikis): Kindled
Crystal, Kindled Ray, Crystal Burn, Hearth Pulse, Stoked Hearth, Flowing Fire and Knell
Embers returned no game use (CLEAR). Hearthburst (coined) returned no use; the nearest
names are Hearthstone (the game), Skyrim's Hearthfire and Hearthstone's Spellburst, none in
the same role (CLEAR, borderline noted). Shed Heat, Overheating and The Hearth's Heat are
plain English (generic, kept). The brief's warnings were kept: no "Blaze of Glory", "Shards
of Torment", "Torment", "Decimation Blade", "Supernova" or Ragnaros's coined names. Molten
Pour and Searing Knell were already shipped.

### 7.5 The Masterless Strength (final)

- Look (phase 2J, section 5.17): the mountain's heart, a great crystal with the four veins
  turning inside it, binding the room's rocks into a colossus of floating mountain over
  the Anvil of the World as the raid first arrives; the body until its own model.
- Phase 1 (`heart_masterless_strength`): Forge Fist (frontal arc cleave); Forge
  Wrath (line-of-sight nova: hide behind an altar); Forge Pour (cast-bar frontal
  cone). One form only.
- Target design:
  1. **Form choice before the pull.** The raid touches one of the four altars. That
     strength is the first the body drinks; the boss assembles in that form,
     changing its shape, colour and core abilities:
     - Breath: light and fast, floats; chained lightning and pushing gusts; demands
       spreading and constant movement.
     - Quench: ice and steel plates; stacking cold cleansed only at braziers,
       slippery floor; demands brazier coordination.
     - Heat: living embers; growing pools and split strikes; demands heavy healing.
     - Hammer: heavy and slow, hits very hard; columns that block line of sight to
       healers and boulders the raid must soak together; demands strong tanks.
  2. **Altar drags.** Tanks drag the boss onto another altar; it drinks that
     strength for 45 seconds and adds its abilities on top of its form. A drunk altar
     goes cold until every altar has been used, then all relight. The raid picks the
     order for its composition (few healers: clear the hardest strength first).
  3. **Adds at every 25 percent.** At 75, 50 and 25 percent health all four altars
     release adds at once; the raid must pick them up before they reach the healers.
  4. **Heroic.** The boss drinks two strengths at once on each drag, and chooses the
     second itself (for example Breath plus Quench: spread for the lightning, gather
     at braziers for the cold).
  5. **Why the choice matters.** The form reshapes the whole fight, so each raid
     picks for its group and can try another form each week; the form also decides
     one extra loot item (section 8).
- Altar drags are inspired conceptually by a known raid encounter; mechanics,
  names and look are our own.

## 8. Loot hook (not wired in phase 1)

Every template in `SMITH_HEART_MOBS` ships `loot: []` on purpose. Phase 2 wires:

| Boss | Drops |
|---|---|
| Guardian of the Breath | Squallcrest (storm sword) |
| Guardian of the Quench | Rimelight (frost staff) |
| Guardian of the Heat | Hearthbrand (fire sword) |
| Guardian of the Hammer | a new earth hammer (to be designed, modelled and named) |
| The Masterless Strength | Duskwick (dusk flame staff) plus one form-dependent extra |

Squallcrest, Rimelight, Hearthbrand and Duskwick live on
`feature/highwatch-adventurers-guild` (PR #4530), reserved with
`earnedFrom 'future_raid'` and listed in `RESERVED_WEAPON_SKIN_IDS`. Wiring them
here lifts that reservation in the same change. Each guardian has its own table
on both difficulties (dungeon rework README, goal 4).

## 9. Build rules

1. Every path is at least 12 yd wide (a raid of ten). Pinned: "every walkway is at
   least 12 yd wide" in `tests/smith_heart_route.test.ts`.
2. No fall deaths. Edges are balustrades or rock; field cliffs are walls; every
   push (gusts, knockbacks) ends against a wall, never off an edge.
3. One colour and one light per vein (section 1); the floor light river always leads
   to the guardian.
4. The heart seal and its lit colours are visible from every point of the Ring
   (section 3.4).
5. Every dodgeable cue is equally readable at every graphics tier (section 6).
6. No borrowed models in the final product. Every phase 1 body is a placeholder
   listed in `src/render/characters/smith_heart_placeholder_looks.ts`; that list must
   be empty before the raid ships. New creatures are original, larger than the
   player, with their own animations.
7. Carved stone in the Smith's style (the Sanctum's runes), modelled in Blender with
   one kit per vein. A common Smith style across the veins so the raid never reads
   as four dungeons stitched together.
8. Nothing solid on a walking line, a pack spot, a gate's span or an arena's middle.

## 10. Testing

- `tests/smith_heart_route.test.ts`: the route contract over the real collision seam
  (`isBlocked`): the main-map walk with every gate open (to the portal), the Heart's
  walk from its arrival (to the boss, the altars and the exit), the two areas never
  joined by floor, the Heart Bridge sealed, a fresh claim held in the Gallery, the Pit
  Mouth versus the Slab, free order of the three veins, the dais reached by either
  stair alone and by nothing else, the North Stair's short walk from the Breath's
  mouth, no step over
  `MAX_STEP_HEIGHT`, 12 yd paths and gates, every floor within interest range of a
  seal marker, the Ring pack spacing, and the guardian rooms' size.
- `tests/smith_heart_gating.test.ts`: the seal value round trip (veins and the portal
  bit), a fresh claim shut and dark, the Hammer first, the other three in any order,
  the portal only with all four lit and the Ring clear (said once, staying open), the
  hop both ways (and never for a corpse), the Heart Bridge's seal.
- `tests/smith_heart_walls.test.ts`: the drawn terrain against the walked floor on both
  areas, the Grand Stair and the North Stair alone across the chasm, both under every
  Ring eye's line to the seal.
- `tests/smith_heart_render_core.test.ts`: the mountain (clear of every floor, open air
  kept, tall crowns, the Cornice low, the Heart deepest) and no main-map eye seeing
  into the Heart; the rivers; the seal memory and fill; the portal, hop and area-blend
  timelines; the chains, keels and core; the sightlines from the Ring and the Balcony
  to the seal and the portal's eye; the props and the light budget.
- `tests/smith_heart_areas.test.ts`: the areas, the score per area, the Heart's air.
- `tests/smith_heart_rock_kit.test.ts`: the rock kit's GLB (fingerprint, budget, the
  measures the plan relies on), the bands (every area skinned, fronts behind their
  contours, out of the open air, beds never over-stretched, the coverage of the slope,
  only upper bands shed), the slope's ledge, the lips (never under a floating island,
  nothing over a walked floor) and the camera cutaway.
- `tests/smith_heart_hammer_kit.test.ts`: the Hammer kit and its plan, the Gallery's
  paving, kerb, rail and fallen blocks.
- `tests/smith_heart_ring_kit.test.ts`: the Ring kit's GLB (fingerprint, budget, the
  measures the plan relies on), the plan (the arc paved, the channels on the rivers,
  the curb broken where a river leaps, every stair railed, both stairs stepped on their
  ramp half a riser either way, the omitted tops, the props, the mouths), nothing
  render-only over a walked floor, and the seal's and the portal's moments (the
  arrival's wave, the spire igniting, the quarters parting, the shards over every head,
  the surge, the camera's jolts).
- `tests/smith_heart_breath_kit.test.ts`: the scoured floor, the Breath kit's GLB
  (fingerprint, budget, the touchable feet inside their colliders, the walls past the lip,
  the inlays flat, the arch under its deck) and its plan (every prop fitted, every Breath
  lip over the void walled and never over a walk, no mountain lip under the bridge).
- `tests/smith_heart_breath_air.test.ts` and `tests/smith_heart_breath_fx.test.ts`: the
  gusts' and strikes' schedules, the clouds past the rim, the Breath's light; the guardian's
  numbers read, the lance's bolt inside its lane, the telegraphs while the bars run.
- `tests/smith_heart_quench_kit.test.ts`: the frost-bound and lake-ice floors, the Quench
  kit's GLB (fingerprint, budget, the ice slot, the touchable feet inside their colliders, the
  bowl's fire where the plan lights it, the inlays and drifts flat, the walls past the lip, the
  heaped ice short of the shelf, the falls' heights) and its plan (every prop fitted, the
  heaped ice never over a walk, every Quench lip over the void walled, the falls on rock
  facing a Quench walk and never over a floor, the cracks on the ice, the drifts on flat
  floors).
- `tests/smith_heart_quench_air.test.ts` and `tests/smith_heart_quench_fx.test.ts`: the
  creaks' schedule and cracks on the sheet, the mist under the walks, the steam and the fire,
  the frost's reach, the Quench's light; the guardian's numbers read, the strike's ice inside
  its arc, the cone telegraphed for its bar, the frost and the ice when it lands.
- `tests/smith_heart_gate_kit.test.ts`: the gate kit's GLB (fingerprint, the threshold in
  its sill box, its crystal low and clear of the middle, the standing stone in its post box
  under three yards); `tests/smith_heart_render_core.test.ts` pins the curtain's light never
  in a sightline and each gate's vein.
- `tests/smith_heart_heart_kit.test.ts`: the Heart kit's GLB (fingerprint, budget, no chain,
  the walks flat inside their lips, the bridge's deck on the field's ramp, the altars inside
  their colliders and taller than them, the Quench's ice), its plan (every piece on the
  layout, the roots over the walk and into the crown, the omitted tops) and the crown's paint.
- `tests/smith_heart_arrival.test.ts`: the arrival bit (asleep on a fresh claim, set by the
  first living player in the Heart and kept, never by a corpse, no rng, the boss untouched,
  the dev replay, the readout).
- `tests/smith_heart_final_fx.test.ts`: the boss's numbers read, the rest spots, the arrival's
  order and timeline, the heart's rise, the arm's reach, the fist and the pour inside their
  areas, the fall, the seal memory's arrival (live and late), the room's darkness, FinalFx
  over a fake world.
- `tests/smith_heart_council.test.ts` (on `tests/helpers/council_fight.ts`): the Hammer
  Council over a real claim: one pull for all three (and nothing else), the energy bar, the
  five columns as round walls, Wake the Stone's pillar at the marked spot and its throw, the
  rise's spacing, the Wrath sparing the hidden, striking the exposed and cracking the
  shielding pillar, Resonance's 3 s cracks and restart, the fall into rubble and the wipe
  restoring the five, the soak's split and pillars, all six kill orders to the finish, the
  wipe standing a fallen member up, normal's song after the Wrath, heroic's two marks,
  pulse and own clock, a kicked song, the Slab and the seal waiting on all three, and
  determinism.
- `tests/smith_heart_council_ui.test.ts`: every raid warning's key resolving to the English
  the sim sent, the personal alert's priorities, the marks' tooltips from the live tuning,
  every cast and damage name re-localized.
- `tests/smith_heart_council_fx.test.ts` and `tests/smith_heart_council_bodies.test.ts`: the
  look's pure plans and both painters over a fake world.
- `tests/smith_heart_dev.test.ts`: the `/dev heart` family (the portal forcing and the
  hop included) and the dev-only door.
- `tests/smith_heart_breath.test.ts` (on `tests/helpers/breath_fight.ts`): the Guardian of
  the Breath over a real claim: the blow cycle and its turns, the calm shortening, the push
  and the walk against it, a gap killing (blown and walked), the wall pinning, Thessaly's
  circle (three seats, the anchor's immunity to the wind, the indrawn breath, the exhale,
  none in phase 2), the indrawn breath and Bellows Gust, the storm breaking at half health,
  the Leaping Bolt's reach, the Thunder's Cradle's split and soakers, Drawn Lightning and
  its charged ground, the swelling storm, heroic's spent anchors, loose gales and storm
  gusts, mythic as heroic, the wipe putting the Cornice back, the vein and the seal lit by
  its fall, determinism. `tests/smith_heart_breath_ui.test.ts`: every warning and line
  resolving to the English the sim sent, the tooltips, the names, the debuff bar.
  `tests/smith_heart_breath_wire.test.ts`: the whole fight's state through the real server
  snapshot into the online mirror. `tests/wind_drift.test.ts` and
  `tests/wind_drift_online.test.ts`: the kernel's wind (drift, headway, casts kept, the
  pull's stop, bit-for-bit client parity, the server's step check) and one real client
  predicting through a blow over a 120 ms link with every steady acknowledgement matched.
  `tests/smith_heart_breath_fight_fx.test.ts` and `tests/smith_heart_breath_body.test.ts`:
  the look's pure plans and both painters over a fake world.
- `tests/smith_heart_council_soul_wire.test.ts`: the Mythic soul pillars over the real
  server snapshot path into the online mirror on the browser's timer wire (the soul and
  its pips, the Walking Slab's position and collider, the Echo's and the Endless Song's
  bars, the song's pulse count, the burst).
- `scripts/heart_council_raid.mjs`: the council fought by ten bots over a live dev server
  (two tanks, two healers, six damage dealers; nine and a human with `JOIN`), playing the
  mechanics from the snapshots and writing a fight log; its positioning
  (`scripts/lib/heart_council_tactics.mjs`) is pinned to the server's geometry by
  `tests/smith_heart_council_bot_tactics.test.ts`.
- Every new Smith's Heart test follows the path pattern `tests/smith_heart_*.test.ts`
  (walls in the `gravewyrm_sanctum_walls` pattern when the phase 2 kit adds walls).
- Guard tests that must stay green: `tests/architecture.test.ts` (sim purity and
  determinism), `tests/localization_fixes.test.ts` (S3: every sim line has a client
  matcher), `tests/dungeon_gate_seal_delay.test.ts` (each sealed arena lies on its
  boss's side of the gate line).

## 11. Dev commands

`/dev heart` in `src/sim/dev/smith_heart_dev.ts`, dev-gated like `/dev sanctum`:

| Command | Does |
|---|---|
| `/dev heart` | help line |
| `/dev heart enter [normal]` | claim a fresh run and step in at the Cleft |
| `/dev heart tp <area or boss>` | jump inside the run (enters first): cleft, gallery, pit, balcony, ring, ringse, ringsw, breath, bridge, cornice, quench, ice, lake, heat, forge, anvil, heart or portal (the Seal Dais beside the portal), heartroom or final (the Heart's Arrival Terrace); a guardian's name (hammer, breathboss, quenchboss, heatboss) lands beside it |
| `/dev heart kill <what>` | kill a vein's fight (hammer: the whole Hammer Council; breath, quench, heat), the final boss (final), all four guardians (guardians), one pack (`pack h1` and so on), every pack (trash), or all; kills credit through the normal death path, so gates and seal follow on the next tick |
| `/dev heart gates` | open every gate of the run |
| `/dev heart portal` | force the seal's portal open for the run (the hop then works) |
| `/dev heart seal` | print the `smithHeartProgress` readout (and whether the heart is awake) |
| `/dev heart arrival` | replay the arrival scene: the heart sleeps a moment and wakes again with a living player in the Heart |
| `/dev heart reset` | free the run and claim a fresh one |
| `/dev heart council` | the Hammer Council's readout (difficulty, each member's health, energy, Wraths, the fallen in order) |
| `/dev heart council pull` | pull all three onto you |
| `/dev heart council reset` | the council whole again and out of its fight, the five columns with it |
| `/dev heart council heroic [on, off]` | the council's heroic rules for this run (the raid has no heroic tier yet) |
| `/dev heart council energy <n>` | set the Wrath holder's energy (95: a Wrath in about 3 s) |
| `/dev heart council <mechanic>` | force one mechanic now: wrath, weight, wake, rock, bolt, song (skips its timing guard), resonance [n] |
| `/dev heart kill guardian`, `slabwright`, `singer` | kill one council member (try each order of the inheritance); `kill council` or `kill hammer` kills all three |
| `/dev heart council mythic [on, off]` | the council's mythic prototype for this run (turning it on turns heroic off, and the other way round); mid-fight it applies whole: off, every soul leaves its pillar; on, every member already fallen takes its soul |
| `/dev heart council soul guardian`, `slabwright`, `singer` | that member's soul takes a pillar now (the most intact, as a fall would), even with the member alive |
| `/dev heart council soulpip <n>` | leave every soul pillar at n pips (0 to 3; 0 bursts them as a last pip would) |
| `/dev heart breath` | the Guardian of the Breath's readout (difficulty, health, half, the wind's phase and bearing, blows, the next indrawn breath, the swell) |
| `/dev heart breath pull` | set you down on the Storm Cornice beside the guardian and pull it |
| `/dev heart breath reset` | the guardian whole, home and out of its fight; the wind still |
| `/dev heart breath heroic [on, off]`, `mythic [on, off]` | this run's tier for the fight (mythic is heroic whole for now); a live fight takes it at once |
| `/dev heart breath phase2` | the storm breaks now (the guardian set to half health) |
| `/dev heart breath blow [deg, n, ne, e, se, s, sw, w, nw]` | a 10 s blow toward that bearing now (the four gaps sit at 22, 128, 182 and 332) |
| `/dev heart breath calm` | the wind falls calm now |
| `/dev heart breath circle` | Captain Thessaly plants a circle of calm now (refused once the storm has broken) |
| `/dev heart breath inhale` | the indrawn breath now (then Bellows Gust) |
| `/dev heart breath tornado` (`gale`) | three loose gales now, on any tier |
| `/dev heart breath gust [deg]` | a phase-2 storm gust now, on any tier |
| `/dev heart breath chain` (`fork`), `eye` (`cradle`), `conductor` (`drawn`) | the Leaping Bolt, the Thunder's Cradle or Drawn Lightning now, on a hashed player |
| `/dev heart quench` | the Guardian of the Quench's readout (difficulty, health, half, your cold, holes, cracks, the next breath, the deepening) |
| `/dev heart quench pull` | set you down on the Frozen Lake beside the guardian and pull it |
| `/dev heart quench reset` | the guardian whole, home and out of its fight; the lake whole, the blades sunk, the shore ice down |
| `/dev heart quench heroic [on, off]`, `mythic [on, off]` | this run's tier for the fight (mythic is heroic whole for now); a live fight takes it at once |
| `/dev heart quench phase2` | the guardian set to half health: its arms rise and the blades tear free (the 4 s bar) |
| `/dev heart quench blades` | the blades awake at once (no bar) |
| `/dev heart quench cold <n>` | set your cold bar |
| `/dev heart quench burst` | freeze you solid now (the shatter 4 s on) |
| `/dev heart quench hole`, `crack` | open a hole under you now, or crack the ice under you (a hole 2.5 s on) |
| `/dev heart quench breath` | Quenching Breath now (echoed by every blade once they are awake) |
| `/dev heart quench echo [strike]` | a breath (or a strike) echoed by every blade now; wakes the blades first if needed |
| `/dev heart quench dance` | two blades cross the lake now, on any tier (wakes the blades first if needed) |
| `/dev heart heat` | the Guardian of the Heat's readout (difficulty, health, heat and its trend, the stoking, crystals, the next Shed Heat, the channel's state, your burn, rays taken and sent back, overheats) |
| `/dev heart heat pull` | set you down on the Hearth's floor beside the guardian (the door's side of the channel) and pull it |
| `/dev heart heat reset` | the guardian whole, home and out of its fight; the Hearth calm (no heat, crystals, burns or embers) |
| `/dev heart heat heroic [on, off]`, `mythic [on, off]` | this run's tier for the fight (mythic is heroic whole for now); a live fight takes it at once |
| `/dev heart heat heat <n>` | set the Hearth's heat (the wind-up follows from 90) |
| `/dev heart heat crystals`, `shed` | Kindled Crystals rise now; `shed` runs Shed Heat's 2.5 s bar first |
| `/dev heart heat channel` | the channel brims now (it flows 4 s on) |
| `/dev heart heat overheat` | Hearthburst now (the heat vents to 0) |
| `/dev heart heat burn [n]` | n stacks of Crystal Burn on you (5 if none) |
| `/dev heart heat embers` | Knell Embers under you (on any tier) |

Pinned by `tests/smith_heart_dev.test.ts`, including the refusal without
`devCommands` and the door refusing a non-dev world.

## 12. Plan after phase 2A

The structure is in place; each room now gets its own phase, ONE at a time, with
captures and review before the next:

1. **The Hammer** (the Cleft, the Gallery, the Quarry): DRESSED in phase 2B (section
   5.9: the kit, the floor, the air and light, the guardian's and the Slab's effects) and
   polished in phase 2C (section 5.10).
   Its last weak points closed in phase 2D (section 5.11).
   Still to build: the collapsing gallery's mechanic (its spot is marked), the columns
   that rise and fall (they stand in their sockets), the guardian's target kit and its
   own body.
2. **The Ring and the Seal Dais**: the seal and the tines as real models; the Ring's
   pillars; the Balcony and the Grand Stair carved.
3. **The Breath**: DRESSED in phase 2G (section 5.14: the kit, the scoured floor, its
   light, sky and weather, the guardian's effects). Its guardian's two-half fight is a
   playable prototype (section 7.2, look 5.19: the wind, the gaps, Captain Thessaly, the
   storm). Still to build: the wind bridge's gust mechanic (its look is in), the fight's
   numbers measured, the raid bots' tactics for it, and the guardian's own model.
4. **The Quench**: DRESSED in phase 2H (section 5.15: the kit, the frost-bound and lake-ice
   floors, its light, sky, frost and weather, the Singing Ice's look, the guardian's effects).
   Still to build: the singing ice's mechanic (its look is in), the brazier cold-cleansing
   mechanic (the bowls are in), the guardian's target kit and its own body.
5. **The Heat**: DRESSED as the Hearth in phase 2I (section 5.16: the kit, the columnar
   basalt floors, its light, sky, basalt and weather, the pour's look, the guardian's
   effects). Still to build: the pour's mechanic (its look is in), the guardian's target
   kit and its own body.
6. **The Heart**: DRESSED in phase 2J (section 5.17: the kit, the roots in place of the
   chains, the crown, the light, the arrival scene, the colossus and its effects). Still
   to build: the final boss's form choice, altar drags and adds (the altars light and dim
   per vein already), and its own model.
7. Original creature models for every trash and boss body (the official pipeline:
   concept in three T-pose views, Tripo Smart Mesh, a skeleton built for the mesh,
   hand-solved weights, clips from scratch), emptying
   `smith_heart_placeholder_looks.ts`.
8. The quest with Captain Thessaly, finder entry, lockout, loot (section 8), and the
   IP check of every new proper noun (the raid name, every mob and boss name, the
   rooms' names), each verdict recorded here.

## 13. Shipping checklist

- [ ] Flip `SMITH_HEART_PLAYABLE` to true (`src/sim/content/smith_heart.ts`): this also builds the overworld door; check the door clearance, terrain calm anchor and parity goldens in the same change.
- [ ] Set `guideVisible` true and regenerate the wiki (`npm run wiki:content`), plus
      any `guide.*` prose keys.
- [ ] Book of Deeds records for the raid and its bosses (`src/sim/content/deeds.ts`,
      `docs/design/deeds.md`).
- [ ] Reliquary pages for its unique loot (`docs/design/reliquary.md`).
- [ ] i18n: English `t()` keys for every player string, entity names in
      `src/ui/world_entity_i18n.ts`, sim lines in `src/ui/sim_i18n.ts`, non-Latin
      fills for wordy names (M16).
- [ ] Finder entry next to the Ignivar raid family (`src/sim/content/dungeon_finder.ts`).
- [ ] Raid lockout, loot tables, committed WebP art for every new item id.
- [ ] Placeholder list empty; all names IP-checked.
- [ ] `content-obligations-reviewer` run over the content diff.

## 14. Open questions

1. Heroic at launch, or later as Ignivar did?
2. Attunement quest to enter (proposed: a short one with Thessaly at Highwatch), or
   open entry?
3. Ring width: keep 16 yd, or narrow to the pages' 14 yd once packs and pulls are
   playtested?
4. Resolved (phase 2C, owner): the dais has a second way in, the North Stair from the
   Ring's north, so a raid finishing in the north no longer walks round the Ring.
