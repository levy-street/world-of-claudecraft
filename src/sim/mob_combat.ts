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
  movingRangeBonus: 3,
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

export function combatProfileForMob(templateId: string, scale: number): MobCombatProfile {
  if (templateId === 'nythraxis_scourge_of_thornpeak') return NYTHRAXIS_BOSS_COMBAT_PROFILE;
  if (templateId === 'nythraxis_skeleton_warrior') return NYTHRAXIS_ADD_COMBAT_PROFILE;
  return {
    ...DEFAULT_MOB_COMBAT_PROFILE,
    meleeRange: scaledDefaultMobMeleeRange(scale),
  };
}

export function effectiveMobMeleeRange(
  profile: MobCombatProfile,
  targetMoved: boolean,
  mobMoved: boolean,
): number {
  if (!targetMoved && !mobMoved) return profile.meleeRange;
  return profile.meleeRange + profile.movingRangeBonus;
}
