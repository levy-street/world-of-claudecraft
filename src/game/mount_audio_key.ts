/** Mounts that share the complete audio set of the body they are built on: the referral mounts
 *  their visual model's, and Lantern Hall's destrier the valorsteed's gallop (it IS the
 *  valorsteed's body and strides under its barding). The Smith's Heart's Quarryheart Charger
 *  borrows the same gallop until it has a stone-and-fire set of its own: its hooves are a
 *  horse's, and its clips are timed to the same four-beat strike. */
export function mountAudioKey(key: string): string {
  if (key === 'referral_raptor') return 'drakemaw_raptor';
  if (key === 'referral_tank') return 'terrorspark_groundshaker';
  if (key === 'lantern_hall_destrier') return 'valorsteed';
  if (key === 'quarryheart_charger') return 'valorsteed';
  return key;
}
