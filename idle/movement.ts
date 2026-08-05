// Shared steering helper: given a target world position, compute the
// `applyAction` indices the priority ladder should issue (forward / turn) so
// the player walks toward that position across consecutive steps.
//
// `moveToward` is private to the sim mob-AI system, so the idle host must
// steer the primary player through the public action surface instead.

import type { Sim } from '../src/sim/sim';
import { angleTo, dist2d, normAngle, type Vec3 } from '../src/sim/types';

/** Actions the caller should issue this step to steer toward `target`. */
export interface SteerResult {
  /** `applyAction` index (one of forward/turn_left/turn_right/stop_noop). */
  readonly action: number;
  /** True when the player is close enough to the target. */
  readonly arrived: boolean;
}

// Action indices (from src/sim/obs.ts ACTIONS).
const FORWARD = 1;
const TURN_LEFT = 3;
const TURN_RIGHT = 4;
const NOOP = 0;

// Turn threshold: radians off-facing before we bother steering.
// Within this arc we just push forward.
const TURN_THRESHOLD = 0.15;

// How far from the target position we consider "close enough" for interaction
// or melee (same as INTERACT_RANGE / MELEE_RANGE from types.ts).
const STOP_DISTANCE = 5;

/**
 * Decide what movement action to take this step to steer the player from
 * `fromPos` (usually `sim.player.pos`) toward `targetPos`.
 *
 * This is stateless, every step re-evaluates the relative angle and
 * distance. Call `steerToward` once per step, issue `result.action` via
 * `applyAction`, then check `result.arrived` for the next decision.
 */
export function steerToward(fromPos: Vec3, facing: number, targetPos: Vec3): SteerResult {
  const d = dist2d(fromPos, targetPos);
  if (d <= STOP_DISTANCE) {
    return { action: NOOP, arrived: true };
  }
  const targetAngle = angleTo(fromPos, targetPos);
  // In the sim's player_motion.ts:
  //   turnLeft  → facing += TURN_SPEED * DT  (INCREASES facing, CCW)
  //   turnRight → facing -= TURN_SPEED * DT  (DECREASES facing, CW)
  // `angleTo` returns positive when the target is to the RIGHT (+X).
  // So rel > 0 means target is to the right → we need to INCREASE facing →
  // turn LEFT to rotate toward the target.
  const rel = normAngle(targetAngle - facing);
  if (rel > TURN_THRESHOLD) {
    return { action: TURN_LEFT, arrived: false };
  }
  if (rel < -TURN_THRESHOLD) {
    return { action: TURN_RIGHT, arrived: false };
  }
  // Facing roughly toward target, push forward.
  return { action: FORWARD, arrived: false };
}

/**
 * Shortcut: return an `applyAction` index for turning toward a target
 * entity (or its corpse position). Returns `NOOP` when there is no target,
 * or when the target is already in range (caller should loot/attack).
 *
 * This is the common "acquire + approach" block the priority ladder uses.
 */
export function steerTowardTargetEntity(sim: Sim, dist: number): number {
  const p = sim.player;
  const targetId = p.targetId;
  if (targetId === null) return NOOP;
  const target = sim.entities.get(targetId);
  if (!target) return NOOP;
  const result = steerToward(p.pos, p.facing, target.pos);
  if (result.arrived) return NOOP;
  return result.action;
}
