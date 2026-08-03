import * as THREE from 'three';
import { NATIVE_APP } from '../client_origin';
import { tightMemoryDeviceHint } from '../device_memory_hint';
import {
  type GraphicsSettingsSnapshot,
  normalizeGraphicsSettingsSnapshot,
} from '../game/graphics_rebuild_core';
import { safeStartupGraphicsPreset } from '../game/startup_graphics_safety';
import { EFFECTS_QUALITY_LOW_CUTOFF } from '../game/ui_effects_profile';
import { FAR_ANIM_RANGE_SCALE_MAX } from './crowd_lod';
import { gfxAaPolicy } from './gfx_aa_policy_core';
import { applyGfxOverridesFromSearch } from './gfx_override_core';
import {
  installPbrPointLightShaderPruning,
  patchPbrRimGlowFragmentShader,
} from './pbr_fragment_shader';
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

export type GfxTier = 'low' | 'medium' | 'high' | 'ultra' | 'insane';

// Monotone tier ladder: every tier-gated knob compares RANKS through
// gfxTierAtLeast instead of scattering string comparisons, so inserting a tier
// (insane, above ultra) cannot silently drop a gate that spelled out
// `=== 'ultra'`. Keep the ladder monotone: every knob at rank N+1 must be >=
// its rank-N value.
export const GFX_TIER_RANK: Record<GfxTier, number> = {
  low: 0,
  medium: 1,
  high: 2,
  ultra: 3,
  insane: 4,
};

/** True when `tier` sits at or above `floor` on the quality ladder. */
export function gfxTierAtLeast(tier: GfxTier, floor: GfxTier): boolean {
  return GFX_TIER_RANK[tier] >= GFX_TIER_RANK[floor];
}
// v20: High uses the reduced fixed-layer profile and the composer governor
// consumes truthful logical-frame draw stats. Fleet dashboards segment these
// semantics from the v19 relaxed scenery contract.
export const GFX_CONFIG_VERSION = 20;

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
  nativeApp?: boolean;
  /** 4 GB-class device or a fresh entry-crash marker (src/device_memory_hint.ts). */
  tightMemory?: boolean;
  platform?: 'ios' | 'android' | 'other';
  graphicsPreset?: number;
  terrainDetail?: number;
  foliageDensity?: number;
  effectsQuality?: number;
  shadowQuality?: number;
  surfaceDetail?: number;
}

export interface GfxCapabilities {
  readonly deviceMemory?: number;
  readonly hardwareConcurrency?: number;
  readonly maxTouchPoints: number;
  readonly coarsePointer: boolean;
  readonly narrowViewport: boolean;
  readonly gpuRenderer?: string;
  readonly nativeApp: boolean;
  readonly tightMemory: boolean;
  readonly platform: 'ios' | 'android' | 'other';
  readonly softwareRendering: boolean;
}

export interface GfxSettings {
  readonly graphicsConfigVersion: number;
  readonly tier: GfxTier;
  /** Static presentation tier for optional effects controlled by the preset/sub-knob. */
  readonly effectsTier: GfxTier;
  readonly tightMemory: boolean;
  readonly bucketBands: GfxBucketBands;
  readonly bucketBaselines: GfxBucketLevels;
  readonly budget: GfxRuntimeBudget;
  readonly autoGovernor: boolean;
  /** post-processing chain (N8AO + bloom + grade) */
  readonly composer: boolean;
  /**
   * Grade-only mini composer (RenderPass -> OutputPass -> grade) for tiers
   * without the full chain. Costs one fullscreen pass; brings the cinematic
   * lift/gain/vignette to medium, which otherwise renders raw ACES and reads
   * washed-bright next to the graded tiers. Implied by `composer`; only
   * meaningful when `composer` is false. NOTE: emissive intensities across
   * the codebase key off `composer` (it means "bloom exists"), while this flag
   * deliberately does not change them.
   */
  readonly gradePass: boolean;
  /** N8AO screen-space ambient occlusion pass */
  readonly ao: boolean;
  /** MSAA samples on the composer's HalfFloat target (WebGL2) */
  readonly msaaSamples: number;
  /** devicePixelRatio is capped here because unbounded supersampling is a fill-rate cost */
  readonly pixelRatioCap: number;
  /** Directional sun shadow pass. Disabled where its duplicate scene draw is unsafe. */
  readonly dynamicShadows: boolean;
  readonly shadowMap: number;
  /** PBR MeshStandardMaterial; low keeps Lambert */
  readonly standardMaterials: boolean;
  // -------------------------------------------------------------------------
  // Round-10 granular detail knobs. The graphics-overhaul layers cost real
  // frame budget, so each one keys off its OWN derived knob here (never a
  // scattered tier comparison in a render module): the tier ladder sets the
  // monotone defaults below (High uses the reduced Advanced-Medium profile;
  // the full layers start at Ultra), and the Advanced preset's sub-settings
  // remap the same knobs level by level (see the PRESET_ADVANCED branch).
  // -------------------------------------------------------------------------
  /** worn_stone.ts triplanar surface-detail family layer (fetches + application) */
  readonly surfaceDetail: boolean;
  /** worn-layer parallax refinement taps per fragment (0 = no parallax walk) */
  readonly surfaceDetailTaps: number;
  /** worn-layer share of the full 2.2sd parallax offset clamp (0..1) */
  readonly surfaceDetailClampK: number;
  /** blade-grass carpet radius in world units; 0 disables the carpet */
  readonly bladeCarpetRadius: number;
  /** cliff-scree rubble scatter (visual dressing; the sim dome is tier-free) */
  readonly cliffScree: boolean;
  /** canopy clump-detail layer (canopy_detail.ts) */
  readonly canopyDetail: boolean;
  /** terrain relief ladder: 0 none, 1 cavity shade, 2 +parallax walk, 3 +micro sun-shadow */
  readonly terrainRelief: number;
  /** N8AO at full resolution + Medium quality (vs half-res Low) */
  readonly aoFullRes: boolean;
  /** SMAA tail pass on the grade/composer output */
  readonly smaa: boolean;
  /** UnrealBloom pass on the composer */
  readonly bloom: boolean;
  /** terrain meshes cast into the sun shadow map */
  readonly terrainCastShadows: boolean;
  /** Art-directed low-cost profile: richer cheap-path visuals without PBR/splat shaders. */
  readonly lowPlus: boolean;
  /** Use the cheaper low-foliage density/LOD policy while keeping the rest of the tier. */
  readonly leanFoliage: boolean;
  readonly grassRadius: number;
  readonly grassStep: number;
  /** Stable-prefix floor for grass cards already inside their far alpha-fade band. */
  readonly farGrassDensityFloor: number;
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
  /** Packaged iOS WKWebView profile that bounds retained GPU resources independently of FPS. */
  readonly nativeIosMemoryProfile: boolean;
  /** Global cap for inactive skinned character rigs retained for reuse. */
  readonly maxPooledCharacterVisuals: number;
  /**
   * Linear range multiplier for the animated far character band (`crowd_lod.ts`):
   * how much further than the articulated band a rig keeps animating at a low
   * cadence before it collapses to the frozen single-draw far mesh. 1 keeps the
   * pre-existing straight-to-frozen behaviour, which is what phone-class and
   * software profiles want; the crowd knee and the frame-budget pressure ease it
   * back to 1 on their own, so this is only the per-tier ceiling.
   */
  readonly farCharacterAnimScale: number;
}

