# World of Claudecraft — Graphics Overhaul Implementation Plan ("Minecraft → UE5 showcase")

Target: three@0.165 (confirmed; GTAOPass/SSAOPass/SMAAPass/UnrealBloomPass/OutputPass/FXAAShader/VignetteShader all present in `node_modules/three/examples/jsm/`), fully procedural, 60fps on a decent laptop, `?lowgfx` stays playable. Current renderer is a single forward pass, Lambert everywhere, vertex-colored 440-seg terrain, Phong water, canvas sky dome.

Plan is ordered as 11 safe, independently screenshot-verifiable steps. Verify each with `npm run dev` → offline play → screenshot (existing headless-Chrome E2E scripts work; note prior deflaking for timing races).

---

## Step 0 — `src/render/gfx.ts` (NEW, ~120 lines): quality tiers + shared uniforms

Everything below keys off one module instead of scattered `LOW_GFX` ternaries.

```ts
export type GfxTier = 'low' | 'high' | 'ultra';
export const TIER: GfxTier = new URLSearchParams(location.search).has('lowgfx') ? 'low'
  : new URLSearchParams(location.search).get('gfx') === 'ultra' ? 'ultra' : 'high';

export const GFX = {
  composer: TIER !== 'low',
  ao: TIER === 'ultra',            // promote to 'high' only if measured <3ms (Step 2)
  msaaSamples: TIER === 'low' ? 0 : 4,
  pixelRatioCap: TIER === 'low' ? 1 : TIER === 'high' ? 1.75 : 2.5,  // 2.5 today is the silent perf killer
  shadowMap: TIER === 'low' ? 1024 : 4096,
  standardMaterials: TIER !== 'low', // low keeps Lambert
  grassRadius: TIER === 'low' ? 45 : 70,
  grassStep: TIER === 'low' ? 3.2 : 1.8,
  terrainSplat: TIER !== 'low',
  windSway: TIER !== 'low',
  maxPointLights: TIER === 'low' ? 3 : 6,
} as const;

// one clock uniform shared by all onBeforeCompile shaders (wind, water, sky)
export const sharedUniforms = { uTime: { value: 0 } };

// material factory: dedupes by (color|map|flags) so 900 box meshes share ~30 programs
const matCache = new Map<string, THREE.Material>();
export function surfaceMat(opts: { color?: number; map?: THREE.Texture; normalMap?: THREE.Texture;
  roughness?: number; flat?: boolean; emissive?: number; emissiveIntensity?: number }): THREE.Material {
  const key = JSON.stringify({ ...opts, map: opts.map?.uuid, normalMap: opts.normalMap?.uuid });
  let m = matCache.get(key);
  if (!m) {
    m = GFX.standardMaterials
      ? new THREE.MeshStandardMaterial({ roughness: opts.roughness ?? 0.85, metalness: 0.0, ...opts })
      : new THREE.MeshLambertMaterial({ color: opts.color, map: opts.map, emissive: opts.emissive });
    matCache.set(key, m);
  }
  return m;
}
```

Renderer ticks `sharedUniforms.uTime.value = this.time` once per frame in `sync()`.

---

## Step 1 — `src/render/post.ts` (NEW, ~150 lines) + hookup in `renderer.ts`

**Chain:** `RenderPass → [GTAOPass] → UnrealBloomPass → OutputPass → GradePass(renderToScreen)`.

```ts
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';

export function buildComposer(webgl: THREE.WebGLRenderer, scene: THREE.Scene, cam: THREE.Camera) {
  const size = webgl.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, {
    samples: GFX.msaaSamples, type: THREE.HalfFloatType,  // HDR + MSAA in one target (WebGL2)
  });
  const composer = new EffectComposer(webgl, rt);
  composer.addPass(new RenderPass(scene, cam));
  let gtao: GTAOPass | null = null;
  if (GFX.ao) {
    gtao = new GTAOPass(scene, cam, size.x, size.y);
    gtao.output = GTAOPass.OUTPUT.Default;
    gtao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.6, thickness: 1.2, scale: 1.0, samples: 12 });
    composer.addPass(gtao);
  }
  const bloom = new UnrealBloomPass(size, 0.32 /*strength: SUBTLE*/, 0.55 /*radius*/, 0.85 /*threshold*/);
  composer.addPass(bloom);
  composer.addPass(new OutputPass()); // ACES tonemap (reads renderer.toneMapping) + sRGB encode
  const grade = new ShaderPass(GradeShader); // below — runs in display space, fine for lift/gamma/gain
  composer.addPass(grade);
  return { composer, bloom, gtao, grade };
}
```

