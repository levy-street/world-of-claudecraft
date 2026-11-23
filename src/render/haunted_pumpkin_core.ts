import { seasonalFlicker } from './seasonal_glow_core';

/** The hunt pumpkin's size over the city kit's carved pumpkin: a quest object
 * read from across a meadow, not one more piece of street dressing. The
 * painter scales the whole built group, so picking and the nameplate follow. */
export const HAUNTED_PUMPKIN_SCALE = 2.5;
/** The kit's carved pumpkin stands 0.9 tall at its natural size. */
export const HAUNTED_PUMPKIN_HEIGHT = 0.9 * HAUNTED_PUMPKIN_SCALE;

/** The beacon's breath: one slow period, never the candle's nervous flicker. */
export const HAUNTED_PUMPKIN_BEACON_PERIOD = 2.8;
/** Mid level and swing of the beacon on the candle core (`GourdGlow`). */
export const HAUNTED_PUMPKIN_BEACON_MID = 0.85;
export const HAUNTED_PUMPKIN_BEACON_SWING = 0.45;

/** The slow soft pulse of a pumpkin still to find, in [mid - swing, mid + swing].
 * Reduced motion holds the mid level: the beacon stays readable, it just stops
 * breathing. Pure (time comes in), so a Vitest pins the curve directly. */
export function hauntedPumpkinBeacon(time: number, reducedMotion = false): number {
  if (reducedMotion) return HAUNTED_PUMPKIN_BEACON_MID;
  const wave = Math.sin((time * 2 * Math.PI) / HAUNTED_PUMPKIN_BEACON_PERIOD);
  return HAUNTED_PUMPKIN_BEACON_MID + HAUNTED_PUMPKIN_BEACON_SWING * wave;
}

/** The rind's share of the beacon. The carved face only shows from the front,
 * so a pumpkin still to find breathes through its whole rind: readable from any
 * side, by day, on every tier. Lit, the rind drops back to the faint candle
 * bleed (`LIT_RIND_SHARE`) and the carved face carries the light. */
export const HAUNTED_PUMPKIN_BEACON_RIND_SHARE = 0.6;
const LIT_RIND_SHARE = 0.04;
/** The candle core's share: the beacon is expressed relative to it. */
const CANDLE_CORE_SHARE = 1.4;

/** Each glow material's share of the pumpkin's light (the candle core brightest);
 * the stem and any other material carry none. */
function glowShare(materialName: string, found: boolean): number {
  switch (materialName) {
    case 'GourdGlow':
      return CANDLE_CORE_SHARE;
    case 'GourdInner':
      return 1;
    case 'GourdFlesh':
      return 0.7;
    case 'GourdLitSkin':
      return found ? LIT_RIND_SHARE : HAUNTED_PUMPKIN_BEACON_RIND_SHARE;
    default:
      return 0;
  }
}

/** The same discoverable state at every graphics tier and in daylight.
 * Before discovery the whole pumpkin breathes a soft warm beacon in the kit's
 * own candle colour (a tinted emissive washes the rind out to cream on the
 * Lambert tier by day); found, it keeps a candle lit for its finder, the carved
 * face carrying the light. Reduced motion retains the entire readable state of
 * both. */
export function hauntedPumpkinGlow(
  materialName: string,
  found: boolean,
  time = 0,
  reducedMotion = false,
): number {
  const share = glowShare(materialName, found);
  if (share === 0) return 0;
  if (!found) return (share / CANDLE_CORE_SHARE) * hauntedPumpkinBeacon(time, reducedMotion);
  const flicker = reducedMotion ? 1 : seasonalFlicker(time, 0);
  return share * flicker;
}
