# Editor fork → upstream v0.35.0 merge

**Worktree:** `~/Documents/woc/dryrun`  **Branch:** `merge/v0.35.0`
**Base:** `2c9959cc89` (editor fork @ upstream cut `a3e5e9596`)
**Restore tag:** `pre-v035-merge/editor-2c9959cc89`

## Decisions (from user, 2026-08-09)
- Keep **all** fork content (Ravenrift, Thornhollow, Scorching Wastes, Infernal
  Abyss, Emberwake/Sandworm bosses, caves, fluid pools) **plus** editor tools.
- **Upstream graphics/perf win** wherever fork and upstream overlap.
- Merge **stepwise**: v0.33.1 → v0.34.0 → v0.35.0.
- Goldcrest port: bring over **only** the Goldcrest zone; leave the rest of the
  official map exactly as v0.35 ships it.

## Scope
| | |
|---|---|
| Gap base → v0.35.0 | 3,073 commits / 7,609 files / ~1.01M insertions |
| Direct-merge conflicts (measured) | 457 files |
| Step 1 (v0.33.1) conflicts | 338 files / 856 hunks |

## Refined policy (user, 2026-08-09)
> "all of the graphics water and map settings should be from the main game as we
> are trying to use this editor to work on the main game with the goal of this
> editor shipping maps quickly and with no conflicts to the main game"

**Rule: any file that exists upstream takes upstream's version.** The fork keeps
only (a) its own additive files and (b) declarations for its own features that
happen to live in shared files.

### The trap this rule creates
Blanket `--theirs` on a *shared* file silently deletes fork-feature declarations
that live inside it. Confirmed instances, all needing fork lines re-added on top
of upstream's version:

| File | Fork declarations lost | Symptom |
|---|---|---|
| `src/render/renderer.ts` | 8 editor hook methods | 43 errors in `src/editor/3d/viewport.ts` |
| `src/sim/sim_context.ts` | `bgQueue`, `bgMatches` | 37 errors in `src/sim/social/battleground.ts` |
| `src/sim/types.ts` (PlayerMeta) | `bgRating` | 7 errors |
| `src/world_api` | `BgMatchInfo` | 4 errors |

Editor hooks to re-add to upstream's `Renderer`:
`setRaycasterFromCamera` (16 call sites), `setEditorSkybox`, `setEditorOrthographic`,
`setPlacedAssetViewDistance`, `setEditorVisibility`, `setEditorStudio`,
`setEditorLighting`, `setBirdsConfig`.

## ALL THREE UPSTREAM MERGES COMPLETE, now at v0.35.0

| Step | Tag | Commit | Conflicts | Note |
|---|---|---|---|---|
| 1 | v0.33.1 | `53679c246b` | 338 | union-merge lesson learned |
| 2 | v0.34.0 | `3f57876293` | 27 | pnpm@10.34.5 adopted |
| 3 | v0.35.0 | `e2eca745ed` | 106 | battleground absorbed upstream |

Conflicts collapsed 338 → 27 → 106 because the upstream-wins policy removed
divergence as it went. Package manager is now **pnpm**; `pnpm install` +
`pnpm run i18n:build` + `pnpm run i18n:admin` are the setup steps.

### Upstream absorbed the fork's battleground
v0.35 ships this fork's battleground work as **"Thornhollow Fields"** , 
`scripts/assets/ravenrift_blueprint.mjs`, `sim/battleground_field.ts` (real
sculpted heightfield, unlike every other far-east band), `pvp_tabs_view`,
`arena_window`. The fork's parallel Ravenrift implementation was dropped in
favour of upstream's. This alone cleared the ~120 battleground type errors that
step 1 had left behind.

