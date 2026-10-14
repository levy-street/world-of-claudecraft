# Editor fork -> upstream v0.39.0 merge

**Worktree:** `~/Documents/woc/dryrun`  **Branch:** `merge/v0.37.0`
**Base:** `6bbfde5b48` (editor fork @ upstream cut `0f7d09d59a` = the v0.36.0 tag)
**Restore tag:** `pre-v038-merge/editor-6bbfde5b48`

## What moved

The branch is named `merge/v0.37.0` but was only merged up to the *commit* the
v0.37 release branch pointed at when it was cut, which was `v0.36.0` itself.
The v0.37.0 tag has since gained 384 real commits. This merge walks the whole
chain stepwise:

| Step | Commits | Conflicts |
|---|---|---|
| v0.37.0 | 384 | 11 files |
| v0.37.1 | 4 | none |
| v0.38.0 | 603 | 3 files |
| v0.38.1 / .2 / .3 / .4 | 32 | none |

`git merge-base --is-ancestor v0.38.4 HEAD` now passes.

## How the conflicts were resolved

Upstream-wins on shared files, fork declarations re-applied, the policy from
the v0.35 merge, unchanged.

**Upstream outright (7, all in the v0.37.0 step).** `manifest.generated.ts`,
the four Eastbrook polish provenance artefacts, and the two conflicted polish
tests.

**Both sides kept (additive on both).**

| File | Fork keeps | Upstream brings |
|---|---|---|
| `assets/loader.ts` | the `acquireTexture` doc contract on `loadTexture` | `releaseHdr` |
| `renderer.ts` | `zoneAllowedByResidencyFilter` (zone isolate), decal + editor-skybox dispose, the dungeon layout override, `blankPresentation` | `evictFarZoneIfConstrained`, `blobShadows.dispose`, `startInteriorEncounterPrewarm`, `questObjectHidden` |
| `water.ts` | the underside re-seat in `setLevel` | the refit-entry shape and `unloadZone` |
| `vite.config.ts` | the collision-overrides emit plugin | the vitest fs-module-cache switch |
| `sim/types.ts` | `TreeParams` import | `RespawnWindow` import |
| `ui/minimap_markers.ts` | `'infernalAbyss'`, and `activeZoneAt` for the zone label | `'rift'`, the per-frame marker resets |

`water.ts` was the only one that was not a straight both-sides keep: upstream
changed `refits` from `Array<() => void>` to `Array<{mesh, refit}>` and added
`unloadZone`, so the fork's re-seat had to be rebuilt on upstream's shape.

## Two fork declarations upstream-wins had silently deleted

Both are the trap the v0.35 merge documented: **typecheck finds these, runtime
silence does not.** Neither was a conflict, each side's file merged cleanly
and the fork's code simply stopped resolving.

1. **`render/textures.ts` `stoneMaps()`.** Upstream deleted it when the shipped
   world stopped using it. `rock_gen.ts`, the Rock Generator, a fork-only file
, is its only caller. Restored verbatim under a `FORK DECLARATION` banner so
   the next merge sees why it is there. It stays a lazily-called function: this
   file shares one LCG across every generator, so drawing at module scope would
   shift the look of everything generated after it.

2. **`render/dungeon.ts` keyed-build fire-light tracking.** Upstream narrowed
   the constructor's `fireLights` to an append-only `FireLightSink`, which
   cannot express the release the world editor's live interior rebuild needs.
   The sink stays the JOIN path (lights are still hidden and ranked on the way
   in); the raw registry and a rank-dirty hook are now passed alongside it and
   used only to snapshot and prune, through upstream's own `pruneFireLights`.
   `battleground.ts` already takes the raw registry for exactly this reason.

## Setup after pulling this branch

`pnpm install --frozen-lockfile` is **not optional**: upstream moved `three`
0.165.0 -> 0.185.1 with a new `patches/three@0.185.1.patch`. Skipping it leaves
`THREE.Timer` and the KTX2 `astcHDRSupported` type errors, and, because vite
caches optimized deps, a dev server started before the install will throw
`Pinned UnrealBloom composite shader shape changed` at renderer construction.
**Clear `node_modules/.vite` and restart the dev server after installing.**

