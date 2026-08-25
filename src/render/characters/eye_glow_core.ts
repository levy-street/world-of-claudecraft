// A creature's eye, permanently lit: the SPEC and the curve.
//
// Balgath's whole identity is the Loomshard burning in his socket: it is what the fight is
// named for, what his scry channel is, and the colour every one of his telegraphs borrows.
// A boss whose one eye only lights up while he happens to be casting reads as a statue
// between mechanics, and at raid distance the eye is the ONLY part of a grey stone
// silhouette with any colour in it at all.
//
// Three- and DOM-free for the same reason charge_glow_core.ts is: manifest.ts is
// deliberately data-only and must be able to name this spec type without pulling three into
// the data layer, and the curve is worth a unit test on its own.

/** Where the eye is, how big, and how slowly it breathes. */
export interface EyeGlowSpec {
  /** Bone to hang it on. */
  bone: string;
  /**
   * Bone-local offset to the eye, in the rig's own units.
   *
   * MEASURED off the rig (the front-most head vertex resolved into the head bone's frame at
   * rest), never guessed: a guess puts a glowing sphere behind the skull or floating in
   * front of the face, and which one you got is invisible from the angle you happen to
   * render a still at.
   */
  offset: [number, number, number];
  color: number;
  /** Core radius in bone-local units; the halo is drawn larger than this. */
  radius: number;
  /** Breaths per second. Slow: this is a pilot light, not a strobe. */
  pulseHz: number;
}

/**
 * The eye behind a SHUT lid (mob/slumber.ts): the shard still smoulders through it, so the
 * sleeper keeps his one identifying light, but nothing like the open eye. Steady, no pulse:
 * a breathing glow on a sleeping face reads as awake.
 */
export const EYE_GLOW_ASLEEP = 0.16;

/**
 * Brightness of the eye at `clock`.
 *
 * Never reaches zero, and that is the contract: this is what a creature IS, not something it
 * is doing, so there is no frame in which the eye is out. Reduced motion holds it steady
 * rather than turning it off, for the same reason; sleep dims it to the ember above.
 */
export function eyeGlowIntensity(
  spec: EyeGlowSpec,
  clock: number,
  reducedMotion = false,
  asleep = false,
): number {
  if (asleep) return EYE_GLOW_ASLEEP;
  if (reducedMotion) return 0.8;
  return 0.62 + 0.38 * (0.5 + 0.5 * Math.sin(clock * spec.pulseHz * Math.PI * 2));
}
