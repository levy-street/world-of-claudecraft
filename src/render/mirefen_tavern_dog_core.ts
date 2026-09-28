// The Mirefen tavern's dog asleep on the porch (the model's TavernDog part, content
// TAVERN_DOG): its breathing, a pure function of the clock the painter (mirefen_tavern.ts)
// applies to the dog's own mesh as a scale round the spot where it lies. Three-, DOM- and
// i18n-free, allocation-free.
//
// A sleeping dog breathes slowly: a long easy rise of the flank, a shorter fall, and every so
// often a deeper sigh. Cosmetic only (it never moves the dog's collider, and a reduced-motion
// player sees it lie still).

/** Seconds per breath. */
export const DOG_BREATH_PERIOD = 3.4;
/** How far the flank rises at the top of a breath (a fraction of the dog's height). */
export const DOG_BREATH_RISE = 0.045;
/** Every this many breaths the dog sighs: a breath this much deeper. */
export const DOG_SIGH_EVERY = 7;
export const DOG_SIGH_DEPTH = 1.8;
/** Past this distance (yards) from the camera the breathing is not worth a frame's work. */
export const DOG_BREATH_RANGE = 45;

/** The dog's scale this moment: `y` the flank's rise, `xz` the chest's swell (a third of it).
 *  At rest (reduced motion, or out of range) both are 1. */
export interface DogBreath {
  y: number;
  xz: number;
}

/** Fill `out` with the dog's breath at clock `t` (seconds). */
export function dogBreathInto(t: number, reducedMotion: boolean, out: DogBreath): DogBreath {
  if (reducedMotion) {
    out.y = 1;
    out.xz = 1;
    return out;
  }
  const breath = t / DOG_BREATH_PERIOD;
  const n = Math.floor(breath);
  const phase = breath - n;
  // a long rise over the first 60% of the breath, a quicker fall after it
  const shape =
    phase < 0.6
      ? 0.5 - 0.5 * Math.cos((Math.PI * phase) / 0.6)
      : 0.5 + 0.5 * Math.cos((Math.PI * (phase - 0.6)) / 0.4);
  const depth = n % DOG_SIGH_EVERY === DOG_SIGH_EVERY - 1 ? DOG_SIGH_DEPTH : 1;
  const rise = DOG_BREATH_RISE * depth * shape;
  out.y = 1 + rise;
  out.xz = 1 + rise / 3;
  return out;
}
