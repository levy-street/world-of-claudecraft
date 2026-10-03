// The Gravewyrm Sanctum trash kit's cast ids, as a dependency-free leaf (the
// Hollow Crypt's live in cast_ids.ts, the Bastion's in bastion_cast_ids.ts, the
// Temple's in temple_cast_ids.ts, the Basin's in wildheart_cast_ids.ts): the
// content (gravewyrm_sanctum.ts), the kit driver, the interrupt table
// (mob/healer_channel.ts) and the renderer's telegraph table all key on these.
//
// docs/design/dungeon-rework/gravewyrm_sanctum.md section 5.1.

import { GOADSMITH_RERIVET } from '../../encounters/gravewyrm_sanctum/boss_ids';
import type { Aura } from '../../types';

/** Sanctum Scaleguard: a telegraphed breath of cinders across its front
 *  (breathCone). Step out. */
export const SANCTUM_CINDER_BREATH = 'sanctum_cinder_breath';
/** Broodsworn Thawcaller: an interruptible soulfire heal on a hurt ally
 *  (trashKit.mend). Kick it. */
export const SANCTUM_WARMING_RITE = 'sanctum_warming_rite';
/** Broodsworn Goadsmith: an interruptible goad that enrages one ally
 *  (trashKit.goad). Kick it. */
export const SANCTUM_GOAD = 'sanctum_goad';
/** The damage-done aura a Goad leaves on its ally. */
export const SANCTUM_GOADED = 'sanctum_goaded';
/** Broodsworn Pyre-Tender: plants a Soul Brazier beside her (trashKit.call). */
export const SANCTUM_PLANT_BRAZIER = 'sanctum_plant_brazier';
/** Soul Brazier: its soulfire quickens every ally near it (trashKit.stoke). */
export const SANCTUM_SOULFIRE_STOKE = 'sanctum_soulfire_stoke';
/** The attack-speed aura a Soul Brazier keeps on the allies near it. */
export const SANCTUM_STOKED = 'sanctum_stoked';
/** Rime Whelp: it bursts in a puff of hoarfrost as it dies, a small slowing
 *  ring (trashKit.deathBurst with a slow). */
export const SANCTUM_HOARFROST_POP = 'sanctum_hoarfrost_pop';
/** Ogre Sledge-Hauler: a block of ice hurled at the farthest player, onto a
 *  ring painted where they stood (trashKit.toss). Step out. */
export const SANCTUM_ICE_BLOCK_TOSS = 'sanctum_ice_block_toss';
/** Glacier Splinter: it shatters where it fell 2 s after it dies
 *  (trashKit.deathBurst). Step away from the body. */
export const SANCTUM_SHATTER = 'sanctum_shatter';

/** The Sanctum trash casts a player interrupt can lock out, by school. The
 *  brazier plant (kill the brazier), the breath and the toss (step out) are
 *  absent on purpose. */
export const SANCTUM_KIT_CAST_SCHOOLS: Readonly<Record<string, { school: Aura['school'] }>> = {
  [SANCTUM_WARMING_RITE]: { school: 'shadow' },
  [SANCTUM_GOAD]: { school: 'fire' },
  // Korgath's heroic Re-rivet: the Goadsmith's 6 s channel at a broken pillar.
  [GOADSMITH_RERIVET]: { school: 'fire' },
};
