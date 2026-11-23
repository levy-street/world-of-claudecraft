# src/render/ocean/: the FFT ocean every overworld water sheet draws

`water.ts` owns the water GEOMETRY (which sheets exist, the baked shore depth,
slope and displacement gate, culling, streaming, editor refits, draw order).
This directory owns what the surface IS: the simulation, the sky it reflects,
each realm's water character, and the surface shader. `index.ts` is the barrel;
import from it.

## Pieces
- `ocean_spectrum_core.ts` (pure, tested): the cascade plan per tier
  (`oceanPlanForTier`, also the screen-space reflection step count), the
  JONSWAP plus Donelan-Banner wind sea (with a broad short-crested share) and a
  narrow swell, the seeded initial amplitudes, the slope variance a pixel
  cannot resolve (`unresolvedSlopeVariance`, the shader's roughness), and the
  Stockham FFT index arithmetic the GPU mirrors (`stockhamStage`, held to a DFT
  in `tests/ocean_spectrum_core.test.ts`). World units are about 0.7 m, and
  gravity is scaled to match.
- `ocean_fft_glsl.ts` + `ocean_simulation.ts`: the GPU simulation. One evolve
  pass, 2 log2(N) Stockham passes over an atlas holding every cascade, and one
  assemble pass per cascade into mipmapped displacement and shading textures
  (the shading targets ping-pong so whitecap foam persists and fades). All
  programs link at construction against their own target kind, like
  `water_simulation.ts`. Without a renderer, or without float render targets,
  surfaces get `calmOceanUniforms`.
- `sky_probe.ts`: a 128 px cube capture of the LIVE dome (`sky.ts`
  `liveSkyDome`), one face per frame, mips on the sixth. It draws the dome's
  own material, so it links nothing new, and the reflection carries the
  biome blend, the day/night grade, the dusk glow and the horizon fog band.
- `water_character_core.ts` (pure, tested) + `water_character_field.ts`: each
  realm's water (colour, clarity per channel, chop, foam) baked into a small
  three-layer world-space field (the `biome_haze_field` idea), so a pixel
  reads the water of the place it lies in. The palette lab's water row
  overrides the colours (`OCEAN_PALETTE_OVERRIDE`, set by `setWaterPalette`).
- `ocean_foam_core.ts` (pure, tested): the tileable procedural foam texture.
- `ocean_surface_glsl.ts` + `ocean_material.ts`: the surface. FFT normals and
  displacement (gated by the baked `aSwellGate`, scaled by fetch so ponds only
  ripple), roughness from unresolved variance, Gaussian micro-facet sun
  glitter with Smith shadowing, fresnel reflection of the probe, the water
  body, crest subsurface glow, whitecaps, surf and contact foam.

## The two arms (read before touching the shader)
- **Captured** (high tier and up): `scene_sampling.ts` copies the opaque
  colour and depth before the first transparent draw while a water sheet is
  bound as a consumer. The surface then refracts the real seabed, absorbs it
  red first over the true path, lights it with caustics, draws contact foam
  where the scene meets the surface, traces screen-space reflections
  (`ssrSteps`), and composites itself at alpha 1.
- **Blended** (medium, the default preset, and any frame whose post chain is
  shed to `ao-off`): no capture. The surface blends over the seabed. A blend
  can only dim the background grey, so it keeps the least-absorbed channel's
  share and puts the stolen colour back against an estimated sandy bottom.
- Low keeps `water.ts`'s Phong plane; nothing here runs.

## Rules
- **The colour pass never writes depth.** A floor mark a player reacts to (a
  boss telegraph, a draped ring, a decal) draws after the water and must show
  through shallow water on every tier. Depth comes from a separate depth-only
  twin per sheet (`createOceanDepthMaterial`, a CHILD of its sheet so it is
  compiled with the sheet's prepare and hides with it) drawn at
  `OCEAN_DEPTH_RENDER_ORDER`, after every transparent draw, so AO and the cel
  ink see a solid sea instead of outlining the seabed under it.
- **The apron discards inside every built, visible sheet** (its own material
  variant, `OCEAN_APRON`, fed the sheet rects by `water.ts` each frame), so the
  sea is shaded once per pixel and the sheet with the real shoreline always
  wins; the two surfaces displace from different grids and could never agree
  closely enough for a depth test to arbitrate. The apron still paints first
  (order -1), for the thin overlap strip along each sheet edge and for the
  from-below ceilings, which copy the fronts' orders.
- **Liveness gates every per-frame cost** (`water_liveness_core.ts`). Every
  water draw marks the frame; the simulation steps and the probe face run only
  while water drew in the last `WATER_WORK_HOLD_SECONDS`, the capture binding
  for the longer `WATER_CAPTURE_HOLD_SECONDS` (dropping it decides the shading
  ARM of the first returning frame), and a resume redraws the whole probe.
- **The render budget sheds it** through the post shed's rungs (`ocean_shed.ts`,
  written by `post.ts`): bloom gone halves the step rate, AO gone cuts it to a
  third and stops the opaque-scene copy (`OpaqueSceneCapture.setSuppressed`).
  Captures for review run with `?postshed=off`, or a headless session's stalls
  shed it and show the blended arm.
- **The choppy displacement moves points TOWARD the crests** (Gerstner shape;
  `OCEAN_CHOP_SIGN`, pinned by transforming the CPU mirror `oceanEvolveTexel`
  in `tests/ocean_spectrum_core.test.ts`). Flip it and crests round off while
  whitecaps and caustic focus move into the troughs.
- **One clock.** Every wave runs whole cycles per `OCEAN_LOOP_SECONDS` and
  every texture scroll whole tiles, so the wrapped water clock is seamless.
- **Every pow and smoothstep is domain-safe** (`tests/shader_pow_domain.test.ts`,
  `tests/ocean_surface_glsl.test.ts`); a NaN here poisons bloom.
- **Sampler budget:** at most 16 per stage at the richest arm (pinned in
  `tests/ocean_surface_glsl.test.ts`). A new texture has to fit.
- `?oceandebug=1` (dev builds) compiles a term switch; write
  `OCEAN_DEBUG_TERM.value` (1 to 8: fresnel, reflection, under, body, sun,
  foam, subsurface, normal) to see one shading term alone.
- Dungeon and interior water stays bespoke on purpose: floods, tides, glowing
  pools and fight floors are gameplay reads with their own skies.
