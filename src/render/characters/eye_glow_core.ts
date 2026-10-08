// A creature's eye, permanently lit: the SPEC and the curve.
//
// Balgath's whole identity is the Barrowglass burning in his socket: it is what the fight is
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
  /**
   * The GLB material that IS the lit eye on a rig whose iris is real geometry (Balgath's
   * Blender body: `BalgathGlow`, the iris, its slit pupil and the star-light veins in his
   * barrowhide). The shells above only halo it, so a death that dims the shells alone would
   * leave the iris burning on the corpse. The meshes drawing this material follow the
   * shells' brightness through `selfLitShown`. Absent = the shells are the whole eye.
   */
  selfLitMaterial?: string;
}

/** Below this brightness the self-lit eye mesh is hidden: out, not dimmed. */
export const EYE_SELF_LIT_OUT = 0.1;

/**
 * Whether the rig's own lit iris draws at eye brightness `k`.
 *
 * Shown or hidden rather than faded, because it is an opaque emissive surface (fading it
 * would need it transparent, which costs a sort and a program for nothing the rest of the
 * fight). Following the same curve gives the death its gutter for free: the stutter in
 * `eyeGlowDeathIntensity` drops through this line several times before it stays below it,
 * so the iris flickers out with the halo and then the sclera behind it is all that is left.
 */
export function selfLitShown(k: number): boolean {
  return k > EYE_SELF_LIT_OUT;
}

/**
 * The eye behind a SHUT lid (mob/slumber.ts): the shard still smoulders through it, so the
 * sleeper keeps his one identifying light, but nothing like the open eye. Steady, no pulse:
 * a breathing glow on a sleeping face reads as awake.
 */
export const EYE_GLOW_ASLEEP = 0.16;

/** Seconds the dying eye gutters (stutters bright and dark) before its last ember fades. */
export const EYE_GLOW_DEATH_FLICKER_SEC = 1.1;

/** Seconds after the death edge by which the eye is fully out. */
export const EYE_GLOW_DEATH_OUT_SEC = 1.6;

/**
 * Brightness of the eye `deadFor` seconds after the creature died.
 *
 * The one exception to the never-out contract below, and the reason it has a curve of its
 * own: a Barrowglass that simply switched off would read as a render pop, while one that
 * GUTTERS (stutters between bright and nearly dark, dimmer each time) and then leaves a
 * last ember to fade reads as the light going out of him. Deterministic in `deadFor`, so
 * every viewer sees the same death. Reduced motion drops the stutter (a strobe is exactly
 * what that setting exists to remove) and fades it evenly to dark on the same schedule.
 */
export function eyeGlowDeathIntensity(deadFor: number, reducedMotion = false): number {
  if (!(deadFor < EYE_GLOW_DEATH_OUT_SEC)) return 0;
  const t = Math.max(0, deadFor);
  if (reducedMotion) return 0.8 * (1 - t / EYE_GLOW_DEATH_OUT_SEC);
  if (t < EYE_GLOW_DEATH_FLICKER_SEC) {
    const decay = 1 - 0.55 * (t / EYE_GLOW_DEATH_FLICKER_SEC);
    const stutter = 0.5 + 0.5 * Math.sin(t * 47) * Math.sin(t * 13 + 1.3);
    const dropout = Math.sin(t * 29) > 0.55 ? 0.12 : 1;
    return decay * (0.35 + 0.65 * stutter) * dropout;
  }
  const f =
    (t - EYE_GLOW_DEATH_FLICKER_SEC) / (EYE_GLOW_DEATH_OUT_SEC - EYE_GLOW_DEATH_FLICKER_SEC);
  return 0.3 * (1 - f) * (1 - f);
}

/**
 * Brightness of the eye at `clock`.
 *
 * Never reaches zero, and that is the contract: this is what a creature IS, not something it
 * is doing, so there is no frame in which the LIVING eye is out (death has its own curve,
 * eyeGlowDeathIntensity above). Reduced motion holds it steady
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
