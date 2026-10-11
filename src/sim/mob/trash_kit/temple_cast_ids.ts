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
/** The Moonmantle Ray (id pearlguard_sentinel): its Nacre Cocoon, the wings
 *  wrapped over it once, when low. */
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
/** The Moonmantle Ray (id pearlguard_sentinel): its Tidal Wingbeat, both wings
 *  brought down round it, a shove (trashKit.wingGust). */
export const TEMPLE_PEARL_SLAM = 'temple_pearl_slam';
/** Lagoon Eel: a lane of lightning spat at one player (trashKit.line). */
export const TEMPLE_LIGHTNING_SPIT = 'temple_lightning_spit';

// The trash mechanics pass (E:/woc/entregas/investigacion/MECANICAS_TRASH.md
// section 6): the choir protects its singers, the lagoon punishes a bunched
// or careless group.
/** Pale Choir Acolyte and Moonlit Siren: the ward the kneeling pilgrims keep
 *  round their singer (trashKit.temple.vigil, an aura on the singer). */
export const TEMPLE_SHRINE_VIGIL = 'temple_shrine_vigil';
/** Drowned Pilgrim: the marker on a pilgrim whose prayer feeds a Shrine Vigil
 *  (the renderer draws its thread of light to the singer). */
export const TEMPLE_VIGIL_PRAYER = 'temple_vigil_prayer';
/** Drowned Templeguard, heroic: the oath on a casting singer it guards (an
 *  aura on her; its source is the guard who takes the share). */
export const TEMPLE_MOONSET_OATH = 'temple_moonset_oath';
/** Drowned Templeguard, heroic: the marker on a guard keeping its oath. */
export const TEMPLE_OATH_KEEPER = 'temple_oath_keeper';
/** The share of a hit an oath moves onto its guard (the damage's ability id). */
export const TEMPLE_OATH_SHARE = 'temple_moonset_oath_share';
/** Pale Choir Acolyte, heroic: the echo ring on a Lullaby's sleeper. */
export const TEMPLE_LULLABY_ECHO = 'temple_lullaby_echo';
/** Glimmerscale Lurker: its gaze (trashKit.temple.gaze), and the dazzle it
 *  leaves on whoever faced it. */
export const TEMPLE_PRISM_GLARE = 'temple_prism_glare';
export const TEMPLE_PRISM_DAZZLE = 'temple_prism_dazzle';
/** The dazzle's slow half (a second aura: a stumble beside the whiffs). */
export const TEMPLE_PRISM_STUMBLE = 'temple_prism_stumble';
/** Lagoon Snapper: the whirlpool round its shell while it shelters (a marker
 *  aura on the snapper), and its rolls at the core. */
export const TEMPLE_SPIRAL_WHIRLPOOL = 'temple_spiral_whirlpool';
/** Lagoon Eel: an interruptible spark that leaps between players. */
export const TEMPLE_ARCING_SPARK = 'temple_arcing_spark';
/** Tidewisp: the chill its burst leaves (the burst's `slow`). */
export const TEMPLE_TIDEWISP_CHILL = `${TEMPLE_TIDEWISP_BURST}_slow`;
/** Tidewisp, heroic: the swell of a wisp that has drunk others (value: merges). */
export const TEMPLE_SWOLLEN_TIDE = 'temple_swollen_tide';

// The trash pass's second wave (the engine's G6 sight rule and G5 walker).
/** Moonlit Siren: an interruptible song that draws one player to her; out of
 *  her sight the song breaks (trashKit.temple.lure, temple_lure.ts). */
export const TEMPLE_CALL_OF_THE_SHALLOWS = 'temple_call_of_the_shallows';
/** The draw on the song's victim while it runs (a slow on their own legs). */
export const TEMPLE_SHALLOWS_DRAW = 'temple_shallows_draw';
/** The stun a landed song leaves on its victim. */
export const TEMPLE_SONG_STRUCK = 'temple_song_struck';
/** The cue as a song breaks on a column (its victim left her sight). */
export const TEMPLE_SHALLOWS_BROKEN = 'temple_shallows_broken';
/** The Moonmantle Ray, heroic: the Heartpearl that rolls from its chest when
 *  its Nacre Cocoon breaks (a walker, temple_pearl.ts): its launch id, its
 *  object template, the ward it lays on the ally it reaches and the group's
 *  mantle when a player picks it up first. */
export const TEMPLE_HEARTPEARL = 'temple_heartpearl';
export const TEMPLE_HEARTPEARL_ORB = 'temple_heartpearl_orb';
export const TEMPLE_HEARTPEARL_WARD = 'temple_heartpearl_ward';
export const TEMPLE_NACRE_MANTLE = 'temple_nacre_mantle';

/** The Temple trash casts a player interrupt can lock out, by school. The bite,
 *  the sweep, the hurl, the slam, the surge and the Prism Glare are absent on
 *  purpose: step out of those, or turn your back. */
export const TEMPLE_KIT_CAST_SCHOOLS: Readonly<Record<string, { school: Aura['school'] }>> = {
  [TEMPLE_LULLABY]: { school: 'arcane' },
  [TEMPLE_CALL_THE_TIDE]: { school: 'frost' },
  [TEMPLE_STATIC_COIL]: { school: 'nature' },
  [TEMPLE_PALE_MENDING]: { school: 'frost' },
  [TEMPLE_GLIMMER_VENOM]: { school: 'nature' },
  [TEMPLE_ARCING_SPARK]: { school: 'nature' },
  // Arcane, never the frost of Call the Tide, so one kick never locks both.
  [TEMPLE_CALL_OF_THE_SHALLOWS]: { school: 'arcane' },
};
