// Pure planning math for Balgath's ground effects (see balgath_fx.ts for the Three half).
//
// Three/DOM/i18n-free and deterministic, so a Vitest drives it directly and the
// RENDER_PURE_CORES purity sweep in tests/architecture.test.ts covers it. Nothing here
// reads a clock: the caller passes normalized progress, which is what lets the same
// curve serve both the animated and the reduced-motion path.

/** How long a shockwave ring lives, seconds. */
export const BALGATH_RING_SECONDS = 0.62;

/**
 * How long a crater he punched into the ground stays there, seconds.
 *
 * Three minutes and a bit, and the length IS the point. A scorch that fades in a few
 * seconds is an impact flash; ground that is still torn open long after the fists that
 * tore it have gone is a record of the fight, and it is the difference between a boss who
 * visits a landmark and a boss who WRECKED one. It deliberately outlives his death, so a
 * raid that kills him at the Fenbridge gate walks away past the holes.
 *
 * It is a wall-clock life rather than anything keyed to his state on purpose: nothing has
 * to notice that he died, reset, despawned or was never there, which is exactly the set of
 * cases a "clear the craters when the fight ends" rule gets wrong one at a time.
 */
export const BALGATH_CRATER_SECONDS = 195;

/** Fraction of a crater's life spent fading out at the end. */
export const BALGATH_CRATER_FADE = 0.28;

/**
 * The aimed slams' cue ids, which are agreed with the sim rather than imported from it.
 *
 * `src/render` may import pure sim leaves, but mob/boss_slams.ts is a SimContext consumer
 * and pulling it in here would drag the whole simulation into the render bundle for two
 * string constants. tests/balgath_boss_assets.test.ts welds the two sides instead, the
 * same way the gait references are welded to the sim's scale.
 */
export const BALGATH_HAMMER_ABILITY = 'mob_balgath_hammer';
export const BALGATH_CLEAVE_ABILITY = 'mob_balgath_cleave';

/** Half-width of the cleave arc in radians; matches the template's halfArcDeg of 60. */
export const BALGATH_CLEAVE_HALF_ARC = (60 * Math.PI) / 180;

/** Camera trauma for the aimed slams: the hammer is a jolt, the cleave a long shove. */
export const BALGATH_HAMMER_TRAUMA = 0.3;
export const BALGATH_CLEAVE_TRAUMA = 0.38;

/**
 * Debris thrown per unit of blast radius, and why it is not simply proportional.
 *
 * A sixteen-yard slam does not throw four times the soil of an eight-yard one; it throws
 * soil over four times the area, and the eye reads the RIM. Scaling the burst by the
 * square root of the radius keeps the density along that rim roughly constant, so the big
 * slams look bigger without the small ones looking empty.
 */
export function debrisPowerForBlast(radius: number): number {
  return Math.min(1.6, Math.sqrt(Math.max(0.5, radius) / 9));
}

/** Ground-pool radius under the scrying eye, world units. */
export const BALGATH_EYE_POOL_RADIUS = 5.5;

export interface BalgathRingPlan {
  /** Radius the ring starts at (a slam does not begin as a point: his fists are wide). */
  startRadius: number;
  /** Radius the ring reaches at the end of its life. */
  maxRadius: number;
  /** Peak opacity, scaled by the effect's power. */
  peakAlpha: number;
}

/**
 * Plan a shockwave ring for a blast of `radius` at `power` (1 = the full overhead smash,
 * ~0.3 = a footfall). The ring deliberately overshoots the true blast radius by a small
 * margin: the damage has already resolved by the time the dust reaches the edge, and a
 * ring that stops exactly on the hit line reads as though it fell short.
 */
export function planBalgathRing(radius: number, power: number): BalgathRingPlan {
  const p = clamp01(power);
  return {
    startRadius: Math.max(0.6, radius * 0.22),
    maxRadius: Math.max(1, radius) * (1.08 + 0.06 * p),
    peakAlpha: 0.24 + 0.5 * p,
  };
}

