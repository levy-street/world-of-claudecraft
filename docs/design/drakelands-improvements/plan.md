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

## The program (owner direction, 2026-08-29)

The owner is rebuilding the zone's built sites by hand with the placer;
the code side clears the ground and swaps the two anchor sites:

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
   Scout Yerrin's ridge camp at (494, 2100)). The keep INTERIOR keeps
   its dungeon registration behind a dev-only door (overworldDoor
   false, the pre-entrance Ignivar pattern) so the visit deed, locale
   keys, and keepsake survive until the rebuilt keep opens a real door.
3. WYRMWATCH STRIPS TOO (owner add): the hub's buildings, stalls, well,
   crates, palisade fences, tents, and campfire go; the NPCs, spawn,
   quests, functional graveyard, and roads stay. Scout Yerrin's far-dune
   camp (her tent and banked fire) is hers, not Wyrmwatch's: it stays.
4. PLACER SUPPORT: a third asset kit section ('custom'), empty until
   the owner's new assets land, only those assets ever join it; and
   `/dev freezemobs` (a sim-level dev flag that skips mob updates
   entirely: no wander, no aggro, no swings), auto-enabled while the
   placer is open so placement never draws aggro.

Site facts pinned by the probe: Trollmoot POI was (460, 2140), henge
ruin ring (468, 2158); keep POI was (406, 2032), walls x 360 to 436.8,
z 1988 to 2071.8, bailey padded to h 6. After the swap: the_last_keep
POI (463, 2152) on the new pad; trollmoot POI (418, 2032), ring at
(422, 2032), troll camps (412, 2030) r10 c3 and (427, 2044) r8 c2. The
keep road spur extends past the old barbican line to the troll site;
the dune-fork road re-aims at the new pad's west approach.

Consumers the strip touches (the full sweep): world.ts pad chain +
scatter clearance, walk_lifts castleLift, colliders wall ledges +
parapets, data.ts blockers, ember_lilies + ember_features clearances
and crystals, terrain_mesh_height mirror, renderer castleFeatures
attach (renderer edits re-mint the polish provenance), the Last Spring
bank grading (rewritten standalone: the pool must not lean on the
castle skirt), castle_plan_core (Dawnhold keeps its floor plan).

## Slices

Further slices to be proposed on the epic PR. Claim a slice by putting
your handle on its checkbox there; land one slice per PR into this
branch, gate green each time (`node scripts/gate_select.mjs`).
