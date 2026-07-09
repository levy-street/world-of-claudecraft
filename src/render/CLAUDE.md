<!-- src/render/: the Three.js renderer. Root + src CLAUDE.md (the IWorld seam,
     the import-direction rules, determinism, build commands) already apply, do
     NOT repeat them. This file is render-local only. characters/ has its own
     CLAUDE.md. -->

# src/render/: Three.js renderer

Turns an `IWorld` snapshot into a frame, every frame. **Presentation only:** it
reads the world and draws it; it MUST NOT mutate sim state (`Renderer`'s ctor
takes `private sim: IWorld`). New data/action a draw path needs: extend
`IWorld` first (see src CLAUDE.md), never reach into `Sim`/`ClientWorld`.

## Module split
`renderer.ts` is the orchestrator: scene/camera/lights, the
`views: Map<id, EntityView>` that maps world entities to meshes+nameplates, and
`sync(alpha, dt, renderFacingOverride, selfAlphaLead?)` is the per-frame entry called from `main.ts`.
The subsystems each export a `build*()` returning a `*View` and are owned by the
renderer:

| File | Builds |
|---|---|
| `terrain.ts` | chunked LOD terrain + PBR splat shading |
| `props.ts` | buildings/structures/objects from CC0 GLBs (instanced/merged) |
| `foliage.ts` | trees/rocks/dressing (instanced) + player-centred grass ring |
| `water.ts` · `sky.ts` | per-zone water planes · HDRI sky dome + clouds |
| `vfx.ts` | pooled `THREE.Points` spell/impact particles (Kenney atlas) |
| `dungeon.ts` | instanced KayKit interiors from `sim/dungeon_layout.ts` |
| `door_portal.ts` | dungeon-door / exit-portal bodies (stone arch + additive portal swirl) |
| `post.ts` | post chain (see below) |
| `gfx.ts`, `textures.ts`, `render_budget.ts`, `locomotion.ts`, `stealth.ts`, `shared_resource.ts` | shared helpers (below) |
| `self_motion.ts` · `facing_smooth.ts` | pure, Node-tested display-only self layers: bounded intent-driven pose extrapolation online (runs `sim/player_motion.ts`; never touches world state, see `src/net/CLAUDE.md`) · rate-limited self yaw |

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

## Procedural-everything
- **Textures:** `textures.ts` builds canvas textures at runtime (no image
  files). Add an `export function xTexture()` using the `makeCanvas` helper; its
  module-local `rnd()` keeps generation deterministic: don't use `Math.random`.
- **VFX:** add an effect to `vfx.ts` (emit into the pooled particle cloud; HDR
  colour multipliers via `hdr()` so it blooms on composer tiers). Sprite atlas
  cells are append-only (`SPRITE_FILES`/`SPR` must stay in sync).
- **Props/foliage/dungeon** are the exception: real CC0 **GLB** assets, loaded via
  `assets/loader.ts`, then their geometry is baked/merged/instanced at build time.

## Asset loading (`assets/`)
Loads the real CC0 GLBs / HDRIs / textures (`loader.ts` `loadGltf`/`loadHdr`/
`loadTexture`, one parse per URL). Two rules:
- **Cache results are IMMUTABLE: clone before mutating.** `releaseGltf(url)` drops
  the cache entry after geometry is extracted.
- **`preload.ts` is the boot gate.** Subsystems call `registerPreload(promise)` at
  import time and `startGame` awaits `assetsReady()`, so `build*()` can read resolved
  assets synchronously. A new module-load fetch MUST `registerPreload`.

## i18n: in-world floating labels are the only string surface here
The renderer is geometry/shaders; the one player-text surface is the overhead
**nameplate/label** path in `renderer.ts` (only `renderer.ts` imports i18n: `t`
from `../ui/i18n`, `tEntity` from `../ui/entity_i18n`). Keep it keyed:
- **Entity names** (mob/npc/dungeon/ground-object/ability) localize via `tEntity({
  kind, id, field:'name' })`, never the raw English `e.name`/`e.templateId`.
- **Templated labels** (corpse, dungeon-exit, emote, fishing cast) use `t()` keys.
  The renderer only CONSUMES them; the keys live in `src/ui/`, so add a new key
  there, not inline here.
- **Verbatim by design:** player names and owned-pet names (`e.name` when
  `e.ownerId !== null`) are proper nouns: splice them as-is, do not localize.
- `cast_bar.ts` stays i18n-free on purpose: it returns a stable discriminator
  (`label`/`fishing`) and the renderer resolves the visible text. Don't add `t()`
  there.

## Terrain height = sim height (hard invariant)
Render samples `terrainHeight` / `groundHeight` from `src/sim/world.ts` (DOM-free,
deterministic) to place terrain, props, foliage, water-shore depth. **YOU MUST
sample those functions, never re-derive height here.** `groundHeight` is the
dungeon-aware wrapper (flat floor past `DUNGEON_X_THRESHOLD`); plain
`terrainHeight` is the open-world surface. If they drift, visuals desync from
collision/movement.

## Performance discipline: this runs at frame rate
- Three.js is **pinned at r0.165**; post uses `three/examples/jsm/postprocessing/*`
  (EffectComposer to RenderPass/N8AO to UnrealBloom to OutputPass to Grade) plus the
  `n8ao` package (SSAO). The `postprocessing` dep in `package.json` is n8ao's peer
  dependency, not imported directly, so don't remove it as "unused." Don't bump
  Three or swap the chain casually: shaders here patch r165 chunks via
  `onBeforeCompile`.
- Reuse, don't allocate: instancing for repeats, merge one-offs per
  (material × z-band), share materials via `surfaceMat`, distance-cull/LOD in
  `sync` (see the `*_RANGE_SQ` constants). No per-frame `new THREE.*` in hot paths;
  reuse the `tmpV` scratch vectors / scratch arrays already in `renderer.ts`.
- **`render_budget.ts` is the renderer's adaptive-budget core** (tier-driven frame
  budget + telemetry, keyed off `gfx.ts` quality bands). `renderer.ts` owns it,
  degrades against it, and pushes the resulting grass/foliage/vfx quality levels into
  those subsystems. Consult it rather than reinventing a frame-level budget.
