# Studio editor fix batch - 2026-08-29 → 2026-08-31

Every fix in the `feature/studio-carve-forward-port` batch beyond the original
forward-port commit, in the order the problems were reported from live map
building. File references name the load-bearing module; most fixes also touch
`src/editor/app.ts` / `src/editor/3d/viewport.ts` wiring and tests.

## Carve / cave system

### 1. Carve meshes now match the world's density
`src/render/cut_cavity_mesh.ts`. The boolean-carve interior mesher defaulted to
0.25-0.5yd marching-tet cells while the terrain heightfield runs 1.2-2.6yd
bands, so a single bowl could out-weigh the whole visible world (330k tris
observed). The default cell is now **1.0yd** (matching the near terrain band)
and the cell ladder is the power-of-two stitch chain `{0.25, 0.5, 1.0, 2.0}` -
huge clusters coarsen to 2.0 under the extraction budget.

### 2. The Remesh tool works - it had three independent faults
- `desiredTiles` took `min(base, region)`, so a Remesh region could only ever
  REFINE; turning the cell up was a no-op. A region now **sets** the cell of
  the tiles it touches, both directions.
- `DETAIL_CELL_MAX` was 1.0 (`src/sim/map_doc.ts`) - the slider's coarse end
  equalled the old default, so "turn detail down" had no headroom. Now 2.0.
- **Loaded maps never bound `detailRegions` into the active world content**
  (the map→world binder copied holes/caves/patches but not detail regions), so
  saved Remesh regions were render-inert until the first new brush stroke.
- Off-chain region cells (old documents carry 0.4) snap to the **nearest**
  chain step by log distance, not down to the finest.

### 3. Carve rims: no skirt, just ground flowing into the interior
`src/render/terrain_cut_rim_core.ts`, `terrain_cut_clip_core.ts`,
`terrain_chunk_build.ts`. Cuts extrude a 6yd rim curtain below the surface
contour. For `carve: true` cuts the cavity mesh already IS the wall, and the
curtain hung inside the opening wearing streaked surface-projected paint. Rim
segments owned by a carve (carve-only SDF ≈ 0 at the segment midpoint) now
emit **nothing** - `depthAt` returning 0 skips the segment; legacy holes keep
their curtain.

### 4. Sky-open carves read as sunlit ground, not cave dark
`src/render/cut_cavity_core.ts`. Every cavity vertex marched the depth tint
regardless of exposure, so an open crater rendered pitch dark. Vertices now
march the carve field straight up to the original surface: all-air ⇒ the depth
tint stands almost fully down; one rock sample (a ceiling, however thin) keeps
the cave shade.

### 5. The Paint tool textures carve interiors
`src/render/cut_cavity_mesh.ts`. A cluster with no authored interior texture
adopts the Paint tool's majority texture **over its opening** (surface samples
inside the cut only - painting a village above an intact cave ceiling does not
re-floor the cave). Where the painted texture is the cluster texture, the
per-vertex paint tint stands down so the texture is not colourised by itself.

### 6. Interior texture seams (the "grid on the carve") - three fixes
- **Triplanar sampling** (`src/render/triplanar_maps.ts`): the baked
  dominant-axis planar UVs mirror and kink wherever the projection axis flips -
  a clean grid of seams around every bowl, glaring on lava. The interior
  material now re-projects albedo + emissive along all three world axes
  blended by the normal (tiling period rides a uniform; one shared program).
- **Tile-border normals**: the mesher's gradient clamped to each 16yd tile's
  own sample grid (one-sided differences at borders), so adjacent tiles lit
  their shared face differently. Gradients are central everywhere now, via
  live field samples in a one-cell halo.
- The clipped cut edge itself was already fine-contoured (round 1, below).

## Terrain

### 7. Camera-distance terrain LOD
`src/render/terrain.ts`. Chunk density was decided once at build (hub distance,
wall promotion, remesh regions) and never revisited - promoted walls and hub
rings kept 1.2yd grids at any distance. Chunks now re-mesh by camera rings:
≤60yd keeps authored density, 60-150yd re-meshes at 4.4yd, beyond at 6.5yd -
through the zone build pool, nearest-first, ±12yd hysteresis, claims already
clamped for far zones streaming in, `rebuildRegion` clamped by ring so a far
edit cannot re-fine the horizon, skirts sized for the new coarsest neighbour,
cached shadows invalidated on swaps. Without a worker pool (tests, old
WebViews) the whole system stands down to the exact pre-LOD behaviour.
Measured: a mid-size map fell from ~95k+ terrain triangles to 18-28k.

### 8. Painted-texture perimeter etching
`src/render/terrain_paint_layers.ts`. `continue` branches inside the paint
loop diverge exactly along painted-perimeter cell lines and corrupt the
mip-mapped array taps' implicit derivatives - a faint one-pixel grid etched
along every paint edge. The 2×2 loop is now **branchless**: out-of-range cells
and unpainted slots zero their WEIGHT arithmetically (uv clamped, slot index
bounded), so control flow is uniform and derivatives stay valid.
(A first cut used `textureGrad` + a dedicated emission sampler and broke the
whole splat ground on painted maps - ANGLE/Metal + sampler-budget hazard;
that design was replaced by this one. Do not re-introduce either.)

