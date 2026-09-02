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
// where every upright goes edge-on and the meadow reads as bare ground. So the
// ladder sheds the cap first and keeps the diagonal, whose break-up works from
// every angle rather than one.
//
// WHAT THAT COSTS IS NOT THE SAME ON THE TWO TIERS THAT PAY IT, and the
// difference is the blade carpet (GFX.bladeCarpetRadius: 34 on ultra and up,
// 24 on high, 0 below). Where a carpet exists the cap card was already
// collapsed inside it (grass_cap_collapse_core.ts), so on HIGH its loss is the
// mid ring only, past ~24 yd, where the camera is far enough that the uprights
// still cover the ground. MEDIUM has no carpet, so it loses the cap outright:
// a hard top-down camera there sees the meadow through the uprights' edges.
// That is the deliberate trade, not an oversight, and it is why the diagonal
// (which never goes fully edge-on) is the card medium keeps.

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
export function grassTuftTriangles(cards: number, lush = true): number {
  return grassCardCount(cards, lush) * TRIANGLES_PER_GRASS_CARD;
}

/**
 * Clamp an arbitrary knob value onto the shipped ladder. A stray value can
 * only ever cost LESS than it asked for (it floors, and a non-finite value
 * takes the cheapest rung), the same convention canopy_detail_tier_core.ts
 * follows: these are cost knobs, and failing open on one is how a garbage
 * value ends up charging the weakest hardware the most.
 *
 * `lush` is a HARD CEILING, not a preference. The diagonal and the cap are
 * authored at lush proportions only (a lean tuft's uprights are shorter and
 * narrower, and no lean sizes exist for the other two), so a lean tuft with
 * three cards would stand a 1.05-tall breaker on top of a 0.76-tall tuft.
 * A lean session also runs the lean MODEL set because its hardware cannot
 * afford the full one, which is the same reason it should not be paying for
 * extra cards. Before the count was a knob this was structural (the extra
 * cards were built inside an `if (lush)`); it stays structural here rather
 * than living as a rule every caller has to remember.
 */
export function grassCardCount(cards: number, lush = true): number {
  if (!lush) return GRASS_CARDS_LEAN;
  if (!Number.isFinite(cards)) return GRASS_CARDS_LEAN;
  return Math.max(GRASS_CARDS_LEAN, Math.min(GRASS_CARDS_FULL, Math.floor(cards)));
}

/**
 * True when the tuft carries the sky-facing cap card (`aCap` = 1). The grass
 * build keys the whole cap-collapse layer off this: with no cap card there is
 * no vertex for the collapse to move, so a tier without one carries neither
 * the `aCap` attribute nor the collapse term in its vertex shader.
 */
export function grassTuftHasCap(cards: number, lush = true): boolean {
  return grassCardCount(cards, lush) >= GRASS_CARDS_FULL;
}

/**
 * The tuft's cards, in merge order. `lush` is the non-lean silhouette (wider,
 * taller cards with more blades in the texture); `lowPlusScale` is the lean
 * art-direction bump, which only ever applies to the lean sizes.
 *
 * The first `cards` entries of the full ladder are returned, so the shed order
 * (cap, then the diagonal) is a property of this list rather than of any
 * caller, and a lean tuft is always the pair (see grassCardCount).
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
  return ladder.slice(0, grassCardCount(cards, lush));
}
