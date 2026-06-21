import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MOB_COMBAT_PROFILE,
  NYTHRAXIS_ADD_COMBAT_PROFILE,
  NYTHRAXIS_BOSS_COMBAT_PROFILE,
  combatProfileForMob,
  effectiveMobMeleeRange,
  scaledDefaultMobMeleeRange,
} from '../src/sim/mob_combat';
import { MELEE_RANGE } from '../src/sim/types';

describe('mob combat profiles', () => {
  it('keeps ordinary mobs on the legacy scale-based melee range profile', () => {
    const profile = combatProfileForMob('forest_wolf', 1.5);

    expect(profile).toEqual({
      ...DEFAULT_MOB_COMBAT_PROFILE,
      meleeRange: scaledDefaultMobMeleeRange(1.5),
    });
    expect(profile.meleeRange).toBe(MELEE_RANGE + 1.5);
    expect(profile.canLeash).toBe(true);
    expect(profile.swingWhilePursuing).toBe(false);
  });

  it('gives Nythraxis a non-leashing pursuing melee profile', () => {
    expect(combatProfileForMob('nythraxis_scourge_of_thornpeak', 3.1)).toEqual(NYTHRAXIS_BOSS_COMBAT_PROFILE);
    expect(NYTHRAXIS_BOSS_COMBAT_PROFILE.meleeRange).toBe(8);
    expect(NYTHRAXIS_BOSS_COMBAT_PROFILE.desiredRange).toBeLessThan(NYTHRAXIS_BOSS_COMBAT_PROFILE.meleeRange);
    expect(NYTHRAXIS_BOSS_COMBAT_PROFILE.chaseSpeedMult).toBeGreaterThan(1);
    expect(NYTHRAXIS_BOSS_COMBAT_PROFILE.canLeash).toBe(false);
  });

  it('gives Nythraxis adds the same pursuing combat semantics with shorter reach', () => {
    expect(combatProfileForMob('nythraxis_skeleton_warrior', 1.25)).toEqual(NYTHRAXIS_ADD_COMBAT_PROFILE);
    expect(NYTHRAXIS_ADD_COMBAT_PROFILE.meleeRange).toBeLessThan(NYTHRAXIS_BOSS_COMBAT_PROFILE.meleeRange);
    expect(NYTHRAXIS_ADD_COMBAT_PROFILE.swingWhilePursuing).toBe(true);
    expect(NYTHRAXIS_ADD_COMBAT_PROFILE.immediateSwingOnEnterRange).toBe(true);
  });

  it('only applies moving-target range grace when the profile allows it', () => {
    expect(effectiveMobMeleeRange(DEFAULT_MOB_COMBAT_PROFILE, true, false))
      .toBe(DEFAULT_MOB_COMBAT_PROFILE.meleeRange + DEFAULT_MOB_COMBAT_PROFILE.movingRangeBonus);
    expect(effectiveMobMeleeRange(NYTHRAXIS_BOSS_COMBAT_PROFILE, true, true))
      .toBe(NYTHRAXIS_BOSS_COMBAT_PROFILE.meleeRange);
  });
});
