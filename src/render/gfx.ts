import * as THREE from 'three';

// Quality tiers: every tier-dependent knob keys off this module instead of
// scattered LOW_GFX ternaries.
//
// Resolution order:
//   1. '?lowgfx' (legacy flag) or '?gfx=low'  -> low
//   2. '?gfx=medium' / '?gfx=high' / '?gfx=ultra' -> that tier, EVEN on software GL
//      (headless screenshot verification: stills render slowly but correctly)
//   3. otherwise: phone-class / low-memory browsers -> low
//   4. otherwise: software GL (SwiftShader/llvmpipe) -> low, real GPUs -> high

export type GfxTier = 'low' | 'medium' | 'high' | 'ultra';

export interface GfxRuntimeHints {
  search: string;
  deviceMemory?: number;
  maxTouchPoints: number;
  coarsePointer: boolean;
  narrowViewport: boolean;
  gpuRenderer?: string;
  graphicsPreset?: number;
  terrainDetail?: number;
  foliageDensity?: number;
  effectsQuality?: number;
  shadowQuality?: number;
}

export interface GfxSettings {
  readonly tier: GfxTier;
  /** post-processing chain (N8AO + bloom + grade) */
  readonly composer: boolean;
  /** N8AO screen-space ambient occlusion pass */
  readonly ao: boolean;
  /** MSAA samples on the composer's HalfFloat target (WebGL2) */
  readonly msaaSamples: number;
  /** devicePixelRatio is capped here — 2.5 everywhere is a silent perf killer */
  readonly pixelRatioCap: number;
  readonly shadowMap: number;
  /** PBR MeshStandardMaterial; low keeps Lambert */
  readonly standardMaterials: boolean;
  readonly grassRadius: number;
  readonly grassStep: number;
  readonly terrainSplat: boolean;
  readonly windSway: boolean;
  readonly maxPointLights: number;
}

const PRESET_AUTO = 0;
const PRESET_LOW = 1;
const PRESET_MEDIUM = 2;
const PRESET_HIGH = 3;
const PRESET_ULTRA = 4;
const PRESET_ADVANCED = 5;

function settingsFor(
  tier: GfxTier,
  hints?: Pick<GfxRuntimeHints, 'graphicsPreset' | 'terrainDetail' | 'foliageDensity' | 'effectsQuality' | 'shadowQuality'>,
): GfxSettings {
  let settings: GfxSettings = {
    tier,
    composer: tier === 'high' || tier === 'ultra',
    // N8AO runs on both composer tiers: half-res + Low quality on high keeps
    // it ~1ms-class on real GPUs; ultra gets full-res Medium
    ao: tier === 'high' || tier === 'ultra',
    msaaSamples: tier === 'high' || tier === 'ultra' ? 4 : 0,
    pixelRatioCap: tier === 'low' ? 1.48 : tier === 'medium' ? 1.48 : tier === 'high' ? 1.75 : 2.5,
    shadowMap: tier === 'low' ? 2048 : tier === 'medium' ? 2560 : 4096,
    standardMaterials: tier === 'medium' || tier === 'high' || tier === 'ultra',
    grassRadius: tier === 'low' ? 70 : tier === 'medium' ? 70 : 82, // low/mobile prioritizes fill/alpha cost over meadow density
    grassStep: tier === 'low' ? 2.15 : tier === 'medium' ? 2.15 : 1.8,
    terrainSplat: tier === 'medium' || tier === 'high' || tier === 'ultra',
    windSway: tier === 'medium' || tier === 'high' || tier === 'ultra',
    maxPointLights: tier === 'low' ? 5 : 6,
  };
  if (hints?.graphicsPreset === PRESET_ADVANCED) {
    if ((hints.terrainDetail ?? 1) < 0.5) settings = { ...settings, terrainSplat: false };
    if ((hints.foliageDensity ?? 1) < 0.5) settings = { ...settings, grassRadius: 34, grassStep: 3.8 };
    if ((hints.effectsQuality ?? 1) < 0.5) settings = { ...settings, composer: false, ao: false, msaaSamples: 0, maxPointLights: 3 };
    if ((hints.shadowQuality ?? 1) < 0.5) settings = { ...settings, shadowMap: 1024 };
  }
  return settings;
}

export function forcedTierFromSearch(search: string): GfxTier | null {
  const params = new URLSearchParams(search);
  if (params.has('lowgfx')) return 'low';
  const g = params.get('gfx');
  return g === 'low' || g === 'medium' || g === 'high' || g === 'ultra' ? g : null;
}

