// The Drowned Temple trash kit's cast ids, as a dependency-free leaf (the
// Hollow Crypt's live in cast_ids.ts, the Bastion's in bastion_cast_ids.ts):
// the content (drowned_temple.ts), the kit driver, the interrupt table
// (mob/healer_channel.ts) and the renderer's telegraph table all key on these.

import type { Aura } from '../../types';

/** Pale Choir Acolyte: an interruptible lullaby that puts one player to sleep. */
export const TEMPLE_LULLABY = 'temple_lullaby';
/** Moonlit Siren: an interruptible song that calls three Tidewisps. */
export const TEMPLE_CALL_THE_TIDE = 'temple_call_the_tide';
/** Lagoon Eel: an interruptible charge of the coils that shocks everyone near. */
export const TEMPLE_STATIC_COIL = 'temple_static_coil';
/** Lagoon Snapper: a telegraphed bite across its front (breathCone). */
export const TEMPLE_SNAP = 'temple_snapper_snap';
/** Drowned Templeguard: a telegraphed trident sweep across its front (breathCone). */
export const TEMPLE_TRIDENT_SWEEP = 'temple_trident_sweep';
/** Pearlguard Sentinel: its pearl shell closing over it once, when low. */
export const TEMPLE_PEARL_CARAPACE = 'temple_pearl_carapace';
/** Tidewisp: the burst when it reaches a player. */
export const TEMPLE_TIDEWISP_BURST = 'temple_tidewisp_burst';
/** The Lullaby's sleep aura on its victim. */
export const TEMPLE_LULLABY_SLEEP = 'temple_lullaby_sleep';
// The sixth pass: a second readable job for each trash type.
/** Drowned Templeguard: a trident hurled down a lane at one player (trashKit.line). */
export const TEMPLE_SKEWERING_TRIDENT = 'temple_skewering_trident';
/** Pale Choir Acolyte: an interruptible heal on a hurt packmate (trashKit.mend). */
export const TEMPLE_PALE_MENDING = 'temple_pale_mending';
/** Glimmerscale Lurker: an interruptible bolt of venom (trashKit.bolt). */
export const TEMPLE_GLIMMER_VENOM = 'temple_glimmer_venom';
/** Pearlguard Sentinel: its fists slammed down round it, a shove (trashKit.wingGust). */
export const TEMPLE_PEARL_SLAM = 'temple_pearl_slam';
/** Lagoon Eel: a lane of lightning spat at one player (trashKit.line). */
export const TEMPLE_LIGHTNING_SPIT = 'temple_lightning_spit';

/** The Temple trash casts a player interrupt can lock out, by school. The bite,
 *  the sweep, the hurl, the slam and the surge are absent on purpose: step out
 *  of those. */
export const TEMPLE_KIT_CAST_SCHOOLS: Readonly<Record<string, { school: Aura['school'] }>> = {
  [TEMPLE_LULLABY]: { school: 'arcane' },
  [TEMPLE_CALL_THE_TIDE]: { school: 'frost' },
  [TEMPLE_STATIC_COIL]: { school: 'nature' },
  [TEMPLE_PALE_MENDING]: { school: 'frost' },
  [TEMPLE_GLIMMER_VENOM]: { school: 'nature' },
};
