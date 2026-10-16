/** Temporary art reuse while these five referral rewards await distinct paintings.
 * Values are existing item-art owners in public/ui/items/mapping.json, not new art.
 * Keep these ids in ITEM_ART_PENDING and remove each alias when its own art lands. */
export const ITEM_ART_PLACEHOLDERS: Readonly<Record<string, string>> = {
  referral_fog_charm: 'gleamstag_charm',
  referral_hollow_charm: 'makers_charm',
  referral_satchel: 'resonant_weave_bag',
  reins_referral_raptor: 'reins_drakemaw_raptor',
  reins_referral_tank: 'reins_terrorspark_groundshaker',
};
