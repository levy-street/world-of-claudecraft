import { describe, expect, it } from 'vitest';
import {
  abilityScalingPower,
  channelSpellCoeff,
  channelTickBonus,
  directHealBonus,
  directHitBonus,
  directSpellCoeff,
  dotTickBonus,
  dotTotalCoeff,
  hotTickBonus,
} from '../src/sim/spell_scaling';
import type { AbilityDef } from '../src/sim/types';
import {
  MELEE_SPELL_AP_SCALE,
  RANGED_SPELL_AP_SCALE,
  SPELL_AOE_COEFF_MULT,
  SPELL_COEFF_DIVISOR,
  SPELL_COEFF_MAX_CAST,
  SPELL_COEFF_MIN_CAST,
} from '../src/sim/types';

// Minimal ability stub: only the fields the scaling math reads.
function def(partial: Partial<AbilityDef>): AbilityDef {
  return {
    id: 'x',
    name: 'X',
    class: 'mage',
    cost: 0,
    castTime: 0,
    cooldown: 0,
    range: 30,
    school: 'fire',
    requiresTarget: true,
    learnLevel: 1,
    effects: [],
    description: '',
    ...partial,
  };
}

describe('spell coefficient functions (vanilla cast-time / DoT-duration model)', () => {
  it('direct coeff = clamp(castTime,1.5,7)/3.5; instants use the 1.5 floor', () => {
    expect(directSpellCoeff(0)).toBeCloseTo(SPELL_COEFF_MIN_CAST / SPELL_COEFF_DIVISOR, 6); // instant
    expect(directSpellCoeff(1.5)).toBeCloseTo(1.5 / 3.5, 6);
    expect(directSpellCoeff(3.0)).toBeCloseTo(3.0 / 3.5, 6);
    // a 3.5s+ cast caps at a 1.0 coefficient
    expect(directSpellCoeff(3.5)).toBeCloseTo(1.0, 6);
    expect(directSpellCoeff(6.0)).toBeCloseTo(1.0, 6);
    // clamps
    expect(directSpellCoeff(0.5)).toBeCloseTo(SPELL_COEFF_MIN_CAST / 3.5, 6);
    expect(directSpellCoeff(99)).toBeCloseTo(SPELL_COEFF_MAX_CAST / 3.5, 6);
  });

  it('channel coeff matches the direct (cast-time) shape on the channel duration', () => {
    expect(channelSpellCoeff(3)).toBeCloseTo(3 / 3.5, 6);
    expect(channelSpellCoeff(5)).toBeCloseTo(1.0, 6); // caps at the 3.5s ceiling
  });

  it('DoT total coeff = duration / 15', () => {
    expect(dotTotalCoeff(15)).toBeCloseTo(1.0, 6);
    expect(dotTotalCoeff(18)).toBeCloseTo(18 / 15, 6);
    expect(dotTotalCoeff(12)).toBeCloseTo(12 / 15, 6);
  });
});

describe('directHitBonus', () => {
  it('a 1.5s spell adds round(SP * 1.5/3.5)', () => {
    const sp = 200;
    expect(directHitBonus(sp, def({}), 1.5)).toBe(Math.round(sp * (1.5 / 3.5)));
  });

  it('uses the passed (rank-resolved) cast time, not def.castTime', () => {
    const sp = 200;
    // def.castTime is irrelevant; the explicit cast time drives the coefficient.
    expect(directHitBonus(sp, def({ castTime: 1.5 }), 3.0)).toBe(Math.round(sp * (3.0 / 3.5)));
  });

  it('applies the AoE penalty when aoe=true', () => {
    const sp = 300;
    expect(directHitBonus(sp, def({}), 0, true)).toBe(
      Math.round(sp * (SPELL_COEFF_MIN_CAST / 3.5) * SPELL_AOE_COEFF_MULT),
    );
  });

  it('ranged attack-spells scale down by RANGED_SPELL_AP_SCALE', () => {
    const rap = 400;
    const d = def({ school: 'physical', scalesWith: 'ranged' });
    expect(directHitBonus(rap, d, 3.0)).toBe(Math.round(rap * (3.0 / 3.5) * RANGED_SPELL_AP_SCALE));
  });
});

