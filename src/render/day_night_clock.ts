// The live day/night clock: turns the shared UTC-anchored cycle into the current
// phase, with a dev-only override so the /daynight chat command can freeze the
// world at any time of day for testing. This is deliberately NOT a pure core (it
// reads Date.now and holds the override state), so it lives outside
// day_night_core.ts and its determinism scan. The renderer (sky + lighting) and
// the HUD (minimap dial) both read currentDayNightPhase(), so a single override
// drives them together and they never disagree.

import { DAY_NIGHT_CYCLE_MS, NOON_PHASE } from '../sim/day_night';
import { cyclePhase, DAY_ONLY, lunarPhase } from './day_night_core';
import { type MoonSky, moonSky } from './twin_moons_core';

let phaseOverride: number | null = null;

/** Freeze the cycle at a phase in [0,1) (0 = midnight, 0.5 = noon), or pass null
 *  to resume the real UTC-anchored clock. Out-of-range input wraps into [0,1). */
export function setDayNightPhaseOverride(phase: number | null): void {
  phaseOverride = phase == null ? null : ((phase % 1) + 1) % 1;
}

/** The active override phase, or null while the real clock is running. */
export function dayNightPhaseOverride(): number | null {
  return phaseOverride;
}

/** The current cycle phase in [0,1): the dev override when set, otherwise noon
 *  while DAY_ONLY holds (the live UTC-anchored clock once it is lifted). Read by
 *  both the world lighting and the minimap dial, so they never disagree. */
export function currentDayNightPhase(): number {
  if (phaseOverride !== null) return phaseOverride;
  return DAY_ONLY ? NOON_PHASE : cyclePhase(Date.now());
}

let moonOverride: number | null = null;

/** Freeze the moon's shape at a lunar phase (0 = new, 0.5 = full), or pass
 *  null to resume the lunar clock. The `/daynight moon` dev command. */
export function setLunarPhaseOverride(phase: number | null): void {
  moonOverride = phase == null ? null : ((phase % 1) + 1) % 1;
}

/** The current lunar phase (0 = new, 0.5 = full): the dev override when set,
 *  else the epoch-anchored lunar clock. Deliberately NOT pinned by DAY_ONLY:
 *  the moon's shape is pure cosmetics and keeps drifting either way. */
export function currentLunarPhase(): number {
  if (moonOverride !== null) return moonOverride;
  return lunarPhase(Date.now());
}

let latitudeOverride: number | null = null;

/** Pin the natural moon's offset from the sun's path, in degrees (0 = on the
 *  path, so a full moon is a total eclipse covering the mage's moon), or pass
 *  null to resume its real tilted orbit. The `/daynight moon eclipse` dev command. */
export function setMoonLatitudeOverride(deg: number | null): void {
  latitudeOverride = deg;
}

/** The two-moon sky for a cycle phase (twin_moons_core), on the live lunar
 *  clock and the epoch-anchored world-day count, honoring both dev overrides. */
export function currentMoonSky(dayPhase: number): MoonSky {
  return moonSky(dayPhase, currentLunarPhase(), Date.now() / DAY_NIGHT_CYCLE_MS, latitudeOverride);
}
