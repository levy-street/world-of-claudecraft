// First-run graphics auto-detection (the "Auto" quality preset).
//
// Pure + host-agnostic: every input is passed in explicitly so the policy is
// unit-tested without a GL context (see tests/gfx_autodetect.test.ts). gfx.ts
// is the only consumer; it feeds live runtime hints in and uses the verdict as
// the boot tier whenever the player is on Auto (graphicsPreset 0).
//
// Policy bias: FRAME RATE over visuals (operator decision). The heuristic never
// auto-picks `ultra` - ultra stays a deliberate manual choice. The adaptive
// governor (render_budget.ts) then absorbs runtime dips within the chosen tier,
// and rememberedAutoTier() carries a cross-session step-down so a machine that
// ran badly last session starts one rung lower next time.

import type { GfxTier } from './gfx';

export interface AutoDetectHints {
  /** UNMASKED_RENDERER_WEBGL string, e.g. "ANGLE (NVIDIA ... RTX 3060 Ti ...)". */
  gpuRenderer?: string;
  /** navigator.deviceMemory (GB), often undefined off Chromium. */
  deviceMemory?: number;
  /** navigator.hardwareConcurrency (logical cores). */
  hardwareConcurrency?: number;
  /** Phone/tablet-class pointer (coarse pointer or touch-primary). */
  mobile: boolean;
  /** devicePixelRatio. High-DPI multiplies pixel cost, so it steps the tier down. */
  dpr: number;
  /** SwiftShader/llvmpipe/software path - never a real GPU. */
  softwareGl: boolean;
}

export type GpuClass =
  | 'software'
  | 'weak'
  | 'integrated'
  | 'midDiscrete'
  | 'strongDiscrete'
  | 'unknown';

const TIER_ORDER: readonly GfxTier[] = ['low', 'medium', 'high', 'ultra'];

function stepDown(tier: GfxTier, by = 1): GfxTier {
  const i = TIER_ORDER.indexOf(tier);
  return TIER_ORDER[Math.max(0, i - by)];
}

/** Order helper so callers can clamp/compare tiers without re-deriving the order. */
export function tierRank(tier: GfxTier): number {
  return TIER_ORDER.indexOf(tier);
}

export function minTier(a: GfxTier, b: GfxTier): GfxTier {
  return tierRank(a) <= tierRank(b) ? a : b;
}

/**
 * Bucket a WEBGL_debug_renderer_info renderer string into a coarse performance
 * class. String matching only - deliberately conservative: an unrecognized GPU
 * lands in `unknown` (treated as a safe middle), and the governor + cross-session
 * step-down correct any over-estimate.
 */
export function classifyGpu(renderer: string | undefined): GpuClass {
  const r = (renderer ?? '').toLowerCase();
  if (!r) return 'unknown';
  if (/swiftshader|llvmpipe|software|microsoft basic render|google.*swiftshader/.test(r)) {
    return 'software';
  }

  // Apple Silicon: M1 Pro/Max/Ultra and M2+ are strong; bare M1 is mid-class.
  if (/apple\s*m[2-9]|apple\s*m1\s*(pro|max|ultra)/.test(r)) return 'strongDiscrete';
  if (/apple\s*m1/.test(r)) return 'midDiscrete';

  // NVIDIA. RTX 40/50-series and 3070+/2080+ and pro cards are strong; the
  // xx50/xx60 mainstream and GTX are mid; very old GT/MX are weak.
  if (/nvidia|geforce|quadro|rtx|gtx/.test(r)) {
    if (/rtx\s*(40|50|a[2-9]|30[789]|3080|3090|2080|2090)/.test(r)) return 'strongDiscrete';
    if (/rtx\s*(20|30)|gtx\s*1[6-9]\d{2}|gtx\s*10[6-9]\d|titan/.test(r)) return 'midDiscrete';
    if (/\b(mx\d{3}|gt\s*\d{3}|gtx\s*9|gtx\s*10[0-5]\d)\b/.test(r)) return 'weak';
    return 'midDiscrete';
  }

  // AMD Radeon. RX 6700/7000 and up are strong; RX 5000/6500-6600 mid; Vega/
  // integrated graphics are integrated-class.
  if (/radeon|\bamd\b|\brx\s*\d/.test(r)) {
    if (/rx\s*(6[789]\d{2}|7\d{3})|radeon\s*pro\s*w/.test(r)) return 'strongDiscrete';
    if (/rx\s*(5\d{3}|6[0-6]\d{2})|rx\s*4\d{2}/.test(r)) return 'midDiscrete';
    if (/vega|radeon\s*(r[0-9]|hd)/.test(r)) return 'integrated';
    return 'midDiscrete';
  }

  // Intel. Arc is a real discrete GPU; Iris Xe is a capable iGPU; older HD/UHD
  // 5xx/6xx and the Iris Plus 6-series are weak.
  if (/intel/.test(r)) {
    if (/\barc\b|arc\s*a\d/.test(r)) return 'midDiscrete';
    if (/iris\s*xe/.test(r)) return 'integrated';
    if (
      /(uhd|hd)\s*graphics\s*[56]|iris\(tm\)\s*plus\s*graphics\s*6|iris\s*plus\s*graphics\s*6/.test(
        r,
      )
    ) {
      return 'weak';
    }
    if (/iris/.test(r)) return 'integrated';
    return 'weak';
  }

  // Mobile SoCs (renderer strings often inject "(TM)" between name and number).
  if (/adreno\D*[67]\d{2}|mali-g[789]\d|apple\s*a1[5-9]/.test(r)) return 'integrated';
  if (/adreno|mali|powervr|apple\s*a\d/.test(r)) return 'weak';

  return 'unknown';
}

