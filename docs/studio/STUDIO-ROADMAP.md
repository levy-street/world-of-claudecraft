# ClaudeCraft Studio, feature roadmap

Ten asks, surveyed against the code as it stands on `merge/v0.35.1` (2026-08-11).
For each: what exists, what the real gap is, and the design that closes it.

The headline finding: **four of the ten are not new systems.** They are existing
engine capabilities the editor never got wired into. Those are the cheap wins,
and three of them (#6, #8, #10) are the ones currently making the editor look
and perform unlike the game.

---

## Cross-cutting groups

The ten items collapse into five groups that share foundations. Building them
in group order avoids writing the same code twice.

| Group | Items | Shared foundation |
|---|---|---|
| **Water** | 3, 4 | one authored water-body system on `render/water.ts`'s shader |
| **Terrain surface** | 1, 6 | the chunk mesher + splat shader |
| **Perf & shipping** | 8, 9 | placement LOD parity with the game's own art |
| **Content generation** | 2, 7 | a procedural→GLB bake path + asset metadata |
| **Authoring surface** | 5, 10 | the document as the single source of truth |

---

## 1. Cave boolean cutter / terrain remesh

**Today.** Caves are *terrain-independent tubes* (`sim/caves.ts`, `CaveDef` at
`types.ts:6173`, mesh in `render/cave_mesh.ts`, 581 lines). The maker authors a
rig of nodes; a bore is generated with width/height/variance/floor-bump
sliders. Openings are authored **separately** as `TerrainHole` spheres, the
ground sheet simply does not exist inside the sphere, giving a round rim on any
slope. Sim and render both sample the same analytic functions, so what you walk
on is what you see. There is a `holePatches` list to un-punch a hole.

**The gap vs. the Unreal-style boolean tool.** Three specific things:

1. **The cut is a sphere, not a volume.** Every opening is a ball; a cave mouth
   that follows a cliff face, an arch, or a slot canyon is not expressible.
2. **Tube and cut are two objects the maker aligns by hand.** In Unreal's tool
   the brush *is* the cut, you carve and the terrain remeshes around it in one
   gesture. Here you sculpt a tube, then punch spheres at both ends and nudge
   them until the seam looks right.
3. **No remesh.** The hole is a *discard* in the terrain shader, not a
   re-triangulation, so there is no rim geometry to texture, no thickness to
   the ground sheet, and no way to blend cave rock into terrain material at the
   seam.

**Design.**

- **A real SDF brush stack.** Generalize `TerrainHole` into
  `TerrainCut { shape: 'sphere'|'box'|'capsule'|'tube', transform, blend }` and
  evaluate the union of cuts as a signed distance field. The existing
  sphere-discard path becomes the `sphere` case, so old documents keep working
  unchanged.
- **Carve directly from the tunnel brush.** The Tunnel tool already produces a
  capsule chain (the bore). Emit a matching `tube` cut alongside it, so drawing
  a cave that breaches the surface opens its own mouth. This alone removes most
  of the hand-alignment work.
- **Remesh the rim.** Where the SDF crosses the ground sheet, generate a skirt
  band (marching-squares on the chunk's grid, at chunk-build time in
  `terrain_chunk_build.ts`) with its own normals and material slot, so the cut
  edge has thickness and can be textured as rock rather than reading as a paper
  edge.
- **The sim must read the same SDF.** Non-negotiable: movement, the camera
  clamp and the collider field all sample the analytic function today. A cut
  the renderer honours and the sim does not is an invisible wall, the exact
  failure mode already recorded for procedural decorations.

**Risk:** medium-high. The mesher runs in a worker (`terrain_chunk_worker.ts`),
so the SDF has to be transferable and cheap. Budget a spike on the marching-
squares rim before committing to the shape zoo.

---

## 2. Tree gen → foliage gen, with GLB bake

**Today.** `render/tree_gen.ts` (1597 lines) builds parameterised trees from
`TreeParams`/`TreeVolume` (`sim/tree_params.ts`), with painted leaf atlases
(`leaf_sets.generated.ts`), Blender-authored trunks (`tree_trunks.generated.ts`)
and canopy-volume scatter. `TREE_PRESETS` exposes it in the editor. Grass and
bushes are elsewhere entirely: `render/foliage.ts` owns the procedural meadow
grass (8/16-vert quads on its own instanced ring) and the dressing scatter.

**The gap.** Three things, and the third is the valuable one:

1. Only trees are generated; bushes and grass are separate hard-coded systems.
2. There is no way to *keep* a generated tree, it lives as parameters, rebuilt
   procedurally every session, and cannot be handed to another map or reviewed
   in the asset browser.
3. Because it is procedural, it never benefits from the placement batching
   path, a generated tree cannot be instanced the way a catalogue GLB is.

**Design.**

- **Generalize the parameter type.** `TreeParams` → `FoliageParams` with a
  `kind: 'tree' | 'bush' | 'grass' | 'fern' | 'vine'`, sharing the trunk/branch
  solver where it applies and swapping the canopy solver per kind. Bushes are
  the cheap case (no trunk chain, one canopy volume); grass clumps are a blade
  scatter over a footprint, reusing `blade_grass_dense_core`.
- **Bake to GLB.** `THREE.GLTFExporter` over the built model, POSTed to a new
  `/__studio_asset/save` dev endpoint (same idiom as `/__studio_map/publish`),
  written under `public/models/generated/<slug>.glb`, then
  `gen_asset_catalog.mjs` picks it up on the next run. From that moment it is
  an ordinary catalogue asset: batched, collision-bakeable, publishable.
- **Round trip the parameters.** Write the source `FoliageParams` into the
  GLB's `extras`, so a baked asset can be re-opened in the generator and
  re-baked rather than being a dead end.

**Risk:** low. Everything here is additive, and the bake path is the same shape
as three existing endpoints. The one design decision worth care is the
atlas/material budget, 200 baked variants each with their own leaf atlas would
undo the batching win, so bakes must share the generator's atlas set.

---

## 3 + 4. Water: pools, rivers, waterfalls

Treat these as one item. They are the same asset with different footprints, and
building them separately means writing the water shader three times.

**Today, a stark asymmetry.**

| | Lines | What it does |
|---|---|---|
| `render/water.ts` + `water_simulation` + `ocean/` + `water_core` + coverage/flora/underwater | ~3,900 | the world's water: wave simulation, shore blending, coverage, flora, underwater state, ripple/wake field |
| `render/fluid_surfaces.ts` | 302 | the editor's fluid pools: an ellipse disc with a tinted surface |
| `render/waterfall.ts` | 265 | a curved sheet + foam disc + mist sprites, self-contained, hard-coded 5×2.6 yd source size |

`FluidVolume` (`types.ts:6242`) is an axis-rotated **ellipse**, `halfX`,
`halfZ`, `rotY`, `offsetY`, with hue/lum/damage/glow. That is the whole
geometry vocabulary. There is no river tool at all; "river" today means placing
`props/lava_river_a|b|c` GLB segments end to end.

**The gap.** Editor-authored water is a different, much cheaper renderer than
world water. It cannot match the world's quality because it does not share any
of its code.

**Design, one authored water body, three footprints.**

- **`WaterBody` replaces `FluidVolume`** as the authored type, keeping the
  fluid fields (kind, damage, glow, tint) and generalizing the footprint to a
  **polygon or spline ribbon with per-vertex width**, `pool` is a closed
  polygon, `river` an open ribbon, `fall` a ribbon whose control points have
  significant Y delta. One type, one editor tool with three modes. Parse the
  old ellipse shape into a polygon so existing maps carry over.
- **Render through `water.ts`, not beside it.** The authored surface becomes
  another consumer of the same material/wave uniforms: same normal maps, same
  shore blend, same depth fade, same reflection treatment. A pool then looks
  like the world's lakes because it *is* the world's lake shader.
- **Flow.** Rivers need a flow vector; a ribbon has one for free (its tangent).
  Feed it as a UV scroll direction into the existing wave material, that one
  uniform is most of what makes a river read as moving water.
- **Falls become ribbon segments with a vertical tangent**, which lets the
  existing sheet+foam+mist code become the *rendering* of a steep ribbon
  instead of a separate asset with its own hard-coded size.
- **Sim stays cheap.** The submerged damage tick and the swim-phase test read
  the footprint polygon; no wave sampling in the sim. Keep the existing
  contract that the sim only reads what it must.

**Risk:** medium. `water.ts` is a 1,571-line shipped system with a ripple-field
setting gated OFF by default for cost. Adding authored bodies must not regress
the world's water, pin the shipped path with a before/after frame-cost test
the way the VFX work did.

---

## 5. AI editing the map on the fly

**Today.** The editor's state lives in `EditorApp` (`src/editor/app.ts`, very
large) behind DOM tools. The dev server already exposes six write endpoints
(`/__studio_map/publish`, `/__region_map/save`, `/__collision_master/save`,
`/__bg_editor/save`, `/__dungeon_editor/save`, `/__music_editor/save`), and the
codebase has a strong convention of **pure `*_core.ts` decision modules** with
DOM-free logic that both the UI and a CLI can drive.