export interface GfxProfile {
  readonly settings: Readonly<GfxSettings>;
  readonly fingerprint: string;
  readonly forcedTier: GfxTier | null;
  readonly softwareRendering: boolean;
  readonly epoch: number;
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
// Insane is the everything-on showcase preset ABOVE ultra (ultra owns the
// "premium but affordable" slot since the round-10 rescale). Numbered 6, not
// renumbered into the ladder: preset values persist in woc_settings, so 5
// must stay Advanced forever. MANUAL OPT-IN ONLY: resolveDefaultGraphicsPreset
// never returns it, whatever the hardware.
const PRESET_INSANE = 6;
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
  // Ultra is both a player-selected premium preset and the strong-desktop default.
  // Keep its governor armed, but wait for sustained 30ms pressure before shedding.
  ultra: {
    targetFps: 60,
    minRenderScaleDesktop: 0.78,
    minRenderScaleMobile: 0.68,
    maxRenderScale: 1,
    dropFrameMs: 30,
    urgentFrameMs: 44,
    recoverFrameMs: 15,
    dropStep: 0.08,
    urgentDropStep: 0.12,
    recoverStep: 0.04,
    recoverStableSeconds: 3,
    cooldownSeconds: 0.85,
  },
  // Insane shares ultra's loose frame thresholds and takes smaller quality steps.
  // Its draw caps stay slightly higher because the preset deliberately draws more.
  insane: {
    targetFps: 60,
    minRenderScaleDesktop: 0.78,
    minRenderScaleMobile: 0.68,
    maxRenderScale: 1,
    dropFrameMs: 30,
    urgentFrameMs: 44,
    recoverFrameMs: 18,
    dropStep: 0.06,
    urgentDropStep: 0.1,
    recoverStep: 0.05,
    recoverStableSeconds: 3,
    cooldownSeconds: 0.85,
  },
};

