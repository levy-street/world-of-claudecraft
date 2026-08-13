# Cascaded shadow maps: evaluation against the single 4096 sun map

Evaluation only, no implementation. The question: replace the one un-cascaded
orthographic sun shadow map (`src/render/renderer.ts`, the `sun.shadow` setup)
with a 2-cascade CSM at 2048 per cascade, near cascade over the roughly 25 u
articulated-shadow band and far cascade over the rest of the roughly 210 u
ortho volume.

Grounded in the pinned Three release (`three` is pinned in `package.json` at
`0.165.0`) and its bundled addon `three/examples/jsm/csm/CSM.js`.

## Verdict: defer

Not reject, and not adopt now.

The memory case is real and clean: two 2048 maps are exactly half the GPU
allocation and half the shadow-target clear bandwidth of one 4096. The
texel-density case is only half real: the near cascade beats today's density at
the default field of view, but the far cascade is more than twice as coarse as
today over the mid ground, because the addon fits each cascade to a
rotation-invariant square sized by the sub-frustum's far-plane diagonal, which
at the outer split is wider than the whole 210 u box it replaces.

What blocks adoption is not the math, it is the composition cost. Three's CSM
addon is not a library you configure, it is a global patch: it overwrites
`THREE.ShaderChunk.lights_fragment_begin` and `lights_pars_begin` process-wide
with a verbatim fork of the pinned release's chunks, and it ASSIGNS
`material.onBeforeCompile` on every material it manages. This repo already
mutates `ShaderChunk.lights_fragment_begin` globally
(`installPbrPointLightShaderPruning` in `src/render/pbr_fragment_shader.ts`,
called from `initGfxTier` in `src/render/gfx.ts`), and it composes layered
`onBeforeCompile` hooks with folded program cache keys through
`src/render/material_clone_hooks.ts`. Both collide head-on. On top of that, a
CSM is N directional lights, which moves `numDirLights` and
`numDirLightShadows` in every lit program's cache key, invalidating the entire
prewarm and compile lane the renderer is built around, and it breaks the
single-ortho-volume assumption baked into `src/render/foliage_shadow_core.ts`.

The cheaper wins in the same problem space land first, and all three are on
this branch: the dial cap, the texel snap, and the budget-governed shadow
cadence (`src/render/shadow_cadence_core.ts`). Revisit CSM only if the
measurements in "What would change the verdict" come back the way CSM would
need them to.

## 1. What is actually there today

From the sun setup in `src/render/renderer.ts`:

| Property | Value |
|---|---|
| Ortho half-extent `S` | 105 (85 on the lean `!GFX.standardMaterials` arm) |
| Ortho box width | 210 u |
| `shadow.camera.near` / `.far` | 30 / 480 |
| `shadow.bias` | -0.0006 |
| `shadow.normalBias` | 0.035 (0.02 lean) |
| `shadow.radius` | 2.25 |
| `shadowMap.type` | `THREE.PCFShadowMap` |
| Map size | `GFX.shadowMap` |

`GFX.shadowMap` per profile (`src/render/gfx.ts`): 4096 high/ultra/insane, 2560
medium, 1536 medium-constrained, 2048 low and constrained, 1024 iOS memory
profile. `GFX.dynamicShadows` is false on low and on constrained memory, so
the shadow pass does not exist at all on the phone-class profiles. The advanced
Shadow Quality dial now caps at 4096 (the retired 8192 rung falls through to the
High base).

Texel snapping landed on this branch: `shadowTexelWorldSize` and
`snapShadowAnchor` in `src/render/shadow_texel_snap_core.ts`, consumed by the
renderer through a single `shadowTexelWorld` scalar and one reusable
`ShadowAnchor` scratch.

The articulated-shadow band is `ENTITY_SHADOW_RANGE_SQ` in
`src/render/renderer.ts`, set to `25 * 25`: past 25 u a rig stops casting an
articulated shadow (about seven draws) and hands off to a single-draw
static-pose proxy, which itself ends at `ENTITY_PROXY_SHADOW_RANGE_SQ`
(`62 * 62`). The band policy that scales those ranges lives in
`src/render/crowd_lod.ts` (`CHARACTER_LOD_RANGE`, `characterLodBands`).

## 2. Memory and bandwidth, exact

