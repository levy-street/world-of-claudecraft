// The grass tuft's card PLAN: how many alpha-tested quads a tuft is made of at
// a given tier, and the exact placement of each one. Pure (no Three, no DOM,
// no GFX singleton), registered in RENDER_PURE_CORES, so the triangle count a
// tier pays per tuft is a Node-testable number rather than a shape you have to
// read out of a merged BufferGeometry.
//
// WHY THE COUNT IS A TIER KNOB. Every card is a DOUBLE-SIDED alpha-tested quad
// carrying the tuft texture, and the grass shader adds two more discards on top
// of the stock alpha test (foliage_shader_core.ts patchGrassFragmentShader).
// On an immediate-mode desktop GPU a discard defeats early-Z, so a tuft's cost
// is its card count times its screen area, paid again for every tuft the carpet
// draws: this is the densest near-field fill layer in the world. The card count
// was one binary switch (lean tiers 2, everything else 4) and the whole span of
// the ladder above lean was zero. Each card is 2 triangles.
//
// WHICH CARD GOES FIRST. The two perpendicular uprights are the tuft: drop
// either and the silhouette collapses to a single plane that vanishes edge-on.
// The 45-degree card breaks the "4-way image" the perpendicular pair reads as
// from above. The near-horizontal CAP card exists for a true top-down camera,
// where every upright goes edge-on and the meadow reads as bare ground; it is
// also the one card the carpet tiers already collapse near the player
// (grass_cap_collapse_core.ts), so on a carpet tier its loss is the mid ring
// only, where the camera is far enough that the uprights still cover the
// ground. So the ladder sheds the cap first and keeps the diagonal.

/** One quad of a tuft, in the order the merged geometry applies its ops. */
export interface GrassTuftCard {
  /** stable diagnostic id */
  id: 'upright' | 'upright-cross' | 'diagonal' | 'cap';
  width: number;
  height: number;
  /** rotation about X applied BEFORE the lift (the cap card lies down first) */
  preRotX: number;
  /** vertical lift, applied after preRotX */
  liftY: number;
  /** rotation about Z applied after the lift */
  rotZ: number;
  /** rotation about Y applied after rotZ */
  rotY: number;
  /** the `aCap` attribute value: 1 on the near-horizontal cap card, 0 elsewhere */
  cap: 0 | 1;
}

/** Lean tiers (low, and the weak-iGPU medium session): the legacy sprite pair. */
export const GRASS_CARDS_LEAN = 2;
/** Medium and high: the two uprights plus the 45-degree breaker, no cap card. */
export const GRASS_CARDS_MID = 3;
/** Ultra and insane: the full tuft, cap card included. */
export const GRASS_CARDS_FULL = 4;

/** Every card is a PlaneGeometry: two triangles, drawn double-sided. */
export const TRIANGLES_PER_GRASS_CARD = 2;

/** Triangles one tuft's merged geometry carries at `cards` cards. */
export function grassTuftTriangles(cards: number): number {
  return grassCardCount(cards) * TRIANGLES_PER_GRASS_CARD;
}

/** Clamp an arbitrary knob value onto the shipped ladder. */
export function grassCardCount(cards: number): number {
  if (!Number.isFinite(cards)) return GRASS_CARDS_FULL;
  return Math.max(GRASS_CARDS_LEAN, Math.min(GRASS_CARDS_FULL, Math.floor(cards)));
}

/** True when the tuft carries the sky-facing cap card (`aCap` = 1). */
export function grassTuftHasCap(cards: number): boolean {
  return grassCardCount(cards) >= GRASS_CARDS_FULL;
}

/**
 * The tuft's cards, in merge order. `lush` is the non-lean silhouette (wider,
 * taller cards with more blades in the texture); `lowPlusScale` is the lean
 * art-direction bump, which only ever applies to the lean sizes.
 *
 * The first `cards` entries of the full ladder are returned, so the shed order
 * (cap, then the diagonal) is a property of this list rather than of any
 * caller.
 */
export function grassTuftCards(cards: number, lush: boolean, lowPlusScale = 1): GrassTuftCard[] {
  const width = lush ? 1.45 : 1.1 * lowPlusScale;
  const height = lush ? 0.9 : 0.7 * lowPlusScale;
  const liftY = lush ? 0.4 : 0.35 * lowPlusScale;
  const ladder: GrassTuftCard[] = [
    { id: 'upright', width, height, preRotX: 0, liftY, rotZ: 0, rotY: 0, cap: 0 },
    { id: 'upright-cross', width, height, preRotX: 0, liftY, rotZ: 0, rotY: Math.PI / 2, cap: 0 },
    {
      // narrower and taller than the pair, leaned slightly, so the cross reads
      // as a tuft from every yaw instead of an X
      id: 'diagonal',
      width: 1.15,
      height: 1.05,
      preRotX: 0,
      liftY: 0.45,
      rotZ: 0.12,
      rotY: Math.PI / 4,
      cap: 0,
    },
    {
      // near-horizontal: blade texture facing the sky for the top-down camera
      id: 'cap',
      width: 1.05,
      height: 1.05,
      preRotX: -Math.PI / 2 + 0.18,
      liftY: 0.34,
      rotZ: 0,
      rotY: 0,
      cap: 1,
    },
  ];
  return ladder.slice(0, grassCardCount(cards));
}
