# CC Studio update, 2026-09-15

Four changes: a rebuilt Noise brush and three terrain fixes found on the
Deepglass map.

## Noise brush (Level tool, Noise style)

Flatten/Smooth tool, tick "Smooth instead of flatten", pick **Noise**.

- Paints natural undulation across the whole brush: layered swells and dips
  with finer detail on top, fading out softly at the brush edge. The old
  brush laid one random bump per dab at the middle of the brush.
- One stroke keeps one pattern, so dragging builds continuous rolling
  ground; a new stroke layers fresh detail over it.
- New sliders: **Bump size (yards)** (3 to 48, default 6) and **Roughness**
  (how strongly the finer layers show). Brush strength sets the height, and
  bigger bumps stand taller so the ground keeps its character at any size.
- Ground a noise dab touches meshes at 0.9 yard spacing so the small bumps
  render smoothly and the drawn ground matches the collision surface. Fine
  detail shows within about 60 yards of the camera (the camera terrain LOD
  coarsens farther ground, as it does everywhere).
- Stamps save and reload with their noise (map_doc sanitizer keeps
  noiseSize, noiseSeed, noiseRough on add stamps).

Code: src/sim/terrain_noise_brush.ts (field, falloff, mesh spacing),
src/editor/stamp_core.ts noiseStamp, world.ts applyStamp.

## Fix: water follows sculpting

The water sheets baked their shore depth and dropped their dry cells once,
at load, so ground lowered under the waterline afterwards showed bare seabed
through a hole in the sea (or the dark horizon sheet underneath).

- Every stroke now refreshes the water under it when the mouse is released
  (WaterView.refreshRegion, about 30 to 65 ms on the Deepglass).
- New **Re-apply water** button (Brush section of Raise/Lower, Smooth,
  Flatten, Tunnel and Erase, and in the Water panel) rebuilds all water from
  the current terrain, for anything left over.

## Fix: terrain past the map edge

The terrain grid was the shipped world's box (x 540 either side, z from
-180) for every map, so an authored map lost any ground outside it. The
Deepglass runs to z -250 and was sculpted out to x -631, and only the water
sheet carried on past the cut.

- An authored map now builds terrain over its own area plus 240 yards of
  outskirts and anywhere it was sculpted (src/render/terrain_grid_core.ts).
- The far vista reaches 1500 yards past that and no longer hides itself
  where no near terrain exists, so the edge continues to the horizon.
- The shipped world keeps its grid and vista exactly.

## Fix: the flat square that could not be sculpted

The shipped world's level pads (Dawnhold Castle's grounds, the Last Keep
site, the Evergarden and Galecrest pads) and walkable lifts (Dawnhold's wall
walks, the Old Beacon stair) are placed at fixed world coordinates and were
applied after the sculpt layer on every map. On the Deepglass, Dawnhold's
pad pinned x 232 to 300, z 854 to 944 flat at 3.2 under any sculpting.
Authored maps now skip them (map_presentation usesOverworldTerrainPads);
full copies of the shipped world keep them. Note: sculpting that was made
while the square was stuck now applies there.

## Tests

tests/terrain_noise_brush.test.ts, tests/water_region_refresh.test.ts,
tests/terrain_grid_core.test.ts, new cases in
tests/authored_map_world_leaks.test.ts and tests/editor_stamp_core.test.ts.