export const GFX_BUCKET_BANDS: Record<GfxTier, GfxBucketBands> = {
  low: {
    resolution: {
      min: 0.55,
      baseline: 1.0,
      max: 1.0,
      roi: 0.88,
      cost: 'gpu',
      governable: true,
    },
    grass: {
      min: 0.62,
      baseline: 0.9,
      max: 1.0,
      roi: 0.9,
      cost: 'gpu',
      governable: true,
    },
    foliage: {
      min: 0.68,
      baseline: 0.9,
      max: 1.0,
      roi: 0.84,
      cost: 'gpu',
      governable: true,
    },
    props: {
      min: 0.35,
      baseline: 0.5,
      max: 0.62,
      roi: 0.58,
      cost: 'mixed',
      governable: false,
    },
    lighting: {
      min: 0.78,
      baseline: 1.0,
      max: 1.0,
      roi: 0.72,
      cost: 'gpu',
      governable: true,
    },
    materials: {
      min: 0.3,
      baseline: 0.45,
      max: 0.58,
      roi: 0.78,
      cost: 'gpu',
      governable: false,
    },
    waterSky: {
      min: 0.35,
      baseline: 0.7,
      max: 0.8,
      roi: 0.82,
      cost: 'gpu',
      governable: false,
    },
    vfx: {
      min: 0.84,
      baseline: 1.0,
      max: 1.0,
      roi: 0.9,
      cost: 'mixed',
      governable: true,
    },
    characters: {
      min: 1.0,
      baseline: 1.0,
      max: 1.0,
      roi: 1.0,
      cost: 'mixed',
      governable: false,
    },
    weapons: {
      min: 1.0,
      baseline: 1.0,
      max: 1.0,
      roi: 1.0,
      cost: 'mixed',
      governable: false,
    },
    worldStreaming: {
      min: 0.25,
      baseline: 0.5,
      max: 0.68,
      roi: 0.62,
      cost: 'cpu',
      governable: true,
    },
    ui: {
      min: 0.75,
      baseline: 0.9,
      max: 1.0,
      roi: 0.86,
      cost: 'cpu',
      governable: false,
    },
  },
  medium: {
    resolution: {
      min: 0.55,
      baseline: 1.0,
      max: 1.0,
      roi: 0.88,
      cost: 'gpu',
      governable: true,
    },
    grass: {
      min: 0.5,
      baseline: 0.78,
      max: 0.9,
      roi: 0.86,
      cost: 'gpu',
      governable: true,
    },
    foliage: {
      min: 0.5,
      baseline: 0.74,
      max: 0.86,
      roi: 0.64,
      cost: 'gpu',
      governable: true,
    },
    props: {
      min: 0.55,
      baseline: 0.7,
      max: 0.82,
      roi: 0.58,
      cost: 'mixed',
      governable: false,
    },
    lighting: {
      min: 0.45,
      baseline: 0.72,
      max: 0.82,
      roi: 0.7,
      cost: 'gpu',
      governable: true,
    },
    materials: {
      min: 0.62,
      baseline: 0.78,
      max: 0.9,
      roi: 0.78,
      cost: 'gpu',
      governable: false,
    },
    waterSky: {
      min: 0.55,
      baseline: 0.78,
      max: 0.9,
      roi: 0.82,
      cost: 'gpu',
      governable: false,
    },
    vfx: {
      min: 0.58,
      baseline: 0.8,
      max: 0.9,
      roi: 0.7,
      cost: 'mixed',
      governable: true,
    },
    characters: {
      min: 0.86,
      baseline: 1.0,
      max: 1.0,
      roi: 1.0,
      cost: 'mixed',
      governable: false,
    },
    weapons: {
      min: 1.0,
      baseline: 1.0,
      max: 1.0,
      roi: 1.0,
      cost: 'mixed',
      governable: false,
    },
    worldStreaming: {
      min: 0.42,
      baseline: 0.7,
      max: 0.82,
      roi: 0.62,
      cost: 'cpu',
      governable: true,
    },
    ui: {
      min: 0.82,
      baseline: 1.0,
      max: 1.0,
      roi: 0.86,
      cost: 'cpu',
      governable: false,
    },
  },
  high: {
    resolution: {
      min: 0.6,
      baseline: 1.0,
      max: 1.0,
      roi: 0.88,
      cost: 'gpu',
      governable: true,
    },
    grass: {
      min: 0.6,
      baseline: 0.88,
      max: 1.0,
      roi: 0.86,
      cost: 'gpu',
      governable: true,
    },
    foliage: {
      min: 0.6,
      baseline: 0.9,
      max: 1.0,
      roi: 0.72,
      cost: 'gpu',
      governable: true,
    },
    props: {
      min: 0.7,
      baseline: 0.88,
      max: 1.0,
      roi: 0.58,
      cost: 'mixed',
      governable: false,
    },
    lighting: {
      min: 0.62,
      baseline: 0.9,
      max: 1.0,
      roi: 0.7,
      cost: 'gpu',
      governable: true,
    },
    materials: {
      min: 0.75,
      baseline: 0.92,
      max: 1.0,
      roi: 0.78,
      cost: 'gpu',
      governable: false,
    },
    waterSky: {
      min: 0.72,
      baseline: 0.92,
      max: 1.0,
      roi: 0.82,
      cost: 'gpu',
      governable: false,
    },
    vfx: {
      min: 0.68,
      baseline: 0.92,
      max: 1.0,
      roi: 0.7,
      cost: 'mixed',
      governable: true,
    },
    characters: {
      min: 0.9,
      baseline: 1.0,
      max: 1.0,
      roi: 1.0,
      cost: 'mixed',
      governable: false,
    },
    weapons: {
      min: 1.0,
      baseline: 1.0,
      max: 1.0,
      roi: 1.0,
      cost: 'mixed',
      governable: false,
    },
    worldStreaming: {
      min: 0.55,
      baseline: 0.88,
      max: 1.0,
      roi: 0.62,
      cost: 'cpu',
      governable: true,
    },
    ui: {
      min: 0.86,
      baseline: 1.0,
      max: 1.0,
      roi: 0.86,
      cost: 'cpu',
      governable: false,
    },
  },
  ultra: {
    resolution: {
      min: 0.68,
      baseline: 1.0,
      max: 1.0,
      roi: 0.88,
      cost: 'gpu',
      governable: true,
    },
    grass: {
      min: 0.78,
      baseline: 1.0,
      max: 1.0,
      roi: 0.86,
      cost: 'gpu',
      governable: true,
    },
    foliage: {
      min: 0.78,
      baseline: 1.0,
      max: 1.0,
      roi: 0.72,
      cost: 'gpu',
      governable: true,
    },
    props: {
      min: 0.86,
      baseline: 1.0,
      max: 1.0,
      roi: 0.58,
      cost: 'mixed',
      governable: false,
    },
    lighting: {
      min: 0.78,
      baseline: 1.0,
      max: 1.0,
      roi: 0.7,
      cost: 'gpu',
      governable: true,
    },
    materials: {
      min: 0.86,
      baseline: 1.0,
      max: 1.0,
      roi: 0.78,
      cost: 'gpu',
      governable: false,
    },
    waterSky: {
      min: 0.86,
      baseline: 1.0,
      max: 1.0,
      roi: 0.82,
      cost: 'gpu',
      governable: false,
    },
    vfx: {
      min: 0.86,
      baseline: 1.0,
      max: 1.0,
      roi: 0.7,
      cost: 'mixed',
      governable: true,
    },
    characters: {
      min: 0.94,
      baseline: 1.0,
      max: 1.0,
      roi: 1.0,
      cost: 'mixed',
      governable: false,
    },
    weapons: {
      min: 1.0,
      baseline: 1.0,
      max: 1.0,
      roi: 1.0,
      cost: 'mixed',
      governable: false,
    },
    worldStreaming: {
      min: 0.7,
      baseline: 1.0,
      max: 1.0,
      roi: 0.62,
      cost: 'cpu',
      governable: true,
    },
    ui: {
      min: 0.9,
      baseline: 1.0,
      max: 1.0,
      roi: 0.86,
      cost: 'cpu',
      governable: false,
    },
  },
  // Insane: everything-on. Same bands as ultra (all baselines already sit at
  // 1.0 there); the difference between the two tiers lives in the render
  // layers themselves (worn-stone parallax taps, terrain micro-shadow), not
  // in the governable bucket levels.
  insane: {
    resolution: {
      min: 0.68,
      baseline: 1.0,
      max: 1.0,
      roi: 0.88,
      cost: 'gpu',
      governable: true,
    },
    grass: {
      min: 0.78,
      baseline: 1.0,
      max: 1.0,
      roi: 0.86,
      cost: 'gpu',
      governable: true,
    },
    foliage: {
      min: 0.78,
      baseline: 1.0,
      max: 1.0,
      roi: 0.72,
      cost: 'gpu',
      governable: true,
    },
    props: {
      min: 0.86,
      baseline: 1.0,
      max: 1.0,
      roi: 0.58,
      cost: 'mixed',
      governable: false,
    },
    lighting: {
      min: 0.78,
      baseline: 1.0,
      max: 1.0,
      roi: 0.7,
      cost: 'gpu',
      governable: true,
    },
    materials: {
      min: 0.86,
      baseline: 1.0,
      max: 1.0,
      roi: 0.78,
      cost: 'gpu',
      governable: false,
    },
    waterSky: {
      min: 0.86,
      baseline: 1.0,
      max: 1.0,
      roi: 0.82,
      cost: 'gpu',
      governable: false,
    },
    vfx: {
      min: 0.86,
      baseline: 1.0,
      max: 1.0,
      roi: 0.7,
      cost: 'mixed',
      governable: true,
    },
    characters: {
      min: 0.94,
      baseline: 1.0,
      max: 1.0,
      roi: 1.0,
      cost: 'mixed',
      governable: false,
    },
    weapons: {
      min: 1.0,
      baseline: 1.0,
      max: 1.0,
      roi: 1.0,
      cost: 'mixed',
      governable: false,
    },
    worldStreaming: {
      min: 0.7,
      baseline: 1.0,
      max: 1.0,
      roi: 0.62,
      cost: 'cpu',
      governable: true,
    },
    ui: {
      min: 0.9,
      baseline: 1.0,
      max: 1.0,
      roi: 0.86,
      cost: 'cpu',
      governable: false,
    },
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
): 'low' | 'medium' | 'high' | 'ultra' | 'insane' | 'advanced' {
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
    case PRESET_INSANE:
      return 'insane';
    default:
      return 'low';
  }
}

