# Wildheart Basin: open-field dungeon case study

This document preserves the production process for The Wildheart Basin so a future agent can
reproduce the result without rediscovering the same architectural, asset, and visual QA
constraints. It is a companion to `docs/prd/orkadia-rework-playbook.md`. Orkadia established the
open-field interior contract. Wildheart proves that the contract can create a very different
dungeon instead of another long military camp.

## 1. Product brief

The request was to build a second open-world-feeling dungeon on one of the newer maps with a
"Savages" theme, inspired by Orkadia but visibly different. It also required five new rigged mobs,
additional elites, Heroic mode, deeds, translations, and a permanent record of the process.

The result is:

- Id: `wildheart_basin`
- Name: The Wildheart Basin
- Host map: Palmreach
- Entrance: near The Sunken Idol at `{-232, 1112}`
- Dungeon index: 7
- Interior type: `wildheart`
- Party size: 5
- Difficulties: Normal and Heroic
- Final boss: Zulgar, Voice of the Basin

"Open field" has the same meaning as in Orkadia: this is still a private party instance with an
overworld door, teleport, slots, resets, Heroic selection, rewards, and deeds. Only the interior
is an outdoor field rather than a corridor kit.

## 2. Creative direction

Wildheart is a flooded jungle caldera used by a savage troll cult. Its landmarks are:

- a monumental jaguar maw at the threshold;
- a braided stream feeding a central cenote;
- two asymmetric raised routes around the water;
- a central beast island with a rare Beastmaster encounter;
- rope crossings, canopy platforms, dens, ancestor masks, and pale ritual spires;
- vine-covered jaguar ruins in the side shelves;
- a high limestone terrace and stepped ritual pyramid for Zulgar.

The palette is emerald, jade, wet olive, dark teak, pale limestone, turquoise water, ochre woven
cloth, coral feathers, bone, and warm ritual fire.

Orkadia is axial, military, dry, blackened, and processional. Wildheart is radial, flooded,
organic, bright, and split into two routes. It deliberately avoids palisade corridors, black iron,
fel-green fire, parade-ground symmetry, and reuse of Orkadia models.

The master concept is stored at:

`docs/screenshots/wildheart/concept/wildheart-basin-keyart.jpg`

It was generated before implementation and used as a production target. The prompt specified a
bowl-shaped flooded caldera, two routes, beast island, waterfalls, rope bridges, ritual pyramid,
colossal jaguar skull, classic low-poly fantasy readability, and the exact palette above. It
explicitly excluded Orkadia's military and fel traits.

## 3. Layout and simulation contract

### 3.1 One spatial source of truth

`src/sim/wildheart_field.ts` owns all instance-local facts:

- `WILDHEART_FIELD_BOUNDS`
- `WILDHEART_FIELD_WALLS`
- `WILDHEART_FIELD_PLACEMENTS`
- `WILDHEART_FIELD_COLLIDER_SPECS`
- `wildheartFieldHeight(lx, lz)`
- `wildheartWaterMask(lx, lz)`
- `wildheartStreamCenter(lz)`

Render consumes these facts. Sim never imports from render. Any blocking prop derives its collider
from the same placement row that creates its visual.

### 3.2 Instance slot limit

Dungeon slots are 500 yards apart on Z. Local coordinates must remain within one slot, in practice
below absolute Z 250. Wildheart uses X `-82..82` and Z `-24..242`. Do not extend it past 242 without
redesigning instance-local coordinate resolution. Crossing the half-slot boundary makes height
and collision resolve against a neighboring slot.

### 3.3 Overflow instance band

The original contiguous dungeon band was full at index 6 because it meets the arena and delve
bands. Moving a published origin would invalidate saved or assumed positions. Wildheart therefore
introduced:

- `DUNGEON_OVERFLOW_INDEX = 7`
- `DUNGEON_OVERFLOW_X_BASE = INSTANCE_X_BASE + 15_000`

`instanceOrigin()` maps index 7 and later into that band. `dungeonAt()` detects it before the old
band checks. It sits 1,000 yards east of `YUMI_BAND_X_MAX` and does not overlap arena, delves,
rifts, Vale Cup, or Yumi. Existing dungeon origins remain unchanged.

### 3.4 Terrain and routes

The height function combines a flat arrival shelf, depressed stream and cenote, distinct western
and eastern route mounds, raised beast island, upper convergence shelf, 10.5 yard boss terrace,
and steep caldera shoulders.

