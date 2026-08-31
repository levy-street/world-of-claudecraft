# The Ignivar Raid Entrance: Drakelands Overworld Door

Status: PLAN, site DECIDED (owner picked it on the zone map): an ISLAND
in the western cove near (205, 2255), the primary candidate below, with
the bridge crossing from the Bloodglass shore. The bridge itself is a
new asset the owner is authoring; it joins the placer's exterior kit
when it lands. Nearby camps on the shore shift slightly east to clear
the bridgehead approach.

## Goal

Give the Ignivar raid its public front door: an overworld entrance in the
Drakelands that zones a raid group into the Halls of the First Tempering
(`ignivar_forge_approach`). The entrance sits on NEW LAND grown onto the
Drakelands for the purpose, so the monumental gate gets ground shaped for
it instead of competing with existing content for clearance.

This closes the "Development-only entrance until the raid's progression
hook is authored" marker in `src/sim/content/dungeons.ts` and is the
prerequisite for roadmap item 15 in `docs/prd/ignivar-raid.md` (Guide,
Finder, lockout, launch tuning).

## What the engine already gives us

The approach room is the raid family's natural front door: it is the only
room `ignivarPreviousRaidRoom` returns no predecessor for, so the chained
gate logic (`src/sim/instances/dungeons.ts`) does not apply to it. Setting
a real `doorPos` and dropping `overworldDoor: false` on
`ignivar_forge_approach` activates, automatically:

- the walk-in door trigger (2.0 yd radius, no click needed), plus the
  click path via the spawned `dungeon_door` object,
- the shared portal arch render (`src/render/door_portal.ts`), jamb
  colliders, and the world-map portal dot,
- raid-group-required entry gating (the id is already in
  `RAID_REQUIRED_DUNGEON_IDS`),
- correct exit drop (today, leaving any Ignivar room drops players at
  world origin inside Eastbrook), and
- correct zone attribution in five readouts that currently answer
  "Eastbrook Vale" for the raid.

The entrance SITE is dressed with ordinary zone props in
`src/sim/content/drakelands.ts` (the hollow_crypt ruin-ring and nythraxis
mine-mouth pattern), plus a POI label (append-only: poi locale keys are
positional).

## Site candidates (surveyed, ranked)

1. PRIMARY, NEW LAND: the western volcanic headland, gate near
   (210, 2258). The Drakelands' west shore between z 2150 and 2310 is
   INSIDE the zone rectangle but currently sea (the authored cove at
   (205, 2230) r40). Trimming that bay row and adding two or three land
   lobes near (205, 2255) grows a volcanic promontory out of the
   existing Bloodglass shelf and western spur lobes, with no zone-rect,
   world-bounds, zoneAt, or map-plate-rect change at all. The Bloodglass
   road (R6) currently dead-ends at (270, 2270); the headland ~55 yd
   west gives that terminus its destination. Clearance verified against
   every camp, egg field, ruin, cone, and the Bulwark (all 48+ yd).
   Constraint: keep land at x of 188 or more (the inter-column open bay begins
   below that).
2. ALTERNATIVE, EXISTING GROUND: the Drakemaw west saddle, gate near
   (312, 2364), on the mountainside between the Drakemaw belt and the
   western cone, 39 yd from the R7 road terminus at (350, 2355), which
   also dead-ends today. Cheapest overall; no new land. Constraint: the
   caldera's SOUTH face is off-limits (the DRAKEMAW_ESCAPE walk-out
   gorge, pinned by tests/terrain_escape_walkout.test.ts).

Lore context either way: world lore names the Drakemaw Caldera "the
forge itself, still lit", and the raid's namesake lake, the Last Spring,
sits at (456, 1988) by The Last Keep; that ground is too crowded for a
raid door (castle apron, an existing dungeon door 35 yd away), so the
Last Spring connection is carried by lore text rather than adjacency.

## New land: the authoring lane

The Drakelands' land tables (EMBER_LAND_LOBES, 31 rows, and EMBER_BAYS)
still live inside src/sim/world.ts, which sits at exactly its monolith
ceiling (5347 lines, zero headroom). The sanctioned move, mirroring
vale_coast.ts verbatim: extract both tables to a new
src/sim/content/ember_coast.ts, LOWER the world.ts ceiling by the
extracted count, and author the new lobes there. Gate-plaza grading then
lands as a DRAKELANDS_TERRAIN_EDITS stamp table on the zone1.ts pattern
(spread into terrainEdits in data.ts). The road connection extends R6
from its (270, 2270) terminus. The world-edge coast sweeps
(tests/world_edge_coast.test.ts) do not reach the west shore, and its
"no dry land past z 1960" rule is x-bounded to the center strip, so the
headland is legal; new shores must still taper walkably.

## Known ripple (from the mechanics survey)

- A real doorPos carves a 20 yd spawn-clearance ring (camp spawner
  projection) and registers a 7/15 terrain calm pad: parity goldens,
  the terrain height fixture, and `dungeon_entry_clearance` re-mint.
- `tests/ignivar_arena.test.ts` pins `overworldDoor: false` on the ARENA
  only; giving the door to the approach room keeps it green.
- Publishing to the Guide (`guideVisible`) and the three pending i18n
  dungeon rows are launch-pass items, deliberately out of scope here.

## Pre-existing bug to fix first (standalone)

`src/sim/terrain_calm_anchors.ts` registers a `dungeonDoor` calm pad for
EVERY dungeon record and lacks the `overworldDoor === false` skip that
`dungeon_door_clearance.ts`, `colliders.ts`, `sim.ts`, and
`map_dungeon_portals.ts` all carry (the `d14e94fad` fix missed this fifth
site). The three Ignivar placeholder doors at (0,0) therefore bake a flat
7/15 terrain pad into Eastbrook at the world origin today. Fixing the
skip is a small, terrain-golden-moving change and lands as this branch's
first code commit, before the entrance terrain work, so the two terrain
deltas stay separable.

## Slice order

1. The calm-pad skip fix plus its regeneration wave (fixture, digests,
   any seated-content re-pins near origin).
2. New land: lobes, grading stamps, road connection (owner reviews the
   shape).
3. The entrance site: doorPos flip, gate structure and site dressing,
   POI.
4. Ripple repair: clearance re-mints, parity re-records, map plates,
   full gate.
5. Screenshots for the PR (desktop and mobile), per the repo rule for
   visual changes.

Out of scope: Guide publication, Dungeon Finder rows, raid lockout,
loot, deeds and Reliquary pages (the launch pass, PRD item 15).
