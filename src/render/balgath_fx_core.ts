// Pure planning math for Balgath's ground effects (see balgath_fx.ts for the Three half).
//
// Three/DOM/i18n-free and deterministic, so a Vitest drives it directly and the
// RENDER_PURE_CORES purity sweep in tests/architecture.test.ts covers it. Nothing here
// reads a clock: the caller passes normalized progress, which is what lets the same
// curve serve both the animated and the reduced-motion path.

/** How long a shockwave ring lives, seconds. */
export const BALGATH_RING_SECONDS = 0.62;

/** How long the smash crater darkening lingers, seconds. */
export const BALGATH_CRATER_SECONDS = 3.4;

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
 * The template prefix covers both silhouettes (`balgath_foreman`, `balgath_cyclops`),
 * which is deliberate: they are two bodies for ONE encounter and must throw the same
 * ground effects. The match radius is one yard squared, because the mechanic emitters
 * fire at `mob.pos` exactly and anything looser starts claiming other bosses' blasts.
 */
export const BALGATH_TEMPLATE_PREFIX = 'balgath_';
export const BALGATH_MECHANIC_MATCH_SQ = 1;