const CLASS_TIER: Record<GpuClass, GfxTier> = {
  software: 'low',
  weak: 'low',
  integrated: 'medium',
  midDiscrete: 'high',
  strongDiscrete: 'high', // FPS-first: cap auto at high; ultra is manual-only.
  unknown: 'medium', // safe middle; governor + cross-session step-down correct it.
};

/**
 * The Auto-preset boot tier. FPS-first: tops out at `high`, drops a rung for
 * high-DPI and low-memory machines, and forces `low` on phones/software GL.
 */
export function recommendAutoTier(h: AutoDetectHints): GfxTier {
  if (h.softwareGl) return 'low';
  if (h.mobile) return 'low';

  let tier = CLASS_TIER[classifyGpu(h.gpuRenderer)];

  // High-DPI panels (Retina/4K at dpr>=2) render ~4x the pixels; step one rung
  // down so the panel does not eat the frame budget. pixelRatioCap + the
  // governor's render-scale still clamp the rest.
  if (h.dpr >= 2 && tier !== 'low') tier = stepDown(tier);

  // Memory-starved devices (<=4GB) cannot hold the high-tier texture/shadow
  // working set; cap at medium, and at low when truly tiny.
  if (h.deviceMemory !== undefined) {
    if (h.deviceMemory <= 2) tier = 'low';
    else if (h.deviceMemory <= 4) tier = minTier(tier, 'medium');
  }

  // Very low core counts struggle with the CPU-side per-frame work; keep them
  // off the premium pipeline.
  if (h.hardwareConcurrency !== undefined && h.hardwareConcurrency <= 2) {
    tier = minTier(tier, 'medium');
  }

  return tier;
}

export interface RememberedAuto {
  /** GFX_CONFIG_VERSION the sample was taken under; stale versions are ignored. */
  v: number;
  /** The Auto tier that was actually running. */
  tier: GfxTier;
  /** Sustained FPS observed last session for that tier. */
  fps: number;
}

/** FPS-first floor: Auto wants comfortable headroom above 60, not a bare 60. */
export const AUTO_FPS_FLOOR = 58;
/** Sustained FPS that justifies stepping a remembered floor back up one rung. */
export const AUTO_FPS_HEADROOM = 110;

/**
 * Fold a remembered last-session sample into the heuristic tier. Cross-session
 * adaptation, deliberately damped so it converges instead of oscillating:
 * - last session for THIS tier ran below the floor -> start one rung lower;
 * - last session ran with big headroom AND we were already at/below heuristic
 *   -> allow one rung back up (never above the heuristic, which is the FPS-first
 *   ceiling).
 */
export function resolveAutoTier(
  h: AutoDetectHints,
  remembered: RememberedAuto | null,
  configVersion: number,
): GfxTier {
  const base = recommendAutoTier(h);
  if (!remembered || remembered.v !== configVersion) return base;

  // Only trust a remembered sample whose tier is at or below the current
  // heuristic (hardware/DPI unchanged); a higher remembered tier is stale.
  if (tierRank(remembered.tier) > tierRank(base)) return base;

  if (remembered.fps > 0 && remembered.fps < AUTO_FPS_FLOOR) {
    return stepDown(remembered.tier);
  }
  if (remembered.fps >= AUTO_FPS_HEADROOM && tierRank(remembered.tier) < tierRank(base)) {
    const up = TIER_ORDER[Math.min(tierRank(base), tierRank(remembered.tier) + 1)];
    return up;
  }
  return minTier(base, remembered.tier);
}
