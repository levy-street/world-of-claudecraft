/** Mounts that share the complete audio set of the body they are built on: the referral mounts
 *  their visual model's, and Lantern Hall's destrier the valorsteed's gallop (it IS the
 *  valorsteed's body and strides under its barding). */
export function mountAudioKey(key: string): string {
  if (key === 'referral_raptor') return 'drakemaw_raptor';
  if (key === 'referral_tank') return 'terrorspark_groundshaker';
  if (key === 'lantern_hall_destrier') return 'valorsteed';
  return key;
}
