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

  it('keeps the closing-distance grace small so reach is not wildly inflated', () => {
    // One tick of relative closing at 20 Hz is well under a yard; a flat 3 yd grace
    // let an ordinary scale-1 mob swing from 8 yd. Keep the grace tick-justified.
    expect(DEFAULT_MOB_COMBAT_PROFILE.movingRangeBonus).toBe(1);
  });

  it('grants the closing-distance grace only to a mob that actually moved this tick', () => {
    // A pursuing mob (it repositioned) gets the small grace so a strict per-tick
    // range check does not perpetually miss a target it is genuinely closing on.
    expect(effectiveMobMeleeRange(DEFAULT_MOB_COMBAT_PROFILE, true))
      .toBe(DEFAULT_MOB_COMBAT_PROFILE.meleeRange + DEFAULT_MOB_COMBAT_PROFILE.movingRangeBonus);
  });

  it('gives a STATIONARY mob no reach grace, so walking past a packed camp is safe', () => {
    // Regression for "excessive melee range": a mob standing in its camp must only
    // strike from its true melee range. The player walking past (the target moving)
    // must not inflate the stationary mob's reach.
    expect(effectiveMobMeleeRange(DEFAULT_MOB_COMBAT_PROFILE, false))
      .toBe(DEFAULT_MOB_COMBAT_PROFILE.meleeRange);
  });

  it('never grants grace to a profile that opts out (movingRangeBonus 0)', () => {
    expect(effectiveMobMeleeRange(NYTHRAXIS_BOSS_COMBAT_PROFILE, true))
      .toBe(NYTHRAXIS_BOSS_COMBAT_PROFILE.meleeRange);
  });
});
