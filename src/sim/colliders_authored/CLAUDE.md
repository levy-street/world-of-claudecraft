# src/sim/colliders_authored - authored-map colliders

The Studio (map editor) additions to the static collider build, extracted out of
`../colliders.ts` so that monolith stays under its `tests/monolith_budget.test.ts`
ceiling. `colliders.ts` imports through `index.ts` and re-exports the public names
(`passesUnder`, `prismPolyAt`, `prismBox`, `insidePrism`), so other importers keep the
`./colliders` path. The one other consumer is `../authored_town_buildings.ts`, which
takes `emitPlacementBoxes` so a walk-in town building (`../town_walk_in.ts`) collides on
the same baked asset rows, through the same emitter, as the same model placed in Studio
(a document-level bake or authored prisms are not consulted for it).

| File | Owns |
|------|------|
| `prism.ts` | Collision Master prism geometry: the loft outline at the feet height (`prismPolyAt`), the covering box, containment, and `pushOutPrism` (the narrow phase `colliders.ts` `pushOut` dispatches to) |
| `pass_under.ts` | `passesUnder`: a body deep in a cave tube or carve walks beneath a surface collider (`baseY` always; `underY` only while an authored map is active) |
| `placement_geometry.ts` | pure transform and outline helpers (XYZ euler matrix, winding sign, convex hull) |
| `placement_colliders.ts` | the placement lane (`pushPlacementColliders`: hitboxes, prisms, ramp decks, baked boxes, legacy circle/square, with the `src` dev stamp) and the editor volumes (`pushColliderVolumeColliders`); `staticWorldColliders` calls both at their original point in the emit order |
| `camera_boom.ts` | the chase-boom filter and march (`cameraBoomClearDistance`); `colliders.ts` `cameraBoomMaxDist` keeps the authored-map gate and the grid query, and passes its `pushOut` in |

Rules:
- Pure and host-agnostic: no `SimContext`, no rng, no grid state. Inputs in, colliders
  appended or numbers out. These were MOVES; keep iteration order identical, since the
  collider list order feeds the grid and every order-sensitive query.
- Shape types and `rotY` come from `../collider_shapes.ts`; never import `../colliders`
  from here (that would be a cycle).
- The built-in world builds none of this (no placements, no volumes, no caves), except
  `emitPlacementBoxes` for its walk-in town buildings; the parity goldens
  (`tests/parity`) pin the rest staying so.
- Unit coverage: `tests/colliders_authored.test.ts`; end to end: `tests/mesh_prisms.test.ts`,
  `tests/authored_prism_collision.test.ts`, `tests/camera_boom_colliders.test.ts`,
  `tests/caves.test.ts`, `tests/collider_volumes.test.ts`.
