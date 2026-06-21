import * as THREE from 'three';

// Quality tiers: every tier-dependent knob keys off this module instead of
// scattered LOW_GFX ternaries.
//
// Resolution order:
//   1. '?lowgfx' (legacy flag) or '?gfx=low'  -> low
//   2. '?gfx=medium' / '?gfx=high' / '?gfx=ultra' -> that tier, EVEN on software GL
//      (headless screenshot verification: stills render slowly but correctly)
//   3. otherwise: persisted graphics preset, with missing values -> ultra

export type GfxTier = 'low' | 'medium' | 'high' | 'ultra';
export const GFX_CONFIG_VERSION = 14;

export const GFX_BUCKET_IDS = [
  'resolution',
  'grass',
  'foliage',
  'props',
  'lighting',
  'materials',
  'waterSky',
  'vfx',
  'characters',
  'weapons',
  'worldStreaming',
  'ui',
] as const;

export type GfxBucketId = typeof GFX_BUCKET_IDS[number];
export type GfxBucketCost = 'gpu' | 'cpu' | 'mixed';

export interface GfxBucketBand {
  readonly min: number;
  readonly baseline: number;
  readonly max: number;
  readonly roi: number;
  readonly cost: GfxBucketCost;
  readonly governable: boolean;
}

export type GfxBucketBands = Record<GfxBucketId, GfxBucketBand>;
export type GfxBucketLevels = Record<GfxBucketId, number>;

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
  readonly graphicsConfigVersion: number;
  readonly tier: GfxTier;
  readonly bucketBands: GfxBucketBands;
  readonly bucketBaselines: GfxBucketLevels;
  readonly budget: GfxRuntimeBudget;
  readonly autoGovernor: boolean;
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
  /** Art-directed low-cost profile: richer cheap-path visuals without PBR/splat shaders. */
  readonly lowPlus: boolean;
  /** Use the cheaper low-foliage density/LOD policy while keeping the rest of the tier. */
  readonly leanFoliage: boolean;
  readonly grassRadius: number;
  readonly grassStep: number;
  readonly terrainSplat: boolean;
  readonly windSway: boolean;
  readonly maxPointLights: number;
}

export interface GfxRuntimeBudget {
  readonly targetFps: number;
  readonly minRenderScaleDesktop: number;
  readonly minRenderScaleMobile: number;
  readonly maxRenderScale: number;
  readonly dropFrameMs: number;
  readonly urgentFrameMs: number;
  readonly recoverFrameMs: number;
  readonly dropStep: number;
  readonly urgentDropStep: number;
  readonly recoverStep: number;
  readonly recoverStableSeconds: number;
  readonly cooldownSeconds: number;
}

const PRESET_LOW = 1;
const PRESET_MEDIUM = 2;
const PRESET_HIGH = 3;
const PRESET_ULTRA = 4;
const PRESET_ADVANCED = 5;
const DEFAULT_PRESET = PRESET_ULTRA;

export const GFX_BUDGETS: Record<GfxTier, GfxRuntimeBudget> = {
  low: {
    targetFps: 60,
    minRenderScaleDesktop: 0.65,
    minRenderScaleMobile: 0.55,
    maxRenderScale: 1,
    dropFrameMs: 22,
    urgentFrameMs: 34,
    recoverFrameMs: 17.5,
    dropStep: 0.08,
    urgentDropStep: 0.12,
    recoverStep: 0.06,
    recoverStableSeconds: 6,
    cooldownSeconds: 1.1,
  },
  medium: {
    targetFps: 60,
    minRenderScaleDesktop: 0.72,
    minRenderScaleMobile: 0.55,
    maxRenderScale: 1,
    dropFrameMs: 24,
    urgentFrameMs: 34,
    recoverFrameMs: 17,
    dropStep: 0.1,
    urgentDropStep: 0.15,
    recoverStep: 0.05,
    recoverStableSeconds: 7,
    cooldownSeconds: 1.35,
  },
  high: {
    targetFps: 60,
    minRenderScaleDesktop: 0.7,
    minRenderScaleMobile: 0.6,
    maxRenderScale: 1,
    dropFrameMs: 22,
    urgentFrameMs: 32,
    recoverFrameMs: 15,
    dropStep: 0.1,
    urgentDropStep: 0.15,
    recoverStep: 0.05,
    recoverStableSeconds: 3,
    cooldownSeconds: 0.85,
  },
  ultra: {
    targetFps: 60,
    minRenderScaleDesktop: 0.78,
    minRenderScaleMobile: 0.68,
    maxRenderScale: 1,
    dropFrameMs: 24,
    urgentFrameMs: 34,
    recoverFrameMs: 15,
    dropStep: 0.08,
    urgentDropStep: 0.12,
    recoverStep: 0.04,
    recoverStableSeconds: 3,
    cooldownSeconds: 0.85,
  },
};

