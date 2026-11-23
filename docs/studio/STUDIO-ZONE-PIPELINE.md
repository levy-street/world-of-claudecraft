# Studio → Game: the zone pipeline

How a map authored in ClaudeCraft Studio becomes a real part of the shipped
world, in the right place, for both the client and the authoritative server.

Written 2026-08-11 against `merge/v0.35.1`.

---

## 1. What already exists

Four separate roads from the editor to the game, none of which is the one we
want:

| Path | Emits | Boots as | Reaches the server? |
|---|---|---|---|
| **Playtest handoff** | in-memory `WorldContent` | `startOffline` | no |
| **Publish to Game** (`src/editor/map_publish_core.ts`) | `data/maps/<slug>.map.json` + `src/sim/maps/<slug>.generated.ts` | `/index.html?map=<slug>` → `startOffline` | no |
| **Authored region** (`src/sim/regions/authored_region.ts`) | `<name>.authored.generated.ts` | mounted by a game mode at a fixed origin | yes, but only for regions (Ravenrift), and kit assets only |
| **Link to World** (`map_doc.ts worldAnchor`) | nothing, a *projection* | playtest only | no |

Two of those are already 80% of the geometry problem and are worth naming
precisely, because the plan reuses both rather than replacing them.

### `linkedWorldContent`, the embed projection

`src/editor/custom_map.ts:518`. When a map carries a `worldAnchor`, the editor
projects it **into the full built-in world** at that offset instead of booting
a standalone slate. It already offsets and merges: placements, camps, NPCs,
ground objects, roads, terrain edits, blockers, caves, holes, collider volumes,
fluids, biome paint, locations, lights, point sounds, decals and music areas.
It also sets `WorldContent.linkedMap`, which makes `world.ts terrainHeight`
**replace the overworld heightfield inside the rect**, edge-blended, with
open-sea fatigue disabled so a map can sit past the shipped coast.

This is the correct semantics. Its two limits:

- **It is additive.** Nothing in the world's own footprint is removed, so the
  maker's district lands *on top of* the existing buildings, dressing, trees
  and gather nodes in that rect.
- **It never leaves the editor.** It runs inside `customMapToWorldContent`,
  which only the playtest and export paths call.

### Zone Isolate, the rect predicates

The isolate work (`src/editor/zone_isolate_core.ts`, plus renderer/foliage
hooks) already built every spatial predicate this pipeline needs, in the
*include* direction:

- `propsWithinRect(props, rect)`, shape-agnostic filter over the props bag
- `isZoneFeatureInRect(footprint, rect)`, the renderer's zone-feature cull
- `setFoliageBounds(rect)`, procedural foliage generation clamped to a rect
- `setZoneResidencyFilter(rect)`, terrain zone residency
- `placementsToRenderAssets({ zoneRect })`

The pipeline needs their **complement** (`…OutsideRect`). That is a small,
mechanical addition to code that already exists and is already tested.

### The zone content boundary, the real find

`src/sim/data.ts:622` composes the world's hand-authored dressing from
**per-zone modules**:

```ts
export const PROPS: ZonePropsDef = mergeProps([
  ZONE1_PROPS, ZONE2_PROPS, ZONE3_PROPS, TEMPLE_PROPS, REALM_PROPS,
  DRAKELANDS_PROPS, FROSTVEIL_PROPS, AMBERFALL_PROPS, WILLOWFEN_PROPS,
  NIGHTBLOOM_PROPS, WRAITHWOOD_PROPS, PALMREACH_PROPS, EVERGARDEN_PROPS,
  GALECREST_PROPS, FARSHORE_PROPS,
]);
```

Each lives in `src/sim/content/<zone>.ts` and exports the same family:
`<Z>_ZONE` (the `ZoneDef` rect), `_PROPS`, `_CAMPS`, `_NPCS`, `_OBJECTS`,
`_ROADS`, alongside gameplay data, `_MOBS`, `_QUESTS`, `_ITEMS`, `_ESCORTS`.

So the world is **already partitioned by zone at the source level**, even
though it flattens into one bag at runtime. Zone replacement does not need a
new architecture; it needs a generator that writes one zone's spatial half.

### Why the server matters

`server/fishing_telemetry.ts:42` states the rule: *the authoritative server
runs `BUILTIN_WORLD`* and never calls `setActiveWorldContent`. Every published
map today boots through `startOffline`. **Anything that does not land in
`BUILTIN_WORLD`'s own module graph is single-player decoration.** That single
fact is what rules out the `?map=<slug>` shape as the shipping target and
rules in a generated module that `src/sim/data.ts` imports.

---

## 2. The design

Three stages. Each is independently useful and shippable; stage 1 is the fast
dev loop, stage 2 is the real pipeline, stage 3 is polish.

### Stage 1, Zone Overlay boot (the dev loop)

*"Replace the zone I'm working on with my version, right now, and go play it."*

Client-only, offline, no repo writes. Boot the normal built-in world, then
apply one published map as a patch over a rect:

```
/index.html?zone=frostveil&map=frostveil_v2
```

Implementation:

- New `src/sim/world_patch.ts`: `applyZonePatch(base, patch, rect)`, pure,
  testable. Subtracts the base world inside `rect` (props, camps, npcs,
  objects, roads, gather nodes) using the `…OutsideRect` complements, then
  unions the patch's offset layers in, and appends the patch's `linkedMap`
  entry so terrain follows.
- `WorldContent.linkedMap` becomes `linkedMaps: LinkedMapRegion[]`. It is one
  optional rect today; two published zones must be able to coexist. Keep a
  reader that accepts the old singular shape so stored docs still parse.
