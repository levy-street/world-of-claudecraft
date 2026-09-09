# The Drakelands Map Improvements

Status: LANDED on `feature/drakelands-map-improvements` (PR #3746), base
release/v0.42.0. The program below is the pass that shipped; the "Landed"
section is the current ground truth, the "Program" section is the owner
direction it executed. Further slices still land one per PR into the
branch until it merges.

## Goal

Improve the full Drakelands map: terrain, dressing, POIs, roads, and the
way the zone reads on the world map. Slices are proposed and claimed on
the epic PR, one slice per PR back into this branch.

## What this branch starts from

The branch forked from the `feature/ignivar-drakelands-entrance` tip
(`da04e5886`, the PR #3740 merge) and later synced release/v0.42.0
(2026-09-07), so it already contains:

- PR #3689: the Ignivar overworld entrance on new Drakelands land: the
  western cove trim, the new land lobes near (205, 2255), the volcanic
  headland with the gate near (210, 2258), and the Bloodglass road (R6)
  terminus given its destination. Nearby shore camps shifted east to
  clear the bridgehead approach.
- PR #3740: the forge-lift antechamber into the Halls, merged into the
  entrance branch 2026-08-29.
- Everything release/v0.42.0 carries (the Ignivar raid epic, the Crucible
  professions work, the v0.41.x hotfix line).

Zone ground truth:

- Zone content and dressing live in `src/sim/content/drakelands.ts`
  (the hollow_crypt ruin-ring and nythraxis mine-mouth patterns).
- The placed-kit dressing (the isle fortress, the rebuilt Last Keep, the
  Wyrmwatch rebuild) lives in ONE world-space table,
  `FORGEFATHER_FORTRESS_PLACEMENTS` in `src/sim/forgefather_fortress.ts`,
  which drives the renderer, the colliders, the streetlamp sites, and
  (via `src/sim/kit_buildings.ts`) the zone map's building silhouettes
  and the rested-XP inn.
- The entrance program is documented in
  `docs/design/ignivar-entrance/plan.md`.
- Roughly 167 files reference the zone across content, render, guide,
  music, achievements, and map plates; budget the sweep accordingly when
  a slice moves or renames anything.

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
- A world-layout change bumps `ONLINE_WORLD_LAYOUT_VERSION`
  (`src/world_api.ts`) and its Node mirror (`scripts/lib/world_auth.*`);
  the epoch is allocated on the release line, never on the branch (this
  branch's bump collided with release and re-numbered at the sync).
- Kit assets ship only when placed: `tests/drakelands_kit_assets.test.ts`
  pins that every registered kit GLB has a placement, every GLB on disk
  is registered, and nothing ships twice.

## The program (owner direction, 2026-08-29)

The owner rebuilds the zone's built sites by hand with the placer; the
code side clears the ground and swaps the two anchor sites:

1. SITE SWAP: The Last Keep and the Trollmoot trade places. The keep's
   SITE moves to the Trollmoot rise; the troll clans move onto the old
   keep grounds, restoring the pre-castle ruin ring at (422, 2032) that
   the castle was built over (drakelands.ts records it).
2. THE LAST KEEP STRIPS TO FLAT LAND: the castle structure (pads, lift
   walls, towers, parapets, bailey buildings, crystals, blockers, the
   render assembly, the exterior floor-plan UI) is removed everywhere.
   A new pure leaf `src/sim/keep_site.ts` authors the build pad at the
   new site: rect x 432 to 494, z 2122 to 2182, h 2.0 (probed against
   the rise: natural ground 0 to 3, water -4.3, sea past x 500 and
   z 2190; the pad clears the bonefield muster row at z 2106-2112 and
   Scout Yerrin's ridge camp at (494, 2100)). The keep INTERIOR kept its
   dungeon registration behind a dev-only door until the rebuilt keep
   opened a real one (the second placer pass, below).
3. WYRMWATCH STRIPS TOO (owner add): the hub's buildings, stalls, well,
   crates, palisade fences, tents, and campfire go; the NPCs, spawn,
   quests, functional graveyard, and roads stay. Scout Yerrin's far-dune
   camp (her tent and banked fire) is hers, not Wyrmwatch's: it stays.
4. PLACER SUPPORT: a third asset kit section ('custom') holding only the
   owner's new assets, and `/dev freezemobs` (a sim-level dev flag that
   skips mob updates entirely: no wander, no aggro, no swings),
   auto-enabled while the placer is open so placement never draws aggro.
   The freeze is realm-wide on a shared dev server; the rig says so in
   its log when it opens.
5. THE ASHEN BULWARK IS RAZED (owner layout, 2026-09-03): the west
   headland barracks compound (layout leaf, render assembly, graded pad,
   lift field, scatter clearance, yard buildings) all come out and the
   headland shelf returns to natural coast for a placer rebuild to come.

## Landed (the seven placer passes, 2026-08-30 to 2026-09-05)

- The kit: 20 pieces under `public/models/drakelands_kit/` (buildings and
  bases, church, barracks, stables, castle door, fence, gravestones,
  signpost, tavern sign, horse-head sign, notice board, racks, dummy,
  well pump, dragon statue), built by
  `scripts/assets/build_drakelands_kit.mjs` from the owner's Tripo drop
  and grained by `scripts/assets/grain_drakelands_kit_textures.mjs`
  (both read the full-quality sources the owner keeps outside the
  repo). Five zero-placement pieces were stripped from shipping.
- The Last Keep on its pad: the long west wall, the raised temple court
  (raw ground stamped to 5.1, deck tops 5.76) holding the placed
  castle_door facade at (480.7, 2168.1) facing west, the training yard
  and its rampart walk with two-flight climbs, the paved plazas, the
  western boardwalk, the triple-gate house at the dune-fork road's
  terminus, the east rim promenade over the quay bowl, the north strand
  stair down to the strait bridges, the west approach plaza with its
  dune stair, three dragon-head fountains, a barracks house, and a
  chapel raised on its hall with a churchyard south of it.
- The keep dungeon door: `the_last_keep` doorPos (479.4, 2168.1), 1.2 yd
  proud of the facade, leaveOffset (-3.5, 0) onto the terrace deck; the
  visit deed is earnable again; `door_portal.ts` yields the generic arch
  only to a castle_door standing at that doorPos.
- The POIs after the swap: the_last_keep (486, 2168) on the temple
  court; trollmoot (418, 2032) with the henge ring at (422, 2032) and
  the troll camps at (412, 2030) r10 c3 and (427, 2044) r8 c2. The keep
  road spur extends past the old barbican line to the moot; the
  dune-fork road ends on the pad's west approach.
- The keep-side graveyard moved from the open dune (452, 2112) to the
  churchyard (451, 2134), so the Pale Keeper stands among the placed
  gravestones; the render bone field moved with it (a tight r 8 on the
  lawn).
- Wyrmwatch's first rebuild waves: the tavern row with its sign (the
  rested-XP inn now derives from that sign, `src/sim/kit_buildings.ts`),
  the stables yard with the horse-head sign, the church with its
  gravestone garden on the west gate lawn (its own scatter clearance
  disc), the signpost, and the well. Brannoc and Sela keep their spots.
- Walkability: standable plates carry `passUnderY` so a body walks
  BENEATH an elevated deck (the training-yard balcony); a solid standing
  on a deck is grounded furniture there; the stairs walk both ways
  through three kernel fixes (the steep-ground strip references the raw
  ridden height, the wall gate measures the walked surface on a lift via
  `walkedSteepnessAt`, a separating zero-advance graze no longer swallows
  the motion); a mounted rider crosses the strait bridge because the
  deep-water gate reads a standable deck within a step as dry footing;
  leaving a dungeon seats the exit on the real standing surface.
- The epoch: `ONLINE_WORLD_LAYOUT_VERSION` 26 (allocated at the
  release/v0.42.0 sync; 21 to 25 belonged to the raid line).
- The night light field grew to 48 slots so the keep's twenty lamps all
  reach the ground wash in its busiest window; the kit renders with a
  warm ember grade at load, keyed off its directory.

Consumers the strip touched (the full sweep): world.ts pad chain +
scatter clearance, walk_lifts castleLift, colliders wall ledges +
parapets, data.ts blockers, ember_lilies + ember_features clearances
and crystals, terrain_mesh_height mirror, renderer castleFeatures
attach (renderer edits re-mint the polish provenance), the Last Spring
bank grading (retired with the pad that opened its hollow),
castle_plan_core (Dawnhold keeps its floor plan), the zone map's
building silhouettes (now fed by the kit footprints).

## Slices

Further slices to be proposed on the epic PR (the Bulwark headland
rebuild, more of Wyrmwatch, the world-map read). Claim a slice by
putting your handle on its checkbox there; land one slice per PR into
this branch, gate green each time (`node scripts/gate_select.mjs`).
