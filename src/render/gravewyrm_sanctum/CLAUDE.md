# src/render/gravewyrm_sanctum: the Gravewyrm Sanctum's open-air renderer

The render half of the Ice Tomb of the Wyrm (`docs/design/dungeon-rework/gravewyrm_sanctum.md`,
sections 2, 3, 4 and 8, and the shared `README.md` sections 10 and 11): a hidden glacier
cirque inside Thornpeak's ring of summits under a clear polar dusk and a shard-light
aurora, the route descending from the Gate Landing to the frozen lake, the Calving Face
with Korzul inside it seen from the first step. No rain, no snowstorm, never an island in
a sea: the void between the terraces is crevasse depth. The sim layout
(`src/sim/content/gravewyrm_sanctum_layout.ts`), its gates (`GRAVEWYRM_SANCTUM_GATES` in
`src/sim/content/gravewyrm_sanctum.ts`) and the story steps
(`src/sim/encounters/gravewyrm_sanctum/ids.ts`: `sanctumStoryStepOf`, `sanctumFaceStage`)
are the single source; everything here derives from them.

The kit is the Blender kit `public/models/props/gravewyrm_sanctum_kit.glb`
(`docs/design/dungeon-rework/kit/build_gravewyrm_sanctum_kit.py`, three slots: KitStone,
KitGlow, KitGlass), the cirque the heightfield `gravewyrm_sanctum_mountains.glb`, the wyrm
in the ice the frozen pose `gravewyrm_sanctum_korzul_frozen.glb` (the boss model's Frozen
pose baked static). The creatures, their effects and the telegraphs are another package's
(`../gravewyrm_sanctum_fx/`, `../characters/`).

