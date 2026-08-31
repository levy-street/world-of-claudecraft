import type { Aura } from '../types';
import { VARKHUL_CINDER_REPAIR_CAST_ID } from '../varkhul_cinder_artificer';
import { IGNIVAR_CINDER_LANCE_CAST_ID } from './ignivar_trash_automata';

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
};
