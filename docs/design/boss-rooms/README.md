# Buried Hoard boss rooms

Every Buried Hoard boss fights in a room of his own. The room itself (outline,
cliffs, floor, collision) stays the seeded one the sim generates; what changes per
boss is a THEME: a palette that replaces the dig site's biome colours, a modular
Blender kit, one hero piece against the end wall, seeded clusters down the side
walls, flat floor marks, and a little ambient motion. One hoard seed gives one
room, for every player in it.

The theme is chosen by the boss who lives there (the boss spawn's template id),
never by the zone the map was dug in: the Abyssal Maw does not fight on a sunny
beach because his map was found on one.

## Where everything lives

| What | Where |
|---|---|
| The engine: theme to placements, floor marks, tiers (pure) | `src/render/hoard_room_kit_core.ts` (`buildBossRoomPlan`, `themedRoomProfile`) |
| The themes: one `BossRoomTheme` record per boss (pure data) | `src/render/hoard_room_themes_core.ts` (`BOSS_ROOM_THEMES`, `bossRoomThemeFor`) |
| The painter: instances, floor meshes, glow pulse, sway, hover, particles | `src/render/hoard_room_kit.ts` |
| Composed into the room, and the palette override applied, by | `src/render/hoard_valley.ts`, `src/render/hoard_valley_environment.ts` |
| Shared Blender modelling library | `docs/design/boss-rooms/kitlib.py` |
| One Blender source per room, with its review render | `docs/design/boss-rooms/<room>/build_<room>_kit.py` |
| Shipping build (validate, fingerprint, meshopt) | `scripts/assets/boss_rooms/build.mjs` |
| Shipped assets | `public/models/props/hoard_<room>_kit.glb` |
| Tests | `tests/hoard_room_kit.test.ts` |

The Emberforge room was the first and keeps its own source folder and builder
(`docs/design/forge-room/`, `scripts/assets/forge_room/build.mjs`); it runs on the
same engine as the rest.

## The rooms

| Boss | Theme id | Room | Hero piece |
|---|---|---|---|
| Emberforge Tyrant | `forge` | black-iron forge chamber | the Great Forge |
| Abyssal Maw | `abyss` | dark flooded sea cave | the Leviathan Grave Arch |
| Hoarfrost Warden | `frost` | frozen fortress throne hall | the Colossal Frozen Throne |
| Archon Nyxaris | `void` | broken void observatory | the Broken Armillary |
| Tempest Vharok | `storm` | storm-battered summit | the Great Lightning Spire |
| Warlord Grask | `warcamp` | fortified war camp | the Warlord Gate |
| Broodmother Vysska | `nest` | old spider brood nest | the Great Web and its old cocoon |
| Xarreth | `crypt` | ruined bone cathedral | the Ossuary Altar and rose window |

## Rules every room keeps

These are what keep a dressed room a fair fight. The tests pin the ones a
machine can check; the rest are the brief each kit is modelled to.

- **The fight's floor is the fight's.** Every prop stands within
  `ROOM_KIT_WALL_BAND` of a wall and off the boss's own ground
  (`ROOM_KIT_DAIS_CLEAR`). Nothing taller than a floor mark reaches the middle,
  and no prop collides (the walls already do).
- **Decoration never out-glows a telegraph.** A floor tone marked `lit` may only
  lie in the wall band (firelight fans excepted, which are dim and additive).
  Everything that reaches the middle is a dark or dull flat mark.
- **No floor mark speaks the boss's own language.** Nyxaris and Vharok telegraph
  in bright circles, so Vharok's floor has no rings and Nyxaris's one engraved
  circle is a breath off the stone, never lit. Xarreth's scythe sweeps arcs, so
  his floor has only straight seams and square tiles. The Maw reads in bright
  cyan, so his room's turquoise is small, dim and at the walls.
- **Nothing decorative looks like something to act on.** The Hoarfrost room has
  no thick lone pillar of ice (the Ice Age cover pillars are that). Vysska's
  cocoon and eggs are grey, old, empty, far larger or hung on walls; bright green
  is hers alone. The Maw's kelp is flat and hangs from above; a tentacle is round
  and rises from the floor. His wrecked chest is smashed open and lidless.
  Grask's camp has nothing round, grey and boulder-sized.
- **The palette override holds on every graphics tier.** Tiers shed props and
  motion, never the room's identity and never anything a player reacts to.

## Graphics tiers

One plan is built and then FILTERED, so every tier agrees on where things are.

| Tier | Keeps |
|---|---|
| high | hero, large, medium and filler props; sway and hover; particles |
| medium | hero, large and medium props; sway and hover |
| low | hero and a capped handful of large props; the floor's lines; no motion, no particles |

## Cost

A kit is one GLB of a few thousand triangles, two materials (`KitSolid`, painted;
`KitGlow`, what the runtime breathes). The painter bakes each `Kit_*` node once
and draws every copy of it as an `InstancedMesh`: at most two draws a piece, plus
a handful for floor marks, wall light and particles, whatever the room's size.
Nothing is lit, nothing casts a dynamic light, no textures ship.

## Adding or changing a room

1. Model the kit in `docs/design/boss-rooms/<room>/build_<room>_kit.py` on
   `kitlib.py` (front is -Y, up +Z, origin on the floor or at the hang point,
   colours well above the dark they grade down to). Run it with `-- --preview`
   and look at the render:
   `blender --background --python docs/design/boss-rooms/<room>/build_<room>_kit.py -- --preview`
2. Add the room's row to `KITS` in `scripts/assets/boss_rooms/build.mjs` and run
   `node scripts/assets/boss_rooms/build.mjs`.
3. Add or edit its `BossRoomTheme` in `src/render/hoard_room_themes_core.ts`.
4. `npx vitest run tests/hoard_room_kit.test.ts`, then look at it in game:
   `/dev hoard <boss>`.

All kit art is original procedural Blender work authored for this project: no
third-party mesh, texture or reference image.
