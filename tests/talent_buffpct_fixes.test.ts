import { describe, expect, it } from 'vitest';
import { abilitiesKnownAt } from '../src/sim/content/classes';
import type { AbilityModEffect, TalentModifiers } from '../src/sim/content/talents';
import {
  accumulateTalentEffect,
  computeTalentModifiers,
  emptyModifiers,
} from '../src/sim/content/talents';
import type { AbilityEffect, PlayerClass } from '../src/sim/types';

function modsFor(...effects: AbilityModEffect[]): TalentModifiers {
  const mods = emptyModifiers();
  accumulateTalentEffect(mods, { ability: effects }, 1);
  return mods;
}

function rowMods(cls: PlayerClass, rows: Record<number, string>): TalentModifiers {
  return computeTalentModifiers(cls, { spec: null, rows }, 20);
}

function resolvedEffect<T extends AbilityEffect['type']>(
  cls: PlayerClass,
  abilityId: string,
  type: T,
  mods: TalentModifiers,
): Extract<AbilityEffect, { type: T }> {
  const ability = abilitiesKnownAt(cls, 20, mods).find((a) => a.def.id === abilityId);
  if (!ability) throw new Error(`missing resolved ability ${cls}:${abilityId}`);
  const effect = ability.effects.find((candidate) => candidate.type === type);
  if (!effect) throw new Error(`missing resolved effect ${cls}:${abilityId}:${type}`);
  return effect as Extract<AbilityEffect, { type: T }>;
}

function resolvedAbility(cls: PlayerClass, abilityId: string, mods: TalentModifiers) {
  const ability = abilitiesKnownAt(cls, 20, mods).find((a) => a.def.id === abilityId);
  if (!ability) throw new Error(`missing resolved ability ${cls}:${abilityId}`);
  return ability;
}