Assumption, verified in `node_modules/three/build/three.module.js`: Three's
`WebGLShadowMap` allocates the shadow target as
`new WebGLRenderTarget(size, size, { minFilter: NearestFilter, magFilter: NearestFilter })`
for every non-VSM type. It passes no `format`, no `type`, no `depthTexture`,
and does not disable `depthBuffer`. So the defaults apply: an **RGBA8 color
texture** (`RGBAFormat` + `UnsignedByteType` are the `Texture` constructor
defaults) plus a **depth renderbuffer** allocated at `DEPTH_COMPONENT24` (from
`getInternalDepthFormat(useStencil=false, depthType=null)`, since
`stencilBuffer` defaults false). Depth is not a float texture: the shadow depth
material is
`new MeshDepthMaterial({ depthPacking: RGBADepthPacking })`, so depth is packed
into the four 8-bit color channels and the D24 renderbuffer only serves the
depth test.

Drivers pad a `DEPTH_COMPONENT24` renderbuffer to 32 bits per pixel in
practice, so both attachments cost 4 bytes per texel:

| Configuration | Color RGBA8 | Depth D24 (padded) | Total |
|---|---|---|---|
| One 4096 x 4096 | 67,108,864 B (64 MiB) | 67,108,864 B (64 MiB) | **128 MiB** |
| Two 2048 x 2048 | 2 x 16,777,216 B (32 MiB) | 2 x 16,777,216 B (32 MiB) | **64 MiB** |
| One 8192 x 8192 (retired) | 268,435,456 B (256 MiB) | 268,435,456 B (256 MiB) | 512 MiB |

The CSM configuration is exactly **half** the resident shadow allocation, a
64 MiB saving on every 4096 profile. (The "256 MB-class" figure in the dial-cap
issue is the color half of the 8192 rung; the full attachment pair was 512 MiB.)

Per-frame bandwidth. Three's shadow pass calls `setRenderTarget` then `clear`
on each shadow map before drawing, so the clear alone touches every texel of
both attachments once per updated map, per frame. That is a hard floor,
independent of scene content:

- One 4096: 134,217,728 B per frame, **8.05 GB/s at 60 Hz**.
- Two 2048: 67,108,864 B per frame, **4.03 GB/s at 60 Hz**.

On top of the clear sit the actual depth writes, which scale with rasterized
coverage and overdraw, not with map size, so they are roughly unchanged; and
the depth-test reads, which halve with the texel count for the same reason the
clear does. Halved clear bandwidth is the honest, defensible bandwidth claim.

Sampling bandwidth does not change. Three r165's `PCFShadowMap` kernel does 17
`texture2DCompare` taps per shadowed directional light (`shadowmap_pars_fragment`,
the `SHADOWMAP_TYPE_PCF` arm, weighted `1.0 / 17.0`). The CSM fragment chunk
guards `getShadow` behind the cascade's depth interval, so a fragment samples
exactly one cascade: still 17 taps, not 34.

## 3. Texel density

World units per shadow texel. Current single map over the 210 u box:

| Map size | u per texel | cm per texel |
|---|---|---|
| 4096 | 0.051270 | 5.13 |
| 2560 | 0.082031 | 8.20 |
| 2048 | 0.102539 | 10.25 |

CSM cascade extents are not chosen by the integrator. `CSM.updateShadowBounds`
sizes each cascade's ortho box as a **square whose side is the longer of the
sub-frustum's far-plane diagonal and its near-to-far corner diagonal**. That is
deliberate (a rotation-invariant box does not resize as the camera turns), but
it means the box is driven by the camera's field of view and aspect ratio, not
by the split distance alone. The camera is `CAMERA_BASE_FOV = 60` vertical in
`src/render/renderer.ts`, live-adjusted within 50 to 100 by the camera-feel
term.

Near cascade at 2048, split ending at 25 u (the articulated band):

| Camera | Box side | u per texel | cm per texel | vs today's 5.13 cm |
|---|---|---|---|---|
| fov 60, 4:3 | 48.11 u | 0.023492 | 2.35 | 2.18x finer |
| fov 60, 16:9 | 58.88 u | 0.028751 | 2.88 | 1.78x finer |
| fov 60, 21:9 | 73.28 u | 0.035783 | 3.58 | 1.43x finer |
| fov 100, 16:9 | 121.54 u | 0.059347 | 5.93 | **0.86x, coarser** |

