# Studio update 2026-09-12b: cave tools performance, Bake caves, erase box

Full write up with measurements: docs/studio-caves-perf-2026-09-12.md.

## Performance

- Carve interiors now mesh in the terrain worker pool as the camera moves,
  so a boolean carve no longer costs frame rate. On a copy of the Deepglass
  map with a 40 yd room at 0.25 mesh detail, orbiting the camera went from
  39 fps to 60 fps.
- Dug volumes are sent to each worker once per edit, not once per tile.
- Tile marching reads the terrain height from a 1 yd lattice per tile, the
  voxel sampler no longer allocates per sample, and clusters are cached
  between camera moves.
- Dig and Smooth strokes preview at half detail under the brush while
  dragging and refresh fully on release. A stroke's end refreshes only the
  stamped area.

## Distance

- Camera rings at 40, 100, 200 and 500 yd. From 200 yd the interior is
  extremely low poly and a dark cap sits just under the opening; past
  500 yd only the cap draws, so the underside of the map never shows.

## Bake caves

- A button in every Caves mode pre builds every cave tile at every viewing
  distance and stores it in the map (MapDoc.caveBake), so camera moves and
  reloads rebuild meshes from bytes instead of the dig field. Edits drop
  only the tiles they touch; bake again when done editing.

## Fill is an erase box

- Fill places a box you can size to any width, length and height. Erase
  caves removes every carve and hole wholly inside it, refills dug rock
  inside it, and patches the covered part of any carve it only partly
  covers. One undo step.

## Mouth seams

- The cave wall overshoots the ground surface slightly and is drawn front
  face only, closing gaps between the ground's opening and the cave from
  inside while staying invisible from outside.

## Tests

tests/cut_cavity_lod.test.ts, tests/cut_cavity_bake.test.ts,
tests/carve_erase_box.test.ts.
