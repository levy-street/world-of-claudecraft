<!-- src/render/authored_map/: render-local notes only. Root, src and
     src/render CLAUDE.md already apply. -->

# src/render/authored_map/: authored-map (Studio) presentation

Everything the renderer draws or does ONLY for an authored map (the World
Editor, its playtest, and every Studio map document), extracted from
`renderer.ts`, which stays a thin consumer through the `index.ts` barrel.

**The rule this directory exists for:** the built-in world must look and
behave like the shipped release. Every Studio change to presentation is gated
at its call site on `isBuiltinWorldActive()` (src/sim/data.ts) or on the
editor camera, never left to run "harmlessly" everywhere. Each pure core's
test (`tests/authored_map_cores.test.ts`) pins the built-in arm too.

- `chase_boom_core.ts`: the boom clamps (bell glass, cave/carve rock, placed
  asset colliders), the look-up dolly and the body-aware ground clamp. The
  built-in world never calls it (release seat: requested distance,
  `groundHeight`).
- `gameplay_fog_core.ts`: the editor visibility sliders and the 1050/1200
  gameplay fog band; the built-in world asks for the shipped envelope.
- `lighting_rig.ts` (+ `lighting_rig_core.ts`): authored lighting over the boot
  rig, the pinned sun anchor, the per-frame easing.
- `layers.ts`: cave tubes, carve interiors, rails, fluid pools, decals.
- `underworld.ts` (+ `underworld_core.ts`): the black void under an authored
  map's ground.
- `zone_atmosphere.ts` (+ core), `map_weather.ts`, `editor_skybox.ts`,
  `editor_lens.ts`, `editor_birds.ts`, `shadow_cache.ts` (+ core),
  `zone_residency_core.ts`: the editor hooks' logic.
- `editor_hdr_loader.ts`: the custom skybox picker's Radiance (.hdr) decode.
  It lives here, not in `assets/loader.ts`: the shared loader keeps no .hdr
  arm (the shipped skies are KTX2, pinned by `tests/sky_ktx2_assets.test.ts`).
- `placed_frame.ts`: the per-frame placed-asset pass (the built-in world has no
  placed-asset view).

Pure `*_core.ts` files are registered in `RENDER_PURE_CORES`
(`tests/architecture.test.ts`).
