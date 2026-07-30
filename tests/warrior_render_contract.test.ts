import { describe, expect, it } from 'vitest';
import { VISUALS } from '../src/render/characters/manifest';
import {
  attackAbilityId,
  isSpinAttackAbility,
  weaponAttackStyle,
} from '../src/render/characters/weapon_attack_style_core';
import { WARRIOR_SHOUT_COLORS, warriorCastVisualPlan } from '../src/render/warrior_cast_fx_core';
import { ABILITIES } from '../src/sim/data';

describe('winning Warrior attack animation routing', () => {
  it('selects a swing from the actual live hands, including Titan Grip', () => {
    expect(weaponAttackStyle('worn_sword', null)).toBeNull();
    expect(weaponAttackStyle('wyrmfang_greatblade', null)).toBe('twohand');
    expect(weaponAttackStyle('worn_sword', 'rusty_dagger')).toBe('dualwield');
    expect(weaponAttackStyle('wyrmfang_greatblade', 'deathless_greatblade')).toBe('dualwield');
    expect(weaponAttackStyle('missing_item', 'rusty_dagger')).toBeNull();
  });

  it('pins winning Warrior hand and ability clips', () => {
    expect(VISUALS.player_warrior.clips.attackByHand).toEqual({
      twohand: '2H_Melee_Attack_Chop',
      dualwield: 'Dualwield_Melee_Attack_Chop',
    });
    expect(VISUALS.player_warrior.clips.attackByAbility).toMatchObject({
      mortal_strike: '2H_Melee_Attack_Chop',
      execute: '2H_Melee_Attack_Chop',
      slam: '2H_Melee_Attack_Chop',
      red_harvest: '2H_Melee_Attack_Chop',
      breachmaker: '2H_Melee_Attack_Chop',
      shield_slam: '2H_Melee_Attack_Chop',
      raging_gale: 'Dualwield_Melee_Attack_Chop',
      bloodthirst: 'Dualwield_Melee_Attack_Chop',
      cleave: '1H_Melee_Attack_Chop',
      thunder_clap: '1H_Melee_Attack_Chop',
      faultline: '1H_Melee_Attack_Chop',
      revenge: '1H_Melee_Attack_Chop',
      heroic_strike: '1H_Melee_Attack_Slice_Diagonal',
      overpower: '1H_Melee_Attack_Slice_Diagonal',
      hamstring: '1H_Melee_Attack_Slice_Diagonal',
      sanguine_aura: 'Spellcast_Raise',
      raised_guard: 'Block',
    });
  });

  it('normalizes damage-event display names and preserves the whirlwind spin cue', () => {
    expect(attackAbilityId(ABILITIES.mortal_strike.name)).toBe('mortal_strike');
    expect(attackAbilityId(ABILITIES.whirlwind.name)).toBe('whirlwind');
    expect(attackAbilityId('mortal_strike')).toBe('mortal_strike');
    expect(attackAbilityId('missing ability')).toBeUndefined();
    expect(isSpinAttackAbility('whirlwind')).toBe(true);
    expect(isSpinAttackAbility('mortal_strike')).toBe(false);
  });
});

describe('winning Warrior cast VFX routing', () => {
  it('keeps the authored per-shout colors and one-pump roar plan', () => {
    expect(WARRIOR_SHOUT_COLORS).toEqual({
      battle_shout: 0xff2a1a,
      demoralizing_shout: 0x9a5df0,
      emboldening_roar: 0xff5470,
      defiant_bellow: 0xff8c2a,
      rallying_cry: 0xffe9a0,
      intimidating_shout: 0x7f8ad0,
    });
    expect(warriorCastVisualPlan('shout', 'rallying_cry')).toEqual({
      kind: 'shout',
      color: 0xffe9a0,
      ringRadius: 8,
      emote: 'cheer',
      repeats: 1,
    });
  });

  it('routes weapon aura and defensive flourish to authored clips only', () => {
    expect(warriorCastVisualPlan('weaponAura', 'sanguine_aura')).toEqual({
      kind: 'gesture',
      abilityId: 'sanguine_aura',
    });
    expect(warriorCastVisualPlan('flourish', 'raised_guard')).toEqual({
      kind: 'gesture',
      abilityId: 'raised_guard',
    });
    expect(warriorCastVisualPlan('projectile', 'heroic_throw')).toBeNull();
  });
});