function storedNumericSetting(key: string): number | undefined {
  if (typeof localStorage === 'undefined') return undefined;
  try {
    const raw = JSON.parse(localStorage.getItem('woc_settings') ?? 'null') as Record<string, unknown> | null;
    const value = raw && typeof raw === 'object' ? raw[key] : undefined;
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function probeGpuRenderer(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!gl) return undefined;
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    return String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  } catch {
    return undefined;
  }
}

/** Tier explicitly requested via URL, or null when it should be auto-detected. */
export function urlForcedTier(): GfxTier | null {
  if (typeof location === 'undefined') return null;
  return forcedTierFromSearch(location.search);
}

function runtimeHints(): GfxRuntimeHints {
  const nav = typeof navigator !== 'undefined'
    ? navigator as Navigator & { deviceMemory?: number }
    : null;
  return {
    search: typeof location !== 'undefined' ? location.search : '',
    deviceMemory: nav?.deviceMemory,
    maxTouchPoints: nav?.maxTouchPoints ?? 0,
    coarsePointer: typeof matchMedia !== 'undefined' ? matchMedia('(pointer: coarse)').matches : false,
    narrowViewport: typeof matchMedia !== 'undefined'
      ? (matchMedia('(max-width: 940px)').matches || matchMedia('(max-height: 760px)').matches)
      : false,
    gpuRenderer: probeGpuRenderer(),
    graphicsPreset: storedNumericSetting('graphicsPreset'),
    terrainDetail: storedNumericSetting('terrainDetail'),
    foliageDensity: storedNumericSetting('foliageDensity'),
    effectsQuality: storedNumericSetting('effectsQuality'),
    shadowQuality: storedNumericSetting('shadowQuality'),
  };
}

export function isConstrainedBrowser(hints: GfxRuntimeHints): boolean {
  if (hints.deviceMemory !== undefined && hints.deviceMemory <= 4) return true;
  return hints.maxTouchPoints > 0 && (hints.coarsePointer || hints.narrowViewport);
}

export function tierFromHints(hints: GfxRuntimeHints, softwareGl: boolean): GfxTier {
  const forced = forcedTierFromSearch(hints.search);
  if (forced) return forced;
  switch (Math.round(hints.graphicsPreset ?? PRESET_AUTO)) {
    case PRESET_LOW: return 'low';
    case PRESET_MEDIUM: return 'medium';
    case PRESET_HIGH: return 'high';
    case PRESET_ULTRA: return 'ultra';
    case PRESET_ADVANCED: return 'high';
  }
  return softwareGl || isConstrainedBrowser(hints) || isWeakIntegratedGpu(hints.gpuRenderer) ? 'low' : 'high';
}

// Software GL (SwiftShader/llvmpipe — headless test runners, VMs) can't take
// the full pipeline at speed; drop to the lowgfx path automatically unless the
// URL forces a tier.
function rendererName(webgl: THREE.WebGLRenderer): string {
  try {
    const gl = webgl.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    return String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  } catch {
    return '';
  }
}

export function isSoftwareGL(webgl: THREE.WebGLRenderer): boolean {
  return /swiftshader|llvmpipe|software/i.test(rendererName(webgl));
}

export function isWeakIntegratedGpu(name: string | undefined): boolean {
  const n = name ?? '';
  return /intel/i.test(n) && /(iris\(tm\) plus graphics 6|iris plus graphics 6|uhd graphics 6|hd graphics 5|hd graphics 6)/i.test(n);
}

// Best-guess settings from the URL alone (so module-load consumers see sane
// values); initGfxTier() re-resolves once the GL context exists. The renderer
// MUST call initGfxTier() right after creating its WebGLRenderer and before
// building any scene content.
export let GFX: GfxSettings = settingsFor(tierFromHints(runtimeHints(), false), runtimeHints());

// Device max anisotropic-filtering samples, resolved once the GL context exists
// (initGfxTier). 0 = not yet resolved: boot-time texture preloads (terrain/water)
// run BEFORE the Renderer is constructed, so anisotropic() must NOT clamp against
// a stale value then — it falls back to the requested level, which GL itself
// clamps to the hardware max on upload (see anisotropyLevel).
export let maxAnisotropy = 0;

export function initGfxTier(webgl: THREE.WebGLRenderer): GfxTier {
  const hints = { ...runtimeHints(), gpuRenderer: rendererName(webgl) };
  const tier = tierFromHints(hints, isSoftwareGL(webgl));
  GFX = settingsFor(tier, hints);
  try {
    maxAnisotropy = webgl.capabilities.getMaxAnisotropy();
  } catch {
    maxAnisotropy = 0;
  }
  return tier;
}

