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

// The trash mechanics pass (crypt_kit.ts): a second readable job per type.
/** Gravecaller Necromancer: an interruptible cast that bursts a fallen
 *  packmate's corpse (trashKit.rupture). */
export const CRYPT_GRAVE_RUPTURE = 'crypt_grave_rupture';
/** Crow Caller: an interruptible cast that marks one player for every crow
 *  (trashKit.eye). Also the mark's aura id. */
export const CRYPT_CARRION_EYE = 'crypt_carrion_eye';
/** Bone Brute: a telegraphed smash down a narrow cone (breathCone). */
export const CRYPT_MARROW_CRUSH = 'crypt_marrow_crush';
/** Bonechill Widow: a line of frost web spat at one player; it roots
 *  whoever it catches (trashKit.line). */
export const CRYPT_RIMESILK_SPIT = 'crypt_rimesilk_spit';
/** Gravecaller Adept (the trash pass's second wave): an interruptible volley
 *  of grave sparks at every player who can see it (trashKit.nova, the
 *  engine's line-of-sight nova). Kick it, or break sight behind a pillar. */
export const CRYPT_GRAVESPARK_VOLLEY = 'crypt_gravespark_volley';
/** Ossuary Cutthroat: the slow its Rending Leap leaves on its victim. */
export const CRYPT_TORN_TENDON = 'crypt_torn_tendon';
/** Chapel Gargoyle: its stacking stone ward (trashKit.granite). */
export const CRYPT_GRANITE_SKIN = 'crypt_granite_skin';
/** Chapel Gargoyle: the crack a stun leaves (it takes more damage). */
export const CRYPT_CRACKED_STONE = 'crypt_cracked_stone';
/** Bone Minion: its burst also cuts the skeletons round it (deathThroes.shrapnel). */
export const CRYPT_SPLINTER_BURST = 'crypt_splinter_burst';
/** Ossuary Warrior: the cue as a fallen warrior's bones stand back up. */
export const CRYPT_REASSEMBLE = 'crypt_reassemble';
/** The cue as a bone pile crumbles for good (broken, or its master fell). */
export const CRYPT_BONES_CRUMBLE = 'crypt_bones_crumble';
/** The bone pile a fallen Ossuary Warrior leaves while a necromancer lives. */
export const CRYPT_BONE_PILE = 'crypt_bone_pile';
/** Object templates the crypt trash kit lays on the floor (the renderer draws
 *  them itself): the Grave Rupture ring under its corpse, the heroic pool it
 *  leaves, and the drake's heroic Barrow Embers. */
export const CRYPT_RUPTURE_RING = 'crypt_grave_rupture_ring';
export const CRYPT_RUPTURE_POOL = 'crypt_grave_rupture_pool';
export const CRYPT_BARROW_EMBERS = 'crypt_barrow_embers';
export const CRYPT_TRASH_OBJECT_TEMPLATES: readonly string[] = [
  CRYPT_RUPTURE_RING,
  CRYPT_RUPTURE_POOL,
  CRYPT_BARROW_EMBERS,
];

/** The trash kit casts a player interrupt can lock out, by school. The drake's
 *  strikes and the warrior's cleave are deliberately absent: dodge those. */
export const TRASH_KIT_CAST_SCHOOLS: Readonly<Record<string, { school: Aura['school'] }>> = {
  [CRYPT_GRAVE_BOLT]: { school: 'shadow' },
  [CRYPT_RAISE_BONES]: { school: 'shadow' },
  [CRYPT_MURDER_CALL]: { school: 'nature' },
  [CRYPT_STONE_SHRIEK]: { school: 'nature' },
  [CRYPT_GRAVE_RUPTURE]: { school: 'shadow' },
  [CRYPT_CARRION_EYE]: { school: 'nature' },
  [CRYPT_GRAVESPARK_VOLLEY]: { school: 'shadow' },
};