The renderer displaces a subdivided plane with the same function and recomputes normals.
`groundHeight()` calls it inside a Wildheart instance. Feet, mobs, props, collision, and the visible
mesh therefore share one surface.

The first pull establishes the fork. Both banks contain their own Stalker, Ravager, and Hexcaller
mix. They reconnect around the central beast encounter, split briefly again, and converge at the
upper terrace. Water is visual and shallow. Bridges are readable set pieces rather than mandatory
AI funnels.

## 4. Encounter roster

All five creatures are new elite troll GLBs with distinct jobs.

### Vineclaw Stalker

- Id: `wildheart_stalker`
- Role: mobile ranged hunter
- Signature: `Razorvine Spear`
- Visual: lean blue-green troll, feather crest, reed armor, back spears

### Bloodmane Ravager

- Id: `wildheart_ravager`
- Role: melee pressure
- Signatures: `Bloodmane Rend`, `Tusk Sweep`
- Visual: broad bruiser with a large coral feather mane

### Sunbone Hexcaller

- Id: `wildheart_hexcaller`
- Role: priority caster and healer
- Signatures: `Sunvenom Hex`, `Ancestral Sap`
- Visual: turquoise caster with a tall skull and feather headdress

### Fanglord Beastmaster

- Id: `wildheart_beastmaster`
- Role: rare elite miniboss
- Signatures: `Call of the Hunt`, `Thickhide Ward`, `Beast Pit Quake`
- Flags: elite, rare, crowd-control immune
- Visual: massive dark teal troll with jaguar pelt, chains, and bone plates

Two Beastmasters appear: the central beast island and upper convergence.

### Zulgar, Voice of the Basin

- Id: `wildheart_high_priest`
- Role: final boss
- Signatures: `Wildheart Pulse`, `Jaguar Roar`, 30 percent enrage
- Flags: elite, boss, crowd-control immune
- Visual: jade high priest with jaguar mask, pale bone armor, and sun-disc mantle

The broad arena makes pulse, knockback, and enrage spatially meaningful without a corridor gimmick.

## 5. Rig and animation workflow

Every creature prompt requested one isolated full-body character, classic low-poly fantasy MMO
proportions, empty hands, strict symmetric T-pose, horizontal arms, separated legs, full feet,
neutral studio background, and no scenery, text, watermark, or held weapon. Empty hands matter:
a baked weapon often deforms during Cast, Hit, Death, and Jump.

| Creature | Job | Generate task | Rig task | Height |
| --- | --- | --- | --- | --- |
| Stalker | `creature_wildheart_stalker_mrv87b1x` | `9c309dbb-33f5-4494-8060-5b02f2c9ea8f` | `3a0c92be-adaf-4ba6-8698-a1bfa5f8d399` | 2.5 |
| Ravager | `creature_wildheart_ravager_mrv87b31` | `e02a96a3-28d3-465d-93ea-e45393eb8c38` | `123b7b8f-9b9d-4a2b-8d0e-b604bcce57a8` | 2.7 |
| Hexcaller | `creature_wildheart_hexcaller_mrv87avn` | `1ce3a5fe-a528-4d4d-a7a9-e24ab1d61fb6` | `4ab3b5d4-e36a-41ae-b873-7782ed02e301` | 2.5 |
| Beastmaster | `creature_wildheart_beastmaster_mrv8eud9` | `5801fa38-887a-407f-8470-440c35ec6dcf` | `c39e0d13-c8ff-42dc-9ddc-722203c70801` | 3.0 |
| High Priest | `creature_wildheart_high_priest_mrv8eud9` | `7925899e-20f4-4ca6-94a6-995c24023add` | `793169cd-466b-4cc5-8233-e3611ed8ed9c` | 3.2 |

Each final GLB has one 41-joint Tripo biped skin and eight clips: `Idle`, `Walk`, `Run`, `Attack`,
`Hit`, `Death`, `Cast`, and `Jump`. The shared manifest map is `TRIPO_BIPED_FULL_RIG`. Every
preview directory contains hero, directional, and per-clip frames.

The generated bipeds rest facing local +X, while characters in the game move and attack along
their local +Z axis. Without an explicit correction the animations play correctly but the mobs
appear to run sideways. Every Wildheart `VisualDef` therefore sets `yaw: -Math.PI / 2`. The
regression test pins both this yaw and the `Run` clip mapping for all five mobs. Do not accept a
rig from a static hero preview alone: inspect `front.png` and `clip_Run.png`, then aggro the real
mob in the live instance and verify that its chest, target ring, and travel direction agree.

