// The Buried Hoard cast ids and their interruptible schools, as a
// dependency-free LEAF. mob/healer_channel.ts reads the schools, and
// content/dungeons.ts imports healer_channel, so this table must never reach
// ../data (hoard_control_casts.ts and hoard_lightning_strike.ts both do): that edge
// closed a content -> data import cycle that left DUNGEON_MOBS undefined at
// module eval for any entry point that loaded content first.

import type { Aura } from '../types';

/** Cast ids per control family. Each has a localized cast-bar name
 *  (src/ui/cast_display_name.ts) and an interruptible school. */
export const HOARD_CAST_FEAR = 'hoard_cast_fear';
export const HOARD_CAST_STUN = 'hoard_cast_stun';
export const HOARD_CAST_SILENCE = 'hoard_cast_silence';
export const HOARD_CAST_HEX = 'hoard_cast_hex';

export const HOARD_CONTROL_CAST_SCHOOLS: Readonly<Record<string, { school: Aura['school'] }>> =
  Object.freeze({
    [HOARD_CAST_FEAR]: { school: 'shadow' },
    [HOARD_CAST_STUN]: { school: 'nature' },
    [HOARD_CAST_SILENCE]: { school: 'shadow' },
    [HOARD_CAST_HEX]: { school: 'nature' },
  });

/** Hoarfrost's Ice Age (hoard_ice_age.ts): a cast bar to read, never one to
 *  kick, so it has no interruptible school. */
export const HOARD_CAST_ICE_AGE = 'hoard_ice_age';

/** Nyxaris's pulsar phase (hoard_pulsars.ts): the bar is the deadline the orbs
 *  must die by, never a cast to kick. */
export const HOARD_CAST_PULSAR_OVERLOAD = 'hoard_pulsar_overload';

/** Grask's Rolling Boulder (hoard_boulder.ts): the wind-up of the throw, read
 *  and answered, never kicked. */
export const HOARD_CAST_ROLLING_BOULDER = 'hoard_rolling_boulder';
/** Grask's Charge (hoard_charge.ts): the aim at whoever holds him, read and
 *  answered with a wall, never kicked. */
export const HOARD_CAST_CHARGE = 'hoard_cast_charge';

/** The Coinsack Scurrier's escape (hoard_goblin.ts): a bar it runs from its
 *  first wound, never kicked; at the end it is gone with the gold. */
export const HOARD_GOBLIN_ESCAPE_CAST = 'hoard_goblin_escape';

/** The Storm Caller's Lightning Strike (hoard_lightning_strike.ts), here for the
 *  same reason: healer_channel.ts reads its school. */
export const HOARD_CAST_LIGHTNING_STRIKE = 'hoard_lightning_strike';
export const HOARD_LIGHTNING_STRIKE_CAST_SCHOOL: Readonly<Record<string, { school: 'nature' }>> = {
  [HOARD_CAST_LIGHTNING_STRIKE]: { school: 'nature' },
};

/** The hoard adds' own casts (hoard_add_casts.ts): every one a bar a kick cancels. */
export const HOARD_CAST_DROWNING_HOOK = 'hoard_cast_drowning_hook';
export const HOARD_CAST_RIME_BEAM = 'hoard_cast_rime_beam';
export const HOARD_CAST_CINDER_BOLT = 'hoard_cast_cinder_bolt';
export const HOARD_CAST_VOID_EMPOWER = 'hoard_cast_void_empower';
export const HOARD_CAST_WEBBING = 'hoard_cast_webbing';
/** Vysska's Silk Snare (hoard_silk_snare.ts): a kick cancels it for good. */
export const HOARD_CAST_SILK_SNARE = 'hoard_cast_silk_snare';
export const HOARD_CAST_DOOM_RITUAL = 'hoard_cast_doom_ritual';

// The cave bosses of the common and rare hoards (hoard_mole.ts, hoard_bat.ts,
// hoard_mimic.ts): scripted cast bars their visuals map to clips. Only the
// Colossal Bat's Screech is kickable (it is in HOARD_ADD_CAST_SCHOOLS below).
export const HOARD_CAST_MOLE_RAKE = 'hoard_cast_mole_rake';
export const HOARD_CAST_BURROW = 'hoard_cast_burrow';
export const HOARD_CAST_TUNNEL = 'hoard_cast_tunnel';
export const HOARD_CAST_EMERGE = 'hoard_cast_emerge';
export const HOARD_CAST_COLLAPSE = 'hoard_cast_collapse';
export const HOARD_CAST_BAT_DIVE_AIM = 'hoard_cast_bat_dive_aim';
export const HOARD_CAST_BAT_DIVE = 'hoard_cast_bat_dive';
export const HOARD_CAST_SCREECH = 'hoard_cast_screech';
export const HOARD_CAST_MIMIC_BITE = 'hoard_cast_mimic_bite';
export const HOARD_CAST_MIMIC_LEAP = 'hoard_cast_mimic_leap';
export const HOARD_CAST_COIN_SPIT = 'hoard_cast_coin_spit';

export const HOARD_ADD_CAST_SCHOOLS: Readonly<Record<string, { school: Aura['school'] }>> =
  Object.freeze({
    [HOARD_CAST_DROWNING_HOOK]: { school: 'nature' },
    [HOARD_CAST_RIME_BEAM]: { school: 'frost' },
    [HOARD_CAST_CINDER_BOLT]: { school: 'fire' },
    [HOARD_CAST_VOID_EMPOWER]: { school: 'shadow' },
    [HOARD_CAST_WEBBING]: { school: 'nature' },
    [HOARD_CAST_DOOM_RITUAL]: { school: 'shadow' },
    [HOARD_CAST_SILK_SNARE]: { school: 'nature' },
    [HOARD_CAST_SCREECH]: { school: 'nature' },
  });