**The gap.** There is no addressable, machine-driveable representation of an
edit. An agent can write `data/maps/<slug>.map.json` wholesale, but cannot say
"move the oaks off the road", "add a wolf camp at the ford", "extend the zone
north by 200 yards" without re-serialising the entire document and losing the
undo stack.

**Design, a command layer, not a chat box.**

- **`src/editor/commands/`, a typed command vocabulary.** Every mutation the
  UI can perform gets a serialisable command: `place`, `move`, `scale`,
  `delete`, `paint`, `stampTerrain`, `addCamp`, `addNpc`, `addQuest`,
  `setZoneRect`, `setAtmosphere`, … Each is a pure function
  `(map, cmd) => { map, inverse }`. The inverse is what makes this work: the
  undo stack becomes the command log, so an agent's edits are reviewable and
  revertable one step at a time, exactly like a maker's.
- **Rewire the existing tools onto it.** Not optional, if the UI and the
  command layer are two paths, they drift. Tools emit commands; the app applies
  them. This is the biggest single piece of work in the item and the reason it
  is worth doing properly.
- **`/__studio_agent/apply`** takes a command batch, applies it to the open
  document, and returns the inverse batch plus a render of the affected rect.
  With the map open in a browser tab, an agent edits and *sees the result*.
- **Query side matters as much as write side.** `/__studio_agent/query` answers
  "what is within 30 yards of (x,z)", "which placements use `foliage/oak_2`",
  "what is this zone's rect", an agent that cannot see the map can only
  vandalise it.
