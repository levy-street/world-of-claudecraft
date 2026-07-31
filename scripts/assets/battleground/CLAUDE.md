# scripts/assets/battleground/ - the Thornhollow Fields builder

The pure halves of the battleground map builder. The orchestrator is
`scripts/assets/build_battleground_map.mjs`; everything with logic worth a test
lives here, with a hand-written `.d.mts` beside it so the type-checked Vitest
(`tests/battleground_map_plan.test.ts`) imports it directly.

## The one idea: the PLAN owns the footprint, the DRESSING owns the look

`field_plan.mjs` is the combat-tuned Thornhollow Fields layout as plain data: the 100x280
footprint, the keeps, the two curtains and their crossings, the cover, the rune
pads, the graveyards. It is the gameplay contract. **Anything that changes where
a fighter can stand belongs there, and only there.**

`dressing.mjs` builds the Thornhollow art over it: wall courses laid module by
module along the exact rectangle the plan gives them, at the exact thickness the
plan gives them; a rubble formation filling the exact radius the plan gives it.
Art that would move a lane carries `collide: false`. The two places where look
and collision genuinely disagree (the heart ruin's hollow shell, the graveyard
rails) get an explicit invisible `collider/box`, so what blocks is what the plan
says blocks, never what a model happened to be shaped like.

Everything is authored on the CANONICAL Crimson (-z) half and point-mirrored,
so the two teams fight over the same build rather than two similar ones. Use
`both()` / `bothTeamArt()` / `bothLights()` in the dressing pass; never hand-place
a second copy.

## Files

| File | Owns |
|---|---|
| `field_plan.mjs` | the layout: footprint, walls, keeps, curtains, gates, gatehouses, cover, pads, graveyards, named places, and the route polylines the paint wears in |
| `terrain.mjs` | the stamp chain: keep terraces, the Ruin Courtyard bowl, chamber rolls, ground grain. Deliberately shallow (about five yards top to bottom) because the plan under it was tuned on flat ground |
| `stamp_chain.mjs` | the terrain brush math, shared with `compile_thornhollow.mjs`. The sim keeps its own copy (`src/sim/battleground_field.ts`) because it has to run in a browser; the generated build-time probes are what pin the two ports together |
| `ground_paint.mjs` | the eighteen-swatch painted index grid, as a painter's algorithm over the canonical half plus a mirror pass. Also the `GRASS_GROUND` / `SOFT_GROUND` samplers the scatter reads, so a tuft only grows out of painted grass |
| `kit.mjs` | catalogue-piece arithmetic: measured extents from the vendored collision table, the course fit that makes a run span exactly, and the body offset that centres an off-origin piece on the point asked for |
| `dressing.mjs` | every wall block, tower, gate arch, brazier, crate, boulder and tree |

## Pipeline

```
node scripts/assets/build_battleground_map.mjs   -> data/battleground/thornhollow.map.json
node scripts/assets/compile_thornhollow.mjs      -> src/sim/thornhollow_field.generated.ts
```

Both steps are deterministic (same inputs, byte-identical output) and both
committed artifacts are freshness-gated by `tests/battleground_band.test.ts`.
Re-run BOTH after any edit here and commit the results.

## Never

- No `Math.random`, no `Date.now`: the builder has to be byte-deterministic or
  the freshness gate cannot diff a rebuild. Scatter uses the hashed `stream(salt)`
  helper in `kit.mjs`.
- Never place a colliding prop in a lane to make a screenshot look better. Set
  `collide: false` and let the plan keep the ground.
- Never author one half by hand. If a piece needs different ART per team (a team
  banner), use `bothTeamArt`, which mirrors the placement and swaps the asset.
