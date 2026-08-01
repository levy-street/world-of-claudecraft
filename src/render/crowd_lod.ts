// Crowd-adaptive character LOD policy. Pure (no DOM, no Three), so the renderer
// stays a thin consumer and the thresholds are unit-testable.
//
// As the visible rig count climbs, the ranges at which a character keeps its
// articulated shadow and its full-rate animation pull in toward a floor, so more
// of the throng collapses to the single-draw far LOD + static proxy shadow, and
// the mid band samples its clips less often. Below the knee (ordinary play, a
// handful of rigs) nothing changes: the scale is exactly 1 and the cadence is 2.
//
// FPS-first: in a crowd, a far pose that freezes a little sooner (and a mid-range
// pose that refreshes every 3rd or 4th frame instead of every 2nd) is a fair trade
// for staying above 60. Both are COSMETIC. Anything a player reacts to (the local
// player, the current target, an entity mid-cast) is exempted by the caller.
//
// Past the articulated band the rig used to swap STRAIGHT to the baked idle-pose
// mesh, so a character beyond it read as a sliding statue: the pose did not slow
// down, it stopped. `characterLodBands` inserts one band between the two: the rig
// stays articulated and keeps animating at a low cadence (every 4th to 6th frame,
// so ~10 to 15 pose updates per second, the mixer integrating the skipped time so
// the clip still plays at its real speed) out to `staticRangeSq`, and only past
// that does the frozen mesh take over. The extension is the ONLY thing the far
// band adds, and it collapses to exactly 1 as the crowd grows, so a throng keeps
// today's FPS-first behaviour bit for bit.

const CROWD_LOD_SOFT_RIGS = 14;
const CROWD_LOD_HARD_RIGS = 48;
const CROWD_LOD_MIN_SCALE = 0.6;

/**
 * Ceiling on the linear range multiplier the animated far band may add on top of
 * the articulated band (58yd base * 1.3 = ~75yd, just inside the 80yd draw cap).
 * `gfx.ts` picks the per-tier value; this module clamps to it so no caller can
 * push articulated rigs out past the range the draw cap was sized for.
 */
export const FAR_ANIM_RANGE_SCALE_MAX = 1.3;

const FAR_ANIM_CADENCE_CALM = 4;
const FAR_ANIM_CADENCE_MID = 5;
const FAR_ANIM_CADENCE_DENSE = 6;
/** Frozen-mesh band: the mixer only ticks to keep the pose warm for re-entry. */
const STATIC_LOD_CADENCE = 6;
// Frame-budget pressure (render_budget.ts: 1 means "at the drop threshold") over
// which the extension eases out, so the extra articulated rigs are the FIRST
// thing surrendered on a machine that is already struggling.
const FAR_ANIM_PRESSURE_EASE = 0.8;
const FAR_ANIM_PRESSURE_DROP = 1;

/** Squared distance scale for the LOD / shadow bands. Distances compare squared. */
export function crowdLodScaleSq(visibleRigs: number): number {
  if (visibleRigs <= CROWD_LOD_SOFT_RIGS) return 1;
  const span = CROWD_LOD_HARD_RIGS - CROWD_LOD_SOFT_RIGS;
  const t = Math.min(1, (visibleRigs - CROWD_LOD_SOFT_RIGS) / span);
  const scale = 1 - t * (1 - CROWD_LOD_MIN_SCALE);
  return scale * scale;
}

/**
 * How often a mid-band rig advances its AnimationMixer, in frames: every 2nd
 * when the scene is calm, stretching to every 4th once the crowd is dense.
 * Sampling clips and rebuilding bone matrices is the per-rig cost that scales
 * with the crowd, so this is the knob that flattens the curve.
 */
export function midAnimCadence(visibleRigs: number): number {
  if (visibleRigs <= CROWD_LOD_SOFT_RIGS) return 2;
  if (visibleRigs >= CROWD_LOD_HARD_RIGS) return 4;
  return 3;
}

/**
 * Whether an entity must advance its mixer EVERY frame regardless of how dense
 * the crowd is, because its pose carries information the player acts on rather
 * than mere cosmetic smoothness.
 *
 * This is the gameplay-fairness carve-out for the cadence above, and the repo
 * invariant it serves is: a performance knob may shed cosmetic richness but must
 * NEVER hide or delay actionable information. A cast windup is a telegraph, so a
 * caster keeps animating at full rate; so does the local player (whose own
 * animation is direct feedback) and the current target (whose pose the player is
 * actively reading).
 *
 * Pure so the carve-out is unit-tested rather than asserted in a comment: an
 * arm silently lost in a refactor is a real fairness regression.
 */
export function animatesEveryFrame(
  entityId: number,
  localPlayerId: number,
  targetId: number | null,
  castingAbility: string | null,
  inCombat = false,
  ownerId: number | null = null,
  combatTargetId: number | null = null,
  combatTargetOwnerId: number | null = null,
): boolean {
  return (
    entityId === localPlayerId ||
    entityId === targetId ||
    castingAbility !== null ||
    (inCombat &&
      (ownerId === localPlayerId ||
        combatTargetId === localPlayerId ||
        combatTargetId === targetId ||
        combatTargetOwnerId === localPlayerId))
  );
}

/**
 * How often a rig in the animated far band advances its mixer, in frames: every
 * 4th in a calm scene, stretching to every 6th once the crowd is dense. Slower
 * than the mid band on purpose (a pose that small is read as motion, not as
 * posture), but never frozen.
 */
