import {
  HOARD_ADD_CAST_SCHOOLS,
  HOARD_CONTROL_CAST_SCHOOLS,
  HOARD_LIGHTNING_STRIKE_CAST_SCHOOL,
} from '../rift/hoard_control_cast_ids';
import type { Aura } from '../types';
import { VARKHUL_CINDER_REPAIR_CAST_ID } from '../varkhul_cinder_artificer';
import { IGNIVAR_CINDER_LANCE_CAST_ID } from './ignivar_trash_automata';
import { BASTION_KIT_CAST_SCHOOLS } from './trash_kit/bastion_cast_ids';
import { TRASH_KIT_CAST_SCHOOLS } from './trash_kit/cast_ids';
import { SANCTUM_KIT_CAST_SCHOOLS } from './trash_kit/sanctum_cast_ids';
import { TEMPLE_KIT_CAST_SCHOOLS } from './trash_kit/temple_cast_ids';
import { WILDHEART_KIT_CAST_SCHOOLS } from './trash_kit/wildheart_cast_ids';

// The scripted cast id updateHealerHold puts on a channelHeal mob (Malric, the
// Nythraxis spirit healer) so its heal renders a real, interruptible cast bar.
export const NYTHRAXIS_SPIRIT_MENDING_CAST_ID = 'nythraxis_spirit_mending';
export const VARKHUL_CRUCIBLE_QUAKE_CAST_ID = 'crucible_quake';

// Scripted (non-ability) mob channels a player interrupt (Kick / Pummel /
// Counterspell) should still be able to lock out, keyed to the school the lockout
// lands in. The interrupt effect consults this when the cast id resolves to no
// ability def; the matching school-lockout then breaks the channelHeal in
// updateBossMechanics, so the bar is not a lie.
export const SCRIPTED_INTERRUPTIBLE_CHANNELS: Record<string, { school: Aura['school'] }> = {
  [NYTHRAXIS_SPIRIT_MENDING_CAST_ID]: { school: 'shadow' },
  [VARKHUL_CRUCIBLE_QUAKE_CAST_ID]: { school: 'fire' },
  [VARKHUL_CINDER_REPAIR_CAST_ID]: { school: 'fire' },
  [IGNIVAR_CINDER_LANCE_CAST_ID]: { school: 'fire' },
  // Buried Hoard control casts: a fear, stun, silence or hex a hoard mob casts
  // instead of landing instantly (src/sim/rift/hoard_control_casts.ts).
  ...HOARD_CONTROL_CAST_SCHOOLS,
  ...HOARD_LIGHTNING_STRIKE_CAST_SCHOOL,
  ...HOARD_ADD_CAST_SCHOOLS,
  // The dungeon trash kit's bolts, raises, calls and shrieks (mob/trash_kit).
  ...TRASH_KIT_CAST_SCHOOLS,
  // The Sunken Bastion's heals and shields (mob/trash_kit/bastion_cast_ids.ts).
  ...BASTION_KIT_CAST_SCHOOLS,
  // The Drowned Temple's lullaby, tide call and coil (mob/trash_kit/temple_cast_ids.ts).
  ...TEMPLE_KIT_CAST_SCHOOLS,
  // The Wildheart Basin's Ancestral Sap (mob/trash_kit/wildheart_cast_ids.ts).
  ...WILDHEART_KIT_CAST_SCHOOLS,
  // The Gravewyrm Sanctum's Warming Rite and Goad (mob/trash_kit/sanctum_cast_ids.ts).
  ...SANCTUM_KIT_CAST_SCHOOLS,
};