## The black-ground bug this merge was asked to fix

**An authored map streamed in with ZERO ground chunks.** The ground was not
dark, it was *absent*, the editor drew sky and props over a void.

`buildTerrain`'s cell-ownership pass answered with a SHIPPED zone id
(`ZONES[owningRectIndex(...)].id`) while the caller passed one of the ACTIVE
world's zones, whose ids are the map's own. The equality in `zoneCells()` could
never hold, so every authored zone owned no cells and built no chunks.

All four zone-shaped decisions in `buildTerrain` now read `activeZoneList()`:
cell ownership, the inter-zone ridge-wall LOD promotion, the zone rectangles,
and hub-distance LOD. `zoneRects` also switches to `zoneXBounds()`, so a zone
with no explicit x-range spans the MAP rect on an authored world instead of the
shipped strip.

The built-in path is unchanged **by construction**: `activeZoneList()` returns
the `ZONES` reference itself for the shipped world (identity check), and
`zoneXBounds()` reduces to `zone.xMin ?? STRIP_MIN_X` there.

Measured, new flat map: **0 terrain chunks -> 225**. Shipped overworld
unchanged at **387 chunks / 9 prepared zones**.

## Measured

| | pre-merge `6bbfde5b48` | post-merge |
|---|---|---|
| `src/` typecheck | 25 | **25** (all still in the retired battleground mode) |
| Client build | passes | **passes** (2231 hashed media assets) |
| Eastbrook polish suites | pass | **pass** (29) after the documented re-mint |

The polish composite fingerprint moved because re-applying the fork's hooks to
`renderer.ts` moves the `rendererIntegration` leaf, the documented trigger.
`remint_polish_provenance.mjs` was run and its three literals pasted;
`ACCEPTED_POLISH_V2_TOWN_SOURCE_FINGERPRINT` is untouched. Taking upstream's
`manifest.generated.ts` again dropped the 667 media entries for the fork's own
GLBs; re-minted with `scripts/build_media_manifest.mjs`.

## Still outstanding

1. **The chunk GRID is still sized to the built-in world box.** The residency
   fix above makes an authored map's zones own cells, but the grid itself still
   spans `+-WORLD_MAX_X` / `WORLD_MIN_Z..WORLD_MAX_Z`, so a map wider than the
   shipped strip has unmeshed margins, and the editor allows sides up to
   `NEW_MAP_MAX_SIDE = 2000`. Pinned red by
   `tests/terrain_streaming.test.ts` *"a custom world larger than the built-in
   footprint builds its margins"*, which fails identically before and after
   this merge. Fixing it means deriving the grid bounds from the active world
   AND expanding the macro normal texture's world mapping with it
   (`terrainNormalTexture`, `normalTexelsOver`).
2. **`tests/zone_streaming.test.ts` is a dead fork test.** It imports
   `effectiveStreamingZones` / `fogFarForPreparedZones` /
   `UNPREPARED_ZONE_FOG_GUARD`, which exist neither in the fork's
   `zone_streaming.ts` (byte-identical to v0.38.4) nor upstream's. The
   functionality moved into terrain.ts's residency lane at v0.35. Delete or
   rewrite it; it is 5 of the 9 red terrain/streaming tests.
3. **Editor terrain paint still does not reach the mesher.** Unchanged from
   v0.35/v0.37: `grep biomePaint src/render/terrain_chunk_build.ts` returns
   nothing, and `refreshCustomGroundTextures` / `rebakePaintFieldSwatches` are
   still inert, so a painted swatch has no effect on the 3D ground.
   `usesPlainTerrainMaterial` in `sim/map_presentation.ts` is exported and
   never called. STUDIO-ROADMAP.md item 6 is the design for closing this.
4. **Cave-shell pass-under colliders**, **the retired battleground editor mode**
   (all 25 src type errors), **sandworm brood placement**, **placed-asset stream
   priority**, all carried unchanged from `MERGE-v0.37-STATUS.md`.

---

# The v0.39.0 step

**Merged from the RELEASE BRANCH, not a tag.** `v0.39.0` is not tagged yet and
`origin/main` is still v0.38.4, but `origin/release/v0.39.0` carried 214 real
commits (1,237 files) and `package.json` there already says `0.39.0`. Re-merge
at the tag when it lands; expect it to be close to a no-op if nothing else moves.