- **Guardrails.** Every batch runs through `prepareMapForEngine` (canonical
  sanitize + real `Sim` boot) before it is accepted, which is the same gate
  publishing already uses. A batch that cannot boot is rejected whole.

**Risk:** medium, but the risk is *scope*, not difficulty. The command
vocabulary wants to be complete, and the tool rewiring touches every tool.
Ship it in slices: placements first (place/move/delete/scale covers most agent
work), then terrain/paint, then content (camps/npcs/quests).

**This is the item that multiplies the other nine**, every feature below gets
an agent-driveable surface for free once its mutations are commands.

---

## 6. Layered terrain textures

**The survey turned up the most important finding of the ten here.**

**Today.** The shipped terrain mesher already blends **eight weighted layers**
per vertex, `terrain_chunk_build.ts:56`:

```ts
splat: [number, number, number, number]; // grass, dirt, rock, sand
extra: [number, number, number, number]; // mud, snow, impact scorch, impact ash
```

Meanwhile the editor's paint is `BiomePaint` (`types.ts:6267`): a grid of
`ids[]`, **one hard id per cell**, 255 = unpainted, plus custom swatches with
hue/light/texture. And `grep biomePaint src/render/terrain_chunk_build.ts`
returns **nothing**, the paint field does not reach the mesher at all, which
is the "editor terrain paint missing on v0.35's splat shader" item still open
from the v0.35 merge.

**So the ask is not "add a second layer".** The engine has eight, weighted and
blended. The gaps are that the editor paints hard IDs instead of weights, and
that its paint is not plumbed into the shader at all.

**Design.**

- **Paint weights, not ids.** `BiomePaint.ids[]` → a per-cell weight vector
  over layer slots. A brush contributes weight with falloff and the vector
  renormalises, which *is* layering: paint dirt over grass at 60% and you get
  the blend the shipped world already draws on its slopes.
- **Feed the existing splat directly.** The painted vector overrides the
  procedural rule per-cell in `terrain_chunk_build.ts`'s sample function.
  Painted always wins, exactly as the current `terrainStyle` doc comment
  promises. This closes the v0.35 regression and delivers layering in the same
  change.
- **Bind custom swatches to layer slots.** The 64-slot custom ground-texture
  atlas already built for the fork becomes the layer source; a swatch is "this
  texture in slot N", and the weight vector selects among slots.
