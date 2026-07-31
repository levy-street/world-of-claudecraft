<!-- src/render/: the Three.js renderer. Root + src CLAUDE.md (the IWorld seam,
     the import-direction rules, determinism, build commands) already apply, do
     NOT repeat them. This file is render-local only. characters/ has its own
     CLAUDE.md. -->

# src/render/: Three.js renderer

Turns an `IWorld` snapshot into a frame, every frame. **Presentation only:** it
reads the world and draws it; it MUST NOT mutate sim state (`Renderer`'s ctor
takes `private sim: IWorld`). New data/action a draw path needs: extend
`IWorld` first (see src CLAUDE.md), never reach into `Sim`/`ClientWorld`.

## Module map (families + exemplars; enumerate with `ls src/render/*.ts`)
`renderer.ts` is the orchestrator: scene/camera/lights, the
`views: Map<id, EntityView>` mapping world entities to meshes, and `sync()`,
the per-frame entry called from `main.ts` (see its signature in `renderer.ts`).
Everything else is a sibling module in one of these families:
- **World subsystems** export a `build*()` returning a `*View` the renderer
  owns: `terrain.ts` (chunked LOD + PBR splat), `props.ts`/`foliage.ts`/
  `dungeon.ts` (instanced/merged GLBs), `water.ts` (terrain-aware water bodies;
  shore-depth and tier core in `water_core.ts`, sleeping GPU height field and
  facing-aligned character volume wakes in `water_simulation.ts`), `sky.ts`. Event/minigame scenes follow
  the same pattern: `jail_scene.ts`, `vale_cup_*.ts`, `yumi_*.ts`. Rift
  portals: `door_portal.ts` also builds the bespoke world-rift gate GLB with
  its rank-tinted energy membrane (`buildRiftGateBody`), and `rift_rank.ts` is
  the floating C/B/A/S rank badge above a world rift portal.
- **Per-frame overlay/FX modules** ticked from `sync()`: `vfx.ts` (pooled
  particles), `weather.ts`, `character_effects.ts`.
- **The nameplate suite** (below) owns all overhead text and badges.
- **Pure logic cores** (below) hold Node-tested per-frame decisions.
- **Perf governors:** `render_budget.ts` (adaptive frame budget, see
  Performance) and `crowd_lod.ts` (pure character LOD policy: the band plan
  `characterLodBands` returns, which pulls shadow/anim cadence in as rig counts
  climb and holds an animated far band, articulated rig at a low cadence, before
  the frozen single-draw far mesh takes over. Its extension eases out on the
  crowd knee, the per-tier `GFX.farCharacterAnimScale` ceiling, and live budget
  pressure; cosmetic-only, and `showsStaticFarMesh` keeps anything a player
  reacts to out of the frozen mesh inside the uncrowded base range).
- `view_create_retry.ts`: bounded cooldown state for fail-soft character builds
  in per-frame paths, including required targets, form swaps, and visual-key
  swaps (`tests/view_create_retry.test.ts`).
- `self_motion.ts`/`facing_smooth.ts`: pure display-only self layers (bounded
  online pose extrapolation + rate-limited self yaw; never touch world state,
  see `src/net/CLAUDE.md`).
- `step_smooth_core.ts`/`ground_tilt_core.ts`: the grounded-presentation pair
  the entity loop drives per body. The first eases the vertical step the
  physics solver takes inside one tick (leashed to a step, exact while
  airborne so jumps and landings keep their impact); the second leans a body
  toward the surface under it, in the body's own frame, partial and clamped
  and damped. Both display-only: collision keeps using the physical pose.
  Terrain gradients resample on a per-body TIME budget, never a frame count
  (a frame cadence starves on a slow client). Landing dust rides the same
  loop through `Vfx.groundPuff`, scaled by the display-derived fall speed
  because the wire carries no vy for remote bodies.
- `camera_boom_core.ts`/`camera_feel_core.ts`/`camera_director_core.ts`: the
  AAA chase-camera feel stack `updateCamera` composes (spring-arm pivot lag,
  look-ahead + FOV kicks + landing thump, directed zone-vista/death-drift
  moves). All display-only, all gated by the reduced-motion switch; driven
  from `renderer.ts` `updateCamera` and the hud event hooks
  (`tests/camera_*_core.test.ts`).
- `voxel_terrain.ts`: verification-only prototype (proposal #1611, driven by
  `scripts/`, NOT the live path); live terrain is `terrain.ts` sampling sim heights.