The first Stalker retarget was launched with several other rigs. Tripo returned HTTP 429 for Hit
and Death. Assembly correctly failed instead of shipping a T-pose fallback. The safe recovery was:

```bash
node scripts/asset_pipeline/pipeline.mjs creature \
  --name wildheart_stalker --height 2.5 --rig-type biped \
  --job creature_wildheart_stalker_mrv87b1x --redo retarget
```

Run the retry alone. It preserves paid generation and rig work while clearing retarget, assemble,
and preview. The second pass produced all eight clips.

## 6. Prop kit and asset QA

Every GLB uses meshopt, rests at Y 0, and is normalized through the repository pipeline.

| Prop | Accepted job | Generate task | Height |
| --- | --- | --- | --- |
| Jaguar gate | `prop_wildheart_jaguar_gate_mrv7nkyb` | `3834d022-ce96-4c3c-b11d-95c69d4427f7` | 13 |
| Ritual pyramid | `prop_wildheart_ritual_pyramid_mrv7nkxy` | `9a507979-bd34-4875-b32a-56deb0c53198` | 19 |
| Canopy platform | `prop_wildheart_canopy_platform_mrv7nl1n` | `ff1c7bdb-f71b-4cc3-98ce-20b49e640276` | 11 |
| Rope bridge | `prop_wildheart_rope_bridge_mrv7nkzt` | `8bde7938-7b04-4cc0-bbd9-4ca435612984` | 3.2 |
| Beast den | `prop_wildheart_beast_den_mrv87axf` | `7bb5de34-36c6-43de-b15d-e02c78c8ad81` | 7 |
| Mask totem | `prop_wildheart_mask_totem_mrv87azz` | `01cc01b1-3906-4cfc-87f6-cfeac2fc5d0b` | 7 |
| Limestone spire | `prop_wildheart_limestone_cliff_mrv8m27p` | `e30af961-ced3-4a08-b6c3-6c4bc00749e9` | 14 |
| Canopy tree | `prop_wildheart_jungle_canopy_tree_mrv8wk` | `666dd621-f9f1-40f2-993d-923b22bd3875` | 12 |
| Giant fern | `prop_wildheart_giant_fern_mrv8wk9a` | `3a7033f7-46e5-435d-9213-0d1026ea03b8` | 3.5 |
| Ancestor ruin | `prop_wildheart_ancestor_ruin_mrv8wk99` | `47d44979-e818-4950-ad13-9b3ec64e39b8` | 7 |

The jaguar gate was generated facing local +X despite the normal +Z convention. Interior and
overworld builders rotate it by `-Math.PI / 2`. Collision posts remain in placement coordinates,
so the opening is traversable.

The first limestone cliff looked correct from the back but had a long triangular slab projecting
from its crown. The second became a mushroom-shaped column with a broad cap. Both were rejected:

- `prop_wildheart_limestone_cliff_mrv7nkzc`
- `prop_wildheart_limestone_cliff_mrv8g80w`

The accepted third prompt stopped asking for a cliff. It requested a tapered stack of fused round
limestone boulders and explicitly excluded shelves, slabs, overhangs, sheets, and mushroom
silhouettes. It is used sparingly as a ritual rim spire. The heightfield creates the actual wall.

General lesson: never approve an environment asset from its hero view alone. Inspect front,
right, back, left, and hero after normalization.

The first applied prop files exposed a pipeline regression: they had WebP textures but no
`EXT_meshopt_compression` or `KHR_mesh_quantization`, and occupied 121 to 201 KB. The final pass
re-encoded all ten at a 384 pixel texture ceiling with Meshopt high compression. They now occupy
52 to 85 KB and retain their normalized bounds. `normalizeProp()` was fixed so future static
props take that lane automatically. The asset regression test reads each GLB JSON chunk, requires
Meshopt, and enforces the repository's 40 to 100 KB budget. Never substitute Draco.

## 7. Render implementation and visual iteration

`src/render/wildheart_terrain.ts` builds a 184 by 280 displaced ground mesh, vertex-painted wet
soil and moss, a dark turquoise stream and cenote, subtle route wear, boss arena stones, dense
instanced jungle canopies, waterfalls with foam, and jade and gold fireflies.

`src/render/wildheart_props.ts` preloads ten GLBs, normalizes clones, consumes the sim placement
table, and provides procedural fallbacks. Warm fire is concentrated at threshold and shrine. Soft
hemisphere fill and warm sun retain readable jungle color.