- **Keep the hard-id path as a parse fallback** so existing painted maps load
  as 100%-weight single layers.

**Risk:** medium, it touches the hot chunk-build loop and a worker payload
(the weight vector is 4 to 8 bytes/cell instead of 1). Mitigate by packing weights
as bytes and keeping unpainted cells absent rather than zero-filled.

**Value:** highest ratio of the ten. One change fixes a known regression, gives
layered painting, and makes editor ground match game ground.

---

## 7. Asset stats on selection

**Today.** `AssetEntry` (`asset_catalog.generated.ts`) carries `id`, `category`,
`label`, `path`, `subcategory`, no geometry or size data. The collision badge
(authored/baked/none) added in the asset-browser work is the only per-asset
metric in the UI.

**Design.** Small and self-contained.

- **Extend `scripts/gen_asset_catalog.mjs`** to record, per asset: file size
  (`statSync`), triangle count, vertex count, sub-mesh count, material count,
  texture count and total texture bytes, and the bounding-box dimensions in
  yards. The repo already uses `gltf-transform` in the weapon/skin scripts , 
  read the accessors with it rather than hand-parsing the GLB.
- **Show it in the inspector** for the selected placement, and as a sortable
  column/badge in the asset browser, so a maker can find the 200k-triangle
  offender before it is placed 400 times.
- **Aggregate for the open map**: total triangles, draw-call estimate (batches,
  not instances), texture memory. This is the number that predicts whether a
  map will hold frame rate, and it belongs on screen while authoring, it also
  becomes the readout item #8 is judged against.

**Risk:** low. Pure additive metadata; the catalog is already generated.

---

## 8. Editor performance parity with the game

**Today.** Instancing landed (`render/placed_batches.ts`, one `InstancedMesh`
per GLB sub-mesh, the same arrangement the shipped game uses for battleground
and dungeon art). Placements get a blunt distance cull:
`LOD_RANGE_ASSETS = 500` yards with 1.12 hysteresis and a 400/frame budget
(`placed_assets.ts:182`). Runtime mesh simplification was tried and **reverted
, it measured worse**. `render/draw_stats_core.ts` already reports per-frame
draw calls and triangles with baseline subtraction.

**The measured gap** (from the collision A/B, `tmp/map-ab-collision-final.json`):
the exported-map leg draws **~8M triangles against the hand-authored world's
~3.5M** for equivalent content, and that gap predates the collision work. FPS
trails by 1 to 21%. Collision was exonerated by the headless bench; **this is a
render-side triangle problem**, not a physics one.

**Why.** The game's own art has a LOD ladder the editor's placement path does
not: `foliage_lod.ts`, `foliage_impostor.ts` (billboard impostors at range),
`perceptual_lod_core.ts` (screen-size-driven tier selection), `crowd_lod.ts`,
`drape_lod_core.ts`. Placements have exactly one tier and a binary 500-yard
cull. Everything inside 500 yards draws at full density, all the time.

**Design, port the game's ladder to placements.**

- **Perceptual tiering, not distance tiering.** `perceptual_lod_core` already
  encodes the right rule: choose a tier by projected screen size, so a great
  tree and a mushroom do not share a cull radius. Drive placement visibility
  from it instead of the flat 500 yards.
- **Impostors for the far band.** `foliage_impostor` already renders billboard
  cards for the world's trees. A baked generated tree (item #2) is exactly the
  input that system wants, which is why #2 should land before this.
- **Bake LOD tiers at publish.** Rather than simplifying at runtime, which was
  measured and rejected, generate decimated tiers **offline** in the publish
  step, as a `gltf-transform` `simplify` pass per catalogue asset. Cost moves
  to build time, where it is free.
- **Instrument first, then optimise.** Put the item-#7 aggregate readout and
  `draw_stats_core` on screen behind a debug toggle, and hold every change to a
  measured before/after. The A/B harness is extremely sensitive to concurrent
  load, never run tests or edit source while it samples.
- **Cross-run comparisons are meaningless on this machine** (world-leg FPS
  swings 12 to 33 between runs). Only within-run deltas count. Record that in the
  test itself so nobody re-learns it.

