import type { TreasureMapRarity } from '../content/treasure_maps';
import { Rng } from '../rng';

export interface HoardTidePatternWave {
  facing: number;
  /** Where the lane's escape gap sits across it; HOARD_TIDE_NO_GAP is a solid lane. */
  gap: number;
  span: number;
  radius: number;
  lead: number;
  total: number;
  /** Where this lane's middle sits, as a world offset from the volley's aim point. */
  dx: number;
  dz: number;
}

export const HOARD_TIDE_RECOVERY_SEC = 1;
/** Conservative unbuffed walking speed, including a modest movement penalty. */
export const HOARD_TIDE_ESCAPE_SPEED = 4;
/** A gap position far outside any span: the lane is solid, and narrow enough to
 *  step out of sideways instead. */
export const HOARD_TIDE_NO_GAP = 99;
/** Half the width of one lane. Narrow: the way out is always a few steps sideways. */
export const HOARD_TIDE_LANE_HALF_SPAN = 4.5;
/** Two lanes on the same axis leave this much calm floor between them. */
export const HOARD_TIDE_LANE_CORRIDOR = 5;
/** The crests of one volley leave this long after each other. */
export const HOARD_TIDE_STAGGER_SEC = 0.7;
export const HOARD_TIDE_ENRAGED_STAGGER_SEC = 0.45;
/** Reaction time granted on top of the walk out of a lane. */
const REACTION_SEC = 0.75;

/** Two lanes this close to parallel must leave the calm corridor between them;
 *  lanes that cross at an angle leave the way out along either. */
const PARALLEL_SIN = 0.35;
/** How far from the aim point a lane's middle may be laid, and how often one is
 *  laid straight over it: standing still on the target is no plan. */
const LANE_SCATTER = 8;
const OVER_AIM_CHANCE = 0.45;
/** Each crest leaves this much after the one before, never all at once. */
const STAGGER_MIN_SEC = 0.5;
const STAGGER_MAX_SEC = 1.5;

/** One VOLLEY: several narrow lanes laid over the fight at once, each at its own
 *  angle and its own place round the aim point (some straight over it), every
 *  telegraph visible from the first moment and the crests leaving one after
 *  another at uneven beats. Two near-parallel lanes never touch: a calm corridor
 *  always runs between them. */
export function hoardTidePattern(
  seed: number,
  rarity: TreasureMapRarity,
  enraged: boolean,
): HoardTidePatternWave[] {
  const tier = ['common', 'rare', 'epic', 'legendary'].indexOf(rarity);
  const radius = [22, 24, 26, 28][tier];
  const speed = [8, 9, 10, 11][tier];
  const count = [2, 3, 4, 4][tier];
  const hurry = enraged ? HOARD_TIDE_ENRAGED_STAGGER_SEC / HOARD_TIDE_STAGGER_SEC : 1;
  const rng = new Rng(seed);
  const span = HOARD_TIDE_LANE_HALF_SPAN;
  // From the MIDDLE of a lane (the worst place in it) a straight sideways walk
  // clears it inside the warning, reaction time included.
  const lead = (span + 0.6) / HOARD_TIDE_ESCAPE_SPEED + REACTION_SEC;
  const apart = 2 * span + HOARD_TIDE_LANE_CORRIDOR;
  const lanes: HoardTidePatternWave[] = [];
  let warn = lead;
  const corridorKept = (facing: number, ax: number, az: number, offset: number): boolean =>
    lanes.every((other) => {
      if (Math.abs(Math.sin(facing - other.facing)) >= PARALLEL_SIN) return true;
      const ox = Math.cos(other.facing);
      const oz = -Math.sin(other.facing);
      return Math.abs((offset * ax - other.dx) * ox + (offset * az - other.dz) * oz) >= apart;
    });
  for (let index = 0; index < count; index++) {
    let facing = 0;
    let ax = 0;
    let az = 0;
    let offset = 0;
    // A lane is laid at a seeded angle and place near the aim point. One that
    // would touch an earlier, near-parallel lane is re-rolled; if the seed keeps
    // finding no room it is laid square across that lane instead, which always fits.
    for (let attempt = 0; attempt < 8; attempt++) {
      facing = rng.range(0, Math.PI * 2);
      if (attempt >= 5) {
        // The angle furthest from parallel to every earlier lane: with at most three
        // of them and this margin, one always clears the corridor outright.
        let best = -1;
        for (let k = 0; k < 12; k++) {
          const candidate = facing + (k * Math.PI) / 12;
          const clearance = Math.min(
            ...lanes.map((other) => Math.abs(Math.sin(candidate - other.facing))),
          );
          if (clearance > best) {
            best = clearance;
            facing = candidate;
          }
        }
      }
      // Across the lane: the direction its middle is offset from the aim point.
      ax = Math.cos(facing);
      az = -Math.sin(facing);
      offset = rng.chance(OVER_AIM_CHANCE)
        ? rng.range(-span * 0.6, span * 0.6)
        : (rng.chance(0.5) ? 1 : -1) * rng.range(span, LANE_SCATTER);
      if (corridorKept(facing, ax, az, offset)) break;
    }
    if (index > 0) warn += rng.range(STAGGER_MIN_SEC, STAGGER_MAX_SEC) * hurry;
    lanes.push({
      facing,
      gap: HOARD_TIDE_NO_GAP,
      span,
      radius,
      lead: warn,
      total: warn + radius / speed,
      dx: ax * offset,
      dz: az * offset,
    });
  }
  return lanes;
}
