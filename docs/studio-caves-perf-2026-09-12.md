# Studio caves: performance pass 2026-09-12

SPACEY: "optimize the cave system tool, the performance is worse once you dig;
a button to bake the cave you have dug into the map so it treats it like
normal terrain; make the LOD at 100 yds super low, 20x less polys, at 500 yds
don't even render it; this performance needs to be optimized on all of the
cave tools."

## Where the time went

A carve interior is marched from its field (marching tetrahedra over 16 yd
tiles) on load, on every edit, and on every camera LOD ring change as the
maker moves. Profiling the Studio with a 100 yd trench plus a room at a
quarter yard mesh detail showed three costs per tile march: the world's
terrain height function called once per lattice column (the largest), the
voxel field sampler (a closure allocated per call), and the clustering pass
that re-ran on every LOD pass and sampled the surface paint over each
cluster's opening. Moving the camera near the dug cave took frame spikes to
44 ms; the undug map's own spikes sit at about 32 ms.

## Camera LOD rings

render/cut_cavity_mesh.ts CAVITY_LOD_RINGS. A column meshes at its requested
cell inside 40 yd; to 100 yd the cell doubles; to 250 yd it quadruples with a
2 yd floor (a 16 yd tile is at most 8x8x8 cells, about 16x fewer triangles
than a 1 yd base); to 500 yd it is x8 with a 4 yd floor (about 64x fewer);
past 500 yd a column is not meshed at all. The chain gained an 8 yd step.
Tests: tests/cut_cavity_lod.test.ts.

## Cheaper marching for every tool

- The terrain height a tile clips against comes from a 1 yd lattice with
  bilinear interpolation, anchored on tile corners so neighbours share their
  border samples. The ground mesh is linear between vertices 1.2 yd apart.
- voxelSdfAt takes a closure free fast path when the 2x2x2 block lies inside
  the grid; only the rim pays for the rock outside rule.
- Clusters survive between LOD passes; an edit (always carried by a region)
  rebuilds them.
- While a Dig, Fill or Smooth stroke is in progress, tiles under the stroke
  with cells finer than 1 yd preview at twice their cell; the stroke's end
  refreshes them at full detail.
- A Dig or Fill stroke's end refreshes the stamped area, not the whole voxel
  record's footprint (a regrown grid is rock everywhere the brush did not
  reach). A record that emptied out still refreshes its whole footprint.

## Bake caves

Caves panel, every cave mode: "Bake caves". render/cut_cavity_bake.ts keeps
a cache of every tile at every LOD ring, plus the single coarse face variants
a tile wears where a ring boundary crosses it. The mesher reads the cache
before marching, and once a map is baked every tile it marches (a cache miss
after an edit) is stored, so the cache heals itself. The cache mirrors into
MapDoc.caveBake as quantized bytes (position Int16 in 1/2048 yd relative to
the tile, normal Int8, depth tint Uint8; UVs are recomputed from position and
normal), so a reload rebuilds the meshes from bytes. An edit invalidates only
the tiles its region touches and the document copy follows on every region
rebuild and on save. Caps: 8192 tiles, 24 MB of text.

Measured (trench plus room, mesh detail 0.25, dig cell 0.5): bake 444 tiles
in 0.95 s, 3.3 MB in the document; moving camera frame spikes after the bake
21 ms at the 99th percentile against 32 ms on the undug map; a six stamp dig
stroke after the bake 150 ms and 295 of 444 baked tiles kept; after a save
and reload the bake came back from the document.

Harness: tmp/perf_cave.mjs (PORT, DIG_CELL, MESH_CELL, BAKE=1).

## Round 2, same day

SPACEY: "the fill brush: make it a square you can scale to any size, anything
in that square removes all caves in that area; performance is still pretty
bad after carving a boolean on my Deepglass map, it should not affect fps;
once you reach 500 yards make the cave an impostor, a dark texture so you
cannot see under the map; at 200 yards make the cave extremely low poly;
some parts where the gaps are not being filled and the entrance often has
messed up geo that overlaps the entrance."

### Marching off the frame

Profiling a 40 yd boolean room at 0.25 mesh detail on a copy of the shipped
Deepglass map: orbiting the camera sat at 26 ms per frame (39 fps), all of it
tile marching on the main thread as the LOD rings swept the tiles, and on
that map every terrain height call replays 3,771 sculpt edits. The march now
runs in the zone build worker pool (render/cut_cavity_tile_core.ts is the
pure core both threads share; the worker gained a "cavity" job). The LOD
tick submits missing tiles nearest first, keeps the tile that stood at a
coordinate until its replacement lands, drops a result whose key is no
longer wanted or whose field changed under it, and re-derives the tile set
only when the camera moved or a result landed. Live edits (a Dig stroke)
still march on the main thread so the wall appears on the next frame. Dug
volumes travel to each worker once per revision (VoxelVolumeMessage keyed by
a runtime vid and vrev on the record), not once per tile job: a big dig's
text is megabytes and cloning it per job cost more than the march. The bake
uses the same pool, one lane per worker.

Same scene after: 16.6 ms median and 23.5 ms at the 99th percentile while
orbiting, 60 fps; the undug map's own orbit sits at 16.8 and 73.8.

### Fill is an erase box

Fill drops a blue box ghost (the same flow as Carve): size it with the half
width, length, height and yaw sliders or the gizmo, then Erase caves (or
Enter). Every carve or hole wholly inside the box is deleted, every dug
volume has its cells inside the box put back to rock (a record that empties
out goes), and a carve the box only partly covers gets a solid box patch
over the covered part. One undo step. editor/carve_voxel_core.ts
eraseVoxelBounds and eraseVoxelBox; tests/carve_erase_box.test.ts.

### Distance

Rings are now 40, 100, 200 and 500 yd: x1, x2, x4 with a 2 yd floor, x8
with a 4 yd floor. From 200 yd a dark cap (MeshBasicMaterial, sunk 0.6 yd
under the surface over every cell of the cluster's opening) lies under the
extremely low-poly interior, and past 500 yd it is the only thing drawn, so
the hole never shows the underside of the map. Caps build lazily on the LOD
tick, one per tick, never on the edit path (a cap rebuild on every stroke
refresh was the first cut's regression: a thousand terrain height calls).

### Mouth seams

The ground chunk clips its opening on its own lattice (1.2 to 2.6 yd, and
coarser in the terrain's camera LOD rings) while the interior clips on a
1 yd lattice, so the two edges never meet exactly: a gap where the chunk's
chord sits above the surface, an overlap where it sits below. The interior
now overshoots the surface by 0.35 yd (CAVITY_CLIP_RISE) and is drawn front
face only: the overshoot shows from inside the cave and closes the gap, and
from outside its normals face the cavity so it is culled instead of standing
as a lip round the opening. Not verified against SPACEY's own caves, which
live only in his local save.
