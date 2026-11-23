// The Wildheart Basin trash kit's cast ids, as a dependency-free leaf (the
// Hollow Crypt's live in cast_ids.ts, the Bastion's in bastion_cast_ids.ts, the
// Temple's in temple_cast_ids.ts): the
// content (wildheart.ts), the kit driver, the interrupt table
// (mob/healer_channel.ts) and the renderer's telegraph table all key on these.

import type { Aura } from '../../types';

/** Sunbone Hexcaller (and the Howdah Hexcaller): an interruptible 2 s heal on
 *  a hurt packmate (trashKit.mend). Kick it. */
export const WILDHEART_ANCESTRAL_SAP = 'wildheart_ancestral_sap';
/** Sunbone Totem-Binder: plants a Sunbone Totem beside it (trashKit.call). */
export const WILDHEART_PLANT_TOTEM = 'wildheart_plant_totem';
/** Sunbone Totem: its healing pulse on every ally near it (trashKit.pulse). */
export const WILDHEART_TOTEM_PULSE = 'wildheart_totem_pulse';
/** Basin Raptor: its leap onto the farthest caster (trashKit.leap; the leap
 *  sends a `windup` spellfx with this ability id). */
export const WILDHEART_POUNCE = 'wildheart_pounce';
/** Spore Toad: the poison cloud it bursts into as it dies (trashKit.deathCloud). */
export const WILDHEART_SPORE_BURST = 'wildheart_spore_burst';
/** Vine Lasher: a telegraphed lash of vines down a lane that roots whoever it
 *  catches (trashKit.line with a root). */
export const WILDHEART_ENTANGLING_LASH = 'wildheart_entangling_lash';
/** The root an Entangling Lash leaves (the lane kit's `<castId>_root` aura). */
export const WILDHEART_ENTANGLED = `${WILDHEART_ENTANGLING_LASH}_root`;

// The trash mechanics pass (E:/woc/entregas/investigacion/MECANICAS_TRASH.md
// section 7): the Sunbone and their beasts hunt together.
/** Vineclaw Stalker: the marking spear (trashKit.wildheart.mark), and the mark
 *  it leaves on the quarry. */
export const WILDHEART_QUARRY_MARK = 'wildheart_quarry_mark';
export const WILDHEART_QUARRY = 'wildheart_quarry';
/** Bloodmane Ravager: the once-per-pull roar (trashKit.wildheart.roar), and
 *  the two halves of the frenzy it leaves (damage done, swing haste). */
export const WILDHEART_WAR_ROAR = 'wildheart_war_roar';
export const WILDHEART_ROAR_FRENZY = 'wildheart_roar_frenzy';
export const WILDHEART_ROAR_HASTE = 'wildheart_roar_haste';
/** Sunbone Hexcaller: the toad hex (trashKit.wildheart.hex), and its aura. */
export const WILDHEART_TOAD_HEX = 'wildheart_toad_hex';
export const WILDHEART_TOADED = 'wildheart_toaded';
/** Sunbone Dread Totem: its fear (trashKit.wildheart.dread). */
export const WILDHEART_RATTLING_DREAD = 'wildheart_rattling_dread';
/** Spore Toad: the tongue down a lane that reels its catch in. */
export const WILDHEART_SNARING_TONGUE = 'wildheart_snaring_tongue';

/** The Wildheart trash casts a player interrupt can lock out, by school. The
 *  totem plant (kill the totem), the lash and the tongue (step out of the
 *  lane), the marking spear (kill the stalker) and the totem's dread (tank
 *  away from it) are absent on purpose. */
export const WILDHEART_KIT_CAST_SCHOOLS: Readonly<Record<string, { school: Aura['school'] }>> = {
  [WILDHEART_ANCESTRAL_SAP]: { school: 'nature' },
  [WILDHEART_WAR_ROAR]: { school: 'physical' },
  [WILDHEART_TOAD_HEX]: { school: 'shadow' },
};
