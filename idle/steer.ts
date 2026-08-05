// Per-tick steering toward a world-space goal.
//
// Why this exists: the once-per-step action surface cannot steer. A single
// TURN action held for a whole step (frameSkip ticks = 1 sim-second) rotates
// the player exactly PI radians (TURN_SPEED rad/sec over 1 sec), so the facing
// can only ever land on one of two antipodal angles and a once-per-step
// steering loop never converges, the player spins forever and never reaches
// the camp or a mob. Driving the decision PER TICK (the sim's normal input
// cadence) keeps each correction at TURN_SPEED * DT ~ 0.157 rad, well inside
// the steering threshold, so the facing converges between steps and the
// character actually walks to its goal.
//
// Pure leaf: reads player/goal state, mutates only sim.moveInput for the
// current tick (via the public action surface). No rng, no wall clock.

import { applyAction } from '../src/sim/obs';
import type { Sim } from '../src/sim/sim';
import { angleTo, MELEE_ARC, normAngle, type Vec3 } from '../src/sim/types';
import { steerToward } from './movement';

const NOOP = 0;
const TURN_LEFT = 3;
const TURN_RIGHT = 4;

/**
 * Issue the movement input for the CURRENT tick so the player approaches
 * `goal`. Re-evaluate every tick so the facing converges. Returns true once
 * the player is within steerToward's stop distance AND facing the goal
 * (melee-ready); until then the caller should keep ticking with the input
 * this sets.
 */
export function steerTick(sim: Sim, goal: Vec3): boolean {
  const p = sim.player;
  const steer = steerToward(p.pos, p.facing, goal);
  if (!steer.arrived) {
    applyAction(sim, steer.action);
    return false;
  }
  // Within stop distance: don't walk into the goal, but still turn to face it
  // if not aligned, melee needs the target in front to connect. Turn in
  // place (cancel the forward applyAction auto-sets for turns) so the player
  // does not walk past the goal while correcting facing.
  const rel = normAngle(angleTo(p.pos, goal) - p.facing);
  if (Math.abs(rel) > MELEE_ARC / 2) {
    applyAction(sim, rel > 0 ? TURN_LEFT : TURN_RIGHT);
    sim.moveInput.forward = false;
    return false;
  }
  applyAction(sim, NOOP);
  return true;
}