Far cascade at 2048, split 25 u to 105 u (matching today's reach):

| Camera | Box side | u per texel | cm per texel | vs today's 5.13 cm |
|---|---|---|---|---|
| fov 60, 16:9 | 247.30 u | 0.120754 | 12.08 | **2.36x coarser** |
| fov 60, 21:9 | 307.79 u | 0.150287 | 15.03 | **2.93x coarser** |

Reading of this: the near cascade does what the proposal claims at the default
field of view and normal aspect ratios, comfortably beating the current
near-field density and shrinking the residual shadow-swim amplitude along with
it. It stops claiming that at the top of the camera-feel field-of-view range,
where a 2048 near cascade is slightly worse than today's 4096.

The far cascade is the problem, and it is structural, not a tuning miss. At
fov 60 and 16:9 the addon's square is 247 u on a side, wider than the entire
210 u box it is meant to replace, because a diagonal-sized square around a
frustum slice wastes most of its area. Mid-ground shadows (buildings, tree
canopies, the proxy-shadow band out to 62 u) would visibly coarsen. Recovering
today's mid-ground density would need the far cascade at 4096, which erases the
whole memory argument (4096 + 2048 is 160 MiB, worse than today's 128 MiB).

A hand-rolled two-volume split that fits tight boxes instead of diagonal
squares would not have this problem. That is a different, larger piece of work
than adopting the addon, and it is the honest shape of "do this properly".

## 4. Frame-cost model

The shadow pass is a second scene draw. Two cascades mean two culled scene
draws instead of one.

### What is measured today

There is no shadow-pass timing instrumentation in the shipping client, and
nothing under `docs/perf/` records shadow cost at all (`docs/perf/baseline/`
and `docs/perf/hitch/` contain no shadow fields; `docs/perf/tbdr-analysis.md`
and `docs/perf/technique-survey.md` discuss shadows only qualitatively). The
real measurements live in the capture artifacts under `docs/screenshots/`.

Measured, Apple M4 Max, ANGLE Metal Renderer, desktop Ultra, Eastbrook town,
paired shadows-on versus shadows-off whole-scene readings
(`docs/screenshots/eastbrook-vale-rebuild/performance/before-desktop-ultra-town.json`):
801 to 824.5 calls and about 3.5 M triangles with shadows on, against 489.5 to
504.5 calls and about 2.65 M triangles with shadows off. That is roughly **311
to 322 extra draw calls and about 830 k extra triangles** for the sun shadow
pass, at a median CPU submit delta of about **0.5 to 0.55 ms**. The Eastbrook
armoury capture
(`docs/screenshots/eastbrook-grand-armoury/before-performance.json`) gives the
same shape: 532 versus 216.5 calls and 2,100,256 versus 1,263,094 triangles,
5.30 versus 3.30 ms CPU submit.

Every one of those numbers is **CPU submit and requestAnimationFrame timing,
not GPU time**. There is no measured GPU cost for the shadow pass anywhere in
this repo. Treat the memory and bandwidth figures in section 2 as arithmetic
(they are), and everything in this section about frame cost as a model.

### The model

Against the tier draw caps in `CAPS_BY_TIER` (`src/render/render_budget.ts`):
ultra targets 820 calls and treats 1,100 as urgent; high targets 620 and 860;
insane targets 900 and 1,200. The measured Ultra town figure of 801 to 824.5
calls with shadows on is already **at or over the ultra target**, which is
exactly why the governor sheds grass, foliage, vfx, and lighting there.

Now the CSM arithmetic. Three culls shadow casters per light, by frustum test
against that light's ortho box. The addon does not slice casters by split: a
caster inside the near cascade's box is also inside the far cascade's box, so
it is drawn in **both**. And the far cascade's box (247 u) is wider than
today's single box (210 u), so it draws at least as many casters as today, not
fewer. The estimate therefore runs the wrong way:

- shadow draws today: about 315 (measured, Ultra town)
- shadow draws under 2-cascade CSM: about 315 (far cascade, at least) plus the
  near-field subset drawn a second time.

Estimated, not measured. The near-field subset in a town view is where the
articulated rigs are (about seven draws per rig inside 25 u) plus the near
props, so the second cascade is not cheap. A plausible band is +80 to +200
calls on Ultra town, which pushes a scene already at the 820 target toward the
1,100 urgent threshold and makes the governor shed world density permanently.
That is a gameplay-visible cost paid for a memory win.

Two things could reclaim it, neither free:

1. Slice casters by split so each caster draws once. Three does not do this; it
   would mean a per-cascade caster pack, which is exactly the
   `packShadowCasters` machinery in `src/render/foliage_shadow_core.ts`
   generalized to N volumes.
2. Alternate cascades under cadence. Which brings up the branch's neighbor.

### Interaction with the shadow cadence work

The budget-governed half-rate shadow cadence lands on this same branch
(`src/render/shadow_cadence_core.ts`, applied from the renderer right after
the budget governor each frame): under sustained over-budget pressure the one
shadow map updates every other frame.

Its savings stack differently under CSM, and mostly in CSM's favor. With one
map, half-rate is a binary: full shadow pass or none, and the skipped frame's
shadows are one frame stale everywhere. With two maps, cadence can
**alternate cascades**: update the near cascade every frame and the far
cascade every other frame. That halves the far cascade's cost (the expensive
one, since its box is the wider) while the near band, which is where a player
actually reads shadow contact, stays fully current. Three supports this
directly, since `LightShadow` carries its own `autoUpdate` and `needsUpdate`
per light, so per-cascade cadence is a per-light flag, not new machinery.

This is the strongest genuine argument for CSM. It is also unmeasured.

## 5. Compatibility audit

This is the part that decides the verdict.

### 5a. How the addon patches, mechanically

`three/examples/jsm/csm/CSM.js` at the pinned release:

- `createLights()` constructs one `THREE.DirectionalLight` per cascade, each
  with `castShadow = true` and its own `shadow.mapSize`, `shadow.camera.near`,
  `shadow.camera.far`, `shadow.bias`, and adds each light and its target to a
  parent object.
- `injectInclude()` assigns `ShaderChunk.lights_fragment_begin =
  CSMShader.lights_fragment_begin` and `ShaderChunk.lights_pars_begin =
  CSMShader.lights_pars_begin`. This is a **global mutation of the shared
  Three chunk table**, affecting every material in the process, patched or not.
  `CSMShader.lights_fragment_begin` is a verbatim fork of the pinned release's
  chunk with the CSM directional branches spliced in;
  `CSMShader.lights_pars_begin` is a prefix concatenated onto whatever
  `ShaderChunk.lights_pars_begin` held **at addon import time**.
- `setupMaterial(material)` sets `material.defines.USE_CSM = 1` and
  `material.defines.CSM_CASCADES = cascades`, then **assigns**
  `material.onBeforeCompile = function (shader) { ... }`, unconditionally, with
  no chaining of any prior hook and no `customProgramCacheKey` handling at all.
  It must be called on every material that should receive cascaded sun light.
- `update()` refits each cascade's light position per frame and **does**
  texel-snap: `_center.x = Math.floor(_center.x / texelWidth) * texelWidth` and
  the same for `y`, in the light-orientation basis from
  `Matrix4.lookAt(origin, lightDirection, up)`. The issue's premise that the
  addon does not snap is **wrong for this release**; verified in the addon
  source.
- `updateShadowBounds()` refits the ortho extents, but it runs only from
  `updateFrustums()`, not from `update()`. A live field-of-view change
  (`CAMERA_BASE_FOV` plus the camera-feel offset moves within 50 to 100) needs
  an explicit `updateFrustums()` call, which also re-runs `getBreaks` and
  `updateUniforms`.

### 5b. The global chunk collision (blocking)

`installPbrPointLightShaderPruning` in `src/render/pbr_fragment_shader.ts`
mutates the **same global chunk** CSM overwrites:
`THREE.ShaderChunk.lights_fragment_begin`, via `patchPointLightFragmentChunk`
in `src/render/point_light_shader_core.ts`. It is invoked from `initGfxTier`
(`src/render/gfx.ts`) with the comment "install before any scene material
compiles", because the pinned point-light pad budget
(`pointLightPadCount` in `src/render/point_light_budget.ts`, and the light-pad
loop in `src/render/renderer.ts`) keeps `numPointLights` constant by adding
zero-intensity pads, and the shader guard is what makes those pads cheap.

Who wins depends on ordering, and both orders are bad:

- **Pruning first, then `injectInclude()`** (the natural order, since
  `initGfxTier` runs very early): CSM's assignment **silently discards** the
  pruning. Every lit material compiles the unpruned point-light loop and pays
  full cost for the zero-intensity pads. Nothing throws, nothing goes red:
  `tests/pbr_fragment_shader.test.ts` verifies the patch function and that
  `gfx.ts` calls it, not that the chunk survives to compile time. This is a
  silent perf regression of exactly the kind the repo installed the pruning to
  prevent.
- **`injectInclude()` first, then pruning**: `patchPointLightFragmentChunk`
  would run against CSM's fork. I verified the anchors survive it: the fork
  keeps the point-light section ahead of `#if ( NUM_SPOT_LIGHTS > 0 ) &&
  defined( RE_Direct )`, so the `pinnedAnchor` uniqueness checks for
  `getPointLightInfo(...)` and the point-light `RE_Direct(...)` still resolve
  to exactly one occurrence inside their search range, and the patch applies.
  But this arm is fragile by construction: `pinnedAnchor` throws
  `Three r165 point-light chunk ... anchor changed` and takes the whole boot
  down if the fork ever drifts, and the fork is a hand-copied snapshot of a
  version-specific chunk that no test in this repo pins.

Either way, a CSM adoption must own this ordering explicitly, with a test that
asserts the composed chunk carries **both** patches, or it ships a silent
regression.

### 5c. The per-material hook collision (blocking)

`CSM.setupMaterial` does `material.onBeforeCompile = function (shader) {...}`.
It never reads or calls a prior hook, and it never touches
`customProgramCacheKey`. This repo's layered-hook machinery is built on the
opposite contract, documented in `src/render/material_clone_hooks.ts`: three's
default `Material.customProgramCacheKey()` returns
`this.onBeforeCompile.toString()`, so a hook chain must fold both the prior
hook and the prior key or program identity breaks and clones re-link.

Every `onBeforeCompile` consumer under `src/render/`, with how CSM's assignment
interacts:

| Module | Installer symbol | Chunk tokens spliced | Chaining today | CSM interaction |
|---|---|---|---|---|
| `src/render/gfx.ts` | `addRimGlow` | `<common>`, `<lights_fragment_begin>` (via `patchPbrRimGlowFragmentShader`) | composes, folds prior source and key | **Direct conflict.** Only repo hook that touches a CSM-owned token. Splices AFTER the token so the CSM fork survives, and the fork still defines `geometryViewDir` the rim term reuses. But `setupMaterial` on a rim-glow material erases the rim entirely. Ordering-critical, and it feeds `reattachClonedMaterialHooks`. |
| `src/render/biome_haze_field.ts` | `attachBiomeHaze` | `<common>`, `<project_vertex>`, `<fog_fragment>` | composes, folds prior key or source | Erased if `setupMaterial` runs after. Also feeds `reattachClonedMaterialHooks`. |
| `src/render/worn_stone.ts` | `applySurfaceDetail` | `<common>`, `<project_vertex>`, `<color_fragment>`, `<roughnessmap_fragment>`, `<metalnessmap_fragment>`, `<normal_fragment_maps>` | composes, folds prior source | Erased if after. Third layer of the documented clone order. |
| `src/render/vertex_color_emissive.ts` | `modulateEmissiveByVertexColor` | `<emissivemap_fragment>` | composes, folds prior key | Erased if after. |
| `src/render/streetlamp_flame.ts` | `attachStreetlampFlame` | `<common>`, `<begin_vertex>`, `<emissivemap_fragment>` | composes, folds prior key | Erased if after. Uses throwing `replaceRequired` anchors. |
| `src/render/eastbrook_civic_beacon.ts` | `decorateEastbrookCivicBeaconMaterial` | `<common>`, `<beginnormal_vertex>`, `<begin_vertex>`, `<emissivemap_fragment>` | composes, folds prior key | Erased if after. Throwing anchors. |
| `src/render/canopy_detail.ts` | `applyCanopyDetail` | `<common>`, `<project_vertex>`, `<alphatest_fragment>`, `<emissivemap_fragment>`, `<normal_fragment_maps>` | composes, folds prior key | Erased if after. |
| `src/render/foliage_collapse.ts` | `applyInstanceCollapse` | `<common>`, `<uv_vertex>` | composes, folds prior source | Erased if after. |
| `src/render/water_flora.ts` | `buildWaterFlora` | `<roughnessmap_fragment>`, `<metalnessmap_fragment>`, `<aomap_fragment>` | composes, folds prior key and source | Erased if after. |
| `src/render/foliage.ts` | `addWind`, `reuseLeafMapSampleForEmissive`, `applyGrassShader` | `<common>`, `<beginnormal_vertex>`, `<begin_vertex>`, `<normal_fragment_begin>`, `<emissivemap_fragment>` | mixed: two assign, one composes | Assigning sites would themselves erase a prior CSM hook. |
| `src/render/characters/assets.ts` | `attachArmorDye` | `<map_fragment>` | composes, folds prior source | Erased if after. Character materials are the ones that most need the near cascade. |
| `src/render/terrain.ts` | `buildSplatMaterial`, `buildLambertMaterial` | `<common>`, `<begin_vertex>`, `<map_fragment>`, `<color_fragment>`, `<emissivemap_fragment>`, `<roughnessmap_fragment>`, `<normal_fragment_maps>`, `<lights_fragment_end>`, `<fog_fragment>` | **assigns**, no cache key | Would erase a prior CSM hook. Terrain is the largest shadow receiver in the world. |
| `src/render/far_terrain.ts` | `buildFarTerrain` | `<common>`, `<begin_vertex>`, `<color_fragment>`, `<normal_fragment_begin>`, `<emissivemap_fragment>`, `<fog_fragment>` | **assigns**, no cache key | Would erase a prior CSM hook. |
| `src/render/foliage_impostor.ts` | `impostorMaterial` | `<common>`, `<beginnormal_vertex>`, `<begin_vertex>`, `<normal_fragment_begin>`, `<map_fragment>`, `<lights_fragment_end>`, `<emissivemap_fragment>` | assigns, then `attachBiomeHaze` re-wraps | Would erase a prior CSM hook. |
| `src/render/battleground_terrain.ts` | `buildBattlegroundTerrain` | `<common>`, `<begin_vertex>`, `<map_fragment>` | **assigns**, clobbers cache key | Would erase a prior CSM hook. |
| `src/render/blade_grass.ts`, `src/render/blade_grass_band.ts` | `buildBladeGrass`, `buildBladeGrassBand` | `<common>`, `<begin_vertex>`, `<color_vertex>`, `<beginnormal_vertex>` | **assign**, no cache key | Would erase a prior CSM hook. |
| `src/render/voxel_terrain.ts` | `buildVoxelTerrain` | `<common>`, `<begin_vertex>`, `<map_fragment>` | **assigns**, no cache key | Would erase a prior CSM hook. |
| `src/render/vale_cup_stadium.ts` | `clothMaterial` (via `buildValeCupStadium`) | `<common>`, `<begin_vertex>` | **assigns**, relies on default key | Would erase a prior CSM hook. |
| `src/render/props.ts` | `drownVeilMaterial` (via `buildProps`) | `<map_fragment>` | **assigns**, clobbers cache key | Would erase a prior CSM hook. |
| `src/render/sky.ts` | `deferBasicSkyFragments` (via `buildSky`) | `<logdepthbuf_vertex>` | **assigns**, clobbers cache key | Sky is unlit; no CSM need, so no conflict in practice. |
| `src/render/shadow_only_material.ts` | `makeShadowOnlyMaterial` | none (copies `onBeforeCompile` and `customProgramCacheKey` from a source) | copy-through | Would copy a CSM hook forward, which is probably correct but is another surface to re-verify. |

No repo module touches `<lights_pars_begin>` (zero occurrences under `src/`),
so CSM's second global override has no repo collision.

The conclusion is unambiguous: **CSM cannot be dropped in.** Every one of those
call sites would need `setupMaterial` folded into it as a composing layer,
which means either wrapping the addon so it chains instead of assigns (a fork,
which then needs its own maintenance against the pinned Three) or adding a
further re-attach layer to `reattachClonedMaterialHooks` and auditing hook
order at every factory in the table above. Materials the audit misses do not
fail loudly: they
lack `USE_CSM`, so they take the `!defined(USE_CSM)` arm of the forked chunk,
which loops all `NUM_DIR_LIGHTS`, and get lit by **both** cascade lights, that
is roughly double sun intensity. That is a silent, per-material visual bug with
a large surface and no existing guard.

### 5d. PCF and `shadow.radius` per cascade

`shadow.radius` is honored per `LightShadow`, so each cascade carries its own.
`PCFShadowMap`'s kernel offsets are `texelSize * shadowRadius`, and `texelSize`
is `1.0 / shadowMapSize`, that is in TEXELS, not world units. With one map,
radius 2.25 at 5.13 cm per texel is a world-space penumbra of about 11.5 cm.
With cascades the same radius means about 6.5 cm on the near cascade and about
27 cm on the far one. Keeping today's look means retuning radius per cascade
(roughly 4.0 near, 0.95 far at fov 60 and 16:9), and the retune is
aspect-ratio-dependent, because the cascade box side is. The penumbra will also
visibly step at the cascade boundary unless `CSM.fade` is enabled, and `fade`
adds a `CSM_FADE` define that toggles `material.needsUpdate = true` from
`updateUniforms`, that is a recompile trigger inside a per-frame path.

`shadow.bias` and `normalBias` need the same per-cascade treatment for the same
reason: they are tuned against today's 5.13 cm texel.

### 5e. The foliage shadow volume seam

`src/render/foliage_shadow_core.ts` states its assumption in its header: the
sun renders ONE orthographic shadow map. Its whole design follows: a single
`ShadowVolumeBasis` (`createShadowVolumeBasis`, `setShadowVolumeBasis`), a
single-volume slab test (`shadowVolumeIntersectsBox`, `shadowRowVisible`), one
caster pack (`packShadowCasters`), and one repack-hysteresis state
(`shadowVolumeMoved`, `SHADOW_REPACK_MOVE`, `copyShadowVolumeBasis`). The
renderer pushes exactly one volume per frame through `setFoliageShadowVolume`
(`src/render/foliage.ts`), passing `this.sun.shadow.camera` and the snapped
anchor.

Under CSM there is no single volume. Two options, both real work:

- Push a conservative union volume. Correct but nearly useless, since the union
  of a 58.9 u box and a 247 u box is the 247 u box, so the culling gets weaker
  than it is today, not stronger.
- Generalize the core to N volumes: N bases, N packs, N hysteresis states, N
  repack budgets. That is a rewrite of a tested pure core plus its call site,
  with `tests/foliage_shadow_core.test.ts` to re-derive.

Note this seam is also where the per-cascade caster slicing from section 4
would have to live, so option two is not optional if the draw-call cost is to
be contained. It is the single largest piece of implementation work in the
whole change.

### 5f. Prewarm and compile

`compileShadowPrograms` in `src/render/renderer.ts` calls
`this.webgl.compileAsync(root, this.sun.shadow.camera, this.scene)` with
`MeshDepthMaterial` swaps in place, precisely so the shadow-pass depth variants
link off-thread instead of stalling at first draw. The header documents how
finely this is tuned to match the real shadow pass's program key (offscreen
target for the color space, fog suppressed, scene passed only as the light
source).

