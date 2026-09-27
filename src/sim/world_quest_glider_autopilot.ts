// A bounded autopilot for the Windrider Slalom: steers a fresh flight ring to
// ring with the same turn and pitch inputs a careful player has, boosting when
// slow, through the real flight tick. Pure and deterministic (no Rng, no wall
// clock): the same course and seed always fly the same line.
//
// Certification tests use this to verify every authored ranked course.

import { GLIDER_LAUNCH_SITE } from './content/world_quest_glider';
import { createPlayer } from './entity';
import { applyGliderBoost } from './minigames/glider_boost';
import {
  createGliderFlightState,
  type GliderCourseDef,
  type GliderFlightState,
  tickGliderFlight,
} from './minigames/glider_flight';
import { emptyMoveInput, normAngle } from './types';

export interface AutopilotFlight {
  phase: GliderFlightState['phase'];
  /** Rings passed, in course order. */
  passedRings: number;
  ticks: number;
}

const AUTOPILOT_TICK_BUDGET = 2400;

export function autopilotFlight(course: GliderCourseDef, worldSeed: number): AutopilotFlight {
  const player = createPlayer(1, 'warrior', { ...GLIDER_LAUNCH_SITE.playerLaunch }, 'Pilot');
  player.facing = GLIDER_LAUNCH_SITE.playerFacing;
  const state = createGliderFlightState(false);
  let targetIndex = 0;
  let ticks = 0;
  for (; ticks < AUTOPILOT_TICK_BUDGET && state.phase === 'flying'; ticks++) {
    if (state.passedRings.includes(course.rings[targetIndex]?.id)) targetIndex++;
    const target = course.rings[targetIndex] ?? course.landingPad;
    const distance = Math.hypot(target.x - player.pos.x, target.z - player.pos.z);
    const angle = normAngle(
      Math.atan2(target.x - player.pos.x, target.z - player.pos.z) - player.facing,
    );
    const wantedVy = (target.y - player.pos.y) / Math.max(0.4, distance / state.speed);
    const climbRate =
      (7 + Math.max(0, state.speed - 22) * 0.7) *
      Math.max(0.1, Math.min(1, (state.speed - 10) / 8));
    const pitch = Math.max(
      -1,
      Math.min(1, (wantedVy + 0.55) / (wantedVy >= -0.55 ? climbRate : 14)),
    );
    if (state.speed < 22) applyGliderBoost(state);
    tickGliderFlight(
      state,
      player,
      { ...emptyMoveInput(), turnLeft: angle > 0.06, turnRight: angle < -0.06, gliderPitch: pitch },
      course,
      worldSeed,
    );
  }
  return { phase: state.phase, passedRings: state.passedRings.length, ticks };
}