export function shouldUseAutoGovernor(_tier: GfxTier, search: string): boolean {
  const params = new URLSearchParams(search);
  const override = params.get('governor') ?? params.get('autoGovernor');
  if (override === '1' || override === 'true' || override === 'on') return true;
  if (override === '0' || override === 'false' || override === 'off') return false;
  // Every resolved tier keeps the runtime governor armed. Ultra and insane use deliberately loose
  // GFX_BUDGETS thresholds, so they react only to sustained 30ms pressure or an urgent 44ms frame
  // instead of fighting a premium preset on a transient dip.
  return true;
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
  // WKWebView's WebContent/GPU process has a hard resident-memory ceiling which is independent
  // of frame rate. The runtime governor can reduce draw cost after a slow submit, but it cannot
  // reclaim already-created textures, programs, materials, or rigs. Keep the player's selected
  // tier (and its density/VFX progression) while routing the packaged iOS app through the
  // bounded-residency material/world path from scene construction onward.
  const nativeIosMemoryProfile = hints?.nativeApp === true && hints.platform === 'ios';
  // The stricter 4 GB-class rung. The native shell can measure physicalMemory,
  // while either native WKWebView or iOS Safari can stamp the same marker after
  // a foreground entry kill. Both WebKit hosts share the WebContent ceiling.
  const tightMemoryProfile = hints?.platform === 'ios' && hints?.tightMemory === true;
  // Phone-class browsers live under a hard per-process memory ceiling (iOS WebKit evicts the
  // WebContent process outright); shed the largest one-shot GPU allocations there. Shadow-map
  // texels, MSAA, and DPR are cosmetic sharpness only, so this never crosses the
  // graphics-settings fairness line.
  const constrainedMemory =
    nativeIosMemoryProfile ||
    isConstrainedBrowser({
      deviceMemory: hints?.deviceMemory,
      maxTouchPoints: hints?.maxTouchPoints ?? 0,
      coarsePointer: hints?.coarsePointer ?? false,
      narrowViewport: hints?.narrowViewport ?? false,
    });
  const aaPolicy = gfxAaPolicy(tier, {
    constrainedMemory,
    nativeIosMemoryProfile,
    tightMemory: tightMemoryProfile,
  });
  let settings: GfxSettings = {
    graphicsConfigVersion: GFX_CONFIG_VERSION,
    tier,
    effectsTier: tier,
    bucketBands,
    bucketBaselines: bucketBaselines(bucketBands),
    budget: GFX_BUDGETS[tier],
    autoGovernor: shouldUseAutoGovernor(tier, hints?.search ?? ''),
    composer: !nativeIosMemoryProfile && gfxTierAtLeast(tier, 'high'),
    gradePass: !nativeIosMemoryProfile && gfxTierAtLeast(tier, 'medium'),
    // N8AO runs on the composer tiers: half-res + Low quality on high keeps
    // it ~1ms-class on real GPUs; ultra and insane get full-res Medium
    ao: !nativeIosMemoryProfile && gfxTierAtLeast(tier, 'high'),
    msaaSamples: aaPolicy.msaaSamples,
    pixelRatioCap: aaPolicy.pixelRatioCap,
    // Shadows are cosmetic and duplicate the visible scene draw. Both constrained browsers and
    // the stricter native-iOS residency profile remove that duplicate pass.
    dynamicShadows: tier !== 'low' && !constrainedMemory,
    shadowMap: nativeIosMemoryProfile
      ? 1024
      : tier === 'low'
        ? 2048
        : tier === 'medium'
          ? constrainedMemory
            ? 1536
            : 2560
          : constrainedMemory
            ? 2048
            : 4096,
    standardMaterials: !nativeIosMemoryProfile && gfxTierAtLeast(tier, 'medium'),
    // Round-10 detail-knob defaults (see the interface comment): High takes the
    // existing Advanced-Medium profile to bound its steady cost (basic worn
    // surface, reduced carpet, cavity-only relief). Ultra retains the full
    // 3-tap layers; Insane remains the 4-tap everything-on showcase.
    surfaceDetail: !nativeIosMemoryProfile && gfxTierAtLeast(tier, 'high'),
    surfaceDetailTaps: tier === 'insane' ? 4 : gfxTierAtLeast(tier, 'ultra') ? 3 : 0,
    surfaceDetailClampK: tier === 'insane' ? 1 : tier === 'ultra' ? 0.85 : 0,
    bladeCarpetRadius: nativeIosMemoryProfile
      ? 0
      : gfxTierAtLeast(tier, 'ultra')
        ? 34
        : tier === 'high'
          ? 24
          : 0,
    cliffScree: !nativeIosMemoryProfile && gfxTierAtLeast(tier, 'ultra'),
    canopyDetail: !nativeIosMemoryProfile && gfxTierAtLeast(tier, 'ultra'),
    terrainRelief: nativeIosMemoryProfile
      ? 0
      : gfxTierAtLeast(tier, 'ultra')
        ? 3
        : tier === 'high'
          ? 1
          : 0,
    aoFullRes: gfxTierAtLeast(tier, 'ultra'),
    smaa: aaPolicy.postAa === 'smaa',
    bloom: !nativeIosMemoryProfile && gfxTierAtLeast(tier, 'high'),
    terrainCastShadows: tier !== 'low' && !constrainedMemory,
    lowPlus: tier === 'low' || nativeIosMemoryProfile,
    // Tree and rock placement must match across clients because those decorations
    // occlude world sightlines. Keep the constrained profile on the full placement
    // set and reduce only non-occluding grass below.
    leanFoliage: tier === 'low' || (tier === 'medium' && weakIntegratedGpu),
    grassRadius: tightMemoryProfile
      ? 34
      : nativeIosMemoryProfile
        ? 52
        : tier === 'low'
          ? 80
          : tier === 'medium'
            ? constrainedMemory
              ? 62
              : 76
            : 82,
    grassStep: tightMemoryProfile
      ? 3.8
      : nativeIosMemoryProfile
        ? 2.75
        : tier === 'low'
          ? 2.05
          : tier === 'medium'
            ? constrainedMemory
              ? 2.35
              : 2.0
            : 1.8,
    farGrassDensityFloor: nativeIosMemoryProfile
      ? 0.5
      : constrainedMemory
        ? 0.55
        : tier === 'low'
          ? 0.55
          : tier === 'medium'
            ? 0.62
            : tier === 'high'
              ? 0.7
              : tier === 'ultra'
                ? 0.75
                : 0.8,
    terrainSplat: !nativeIosMemoryProfile && gfxTierAtLeast(tier, 'medium'),
    windSway: true,
    maxPointLights: nativeIosMemoryProfile ? 2 : constrainedMemory ? 3 : 6,
    constrainedMemory,
    nativeIosMemoryProfile,
    tightMemory: tightMemoryProfile,
    maxPooledCharacterVisuals: tightMemoryProfile
      ? 4
      : nativeIosMemoryProfile
        ? 6
        : Number.POSITIVE_INFINITY,
    // Extra articulated rigs are skinning + draw-call cost, so the phone-class
    // memory profiles and the low tier (which includes software GL) opt out and
    // keep the straight-to-frozen far LOD.
    farCharacterAnimScale:
      tier === 'low' || constrainedMemory || nativeIosMemoryProfile ? 1 : FAR_ANIM_RANGE_SCALE_MAX,
  };
  if (hints?.graphicsPreset === PRESET_ADVANCED) {
    // The Advanced custom mix maps each persisted sub-setting onto the SAME
    // derived knobs the tier ladder sets above, level by level. Stored values
    // are backward-compatible: the historical binary rows persisted 0 (Low)
    // and 1 (High), which land on levels 0 and 2 of the new four-step ladder
    // (0 / 0.5 / 1 / 2 -> level 0..3), so nobody's saved mix changes meaning.
    const levelOf = (value: number): number =>
      value < 0.25 ? 0 : value < 0.75 ? 1 : value < 1.5 ? 2 : 3;
    // Terrain Detail: Low keeps the historical splat-off path; Medium takes
    // cavity shading only; High adds the parallax walk; Insane the micro
    // sun-shadow (the tier ladder's high=2 / ultra+=3 executions).
    const terrainLevel = levelOf(hints.terrainDetail ?? 1);
    if (terrainLevel === 0) settings = { ...settings, terrainSplat: false, terrainRelief: 0 };
    else settings = { ...settings, terrainRelief: terrainLevel };
    // Foliage Density: Low keeps the historical sparse card tufts (and no
    // overhaul layers); Medium buys a reduced blade carpet; High the full
    // carpet plus cliff scree and canopy clump detail;
    // Insane extends the carpet ring past the tier ladder's 34u.
    const foliageLevel = levelOf(hints.foliageDensity ?? 1);
    if (foliageLevel === 0)
      settings = {
        ...settings,
        grassRadius: 34,
        grassStep: 3.8,
        farGrassDensityFloor: 0.5,
        bladeCarpetRadius: 0,
        cliffScree: false,
        canopyDetail: false,
      };
    else if (foliageLevel === 1)
      settings = {
        ...settings,
        farGrassDensityFloor: 0.62,
        bladeCarpetRadius: 24,
        cliffScree: false,
        canopyDetail: false,
      };
    else if (foliageLevel === 2)
      settings = {
        ...settings,
        bladeCarpetRadius: 34,
        cliffScree: true,
        canopyDetail: true,
      };
    else
      settings = {
        ...settings,
        farGrassDensityFloor: 0.85,
        bladeCarpetRadius: 40,
        cliffScree: true,
        canopyDetail: true,
      };
    // Surface Detail (the town-cost dial): Off sheds the whole worn layer;
    // Basic keeps the detail normals + AO grime without the parallax walk;
    // Full runs the ultra execution (3 taps, 0.85 clamp); Insane the
    // everything-on 4-tap full-clamp walk.
    const surfaceLevel = levelOf(hints.surfaceDetail ?? 1);
    if (surfaceLevel === 0)
      settings = {
        ...settings,
        surfaceDetail: false,
        surfaceDetailTaps: 0,
        surfaceDetailClampK: 0,
      };
    else if (surfaceLevel === 1)
      settings = { ...settings, surfaceDetailTaps: 0, surfaceDetailClampK: 0 };
    else if (surfaceLevel === 2)
      settings = { ...settings, surfaceDetailTaps: 3, surfaceDetailClampK: 0.85 };
    else settings = { ...settings, surfaceDetailTaps: 4, surfaceDetailClampK: 1 };
    // Effects & Lighting: Low is the region-safe grade-only mini composer (the
    // medium tier's post profile, without full-frame SMAA); Medium adds N8AO; High the full
    // high-tier stack (AO + bloom + SMAA). The level-0 test keeps the shared
    // EFFECTS_QUALITY_LOW_CUTOFF constant so the HUD effect tier and the 3D
    // renderer still downgrade at the same threshold.
    const effectsValue = hints.effectsQuality ?? 1;
    if (effectsValue < EFFECTS_QUALITY_LOW_CUTOFF)
      settings = {
        ...settings,
        effectsTier: 'low',
        composer: false,
        gradePass: true,
        ao: false,
        aoFullRes: false,
        bloom: false,
        smaa: false,
        maxPointLights: Math.min(settings.maxPointLights, 3),
      };
    else if (effectsValue < 0.75)
      settings = { ...settings, ao: true, aoFullRes: false, bloom: false, smaa: false };
    // Shadow Quality: pure map-size steps (1024 / 2560 / 4096 / 8192);
    // terrain-cast shadows join at High, matching the tier ladder where every
    // dynamic-shadow tier casts terrain.
    const shadowLevel = levelOf(hints.shadowQuality ?? 1);
    if (shadowLevel === 0) settings = { ...settings, shadowMap: 1024, terrainCastShadows: false };
    else if (shadowLevel === 1)
      settings = { ...settings, shadowMap: 2560, terrainCastShadows: false };
    else if (shadowLevel === 3) settings = { ...settings, shadowMap: 8192 };
  }
  return applyGfxOverridesFromSearch(settings, hints?.search ?? '');
}

