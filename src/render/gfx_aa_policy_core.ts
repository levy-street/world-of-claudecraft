export type GfxAaTier = 'low' | 'medium' | 'high' | 'ultra' | 'insane';
/**
 * `fxaa-grade` is edge AA folded INTO the output grade pass rather than run as
 * its own pass: a full-frame tail costs the grade-only chain its dynamic
 * resolution region, and a fused arm keeps the pass region-remapped.
 */
export type GfxPostAa = 'none' | 'fxaa-grade' | 'smaa';

export interface GfxAaDeviceHints {
  readonly constrainedMemory?: boolean;
  readonly iosMemoryProfile?: boolean;
  /** 4 GB-class WebKit rung: the strictest DPR cap, below the iOS WebKit profile. */
  readonly tightMemory?: boolean;
}

export interface GfxAaPolicy {
  readonly pixelRatioCap: number;
  readonly msaaSamples: number;
  readonly postAa: GfxPostAa;
}

const STANDARD_POLICIES: Record<GfxAaTier, GfxAaPolicy> = {
  low: { pixelRatioCap: 1.48, msaaSamples: 0, postAa: 'none' },
  medium: { pixelRatioCap: 1.48, msaaSamples: 0, postAa: 'fxaa-grade' },
  high: { pixelRatioCap: 1.75, msaaSamples: 0, postAa: 'smaa' },
  ultra: { pixelRatioCap: 1.75, msaaSamples: 0, postAa: 'smaa' },
  insane: { pixelRatioCap: 1.75, msaaSamples: 0, postAa: 'smaa' },
};

/**
 * Resolve the complete edge-AA strategy without depending on Three or the DOM.
 *
 * Ultra and insane deliberately share high's 1.75 cap because their full-resolution
 * AO and post targets make extra pixels especially expensive. On panels at DPR 2.5
 * or above, the old cap rasterized 6.25 pixels per CSS pixel while 1.75 rasterizes
 * 3.0625, or 49 percent as many. Tail SMAA replaces that 51 percent fragment premium
 * with edge-local reconstruction. Lower-DPR panels save less because both caps are
 * bounded by the panel DPR.
 *
 * Medium keeps only its region-safe grade path. A full-size SMAA tail does not inherit
 * the composer's reduced viewport and scissor, so it would reintroduce stale pixels
 * outside the active region. Its edge AA is therefore fused into the grade pass, which
 * already remaps its input through the region rect: FXAA is single-pass, so its luma
 * taps ride that same remap and the chain stays region-safe with no new target.
 *
 * Low keeps its no-AA path because it has no grade pass to fold into (gfx.ts starts
 * `gradePass` at medium), and so do both memory-constrained WebKit profiles, which drop
 * the grade pass for the same reason they drop the composer.
 */
export function gfxAaPolicy(tier: GfxAaTier, hints: GfxAaDeviceHints = {}): GfxAaPolicy {
  // The 4 GB-class rung is stricter than the general iOS WebKit profile: every
  // WebKit host shares the WebContent ceiling, and DPR is the largest single lever.
  if (hints.tightMemory) {
    return { pixelRatioCap: 1, msaaSamples: 0, postAa: 'none' };
  }
  if (hints.iosMemoryProfile) {
    return { pixelRatioCap: 1.25, msaaSamples: 0, postAa: 'none' };
  }
  const policy = STANDARD_POLICIES[tier];
  if (hints.constrainedMemory) {
    // The constraint here is MEMORY, and the fused FXAA arm allocates nothing:
    // no render target, no pass, just extra taps inside a pass the profile
    // already runs. So a constrained non-WebKit session keeps its tier's post
    // AA and only loses pixel ratio, exactly as the SMAA tiers do above.
    // The arm's real cost is fill rate, not memory, and this cohort is
    // phone-class (touch plus a coarse pointer or a narrow viewport), so it is
    // the cohort to re-measure first if the arm ever needs shedding. It reaches
    // them only on an explicit Medium pick: mobile auto-defaults to low.
    return { ...policy, pixelRatioCap: 1.48 };
  }
  return policy;
}
