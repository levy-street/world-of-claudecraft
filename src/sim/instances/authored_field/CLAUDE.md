# src/sim/instances/authored_field: authored open-air instance fields (G9)

One data record per dungeon interior (`AuthoredFieldDef`, `types.ts`) describes
an open-air instance: ordered surfaces (flat polygons, flat discs, and paths
whose vertices carry heights), authored walls, kit props with footprints, and
render-only light zones. Everything else is DERIVED from that record:

- `height.ts`: the ground height. The last surface containing a point wins;
  the void between surfaces takes `voidHeight`. One height per point, always:
  upper levels are terraces beside lower ones, never above them. A path blends
  between its mitred cross-sections (`pathHeightUnbounded`), so a turning stair
  has no seam at its bends.
- `cliffs.ts`: every outline edge where the ground drops by more than
  `cliffStep` becomes a cliff run (merged per edge, deduped spatially). The
  renderer dresses the same runs (retaining walls, rock faces, balustrades).
- `field_colliders.ts`: cliff runs, walls and prop footprints as colliders.
  Gate colliders are appended by `interior_collider_sets.ts` from the owning
  dungeon's `DungeonDef.gates` (see `../dungeon_gates.ts`).
- `registry.ts`: interior key to record and to height function. `world.ts`
  `groundHeight` has ONE generic arm over `instancedFieldHeight`; Wildheart's
  bespoke height rides the same lookup unchanged.

Rules:
- Author every path to start and end with a short flat run INSIDE the surface
  it joins, so the join is continuous and no cliff appears there.
- Keep every path's slope under about 0.75 yd of rise per yard: the cliff
  generator probes 0.6 yd either side of an outline, so a steeper ramp reads
  as a drop and walls itself off where it crosses a surface edge.
- Keep the collider count modest (interior lists are scanned linearly): prefer
  few long edges over many short ones.
- Pure, deterministic, no `SimContext`, no rng, no DOM or Three imports; the
  renderer imports these modules directly for its terrain and dressing.
- The renderer draws each surface only where it OWNS the ground (clipped by every
  later surface, `src/render/authored_field/field_clip_core.ts`), so a later, lower
  surface cut into an earlier, higher one (a moat, a ramp) is drawn where it is
  walked. `tests/authored_field_floor_sweep.test.ts` sweeps every field and fails
  on any drawn-versus-walked mismatch; run it after any layout edit.
- The rock skirt follows the same ownership: it stands only along the stretch of
  an outline whose ground the surface still owns (`field_skirt_core.ts`), so a
  later stair cut down through a lip draws no wall across itself, and a skirt's
  flare never leans over a neighbouring floor. The same sweep fails on any drawn
  face that crosses a body's height over walkable floor without a collider.
- Tests: `tests/authored_field.test.ts` (height, cliffs, colliders) and the
  dungeon route contract `tests/hollow_crypt_route.test.ts`.