**AA tradeoff (decided):** MSAA `samples: 4` on the composer's HalfFloat target. It resolves geometry edges before post, costs ~1ms on integrated GPUs at 1080p×1.75, and unlike FXAA doesn't smear the crisp low-poly silhouettes. FXAA (`ShaderPass(FXAAShader)` appended after grade) only as fallback if `!webgl.capabilities.isWebGL2` (rare). SMAA rejected: 3 extra passes for marginal gain here. lowgfx keeps the current direct `webgl.render()` with built-in `antialias:true`: zero new cost. (Superseded: SMAA is the tail on high and above, and medium runs an FXAA arm fused INTO the grade pass rather than appended after it, so the grade-only chain keeps its dynamic-resolution region; see `src/render/gfx_aa_policy_core.ts`.)

**GradeShader** (inline in post.ts) — lift/gamma/gain + saturation + vignette + faint filmic grain:

```glsl
uniform sampler2D tDiffuse; uniform float uTime;
varying vec2 vUv;
const vec3 LIFT = vec3(0.012, 0.010, 0.018);   // lifted cool shadows
const vec3 GAIN = vec3(1.05, 1.02, 0.98);      // warm highlights
const vec3 GAMMA = vec3(0.96);
void main() {
  vec3 c = texture2D(tDiffuse, vUv).rgb;
  c = pow(max(vec3(0.0), c * GAIN + LIFT), GAMMA);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, 1.12);                                  // saturation
  vec2 d = vUv - 0.5;
  c *= 1.0 - 0.32 * smoothstep(0.45, 0.95, dot(d, d) * 2.2);  // vignette
  c += (fract(sin(dot(vUv * 731.7 + uTime, vec2(12.9898,78.233))) * 43758.5) - 0.5) * 0.012; // grain
  gl_FragColor = vec4(c, 1.0);
}
```