Hoarfrost: **Hoarfrost Vigil** (staff weapon skin + VFX) is already upstream in
v0.35, GLB, UI art, armory webp, `weapon_vfx.ts`, `weapon_vfx_tuning.ts`.
Nothing to import. Separately, `hoarfrost_scale` (a Frostveil crafting material
from the fork's Frostveil rebuild) is orphaned along with the other 43 Frostveil
item keys; restoring it means restoring that whole set.

## INTEGRATION PASS, 2026-08-09

Type errors: **457 → 258**. `src/` + `server/` went **196 → 25**, and all 25
that remain are inside the retired battleground-editor mode (below). Everything
else in `src/` and `server/` typechecks clean.

**The editor boots and renders the official v0.35 overworld.** Verified live on
`npx vite --port 5260` → `/editor.html`, opening `createShippedMap('overworld')`
(1500 placements, 0 terrain edits, no paint layer): Eastbrook Vale draws with
v0.35's terrain splat, foliage, water, day/night grade and fog at 100 to 200 fps.
Terrain sculpt and asset placement were smoke-tested on it and flow through the
document → renderer path.

### Verifying it yourself, and the one trap
Serve it, open `/editor.html`, and it boots into the last document. To land on a
specific map: load it, `editor.io.draftSave(editor.map)`, put its id in
`sessionStorage['woc_editor_playtest_resume']`, then reload.

**Trap:** in a background/hidden tab neither `requestAnimationFrame` nor
`requestIdleCallback` fires, so zone streaming stalls. With few zones resident
the residency clamp pins fog to `MIN_OUTDOOR_FOG_FAR` (45 yd) and the whole
scene reads as flat silhouettes against a white wall, which looks exactly like
broken lighting and is not. Check `renderer.scene.fog.far` and
`renderer.preparedZones` before chasing it; `setEditorVisibility({distance:900,
haze:0.25})` opens it back up. Drive frames manually with
`for (let i=0;i<25;i++) viewport3d.loop()`.

### Why the render matches the game, precisely
`src/render/renderer.ts` is upstream v0.35's renderer with **additive** editor
hooks. Its only removals against `v0.35.0` are one widened import line and the
three-line `buildInterior` call (now layout-override aware), verify with
`git diff v0.35.0 -- src/render/renderer.ts | grep '^-[^-]'`.

Of the 40 `src/render/` files that differ from `v0.35.0`, **22 are new fork-only
files** (inert unless a map uses them). The rest are additive, except four
behaviour-preserving parameter additions: `buildGardenFeatures`,
`buildHauntFeatures`, `buildRealmFlora` gained `renderGreatTrees = true`, so the
default (game) path is unchanged.

### What this pass restored
- **16 editor hooks on `Renderer`**, `setRaycasterFromCamera`,
  `setEditorLighting/Skybox/Studio/Visibility/Orthographic/Weather`,
  `setPlacedAssetViewDistance`, `setBirdsConfig`, `setAmbienceScale`,
  `setDungeonLayoutOverride`, `refreshEditorAtmosphere`, `rebuildDecals/Fluids/
  Grass/BattlegroundViews`, plus `applyZoneAtmosphere`, `setWaterVisible`,
  `invalidateShadows` and the editor shadow cache.
- **Fork scene layers re-wired into the renderer**: cave tubes, fluid pools,
  ground decals, cloud layer, built in the ctor, updated per frame, disposed.
- **Lost fork exports on shared files**, each re-added on top of upstream's
  version: `acquireTexture` (loader), `LayoutCollider` + `baseY` + `passesUnder`
  (colliders), `ALL_BIOME_IDS` + `paintedCellIdAt` + `decorationKey` +
  `reachPalmRenderedHeight` (world), `PointSoundSource` + optional
  `pointSounds()` (audio_sink), `fluidBubble/fluidSmoke/fluidHeat` (vfx),
  `FoliageView.rebuildGrass` (foliage), `MUSIC_ZONES` + `MusicDirector.close`
  (music), `GameAudio.close` (audio), `Sim.removeEntity`,
  `DungeonInteriors.disposeInterior` + `captureDungeonPlacementRecords` +
  `dungeonTorchLightColor`, `INFERNAL_ABYSS_LAYOUT` + `DungeonLayout.barriers`
  / `visualOpenings`.
- **Audio the same policy dropped**: `sfx.pointSounds()` (the editor's Sound
  tool, upstream kept every loop internal, only the ~20-line method was gone;
  `loop()` gained an optional `refDistance` so a maker's radius drives BOTH ends
  of the falloff), Goldcrest Harbor's music zone (`town_goldcrest`, whose two
  mp3s were still on disk), and multi-track zone pools (`ZONE_STREAM_POOLS`,
  `zoneStreamUrls`, `pickStreamTrackIndex`, `releaseStream`).
