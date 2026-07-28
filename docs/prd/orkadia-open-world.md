# Orkadia: first open-field dungeon (design contract v2)

Status: implementation contract for PR #1584 (`feature/procedural-dungeons`).
This v2 supersedes the first interpretation. Orkadia STAYS an instanced
dungeon exactly like the other dungeons: same `DungeonDef` (index 6, doorPos
{490, 2120} in the Drakelands, entry {0,-2}, exitOffset {0,-6}, the original
spawn list on the z 18..146 footprint, heroic tuning, both deeds with their
original triggers, door portal, instance lifecycle). What changes is ONLY the
kind of space the instance contains: instead of the closed Sanctum room kit,
the instance is an OPEN FIELD: an outdoor orc war-camp under the sky, dressed
with 18 generated props. It is the first dungeon whose interior is open air
instead of rooms.

## What stays byte-identical to the original branch tip

- `src/sim/content/orkadia.ts` (ORKADIA_DUNGEON_DEFS, ORKADIA_MOBS, spawn list)
- deeds, heroic tuning, instance machinery, door spawn/triggers, i18n entity
  keys, world_entity_i18n DUNGEON_IDS, guide dungeons page wiring, the original
  orc GLB animation sets (Idle_Loop/Walk_Loop/Sprint_Loop/Sword_Attack/
  Punch_Jab as shipped).

## What changes

1. **Interior variant `orkadia` becomes an open field** (renderer):
   - Outdoor ground: a broad ground plane at the flat dungeon floor height,
     volcanic ash/rock material in the Orkadia palette (dark rock, mossy green
     tint), NOT the KayKit stone floor tiles.
   - Outdoor light and sky: hemisphere + directional lighting and sky-colored
     background/fog (no ceiling, no room walls); toxic-green accents from the
     warpyre braziers/torches. Must stay graphics-settings fair (cosmetic only).
   - Dressing: the 18 `orkadia_*` prop GLBs placed as a war-camp: war gate at
     the entrance, palisade/barricade perimeter, banners/totem/braziers mid
     field, watchtower, weapon rack/drums/cages/trophy poles/crates, and the
     war hall + bone throne + skull dais + skull pile anchoring the boss end.
     Volcanic cliff modules form the visual perimeter so there is no visible
     void.
   - Field extent (instance-local): about x [-80, 80], z [-20, 240] (the back
     line is capped by the 500yd instance slot spacing: local |z| must stay
     under 250), with shared ground relief (orkadiaFieldHeight: dunes, side
     berms, and a 3.2yd boss terrace); the boss dais near z 216 on the terrace
     plateau; the arrival gate near z 0-14 by `entry`/`exitOffset`.
2. **Colliders**: `INTERIOR_COLLIDERS.orkadia` stops reusing SANCTUM_COLLIDERS
   and becomes the open-field set: a perimeter enclosure (so players cannot
   walk off the field) plus circle footprints matched to the placed props
   (WYSIWYG collision). Same instance-local coordinate space as the render
   placements: one shared placement table is the source of truth.
3. **Creature animation**: the three orc GLBs keep their original meshes, rig,
   and shipped clips (attacks untouched). Only the previously synthesized
   `Death` clip is replaced by a real Tripo death retarget grafted onto the
   original skeleton; if the graft is not achievable with matching bone
   tracks, the originals stay as they were and the gap is reported.
4. **Docs and shots**: `docs/design/open-world-dungeons.md` describes this
   open-field-interior pattern; `scripts/orkadia_shots.mjs` (original,
   restored) re-captures the new field interior; `docs/prd/
   orkadia-open-world-assets.md` (kept) documents the 18 generated props.

## Invariants (unchanged)

Determinism, sim purity, module-first, i18n keys for every player string, no
em/en dashes, meshopt-only GLBs, biome on changed files, and the frozen-deeds
hash stays on its original baseline (no trigger edits in v2).