export function farAnimCadence(visibleRigs: number): number {
  if (visibleRigs <= CROWD_LOD_SOFT_RIGS) return FAR_ANIM_CADENCE_CALM;
  if (visibleRigs >= CROWD_LOD_HARD_RIGS) return FAR_ANIM_CADENCE_DENSE;
  return FAR_ANIM_CADENCE_MID;
}

/**
 * The linear range multiplier the animated far band actually gets, after the
 * per-tier ceiling (`tierScale`, from `gfx.ts`), the crowd knee, and the live
 * frame-budget pressure. Returns exactly 1 (today's behaviour: articulated rig
 * straight to frozen mesh) for a dense crowd, a low tier, or a machine at its
 * frame budget.
 */
export function farAnimRangeScale(
  tierScale: number,
  visibleRigs: number,
  pressure: number,
): number {
  const capped = Math.min(FAR_ANIM_RANGE_SCALE_MAX, Math.max(1, tierScale || 1));
  if (capped === 1) return 1;
  const crowdT =
    visibleRigs <= CROWD_LOD_SOFT_RIGS
      ? 0
      : Math.min(
          1,
          (visibleRigs - CROWD_LOD_SOFT_RIGS) / (CROWD_LOD_HARD_RIGS - CROWD_LOD_SOFT_RIGS),
        );
  // NaN-safe: an unmeasured pressure reads as no pressure.
  const pressureT =
    pressure > FAR_ANIM_PRESSURE_EASE
      ? Math.min(
          1,
          (pressure - FAR_ANIM_PRESSURE_EASE) / (FAR_ANIM_PRESSURE_DROP - FAR_ANIM_PRESSURE_EASE),
        )
      : 0;
  const t = Math.max(crowdT, pressureT);
  return capped - t * (capped - 1);
}

/** The per-frame character LOD plan: squared band edges plus their cadences. */
export interface CharacterLodBands {
  /** past this, articulated shadows hand off to the static proxy */
  shadowRangeSq: number;
  /** past this, the rig drops to the low far cadence (still articulated) */
  lodRangeSq: number;
  /** past this, the rig collapses to the single-draw frozen far mesh */
  staticRangeSq: number;
  /** frozen-mesh edge for an entity whose pose is actionable (see below) */
  actionableStaticRangeSq: number;
  midCadence: number;
  farCadence: number;
}

/**
 * Build the frame's band plan from the crowd signal and the tier/pressure scale.
 *
 * `actionableStaticRangeSq` is the fairness floor for the frozen mesh: the crowd
 * knob may pull the articulated band in to 0.6x, and an entity mid-cast whose
 * windup the player is reading must not become a statue because OTHER entities
 * showed up. Anything `animatesEveryFrame` exempts therefore keeps its rig out to
 * the uncrowded base range no matter how dense the scene is (or how loaded the
 * machine is: this floor is deliberately independent of the frame budget).
 */
export function characterLodBands(
  visibleRigs: number,
  baseShadowRangeSq: number,
  baseLodRangeSq: number,
  tierFarScale: number,
  pressure = 0,
): CharacterLodBands {
  return characterLodBandsInto(
    {
      shadowRangeSq: 0,
      lodRangeSq: 0,
      staticRangeSq: 0,
      actionableStaticRangeSq: 0,
      midCadence: 1,
      farCadence: 1,
    },
    visibleRigs,
    baseShadowRangeSq,
    baseLodRangeSq,
    tierFarScale,
    pressure,
  );
}

/** Fill a caller-owned crowd LOD plan for the renderer hot path. */
export function characterLodBandsInto(
  out: CharacterLodBands,
  visibleRigs: number,
  baseShadowRangeSq: number,
  baseLodRangeSq: number,
  tierFarScale: number,
  pressure = 0,
): CharacterLodBands {
  const crowdSq = crowdLodScaleSq(visibleRigs);
  const lodRangeSq = baseLodRangeSq * crowdSq;
  const farScale = farAnimRangeScale(tierFarScale, visibleRigs, pressure);
  const staticRangeSq = lodRangeSq * farScale * farScale;
  out.shadowRangeSq = baseShadowRangeSq * crowdSq;
  out.lodRangeSq = lodRangeSq;
  out.staticRangeSq = staticRangeSq;
  out.actionableStaticRangeSq = Math.max(staticRangeSq, baseLodRangeSq);
  out.midCadence = midAnimCadence(visibleRigs);
  out.farCadence = farAnimCadence(visibleRigs);
  return out;
}

/** Whether a rig at `distSq` draws as the frozen far mesh instead of its rig. */
export function showsStaticFarMesh(
  distSq: number,
  bands: CharacterLodBands,
  actionable: boolean,
): boolean {
  return distSq > (actionable ? bands.actionableStaticRangeSq : bands.staticRangeSq);
}

/**
 * Frames between mixer updates for a rig at `distSq` (1 = every frame). Callers
 * apply the `animatesEveryFrame` carve-out themselves, so this is the purely
 * cosmetic ladder: full rate, mid cadence, far cadence, then the frozen band's
 * keep-warm tick.
 */
export function animCadenceFrames(distSq: number, bands: CharacterLodBands): number {
  if (distSq <= bands.shadowRangeSq) return 1;
  if (distSq <= bands.lodRangeSq) return bands.midCadence;
  if (distSq <= bands.staticRangeSq) return bands.farCadence;
  return STATIC_LOD_CADENCE;
}
