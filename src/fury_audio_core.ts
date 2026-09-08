/** Shared cue identity and per-event ownership, without renderer/audio imports. */
export const FURY_AUDIO = {
  raging_gale: {
    release: 'melee_warrior_twinstrike_release',
    impacts: ['impact_warrior_twinstrike_first', 'impact_warrior_twinstrike_second'],
    times: [0.15, 0.34],
  },
  red_harvest: {
    release: 'melee_warrior_red_harvest_release',
    impacts: [
      'impact_warrior_red_harvest_first',
      'impact_warrior_red_harvest_second',
      'impact_warrior_red_harvest_finish',
    ],
    times: [0.15, 0.32, 0.49],
  },
} as const;
export type FuryAudioId = keyof typeof FURY_AUDIO;
export const WARRIOR_CONTACT_AUDIO = {
  breachmaker: {
    release: 'melee_warrior_breachmaker_release',
    impacts: ['impact_warrior_breachmaker'],
    times: [0.15],
  },
  slam: {
    release: 'melee_warrior_brute_release',
    impacts: ['impact_warrior_brute'],
    times: [0.15],
  },
  overpower: {
    release: 'melee_warrior_redhand_release',
    impacts: ['impact_warrior_redhand'],
    times: [0.15],
  },
  mortal_strike: {
    release: 'melee_warrior_maiming_release',
    impacts: ['impact_warrior_maiming'],
    times: [0.15],
  },
  execute: {
    release: 'melee_warrior_early_grave_release',
    impacts: ['impact_warrior_early_grave'],
    times: [0.15],
  },
  bloodthirst: {
    release: 'melee_warrior_bloodletting_release',
    impacts: ['impact_warrior_bloodletting'],
    times: [0.15],
  },
  victory_rush: {
    release: 'melee_warrior_victory_release',
    impacts: ['impact_warrior_victory'],
    times: [0.15],
  },
  shield_slam: {
    release: 'melee_warrior_shieldcrack_release',
    impacts: ['impact_warrior_shieldcrack'],
    times: [0.15],
  },
} as const;
export const WARRIOR_AREA_AUDIO = {
  revenge: {
    release: 'melee_warrior_revenge_release',
    impacts: ['impact_warrior_revenge'],
    times: [0.15],
  },
  thunder_clap: {
    release: 'melee_warrior_quake_release',
    impacts: ['impact_warrior_quake'],
    times: [0.15],
  },
  faultline: {
    release: 'melee_warrior_faultline_release',
    impacts: ['impact_warrior_faultline'],
    times: [0.15],
  },
} as const;
export const WARRIOR_GUARD_AUDIO = {
  raised_guard: {
    release: 'melee_warrior_guard_release',
    impacts: ['impact_warrior_guard_lock'],
    times: [0.15],
  },
  iron_resolve: {
    release: 'melee_warrior_resolve_release',
    impacts: ['impact_warrior_resolve_lock'],
    times: [0.2],
  },
  die_by_sword: {
    release: 'melee_warrior_sword_guard_release',
    impacts: ['impact_warrior_sword_guard_lock'],
    times: [0.15],
  },
} as const;
export const WARRIOR_POWER_AUDIO = {
  avatar: {
    release: 'melee_warrior_avatar_release',
    impacts: ['impact_warrior_avatar_rise'],
    times: [0.15],
  },
  recklessness: {
    release: 'melee_warrior_reckless_release',
    impacts: ['impact_warrior_reckless_tear'],
    times: [0.15],
  },
  bloodrage: {
    release: 'melee_warrior_toll_release',
    impacts: ['impact_warrior_toll_clench'],
    times: [0.15],
  },
  berserker_rage: {
    release: 'melee_warrior_seething_release',
    impacts: ['impact_warrior_seething_release'],
    times: [0.15],
  },
} as const;
export const MELEE_AUDIO = {
  ...FURY_AUDIO,
  ...WARRIOR_CONTACT_AUDIO,
  ...WARRIOR_AREA_AUDIO,
  ...WARRIOR_GUARD_AUDIO,
  ...WARRIOR_POWER_AUDIO,
};
export type MeleeAudioId = keyof typeof MELEE_AUDIO;
export function isMeleeAudioId(id: string | undefined): id is MeleeAudioId {
  return id !== undefined && Object.hasOwn(MELEE_AUDIO, id);
}
export function isFuryAudioId(id: string | undefined): id is FuryAudioId {
  return id === 'raging_gale' || id === 'red_harvest';
}
export function furyAudioSample(id: string | undefined, key: string | undefined): boolean {
  if (!isFuryAudioId(id) || !key) return false;
  const cue = FURY_AUDIO[id];
  return cue.release === key || (cue.impacts as readonly string[]).includes(key);
}
export function meleeAudioSample(id: string | undefined, key: string | undefined): boolean {
  if (!isMeleeAudioId(id) || !key) return false;
  const cue = MELEE_AUDIO[id];
  return cue.release === key || (cue.impacts as readonly string[]).includes(key);
}
// The renderer sees each event immediately before the HUD/Studio sound adapter.
// Claim only after a separate presentation-clock queue has retained the sound.
const claims = new WeakSet<object>();
export function claimFuryAudio(event: object): void {
  claims.add(event);
}
export function clearFuryAudioClaim(event: object): void {
  claims.delete(event);
}
export function furyAudioClaimed(event: object): boolean {
  return claims.has(event);
}