export function forcedTierFromSearch(search: string): GfxTier | null {
  const params = new URLSearchParams(search);
  if (params.has('lowgfx')) return 'low';
  const g = params.get('gfx');
  return g === 'low' || g === 'medium' || g === 'high' || g === 'ultra' || g === 'insane'
    ? g
    : null;
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

type RuntimeDeviceHints = Omit<GfxCapabilities, 'gpuRenderer' | 'softwareRendering'>;

function runtimeDeviceHints(): RuntimeDeviceHints {
  const nav =
    typeof navigator !== 'undefined' ? (navigator as Navigator & { deviceMemory?: number }) : null;
  return {
    deviceMemory: nav?.deviceMemory,
    hardwareConcurrency: nav?.hardwareConcurrency,
    maxTouchPoints: nav?.maxTouchPoints ?? 0,
    coarsePointer:
      typeof matchMedia !== 'undefined' ? matchMedia('(pointer: coarse)').matches : false,
    narrowViewport:
      typeof matchMedia !== 'undefined'
        ? matchMedia('(max-width: 940px)').matches || matchMedia('(max-height: 760px)').matches
        : false,
    nativeApp: NATIVE_APP,
    tightMemory: tightMemoryDeviceHint(),
    platform: mobilePlatformFromNavigator(nav),
  };
}

function runtimeHints(): GfxRuntimeHints {
  return {
    ...runtimeDeviceHints(),
    search: typeof location !== 'undefined' ? location.search : '',
    gpuRenderer: probeGpuRenderer(),
    graphicsPreset: storedNumericSetting('graphicsPreset'),
    terrainDetail: storedNumericSetting('terrainDetail'),
    foliageDensity: storedNumericSetting('foliageDensity'),
    effectsQuality: storedNumericSetting('effectsQuality'),
    shadowQuality: storedNumericSetting('shadowQuality'),
    surfaceDetail: storedNumericSetting('surfaceDetail'),
  };
}

function mobilePlatformFromNavigator(
  nav: Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'> | null,
): 'ios' | 'android' | 'other' {
  if (!nav) return 'other';
  if (
    /iPad|iPhone|iPod/.test(nav.userAgent) ||
    (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1)
  )
    return 'ios';
  if (/Android/.test(nav.userAgent)) return 'android';
  return 'other';
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
  | 'appleSilicon'
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
  // Apple Silicon (M1..M9). Split out of strongDesktop: these are thermally constrained laptop
  // SoCs (the MacBook form factor has no active-cooling headroom), so the resolver defaults them
  // to the safe middle tier rather than ultra (issue 1676). Kept AHEAD of strongDesktop, whose
  // regex no longer claims `apple m`. A player can still pick ultra manually.
  if (/apple\s?m[1-9]/.test(n)) return 'appleSilicon';
  // Strong desktop discrete. The `(\(tm\))?` tolerates the "(TM)" some Windows drivers print
  // after "Radeon" ("Radeon(TM) RX 580").
  if (/\b(rtx|gtx)\b|geforce|radeon(\(tm\))?\s?(rx|pro|vii)|\barc\b|\bnvidia\b/.test(n))
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
 * player preset is never passed here. Never returns ADVANCED (5) or INSANE (6): the expert custom
 * profile and the everything-on showcase preset are both opt-in, never an auto-default (ultra is
 * the hardware-detect ceiling).
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
  // Apple Silicon: an M-series iPad (touch) keeps the mobile HIGH cap above; an M-series Mac
  // (non-touch) defaults to the safe middle. These SoCs can render high, but the thermally
  // constrained MacBook form factor overheats and drains battery on a sustained ultra load, so
  // medium is the right auto-default (the runtime governor can still climb; ultra stays a manual
  // opt-in). Issue 1676.
  if (gpu === 'appleSilicon') return isMobile ? PRESET_HIGH : PRESET_MEDIUM;
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
    case PRESET_INSANE:
      return 'insane';
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

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  Object.freeze(value);
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  return value;
}

function cloneProfileValue<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(cloneProfileValue) as T;
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [key, cloneProfileValue(nested)]),
  ) as T;
}

