import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VISUALS } from '../src/render/characters/manifest';
import {
  attackAbilityId,
  isSpinAttackAbility,
  weaponAttackStyle,
} from '../src/render/characters/weapon_attack_style_core';
import {
  isMobEngageCue,
  WARRIOR_SHOUT_COLORS,
  warriorCastVisualPlan,
} from '../src/render/warrior_cast_fx_core';
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
      // Shieldcrack drives the offhand SHIELD arm (synthesized clip,
      // scripts/_add_shield_bash_anim.mjs), never a sword chop.
      shield_slam: 'Shield_Bash',
      raging_gale: 'Dualwield_Melee_Attack_Chop',
      bloodthirst: 'Dualwield_Melee_Attack_Chop',
      // The two frontal-arc AoE strikes reap sideways (synthesized clip,
      // scripts/_add_sweep_slice_anim.mjs), never the top-to-bottom chop.
      cleave: '1H_Melee_Attack_Slice_Horizontal',
      revenge: '1H_Melee_Attack_Slice_Horizontal',
      thunder_clap: '1H_Melee_Attack_Chop',
      faultline: '1H_Melee_Attack_Chop',
      heroic_strike: '1H_Melee_Attack_Slice_Diagonal',
      overpower: '1H_Melee_Attack_Slice_Diagonal',
      hamstring: '1H_Melee_Attack_Slice_Diagonal',
      sanguine_aura: 'Spellcast_Raise',
      raised_guard: 'Block',
    });
  });

  it('routes Final Edict to its dedicated one-handed Templar verdict clip at authored speed', () => {
    expect(VISUALS.player_paladin.clips.attackByAbility).toMatchObject({
      final_edict: 'Paladin_Templars_Verdict_1H',
    });
    expect(VISUALS.player_paladin.clips.attackTimeScaleByAbility).toMatchObject({
      final_edict: 1,
    });
  });

  it('normalizes damage-event display names and preserves the whirlwind spin cue', () => {
    expect(attackAbilityId(ABILITIES.mortal_strike.name)).toBe('mortal_strike');
    expect(attackAbilityId(ABILITIES.whirlwind.name)).toBe('whirlwind');
    expect(attackAbilityId('mortal_strike')).toBe('mortal_strike');
    expect(attackAbilityId('missing ability')).toBeUndefined();
    expect(isSpinAttackAbility('whirlwind')).toBe(true);
    expect(isSpinAttackAbility('dawnfall')).toBe(true);
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

// The renderer's spellfx handler dispatches the mob engage cue BEFORE the warrior
// cast plan, and both claim fx 'shout' and 'flourish'. Whichever wins first wins
// outright (the branch breaks), so the split between them is a contract, not an
// implementation detail: getting it wrong silently cost raised_guard its authored
// Block gesture, which is exactly the regression this pins. The renderer's own
// call site is pinned in tests/renderer_spellfx_dispatch_order.test.ts.
describe('spellfx dispatch order: mob engage cue vs warrior cast plan', () => {
  // Every shipped ability reaching the two contested fx kinds, pinned as a
  // literal so the sweep below cannot quietly shrink: adding a castFx 'shout'
  // ability OR removing one reds this row, and the per-ability assertions then
  // cover the new arrival for free.
  const CONTESTED_CAST_FX = ['shout', 'flourish'] as const;
  const playerCueAbilities = Object.values(ABILITIES)
    .filter((a) => CONTESTED_CAST_FX.includes(a.castFx as (typeof CONTESTED_CAST_FX)[number]))
    .map((a) => a.id)
    .sort();

  it('ships exactly the six warrior shouts plus raised_guard on the contested fx kinds', () => {
    expect(playerCueAbilities).toEqual([
      'battle_shout',
      'defiant_bellow',
      'demoralizing_shout',
      'emboldening_roar',
      'intimidating_shout',
      'raised_guard',
      'rallying_cry',
    ]);
  });

  it('leaves every player castFx to the warrior plan, never the mob cue', () => {
    for (const id of playerCueAbilities) {
      const fx = ABILITIES[id].castFx as string;
      expect(isMobEngageCue(fx, 'player'), `${id} must not be claimed as a mob cue`).toBe(false);
      // and it really does reach a live plan, so "not claimed" means "still works"
      expect(warriorCastVisualPlan(fx, id), `${id} must keep its warrior plan`).not.toBeNull();
    }
  });

  it('claims the brood cues, which a mob emits with no ability id', () => {
    // Mirrors the two live emits in src/sim/mob/dragonkin_brood.ts: the engage
    // bellow and the whelp hatch pounce, both sourced from a mob.
    expect(isMobEngageCue('shout', 'mob')).toBe(true);
    expect(isMobEngageCue('flourish', 'mob')).toBe(true);
  });

  it('proves the source gate is load-bearing and a reorder would not do', () => {
    // warriorCastVisualPlan claims ANY 'shout' whatever the ability id, falling
    // back to a default roar color. So the ONLY thing keeping a mob bellow out
    // of the warrior path is the source gate: drop it and every brood shout
    // repaints as a warrior shout, and moving the branch below the plan instead
    // would do exactly that.
    expect(warriorCastVisualPlan('shout', undefined)).not.toBeNull();
    // The ability id is likewise NOT a safe discriminator: a mob one-shot may
    // carry one to pick its authored clip via attackByAbility, and this stays
    // a mob cue when it does.
    expect(isMobEngageCue('shout', 'mob')).toBe(true);
  });

  // The pure core above cannot see the renderer, and the renderer imports Three,
  // so it cannot be instantiated here. That gap is exactly how the swallowed
  // warrior shouts shipped: the core was green throughout. This scans the real
  // dispatch site instead, so reverting the gate reds a test rather than nothing.
  it('routes the renderer dispatch through the gate, with no bare fx disjunction', () => {
    const src = readFileSync('src/render/renderer.ts', 'utf8');
    // the cue branch asks the predicate, and asks it about the SOURCE entity
    expect(src).toContain('isMobEngageCue(ev.fx, this.sim.entities.get(ev.sourceId)?.kind)');
    // and the pre-fix shape, which claimed player castFx too, is gone for good
    expect(src).not.toMatch(/ev\.fx === 'shout' \|\| ev\.fx === 'flourish'/);
    // the gate must still sit ABOVE the warrior plan: below it, warriorCastVisualPlan
    // would claim every ability-less mob bellow first (see the row above)
    expect(src.indexOf('isMobEngageCue(ev.fx')).toBeLessThan(
      src.indexOf('warriorCastVisualPlan(ev.fx'),
    );
  });

  it('narrows on both dimensions independently', () => {
    // fx dimension: a mob source does not make every fx kind an engage cue
    for (const fx of ['projectile', 'weaponAura', 'windup', 'beam']) {
      expect(isMobEngageCue(fx, 'mob'), fx).toBe(false);
    }
    // source dimension: no non-mob source claims the cue, including absent
    // (an event whose source entity has already left the world mirror)
    for (const kind of ['player', 'npc', 'object', undefined]) {
      expect(isMobEngageCue('shout', kind), String(kind)).toBe(false);
      expect(isMobEngageCue('flourish', kind), String(kind)).toBe(false);
    }
  });
});
