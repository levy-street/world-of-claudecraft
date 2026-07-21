import * as THREE from 'three';
import { EFFECTS_QUALITY_LOW_CUTOFF } from '../game/ui_effects_profile';
import { isSoftwareRendererName } from './software_renderer';

// Quality tiers: every tier-dependent knob keys off this module instead of
// scattered LOW_GFX ternaries.
//
// Resolution order:
//   1. '?lowgfx' (legacy flag) or '?gfx=low'  -> low
//   2. '?gfx=medium' / '?gfx=high' / '?gfx=ultra' -> that tier, EVEN on software GL
//      (headless screenshot verification: stills render slowly but correctly)
//   3. an explicit persisted graphics preset -> that tier
//   4. no persisted preset (first boot / inconclusive detection) -> DEVICE-AWARE default via
//      resolveDefaultGraphicsPreset (recognized weak/software -> low, strong desktop -> high/ultra,
//      anything unrecognized -> medium), so the 3D tier matches the medium data-fx-level fallback

export type GfxTier = 'low' | 'medium' | 'high' | 'ultra';
export const GFX_CONFIG_VERSION = 15;

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

export type GfxBucketId = (typeof GFX_BUCKET_IDS)[number];
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
  hardwareConcurrency?: number;
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
  /**
   * Memory-ceiling profile for phone-class browsers (see isConstrainedBrowser). iOS WebKit
   * (Safari AND the native WKWebView shell: every iOS browser shares the engine) kills the
   * whole WebContent process when a tab crosses its per-process memory limit, and the world
   * entry's synchronous scene build is the allocation spike that crosses it. When set, the
   * tier sheds the biggest one-shot GPU allocations (shadow-map resolution, composer MSAA,
   * pixel-ratio cap, backdrop mips, deferred IBL prefilter) WITHOUT changing what the player
   * can see or react to: every knob here is cosmetic sharpness only (fairness rule).
   */
  readonly constrainedMemory: boolean;
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

// Corroborating-signal thresholds for resolveDefaultGraphicsPreset. Chromium clamps
// navigator.deviceMemory to a max of 8 (GiB) and WebKit caps hardwareConcurrency at 8 on
// macOS, so 8 is the practical "ample" ceiling on both axes; these only ever RAISE a tier or
// break a tie, never demote (see resolveDefaultGraphicsPreset).
const AMPLE_DEVICE_MEMORY_GIB = 8;
const AMPLE_LOGICAL_CORES = 8;

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
    worldStreaming: {
      min: 0.25,
      baseline: 0.5,
      max: 0.68,
      roi: 0.62,
      cost: 'cpu',
      governable: true,
    },
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
    worldStreaming: {
      min: 0.42,
      baseline: 0.7,
      max: 0.82,
      roi: 0.62,
      cost: 'cpu',
      governable: true,
    },
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
    worldStreaming: {
      min: 0.55,
      baseline: 0.88,
      max: 1.0,
      roi: 0.62,
      cost: 'cpu',
      governable: true,
    },
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

export function graphicsPresetLabel(
  value: number | undefined,
): 'low' | 'medium' | 'high' | 'ultra' | 'advanced' {
  switch (Math.round(value ?? DEFAULT_PRESET)) {
    case PRESET_LOW:
      return 'low';
    case PRESET_MEDIUM:
      return 'medium';
    case PRESET_HIGH:
      return 'high';
    case PRESET_ULTRA:
      return 'ultra';
    case PRESET_ADVANCED:
      return 'advanced';
    default:
      return 'low';
  }
}

