<!-- src/render/ — the Three.js renderer. Root + src CLAUDE.md (the IWorld seam,
     the import-direction rules, determinism, build commands) already apply — do
     NOT repeat them. This file is render-local only. characters/ and assets/
     have their own CLAUDE.md. -->

# src/render/ — Three.js renderer

Turns an `IWorld` snapshot into a frame, every frame. **Presentation only:** it
reads the world and draws it; it MUST NOT mutate sim state (`Renderer`'s ctor
takes `private sim: IWorld`). New data/action a draw path needs → extend
`IWorld` first (see src CLAUDE.md), never reach into `Sim`/`ClientWorld`.

## Module split
`renderer.ts` (~1230) is the orchestrator: scene/camera/lights, the
`views: Map<id, EntityView>` that maps world entities → meshes+nameplates, and
`sync(alpha, dt, facingOverride)` — the per-frame entry called from `main.ts`.
The subsystems each export a `build*()` returning a `*View` and are owned by the
renderer:

| File | Builds |
|---|---|
| `terrain.ts` (~590) | chunked LOD terrain + PBR splat shading |
| `props.ts` (~700) | buildings/structures/objects from CC0 GLBs (instanced/merged) |
| `foliage.ts` (~870) | trees/rocks/dressing (instanced) + player-centred grass ring |
| `water.ts` · `sky.ts` (~280) | per-zone water planes · HDRI sky dome + clouds |
| `vfx.ts` (~480) | pooled `THREE.Points` spell/impact particles (Kenney atlas) |
| `dungeon.ts` (~640) | instanced KayKit interiors from `sim/dungeon_layout.ts` |
| `post.ts` (~150) | post chain (see below) |
| `gfx.ts`, `textures.ts`, `locomotion.ts`, `stealth.ts` | shared helpers (below) |

## gfx.ts — the shared core (read this before touching any subsystem)
- **`GFX` quality tiers** (`low`/`high`/`ultra`). Every tier-dependent knob lives
  here, not in scattered ternaries. The renderer MUST call `initGfxTier(webgl)`
  right after creating the `WebGLRenderer` and before building scene content
  (software GL → `low`; `?gfx=low|high|ultra` / `?lowgfx` force a tier).
- **`surfaceMat(opts)`** is the material factory — it dedupes by
  `(color|maps|flags)` so hundreds of boxes share a few programs. Use it instead
  of `new MeshStandardMaterial`; `MeshLambertMaterial` is auto-substituted on low.
- **`sharedUniforms.uTime`** is the one clock for every `onBeforeCompile` shader
  (wind, water, grain); `sync()` ticks it once/frame. `SUN_ANCHOR`/`SUN_DIR` are
  the one sun every consumer (key light, shadows, sky glow, water glints) reads.

## Procedural-everything
- **Textures:** `textures.ts` (~1130) builds canvas textures at runtime (no image
  files). Add an `export function xTexture()` using the `makeCanvas` helper; its
  module-local `rnd()` keeps generation deterministic — don't use `Math.random`.
- **VFX:** add an effect to `vfx.ts` (emit into the pooled particle cloud; HDR
  colour multipliers via `hdr()` so it blooms on composer tiers). Sprite atlas
  cells are append-only (`SPRITE_FILES`/`SPR` must stay in sync).
- **Props/foliage/dungeon** are the exception: real CC0 **GLB** assets, loaded via
  `assets/loader.ts`, then their geometry is baked/merged/instanced at build time.

## Terrain height = sim height (hard invariant)
Render samples `terrainHeight` / `groundHeight` from `src/sim/world.ts` (DOM-free,
deterministic) to place terrain, props, foliage, water-shore depth. **YOU MUST
sample those functions — never re-derive height here.** `groundHeight` is the
dungeon-aware wrapper (flat floor past `DUNGEON_X_THRESHOLD`); plain
`terrainHeight` is the open-world surface. If they drift, visuals desync from
collision/movement.

## Performance discipline — this runs at frame rate
- Three.js is **pinned at r0.165**; post uses `three/examples/jsm/postprocessing/*`
  (EffectComposer→RenderPass/N8AO→UnrealBloom→OutputPass→Grade) plus the `n8ao`
  package (SSAO). The `postprocessing` dep in `package.json` is n8ao's peer
  dependency — not imported directly, so don't remove it as "unused." Don't bump
  Three or swap the chain casually — shaders here patch r165 chunks via
  `onBeforeCompile`.
- Reuse, don't allocate: instancing for repeats, merge one-offs per
  (material × z-band), share materials via `surfaceMat`, distance-cull/LOD in
  `sync` (see the `*_RANGE_SQ` constants). No per-frame `new THREE.*` in hot paths
  — reuse the `tmpV` scratch vectors / scratch arrays already in `renderer.ts`.

## Never do
- **Never mutate the world from here** (no writing entity/sim fields).
- **Never import `assets/loader` (or anything Three/DOM) from `src/sim/`** — the
  sim must stay headless.