- `src/main.ts` gains a third boot branch next to `editorPlaytest` and
  `publishedMap`.

Cost: the patch function and the rect complements. Nothing else moves.

### Stage 2, Publish to Zone (the real pipeline)

*"Commit my zone into the world so the game, and the server, ship it."*

The maker opens the zone in Studio (Zone Isolate already gives them exactly
that view), edits, and publishes to the zone rather than to a side-car world.

**Emit one generated module per zone**, a sibling of the hand-written one:

```
src/sim/content/<zone>.authored.generated.ts
```

exporting only the **spatial** half:

```ts
export const FROSTVEIL_AUTHORED = {
  rect:        { minX, maxX, minZ, maxZ },
  props:       { … },          // ZonePropsDef
  placements:  [ … ],          // PlacedAsset[], world coordinates
  objects:     [ … ],
  camps:       [ … ],          // positions only; templates stay hand-written
  roads:       [ … ],
  terrainEdits:[ … ],
  terrain:     { … },          // the linkedMap region entry
  lights, pointSounds, decals, biomePaint, colliderVolumes, fluids, blockers,
  assetCollision,              // vendored, exactly as Publish to Game does
  suppress:    { decorations: true, grass: true, props: true },
} as const;
```

and the hand-written `src/sim/content/<zone>.ts` re-exports through it:

```ts
export const FROSTVEIL_PROPS = FROSTVEIL_AUTHORED?.props ?? LEGACY_FROSTVEIL_PROPS;
```

**The split is the whole trick.** The zone module carries both spatial dressing
*and* gameplay data, mobs, quests, items, escorts, dialogue. The editor
authors the spatial half only, so the generator must never write the other
half. Camps are the seam that needs care: the editor owns a camp's *position*,
the content module owns its *template*. Generate positions keyed by camp id and
merge; never regenerate a `CampDef` wholesale.

**Why a sibling module, not an in-place rewrite:** the hand-written file stays
diffable and reviewable, upstream merges of that file keep working, and
deleting the generated file restores the shipped zone exactly, the same
"publishing is strictly additive, deleting the file *is* the restore" property
Publish to Game already has.

**Procedural suppression is the part with no existing primitive.** Trees, rocks
and grass are generated world-wide from the seed by `world.ts
generateDecorations` / `generateDecorationsInBounds` and `render/foliage.ts`.
`decorationsMode: 'empty'` is map-wide and `decorationExclusions` is per-key;
neither is rect-scoped. Add `WorldContent.decorationSuppressRects` and gate all
three scatters on it, the same three call sites that were already fixed
together when `decorationsMode: 'empty'` was found to be honoured by only one
of them. Getting this wrong in only the render half leaves invisible trees you
still collide with, because the collider field reads
`generateDecorationsInBounds` too.

**Server parity is then free**, because `src/sim/data.ts` imports the generated
module and both halves build from the same bytes.

### Stage 3, Round trip and guards

- **Open a shipped zone in Studio.** `editor/shipped_maps.ts` already opens
  regions this way. Extend it to build a `CustomMap` from
  `<zone>.authored.generated.ts` (or, first time, from the legacy consts) with
  `worldAnchor` pre-set to the zone rect, so re-publishing is idempotent.
- **Byte stability**, as Publish to Game already guarantees: publish twice with
  no edits ⇒ identical files, verified by `shasum` in a test.
- **A zone-boundary test.** The rect must sit on the `ZoneDef` rect, and no
  emitted placement may fall outside it. A district that bleeds into the
  neighbour silently double-dresses that zone.
- **Remove from Zone**, mirroring Remove from Game: delete the generated
  module, regenerate nothing, zone is shipped-original again.

---

## 3. Order of work

| # | Work | Depends on |
|---|---|---|
| 1 | `…OutsideRect` complements in `zone_isolate_core` + foliage/renderer |, |
| 2 | `linkedMap` → `linkedMaps[]` (with legacy reader) |, |
| 3 | `world_patch.ts applyZonePatch` + tests | 1, 2 |
| 4 | `?zone=&map=` boot branch, **stage 1 usable here** | 3 |
| 5 | `decorationSuppressRects` gating all three scatters |, |
| 6 | Zone publish emitter + `/__studio_zone/publish` endpoint | 3, 5 |
| 7 | `<zone>.ts` re-export seam for all 15 zones | 6 |
| 8 | Open-shipped-zone round trip + byte-stability + boundary tests | 6, 7 |

Stage 1 lands at step 4 and is worth having on its own: it is the loop that
makes stage 2 cheap to build, because every subtraction rule gets proven in the
client before any of it is committed to repo bytes.

---

## 4. Traps, recorded up front

- **The server runs `BUILTIN_WORLD`.** Any design that stops at `startOffline`
  is single-player.
- **Three scatters, not one.** `sim/ground_dressing.ts`, `sim/world.ts`
  (`generateDecorations` + `generateDecorationsInBounds`) and
  `render/foliage.ts generateDressing` each decide independently whether to
  emit. Suppressing the render half alone leaves invisible colliders.
- **`props` is world-coordinate and uncullable at runtime.** It flattens at
  `mergeProps`; the zone identity only exists at the source level. Subtraction
  must be by rect, at the content layer, before the engine builds.
- **Camps carry gameplay.** Generate positions, merge by id; never overwrite a
  `CampDef`.
- **Placement collision is stamped at placement time.** A published zone must
  vendor `assetCollision` for every placed path, exactly as
  `vendorPublishedAssetCollision` does, or a later global re-bake drifts the
  zone away from what its maker playtested.
- **`linkedMap` is singular today.** Two published zones cannot coexist until
  it is a list.
