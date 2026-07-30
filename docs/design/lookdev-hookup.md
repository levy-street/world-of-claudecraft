# Lookdev → Renderer hookup notes (for the integrator)

The lookdev pass (terrain/water/sky/post/vfx) was done without touching
`src/render/renderer.ts`. Everything works as-is today because the renderer's
existing PMREM capture clones the sky dome — but the IBL can be upgraded to
true per-biome HDRI PMREMs with the small change below.

## 1. Sky / IBL — replace the PMREM-from-scene block (renderer.ts ~178-186)

`SkyView` (src/render/sky.ts) now exposes:

```ts
envTexture(biome: BiomeId): THREE.DataTexture | null; // raw 1k equirect (unclamped PMREM source), null on low tier
domeTexture(biome: BiomeId): THREE.Texture | null;     // dome-sampled equirect (2k on high/ultra)
envRotationY(biome: BiomeId): number;                 // aligns the IBL sun with the dome's
biomeAt(z: number): { from: BiomeId; to: BiomeId; t: number }; // dome cross-fade state
```

### What happens with no change at all

The current block (`pmrem.fromScene(envScene.add(this.sky.clone()))`) still
works: the clone shares the dome's ShaderMaterial, so the capture already
sees the HDRI sky (with the dome's per-biome gain/clamp applied — a
reasonable IBL on its own). It is captured once, for the vale (z=0) blend
state. This is the shipped state and it looks correct.

### Recommended upgrade — true per-biome equirect PMREM

```ts
// startup (replaces the fromScene block):
const pmrem = new THREE.PMREMGenerator(this.webgl);
const envRTs = new Map<BiomeId, THREE.WebGLRenderTarget>();
for (const b of ['vale', 'marsh', 'peaks'] as BiomeId[]) {
  envRTs.set(b, pmrem.fromEquirectangular(this.skyView.envTexture(b)!));
}
pmrem.dispose(); // keep envRTs alive for the session
this.scene.environment = envRTs.get('vale')!.texture;
this.scene.environmentRotation.y = this.skyView.envRotationY('vale');
this.scene.environmentIntensity = ENV_INTENSITY * 0.55; // see note below
```

- **Intensity note:** the raw equirects are *unclamped and ungained* (the
  dome shader applies a per-biome `HDRI_TUNE` gain of ~0.5-0.6 and a sun
  clamp; PMREM of the raw texture also integrates the real sun, which the
  dome clamps away). If you switch to raw-equirect PMREMs, scale
  `environmentIntensity` down by roughly the same factor (×0.5-0.6) or
  ambient will jump relative to the shipped look. Verify against
  `tmp/gfx_one_lake.png`.
- **Per-biome refresh:** in the per-frame sync (where `skyView.setCameraZ`
  is already called), read `skyView.biomeAt(camera.position.z)` and when the
  dominant biome (`t < 0.5 ? from : to`) changes, swap
  `scene.environment` + `scene.environmentRotation.y` to that biome's
  entry. Ease `environmentIntensity` toward its target over ~2s if the hard
  swap reads as a pop (matches the existing fog easing).
- **Dungeon override:** unchanged — keep setting
  `scene.environmentIntensity = DUNGEON_ENV_INTENSITY` (0.05) /
  `ENV_INTENSITY` on enter/leave (renderer.ts ~606). If you adopt per-biome
  refresh, gate the refresh while underground so a biome boundary crossed
  via dungeon coordinates can't flip the env mid-dungeon.
- `envRotationY` sign: three r165 negates `environmentRotation` before
  building the PMREM lookup matrix, so matching the dome's `u + off`
  sampling requires `+off * 2π` (verified via background-proxy A/B shots;
  the originally shipped negated value was wrong by 2x the offset).

## 2. Sun anchor contract — unchanged

The HDRIs are sampled with a per-biome azimuth offset (`HDRI_SUN_U`,
measured by `tmp/analyze_hdr.mjs`) so each HDRI's real sun azimuth lands on
`SUN_ANCHOR`'s. Elevation differs per HDRI (dawn sun sits near the horizon);
the procedural glow lobes + sun disc sprites still mark the anchor itself.
Nothing in the renderer needs to change; do not introduce a second sun.

## 3. Post chain — no renderer change needed

`buildComposer()` now builds: **N8AOPass → UnrealBloom → OutputPass →
GradePass**. Notes:

- `N8AOPass` *replaces* `RenderPass` (it renders the scene into its own
  HalfFloat beauty+depth target internally — a separate RenderPass would be
  a discarded extra full-scene draw). The no-AO fallback path still adds a
  plain RenderPass.
- `PostPipeline.gtao` was renamed to `PostPipeline.ao` (type `N8AOPass |
  null`). The renderer doesn't reference it today; only the field name
  changed in the interface.
- `GFX.ao` is now true on **high and ultra** (high = half-res + 'Low'
  quality + depth-aware upsampling, ultra = full-res 'Medium').
- `ao.configuration.gammaCorrection = false` is load-bearing: without it the
  mid-chain buffer gets display-gamma'd and the whole frame washes out.
- Trade-off: with N8AO active the composer's MSAA target never sees the
  scene, so geometry AA comes from bloom/grade softening + devicePixelRatio.
  Measured acceptable at 1600×900; if edges crawl on ultra, consider an SMAA
  pass after OutputPass.

## 4. Terrain / water — self-contained

- Terrain splat now uses real ambientCG PBR layers (Color+NormalGL for
  grass/dirt/rock/sand, Color for marsh mud + snow), per-layer constant
  roughness, and a *gentle* (35%) vertex-color modulation. `aSplat`
  semantics unchanged; new `aExtra` (mud, snow) vertex attribute rides along.
  The mid-gray ×2.0 albedo hack is gone — anything that relied on terrain
  vertex color carrying full hue should re-check against the new shots.
- Water uses the real three.js water normal maps (dual scroll + broad swell
  at distance). Low tier's Phong water gained a scrolling `normalMap`
  (clone of the swell map). Uniform additions only; renderer untouched.
- All new textures load via `loadTexture`/`loadHdr` + `registerPreload` at
  module import: anything constructing terrain/water/sky before
  `assetsReady()` resolves will throw with a clear message.

## 5. VFX — sprite atlas

`Vfx` now composites a 4×4 atlas (1024px canvas) from 16 Kenney particle
sprites (`public/vfx/*.png`, shipped by `scripts/assets/specs/lookdev.json`)
at construction. Spawn API gained optional trailing `sprite`/`rot` args —
existing call sites in renderer.ts (projectile/burst/tick/nova/...) are
source-compatible. HDR tier multipliers and the low-tier (no boost) path are
unchanged. If a sprite PNG ever fails to ship, the cell falls back to a
painted radial disc rather than breaking.

## 6. Known follow-ups

- Cumulus cloud sprites are retired on high/ultra (HDRI clouds carry the
  sky); only the faint cirrus layer drifts. Low tier keeps the full painted
  cloud deck. The renderer's cloud-tinting loop is tolerant of the smaller
  sprite list.
- `n8ao@1.10.1` + `postprocessing@6.36.0` were added to package.json
  (postprocessing is only a peer-dep of n8ao at a three-0.165-compatible
  version; we don't import it). Typings live in `src/render/types/n8ao.d.ts`.
