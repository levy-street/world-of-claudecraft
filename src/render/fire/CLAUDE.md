# src/render/fire/: the 3D fluid fire subsystem

Modelled on `src/render/ocean/`. `scenery_flame.ts`, `campfire_flame.ts`, `props.ts` and
`stations.ts` own where campfires and braziers sit and how distant flames cull. This
directory owns what a nearby fire IS on shader tiers: the shared 3D GPU Navier-Stokes
and combustion simulation, each realm's fire character, liveness and budget shedding,
and the volumetric ray-marched surface shader. `index.ts` is the barrel; import from it.

## Pieces
- `fire_solver_core.ts` (pure, tested, registered in `RENDER_PURE_CORES`): the per-tier
  volume plan (`firePlanForTier`: 3D voxel grid dimensions, 2D atlas tiling, Jacobi
  pressure iterations, ray-march steps, heat-shimmer strength, step rate), the 3D-to-2D
  atlas coordinate arithmetic (`fireVoxelToAtlasTexel` / `fireAtlasTexelToVoxel`,
  mirrored in GLSL), the perceptual-LOD pixel thresholds (`shouldUseFireVolume`), and the
  deterministic draft/combustion step (`fireDraftPulse`, `fireCombustStep`).
- `fire_character_core.ts` (pure, tested, registered in `RENDER_PURE_CORES`): each
  realm's fire character (core, mid and tip blackbody colours, light smoke wisp tint and
  density, swirl, draft speed) plus the polynomial blackbody emission curve
  (`fireBlackbodyLinearRgb`).
- `fire_liveness_core.ts` (pure, tested, registered in `RENDER_PURE_CORES`): the
  per-frame liveness gate (`createFireLiveness`, `advanceFireLiveness`). Every visible
  volumetric fire draw marks the frame; the 3D fluid simulation steps and holds the
  opaque-scene capture only while a volumetric fire drew recently.
- `fire_shed.ts`: the render budget's post-shed hook (`setFireShedRung`, written by
  `post.ts`). Bloom shed halves the simulation step rate; AO shed cuts it to a third.
- `fire_simulation_glsl.ts` + `fire_simulation.ts`: the shared GPU 3D fluid solver
  (`FireSimulation`). Runs four GLSL ES 3.00 fullscreen passes over a 2D-tiled 3D voxel
  atlas (`fire:advect_combust`, `fire:divergence`, `fire:jacobi`, `fire:project`) into
  ping-ponged two-attachment MRT half-float targets (`uFireVelTemp` and
  `uFireFuelSmoke`). Links all programs and pre-steps to steady state at construction;
  falls back to `calmFireUniforms` when float render targets are unavailable.
- `fire_surface_glsl.ts` + `fire_material.ts`: the volumetric ray-marched fire hull and
  material (`createFireVolumeMaterial`, `syncFlameVolumeLod`). Traces each view ray
  through a local bounding cylinder, rotates and mirrors the sample ray by a per-fire
  world-position hash so neighbouring fires sample distinct cross-sections of the shared
  3D simulation, advects fine sub-grid cellular flame sheets along the simulated 3D
  velocity vector, shades with the blackbody ramp and Beer-Lambert light smoke wisps, and
  refracts the background above the plume for heat shimmer.

## The two arms and distance LOD
- **Captured** (high tier and up, while `OpaqueSceneCapture` is active): soft-clips ray
  exit distances against `uOpaqueDepth` so logs and stones inside the hull occlude the
  flame cleanly, and refracts `uOpaqueColor` (`sceneRefract`) along the rising thermal
  gradient for subtle heat shimmer.
- **Blended** (medium tier, and any frame whose post chain is shed to `ao-off`): no scene
  capture required. Hardware depth (`FrontSide`, `depthTest: true`, `depthWrite: false`)
  still occludes the hull behind walls, terrain and characters, and premultiplied-over
  blending composites the HDR blackbody emission and light smoke wisps directly.
- **Far band and Low tier:** `scenery_flame.ts` switches a flame to the volumetric hull
  only while its projected height on screen is at least `FIRE_VOLUME_ENTER_PIXELS` (with
  hysteresis down to `FIRE_VOLUME_EXIT_PIXELS`). Smaller distant fires and the `low`
  graphics tier keep the cheap vertex/lathe flame with zero ray-marching cost.

## Rules
- **Never write depth (`depthWrite: false`).** Floor telegraphs, decals and particles
  must never be clipped by a fire's bounding hull.
- **No GPU readback (`readPixels`).** Light flicker uses the deterministic CPU mirror in
  `fire_solver_core.ts`, never a readback from the simulation targets.
- **Every polynomial and `smoothstep` is domain-safe.** Avoid `pow()` on shader variables
  that could undershoot zero; use explicit clamped products (`t * t`) so a negative
  advection undershoot can never emit a `NaN` into bloom (`tests/shader_pow_domain.test.ts`,
  `tests/fire_surface_glsl.test.ts`).
- **Sampler budget:** keep total samplers per stage well under the WebGL2 16-sampler limit
  (pinned in `tests/fire_surface_glsl.test.ts`).
- `?firedebug=1` (dev builds) compiles a debug term switch (`FIRE_DEBUG_TERM.value` 1 to 4:
  temperature, fuel, smoke, velocity magnitude).
