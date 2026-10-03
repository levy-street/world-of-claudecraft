// The dungeon trash kit's cast ids, as a dependency-free leaf: the content
// (the Hollow Crypt trash templates), the kit driver, the interrupt table
// (mob/healer_channel.ts SCRIPTED_INTERRUPTIBLE_CHANNELS) and the renderer's
// telegraph table all key on these strings.

import type { Aura } from '../../types';

/** Gravecaller Adept: an interruptible shadow bolt at one player. */
export const CRYPT_GRAVE_BOLT = 'crypt_grave_bolt';
/** Gravecaller Necromancer: an interruptible channel that raises a Bone Minion. */
export const CRYPT_RAISE_BONES = 'crypt_raise_bones';
/** Crow Caller: an interruptible cast that summons another flock. */
export const CRYPT_MURDER_CALL = 'crypt_murder_call';
/** Chapel Gargoyle: an interruptible shriek that stuns everyone close by. */
export const CRYPT_STONE_SHRIEK = 'crypt_stone_shriek';
/** Ossuary Warrior: a telegraphed frontal cleave (breathCone, uninterruptible). */
export const CRYPT_GRAVE_CLEAVE = 'crypt_grave_cleave';
/** Ossuary Drake: a torrent of spectral fire down a frontal cone (breathCone). */
export const CRYPT_BARROWFLAME_BREATH = 'crypt_barrowflame_breath';
/** Ossuary Drake: a lash of its tail behind it. */
export const CRYPT_TAIL_LASH = 'crypt_tail_lash';
/** Ossuary Drake: a blast of its wings that throws the close ones back. */
export const CRYPT_WING_GUST = 'crypt_wing_gust';

/** Presentation cue ids (never casts): the `windup` spellfx a perched mob
 *  sends as it dives off its perch, and a flier as it breaks off its flight
 *  to land. The renderer keys the awaken and the sky roar on them. */
export const CRYPT_PERCH_DIVE = 'crypt_perch_dive';
export const CRYPT_SKY_LANDING = 'crypt_sky_landing';

/** The trash kit casts a player interrupt can lock out, by school. The drake's
 *  strikes and the warrior's cleave are deliberately absent: dodge those. */
export const TRASH_KIT_CAST_SCHOOLS: Readonly<Record<string, { school: Aura['school'] }>> = {
  [CRYPT_GRAVE_BOLT]: { school: 'shadow' },
  [CRYPT_RAISE_BONES]: { school: 'shadow' },
  [CRYPT_MURDER_CALL]: { school: 'nature' },
  [CRYPT_STONE_SHRIEK]: { school: 'nature' },
};
