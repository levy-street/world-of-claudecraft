// Stuck-recovery steering for client-less player bots, shared by the offline
// Fiesta practice bots (social/fiesta_bots.ts) and the Graveyard Shift party
// (graveyard_shift/bot_driver.ts). Moved verbatim out of fiesta_bots.ts.
// Pure position/tick bookkeeping: no SimContext, no rng.

import { normAngle } from '../types';

// Straight-at-target steering wedges on the coliseum's cover: a bot that
// re-aims at a target behind a pillar or approach screen every tick converges
// to a zero-progress equilibrium against the obstacle. Track per-bot progress
// and, when a forward-moving bot stops making any, detour perpendicular for a
// beat. Fixed-length alternating detours can limit-cycle over a gap (each leg
// retraces the last), so consecutive failed attempts alternate sides with
// ESCALATING leg lengths; the growing sweep clears any cover pocket in the
// pit, and a sustained stretch of free pursuit resets the escalation. Pure
// position/tick bookkeeping, no rng. Each caller keeps the state
// with its own bots (Fiesta: `Sim.fiestaBotSteer`; Graveyard Shift: the run's
// roster), session-only and never serialized.
export interface BotSteer {
  x: number;
  z: number;
  stuck: number;
  free: number;
  detour: number;
  attempts: number;
  sign: 1 | -1;
}
export function freshBotSteer(): BotSteer {
  // NaN start position: the first sample reads as progress, never as a wedge.
  return { x: Number.NaN, z: Number.NaN, stuck: 0, free: 0, detour: 0, attempts: 0, sign: 1 };
}
export const BOT_STUCK_EPSILON = 0.05; // yd/tick; an unblocked bot covers ~0.3
export const BOT_STUCK_TICKS = 10; // half a second of no progress means wedged
export const BOT_DETOUR_TICKS = 20; // base sideways leg: one second
export const BOT_DETOUR_MAX_LEGS = 6; // escalation cap (a 6s leg out-walks any cover run)
export const BOT_FREE_TICKS = 20; // a second of unblocked pursuit resets escalation

// Advance one tick of stuck-recovery steering and return the heading to move
// along: the goal heading while progress is being made, a perpendicular
// detour heading while rounding cover. The heading is always derived from
// goalAngle (never from accumulated facing, which would compound the bend).
// A leg that itself stops making progress (wedged on a wall) aborts early
// instead of riding out and then escalating. `maxDetourTicks` lets a caller
// with a more urgent goal (escaping the hazard ring) cap any in-flight leg.
// Pure state-machine core, exported for direct unit tests.
export function advanceBotSteer(
  st: BotSteer,
  x: number,
  z: number,
  goalAngle: number,
  maxDetourTicks = Number.POSITIVE_INFINITY,
): number {
  const moved = Math.hypot(x - st.x, z - st.z);
  st.x = x;
  st.z = z;
  const wedged = moved < BOT_STUCK_EPSILON; // NaN compares false: first sample is progress
  if (st.detour > maxDetourTicks) st.detour = maxDetourTicks;
  if (st.detour > 0) {
    if (wedged) {
      st.stuck++;
      if (st.stuck >= BOT_STUCK_TICKS) {
        st.detour = 0;
        st.stuck = 0;
        return goalAngle;
      }
    } else {
      st.stuck = 0;
    }
    st.detour--;
    return normAngle(goalAngle + st.sign * (Math.PI / 2));
  }
  if (wedged) {
    st.free = 0;
    st.stuck++;
    if (st.stuck >= BOT_STUCK_TICKS) {
      st.stuck = 0;
      st.attempts = Math.min(st.attempts + 1, BOT_DETOUR_MAX_LEGS);
      st.detour = Math.min(BOT_DETOUR_TICKS * st.attempts, maxDetourTicks);
      st.sign = st.sign === 1 ? -1 : 1;
      return normAngle(goalAngle + st.sign * (Math.PI / 2));
    }
    return goalAngle;
  }
  st.stuck = 0;
  st.free++;
  if (st.free >= BOT_FREE_TICKS) st.attempts = 0;
  return goalAngle;
}