## Module-first: pure core + thin painter (where NEW render logic lands)
New per-frame decision logic (visibility, anchors, interpolation, region/LOD
selection) is its own Three/DOM/i18n-free `*_core.ts` or `*_view.ts` module,
registered in `RENDER_PURE_CORES` (`tests/architecture.test.ts`, which sweeps
every on-disk `src/render` `*_view`/`*_core`, fails CI on unregistered ones,
and scans the set Three/DOM/i18n-free and deterministic). The Three/DOM half
is a thin painter the renderer drives; reference pair: `nameplate_view.ts` +
`nameplate_painter.ts` (the render twin of src/ui's `unit_portrait` pattern).
The core's test is a plain Vitest importing it directly. Fix bugs test-first:
reproduce in the matching Vitest (extract buried logic into a core if needed),
then the smallest change that turns it green; a repro never needs a browser.

## The nameplate suite (overhead text/badges land here, never renderer.ts)
`nameplate_view.ts` is the pure plan (show/hide, anchor lift, urgency, threat,
combo; allocation-free: `nameplatePlanInto` fills a caller-owned `NameplatePlan`).
`nameplate_painter.ts` does the Three projection, DOM writes, and ALL the
localization (per-tier cadence via `ui_tier_knobs.nameplateIntervalSec`); the
significant-contributor name glow lives there too. Narrow helpers:
`nameplate_combo/threat/projection/declutter.ts` plus `entity_labels.ts`
(shared localized display names). Drive changes from `tests/nameplate_*.test.ts`.

## gfx.ts: the shared core (read this before touching any subsystem)
- **`GFX` quality tiers** (`low`/`medium`/`high`/`ultra`). Every tier-dependent knob lives
  here, not in scattered ternaries. The renderer MUST call `initGfxTier(webgl)`
  right after creating the `WebGLRenderer` and before building scene content
  (software GL maps to `low`; `?gfx=low|medium|high|ultra` / `?lowgfx` force a tier).
- **`surfaceMat(opts)`** is the material factory: it dedupes by
  `(color|maps|flags)` so hundreds of boxes share a few programs. Use it instead
  of `new MeshStandardMaterial`; `MeshLambertMaterial` is auto-substituted on low.
- **`sharedUniforms.uTime`** is the one clock for every `onBeforeCompile` shader
  (wind, water, grain); `sync()` ticks it once/frame. `SUN_ANCHOR`/`SUN_DIR` are
  the one sun every consumer (key light, shadows, sky glow, water glints) reads.

## Textures and VFX procedural, models GLB-first
- **Textures:** `textures.ts` builds canvas textures at runtime (no image
  files). Add an `export function xTexture()` using the `makeCanvas` helper; its
  module-local `rnd()` keeps generation deterministic: don't use `Math.random`.
- **VFX:** add an effect to `vfx.ts` (emit into the pooled particle cloud; HDR
  colour multipliers via `hdr()` so it blooms on composer tiers). Sprite atlas
  cells are append-only (`SPRITE_FILES`/`SPR` must stay in sync).
- **Models are real GLB assets** (CC0 kits, Tripo-generated models, and the
  image-to-GLB procedural exporters: props, foliage, dungeon, fish, gather nodes,
  mailbox, delve props, characters, the Eastbrook town kit), loaded via
  `assets/loader.ts`, then baked/merged/instanced at build time. A new
  reference-image asset follows the `image-to-glb` skill
  (`.claude/skills/image-to-glb/SKILL.md`): exporter under `scripts/assets/`, a
  parsed-GLB contract test, and its own thin `src/render/<asset>.ts` adapter
  (exemplars: `banker_chest.ts`, `eastbrook_grand_armoury.ts`, `noticeboard.ts`).
## Asset loading (`assets/`)
`loader.ts` (`loadGltf`/`loadHdr`/`loadTexture`, one parse per URL) plus these
rules, all CI-enforced:
- **Cache results are IMMUTABLE: clone before mutating.** `releaseGltf(url)` drops
  the cache entry after geometry is extracted.
- **`preload.ts` is the boot gate, and it has TWO lanes.** `startGame` awaits
  `assetsReady()` either way, so `build*()` still reads resolved assets
  synchronously; the lanes differ only in WHEN the fetch starts. A new module-load
  fetch MUST register in one of them, and for world content that is the deferred one:
  - `registerDeferredPreload(() => load...())` for world content. Nothing runs until
    `startGame` calls `beginDeferredPreloads()`. The thunk must CREATE the promise
    when invoked, never close over one already in flight.
  - `registerPreload(promise)` stays eager, for the few assets the LAUNCHER itself
    draws. Today that is `characters/assets.ts` (the character-creation preview) and
    `placed_assets.ts` (which runs during world build, not at import).
  Fetching world content at import meant merely reaching the home screen decoded the
  whole set, and the spike crossed WKWebView's per-process ceiling: a 12 GB iPhone 17
  Pro was killed 1.6s in and reloaded forever, unseen by the entry crash guard (it
  only arms inside `startGame`). Guarded by `tests/defer_launcher_preloads.test.ts`,
  which also pins that the lane opens BEFORE the `assetsReady()` that gates the
  Renderer, and fails on any new eager registrant outside the two allowed files.
- **Preload sets are tier-INDEPENDENT.** They freeze at the import-time tier
  guess but placement runs against the LIVE tier, so a preload set must be a
  superset of EVERY tier's placement set or world entry crashes with "asset not
  preloaded" (the v0.16.0 P0; see the comment in `characters/manifest.ts` and
  `tests/render_asset_preload.test.ts`).