- **Four merge artifacts fixed**: a duplicated `riftState` arm in the `SimEvent`
  union (the copy without `expiresAtMs`); a duplicated import block in
  `src/ui/minimap_markers.ts`; a union-merged zone list in
  `tests/music_tracks.test.ts` that concatenated both sides (11 realms twice);
  and a `tests/music.test.ts` body that gained a rift block while its import
  list took upstream's. **These are the signature of the step-1 union merge , 
  expect more of them in the 229 remaining test-file errors.**
- **`Sim` no longer hard-crashes on a stale map**: a camp naming a mob this
  build does not ship is skipped with a warning instead of throwing, so the
  editor can OPEN an old document to fix it.

### Retired: the Ravenrift segment-based battleground editor
v0.35 replaced the fork's segment layout (`BgLayoutRecord`, `BgWallSeg`,
`applyBgLayoutOverride`, `refreshBattlegroundColliders`) with an **authored map**
, `data/battleground/thornhollow.map.json` → `sim/thornhollow_field.generated.ts`.
Walls and cover are ordinary placements with baked collision. The field is now
edited as a normal authored map, which is what the fork was heading toward.

So: `src/editor/shipped_maps.ts`'s `ravenrift` entry and its field adapter were
removed (the `thornhollow` entry stays), `src/guide/pages/ravenrift.ts` was
deleted as an unregistered orphan with dead i18n keys (upstream ships
`thornhollow_fields.ts`), and `BattlegroundEditorMode` is now **dynamically
imported** so its unresolved module graph cannot take the editor down at boot , 
opening the panel toasts that the mode is unavailable.

The 25 remaining src errors all live in that dead mode:
`editor/battleground/{bg_draft_core,bg_layout_writer_core,battleground_mode,
bg_validate_core}.ts`, `editor/regions/region_export_core.ts`,
`sim/regions/authored_region.ts`. Reworking them onto the authored-map record , 
or deleting them, is a self-contained follow-up.

### Still outstanding
1. **Editor terrain paint on v0.35's splat shader** (the big one). v0.35 rewrote
   `src/render/terrain.ts` (DataArrayTexture splat, Ground023/Rock026, packed
   AO) and carries **no biome-paint field at all**. The fork's ~900 lines of
   paint field + 64-slot custom ground-texture atlas + cave `TerrainHole`
   cutouts need re-integrating. `MAX_CUSTOM_GROUND_TEXTURES`,
   `DEFAULT_TEXTURE_TILE_YD`, `refreshCustomGroundTextures`,
   `rebakePaintFieldSwatches` and `refreshTerrainHoles` exist and are marked
   inert with a pointer to this note. **The official overworld does not use any
   of it** (empty doc, no paint), so map work on the official world is unblocked;
   authoring a NEW painted map is not.
2. **Cave collision wiring**, `tests/cave_under_terrain_movement.test.ts` has 5
   failures, present both before and after this pass: the fork's cave collider
   registration in `src/sim/colliders.ts` went with upstream-wins. `baseY` and
   `passesUnder` are back, but nothing emits cave-shell colliders yet.
3. **Sandworm brood placement**, v0.35's `spawnBossAdds` takes no placement
   options, so The Dunefather's brood spawns on the default ring instead of the
   fanned arc (arc math kept in `encounters/sandworm.ts`).
4. **Placed-asset stream priority**, v0.35's `loadGltf` has no priority hook;
   template streaming now rides submission order.
5. **Infernal Abyss surfaces**, upstream-wins also took `paintInfernalAbyss`
   out of `src/ui/minimap_painter.ts` (the file now resolves colours twice, not
   three times). Same family as the four failing `infernal_abyss_*` tests and
   the restored `INFERNAL_ABYSS_LAYOUT`; restoring the painter arm finishes it.
6. **Tests**, 229 test-file type errors left to triage.

## Suite baseline, measured, not assumed

| | pre-integration `e2eca745ed` | after `f8e44501f9` |
|---|---|---|
| Test files | 173 failed / 2247 passed | 126 failed / 2294 passed |
| Tests | 502 failed / 31583 passed | **344 failed / 32226 passed** |

**485 more tests now run**, several files could not even be *collected* before
(they report `(0 test)` at baseline) and now load and execute. Every one of the
8 files that newly appear in the failing set was checked individually:

| File | Cause |
|---|---|
| `dragonkin_whelp_litter`, `physics_audit_zonewalls` | pass in isolation, parallel-run interference |
| `minimap_capture_geometry` | `MINIMAP_BASE_SCALE` was unexported; **fixed** |
| `minimap_painter` (2) | the missing `paintInfernalAbyss` arm, item 5 above |
| `spec_signatures`, `localization_fixes` | need `node scripts/pretest.mjs` first (that is what `npm test` runs; `npx vitest run` skips it) |
| `i18n_completeness` | the known expected-red editor-i18n gap |
| `eastbrook_polish_capture_contract` | provenance pin went stale on the `rendererIntegration` leaf; **re-minted** |

**Run the suite as `npm test`, not `npx vitest run`**, the pretest step
generates `src/ui/i18n.status.json` and the wiki content several tests read.

### The provenance pin will go stale again
Any edit to `src/render/renderer.ts` moves the Eastbrook polish
`rendererIntegration` leaf. When
`tests/eastbrook_polish_capture_contract.test.ts` reports "every fingerprinted
input matches HEAD", the re-mint is legitimate:

```
node scripts/assets/eastbrook_grand_armoury/remint_polish_provenance.mjs
```

then paste its three literals into `PINNED_POLISH_COMPOSITE_FINGERPRINT`,
`ACCEPTED_POLISH_V2_METADATA_SHA256`, and the second-order performance digest.
Do NOT touch `ACCEPTED_POLISH_V2_TOWN_SOURCE_FINGERPRINT`. That run also
regenerated `src/render/assets/manifest.generated.ts`, adding 634 missing media
entries for the fork's own GLBs (dragon boss, sandworm, infernal abyss), they
would have 404'd in a production build.

## SUPERSEDED, original remaining-work list (457 type errors)

**1. Re-add 16 editor hook methods to upstream's `Renderer` (46 errors).**
This is the one integration job that was always going to be needed:
`setRaycasterFromCamera`, `setEditorLighting`, `setEditorSkybox`,
`setEditorStudio`, `setEditorVisibility`, `setEditorOrthographic`,
`setEditorWeather`, `setPlacedAssetViewDistance`, `setBirdsConfig`,
`setAmbienceScale`, `setDungeonLayoutOverride`, `refreshEditorAtmosphere`,
`rebuildDecals`, `rebuildFluids`, `rebuildGrass`, `rebuildBattlegroundViews`.
Source them from the pre-merge fork renderer:
`git show pre-v035-merge/editor-2c9959cc89:src/render/renderer.ts`

**2. Fork surfaces needing rename/rework after the Thornhollow rename:**
`src/guide/pages/ravenrift.ts` (15), `src/editor/shipped_maps.ts` (11)

**3. Fork content still referencing changed APIs:**
`src/ui/infernal_abyss_map.ts` (14), `src/ui/minimap_markers.ts` (12)

**4. Tests (261)**, triage after src is green.

## Step 1 detail, v0.33.1 (MERGED, committed `53679c246b`)
Typecheck progression: syntax-clean → **2323** errors → i18n regen → **791**
(257 in `src/`+`server/`, 534 in `tests/`).

Union merge proved **too blunt for test files**, concatenating both sides broke
brace balance in 17 tests + `i18n.catalog/items.ts`. All were restored from
upstream. Do NOT union-merge tests in steps 2 and 3; take upstream directly.

## Step 1 detail, v0.33.1 (338 → 0 conflicts)
Resolved so far:
- 12 binary `.glb` (eastbrook_* + mailbox_pillar) → **theirs** (new graphics win)
- 45 i18n generated + 20 `docs/i18n` → **theirs**, regenerate at the end
- 55 `tests/parity/golden/*.json` → **theirs**
- 13 `docs/screenshots` → **theirs** (gitignored; needed `git add -f`)
- 71 `tests/*.test.ts` + `i18n.catalog` → **union merge**
- 18 `src/ui/i18n.locales/*.ts` → **union merge** (translator-edited key overlays)
- 11 docs/README/DEPLOY/CREDITS → **theirs**

Verified: no resolved file contains conflict markers.

### Remaining 113, genuine source integration
`src/sim` 42 · `src/render` 22 · `src/ui` 10 · `src/game` 7 · `src/guide` 3 ·
`src/editor` 2 · tests 7 · root configs (package.json, package-lock, index.html,
play.html, docker-compose, android, ios, .github/workflows) · server 4