describe('talent buffPct resolver fixes', () => {
  // The choice-row quality pass replaced several original passive ability mods
  // with proc mechanics. These resolver tests use synthetic mods so they pin the
  // engine behavior without changing the authored row choices back.
  it('buffPct scales a finisher haste bonus above its neutral multiplier', () => {
    const effect = resolvedEffect(
      'rogue',
      'slice_and_dice',
      'finisherHaste',
      modsFor({ ability: 'slice_and_dice', buffPct: 0.25 }),
    );

    expect(effect.mult).toBeCloseTo(1.375, 6);
    expect(effect.basedur).toBe(9);
    expect(effect.perCombo).toBe(3);
  });

  it('buffPct and cooldownPct compose on the same defensive ability', () => {
    const ability = resolvedAbility(
      'rogue',
      'evasion',
      modsFor({ ability: 'evasion', buffPct: 0.3, cooldownPct: -0.2 }),
    );
    const effect = ability.effects.find((candidate) => candidate.type === 'selfBuff');

    expect(ability.cooldown).toBeCloseTo(240, 6);
    expect(effect).toMatchObject({ kind: 'buff_dodge', value: 0.65 });
  });

  it('buffPct scales a fractional dodge value without rounding it away', () => {
    const effect = resolvedEffect(
      'hunter',
      'aspect_of_the_monkey',
      'selfBuff',
      modsFor({ ability: 'aspect_of_the_monkey', buffPct: 0.4 }),
    );

    expect(effect.kind).toBe('buff_dodge');
    expect(effect.value).toBeCloseTo(0.112, 6);
  });

  it('Redline Draw replaces the old scalar with an every-third-shot cooldown refund', () => {
    // Talents 2.0 reworked hun_r20_rapid_killing from static cooldownPct/buffPct
    // mods on Fevered Draw into the hun_redline_draw castNth proc; the base
    // ability values stay untouched.
    const mods = rowMods('hunter', { 20: 'hun_r20_rapid_killing' });
    const ability = resolvedAbility('hunter', 'rapid_fire', mods);
    const effect = ability.effects.find((candidate) => candidate.type === 'selfBuff');
    const proc = mods.procs.find((candidate) => candidate.id === 'hun_redline_draw');

    expect(ability.cooldown).toBeCloseTo(300, 6);
    expect(effect).toMatchObject({ kind: 'buff_haste', value: 1.4 });
    // Balance pass: 5 sec per proc behind an 8 sec internal cooldown (was an
    // uncapped 15 sec that free-shot feeding compressed the 300s cooldown with).
    expect(proc?.trigger).toMatchObject({ on: 'castNth', n: 3, icd: 8 });
    expect(proc?.responses).toContainEqual({
      kind: 'cooldownRefund',
      ability: 'rapid_fire',
      seconds: 5,
    });
  });

  it('a judgement dmgPct ability mod scales the trigger damage multiplier', () => {
    // Righteous Cause no longer carries this mod (it became a swing-CDR proc in
    // the row-quality pass), so the engine fix is pinned on a synthetic effect.
    const mods = emptyModifiers();
    accumulateTalentEffect(mods, { ability: [{ ability: 'judgement', dmgPct: 0.15 }] }, 1);
    const ability = abilitiesKnownAt('paladin', 20, mods).find((a) => a.def.id === 'judgement');
    const effect = ability?.effects.find((candidate) => candidate.type === 'judgement');
    if (!effect || effect.type !== 'judgement') throw new Error('missing judgement effect');
    expect(effect.dmgMult).toBeCloseTo(1.15, 6);
    expect(effect.flat ?? 0).toBe(0);
  });

  // scaleEffect had no case for 'groundAoE' or 'repositionToAim', so a global
  // damage modifier (e.g. the Fiesta arena augments, aug_bloodhunter's
  // +18%/+18%) silently no-opped on Consecration, Earthquake, Blizzard,
  // Meteor, and Heroic Leap's landing hit while every directDamage ability
  // scaled correctly. These pin the fix against the same global mult a
  // directDamage ability already applies.
  it('Consecration groundAoE damage scales with the global spell damage modifier, same factor as a directDamage ability', () => {
    const mods = emptyModifiers();
    accumulateTalentEffect(mods, { global: { spellDmgPct: 0.18 } }, 1);

    const exorcism = resolvedEffect('paladin', 'exorcism', 'directDamage', mods);
    expect(exorcism.min).toBe(Math.round(46 * 1.18));
    expect(exorcism.max).toBe(Math.round(56 * 1.18));

    const consecration = resolvedEffect('paladin', 'consecration', 'groundAoE', mods);
    expect(consecration.min).toBe(Math.round(28 * 1.18));
    expect(consecration.max).toBe(Math.round(34 * 1.18));
  });

  it('Earthquake groundAoE damage scales with the global spell damage modifier', () => {
    const mods = emptyModifiers();
    accumulateTalentEffect(mods, { global: { spellDmgPct: 0.3 } }, 1);

    const earthquake = resolvedEffect('shaman', 'earthquake', 'groundAoE', mods);
    expect(earthquake.min).toBe(Math.round(13 * 1.3));
    expect(earthquake.max).toBe(Math.round(17 * 1.3));
  });

  it('Blizzard groundAoE damage scales with the global spell damage modifier and keeps its snare/orb riders', () => {
    const mods = emptyModifiers();
    mods.spec = 'frost';
    accumulateTalentEffect(mods, { global: { spellDmgPct: 0.3 } }, 1);

    const blizzard = resolvedEffect('mage', 'blizzard', 'groundAoE', mods);
    expect(blizzard.min).toBe(Math.round(12 * 1.3));
    expect(blizzard.max).toBe(Math.round(16 * 1.3));
    expect(blizzard.slowMult).toBe(0.6);
    expect(blizzard.orbCdr).toBe(true);
  });

  it('Meteor groundAoE damage scales with the global spell damage modifier and keeps its ignite/delay riders', () => {
    const mods = emptyModifiers();
    mods.spec = 'fire';
    accumulateTalentEffect(mods, { global: { spellDmgPct: 0.45 } }, 1);

    const meteor = resolvedEffect('mage', 'meteor', 'groundAoE', mods);
    expect(meteor.min).toBe(Math.round(90 * 1.45));
    expect(meteor.max).toBe(Math.round(120 * 1.45));
    expect(meteor.igniteFrac).toBe(0.4);
    expect(meteor.delayed).toBe(true);
  });

  it('Rune of Power groundAoE ally-buff pulse (0/0 min/max) is left untouched by the global spell damage modifier', () => {
    // Rune of Power is only reachable via the mage 20 choice row grant.
    const mods = rowMods('mage', { 20: 'mag_r20_rune_of_power' });
    accumulateTalentEffect(mods, { global: { spellDmgPct: 0.45 } }, 1);

    const rune = resolvedEffect('mage', 'rune_of_power', 'groundAoE', mods);
    expect(rune.min).toBe(0);
    expect(rune.max).toBe(0);
    expect(rune.allyBuffPct).toBe(0.1);
  });

  it('Heroic Leap landingAoe damage scales with the global melee damage modifier', () => {
    const mods = emptyModifiers();
    accumulateTalentEffect(mods, { global: { meleeDmgPct: 0.4 } }, 1);

    const leap = resolvedEffect('warrior', 'heroic_leap', 'repositionToAim', mods);
    expect(leap.landingAoe?.min).toBe(Math.round(24 * 1.4));
    expect(leap.landingAoe?.max).toBe(Math.round(32 * 1.4));
    expect(leap.landingAoe?.radius).toBe(6);
  });
});
