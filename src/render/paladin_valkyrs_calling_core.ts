import {
  VALKYRS_CALLING_APPROACH_DURATION,
  VALKYRS_CALLING_ASCENT_DURATION,
  VALKYRS_CALLING_FLIGHT_DURATION,
  VALKYRS_CALLING_TAKEOFF,
} from '../sim/combat/paladin_valkyrs_calling';
import { VALKYRS_CALLING_FLIGHT_AURA_ID } from '../sim/combat/paladin_valkyrs_calling_state';

/** Valkyr's Calling, as seen: the wings open and the weapon is raised to the
 * sky, the Paladin launches (dust kicked up where they leave) and vanishes into
 * the light near the top of the climb, reappears high over the landing and
 * slams down. Times are seconds of flight; the sim owns the path. */
export const VALKYR_LAUNCH = VALKYRS_CALLING_TAKEOFF;
export const VALKYR_VANISH = VALKYRS_CALLING_ASCENT_DURATION - 0.06;
export const VALKYR_RETURN = VALKYRS_CALLING_ASCENT_DURATION + VALKYRS_CALLING_APPROACH_DURATION;
export const VALKYR_LAND = VALKYRS_CALLING_FLIGHT_DURATION;
/** How long the landing slam lives on after touchdown. */
export const VALKYR_IMPACT_DURATION = 1.5;

interface FlightAura {
  id: string;
  remaining?: number;
  duration?: number;
}
export interface ValkyrFlightSource {
  auras: ReadonlyArray<FlightAura>;
  valkyrsCalling?: { elapsed: number } | null;
}

/** Seconds into the flight, or null when the entity is not flying. The sim's
 * own clock wins where the renderer can read it (offline, studio); online the
 * flight aura's countdown carries it. */
export function valkyrFlightElapsed(entity: ValkyrFlightSource): number | null {
  if (entity.valkyrsCalling) return entity.valkyrsCalling.elapsed;
  for (const aura of entity.auras) {
    if (aura.id !== VALKYRS_CALLING_FLIGHT_AURA_ID) continue;
    const duration = aura.duration ?? VALKYR_LAND;
    const remaining = aura.remaining ?? duration;
    // The aura carries one tick of headroom past the flight itself.
    return Math.min(VALKYR_LAND, Math.max(0, VALKYR_LAND - (remaining - (duration - VALKYR_LAND))));
  }
  return null;
}

/** Out of sight between the vanish near the top of the climb and the return
 * over the landing. */
export function valkyrVanished(elapsed: number | null): boolean {
  return elapsed !== null && elapsed >= VALKYR_VANISH && elapsed < VALKYR_RETURN;
}

function ramp(t: number, from: number, to: number): number {
  const x = Math.min(1, Math.max(0, (t - from) / (to - from)));
  return x * x * (3 - 2 * x);
}

/** Weapon raised overhead: kept low through the brace, thrust up as the
 * Paladin springs, held through the climb and again through the dive. */
export function valkyrBrandish(elapsed: number | null): number {
  if (elapsed === null) return 0;
  return ramp(elapsed, VALKYR_LAUNCH - 0.08, VALKYR_LAUNCH);
}

/** After touchdown: the weapon comes down hard (0..1 strike), then the body
 * recovers. Returns [strike, weight]. */
export function valkyrSlam(since: number): [number, number] {
  if (since < 0 || since >= 0.6) return [0, 0];
  return [ramp(since, 0, 0.07), 1 - ramp(since, 0.22, 0.6)];
}