### 9. Paint stands down on steep faces
`terrain_paint_layers.ts`. Painted textures project top-down (`vWPos.xz`); on
a near-vertical face the projection degenerates into streaks - worst on cut
walls. Paint now fades out past ~55° of slope and the base splat (rock) takes
over.

## Lava glow

### 10. Emission maps + emissive rendering
- Generated `public/textures/terrain/Lava00{4,5,6}_Emission.jpg` from the
  colour maps (adaptive per image: the top ~28% of a fire index glows, with
  yellow-white cores boosted - a fixed threshold lit 85% of the mostly-molten
  Lava004). Registered via `maps.emission` in
  `src/render/terrain_texture_sets.ts` (`terrainTexturePath(key, 'emission')`).
- **Painted ground**: the emission gain rides the existing paint tile array's
  unused ALPHA channel - no extra sampler (the splat material already brushes
  the 16-unit fragment budget) and no extra tap: one texel yields albedo and
  glow (`rgb * a * gain`), added into `totalEmissiveRadiance`.
- **Carve/cave interiors**: the interior materials load the Emission map and
  only then flip `emissive` to white (×1.35) - emissive ignores the vertex
  depth tint, so molten veins burn brightest in the dark.

## Editor: NPCs and mobs move like assets

### 11. NPCs are first-class in the Select tool
No separate tool needed: pixel-precise GPU pick on the body (loose
projected-body/nameplate fallback after placements miss), press-becomes-drag
with one undo per gesture, group drags keep formation, arrow-key nudges
(0.5/2yd) coalesce into one undo per volley, selection survives the
Select/transform tools, Delete/Escape/copy-paste as before. **Every position
write goes through `viewport3d.moveMapEntity`,** which re-seats the live sim
entity's pos/prevPos/spawnPos at terrain height - previously some paths moved
only the document while the rendered NPC stood still, which read as "NPCs
cannot be moved".

### 12. `dynamic` NPCs (FURY) are movable
`dynamic: true` means "spawned on demand by its owning system", but such NPCs
(FURY the honor quartermaster, walk-in encounter NPCs) still stand in the
world at `def.pos`. The Select-mode pick requires a live rendered entity
anyway, so the `dynamic` refusals were removed from the pick/drag paths.

### 13. Mobs are first-class in Select - and the Mob tool's own drag is fixed
Same select/drag/nudge/undo contract as NPCs (camp centres move with the
runtime mobs). The deeper bug - in the Mob tool too: clicking a mob in a
multi-mob camp SPLITS the camp, and the split **respawns every authored
preview mob with fresh entity ids**, so the clicked id was dead by the time
the drag stored it: the camp moved while the rendered mob stood still. All
pick paths now re-resolve to the live entity owning the (possibly just-split)
camp via `liveMobIdNearCamp`.

## Rendering (gameplay)

### 14. Swim animation: one writer for the sheathe cache (PR #3687 port)
`src/render/renderer.ts` + `tests/weapon_stow_single_writer.test.ts`. The
render-side `v.weaponStowed` cache had two writers computing different targets
(the bare Z-key diff vs the swim overlay's union); a swimmer with a drawn
weapon made them disagree every frame, replaying the sheathe one-shot forever
and freezing the rig mid-gesture for the whole swim. The older diff is
removed; the swim overlay is the single writer, pinned by a source-scan test
(this has regressed twice through release merges).

## Round 1 (2026-08-29), also in this batch

- **Fine cut edges**: contour cells re-tessellate on a sub-grid clipped to the
  marching-squares contour (`terrain_cut_clip_core.ts`) instead of dropping
  whole quads - no more multi-yard staircases at coarse LOD.
- **Cut/Carve ghost**: placements preview as a translucent ghost with a
  pending-cut panel; commit is one undo step.
- **No floating grass over cuts**: every scatter path gates on
  `terrainCutAtHeight`, with region invalidation for grass chunks.
- **Painted textures render correctly** (24-slot cap, live field refresh,
  imported sha textures get slots).
- **Cavity texturing**: carves take a per-cut texture + tile size; biome paint
  tints interiors like cave tubes.
- **Per-tile Remesh** with watertight mixed-resolution face stitching.
- **Smooth brush** (blend-raising stroke), and sculpt Level styles
  (smooth/sharpen/noise/terrace).
- **Free-Fly wheel is a throttle** (writes the camera move speed) instead of a
  zoom that also re-geared flight.

## Also on this branch

Adjacent editor-session work present in the same tree: the four-zone camera
stream with visible perimeter, editable authored realm dressing, the editor
NPC look provider, streetlamp fixture generation, occluder fade stand-down,
and prism collision volumes with their tests.