Under CSM:

- The depth arm survives. `compileAsync` against any one cascade's shadow
  camera produces the same depth program key, since the key does not carry
  ortho extents. Only the camera reference needs updating.
- The **color arm does not**. Adding a second shadowed directional light moves
  `numDirLights` from 1 to 2 and `numDirLightShadows` from 1 to 2. Both are in
  Three's program parameter surface, pinned literally in
  `tests/prewarm_program_key_contract.test.ts`. Every lit program in the world
  gets a new key. On top of that, `setupMaterial` adds `USE_CSM` and
  `CSM_CASCADES` to `material.defines`, which are also key inputs. So the
  prewarm lane must run **after** every material has been `setupMaterial`-ed,
  or it links the wrong variant and every material re-links at first draw:
  exactly the multi-second stall class the compile lane exists to prevent, and
  the reason `PREWARM_COMPILE_BATCH_ROOTS` and the whole staged-unit design
  exist.
- `prewarmProgramContentKeys` (`src/render/prewarm_policy.ts`) dedupes compile
  roots by program-content key. `material.defines` participation would need
  re-auditing there, since a `USE_CSM`-carrying material and a plain one must
  not dedupe together.

This is a one-time cost, not a per-frame one, but it lands squarely on the most
delicate machinery in the renderer.

