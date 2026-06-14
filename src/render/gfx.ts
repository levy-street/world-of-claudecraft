import * as THREE from 'three';

// Quality tiers: every tier-dependent knob keys off this module instead of
// scattered LOW_GFX ternaries.
//
// Resolution order:
//   1. '?lowgfx' (legacy flag) or '?gfx=low'  -> low
//   2. '?gfx=high' / '?gfx=ultra'             -> that tier, EVEN on software GL
//      (headless screenshot verification: stills render slowly but correctly)
//   3. otherwise: phone-class / low-memory browsers -> low
//   4. otherwise: software GL (SwiftShader/llvmpipe) -> low, real GPUs -> high

export type GfxTier = 'low' | 'high' | 'ultra';

export interface GfxRuntimeHints {
  search: string;
  deviceMemory?: number;
  maxTouchPoints: number;
  coarsePointer: boolean;
  narrowViewport: boolean;
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

function settingsFor(tier: GfxTier): GfxSettings {
  return {
    tier,
    composer: tier !== 'low',
    // N8AO runs on both composer tiers: half-res + Low quality on high keeps
    // it ~1ms-class on real GPUs; ultra gets full-res Medium
    ao: tier !== 'low',
    msaaSamples: tier === 'low' ? 0 : 4,
    pixelRatioCap: tier === 'low' ? 1 : tier === 'high' ? 1.75 : 2.5,
    shadowMap: tier === 'low' ? 1024 : 4096,
    standardMaterials: tier !== 'low',
    grassRadius: tier === 'low' ? 34 : 82, // low/mobile prioritizes fill/alpha cost over meadow density
    grassStep: tier === 'low' ? 3.8 : 1.8,
    terrainSplat: tier !== 'low',
    windSway: tier !== 'low',
    maxPointLights: tier === 'low' ? 3 : 6,
  };
}

export function forcedTierFromSearch(search: string): GfxTier | null {
  const params = new URLSearchParams(search);
  if (params.has('lowgfx')) return 'low';
  const g = params.get('gfx');
  return g === 'low' || g === 'high' || g === 'ultra' ? g : null;
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
  };
}

export function isConstrainedBrowser(hints: GfxRuntimeHints): boolean {
  if (hints.deviceMemory !== undefined && hints.deviceMemory <= 4) return true;
  return hints.maxTouchPoints > 0 && (hints.coarsePointer || hints.narrowViewport);
}

export function tierFromHints(hints: GfxRuntimeHints, softwareGl: boolean): GfxTier {
  return forcedTierFromSearch(hints.search) ?? (softwareGl || isConstrainedBrowser(hints) ? 'low' : 'high');
}

// Software GL (SwiftShader/llvmpipe — headless test runners, VMs) can't take
// the full pipeline at speed; drop to the lowgfx path automatically unless the
// URL forces a tier.
export function isSoftwareGL(webgl: THREE.WebGLRenderer): boolean {
  try {
    const gl = webgl.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    return /swiftshader|llvmpipe|software/i.test(name);
  } catch {
    return false;
  }
}

// Best-guess settings from the URL alone (so module-load consumers see sane
// values); initGfxTier() re-resolves once the GL context exists. The renderer
// MUST call initGfxTier() right after creating its WebGLRenderer and before
// building any scene content.
export let GFX: GfxSettings = settingsFor(tierFromHints(runtimeHints(), false));

export function initGfxTier(webgl: THREE.WebGLRenderer): GfxTier {
  const tier = tierFromHints(runtimeHints(), isSoftwareGL(webgl));
  GFX = settingsFor(tier);
  return tier;
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