The first in-game capture was rejected. It was too brown and flat, roads looked like pale ribbons,
water was cyan and planar, and horizontal cone leaves looked like arrows. The accepted direction:

- changed soil to wet olive and green;
- deepened the cenote and increased route, terrace, and rim elevation;
- reduced route overlay width and opacity;
- darkened water and added foam at falls;
- replaced cone foliage with layered rounded canopies;
- added generated trees, giant ferns, and jaguar ancestor ruins;
- reduced repeated rim spires and let the heightfield form the real caldera;
- replaced floating rectangular waterfall planes with irregular ribbons fitted to the caldera
  shoulder from the high spring to the foam pool;
- added low-cost instanced background density around the hero assets.

The renderer has a dedicated `wildheartField` ambience with sky, warm sunlight, and green distance
fog. Camera-riding celestial sprites and screen-space god rays are disabled here: against the high
rim they clipped into oversized tan wedges in SwiftShader. The basin retains directional daylight
and its sky dome without those overlays.

The Palmreach entrance uses the generated jaguar gate itself, not a recolored generic arch. The
portal membrane is turquoise and animated. A warm limestone fallback handles preload races.

## 8. Heroic, rewards, deeds, and localization

`HEROIC_DUNGEON_TUNING.wildheart_basin` pins Heroic mobs to level 22, names
`wildheart_high_priest` as final boss, and awards one Heroic Mark per eligible participant.

### 8.1 Normal retune (follow-up)

The dungeon shipped with a Heroic record but NO `NORMAL_DUNGEON_TUNING` record, so Normal mode ran
the raw base templates. Measured on the shared reference warrior (level-20 prot, 2861 armor,
Defensive Stance) its trash swung 26 to 32 and Zulgar 35, against normal Gravewyrm Sanctum's 103 to
112 and 200 to 301: roughly 3.5x under on trash and 6 to 8x under on the boss, for the same endgame
loot band. `NORMAL_DUNGEON_TUNING.wildheart_basin` ports the Sanctum calibration (doubled health,
trash floored at 100 and the boss at 200), with two roster-forced departures:

- a third band at 150 for `wildheart_beastmaster`, a rare ccImmune pack leader that spawns twice and
  out-presses trash without being a second Zulgar;
- `rangedDamageMultiplierByMob`, a new knob on `NormalDungeonTuning`. Half this roster (Stalker x6,
  Hexcaller x4) is a `petSpell` caster, and a caster stands at spell range and casts instead of
  swinging, so `damageMultiplierByMob` (which moves `dmgBase`/`dmgPerLevel`, i.e. melee) is inert
  for it. Its nuke is rolled from the base table and multiplied by `petDamageMult`, which returns a
  flat 1 for any mob with no owner, so no pre-existing knob could reach it. The new factor stamps
  `Entity.rangedDamageMult`, applied at the fire site after the rng draw. Normal only: Heroic keeps
  its shipped calibration untouched, and therefore still carries the same inert-caster gap.

Floors, literals, live-spawn wiring, and the Heroic transform are pinned by
`tests/wildheart_normal_tuning.test.ts`.

### 8.2 Premature boss pull

`DungeonDef.bossChainPull` (opt-in, live only here) makes aggroing Zulgar while any of the route is
still alive send every living mob in the instance at the puller at once. The two open routes make
running past every pack to the shrine trivial in a way a corridor dungeon prevents by geometry, so
this restores the cost of skipping trash. The mechanic is self-gating: it pulls whatever is still
alive, so a group that cleared the route finds nothing to pull and fights the boss alone. Pulled
mobs anchor their leash on the puller rather than on where they stood, because the route is about
180 yards end to end against a 70-yard dungeon leash and a self-anchored mob would evade home before
reaching the shrine. Draws no rng, so the parity goldens are unaffected. Implementation in
`src/sim/instances/boss_chain_pull.ts`, pinned by `tests/wildheart_boss_chain_pull.test.ts`.

