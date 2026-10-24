<!-- src/render/palette_lab/: the per-zone palette lab, a TEMPORARY dev tool for
     choosing each zone's colour look in game. Render-local rules live in
     src/render/CLAUDE.md; this file is the lab's own. -->

# src/render/palette_lab/: per-zone palette lab (`?palette=on`)

A dev tool for art direction: walk the world, click a look in the panel, and
the zone around you changes to it on the spot. Opt-in by URL (`?palette=on`,
usually beside `?cel=on`); without the flag nothing here loads and every
shader compiles byte for byte as shipped.

## What a look is
`zone_look_core.ts` `ZoneLook`: ground palette (BIOME_PALETTE's five tones),
fog and light rows (BIOME_FOG / BIOME_LIGHT / BIOME_GOD_RAYS), a sky gradient
over the HDRI, water tones, bloom, and a display grade. Curated looks are
PATCHES over the zone's stock look, authored in `zone_looks.ts` (data only).
The stock look is read off the shipped tables at import, before the lab writes
a row, and restores the release exactly.

Sky and fog colours are DISPLAY colours (what the player sees): the core models
the display pipeline (exposure, ACES, sRGB, the grade's base gain and S-curve,
the cel saturation) in `displayFromRadiance` and solves it backwards. Ground,
light and water colours are scene values, exactly as their tables take them.

## Beyond colour (`LookRender`)
Each look also carries a `render` block, and every curated look inherits one
of three families from its mood (`zone_looks.ts` `renderFamily`: daylight,
golden, moody), overridable per look:
- **Rim light** (`lab_lighting.ts`): a module-scope patch of `lights_pars_begin`
  and `lights_fragment_end`, installed from `gfx.ts` only in a lab session. One
  `Float32Array` uniform on every lit ShaderLib entry is shared BY REFERENCE
  (three's `cloneUniforms` passes typed arrays through), so a single write
  reaches every Standard, Lambert, Phong and Toon program. Gated on curvature
  per yard (the cel ink's measure) and distance, so terrain and walls never rim.
  It takes most of the surface's own colour (`RIM_ALBEDO`), or foliage frosts.
- **AO tint and strength**: the N8AO pass, registered by `post.ts`
  (`setPaletteAoPass`); the colour is mutated in place every frame.
- **Shadow strength**: the sun's `shadow.intensity`, found by a scene walk.
- **Meadow fullness** (`../meadow_fullness_core.ts`): grass coverage, blade height
  and cluster width for BOTH grass layers; stock values are the shipped formulas
  exactly (pinned by `tests/meadow_fullness_core.test.ts`). A lab session widens
  the carpet's culling bound by `MEADOW_MAX_STRETCH`.
- **Canopy lift**: leaf and bush material colours (and their far sprites) times a
  factor, from the authored colour kept per material.

## How a click reaches the screen (`palette_lab_runtime.ts`)
- Shared uniform blocks, written in place: the grade (`palette_grade.ts`, its
  `PALETTE_GRADE` arm in `post_output_grade.ts`, which also hands the look the
  base white balance in place of the stock warm GAIN), the sky
  (`palette_sky.ts`, spliced into `sky.ts`), water (`water.ts`
  `setWaterPalette`), bloom (`palette_bloom.ts`, registered by `post.ts`),
  exposure (`renderer.webgl`).
- Table rows mutated in place: the renderer reads BIOME_FOG / BIOME_LIGHT /
  BIOME_GOD_RAYS by key every frame, so it eases into a written row like a
  zone crossing. The distant-zone haze is re-baked from the same rows
  (`biome_haze_field.ts` `refreshBiomeHazeField`).
- Ground: `ground_palette_override_core.ts` holds per-zone overrides that the
  near terrain cache (main thread AND the zone build worker, which gets the
  table on every chunk job), the far vista and `groundGrassColorAt` re-read
  when its version moves. Built chunks are recoloured nearest first through
  `renderer.editor.recolorGround` (colour buffers only, no re-mesh of the live
  geometry); the blade carpet and band re-place via their `recolor()` hooks.
- The renderer is reached ONLY through `window.__game` plus public surfaces:
  `renderer.ts` and `main.ts` carry no line for the lab (both are at zero
  monolith headroom). The runtime chunk is a dynamic import in
  `palette_lab_boot.ts`, which only `post.ts` imports, so a normal session never
  fetches it and the guide and editor graphs (which reach `gfx.ts` and the flag
  leaf) never contain it; `tests/guide.test.ts` scans for exactly that.

## Rules
- Fog and light rows are per BIOME: zones that share a biome (the vale zones)
  share them, so the runtime writes the row from the zone the player
  stands in. Ground looks are per zone.
- The stock look is the A/B reference and is never edited (`tweak` refuses it).
- Panel text is dev-channel English (the perf overlay precedent); it never
  ships in a normal session.
- Console: `__paletteLab.apply(id)`, `.looks()`, `.tweak({ light: { hemiScale: 3 } })`,
  `.snippet()` (the chosen look as table rows, also behind "Copy look").

## Tests
`tests/palette_lab_zone_look_core.test.ts` (stock fidelity, patching, the display
solver, the data), `tests/ground_palette_override_core.test.ts`,
`tests/palette_lab_ground_recolor.test.ts` (an override changes chunk colours
and nothing else; clearing restores them byte for byte, on both threads),
`tests/palette_lab_grade.test.ts`, `tests/palette_lab_lighting.test.ts`,
`tests/meadow_fullness_core.test.ts`.
