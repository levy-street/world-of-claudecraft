// A ring blast with a safe gap: the Barrow Smash (Balgath, content/zone2.ts aoePulse).
//
// His circle smash lands as a solid disc round his feet and a band at its rim, with open
// ground between the two, and anyone standing in that open ring is missed (owner
// playtest: the gap he saw drawn should be somewhere to step into). The fractions are the
// whole contract between the layers: the sim's hit test (mob/locomotion.ts fireAoePulse)
// and the renderer's telegraph (render/balgath_ring_fx.ts) both read them from here, so
// the edge a player sees is the edge the blast uses.
//
// Pure: no SimContext, no rng, no clock.

/** A safe ring inside a circle blast, as fractions of the blast's radius. */
export interface RingGap {
  /** The inner disc's edge: the gap starts just outside it. */
  inner: number;
  /** The outer band's inner edge: the gap ends just inside it. */
  outer: number;
}

/**
 * The Barrow Smash's gap. On his 12-yard smash: the disc reaches 4.8 yards, the gap runs to
 * 8.4 (3.6 yards of open ground, two strides), and the band is the last 3.6 yards out to
 * the rim. Three reads now, not one: walk out of the ring, or step INTO the gap, while
 * hugging his shins (the disc) still costs you.
 */
export const BARROW_SMASH_GAP: Readonly<RingGap> = Object.freeze({ inner: 0.4, outer: 0.7 });

/** Whether a point `distance` yards from the blast centre stands in the safe gap. */
export function insideRingGap(distance: number, radius: number, gap: RingGap): boolean {
  return distance > gap.inner * radius && distance < gap.outer * radius;
}

/**
 * The drawn bands, in yards: the solid disc's radius, and the outer band from `bandIn` to
 * `bandOut`. With no gap the disc is the whole circle.
 */
export function ringGapBands(
  radius: number,
  gap: RingGap | null | undefined,
): { disc: number; bandIn: number; bandOut: number } {
  if (!gap) return { disc: radius, bandIn: radius, bandOut: radius };
  return { disc: radius * gap.inner, bandIn: radius * gap.outer, bandOut: radius };
}