| Module | Role |
|---|---|
| `index.ts` | Public surface: `buildGravewyrmSanctumInterior` (registered for interior `gravewyrm_sanctum` in `../open_air_fields.ts`). |
| `sanctum_interior.ts` | Composes the slot: awaits the kit, the mountains and the frozen wyrm (each capped), then the terrain, the kit dressing, the lake, the vault, the works, the steam, the gates, the lights, the face, the chains, the mountains, the sky (the frame driver) and the air. |
| `sanctum_plan_core.ts` | PURE: palette, fog colour, the cold key's and the afterglow's bearings, hash and noise, the floor, the face's look per stage (`faceStageLook`, `heartbeat`), the fire spots and styles, the light zones, the dust and steam spots. |
| `sanctum_face_core.ts` | PURE: the Calving Face's frame SHARED WITH THE KIT (`FACE_ORIGIN`, `faceToGame`, the shape functions ported from `gravewyrm_face.py`, `FACE_CHAIN_ENTRIES`, the window, the calved hole, the scar), the swap seam (`FROZEN_WYRM_URL`, `FROZEN_WYRM`: side-on facing east, head under the stage-4 hole, heart behind the shell), and every stage's curve (`plateFallPose`, `crackReveal`, `chainFall`, `chainSpray`, `calveProgress`, `collapsePose`, `chunkFlight`, `heartGlow`, `auroraLevel`, `eyeOpen`). |
| `sanctum_story_core.ts` | PURE: the story memory. `../gate_objects.ts` reports every mirrored story marker (`observeSanctumStoryMarker`); the face reads the max step of its slot and when each stage and each chain rose (`sanctumStoryView`). First sight snaps; a lower step restarts the slot (a fresh claim or a dev rewind). |
| `sanctum_face.ts` | The showpiece: the kit's face pieces under one transform (stand-in face from the same shape functions), the clear shell's shader (depth layers, frost, the cold glint, the shard's forward scatter), the face ice's material (the shard's bloom through the ice, annual bands), the frozen Korzul (absorbed into blue with depth behind the front, his head bare once calved, his emissive beating), the halo, the eye, the cracks racing from their starts (one material per crack, same program), the split's warm light, the stage-1 plate falling, the frost sprays, the calving and the collapse, the lake ripples (`triggerSanctumLakeRipple`). Exports `SANCTUM_SHARD_UNIFORMS` (the aurora's level and the beat). |
| `sanctum_chains_core.ts` / `sanctum_chains.ts` | The Smith's four great chains from the seal pillars' rings into the face (shallow catenaries far above every walk, `CHAIN_LINK_SCALE`), each tearing out and falling into the gulf as the face counts Korgath's broken chains (`CHAIN_FALL_ORDER`), and the seal pillars swapping to their cracked kit pieces with them. One InstancedMesh per slot, matrices rewritten only while a chain falls. |
| `sanctum_kit.ts` | Loads and bakes the kit by slot, the slot materials, the stand-in registry (`registerSanctumFallback`: the module that places a piece owns its stand-in), the instancer (culling cells), `sanctumKitMeshes`, `upgradeWhenSanctumKitLands`. |
| `sanctum_kit_plan_core.ts` | PURE: every `gs_*` prop fitted to its collider (`placementsForProp`), the crevasse walls and slate cliffs along every lip into the void, the drifts, the road's kerbs and moraine, the seracs and glacier walls in the gulf (never within reach of a walk, `nearWalkable`), the icefalls by the face, the vault's walls, the frozen falls, the rocks and the tunnel's flanks. |
| `sanctum_dressing.ts` | Instances the plan; the procedural stand-ins (faceted ice, cleaved rock, drifts, lofted solids; never a plain box or cylinder). |
| `sanctum_shapes.ts` | The stand-ins' shapes (`iceCrystal`, `rockLump`, `snowDrift`, `ringLoft`, `chainLinkGeometry`). |
| `sanctum_terrain.ts` | The field terrain with the `snow`, `ice` and `slate` families and the glacier-blue crevasse walls (`cliffRock: 'glacier'`, `../authored_field/`). |
| `sanctum_sky.ts` | The dome: the blue hour, stars, the afterglow behind the western peaks, the aurora's folded curtains (rose-gold roots, teal folds, violet crowns, rays straight up the sky) on `SANCTUM_SHARD_UNIFORMS`. Its `onBeforeRender` is the slot's frame driver (the face, the chains, the peaks' aurora wash). |
| `sanctum_mountains.ts` | The cirque heightfield (KTX2 albedo, object-space normals), the snout carved out where the face block stands (a discard in its shader), the Quench's albedo smoothed behind the face, the aurora's faint wash; a procedural ring as stand-in. |
| `sanctum_lake_core.ts` / `sanctum_lake.ts` | The nineteen plates as Voronoi cells of `LAKE_PLATES` (one merged matte ice mesh, plate state per plate for phase B: `setSanctumPlateState`), the pressure ridges on the seams, the apron north to the face's foot, the ripple (`triggerSanctumLakeRipple`). |
| `sanctum_vault.ts` | The vault's three meltwater pools (dark steaming water, a violet-green rim, crisp at the pool's radius: phase B's death-site rule must read). |
| `sanctum_works_core.ts` / `sanctum_works.ts` | The Thaw Works' floor marks (soot, slush, ruts) and the running melt channel. |
| `sanctum_fire_core.ts` / `sanctum_fire.ts` / `sanctum_lights.ts` | The fires (pitch orange and violet-green soulfire, one instanced draw) and their budgeted point lights through the fire-light sink (at most eight per light zone), halos and floor pools. |
| `sanctum_steam.ts` | Steam and smoke ONLY over the Thaw Works and the vault. |
| `sanctum_air.ts` | Diamond dust over the walks and spindrift off the lips (cosmetic, shed by density). |
| `sanctum_gates_core.ts` / `sanctum_gates.ts` | The gate looks on the shared gate memory: the ice walls shattering (Kit_IceWall_A..G), the chain grates rising (Kit_ChainGate), the Chain Bridge falling taut as the walkway (its deck on the sim's path height), the soulfire wards. |

Rules:
- The face stages are driven ONLY by the story markers (never a timer) and play at full
  detail on every tier (story, not a telegraph); the face stands past the lake's shelf and
  never covers an arena. Every face material is in use from the first frame (the
  interior's compile gate links it), so a stage swap links nothing.
- No light but the budgeted point lights through the fire-light sink (at most eight per
  light zone); the aurora is one shader on the dome; the key and the rim tint are the
  `gravewyrmSanctum` state of `../interior_light_rig.ts`, the fog the same state of
  `../fog_scene_state.ts`.
- Motion is shader-side on `sharedUniforms.uTime`, or one matrix write per moving mesh in
  a mesh hook (`sanctum_sky.ts: mesh`, `sanctum_gates.ts: m`, pinned in
  `tests/point_light_carriers.test.ts`).
- Floor marks on the floor ladder's ground rung (`sanctum_lights.ts`, `sanctum_vault.ts`,
  `sanctum_works.ts`, registered strict in `tests/floor_vfx_layer.test.ts`); the sky and the
  face are out of scope there.
- Custom shaders author LINEAR colours and end with `#include <colorspace_fragment>`.
- A kit that lands after the interior's cap swaps the dressing, the lake and the gates in
  place (`upgradeWhenSanctumKitLands`); every kit group carries hidden carriers of the
  three slot materials in both variants (`slotProgramWarmers`), so that swap links no
  program. The face, the frozen wyrm, the chains and the pillars do NOT upgrade late: a
  slot built before they landed keeps its stand-ins (the interior waits for them, capped
  at 8 to 9 s).
- The mountains' snout is carved round the face block on the CPU at load
  (`carveFaceBlock`), never by a fragment discard (it would cost the biggest opaque mesh
  its early depth). The sky dome draws after the opaque world (`renderOrder` 1000, depth
  on the far plane), so the aurora's march only runs on open sky.
- `SANCTUM_SHARD_UNIFORMS` and the peaks' wash are module state shared by every built
  slot. Only the slot the player stands in draws (`OpenAirFieldRoster`,
  `../open_air_field_visibility_core.ts`, pinned by
  `tests/open_air_field_visibility_core.test.ts`: the dome and the cirque reach far past
  their own instance, and left drawn they stood in the next dungeon's sky), so one driver
  runs at a time, and none while the player is elsewhere.
- Swapping the wyrm: drop a new static GLB in the same frame (+Z his front, origin under
  his body) and change `FROZEN_WYRM_URL`; `FROZEN_WYRM` places it, the head, eye and heart
  anchors (`FROZEN_*_LOCAL`) are measured off the pose.

- What is drawn solid is what blocks a body (`tests/gravewyrm_sanctum_walls.test.ts`
  sweeps the terrain's faces and the kit's real meshes against the collision seam): a
  lip module stands at the LOWER end of a sloping run and none dresses a stair's sides;
  the vault's walls leave both stairs a body's margin; the rim boulders are layout
  props with colliders (`gs_rim_rock_*`); a fitted prop reaches at most a body's width
  past its collider (the chain links and the pyres' rim stakes are render only).

Tests: `tests/gravewyrm_sanctum_walls.test.ts` (drawn walls versus the walked floor),
`tests/gravewyrm_sanctum_render_core.test.ts` (the face frame and the swap seam, the
stage curves, the story memory, the chains, the kit plan, the shard's look),
`tests/gravewyrm_sanctum_gates_render.test.ts`, `tests/gravewyrm_sanctum_lake.test.ts`,
`tests/gravewyrm_sanctum_lights.test.ts`, `tests/gravewyrm_sanctum_terrain.test.ts`, and the
kit's own `tests/gravewyrm_sanctum_kit.test.ts` / `tests/gravewyrm_sanctum_mountains.test.ts`.
Evidence: `scripts/gravewyrm_sanctum_shot.mjs` (zones, the face's stages as bursts of
frames via `/dev sanctum face <step>`, the gates opening, `SHOT_JSON` for ad-hoc tuning
shots with `hide` to isolate a piece).