### 5g. Graphics rebuild and light counting

The point-light pinning is unaffected: CSM adds directional lights, and
`GFX.maxPointLights` (`src/render/gfx.ts`), the pad loop in the renderer, and
`pointLightPadCount` (`src/render/point_light_budget.ts`) all count point
lights. The invariant they protect (a constant light count so materials never
recompile mid-travel) is intact for point lights.

The directional side is a new instance of that same invariant, and it holds
only if the cascade count never changes at runtime. It changes in two places:

- A graphics rebuild that changes tier or the Shadow Quality dial rebuilds the
  scene, so it would rebuild the CSM. Cascade count staying constant across
  tiers is a design constraint someone has to write down and pin, because a
  "1 cascade on medium, 2 on ultra" ladder means two whole program sets.
- `GFX.dynamicShadows` is false on low and constrained. Today that means one
  directional light with `castShadow = false`. Under CSM it means either a CSM
  with zero cascades (`createLights` would add none, and the chunk fork's
  `NUM_DIR_LIGHTS == 0` arm applies) or no CSM at all, which is a different
  `numDirLights` and therefore a different program set from every shadowed
  tier. That is fine (they are different builds) but it doubles what the
  prewarm contract has to cover.

Also worth noting for the rebuild path: `CSM.dispose()` does
`delete material.onBeforeCompile` on every managed material, which restores the
class prototype's no-op, **not** whatever hook the repo had installed. A
rebuild that disposes a CSM would strip rim glow, haze, and surface detail off
every surviving material.