export function shouldUseAutoGovernor(tier: GfxTier, search: string): boolean {
  const params = new URLSearchParams(search);
  const override = params.get('governor') ?? params.get('autoGovernor');
  if (override === '1' || override === 'true' || override === 'on') return true;
  if (override === '0' || override === 'false' || override === 'off') return false;
  // The runtime governor adapts every non-ultra tier; ultra opts out (the player explicitly maxed
  // it, or a recognized strong desktop auto-resolved there). Keying off the RESOLVED tier, not the
  // raw preset, keeps the governor ON for a first-run inconclusive device (the medium fallback) so
  // it can step quality down, instead of being silently opted out by an unset-preset -> ultra label.
  return tier !== 'ultra';
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

function settingsFor(tier: GfxTier, hints?: Partial<GfxRuntimeHints>): GfxSettings {
  const bucketBands = GFX_BUCKET_BANDS[tier];
  const weakIntegratedGpu = isWeakIntegratedGpu(hints?.gpuRenderer);
  // Phone-class browsers live under a hard per-process memory ceiling (iOS WebKit evicts the
  // WebContent process outright); shed the largest one-shot GPU allocations there. Shadow-map
  // texels, MSAA, and DPR are cosmetic sharpness only, so this never crosses the
  // graphics-settings fairness line.
  const constrainedMemory = isConstrainedBrowser({
    deviceMemory: hints?.deviceMemory,
    maxTouchPoints: hints?.maxTouchPoints ?? 0,
    coarsePointer: hints?.coarsePointer ?? false,
    narrowViewport: hints?.narrowViewport ?? false,
  });
  let settings: GfxSettings = {
    graphicsConfigVersion: GFX_CONFIG_VERSION,
    tier,
    bucketBands,
    bucketBaselines: bucketBaselines(bucketBands),
    budget: GFX_BUDGETS[tier],
    autoGovernor: shouldUseAutoGovernor(tier, hints?.search ?? ''),
    composer: tier === 'high' || tier === 'ultra',
    // N8AO runs on both composer tiers: half-res + Low quality on high keeps
    // it ~1ms-class on real GPUs; ultra gets full-res Medium
    ao: tier === 'high' || tier === 'ultra',
    msaaSamples: (tier === 'high' || tier === 'ultra') && !constrainedMemory ? 4 : 0,
    pixelRatioCap: constrainedMemory
      ? 1.48
      : tier === 'low' || tier === 'medium'
        ? 1.48
        : tier === 'high'
          ? 1.75
          : 2.5,
    shadowMap:
      tier === 'low'
        ? 2048
        : tier === 'medium'
          ? constrainedMemory
            ? 1536
            : 2560
          : constrainedMemory
            ? 2048
            : 4096,
    standardMaterials: tier === 'medium' || tier === 'high' || tier === 'ultra',
    lowPlus: tier === 'low',
    leanFoliage: tier === 'low' || (tier === 'medium' && weakIntegratedGpu),
    grassRadius: tier === 'low' ? 80 : tier === 'medium' ? 76 : 82,
    grassStep: tier === 'low' ? 2.05 : tier === 'medium' ? 2.0 : 1.8,
    terrainSplat: tier === 'medium' || tier === 'high' || tier === 'ultra',
    windSway: true,
    maxPointLights: 6,
    constrainedMemory,
  };
  if (hints?.graphicsPreset === PRESET_ADVANCED) {
    if ((hints.terrainDetail ?? 1) < 0.5) settings = { ...settings, terrainSplat: false };
    if ((hints.foliageDensity ?? 1) < 0.5)
      settings = { ...settings, grassRadius: 34, grassStep: 3.8 };
    if ((hints.effectsQuality ?? 1) < EFFECTS_QUALITY_LOW_CUTOFF)
      settings = { ...settings, composer: false, ao: false, msaaSamples: 0, maxPointLights: 3 };
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
    const raw = JSON.parse(localStorage.getItem('woc_settings') ?? 'null') as Record<
      string,
      unknown
    > | null;
    const value = raw && typeof raw === 'object' ? raw[key] : undefined;
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

// The session's GPU renderer string never changes, so probe it at most once and
// release the throwaway context immediately. runtimeHints() is called several
// times during boot (the module-load GFX best-guess, firstRunGraphicsPreset, and
// initGfxTier), and a fresh canvas context per call would ORPHAN one WebGL context
// each: browsers cap live contexts near 16, and exhausting them is exactly what
// starved the world models before the PR901 release-on-teardown fix. One probe,
// one context, lost the moment its renderer string is read, cached thereafter.
let gpuRendererProbed = false;
let probedGpuRenderer: string | undefined;

function probeGpuRenderer(): string | undefined {
  if (gpuRendererProbed) return probedGpuRenderer;
  gpuRendererProbed = true;
  probedGpuRenderer = readGpuRendererString();
  return probedGpuRenderer;
}

function readGpuRendererString(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  let gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;
  try {
    const canvas = document.createElement('canvas');
    gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!gl) return undefined;
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    return String(
      dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    );
  } catch {
    return undefined;
  } finally {
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

/** Tier explicitly requested via URL, or null when it should be auto-detected. */
export function urlForcedTier(): GfxTier | null {
  if (typeof location === 'undefined') return null;
  return forcedTierFromSearch(location.search);
}

function runtimeHints(): GfxRuntimeHints {
  const nav =
    typeof navigator !== 'undefined' ? (navigator as Navigator & { deviceMemory?: number }) : null;
  return {
    search: typeof location !== 'undefined' ? location.search : '',
    deviceMemory: nav?.deviceMemory,
    hardwareConcurrency: nav?.hardwareConcurrency,
    maxTouchPoints: nav?.maxTouchPoints ?? 0,
    coarsePointer:
      typeof matchMedia !== 'undefined' ? matchMedia('(pointer: coarse)').matches : false,
    narrowViewport:
      typeof matchMedia !== 'undefined'
        ? matchMedia('(max-width: 940px)').matches || matchMedia('(max-height: 760px)').matches
        : false,
    gpuRenderer: probeGpuRenderer(),
    graphicsPreset: storedNumericSetting('graphicsPreset'),
    terrainDetail: storedNumericSetting('terrainDetail'),
    foliageDensity: storedNumericSetting('foliageDensity'),
    effectsQuality: storedNumericSetting('effectsQuality'),
    shadowQuality: storedNumericSetting('shadowQuality'),
  };
}

export function isConstrainedBrowser(
  hints: Pick<
    GfxRuntimeHints,
    'deviceMemory' | 'maxTouchPoints' | 'coarsePointer' | 'narrowViewport'
  >,
): boolean {
  if (hints.deviceMemory !== undefined && hints.deviceMemory <= 4) return true;
  return hints.maxTouchPoints > 0 && (hints.coarsePointer || hints.narrowViewport);
}

/**
 * Coarse GPU class from the UNMASKED_RENDERER_WEBGL string, the single most reliable static
 * capability signal (RAM/cores are only weak tie-breakers, see resolveDefaultGraphicsPreset).
 * Conservative on purpose: a masked/unplaced name returns 'unknown' so the resolver falls back
 * to MEDIUM rather than guessing. Mirrors the detect-gpu name->class model (pmndrs/detect-gpu,
 * which reads UNMASKED_RENDERER_WEBGL and looks it up in an fps-per-GPU blob; we drop the blob
 * and bucket by family) plus the mobile-GPU generation ladders (Adreno 3xx-4xx/Mali-T weak ->
 * 5xx-6xx mid -> 7xx/8xx flagship; Apple A rises A14+). Test order matters: software first, then
 * the codebase's named weak-integrated parts, then strong/flagship, then mid, then old/low.
 */
export type GpuClass =
  | 'software'
  | 'strongDesktop'
  | 'flagshipMobile'
  | 'midIntegrated'
  | 'midMobile'
  | 'weak'
  | 'unknown';

export function classifyGpuRenderer(name: string | undefined): GpuClass {
  const n = (name ?? '').toLowerCase();
  if (!n) return 'unknown';
  // Software rasterizers (no real GPU): always the lowest tier. The token set lives in
  // src/render/software_renderer.ts (SOFTWARE_RENDERER_PATTERN), shared by every adapter-name
  // software detector (this, isSoftwareGL below, perf_doctor, perf_reporter) so they never disagree:
  // a string like "Apple Software Renderer" or the WARP "Microsoft Basic Render Driver" must classify
  // as software here (-> low) so the device-aware 3D tier and the data-fx-level HUD tier both land on
  // low, never one low and one medium. (n is already lowercased; the /i pattern makes that fine.)
  if (isSoftwareRendererName(n)) return 'software';
  // The older Intel integrated parts the codebase already names as weak (kept AHEAD of the
  // mid-integrated bucket so an Iris Plus 6xx / UHD 6xx / HD 5xx-6xx stays weak, consistent with
  // the existing leanFoliage treatment in settingsFor).
  if (isWeakIntegratedGpu(name)) return 'weak';
  // Strong desktop discrete + Apple Silicon. The `(\(tm\))?` tolerates the "(TM)" some Windows
  // drivers print after "Radeon" ("Radeon(TM) RX 580").
  if (
    /\b(rtx|gtx)\b|geforce|radeon(\(tm\))?\s?(rx|pro|vii)|\barc\b|\bnvidia\b|apple\s?m[1-9]/.test(n)
  )
    return 'strongDesktop';
  // Recent flagship mobile.
  if (
    /apple a(1[4-9]|[2-9]\d)|adreno \(tm\) (6[6-9]\d|7\d\d|8\d\d)|immortalis|mali-g7\d\d|xclipse/.test(
      n,
    )
  )
    return 'flagshipMobile';
  // Mid integrated (newer Intel Xe / AMD Vega-and-RDNA iGPUs / modern desktop UHD 7xx). The
  // `radeon(\(tm\))? ?` form matches Chrome's ANGLE strings ("AMD Radeon(TM) Graphics", "AMD
  // Radeon(TM) Vega 8 Graphics") and the Mesa form ("AMD Radeon Vega 8 Graphics"); strongDesktop
  // already claimed the discrete RX/Pro/VII families, so this only catches integrated Radeons.
  // UHD 6xx and older stay weak via isWeakIntegratedGpu (checked first).
  if (/iris xe|iris plus|radeon(\(tm\))? ?(vega|graphics)|uhd graphics 7\d\d|intel.*xe/.test(n))
    return 'midIntegrated';
  // Mid mobile. The Mali clause excludes G50-G52 (the entry-level Valhall parts the weak ladder
  // below claims) so they fall through to LOW; G53+ stay mid.
  if (
    /apple a1[1-3]|adreno \(tm\) (5\d\d|6[0-5]\d)|mali-g(5[3-9]|6\d|7[0-8])|powervr (gt|gm|b)/.test(
      n,
    )
  )
    return 'midMobile';
  // Old / low mobile + old integrated.
  if (
    /adreno \(tm\) [34]\d\d|mali-t|mali-4\d\d|mali-g(31|51|52)\b|powervr (sgx|g6)|apple a([5-9]|10)\b|(hd|uhd) graphics (\d{3}\b|[45]\d{2})|intel.*gma/.test(
      n,
    )
  )
    return 'weak';
  return 'unknown';
}

/**
 * The device-appropriate graphics preset (1 low .. 4 ultra) for a player who has NOT chosen one,
 * so a weak phone is not stuck on a tier it cannot run and a strong desktop is not capped below
 * what it can drive. MEDIUM (2) is the deliberate fallback whenever the signals are inconclusive
 * (the product call: a safe middle the runtime auto-governor can climb from). Pure function of
 * static device hints only (GPU name, deviceMemory, hardwareConcurrency, touch/coarse/narrow);
 * reads NO FPS governor and runs ONCE on first boot, so it never fights the runtime governor (the
 * two-controller rule). main.ts persists the result over the medium default so the 3D
 * tier, the data-fx-level applier, and the options UI all read one consistent value; an explicit
 * player preset is never passed here. Never returns ADVANCED (5): that expert custom profile is
 * opt-in, never an auto-default.
 *
 * Grounded in the standard adaptive-quality practice (detect-gpu name tiering + web.dev adaptive
 * loading), first-match-wins. CRITICAL: deviceMemory + hardwareConcurrency may only RAISE a tier
 * or break a tie, NEVER pull one down. Safari caps hardwareConcurrency (2 on iOS, 8 on macOS) and
 * Safari + Firefox omit deviceMemory entirely (Chromium-only, clamped, max ~8), so a flagship
 * iPhone reports cores=2 / mem=undefined: a low-count down-rank would wrongly bucket it low. The
 * recognized GPU class sets the floor; a masked/unknown name lands on MEDIUM. Ultra is gated
 * behind a recognized strong-desktop GPU (a masked name cannot reach it).
 */
export function resolveDefaultGraphicsPreset(hints: GfxRuntimeHints): number {
  const gpu = classifyGpuRenderer(hints.gpuRenderer);
  const mem = hints.deviceMemory; // GiB, Chromium-only (clamped, max ~8); undefined elsewhere
  const cores = hints.hardwareConcurrency; // logical cores, or undefined
  const isMobile = hints.maxTouchPoints > 0 && (hints.coarsePointer || hints.narrowViewport);
  // Corroborating RAM/core signal (or deviceMemory simply unreported, as on Firefox): only ever
  // used to RAISE the strong-desktop tier to ultra, never to demote.
  const ampleOrUnknownMem =
    mem === undefined ||
    mem >= AMPLE_DEVICE_MEMORY_GIB ||
    (cores !== undefined && cores >= AMPLE_LOGICAL_CORES);

  if (gpu === 'software' || gpu === 'weak') return PRESET_LOW;
  if (gpu === 'strongDesktop' && !isMobile) return ampleOrUnknownMem ? PRESET_ULTRA : PRESET_HIGH;
  // A strong/flagship GPU on a touch device: capped at HIGH (ultra is desktop-only) for thermals.
  if (gpu === 'flagshipMobile' || (gpu === 'strongDesktop' && isMobile)) return PRESET_HIGH;
  if (gpu === 'midIntegrated' || gpu === 'midMobile') return PRESET_MEDIUM;
  if (
    gpu === 'unknown' &&
    !isMobile &&
    mem !== undefined &&
    mem >= AMPLE_DEVICE_MEMORY_GIB &&
    cores !== undefined &&
    cores >= AMPLE_LOGICAL_CORES
  )
    return PRESET_HIGH;
  return PRESET_MEDIUM; // unknown / masked / inconclusive -> the safe middle
}

/**
 * The device-aware preset to persist on a player's FIRST run, or null when no default should be
 * written. The caller passes a dedicated `defaultAlreadyApplied` marker rather than the presence
 * of graphicsPreset in storage, because Settings.save() persists the WHOLE values object (with
 * graphicsPreset at its medium def) the first time ANY unrelated setting is written, so the key
 * is present long before the player ever chooses, and a key-presence check would silently defeat
 * detection. The caller persists the returned preset AND sets the marker, so a recognized device
 * is classified at most once and an explicit later choice is never re-detected over. A masked or
 * inconclusive device resolves to MEDIUM and returns null: it stays on the medium default and is
 * re-detected on later boots, so once its GPU becomes identifiable it can still settle on its true
 * tier instead of being pinned to medium forever (the marker is set only for a CONCLUSIVE result).
 * Pure aside from one memoized GPU probe; never reads the FPS governor.
 */
export function firstRunGraphicsPreset(defaultAlreadyApplied: boolean): number | null {
  if (defaultAlreadyApplied) return null;
  const detected = resolveDefaultGraphicsPreset(runtimeHints());
  return detected === PRESET_MEDIUM ? null : detected;
}

export function tierFromHints(hints: GfxRuntimeHints, softwareGl: boolean): GfxTier {
  const forced = forcedTierFromSearch(hints.search);
  if (forced) return forced;
  // An explicit stored preset wins. An UNSET preset (a player's first boot before main.ts persists,
  // OR a device whose detection stays inconclusive so nothing is ever persisted) resolves
  // DEVICE-AWARE through resolveDefaultGraphicsPreset (medium fallback), so the 3D render tier lands
  // on the SAME tier the data-fx-level applier derives from the medium settings default, instead of
  // silently diverging to ultra (an unrecognized first-run device rendered 3D at
  // ultra while the HUD/nameplate tier stayed medium). Software GL with no explicit preset drops to
  // the low floor (resolveDefaultGraphicsPreset already lows recognized software/weak GPUs; this
  // backstops a generic "software" renderer string the name classifier does not name). An explicit
  // preset is honored EVEN on software GL (headless screenshot verification forces a tier).
  const preset =
    hints.graphicsPreset ?? (softwareGl ? PRESET_LOW : resolveDefaultGraphicsPreset(hints));
  switch (Math.round(preset)) {
    case PRESET_LOW:
      return 'low';
    case PRESET_MEDIUM:
      return 'medium';
    case PRESET_HIGH:
      return 'high';
    case PRESET_ULTRA:
      return 'ultra';
    case PRESET_ADVANCED:
      return 'high';
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
    return String(
      dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    );
  } catch {
    return '';
  }
}

export function isSoftwareGL(webgl: THREE.WebGLRenderer): boolean {
  return isSoftwareRendererName(rendererName(webgl));
}

export function isWeakIntegratedGpu(name: string | undefined): boolean {
  const n = name ?? '';
  return (
    /intel/i.test(n) &&
    /(iris\(tm\) plus graphics 6|iris plus graphics 6|uhd graphics 6|hd graphics 5|hd graphics 6)/i.test(
      n,
    )
  );
}

// The resolved software-GL verdict from the live GL context, cached at initGfxTier
// so a player-facing "no real GPU" notice can consume it without re-probing. False
// until initGfxTier runs (module-load best-guess never had a context).
let softwareGlDetected = false;

/** True when the live WebGL context resolved to a software rasterizer (set in initGfxTier). */
export function gfxSoftwareRendering(): boolean {
  return softwareGlDetected;
}

// Best-guess settings from the URL alone (so module-load consumers see sane
// values); initGfxTier() re-resolves once the GL context exists. The renderer
// MUST call initGfxTier() right after creating its WebGLRenderer and before
// building any scene content.
export let GFX: GfxSettings = settingsFor(tierFromHints(runtimeHints(), false), runtimeHints());

export function initGfxTier(webgl: THREE.WebGLRenderer): GfxTier {
  const hints = { ...runtimeHints(), gpuRenderer: rendererName(webgl) };
  softwareGlDetected = isSoftwareGL(webgl);
  const tier = tierFromHints(hints, softwareGlDetected);
  GFX = settingsFor(tier, hints);
  return tier;
}

export const gfxInternalsForTest = {
  settingsFor,
  probeGpuRenderer,
  resetGpuRendererProbe: () => {
    gpuRendererProbed = false;
    probedGpuRenderer = undefined;
    softwareGlDetected = false;
  },
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
      .replace(
        '#include <common>',
        `#include <common>
      uniform float uRimBoost;`,
      )
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
