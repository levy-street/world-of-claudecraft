/**
 * The shared limit on the Paladin kit's biggest flashes: Dawnfall's landing,
 * Hammer of Wrath's sky-hammer impact, Valkyr's Calling's landing and Divine
 * Ascension's column. Each builds over about three frames instead of opening
 * at full on its first, peaks below its authored brightness, and another
 * player's cast dims further, so a raid of Paladins never blinds anyone.
 * It multiplies an effect's authored alpha, so each keeps its own curve.
 */

/** Seconds a big flash takes to build to its peak (about three frames). */
export const PALADIN_FLASH_ONSET = 0.045;
/** A big flash's peak, as a share of its authored brightness. */
export const PALADIN_FLASH_PEAK = 0.78;
/** The further share left of another player's flash. */
export const PALADIN_FLASH_OTHERS = 0.6;

/** Whether `id` is the local player. Without a probe every cast reads as local. */
export type PaladinLocalProbe = (id: number) => boolean;

/** The multiplier for a big flash `age` seconds after it began. */
export function paladinFlash(age: number, local = true): number {
  if (!(age > 0)) return 0;
  const x = Math.min(1, age / PALADIN_FLASH_ONSET);
  return x * x * (3 - 2 * x) * PALADIN_FLASH_PEAK * (local ? 1 : PALADIN_FLASH_OTHERS);
}
