import { describe, expect, it } from 'vitest';
import { abilitiesKnownAt } from '../src/sim/content/classes';
import {
  accumulateTalentEffect,
  computeTalentModifiers,
  emptyModifiers,
} from '../src/sim/content/talents';
import type { PlayerClass } from '../src/sim/types';

function rowMods(cls: PlayerClass, rows: Record<number, string>) {
  return computeTalentModifiers(cls, { spec: null, rows }, 20);
}

function resolvedAbility(cls: PlayerClass, abilityId: string, rows: Record<number, string>) {
  const ability = abilitiesKnownAt(cls, 20, rowMods(cls, rows)).find((a) => a.def.id === abilityId);
  if (!ability) throw new Error(`missing resolved ability ${cls}:${abilityId}`);
  return ability;
}

describe('talent buffPct resolver fixes', () => {
  // These three talents were redesigned into behavior-changing procs (they no
  // longer carry these buffPct/cooldownPct mods), so the resolver fixes are pinned
  // on synthetic effects, matching the judgement case below. They guard the same
  // engine paths: buffPct scaling a finisherHaste multiplier and a fractional
  // buff_dodge, and cooldownPct scaling a defensive cooldown.
  it('buffPct scales a finisherHaste multiplier (Slice and Dice)', () => {
    const mods = emptyModifiers();
    accumulateTalentEffect(mods, { ability: [{ ability: 'slice_and_dice', buffPct: 0.25 }] }, 1);
    const ability = abilitiesKnownAt('rogue', 20, mods).find((a) => a.def.id === 'slice_and_dice');
    const effect = ability?.effects.find((e) => e.type === 'finisherHaste');
    if (!effect || effect.type !== 'finisherHaste') throw new Error('missing finisherHaste effect');
    expect(effect.mult).toBeCloseTo(1.375, 6);
    expect(effect.basedur).toBe(9);
    expect(effect.perCombo).toBe(3);
  });

  it('cooldownPct and buffPct scale a defensive cooldown (Evasion)', () => {
    const mods = emptyModifiers();
    accumulateTalentEffect(
      mods,
      { ability: [{ ability: 'evasion', cooldownPct: -0.2, buffPct: 0.3 }] },
      1,
    );
    const ability = abilitiesKnownAt('rogue', 20, mods).find((a) => a.def.id === 'evasion');
    if (!ability) throw new Error('missing evasion');
    const effect = ability.effects.find((e) => e.type === 'selfBuff');
    expect(ability.cooldown).toBeCloseTo(240, 6);
    expect(effect).toMatchObject({ kind: 'buff_dodge', value: 0.65 });
  });

  it('buffPct scales a fractional buff_dodge value (Aspect of the Monkey)', () => {
    const mods = emptyModifiers();
    accumulateTalentEffect(
      mods,
      { ability: [{ ability: 'aspect_of_the_monkey', buffPct: 0.4 }] },
      1,
    );
    const ability = abilitiesKnownAt('hunter', 20, mods).find(
      (a) => a.def.id === 'aspect_of_the_monkey',
    );
    const effect = ability?.effects.find((e) => e.type === 'selfBuff');
    if (!effect || effect.type !== 'selfBuff') throw new Error('missing selfBuff');
    expect(effect.kind).toBe('buff_dodge');
    expect(effect.value).toBeCloseTo(0.112, 6);
  });

  it('Rapid Killing preserves Fevered Draw fractional haste multiplier', () => {
    const ability = resolvedAbility('hunter', 'rapid_fire', { 20: 'hun_r20_rapid_killing' });
    const effect = ability.effects.find((candidate) => candidate.type === 'selfBuff');

    expect(ability.cooldown).toBeCloseTo(150, 6);
    expect(effect).toMatchObject({ kind: 'buff_haste', value: 1.75 });
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
