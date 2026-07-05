import { MELEE_RANGE } from './types';

export type MobCombatProfile = {
  meleeRange: number;
  desiredRange: number;
  chaseSpeedMult: number;
  canLeash: boolean;
  swingWhilePursuing: boolean;
  immediateSwingOnEnterRange: boolean;
  movingRangeBonus: number;
};

export const DEFAULT_MOB_COMBAT_PROFILE: MobCombatProfile = {
  meleeRange: MELEE_RANGE,
  desiredRange: MELEE_RANGE * 0.8,
  chaseSpeedMult: 1,
  canLeash: true,
  swingWhilePursuing: false,
  immediateSwingOnEnterRange: false,
  movingRangeBonus: 1,
};

export const NYTHRAXIS_BOSS_COMBAT_PROFILE: MobCombatProfile = {
  meleeRange: 8,
  desiredRange: 5,
  chaseSpeedMult: 1.5,
  canLeash: false,
  swingWhilePursuing: true,
  immediateSwingOnEnterRange: true,
  movingRangeBonus: 0,
};

export const NYTHRAXIS_ADD_COMBAT_PROFILE: MobCombatProfile = {
  meleeRange: 6,
  desiredRange: 4.5,
  chaseSpeedMult: 1.45,
  canLeash: false,
  swingWhilePursuing: true,
  immediateSwingOnEnterRange: true,
  movingRangeBonus: 0,
};

export function scaledDefaultMobMeleeRange(scale: number): number {
  return MELEE_RANGE + Math.max(0, scale - 1) * 3;
}

// Thunzharr is rendered mountain-sized (scale 50 in zone3.ts) so he reads as a world
// boss, but his melee reach must NOT follow that visual scale (a scale-50 body would
// swing ~150yd and reach the whole raid, trivializing the Howling Gale anti-kite snare).
// Pin his reach to a scale-5 body (~17yd): visual size and combat reach are decoupled.
const THUNZHARR_REACH_SCALE = 5;

export function combatProfileForMob(templateId: string, scale: number): MobCombatProfile {
  if (templateId === 'nythraxis_scourge_of_thornpeak') return NYTHRAXIS_BOSS_COMBAT_PROFILE;
  if (templateId === 'nythraxis_skeleton_warrior') return NYTHRAXIS_ADD_COMBAT_PROFILE;
  if (templateId === 'thunzharr_waking_peak')
    return {
      ...DEFAULT_MOB_COMBAT_PROFILE,
      meleeRange: scaledDefaultMobMeleeRange(THUNZHARR_REACH_SCALE),
    };
  return {
    ...DEFAULT_MOB_COMBAT_PROFILE,
    meleeRange: scaledDefaultMobMeleeRange(scale),
  };
}

// Closing-distance grace. A 20 Hz tick samples positions discretely, so a mob that
// is genuinely closing on its target can perpetually fall a fraction of a yard short
// of a strict range check. To bridge that, a mob that *moved this tick* (i.e. is
// pursuing) gets a small reach bonus. A stationary mob gets none: it is not closing,
// so a player merely walking past must only be struck from the mob's true melee
// range, never the inflated reach the old target-movement gate produced. This is the
// fix for "excessive melee range" - hits landing while the player seems out of reach
// when walking past packed camps.
export function effectiveMobMeleeRange(profile: MobCombatProfile, mobMoved: boolean): number {
  if (!mobMoved) return profile.meleeRange;
  return profile.meleeRange + profile.movingRangeBonus;
}