export const GFX_BUCKET_BANDS: Record<GfxTier, GfxBucketBands> = {
  low: {
    resolution: { min: 0.55, baseline: 1.0, max: 1.0, roi: 0.88, cost: 'gpu', governable: true },
    grass: { min: 0.62, baseline: 0.9, max: 1.0, roi: 0.9, cost: 'gpu', governable: true },
    foliage: { min: 0.68, baseline: 0.9, max: 1.0, roi: 0.84, cost: 'gpu', governable: true },
    props: { min: 0.35, baseline: 0.5, max: 0.62, roi: 0.58, cost: 'mixed', governable: false },
    lighting: { min: 0.78, baseline: 1.0, max: 1.0, roi: 0.72, cost: 'gpu', governable: true },
    materials: { min: 0.3, baseline: 0.45, max: 0.58, roi: 0.78, cost: 'gpu', governable: false },
    waterSky: { min: 0.35, baseline: 0.7, max: 0.8, roi: 0.82, cost: 'gpu', governable: false },
    vfx: { min: 0.84, baseline: 1.0, max: 1.0, roi: 0.9, cost: 'mixed', governable: true },
    characters: { min: 1.0, baseline: 1.0, max: 1.0, roi: 1.0, cost: 'mixed', governable: false },
    weapons: { min: 1.0, baseline: 1.0, max: 1.0, roi: 1.0, cost: 'mixed', governable: false },
    worldStreaming: { min: 0.25, baseline: 0.5, max: 0.68, roi: 0.62, cost: 'cpu', governable: true },
    ui: { min: 0.75, baseline: 0.9, max: 1.0, roi: 0.86, cost: 'cpu', governable: false },
  },
  medium: {
    resolution: { min: 0.55, baseline: 1.0, max: 1.0, roi: 0.88, cost: 'gpu', governable: true },
    grass: { min: 0.5, baseline: 0.78, max: 0.9, roi: 0.86, cost: 'gpu', governable: true },
    foliage: { min: 0.5, baseline: 0.74, max: 0.86, roi: 0.64, cost: 'gpu', governable: true },
    props: { min: 0.55, baseline: 0.7, max: 0.82, roi: 0.58, cost: 'mixed', governable: false },
    lighting: { min: 0.45, baseline: 0.72, max: 0.82, roi: 0.7, cost: 'gpu', governable: true },
    materials: { min: 0.62, baseline: 0.78, max: 0.9, roi: 0.78, cost: 'gpu', governable: false },
    waterSky: { min: 0.55, baseline: 0.78, max: 0.9, roi: 0.82, cost: 'gpu', governable: false },
    vfx: { min: 0.58, baseline: 0.8, max: 0.9, roi: 0.7, cost: 'mixed', governable: true },
    characters: { min: 0.86, baseline: 1.0, max: 1.0, roi: 1.0, cost: 'mixed', governable: false },
    weapons: { min: 1.0, baseline: 1.0, max: 1.0, roi: 1.0, cost: 'mixed', governable: false },
    worldStreaming: { min: 0.42, baseline: 0.7, max: 0.82, roi: 0.62, cost: 'cpu', governable: true },
    ui: { min: 0.82, baseline: 1.0, max: 1.0, roi: 0.86, cost: 'cpu', governable: false },
  },
  high: {
    resolution: { min: 0.6, baseline: 1.0, max: 1.0, roi: 0.88, cost: 'gpu', governable: true },
    grass: { min: 0.6, baseline: 0.88, max: 1.0, roi: 0.86, cost: 'gpu', governable: true },
    foliage: { min: 0.6, baseline: 0.9, max: 1.0, roi: 0.72, cost: 'gpu', governable: true },
    props: { min: 0.7, baseline: 0.88, max: 1.0, roi: 0.58, cost: 'mixed', governable: false },
    lighting: { min: 0.62, baseline: 0.9, max: 1.0, roi: 0.7, cost: 'gpu', governable: true },
    materials: { min: 0.75, baseline: 0.92, max: 1.0, roi: 0.78, cost: 'gpu', governable: false },
    waterSky: { min: 0.72, baseline: 0.92, max: 1.0, roi: 0.82, cost: 'gpu', governable: false },
    vfx: { min: 0.68, baseline: 0.92, max: 1.0, roi: 0.7, cost: 'mixed', governable: true },
    characters: { min: 0.9, baseline: 1.0, max: 1.0, roi: 1.0, cost: 'mixed', governable: false },
    weapons: { min: 1.0, baseline: 1.0, max: 1.0, roi: 1.0, cost: 'mixed', governable: false },
    worldStreaming: { min: 0.55, baseline: 0.88, max: 1.0, roi: 0.62, cost: 'cpu', governable: true },
    ui: { min: 0.86, baseline: 1.0, max: 1.0, roi: 0.86, cost: 'cpu', governable: false },
  },
  ultra: {
    resolution: { min: 0.68, baseline: 1.0, max: 1.0, roi: 0.88, cost: 'gpu', governable: true },
    grass: { min: 0.78, baseline: 1.0, max: 1.0, roi: 0.86, cost: 'gpu', governable: true },
    foliage: { min: 0.78, baseline: 1.0, max: 1.0, roi: 0.72, cost: 'gpu', governable: true },
    props: { min: 0.86, baseline: 1.0, max: 1.0, roi: 0.58, cost: 'mixed', governable: false },
    lighting: { min: 0.78, baseline: 1.0, max: 1.0, roi: 0.7, cost: 'gpu', governable: true },
    materials: { min: 0.86, baseline: 1.0, max: 1.0, roi: 0.78, cost: 'gpu', governable: false },
    waterSky: { min: 0.86, baseline: 1.0, max: 1.0, roi: 0.82, cost: 'gpu', governable: false },
    vfx: { min: 0.86, baseline: 1.0, max: 1.0, roi: 0.7, cost: 'mixed', governable: true },
    characters: { min: 0.94, baseline: 1.0, max: 1.0, roi: 1.0, cost: 'mixed', governable: false },
    weapons: { min: 1.0, baseline: 1.0, max: 1.0, roi: 1.0, cost: 'mixed', governable: false },
    worldStreaming: { min: 0.7, baseline: 1.0, max: 1.0, roi: 0.62, cost: 'cpu', governable: true },
    ui: { min: 0.9, baseline: 1.0, max: 1.0, roi: 0.86, cost: 'cpu', governable: false },
  },
};