**renderer.ts edits:** `setPixelRatio(Math.min(devicePixelRatio, GFX.pixelRatioCap))`; replace the final `this.webgl.render(...)` with `GFX.composer ? this.composer.render() : this.webgl.render(...)`; resize handler calls `composer.setSize` + `gtao.setSize`. **Measure GTAO** here with `webgl.info` + EXT_disjoint_timer_query or simply frame-time A/B: if >3ms on the target laptop, leave it ultra-only (hemisphere+IBL+contact shadows from Step 5's terrain normals carry most of the look).

**Screenshot check:** campfires/portals bloom softly, corners vignette, no blown-out sky.

---

## Step 2 — Lighting rebalance + IBL (renderer.ts)

PBR materials (coming in Steps 4-8) need an environment. Generate it from the procedural sky itself:

```ts
import { PMREMGenerator } from 'three';  // core
// after sky dome + sun sprites exist:
const pmrem = new PMREMGenerator(this.webgl);
const envScene = new THREE.Scene();
envScene.add(skyMesh.clone());           // sky dome only (fog:false materials)
const envRT = pmrem.fromScene(envScene, 0.04);
this.scene.environment = envRT.texture;
this.scene.environmentIntensity = 0.5;   // r163+ API, present in 0.165
pmrem.dispose();
```

Rebalance (IBL now supplies ambient specular/diffuse):
- `hemi.intensity: 1.0 → 0.45` (keep its ground-bounce green `0x46603a`).
- `sun.intensity: 2.2 → 2.8`, color `0xfff0cd → 0xffedd0`.
- Shadows: tighten ortho `S = 75 → 50` (follow-cam already tracks player; 50 covers the 55-unit nameplate range), `normalBias 0.02 → 0.05` (Standard materials show more acne), `shadow.radius = 4` with PCFSoft, mapSize stays 4096 (tier-gated 1024 low).
- In `updateAmbience()`: when entering dungeon, also drop `scene.environmentIntensity` to 0.15 and `sun.intensity` to 0.3 (restore on exit) — crypt currently leaks full sunlight.
- **God rays (optional, cheap):** 3 elongated additive sprites (stretched 1×8 gradient canvas) parented near the camera, aligned to `sunDir`, opacity ∝ `max(0, dot(camForward, sunDir))`, outdoor-only. ~20 lines next to the existing sunSprites code; flag behind `TIER !== 'low'`.

**Screenshot check:** props/characters get subtle sky reflection, shadows still tight and stable.

---

## Step 3 — `src/render/textures.ts`: procedural normal/roughness generators (+ richer albedo)

Add a generic height→normal converter, then per-surface generators. All canvas, no assets:

```ts
function heightToNormal(heightCanvas: HTMLCanvasElement, strength = 2.0): THREE.CanvasTexture {
  const s = heightCanvas.width, src = heightCanvas.getContext('2d')!.getImageData(0, 0, s, s).data;
  const out = document.createElement('canvas'); out.width = out.height = s;
  const img = out.getContext('2d')!.createImageData(s, s);
  const h = (x: number, y: number) => src[(((y + s) % s) * s + ((x + s) % s)) * 4] / 255;
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const dx = (h(x - 1, y) - h(x + 1, y)) * strength, dy = (h(x, y - 1) - h(x, y + 1)) * strength;
    const inv = 1 / Math.hypot(dx, dy, 1), i = (y * s + x) * 4;
    img.data[i] = (dx * inv * 0.5 + 0.5) * 255; img.data[i+1] = (dy * inv * 0.5 + 0.5) * 255;
    img.data[i+2] = (inv * 0.5 + 0.5) * 255; img.data[i+3] = 255;
  }
  out.getContext('2d')!.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(out); t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace; return t;
}
```

New exports (each = height canvas drawn with existing `rnd()` patterns, returned as `{ map, normalMap, roughnessMap? }`):
- `barkMaps()` — vertical ridge height field → strong normal; roughness 0.95.
- `stoneMaps()` — block pattern height (reuse stoneTexture layout) → mortar grooves.
- `roofMaps()` — shingle rows → stepped normals.
- `groundSplatMaps()` — **four tiling albedo+normal pairs**: grass (blade clumps), dirt (pebbles+cracks), rock (fractured), sand (ripples). 256² each.
- `waterNormalMaps()` — two differently-scaled blobby normal canvases (replace `waterNormalish`, real normal-encoded via heightToNormal).
- `foliageCardTexture()` — alpha leaf-cluster card (radial leaf strokes, alpha falloff) for tree silhouettes.

No visual change yet (consumed by later steps) — verify via a tiny dev page or just compile.

---

## Step 4 — `src/render/terrain.ts` (NEW, extract `buildTerrain` from renderer.ts): splat + chunks + biome hook

**4a. Chunked meshes (this is also the 3x-world enabler).** Replace the single 440² plane with an N×N grid of chunks (chunk size 60 u). Per-chunk `PlaneGeometry` with LOD by distance-at-build from origin hub *ring*: near spacing 1.2u, far 3.5u (vertex counts: ~2500/chunk near, ~300 far). Each chunk gets a correct bounding box → **frustum culling now actually works** (today the whole terrain is one draw, always submitted). 360-world: 6×6 = 36 chunks; 3x-area world (~624): 11×11 = 121 chunks, ~25-40 in frustum. Skirt each chunk edge 0.3u down to hide LOD cracks (cheaper than stitching).

**4b. Splat via `onBeforeCompile` on `MeshStandardMaterial`.** Keep vertex colors as the *tint* layer (this is the biome hook — see 4d). Precompute splat weights on CPU in the existing vertex loop (slope/height/roadDistance already computed there) into a vec4 attribute:

```ts
// in the vertex loop: w = [grass, dirt, rock, sand], normalized
splat[i*4+0] = grassW; splat[i*4+1] = dirtW /* roads, town */; splat[i*4+2] = rockW /* slope>0.55 */; splat[i*4+3] = sandW;
geo.setAttribute('aSplat', new THREE.BufferAttribute(splat, 4));
```

```ts
const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1.0 });
mat.onBeforeCompile = (sh) => {
  Object.assign(sh.uniforms, { uGrass:{value:g.map}, uGrassN:{value:g.normalMap}, uDirt:{...}, uRock:{...}, uSand:{...}, uMacro:{value:macroNoiseTex} });
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nattribute vec4 aSplat; varying vec4 vSplat; varying vec3 vWPos;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSplat = aSplat; vWPos = (modelMatrix * vec4(position,1.0)).xyz;');
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying vec4 vSplat; varying vec3 vWPos;\nuniform sampler2D uGrass,uDirt,uRock,uSand,uMacro;')
    .replace('#include <map_fragment>', `
      vec2 tuv = vWPos.xz * 0.22;
      vec3 alb = texture2D(uGrass,tuv).rgb*vSplat.x + texture2D(uDirt,tuv*0.8).rgb*vSplat.y
               + texture2D(uRock,tuv*0.6).rgb*vSplat.z + texture2D(uSand,tuv).rgb*vSplat.w;
      float macro = mix(0.82, 1.18, texture2D(uMacro, vWPos.xz*0.012).r);  // kills tiling at distance
      diffuseColor.rgb *= alb * macro * 2.0;  // textures authored ~0.5 gray; vertex color carries hue
    `);
};
```

**4c. Terrain normal map (macro relief):** one 2048² DataTexture computed from `terrainHeight` (sample every world/2048 units, same heightToNormal math), applied as `normalMap` with `normalScale (0.6)` in world-planar UV. Per-layer detail normals: only rock gets one (weighted by `vSplat.z` via a second `normal_fragment_maps` injection) — full 4-layer normal blending isn't worth the ALU.

**4d. Biome hook (design for data layer):** terrain.ts consumes exactly one function — `biomeAt(x, z): BiomeDef` — to be exported from `src/sim/world.ts` when zones land:

```ts
export interface BiomeDef {
  id: 'vale' | 'highlands' | 'marsh';           // zone 1 keeps 'vale' everywhere today
  grass: number; grassDark: number; grassYellow: number; dirt: number; rock: number; sand: number;
  fog: { color: number; near: number; far: number };
  skyHorizon: number; treeTint: number;
}
```

CPU vertex loop calls `biomeAt` for tint colors and splat-weight curve tweaks (marsh: more dirt/sand, highlands: rock threshold 0.45); splat *textures* stay shared. Renderer lerps `scene.fog` color/near/far toward the player's current biome's fog over ~2s in `updateAmbience`. Zero shader changes for new biomes.

**Screenshot check:** road cuts visible as blended dirt, cliffs read as rock with relief, no visible tiling from the hilltop.

---

## Step 5 — `src/render/water.ts` (NEW, ~140 lines): custom ShaderMaterial

Replace the Phong plane. Keep one plane but with 192×192 segments and a CPU-precomputed per-vertex `aShoreDepth = WATER_LEVEL - terrainHeight(x,z,seed)`:

```glsl
// vertex: small displacement
pos.y += (sin(uTime*1.1 + pos.x*0.35) + sin(uTime*0.7 + pos.z*0.28)) * 0.05;
// fragment core:
vec3 n1 = texture2D(uNorm1, vWPos.xz*0.06 + uTime*vec2(0.013,0.019)).xyz*2.-1.;
vec3 n2 = texture2D(uNorm2, vWPos.xz*0.13 - uTime*vec2(0.021,0.011)).xyz*2.-1.;
vec3 N = normalize(vec3(n1.xy + n2.xy, 3.0).xzy);
vec3 V = normalize(cameraPosition - vWPos);
float fresnel = 0.04 + 0.96*pow(1.0 - max(dot(N,V),0.0), 5.0);
vec3 deep = vec3(0.06,0.20,0.30), shallow = vec3(0.16,0.42,0.45);
float depth = clamp(vShoreDepth/3.0, 0.0, 1.0);
vec3 col = mix(shallow, deep, depth);
col = mix(col, uSkyColor, fresnel*0.75);                       // cheap sky reflection
float spec = pow(max(dot(reflect(-uSunDir,N), V),0.0), 240.0); // sun glints
col += uSunColor * spec * 2.2;                                 // >1 → blooms
float foam = smoothstep(0.55, 0.0, vShoreDepth) * (0.55 + 0.45*sin(uTime*2.0 + vWPos.x*1.7 + vWPos.z*1.3));
col = mix(col, vec3(0.92), clamp(foam,0.0,0.85));              // shoreline foam band
gl_FragColor = vec4(col, mix(0.78, 0.95, depth));              // transparent near shore edge handled by foam
```

Uniforms: the two Step-3 water normal textures, `uSunDir` (from renderer's sunDir), `uSkyColor` matching sky horizon, shared `uTime`. `transparent: true, depthWrite: false`. lowgfx: keep today's Phong path (factory switch in water.ts).

**Screenshot check:** Mirror Lake — foam ring along shore, sun glints streaking, fresnel brightening at grazing angles.

---

## Step 6 — Sky & atmosphere (renderer.ts + textures.ts)

Replace the 4×256 gradient texture with a shader dome (`ShaderMaterial`, `side: BackSide, fog: false, depthWrite: false`):

```glsl
varying vec3 vDir;
void main() {
  float h = normalize(vDir).y;
  vec3 zenith = vec3(0.24,0.44,0.72), horizon = vec3(0.78,0.86,0.93), haze = vec3(0.88,0.90,0.92);
  vec3 c = mix(horizon, zenith, smoothstep(0.0, 0.55, h));
  c = mix(haze, c, smoothstep(-0.02, 0.16, h));                       // horizon haze band
  float sunAmt = pow(max(dot(normalize(vDir), uSunDir), 0.0), 8.0);
  c += vec3(1.0,0.85,0.6) * sunAmt * 0.35;                            // warm sky glow around sun
  gl_FragColor = vec4(c, 1.0);
}
```

Horizon colors become a uniform fed from `biomeAt(player).skyHorizon`. Re-run the Step-2 PMREM capture once after the dome material is live (order: build sky → PMREM). Clouds: keep sprites but generate 3 cloud canvas variants instead of 1, scale opacity by altitude, and add a second slow far layer (10 sprites at y≈140, opacity 0.35). Fog: outdoor values move to BiomeDef (vale keeps `0xa6c6e0, 130, 470`); underwater/dungeon presets stay hardcoded. Keep lighting static (no day/night) but bias everything slightly golden-hour: sun elevation already low-ish at (90,140,50) — good as is.

**Screenshot check:** horizon no longer a flat gradient stripe; sun side of sky visibly warmer.

---

## Step 7 — Vegetation: wind, variation, density (extract `buildDecorations`/`buildGrass` → `src/render/foliage.ts`)

**Wind via onBeforeCompile** (shared helper, applied to grass material + pine/oak foliage materials, NOT trunks/rocks):

```ts
export function addWind(mat: THREE.Material, strength: number): void {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = sharedUniforms.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 iw = (instanceMatrix * vec4(0.,0.,0.,1.)).xyz;
          float ph = iw.x * 0.15 + iw.z * 0.17;
        #else
          float ph = 0.0;
        #endif
        float w = (sin(uTime*1.7 + ph) + 0.5*sin(uTime*3.1 + ph*1.3)) * ${strength.toFixed(3)}
                  * smoothstep(0.0, 1.0, transformed.y);   // grass uses uv.y-weighted top sway
        transformed.x += w; transformed.z += w * 0.6;`);
  };
}
```

**instanceColor variation:** after filling matrices, `im.instanceColor = new THREE.InstancedBufferAttribute(...)` with per-instance HSL jitter (`color.offsetHSL((r-0.5)*0.06, (r2-0.5)*0.15, (r3-0.5)*0.08)`) for pine cones, oak blobs, rocks, grass. Free visually-huge win; works with Lambert and Standard automatically.

**Trees:** pines → 8-segment cones with a slight droop (after creating each cone geometry, push rim vertices down: `pos.y -= 0.18 * (radialDist/maxR)^2`, computed once); add one crossed alpha-card ring per pine (2 quads with `foliageCardTexture`, `alphaTest 0.4`) at mid-canopy for a fluffier silhouette — one extra InstancedMesh (2 quads × N). Oaks → 4 blobs instead of 2, each `SphereGeometry(…,8,6)` with one-time per-vertex radial noise (`v *= 0.85 + 0.3*hash(v)`) so they're not perfect spheres.

**Grass — dense ring with rebuild:** replace whole-world placement with a player-centered ring. One InstancedMesh sized for the max count (`(2*R/step)² * 0.5` ≈ 3000 at R=70/step=1.8); regenerate matrices when player moves >12u from last build origin (deterministic from grid hash, so it's stable — same tufts reappear). Distance fade in the grass material via onBeforeCompile fragment: `diffuseColor.a *= smoothstep(uFadeFar, uFadeFar*0.75, dist(vWPos.xz, uPlayer))` combined with alphaTest. Rebuild cost ~1ms, amortized rare. This is what keeps the **3x world from tripling grass cost — it's O(radius²), not O(world²)**.

**Decorations at 3x world:** bucket instances into per-region InstancedMeshes (e.g., 9 buckets) so frustum culling drops off-screen forests; tree placement already deterministic per-cell.

**Screenshot check:** grass/canopies sway, forest has per-tree hue variation, grass visibly dense near player and fading at ~70u.

---

## Step 8 — Rigs & props material upgrade (`models.ts`, `props.ts`)

- `models.ts box()` and all `MeshLambertMaterial` constructions → `surfaceMat()` from Step 0 (Standard, roughness 0.8 skin/cloth, 0.45 + small `metalness 0.6` for blades/mace heads — sword blades will pick up the env map and actually gleam).
- **Subtle rim:** one shared onBeforeCompile snippet on rig materials: `totalEmissiveRadiance += vec3(0.5,0.6,0.8) * 0.12 * pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 3.0);` — sells silhouettes against dark ground, costs nothing.
- **Rounder where cheap:** humanoid torso `BoxGeometry → CapsuleGeometry(0.42, 0.5, 2, 8)` scaled, head box → `SphereGeometry(0.27, 10, 8)` flattened (keep hair caps boxy — reads as stylized, not Minecraft), limbs stay boxes (animation pivots unchanged, `RigParts` untouched). Beasts: keep boxes, they read fine with normals + rim.
- **Team/class accents:** belt + shoulder pads get `emissive: classColor, emissiveIntensity: 0.25` — bloom gives a faint class-colored glint.
- **props.ts:** swap materials to Step-3 map+normal pairs (`roofMaps`, `wallMaps` via heightToNormal on the timber pattern, `stoneMaps`, bark). Then **merge static props**: import `mergeGeometries` from `three/examples/jsm/utils/BufferGeometryUtils.js`, bake each prop group's world transform into its geometry, and merge per-material → the ~300 individual prop draws collapse to **~12 draws** (biggest single draw-call win in the whole plan; flames/lights stay separate).
- **Point-light budget:** keep building all PointLights but each frame set `light.visible = distSq(light, player) < 55²` and cap to nearest `GFX.maxPointLights` (sort is over ~20 lights, trivial). Forward renderer shader cost stays bounded.

**Screenshot check:** town at dusk angle — roofs/walls show relief, blades gleam, fire lights pool correctly.

---

## Step 9 — VFX bloom tuning (`vfx.ts`, renderer.ts portals/flames)

With threshold 0.85 bloom, push HDR values where glow is wanted (composer target is HalfFloat, colors >1 are preserved):
- Projectile core spawn: `this.tmpColor.multiplyScalar(2.5)` for the bright core particle (line ~271), 1.4 for trail; nova/impact bursts ×1.6; heal/levelup pillars ×1.8.
- Points fragment already outputs additive discs — no shader change needed, just HDR colors.
- Portal swirl `MeshBasicMaterial.color` ×2 (`setHex(tint)` → `.multiplyScalar(2)`), flame cone emissiveIntensity 1.4 → 2.2, kobold candle 1.2 → 2.0, staff orbs 0.6 → 1.5, sun sprites: drop the big 190-radius halo opacity to 0.35 (bloom now does that job).
- Selection ring + quest sparkles: ×1.5 — subtle gold glow.

**Screenshot check:** fireball at night-ish dungeon = glowing comet w/ halo; no full-screen white blowout (if so, raise threshold to 0.95 before touching strength).

---

## Step 10 — Perf budget, lowgfx matrix, verification

**Frame budget @ 60fps (16.6ms), 1080p × pixelRatio 1.75, decent laptop (Apple M-series/GTX1650-class):**

| Stage | Budget |
|---|---|
| Scene render (forward, shadows) | ≤ 7ms |
| Shadow map pass | ≤ 1.5ms (tight 50u ortho, 4096) |
| GTAO (ultra only) | ≤ 3ms — else cut |
| Bloom | ≤ 1.2ms |
| Output + grade | ≤ 0.5ms |

**Draw calls / tris (high tier, current world → 3x world):**
- Terrain chunks: 36 → 121 built, ~25-40 in frustum; ≤ 350k tris visible.
- Trees/rocks: 8 instanced draws → ~30 (region buckets); ~150k tris.
- Grass ring: 1 draw, ~3000 instances × 4 tris = 12k tris (constant regardless of world size).
- Merged props: ~12 draws; rigs ~60 entities × ~15 meshes ≈ 900 draws worst case in town — material dedupe makes these cheap (same program/uniform sets); if profiling shows CPU-bound, follow-up: per-rig `mergeGeometries` of static parts (out of scope now).
- Water 1, sky 1, sprites ~35, VFX 1. **Total target: < 300 draws typical, < 1.2M tris visible.**

**3x world doesn't 3x cost because:** terrain/tree cost is frustum-culled chunks (camera sees the same area), grass is player-radius, props merge per settlement (each hub ~12 draws, culled by bounding sphere), water plane vertex count fixed, fog far plane 470 unchanged.

**`?lowgfx` (must remain playable on weak iGPUs):** no composer (direct render, MSAA via `antialias:true`), pixelRatio 1, Lambert materials (factory switch — splat/wind/rim/IBL all skipped since they hang off Standard/onBeforeCompile registrations that gfx.ts gates), vertex-color terrain (current look) but still chunked (culling helps low most), 1024 shadows (consider shadows fully off if <50fps), grass R=45 step 3.2, 10 clouds, 3 point lights, Phong water, canvas-gradient sky. Net: lowgfx gets *faster* than today (chunk culling + pixelRatio already 1).

**Verification cadence:** every step lands as its own commit; screenshot from 3 fixed vantage points (town center, lake shore, crypt interior — add a tiny `?campos=` dev param to place the camera deterministically for the E2E screenshot script) plus `webgl.info.render` (calls/triangles) logged once on demand via `?gfxstats`. Steps 1-2 before 4-8 so material migration is judged under final lighting; Step 3 is pure additions; each later step touches one file cluster and can be reverted independently.

**Files: new** `src/render/gfx.ts`, `post.ts`, `terrain.ts`, `water.ts`, `foliage.ts`; **modified** `renderer.ts` (slims down: terrain/grass/deco builders move out), `textures.ts`, `models.ts`, `props.ts`, `vfx.ts`. No sim/`src/sim/*` changes except the future `biomeAt()` export hook in `src/sim/world.ts` (zone work owns it; renderer is ready the day it returns more than 'vale').