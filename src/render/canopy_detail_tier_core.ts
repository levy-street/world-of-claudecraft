// The canopy clump-detail layer's tier profile: how many triplanar taps a
// surviving leaf fragment pays, and how far out it pays them. Pure (no Three,
// no DOM, no GFX singleton), registered in RENDER_PURE_CORES; canopy_detail.ts
// is the thin consumer that turns a profile into uniforms and a shader patch.
//
// WHY THE LAYER SPLITS IN TWO. It has always been all-or-nothing at 6 taps per
// surviving fragment: 3 into the AO map (the clump-seam light and dark break-up
// that multiplies diffuse AND the leaf emissive floor) and 3 into the NormalGL
// map (the shading-normal bend). Leaves are alpha-tested AND double-sided, so
// nothing writes early-Z under them: on an immediate-mode desktop GPU every
// overlapping canopy fragment in the band pays the full six, and the canopies
// in a forest overlap heavily. The two halves are not worth the same, though:
// - the AO half survives at distance and on the shadowed side of a canopy,
//   where the emissive floor dominates and geometry gives no break-up at all;
// - the NORMAL half is a lighting response. It reads while a canopy fills the
//   screen and it is the half that vanishes first as the clump cells shrink
//   toward a pixel.
// So ULTRA keeps the AO half and drops the normal half, and INSANE (the
// declared showcase tier, and only ever a manual opt-in) keeps all six. The
// geometric crevice term is free of taps and runs on both, at every distance.
//
// AND THE BAND TIGHTENS WITH THE TAPS. The fade end is where the layer stops
// costing anything at all (past it every tap is branch-skipped). The AO remap
// is mean-centered, so easing back to 1.0 cannot shift a canopy's brightness,
// which is what makes pulling the end in a pure cost cut rather than a visible
// edge. Ultra pulls it from 55 to 44 yards: the same start, so nothing near
// changes, and the ring it gives up is over a third of the band's area.

/** No layer at all: high and below (and the Advanced Foliage Density low arms). */
export const CANOPY_TAPS_OFF = 0;
/** Ultra: the 3 AO taps, no shading-normal bend. */
export const CANOPY_TAPS_AO_ONLY = 3;
/** Insane: AO plus the 3 NormalGL taps, the historical full layer. */
export const CANOPY_TAPS_FULL = 6;

/** Taps in one half of the layer (one triplanar projection: zy, xz, xy). */
export const CANOPY_TRIPLANAR_TAPS = 3;

/** Distance at which the layer starts easing out. Shared by every arm. */
export const CANOPY_FADE_START = 34;
/** Fade end with the full 6-tap layer (insane). */
export const CANOPY_FADE_END_FULL = 55;
/** Fade end with the AO half alone (ultra): the tightened band. */
export const CANOPY_FADE_END_AO_ONLY = 44;

export interface CanopyDetailProfile {
  /** Taps a surviving leaf fragment inside the band pays. */
  taps: number;
  /** Whether the 3 NormalGL taps and the shading-normal bend are compiled in. */
  normalDetail: boolean;
  fadeStart: number;
  fadeEnd: number;
}

/**
 * The profile for a tap count, or null when the layer is off. Anything that is
 * not one of the shipped rungs rounds DOWN to the nearest one, so a stray knob
 * value can only ever cost less than it asked for.
 */
export function canopyDetailProfile(taps: number): CanopyDetailProfile | null {
  if (!Number.isFinite(taps) || taps < CANOPY_TAPS_AO_ONLY) return null;
  const normalDetail = taps >= CANOPY_TAPS_FULL;
  return {
    taps: normalDetail ? CANOPY_TAPS_FULL : CANOPY_TAPS_AO_ONLY,
    normalDetail,
    fadeStart: CANOPY_FADE_START,
    fadeEnd: normalDetail ? CANOPY_FADE_END_FULL : CANOPY_FADE_END_AO_ONLY,
  };
}