function bucketBaselines(bands: GfxBucketBands): GfxBucketLevels {
  return {
    resolution: bands.resolution.baseline,
    grass: bands.grass.baseline,
    foliage: bands.foliage.baseline,
    props: bands.props.baseline,
    lighting: bands.lighting.baseline,
    materials: bands.materials.baseline,
    waterSky: bands.waterSky.baseline,
    vfx: bands.vfx.baseline,
    characters: bands.characters.baseline,
    weapons: bands.weapons.baseline,
    worldStreaming: bands.worldStreaming.baseline,
    ui: bands.ui.baseline,
  };
}

export function graphicsPresetLabel(value: number | undefined): 'low' | 'medium' | 'high' | 'ultra' | 'advanced' {
  switch (Math.round(value ?? DEFAULT_PRESET)) {
    case PRESET_LOW: return 'low';
    case PRESET_MEDIUM: return 'medium';
    case PRESET_HIGH: return 'high';
    case PRESET_ULTRA: return 'ultra';
    case PRESET_ADVANCED: return 'advanced';
    default: return 'low';
  }
}

export function shouldUseAutoGovernor(hints?: Pick<GfxRuntimeHints, 'search' | 'graphicsPreset'>): boolean {
  if (!hints) return false;
  const params = new URLSearchParams(hints.search);
  const override = params.get('governor') ?? params.get('autoGovernor');
  if (override === '1' || override === 'true' || override === 'on') return true;
  if (override === '0' || override === 'false' || override === 'off') return false;
  if (forcedTierFromSearch(hints.search) === 'ultra') return false;
  return graphicsPresetLabel(hints.graphicsPreset) !== 'ultra';
}

