# The Drakelands Map Improvements

Status: OPEN. This is the epic surface for a full improvement pass over
the Drakelands zone map. Design space is open; the sections below pin the
ground truth the pass starts from and the constraints every slice carries.

## Goal

Improve the full Drakelands map: terrain, dressing, POIs, roads, and the
way the zone reads on the world map. Slices are proposed and claimed on
the epic PR, one slice per PR back into this branch.

## What this branch starts from

The base is the `feature/ignivar-drakelands-entrance` tip (`da04e5886`,
the PR #3740 merge), so the epic already contains:

- PR #3689: the Ignivar overworld entrance on new Drakelands land — the
  western cove trim, the new land lobes near (205, 2255), the volcanic
  headland with the gate near (210, 2258), and the Bloodglass road (R6)
  terminus given its destination. Nearby shore camps shifted east to
  clear the bridgehead approach.
- PR #3740: the forge-lift antechamber into the Halls, merged into the
  entrance branch 2026-08-29.

Zone ground truth:

- Zone content and dressing live in `src/sim/content/drakelands.ts`
  (the hollow_crypt ruin-ring and nythraxis mine-mouth patterns).
- The entrance program is documented in
  `docs/design/ignivar-entrance/plan.md`.
- Roughly 167 files reference the zone today across content, render,
  guide, music, achievements, and map plates — budget the sweep
  accordingly when a slice moves or renames anything.

## Constraints every slice carries

- POI locale keys are positional and append-only: never reorder or
  delete a POI index; retire in place, append new.
- Coast and land authoring ride the existing data lanes: the authored
  cove/lobe tables plus level terrain stamps in the builtin world's
  terrainEdits. Prop seating ignores stamps (skipEdits), so props need
  real generated ground under them, not stamped ground.
- Keep west-shore land at x >= 188; the inter-column open bay begins
  below that.
- World moves ripple: any camp, prop, or road move shifts world-gen
  draws downstream. Expect a re-pin wave in the full suite for any
  relocation slice, and split sweep failures into timeouts vs
  assertions before diagnosing.
- Interior verticality comes from the lift field, never collider
  step-ups inside instances.

## Slices

To be proposed on the epic PR. Claim a slice by putting your handle on
its checkbox there; land one slice per PR into this branch, gate green
each time (`node scripts/gate_select.mjs`).