/** Ring radius at normalized age `t` (0..1). Fast out of the gate, then coasting. */
export function balgathRingRadius(plan: BalgathRingPlan, t: number): number {
  const k = easeOutCubic(clamp01(t));
  return plan.startRadius + (plan.maxRadius - plan.startRadius) * k;
}

/**
 * Ring opacity at normalized age `t`. Rises almost instantly (the dust is thrown, not
 * grown), holds briefly, then fades to nothing by the end so no ring ever pops out.
 */
export function balgathRingAlpha(plan: BalgathRingPlan, t: number): number {
  const x = clamp01(t);
  if (x < 0.12) return plan.peakAlpha * (x / 0.12);
  return plan.peakAlpha * (1 - (x - 0.12) / 0.88) ** 1.6;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

/**
 * Footprint that separates Balgath's two slams when only the blast radius is known.
 *
 * The mob-mechanic emitters carry no mechanic name, so the renderer tells the smash
 * from the stomp by size. 9 sits between the two authored footprints with room on
 * either side; it is a PRESENTATION split only, and picking it wrong costs a ring of
 * the wrong tint, never a missing or mis-sized telegraph (the shared rune circle is
 * what a player actually dodges, and it is drawn from the sim's own radius).
 */
export const BALGATH_SMASH_MIN_RADIUS = 9;

/**
 * How Balgath is recognised as the source of a shared mob-mechanic effect.
 *
 * A prefix rather than an exact id so a future second body (a phase-two form, a heroic
 * variant) throws the same ground effects without a second registration. Identity itself
 * is resolved from the event's `sourceId`, never from where the effect landed.
 */
export const BALGATH_TEMPLATE_PREFIX = 'balgath_';

/**
 * Camera trauma for each slam, and the two are deliberately different.
 *
 * `addShake` squares its input on apply, so these are not linear: 0.45 lands as a real
 * jolt and 0.22 as a thud you feel more than see. The smash is the telegraphed
 * circle-breaker and gets the bigger kick; the stomp is the quicker cousin and must not
 * compete with it, or the two mechanics stop being distinguishable by feel. Both route
 * through `Renderer.addShake`, which is already a no-op under reduced motion.
 */
export const BALGATH_SMASH_TRAUMA = 0.45;
export const BALGATH_STOMP_TRAUMA = 0.22;

/**
 * Yards of travel between footfall puffs.
 *
 * Spacing dust by DISTANCE rather than by a timer is what ties it to a footfall: it stays
 * in step when he is slowed and stops dead when he stops, where a timer keeps puffing at
 * a standing giant. 4.4 is roughly his half-stride at scale 4.2, so it reads as one puff
 * per planted foot rather than a continuous smear.
 */
export const BALGATH_STRIDE_UNITS = 4.4;

/**
 * How long each frame's eye-pool refresh keeps the ground lit.
 *
 * A short lease re-armed every frame of the channel, rather than a latch set on a cast
 * start: an interrupted or cancelled cast simply stops refreshing and the pool goes out
 * on its own, with no cancel event to miss.
 */
export const EYE_POOL_LEASE_SECONDS = 0.25;

/**
 * How much of a slam's camera trauma survives the distance to it.
 *
 * His slams land across the whole zone, and a boss wrecking a landmark two hundred yards
 * away must not punch the viewer in the face. Full strength inside `near`, nothing past
 * `far`, and a squared falloff between so the drop is felt as distance rather than as a
 * switch. Pure, so the curve is unit-testable without a camera.
 */
export function slamShakeFalloff(
  camera: { x: number; z: number },
  x: number,
  z: number,
  near = 18,
  far = 95,
): number {
  const d = Math.hypot(camera.x - x, camera.z - z);
  if (d <= near) return 1;
  if (d >= far) return 0;
  const t = 1 - (d - near) / (far - near);
  return t * t;
}
