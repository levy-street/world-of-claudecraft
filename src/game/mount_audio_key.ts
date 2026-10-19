/** Referral mounts temporarily share the complete audio set of their visual model.
 *  (Gourdlight Eve's broom has its own stride and hover hum: mount_*_emberbristle_broom.) */
export function mountAudioKey(key: string): string {
  if (key === 'referral_raptor') return 'drakemaw_raptor';
  if (key === 'referral_tank') return 'terrorspark_groundshaker';
  return key;
}