## 6. What would change the verdict

In rough order of how much each would move it:

1. **A measured shadow-pass GPU cost.** Everything about frame cost here is a
   model over CPU-submit deltas. A GPU timer query (or a
   `EXT_disjoint_timer_query_webgl2` capture) splitting the shadow pass from
   the color pass on one desktop tier would tell us whether halved clear
   bandwidth is worth anything at all, or whether the pass is draw-call bound,
   in which case CSM is strictly worse.
2. **A measured draw-call delta.** Prototype two ortho volumes with no shader
   changes at all: two `DirectionalLight`s with `castShadow`, sized to the
   split boxes above, and read `renderer.info.render.calls` in the shadow pass.
   If the second cascade costs under about 60 extra calls on Ultra town, the
   frame-cost objection largely goes away. If it costs 200, it is dead.
3. **Per-cascade cadence being measured.** The half-rate cadence core is on
   this branch (`src/render/shadow_cadence_core.ts`); CSM gets materially
   better with a per-cascade extension of it, since the expensive far cascade
   can run at half rate while the near band stays current. A measured win
   there strengthens the CSM case.
4. **Memory pressure becoming the binding constraint.** If a profile is
   actually dying on the 128 MiB shadow allocation (the iOS memory profile
   already sheds to 1024, and `dynamicShadows` is off on constrained), halving
   it matters more than the draws. Today no profile that runs shadows is
   memory-bound on them.
5. **A tight-box cascade fit instead of the addon's diagonal square.** Fitting
   each cascade to the actual light-space bounds rather than a
   rotation-invariant square would fix the far cascade's 2.36x density loss and
   cut its caster count, at the cost of re-introducing the swim the square was
   avoiding, which the texel snap in `src/render/shadow_texel_snap_core.ts`
   already handles for translation. This is the version of the idea worth
   building, and it is a bespoke implementation, not an addon adoption.
6. **A Three upgrade that changes CSM's shape.** The blocking objections are
   about `injectInclude()` mutating a global chunk and `setupMaterial`
   assigning `onBeforeCompile`. If a later release composes instead of
   assigning, or moves cascades into the core light system, most of section 5
   evaporates. Re-check the addon source on any bump, per the re-verify policy
   in `src/render/CLAUDE.md` ("any bump means re-verifying every patched
   chunk").

Things that would NOT change it: better cascade split tuning (the density math
is dominated by the box-fit rule, not the split points), or a third cascade
(more draws, more program surface, same collisions).