export function configureMaskedDoubleSidedVegetationMaterial<T extends THREE.Material>(mat: T): T {
  mat.side = THREE.DoubleSide;
  mat.transparent = false;
  mat.alphaHash = false;
  mat.forceSinglePass = true;
  mat.depthTest = true;
  mat.depthWrite = true;
  return mat;
}

function settingsFor(
  tier: GfxTier,
  hints?: Pick<GfxRuntimeHints, 'search' | 'graphicsPreset' | 'terrainDetail' | 'foliageDensity' | 'effectsQuality' | 'shadowQuality' | 'gpuRenderer'>,
): GfxSettings {
  const bucketBands = GFX_BUCKET_BANDS[tier];
  const weakIntegratedGpu = isWeakIntegratedGpu(hints?.gpuRenderer);
  let settings: GfxSettings = {
    graphicsConfigVersion: GFX_CONFIG_VERSION,
    tier,
    bucketBands,
    bucketBaselines: bucketBaselines(bucketBands),
    budget: GFX_BUDGETS[tier],
    autoGovernor: shouldUseAutoGovernor(hints),
    composer: tier === 'high' || tier === 'ultra',
    // N8AO runs on both composer tiers: half-res + Low quality on high keeps
    // it ~1ms-class on real GPUs; ultra gets full-res Medium
    ao: tier === 'high' || tier === 'ultra',
    msaaSamples: tier === 'high' || tier === 'ultra' ? 4 : 0,
    pixelRatioCap: tier === 'low' ? 1.48 : tier === 'medium' ? 1.48 : tier === 'high' ? 1.75 : 2.5,
    shadowMap: tier === 'low' ? 2048 : tier === 'medium' ? 2560 : 4096,
    standardMaterials: tier === 'medium' || tier === 'high' || tier === 'ultra',
    lowPlus: tier === 'low',
    leanFoliage: tier === 'low' || (tier === 'medium' && weakIntegratedGpu),
    grassRadius: tier === 'low' ? 80 : tier === 'medium' ? 76 : 82,
    grassStep: tier === 'low' ? 2.05 : tier === 'medium' ? 2.0 : 1.8,
    terrainSplat: tier === 'medium' || tier === 'high' || tier === 'ultra',
    windSway: true,
    maxPointLights: 6,
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
  switch (Math.round(hints.graphicsPreset ?? DEFAULT_PRESET)) {
    case PRESET_LOW: return 'low';
    case PRESET_MEDIUM: return 'medium';
    case PRESET_HIGH: return 'high';
    case PRESET_ULTRA: return 'ultra';
    case PRESET_ADVANCED: return 'high';
  }
  return 'low';
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

export function initGfxTier(webgl: THREE.WebGLRenderer): GfxTier {
  const hints = { ...runtimeHints(), gpuRenderer: rendererName(webgl) };
  const tier = tierFromHints(hints, isSoftwareGL(webgl));
  GFX = settingsFor(tier, hints);
  return tier;
}

export const gfxInternalsForTest = {
  settingsFor,
};

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
