# Open-field dungeons

An open-field dungeon is a normal instanced dungeon whose interior is an
authored outdoor space instead of a closed room kit. Players enter through the
same overworld door and instance lifecycle as every other dungeon, but inside
they fight across an open field under the sky. Orkadia in the Drakelands is the
reference implementation and the first dungeon of this kind.

## What stays the same as any dungeon

An open-field dungeon begins with a `DungeonDef` in `src/sim/types.ts` and an
entry in `DUNGEONS` from `src/sim/data.ts`. Its door transfers the party to an
instance slot managed by `src/sim/instances/dungeons.ts`. Spawns, resets,
heroic tuning, lockouts, deeds, and guide wiring all follow the standard
dungeon machinery. Nothing about the instance lifecycle changes.

## What changes: the interior

- The placement table `ORKADIA_FIELD_PLACEMENTS` in `src/sim/orkadia_field.ts`
  is the single source of truth: prop kind, instance-local position, and
  rotation for every dressing prop, plus `ORKADIA_FIELD_WALLS` (the perimeter
  enclosure) and the derived `ORKADIA_FIELD_COLLIDER_SPECS` (circle footprints).
  It lives in `src/sim/` so collision and rendering share one authored truth
  while `src/sim/` stays render-free, in the `src/sim/dungeon_layout.ts`
  sharing pattern.
- `INTERIOR_COLLIDERS.orkadia` in `src/sim/colliders.ts` maps to the open-field
  collider set derived from that table: the perimeter walls keep the party on
  the field, and each prop's circle footprint matches its visual size, so what
  you see is what you collide with.
- `buildOrkadiaFieldInterior` in `src/render/orkadia_props.ts` builds the
  interior per claimed slot: a broad ground plane in the zone palette, the
  generated prop GLBs with a procedural fallback per instance, and accent fire
  lights inside the shared interior light budget.
- The 'orkadia' branch of `buildInterior` in `src/render/dungeon.ts` routes to
  that builder instead of a KayKit room layout, and the renderer ambience state
  in `src/render/renderer.ts` treats the interior as outdoor: the
  camera-following sky dome, the exterior fog preset, and the full daylight rig
  (sun, hemisphere, IBL) instead of the underground torch-and-darkness setup.
- Prop GLBs come from the offline asset pipeline (`scripts/asset_pipeline/`
  prop lane; the executed Orkadia generation plan and QA record lives in
  `docs/prd/orkadia-open-world-assets.md`), are applied under
  `public/models/props/`, and ride the immutable media manifest like every
  other curated asset.

## Authoring rules for the next open-field dungeon

1. Keep the `DungeonDef` contract intact: entry and exit offsets must land
   inside the perimeter walls, and the spawn list must stay clear of prop
   footprints (about 3 yd edge to point), so arrival, exit, and mob spawns
   never intersect dressing.
2. Author one sim-side placement table and derive both render instances and
   collider specs from it. Never maintain two coordinate lists.
3. Reuse the renderer's outdoor ambience machinery (sky dome, fog presets,
   daylight rig); do not invent a parallel sky.
4. The field reads through its perimeter: wall colliders on the sim side, and
   a visual backdrop (cliff or palisade modules) outside the walls so there is
   no visible void.
5. Generated props pass the asset pipeline QA gate before apply, stay within
   the prop size budget, meshopt only, and register a preload guard in
   `tests/render_glb_replacement_assets.test.ts`.

## Tradeoffs vs a room-kit interior

The field gives up door-gated pull control (line-of-sight breaks and corridor
chokes that room kits provide for free) in exchange for spectacle and freedom
of movement. Perimeter and prop footprints must be authored so packs cannot be
pulled through walls, and sight lines across the field make pack spacing the
main difficulty knob, the same role corridor turns play in closed dungeons.
