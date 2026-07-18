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
});