- **Every asset under `public/` must be in the media manifest** (regenerate via
  `node scripts/build_media_manifest.mjs generate`, automatic in `npm run build`).
  `tests/render_glb_replacement_assets.test.ts` fails on a GLB missing from
  disk or the manifest; export a `*PreloadInternalsForTest` (see `fish.ts`)
  so it covers your module.

## i18n: overhead labels are the only string surface here
The renderer is geometry/shaders; the overhead-text surface is
`nameplate_painter.ts` (owns `t`/`tEntity`/`formatNumber`) plus
`entity_labels.ts` (localized display-name helpers, lifted out of `renderer.ts`
so renderer and painter share them without an import cycle); `renderer.ts`
keeps only `tEntity` for its remaining label writes. Keep it keyed:
- **Entity names** (mob/npc/dungeon/ground-object/ability) localize via `tEntity({
  kind, id, field:'name' })`, never the raw English `e.name`/`e.templateId`.
- **Templated labels** (corpse, dungeon-exit, emote, fishing cast) use `t()` keys.
  The keys live in `src/ui/`, so add a new key there, not inline here.
- **Verbatim by design:** player names and owned-pet names (`e.name` when
  `e.ownerId !== null`) are proper nouns: splice them as-is, do not localize.
- **Deed titles** (the subtitle under a player's name): the entity `title`
  field is a deed id; `nameplate_painter.ts` resolves it via `deedTitleText`
  (`../ui/deed_i18n`), diffed per language + deed id; an unknown id hides the
  line.
- `cast_bar.ts` stays i18n-free on purpose: it returns a stable discriminator
  (`label`/`fishing`) and `nameplate_painter.ts` resolves the visible text.
  Don't add `t()` there.

## Terrain height = sim height (hard invariant)
Render samples `terrainHeight` / `groundHeight` from `src/sim/world.ts` (DOM-free,
deterministic) to place terrain, props, foliage, water-shore depth. **YOU MUST
sample those functions, never re-derive height here.** `groundHeight` is the
dungeon-aware wrapper (flat floor past `DUNGEON_X_THRESHOLD`); plain
`terrainHeight` is the open-world surface. If they drift, visuals desync from
collision/movement.

## Performance discipline: this runs at frame rate
- Three.js is **version-pinned in `package.json`**; the post chain lives in
  `post.ts` (its header comment documents the pass order and the N8AO
  subtleties) plus the `n8ao` package (SSAO). The `postprocessing` dep in
  `package.json` is n8ao's peer dependency, not imported directly, so don't
  remove it as "unused." Don't bump Three or swap the chain casually: shaders
  here patch the pinned release's shader chunks via `onBeforeCompile`, so any
  bump means re-verifying every patched chunk. A bump also touches KTX2:
  `assets/ktx2_support.ts` hand-builds a `workerConfig` on its no-context
  fallback arm (a shape KTX2Loader owns and can change between releases), and
  the shipped `public/basis/` transcoder must be re-copied from the new three
  (`tests/glb_texture_compression.test.ts` byte-pins it and goes red).
- Reuse, don't allocate: instancing for repeats, merge one-offs per
  (material, z-band), share materials via `surfaceMat`, distance-cull/LOD in
  `sync` (see the `*_RANGE_SQ` constants). No per-frame `new THREE.*` in hot paths;
  reuse the `tmpV` scratch vectors / scratch arrays already in `renderer.ts`.
- **`render_budget.ts` is the renderer's adaptive-budget core** (tier-driven frame
  budget + telemetry, keyed off `gfx.ts` quality bands). `renderer.ts` owns it,
  degrades against it, and pushes the resulting grass/foliage/vfx quality levels into
  those subsystems. Consult it rather than reinventing a frame-level budget.