// Pure anisotropy-level decision (no GL/texture state) — unit-testable and
// independent of init ordering:
//   - low tier pays nothing (1)
//   - once the GL max is known (>0), clamp the request to it
//   - before it is known (max === 0, e.g. boot preload runs pre-initGfxTier),
//     use the request as-is — GL clamps it to the hardware limit on upload, so
//     this never over-spends. (The old per-site code set raw values the same way.)
export function anisotropyLevel(tier: GfxTier, max: number, requested: number): number {
  if (tier === 'low') return 1;
  return max > 0 ? Math.min(requested, max) : requested;
}

// Anisotropic filtering for repeat-wrapped / mipmapped surfaces (terrain splat,
// water normals, tiling canvas textures) — kills the grazing-angle shimmer the
// anti-tiling craft otherwise leaves on the table. Returns the texture so callers
// can chain; set needsUpdate yourself if the texture is already uploaded.
export function anisotropic<T extends THREE.Texture>(tex: T, requested = 8): T {
  tex.anisotropy = anisotropyLevel(GFX.tier, maxAnisotropy, requested);
  return tex;
}

// One clock uniform shared by every onBeforeCompile shader (wind, water,
// grade grain). The renderer ticks it once per frame in sync(). uRimBoost
// scales the character rim glow (raised inside dungeons so silhouettes
// separate from the murk).
export const sharedUniforms = {
  uTime: { value: 0 },
  uRimBoost: { value: 1 },
};

// The one sun. Everything that needs the sun's position/direction (key light,
// shadow frustum offset, sky glow lobe, water glints, god rays) reads these —
// editing one consumer used to silently desync the others.
export const SUN_ANCHOR = new THREE.Vector3(90, 140, 50);
export const SUN_DIR = SUN_ANCHOR.clone().normalize();

export interface SurfaceMatOpts {
  color?: number;
  map?: THREE.Texture;
  normalMap?: THREE.Texture;
  /** PBR roughness map (high/ultra only; ignored on the Lambert tier) */
  roughnessMap?: THREE.Texture;
  /** baked AO map — needs uv2 on the geometry (high/ultra only) */
  aoMap?: THREE.Texture;
  roughness?: number;
  metalness?: number;
  flatShading?: boolean;
  emissive?: number;
  emissiveIntensity?: number;
  side?: THREE.Side;
  /** subtle cool fresnel rim glow — sells silhouettes against dark ground */
  rim?: boolean;
}

// Shared fresnel rim emissive for character rigs (high/ultra only; Lambert on
// low has no per-fragment view vector worth paying for). uRimBoost lets the
// renderer crank the rim inside dungeons.
export function addRimGlow(mat: THREE.Material): void {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uRimBoost = sharedUniforms.uRimBoost;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
      uniform float uRimBoost;`)
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
      totalEmissiveRadiance += vec3(0.5, 0.6, 0.8) * 0.12 * uRimBoost *
        pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 3.0);`,
      );
  };
}

// Material factory: dedupes by (color|maps|flags) so hundreds of small box
// meshes share a few dozen programs/uniform sets. Standard on high/ultra,
// Lambert on low.
const matCache = new Map<string, THREE.Material>();

export function surfaceMat(opts: SurfaceMatOpts): THREE.Material {
  const key = JSON.stringify({
    ...opts,
    map: opts.map?.uuid,
    normalMap: opts.normalMap?.uuid,
    roughnessMap: opts.roughnessMap?.uuid,
    aoMap: opts.aoMap?.uuid,
    std: GFX.standardMaterials,
  });
  const cached = matCache.get(key);
  if (cached) return cached;
  const mat = GFX.standardMaterials
    ? new THREE.MeshStandardMaterial({
      color: opts.color ?? 0xffffff,
      map: opts.map ?? null,
      normalMap: opts.normalMap ?? null,
      roughnessMap: opts.roughnessMap ?? null,
      aoMap: opts.aoMap ?? null,
      roughness: opts.roughness ?? 0.85,
      metalness: opts.metalness ?? 0,
      flatShading: opts.flatShading ?? false,
      emissive: opts.emissive ?? 0x000000,
      emissiveIntensity: opts.emissiveIntensity ?? 1,
      side: opts.side ?? THREE.FrontSide,
    })
    : new THREE.MeshLambertMaterial({
      color: opts.color ?? 0xffffff,
      map: opts.map ?? null,
      flatShading: opts.flatShading ?? false,
      emissive: opts.emissive ?? 0x000000,
      emissiveIntensity: opts.emissiveIntensity ?? 1,
      side: opts.side ?? THREE.FrontSide,
    });
  if (opts.rim && GFX.standardMaterials) addRimGlow(mat);
  matCache.set(key, mat);
  return mat;
}