**Heaviest files:**
| File | Hunks | Upstream churn | Fork churn |
|---|---|---|---|
| `src/render/renderer.ts` | 80 | +4001 / −839 | +2596 / −289 |
| `src/sim/colliders.ts` | 64 | | |
| `src/sim/sim.ts` | 25 | | |
| `src/render/terrain.ts` | 25 | | |

## Key risk
`renderer.ts` was **independently rewritten by both sides**, upstream +4001/−839
against fork +2596/−289 on the same file. There is no mechanical resolution: it
needs upstream's renderer as the base with the fork's hook-points
(`buildCaveMeshes`, `Decals`, `FluidSurfaces`, `CloudLayer`, `MinimapCapture`,
`BattlegroundFx`, tree sway, skyboxes) re-applied by hand and re-verified.
`src/sim/colliders.ts` looks similar. Same file will conflict again in v0.34 and
v0.35.

## ROOT CAUSE: why the map "isn't the main game's map"

`createShippedMap('overworld')` returns `newCustomMap(...)`, an **empty
document**. Unlike `thornhollow`/`sowfield`/dungeons/delves (which bake real
placements), the overworld doc is empty *by design*: the built-in procedural
world renders underneath it. So the map you see is whatever the CODE version
draws, textures included.

The saved bundle
`<your maps folder>/woc-map-World-of-ClaudeCraft-goldcrest.json`
(34 MB) is **not** "empty overworld + Goldcrest". It carries a stale baked
snapshot of the OLD world layered on top of the live one:

| | total | in Goldcrest box | to discard |
|---|---|---|---|
| placements | 8419 | **242** | 8177 |
| terrainEdits | 1939 | **167** | 1772 |
| grassClear | 344 | **166** | 178 |
| decorationExclusions | 7132 | **0** | 7132 |
| locations | 10 | 0 | 10 |
| markers | 2 | 1 | 1 |
| lights | 6 | **6** | 0 |
| pointSounds | 6 | **6** | 0 |
| content.camps | 179 | **3** (training dummies) | 176 |
| content.roads | 64 | **1** (the causeway) | 63 |
| content.objects | 22 | 0 | 22 |
| content.zones | 15 | goldcrest_harbor only | 14 |

`propsMode: "editable-all"` is what promoted the whole world into editable
placements in the first place. Those 8177 stale placements + 7132 decoration
exclusions are what override v0.35's world and make it look wrong / untextured.

**Textures are NOT missing from the merged tree**, it is a superset:
`public/textures/terrain` 269 files / 56 MB (pre-merge 258 / 47 MB);
`public/textures` total 97 MB (pre-merge 49 MB, main game 82 MB).

NOTE: `content.npcs` is an OBJECT keyed by npc id, not an array, filter its
values, not the container. (Earlier counts that showed 0 in-box for
camps/objects/roads were a bad filter: those use `center`, `positions[]` and
raw point arrays rather than top-level x/z.)

### Correct port recipe
1. Fresh v0.35 overworld doc (`createShippedMap('overworld')`) → empty, so the
   **current** game world with all its v0.35 textures renders underneath.
2. Inject ONLY the in-box rows above.
3. Do NOT carry `decorationExclusions`, out-of-box placements/terrainEdits, or
   `propsMode: editable-all`.
4. `content.zones` no longer needs the goldcrest entry in the doc, it is
   registered in code by `src/sim/content/goldcrest.ts`.

## Goldcrest port, verified feasible
`src/sim/content/goldcrest.ts` registers zone identity only (38 lines); all
placements ride the map doc via `tmp/goldcrest/inject.ts`.
Zone box **x −540..−180, z −180..180**.
v0.35 west band tiles northward and does **not** touch it:
willowfen 180 to 700 · palmreach 700 to 1260 · nightbloom 1260 to 1820 · amberfall 1820 to 2380 ·
galecrest is x 180..540. **No collision.**
Source bundle: `<your maps folder>/woc-map-World-of-ClaudeCraft-goldcrest.json`

## Resume
```
cd ~/Documents/woc/dryrun && git status
```
Merge is left in progress (MERGE_HEAD live, partial index staged).
To abandon: `git merge --abort`.