function stableFingerprintValue(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return 'NaN';
    if (value === Number.POSITIVE_INFINITY) return 'Infinity';
    if (value === Number.NEGATIVE_INFINITY) return '-Infinity';
    if (Object.is(value, -0)) return '-0';
    return String(value);
  }
  if (typeof value === 'undefined') return 'undefined';
  if (Array.isArray(value)) return `[${value.map(stableFingerprintValue).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stableFingerprintValue((value as Record<string, unknown>)[key])}`,
      )
      .join(',')}}`;
  }
  throw new TypeError(`Unsupported graphics fingerprint value: ${typeof value}`);
}

function profileFromHints(
  hints: GfxRuntimeHints,
  softwareRendering: boolean,
  epoch: number,
): GfxProfile {
  const tier = tierFromHints(hints, softwareRendering);
  const settings = deepFreeze(cloneProfileValue(settingsFor(tier, hints)));
  return Object.freeze({
    settings,
    fingerprint: stableFingerprintValue(settings),
    forcedTier: forcedTierFromSearch(hints.search),
    softwareRendering,
    epoch,
  });
}

/** Capture device and live-adapter facts without reading graphics preferences. */
export function captureGfxCapabilities(webgl: THREE.WebGLRenderer): GfxCapabilities {
  const gpuRenderer = rendererName(webgl);
  return Object.freeze({
    ...runtimeDeviceHints(),
    gpuRenderer,
    softwareRendering: isSoftwareRendererName(gpuRenderer),
  });
}

/** Resolve a candidate profile without activating it or touching persisted settings. */
export function resolveGfxProfile(
  capabilities: GfxCapabilities,
  preferences: GraphicsSettingsSnapshot,
  search: string,
): GfxProfile {
  const { softwareRendering, ...deviceHints } = capabilities;
  const normalizedPreferences = normalizeGraphicsSettingsSnapshot(preferences);
  const forcedTier = forcedTierFromSearch(search);
  const graphicsPreset = forcedTier
    ? normalizedPreferences.graphicsPreset
    : safeStartupGraphicsPreset(
        capabilities.nativeApp,
        capabilities.platform === 'ios' ? 'webkit' : 'unknown',
        capabilities.platform === 'ios',
        normalizedPreferences.graphicsPreset,
        PRESET_ULTRA,
        PRESET_HIGH,
      );
  return profileFromHints(
    {
      ...deviceHints,
      ...normalizedPreferences,
      graphicsPreset,
      search,
    },
    softwareRendering,
    0,
  );
}

// Best-guess settings from the URL alone (so module-load consumers see sane
// values); initGfxTier() re-resolves once the GL context exists. The renderer
// MUST call initGfxTier() right after creating its WebGLRenderer and before
// building any scene content.
const initialHints = runtimeHints();
export let activeGfxProfile = profileFromHints(initialHints, false, 0);
export let gfxProfileEpoch = activeGfxProfile.epoch;
export let GFX: GfxSettings = activeGfxProfile.settings;

export function getActiveGfxProfile(): GfxProfile {
  return activeGfxProfile;
}

export function getGfxProfileEpoch(): number {
  return gfxProfileEpoch;
}

/** Publish a resolved profile. Epoch changes exactly when derived settings change. */
export function activateGfxProfile(profile: GfxProfile): GfxProfile {
  const settings = deepFreeze(cloneProfileValue(profile.settings));
  const fingerprint = stableFingerprintValue(settings);
  const epoch =
    fingerprint === activeGfxProfile.fingerprint ? gfxProfileEpoch : gfxProfileEpoch + 1;
  const activated = Object.freeze({
    settings,
    fingerprint,
    forcedTier: profile.forcedTier,
    softwareRendering: profile.softwareRendering,
    epoch,
  });

  GFX = settings;
  softwareGlDetected = activated.softwareRendering;
  activeGfxProfile = activated;
  gfxProfileEpoch = epoch;
  return activated;
}

export function initGfxTier(webgl: THREE.WebGLRenderer): GfxTier {
  // Install before any scene material compiles. The fixed point-light budget
  // keeps program counts stable with zero-intensity slots; the shader guard
  // makes those stable slots cheap without changing their permutation.
  installPbrPointLightShaderPruning();
  const gpuRenderer = rendererName(webgl);
  const softwareRendering = isSoftwareRendererName(gpuRenderer);
  const hints = { ...runtimeHints(), gpuRenderer };
  return activateGfxProfile(profileFromHints(hints, softwareRendering, 0)).settings.tier;
}

export const gfxInternalsForTest = {
  settingsFor,
  runtimeHints,
  stableFingerprintValue,
  mobilePlatformFromNavigator,
  probeGpuRenderer,
  overrideSettings: (overrides: Partial<GfxSettings>): (() => void) => {
    const previous = GFX;
    GFX = deepFreeze({ ...GFX, ...overrides });
    let restored = false;
    return () => {
      if (restored) return;
      restored = true;
      GFX = previous;
    };
  },
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
// 31° elevation (was 53.7°): a permanent late-afternoon key. Long raking
// shadows and a standing golden warm on the light are what make the sun FELT;
// the old near-noon angle shortened every shadow and left the world reading
// evenly lit. Azimuth unchanged, so the per-biome HDRI sun alignment in
// sky.ts and the water glint direction stay correct without retuning.
export const SUN_ANCHOR = new THREE.Vector3(90, 62, 50);
export const SUN_DIR = SUN_ANCHOR.clone().normalize();

// Emissive tiers. Bloom is a luma high-pass at post.ts BLOOM_THRESHOLD (1.32)
// in linear HDR, so whether a surface glows is emissive-color luma x intensity
// against that number, NOT the intensity alone. Pick the tier by intent and
// the maths follows: a mid-luma warm (0xff6600, luma 0.55) reaches 2.2 at
// EMISSIVE_LIGHT and a bright one (amber vColor, luma 0.47; cyan eyes, 0.84)
// clears it at EMISSIVE_GLOW. Anything meant to read as painted-on colour
// rather than a light source stays at EMISSIVE_TINT and never blooms.
/** self-lit sources: flames, lanterns, projectile cores */
export const EMISSIVE_LIGHT = 4.0;
/** lit-from-within surfaces: windows, creature eyes, active runes */
export const EMISSIVE_GLOW = 3.3;
/** surface tint only, deliberately below the bloom threshold */
export const EMISSIVE_TINT = 0.5;

export interface SurfaceMatOpts {
  color?: number;
  map?: THREE.Texture;
  vertexColors?: boolean;
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
const rimGlowMaterials = new WeakSet<THREE.Material>();

export function addRimGlow(mat: THREE.Material): void {
  if (!(mat as THREE.MeshStandardMaterial).isMeshStandardMaterial || rimGlowMaterials.has(mat)) {
    return;
  }
  rimGlowMaterials.add(mat);
  const previousCompile = mat.onBeforeCompile;
  const previousCompileSource = previousCompile.toString();
  const previousProgramKey = mat.customProgramCacheKey.bind(mat);
  mat.onBeforeCompile = (sh, renderer) => {
    previousCompile.call(mat, sh, renderer);
    const patched = patchPbrRimGlowFragmentShader(sh.fragmentShader);
    if (patched === sh.fragmentShader) return;
    sh.uniforms.uRimBoost = sharedUniforms.uRimBoost;
    sh.fragmentShader = patched;
  };
  mat.customProgramCacheKey = () =>
    `pbr-rim-reuse|${previousCompileSource}|${previousProgramKey()}`;
}

// Material factory: dedupes by (color|maps|flags) so hundreds of small box
// meshes share a few dozen programs/uniform sets. Standard on high/ultra,
// Lambert on low.
const matCache = new Map<string, THREE.Material>();

/** Drop profile-derived shared materials before rebuilding for a new settings object. */
export function resetSurfaceMaterialProfileCache(): void {
  matCache.clear();
}

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
        vertexColors: opts.vertexColors ?? false,
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
        vertexColors: opts.vertexColors ?? false,
        flatShading: opts.flatShading ?? false,
        emissive: opts.emissive ?? 0x000000,
        emissiveIntensity: opts.emissiveIntensity ?? 1,
        side: opts.side ?? THREE.FrontSide,
      });
  if (opts.rim && GFX.standardMaterials) addRimGlow(mat);
  matCache.set(key, mat);
  return mat;
}
