// How much of an authored Paladin effect draws: the Paladin kit's answer to the
// graphics preset, the live VFX quality and the cast spam budget. Every tier
// draws the NEW effect; lower tiers draw a lighter version of it, never the
// release's generic one.
//
// Three levels, lowest input wins:
//   - full: the authored composition (High and above, an unloaded scene).
//   - light: Medium, a High scene the governor has pushed under
//     PALADIN_FULL_QUALITY_FLOOR, or a cast the spam budget degraded once.
//     Keeps the core shape and the secondary layers, about half the motes,
//     no accents, shorter lingers.
//   - minimal: Low, or a cast the spam budget degraded twice (a crowded raid).
//     Keeps only the core shape, a third of the motes, short lingers.
//
// Cosmetic only. The terrain-draped area ring a player reacts to is drawn by the
// painter on every tier whatever this answers (paladinAreaTelegraph), and the
// static preset input is the effects tier the graphics settings own, so a
// preset never hides an actionable read (docs/design/graphics-settings-fairness.md).

export type PaladinVfxDetail = 'full' | 'light' | 'minimal';

export type PaladinEffectsTier = 'low' | 'medium' | 'high' | 'ultra' | 'insane';

const RANK: Record<PaladinVfxDetail, number> = { minimal: 0, light: 1, full: 2 };
const BY_RANK: readonly PaladinVfxDetail[] = ['minimal', 'light', 'full'];

/** Live VFX quality (the render budget's vfx level, 0..1) under which a High
 *  or Ultra scene draws the light version. High's governed band reaches down to
 *  0.68 under load; Ultra's floor (0.86) never crosses it. */
export const PALADIN_FULL_QUALITY_FLOOR = 0.8;

/** The detail the static graphics preset allows. */
export function paladinPresetDetail(effectsTier: PaladinEffectsTier): PaladinVfxDetail {
  if (effectsTier === 'low') return 'minimal';
  if (effectsTier === 'medium') return 'light';
  return 'full';
}

export interface PaladinVfxDetailInput {
  effectsTier: PaladinEffectsTier;
  /** The render budget's vfx quality level, 0..1. */
  quality: number;
  /** The spam budget's degrade tier for this cast (0 full, 1, 2 most degraded);
   *  absent for presence and aura effects, which no cast budget charges. */
  castTier?: 0 | 1 | 2;
}

/** The detail an effect draws at: the lowest of what the preset, the live
 *  quality and the cast budget allow. */
export function paladinVfxDetail(input: PaladinVfxDetailInput): PaladinVfxDetail {
  let rank = RANK[paladinPresetDetail(input.effectsTier)];
  const quality = Number.isFinite(input.quality) ? input.quality : 1;
  if (quality < PALADIN_FULL_QUALITY_FLOOR) rank = Math.min(rank, RANK.light);
  if (input.castTier !== undefined) rank = Math.min(rank, RANK.full - input.castTier);
  return BY_RANK[Math.max(0, rank)];
}

export interface PaladinDetailScale {
  /** Multiplier for mote, spark, shard and plus counts. */
  readonly count: number;
  /** Multiplier for linger and fade-tail durations (never the core beat). */
  readonly linger: number;
  /** Whether accents draw: extra flares, glints, flashes, sparkle bursts,
   *  heat shimmer, the decorative extras beyond the core and secondary layers. */
  readonly accents: boolean;
  /** Whether secondary layers draw: a second ring, a pillar behind the core,
   *  debris, trails, wing feathers beyond the silhouette. */
  readonly secondary: boolean;
}

const SCALE: Record<PaladinVfxDetail, PaladinDetailScale> = Object.freeze({
  full: Object.freeze({ count: 1, linger: 1, accents: true, secondary: true }),
  light: Object.freeze({ count: 0.5, linger: 0.7, accents: false, secondary: true }),
  minimal: Object.freeze({ count: 0.3, linger: 0.45, accents: false, secondary: false }),
});

export function paladinDetailScale(detail: PaladinVfxDetail): PaladinDetailScale {
  return SCALE[detail];
}

/** `n` motes scaled for `detail`: never below one when the full version draws
 *  any, so a lighter tier thins an effect rather than deleting it. */
export function paladinDetailCount(n: number, detail: PaladinVfxDetail): number {
  if (!(n > 0)) return 0;
  return Math.max(1, Math.round(n * SCALE[detail].count));
}

/** A linger or fade-tail duration scaled for `detail`. */
export function paladinDetailLinger(seconds: number, detail: PaladinVfxDetail): number {
  return seconds * SCALE[detail].linger;
}

/** The end of a fade tail running `from` to `to` on the full effect, shortened
 *  by `linger` (a paladinDetailScale linger factor); the full tier keeps `to`
 *  exactly, so the authored timing never drifts by a rounding step. */
export function paladinLingerEnd(from: number, to: number, linger: number): number {
  return linger === 1 ? to : from + (to - from) * linger;
}
