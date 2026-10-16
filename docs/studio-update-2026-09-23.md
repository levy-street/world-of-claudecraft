# CC Studio update, 2026-09-23

This snapshot carries two days of work: the 2026-09-22 local snapshot (never
pushed on its own) and today's fixes. The headline: the terrain no longer loses
its textures after you walk for a while, and the Deepglass ring city has new
baked stone stairs.

## Fix: terrain textures vanish after 10 to 20 seconds of walking

Listed as known broken in the 2026-09-22 snapshot. In game and in playtest (not
in the Studio) the ground went bare after walking for a while, with a frame
skip, leaving the player looking like they float.

- Cause: the terrain shader needed 17 texture units once the sky lighting (the
  image based lighting map) arrived, and WebGL on Apple Silicon allows 16. The
  shader silently failed to link and the terrain drew with nothing on it. The
  Studio never loaded that lighting map, which is why it looked fine there.
- Fix: the four terrain detail normal maps now travel as one texture array, so
  the richest terrain shader uses at most 14 units.
- tests/terrain_sampler_budget.test.ts counts the samplers of the richest
  variant and fails on the old code.

Code: src/render/terrain.ts (buildSplatNormalArray, SPLAT_NORMAL_GLSL).

## Fix: lighting changes after load, frame spikes

- The sky lighting is bound from the first frame, so the terrain shader is
  built once instead of rebuilding when the lighting map arrives (that rebuild
  was the frame skip).
- On authored maps the lighting follows the map's own zone biome under the
  camera, not the shipped world's geography, so it stays the same while you
  move around the Deepglass.

Code: src/render/renderer.ts (seed biome, updateEnvBiome), src/render/sky.ts.

## Studio: texture slot tally and warning

The Paint panel shows **Texture slots: 15 / 24 used · 9 free** under the texture
picker. It turns amber with 3 or fewer free and red past the limit, with a
warning that the most recently added textures paint as flat colour until a
texture swatch is removed. Snow and colour only swatches take no slot.

Code: paintTextureSlotUsage in src/render/terrain_paint_layers.ts,
src/editor/inspector.ts. Tests: tests/paint_texture_slot_usage.test.ts.

## Deepglass: new stone stairs

The nine ring city staircases are now baked Blender models: rows of bevelled
stone blocks on every step, staggered from step to step, with flagstone side
rails, end posts and a landing at the top and bottom. Ambient occlusion and
soft lighting are baked into the textures.

- Three models: 38 steps, 43 steps, and the arena gate flight (16 deep treads,
  narrow rails). About 1,650 triangles and about 6 MB of video memory each.
- Rails are 5.6 yards wide (the arena flight keeps 0.7 yard rails because the
  gate pillars stand beside it). Rails and landings have collision, checked in
  game from the stair lane and from outside the rails.
- The stone is matched in hue to the paving at the foot of the stairs.
- Rebuild or tweak: see "Ring-city stair flights" in
  scripts/assets/deepglass/README.md (dg_stair_flights.py, stair_trim.mjs).

## Deepglass: zone music

The Deepglass zone now plays **Tidesong: Outside the Bell** (zoneTrack
tidehold).

## Painted clutter at Medium graphics

Painted ground dressing (Paint Clutter) used to draw at High and up only, and
every Apple Silicon Mac defaults to Medium, so the dressing vanished in game
while the Studio (which forces it on) still showed it. Medium now draws it in
a 30 yard ring; Low and the iOS memory profile still skip it.

Code: src/render/gfx.ts (cityClutter, cityClutterRadius), with matching gfx
override keys.

## Also in this snapshot (2026-09-22)

- Deepglass arena laid into the map as the 11 piece placeable kit, baked in
  the city's GreyStone ashlar.
- Kit detail textures for the Tidehold medieval buildings (the kit atlas is a
  palette, so its surfaces now get tiling detail with the original colour
  kept), and Tavern B's end awnings rebuilt.
- Rock054 colour map cleaned of violet crystal blobs.
- Grass ground bake ownership fix (the white ground after a renderer restart).
- Painted ground relief and paint edge softness and detail sliders.

## Known reds on this tree

Typecheck errors in the battleground editor and some older tests, and failing
tests that fail the same way without these changes (terrain chunk and height
parity, terrain relief, terrain streaming margins, the shader relief guards,
sky KTX2 masters, GLB texture compression on older models, the graphics
profile owner list, i18n completeness for the English only editor).