**Target restated concretely:** editor triangle count within ~15% of the game's
for the same view, with no frame exceeding 2× the median (that is what "no FPS
spikes" means in a measurable form).

**Risk:** medium. The work is well-understood but the win is incremental and
must be measured at every step.

---

## 9. Map → game pipeline

Designed in full in **`STUDIO-ZONE-PIPELINE.md`** (written earlier today).
Summary: publish per **zone** into `src/sim/content/<zone>.authored.generated.ts`
rather than as a standalone `?map=<slug>` world, because the authoritative
server runs `BUILTIN_WORLD` and never calls `setActiveWorldContent`, anything
that stops at `startOffline` is single-player decoration.

The "smooth transition without performance loss" half of this ask is item #8:
a published map that draws 2.3× the triangles of hand-authored content will
cost frame rate in the real game, not just in the editor. **#8 gates #9's
quality bar**, and the zone-scoped publish is what makes #8's offline LOD bake
possible at all.

---

## 10. Weather and lighting that persist into the game

**Today, two parallel systems, and the code says so.** `render/editor_lighting.ts`
opens with:

> Editor-only scene-lighting override profiles. […] **The game/playtest path
> never calls it**, so shared production lighting is untouched.

`EditorLightingProfile` (sun intensity/color/azimuth/elevation, hemisphere, env
scale) is a *view* setting. Separately, the document has
`ZoneAtmosphere { lighting, timeScale, skybox, weather }` (`types.ts:6384`)
which *does* ship, and `MapWeather` (`types.ts:6399`) already supports fixed
modes, intensity, a billboard cloud deck, and a **timed schedule** cycling modes
for N minutes each. The editor writes `zoneAtmosphere` from the Zone panel
(`app.ts:13342`).

**So "lighting is detached from the map" is exactly right, and it is a wiring
problem, not a missing feature.** The dial the maker reaches for is the
editor-only override; the field that ships is the one behind the Zone panel.

**Design.**

- **Delete the parallel path.** The lighting panel authors
  `zoneAtmosphere[zone].lighting`, the field that ships, and the viewport
  previews *through* it. Keep `setEditorLighting` for genuine view aids only
  (a "work light" for authoring in a dark cave), clearly labelled as not
  shipping and never persisted.
- **Sun position is the missing field.** `MapLighting` needs the azimuth/
  elevation the editor profile has, or authored lighting cannot express time of
  day. Check what `MapLighting` carries and widen it to match.
- **A real time-of-day scrub.** One slider drives sun angle, sky, fog and the
  night light field, previewing the day the map will actually have, and
  writing a `timeScale`/anchor into the document rather than a view state.
- **Weather preview must run the schedule.** `MapWeather.schedule` already
  exists; the editor should be able to scrub it and see each phase, which is
  the only way to author a storm cycle without playtesting for ten minutes.
- **Per-zone, with inheritance.** `zoneAtmosphere` is already keyed by zone.
  Make the panel show inherited-vs-overridden per field so a maker can tell
  what their zone actually owns.

**Risk:** low-medium. Mostly rewiring, with one type widening. The trap is that
existing maps have lighting stored in neither place (they were authored with
the view override and never persisted), so expect a migration where the current
view profile is written into the document on first save.

---

## Recommended order

Sequenced so each item lands on foundations the previous one built, and so the
things that make the editor *look and run unlike the game* go first.

| # | Item | Why here |
|---|---|---|
| 1 | **#6 paint → splat weights** | fixes a known v0.35 regression *and* delivers layering; highest value/effort ratio |
| 2 | **#10 lighting/weather onto the document** | mostly wiring; makes every subsequent screenshot trustworthy |
| 3 | **#7 asset stats** | small, and it is the instrumentation #8 is judged against |
| 4 | **#8 perf parity** | the measured 8M-vs-3.5M triangle gap; gates #9's quality |
| 5 | **#9 zone pipeline** | already designed; stage 1 (`?zone=&map=`) is usable on its own |
| 6 | **#2 foliage gen + GLB bake** | feeds #8's impostor band; unblocks generated content as real assets |
| 7 | **#5 agent command layer** | large, but multiplies everything already built |
| 8 | **#3+#4 water overhaul** | self-contained; do it as one system, never as two |
| 9 | **#1 cave boolean cutter** | highest technical risk; wants the terrain mesher work from #6 already settled |

Items #6, #7 and #10 together are a plausible first milestone: they are the
three cheapest, they close two known regressions, and they leave the editor
visibly closer to the game before any large system is touched.