Restore tag: `pre-v039-merge/editor-270688c112`.

**71 conflicts, 60 of them noise.** The READMEs and their 20 translations, the
Fenbridge town GLBs and their AI-review receipts, the Eastbrook polish
artefacts, the android/ios project files, the version strings in
`index.html` / `play.html` / `package.json`, and the generated artifacts , 
`asset_catalog.generated.ts` and `manifest.generated.ts` were **regenerated
from their own scripts** afterwards rather than picked from a side, which is
the only correct resolution for a generated file that both sides changed.

## The eleven that needed thought

| File | Resolution |
|---|---|
| `sim/world.ts` | Upstream added `dawnholdLift` + `bulwarkLift` to `groundHeight`'s terrain sum and simplified the return, in the same function that holds the fork's entire editor floor layer (placement ramp decks, `collider/plane` volumes including the tilted-ramp basis inversion) and the cave-sheet block. Upstream's two lifts folded into the sum; the fork's body kept. |
| `render/assets/loader.ts` | See below. |
| `render/delve_interiors.ts` | Upstream now RETURNS the built group so a z-stacked slot can retire a stale one. Taken, with the fork's shared `delveModuleRenderSpec` passed straight through instead of upstream's re-derived `layout`/`variant`, so `colliders.ts` keeps deriving collision from the same record the renderer draws. |
| `sim/delves/runs.ts` | Upstream extracted `delveHasLiveMobs` and `tryOpenDelveExitPortal`; the fork's Restless-Graves pending guard moved inside the new function, after the live-mob check. |
| `sim/rift/authored.ts` | Upstream's new `ledges` parameter taken; the return stays the fork's narrower `LayoutCollider[]` (`colliders.ts layoutColliders` is typed on it, and every emitted shape, wall OBBs, decor circles, upstream's ledge shelves, is a member). |
| `sim/types.ts` | Upstream's `'dawnhold'` interior beside the fork's `'infernal_abyss'`. |
| `sim/data.ts` | Both item imports (`DUNGEON_KEEPSAKE_ITEMS` + the fork's `SCORCHING_ITEMS`). Needs `biome check --write` afterwards: the merge leaves the import block unsorted. |

## Upstream deleted its HDR loader, and the editor still needs one

v0.39's `loader.ts` header states it outright: *"There is deliberately no
Radiance (.hdr) arm"*, the biome skies ship as KTX2 UASTC HDR now and come
through `loadKtx2Texture`. `loadHdr`, `releaseHdr`, the decode queue and
`src/render/assets/hdr_decode_worker.ts` are all gone, and nothing else in
v0.39 defines them.

The fork still needs one: the editor's **Skybox picker takes a maker's own
`.hdr`**, which is whatever file they hand us, not a pipeline artefact. So
`loadHdr` is re-declared as a small FORK arm, `HDRLoader` (`RGBELoader` is
deprecated in three 0.185 and warns at runtime), one promise cache, failure
eviction, and deliberately **none** of upstream's deleted machinery: no decode
worker (the editor loads one sky on demand instead of streaming them per
zone), no PMREM downscale, no retry queue. `hdr_decode_worker.ts` stays
deleted. If a future upstream ships an HDR path again, delete the fork arm and
use theirs.

The fork's `acquireTexture` refcounting sits beside upstream's new
`ktx2CacheKey` in the same file; `texPinned` / `texRefs` survived the automerge
untouched.

## Measured at v0.39.0

| | v0.38.4 | v0.39.0 |
|---|---|---|
| `src/` typecheck | 25 | **25** (all still in the retired battleground mode) |
| Client build | passes (2231 media) | **passes** (2273 media) |
| Eastbrook polish suites | pass | **pass** (29) after the documented re-mint |
| Shipped overworld in the editor | 387 chunks / 9 zones | **387 chunks / 9 zones** |
| New flat map (the fixed path) | 225 chunks | **225 chunks** |

Only `runtimeRender.renderer.sha256` moved in the polish fingerprint, the
documented trigger, so the re-mint was legitimate again.
