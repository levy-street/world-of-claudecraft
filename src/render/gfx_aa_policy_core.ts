export type GfxAaTier = 'low' | 'medium' | 'high' | 'ultra' | 'insane';
export type GfxPostAa = 'none' | 'smaa';

export interface GfxAaDeviceHints {
  readonly constrainedMemory?: boolean;
  readonly nativeIosMemoryProfile?: boolean;
}

export interface GfxAaPolicy {
  readonly pixelRatioCap: number;
  readonly msaaSamples: number;
  readonly postAa: GfxPostAa;
}

const STANDARD_POLICIES: Record<GfxAaTier, GfxAaPolicy> = {
  low: { pixelRatioCap: 1.48, msaaSamples: 0, postAa: 'none' },
  medium: { pixelRatioCap: 1.48, msaaSamples: 0, postAa: 'smaa' },
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
 * Medium also uses tail SMAA. Its grade target already supplies the post seam, so
 * dropping 4x MSAA removes multisample storage and resolve bandwidth without adding
 * another scene draw. Low keeps its existing no-AA path.
 */
export function gfxAaPolicy(tier: GfxAaTier, hints: GfxAaDeviceHints = {}): GfxAaPolicy {
  if (hints.nativeIosMemoryProfile) {
    return { pixelRatioCap: 1.25, msaaSamples: 0, postAa: 'none' };
  }
  const policy = STANDARD_POLICIES[tier];
  if (hints.constrainedMemory) {
    return { ...policy, pixelRatioCap: 1.48 };
  }
  return policy;
}
