/** Referral mounts temporarily share the complete audio set of their visual model, and
 *  Gourdlight Eve's hovering broom borrows the hover cycle's soft per-stride whoosh. */
export function mountAudioKey(key: string): string {
  if (key === 'referral_raptor') return 'drakemaw_raptor';
  if (key === 'referral_tank') return 'terrorspark_groundshaker';
  if (key === 'emberbristle_broom') return 'aether_hover_cycle';
  return key;
}