The puller-anchored leash alone was not enough, and shipping it alone left the mechanic working only
near the shrine: a mob woken 170 yards away starts outside that same 70-yard sphere, so the leash
prelude evaded it home on its first engaged tick and thirteen of the nineteen never took a step. A
pulled mob now also carries a transit grace (`Entity.chainPullInbound`, `src/sim/mob/chain_pull_transit.ts`)
that suspends the SOFT leash while it crosses and spends itself the moment the mob reaches the
sphere, after which the ordinary leash governs from the pull point. The hard tether and the
unreachable-target stall are untouched, so a mob pinned by geometry still evades on the normal
clock. One deliberate consequence: a group that pulls and immediately runs is chased rather than
leashed, since a mob kited away from the pull point never reaches the sphere that would spend its
grace. That stays bounded by the instance, because the exit portal and a wipe both scrub the pull.

Zulgar drops three new epic weapons: Wildheart Tuskblade, Hexwood Staff of the Basin, and
Fangknife of Zulgar.

Two deeds were appended at the catalog tail:

- `dgn_wildheart_basin`
- `dgn_wildheart_basin_heroic`

No released trigger was edited. Count, category count, total Renown, tail pin, and frozen hash
were deliberately re-baselined together.

Mob, dungeon, portal, and item keys were added to English plus maintained overlays for zh_CN,
zh_TW, ru_RU, ko_KR, and ja_JP. Generated bundles must be committed with sources.

## 9. Visual QA harness

```bash
BROWSER_PATH=/path/to/chrome \
GAME_URL=http://localhost:5180 \
node scripts/wildheart_shots.mjs
```

It captures portal, overlook, waterfall route, Beastmaster, and Zulgar. It enters offline, enables
level and god commands, finds the real door, walks through it, derives the live instance origin,
and frames local landmarks. It moves non-boss enemies away for Zulgar so prior aggro cannot block
the shot. It also sets the real first-run camera preference before boot and dismisses entry
overlays before every capture. This second guard matters because the camera prompt is scheduled
after the loading fade and can otherwise appear between two screenshots.

The standalone Vite server may proxy optional project-stat and presence endpoints to a backend
that is not running. Their HTTP 502 messages do not indicate a game or dungeon error.

## 10. Verification

```bash
npx vitest run \
  tests/wildheart.test.ts \
  tests/dungeon_entry_clearance.test.ts \
  tests/render_glb_replacement_assets.test.ts \
  tests/architecture.test.ts \
  tests/dungeons.test.ts \
  tests/door_portal.test.ts \
  tests/delves.test.ts \
  tests/deeds_content.test.ts

node scripts/build_media_manifest.mjs generate
npm run wiki:content
npm run i18n:gen
npx tsc --noEmit
npm run ci:changed
npm run gate
```

Asset QA is `node scripts/asset_pipeline/pipeline.mjs qa --job <job-id>`. Every creature must
report one skin, 41 joints, eight clips, and hero plus 8/8 clip frames. Every prop must pass the
prop convention check and include directional previews.

## 11. Reusable lessons

1. Start from a route and silhouette thesis, not a prop shopping list.
2. Keep terrain, placement, and collision facts in a pure sim module.
3. Never expand beyond local Z 250 in the current slot system.
4. Preserve published origins and add an explicit overflow band.
5. Review normalized assets from every direction before applying them.
6. Keep creatures empty-handed and require all eight game clips.
7. If retarget hits 429, resume one job alone with `--redo retarget`.
8. Isolated asset previews do not prove the assembled scene works.
9. Capture the real dungeon in SwiftShader and reject flat color, ribbon roads, weak water, and
   repeated silhouettes.
10. Use generated hero assets for identity and instancing for background density.
11. Keep the field readable on low graphics, not only a high-end renderer.
12. Record rejected attempts because they carry reusable production lessons.

## 12. File map

Core: `src/sim/content/wildheart.ts`, `src/sim/wildheart_field.ts`, `src/sim/data.ts`,
`src/sim/world.ts`, `src/sim/colliders.ts`, `src/sim/content/dungeon_difficulty.ts`, and
`src/sim/content/deeds.ts`.

Render: `src/render/wildheart_terrain.ts`, `src/render/wildheart_props.ts`,
`src/render/dungeon.ts`, `src/render/renderer.ts`, `src/render/door_portal.ts`, and
`src/render/characters/manifest.ts`.

Tests and tools: `tests/wildheart.test.ts`, `tests/render_glb_replacement_assets.test.ts`,
`tests/deeds_content.test.ts`, `tests/dungeons.test.ts`, and `scripts/wildheart_shots.mjs`.

Assets: `public/models/props/wildheart_*.glb` and `public/models/creatures/wildheart_*.glb`.
All are credited in `CREDITS.md`. API keys are read only from the operator environment and never
written into the repository.
