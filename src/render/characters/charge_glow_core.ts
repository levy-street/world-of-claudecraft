// A fist lighting up before it lands: the SPEC and the curve.
//
// The cue a telegraphed slam is missing. A ground ring says WHERE the blow is going and
// the wind-up clip says one is coming, but neither says which hand, and on a boss whose
// whole kit is his hands that is the read a player actually wants: one fist glowing means
// the hammer is coming down on somebody, both means the ground is.
//
// It is parented to the rig's own hand bone rather than drawn in world space, so it tracks
// the fist through the authored clip for free: the wind-up raises the arm and the glow
// goes up with it, because it IS on the arm. The bones are already resolved at load time
// for the weapon-attach path (visual.ts looks up `handslot.r`/`R_Hand`), so this costs no
// new traversal.
//
// Declared as ClipMap data (`chargeGlowByAbility`) rather than wired per boss, so a second
// creature with a telegraphed slam gets the same treatment by adding a row.
// Three- and DOM-free, so manifest.ts (which is deliberately data-only) can name the spec
// type without pulling three into the data layer, and so the curve is unit-testable.

/** Which hand (or both) lights up, and how. */
export interface ChargeGlowSpec {
  hand: 'l' | 'r' | 'both';
  color: number;
  /** Seconds from ignition to full brightness; the hold and fade follow. */
  rise: number;
  /** Total seconds the glow lives. Match it to the mechanic's windup. */
  seconds: number;
  /** World-unit radius BEFORE the rig's own scale, which the bone carries. */
  radius: number;
}

/**
 * Brightness at `age` through a `spec`.
 *
 * Rises, holds near full, then drops off a cliff at the end rather than fading out. The
 * cliff is the point: the glow is spent AT the impact, so the light going out is itself
 * the frame the blow lands on. A symmetric fade reads as the boss changing his mind.
 */
export function chargeGlowIntensity(spec: ChargeGlowSpec, age: number): number {
  if (age < 0 || age >= spec.seconds) return 0;
  if (age < spec.rise) return (age / Math.max(0.001, spec.rise)) ** 0.6;
  const tail = (age - spec.rise) / Math.max(0.001, spec.seconds - spec.rise);
  return tail > 0.88 ? Math.max(0, 1 - (tail - 0.88) / 0.12) : 1;
}

/**
 * World size of one orbiting mote, given the bone's own world scale.
 *
 * `PointsMaterial.size` under `sizeAttenuation` is a WORLD length: three's point shader
 * computes `gl_PointSize = size * (halfCanvasHeight / -viewZ)` and never consults the
 * object's world matrix, so a size expressed in the bone's own units is short by the rig's
 * whole normalize-and-scale chain. On a 4.2x-scaled boss that chain is 16.2x, which turned
 * a half-yard mote into a sub-pixel one: the shell was present, visible, correctly coloured
 * and correctly animated, and completely invisible in play. That is the only way this bug
 * ever presents, which is why the arithmetic lives here with a test on it.
 */
export function moteWorldSize(radius: number, boneWorldScale: number): number {
  const s = boneWorldScale > 1e-4 ? boneWorldScale : 1;
  return radius * 0.85 * s;
}