describe('channelTickBonus', () => {
  it('splits the channel coefficient across ticks', () => {
    const sp = 210;
    const d = def({ castTime: 0, channel: { duration: 3, ticks: 3 } });
    expect(channelTickBonus(sp, d)).toBe(Math.round(sp * (3 / 3.5 / 3)));
  });

  it('returns 0 for a non-channeled ability', () => {
    expect(channelTickBonus(500, def({}))).toBe(0);
  });
});

describe('dotTickBonus', () => {
  it('splits the total DoT coefficient across its ticks', () => {
    const sp = 150;
    const d = def({});
    // duration 18, interval 3 -> 6 ticks, total coeff 18/15 = 1.2
    expect(dotTickBonus(sp, d, 18, 3)).toBe(Math.round((sp * (18 / 15)) / 6));
  });

  it('ranged DoTs (Serpent Sting) scale off RAP with the ranged scale', () => {
    const rap = 300;
    const d = def({ school: 'nature', scalesWith: 'ranged' });
    // duration 15, interval 3 -> 5 ticks
    expect(dotTickBonus(rap, d, 15, 3)).toBe(
      Math.round((rap * (15 / 15) * RANGED_SPELL_AP_SCALE) / 5),
    );
  });
});

describe('directHealBonus', () => {
  it('scales heals off Spell Power at the direct coeff, instants use the 1.5 floor', () => {
    const sp = 200;
    expect(directHealBonus(sp, 0)).toBe(
      Math.round(sp * (SPELL_COEFF_MIN_CAST / SPELL_COEFF_DIVISOR)),
    );
    expect(directHealBonus(sp, 3.0)).toBe(Math.round(sp * (3.0 / 3.5)));
    expect(directHealBonus(sp, 3.5)).toBe(sp); // a 3.5s+ heal takes the full Spell Power
  });

  it('never takes an AP scale-down (heals are pure Spell Power)', () => {
    // Same Spell Power and cast time as a full-coeff nuke: heal takes the full 1.0.
    const sp = 300;
    expect(directHealBonus(sp, 3.5)).toBe(directHitBonus(sp, def({ school: 'holy' }), 3.5));
  });
});

describe('hotTickBonus', () => {
  it('splits the total DoT coefficient across HoT ticks off Spell Power', () => {
    const sp = 150;
    // duration 12, interval 3 -> 4 ticks, total coeff 12/15
    expect(hotTickBonus(sp, 12, 3)).toBe(Math.round((sp * (12 / 15)) / 4));
  });

  it('matches dotTickBonus for a pure (holy/nature) spell but without any AP path', () => {
    const sp = 210;
    expect(hotTickBonus(sp, 15, 3)).toBe(dotTickBonus(sp, def({ school: 'nature' }), 15, 3));
  });
});

describe('abilityScalingPower', () => {
  it('routes ranged shots to RAP, physical specials to melee AP, spells to SP', () => {
    const e = { spellPower: 120, rangedPower: 350, attackPower: 500 };
    expect(abilityScalingPower(e, def({}))).toBe(120); // fire spell -> Spell Power
    expect(abilityScalingPower(e, def({ scalesWith: 'ranged' }))).toBe(350); // hunter shot -> RAP
    expect(abilityScalingPower(e, def({ school: 'physical' }))).toBe(500); // melee special -> AP
    // 'ranged' wins even on a physical shot (Aimed Shot / Concussive Shot).
    expect(abilityScalingPower(e, def({ school: 'physical', scalesWith: 'ranged' }))).toBe(350);
  });
});

describe('powerScale (melee AP riders)', () => {
  it('physical specials take the melee AP scale-down, spells take the full coeff', () => {
    const ap = 500;
    // Instant physical special: coeff = 1.5/3.5 floor, scaled by MELEE_SPELL_AP_SCALE.
    expect(directHitBonus(ap, def({ school: 'physical' }), 0)).toBe(
      Math.round(ap * (SPELL_COEFF_MIN_CAST / SPELL_COEFF_DIVISOR) * MELEE_SPELL_AP_SCALE),
    );
    // A physical bleed splits the melee-AP-scaled total across its ticks.
    expect(dotTickBonus(ap, def({ school: 'physical' }), 12, 2)).toBe(
      Math.round((ap * (12 / 15) * MELEE_SPELL_AP_SCALE) / 6),
    );
  });
});
