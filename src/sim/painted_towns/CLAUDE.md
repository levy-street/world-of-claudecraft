# src/sim/painted_towns/: towns rebuilt from the painted Tidehold set

Every built-in town whose old kit houses (the KayKit pool `src/render/props.ts` draws) were
replaced by the painted Tidehold buildings through ONE shared recipe. Eastbrook, Fenbridge
and Highwatch came first and keep their own layout modules (`sim/eastbrook_layout.ts`,
`sim/fenbridge_layout.ts`, `sim/highwatch_layout.ts`); every town after them is a module here.

## Shape
- `types.ts`: `PaintedTownLayout` (id, zone, hub, buildings, the kit records it replaced,
  pads, NPC stands) and the `PaintedTownId` union.
- `models.ts`: the models a town may stand, measured once at AUTHORED size
  (`PAINTED_MODELS`), the looks and the files each was baked in (`PAINTED_LOOK_SETS`,
  `PAINTED_LOOK_MODELS`), and `paintedTownBuilding`, the one way a layout stands a building
  (the grand seat: lift `-(scale + 0.05)`, a visitor `1.8 x scale` off the door).
- One module per town (`gullhaven.ts` ... `eldershine.ts`): a frozen `<TOWN>_LAYOUT` plus its
  keyed views. Pure data and geometry: no engine imports, no randomness, no clocks.
- `index.ts`: the barrel. `PAINTED_TOWNS` is the fixed-order list every consumer reads, and
  `paintedTownBuildingDefs` maps a layout to its zone file's building records.

## A town is its module plus its zone file
Fill in the town's module (buildings via `paintedTownBuilding`, the replaced kit records
exactly as the zone file had them, pads via `levelTownPads` in `sim/placed_town_kit.ts`, the
NPC stands it moved), then in the zone content file replace the kit records with
`...paintedTownBuildingDefs(<TOWN>_LAYOUT)` and point moved NPCs at
`<TOWN>_NPC_PLACEMENTS_BY_ID`. Everything else reads the list and needs no edit:
- sim: `authored_town_registry.ts` (colliders, walk-in floors and stairs, the inn's rest
  area), `data.ts` (the pads join the built-in terrain edits after Highwatch's, in list
  order), `decoration_exclusions.ts` (scatter cleared within `PAINTED_TOWN_SCATTER_PAD` of
  a reach, lamps dropped inside one);
- render: `render/painted_towns.ts` (one `createPlacedTownKit` view per town: fog cull,
  camera fade, piecewise reveal, the indoor camera air, texture tiers, preloads), the props
  view's kit draw and far sprites skipped, grass cleared (`render/foliage_core.ts`);
- Studio: the `paintedTowns` promoted family (`editor/feature_prop_placements.ts`), which
  also lifts the replaced kit placements out of documents converted before.

`tests/painted_towns.test.ts` validates every town that stands buildings (zone, files,
walk-in air, spacing, NPCs, camps, services, water, level ground, doors, lamps, roads, and
that the zone file carries exactly the layout's records); `tests/painted_towns_renderer.test.ts`
pins each town view and `tests/painted_towns_studio.test.ts` the Studio family (no building
skipped, every replaced record lifted). A pad or a building moves terrain and colliders, so a
town change re-records, each in its own commit: the parity goldens
(`UPDATE_PARITY=1 npx vitest run tests/parity`, read `tests/parity/CLAUDE.md` first), the
ground height fixture (`UPDATE_TERRAIN_HEIGHT_PARITY=1 npx vitest run
tests/terrain_height_parity.test.ts`) and the default world bundle (`UPDATE_DEFAULT_WORLD=1
npx vitest run tests/default_world_bundle.test.ts`).

## Rules
- Only shipped painted files: a look carries only the models baked in it, and
  `paintedTownBuilding` throws on any other pairing or on a walk-in sealed model.
- Never let a pad or apron reach a mob camp's ground (a camp's idle wander draws the shared
  rng, so its ground must not change), never stand a building, pad or door over water.
- Building ids are internal, frozen once shipped (saves and Studio documents key on them).
