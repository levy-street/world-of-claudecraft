import { describe, expect, it } from 'vitest';
import { ABILITIES } from '../src/sim/content/classes';
import {
  rowForLevel,
  rowTreeFor,
  TALENTS,
  type TalentEffect,
  type TalentRowLevel,
  validateRowTree,
  validateTalentTree,
} from '../src/sim/content/talents';

function optionIds(level: 5 | 8 | 11 | 14 | 17 | 20): string[] {
  const row = rowForLevel('shaman', level);
  if (!row) throw new Error(`Missing Shaman level-${level} row`);
  return row.options.map((option) => option.id);
}

function shamanImbueIds(): string[] {
  return Object.values(ABILITIES)
    .filter(
      (ability) =>
        ability.class === 'shaman' && ability.effects.some((effect) => effect.type === 'imbue'),
    )
    .map((ability) => ability.id);
}

function prerequisiteGroups(effect: TalentEffect): string[][] {
  const groups: string[][] = [];
  for (const modifier of effect.ability ?? []) {
    groups.push([modifier.ability]);
    for (const added of modifier.addEffects ?? []) {
      if ('dot' in added && typeof added.dot === 'string') groups.push([added.dot]);
      if ('auraId' in added && typeof added.auraId === 'string') groups.push([added.auraId]);
    }
  }

  const proc = effect.proc;
  if (!proc) return groups;
  const trigger = proc.trigger;
  if (trigger.on === 'castNth' || trigger.on === 'spellHit') {
    groups.push(trigger.abilities);
  } else if (trigger.on === 'spellCrit' && trigger.abilities) {
    groups.push(trigger.abilities);
  } else if (
    trigger.on === 'shieldConsumed' ||
    trigger.on === 'hotExpired' ||
    trigger.on === 'thornsReflect'
  ) {
    groups.push([trigger.ability]);
  } else if (trigger.on === 'meleeSwingWhile' && trigger.auraKind === 'imbue') {
    groups.push(shamanImbueIds());
  }

  const responseAbilities: string[] = [];
  for (const response of proc.responses) {
    if (response.kind === 'cooldownRefund' || response.kind === 'addAuraCharges') {
      responseAbilities.push(response.ability);
    } else if (response.kind === 'empowerNext' && response.abilities) {
      responseAbilities.push(...response.abilities);
    }
  }
  if (responseAbilities.length > 0) groups.push(responseAbilities);
  return groups;
}

function isKnownBy(abilityId: string, rowLevel: TalentRowLevel): boolean {
  const ability = ABILITIES[abilityId];
  return ability?.class === 'shaman' && ability.learnLevel <= rowLevel;
}

describe('Shaman PBE structural feedback', () => {
  it('reshuffles the four affected tiers into three distinct choices each', () => {
    expect(optionIds(5)).toEqual([
      'sha_r5_concussion',
      'sha_r14_weapon_fury',
      'sha_r5_imbue_mastery',
    ]);
    expect(optionIds(8)).toEqual([
      'sha_r8_improved_earth_shock',
      'sha_r5_improved_lightning_shield',
      'sha_r11_healing_stream',
    ]);
    expect(optionIds(11)).toEqual([
      'sha_r11_ancestral_guidance',
      'sha_r11_fulmination',
      'sha_r8_shock_efficiency',
    ]);
    expect(optionIds(14)).toEqual([
      'sha_r14_chain_lightning',
      'sha_r14_improved_flame_shock',
      'sha_r8_frost_bind',
    ]);

    const tree = rowTreeFor('shaman');
    if (!tree) throw new Error('Missing Shaman talent rows');
    expect(validateTalentTree(TALENTS.shaman)).toEqual([]);
    expect(validateRowTree(tree)).toEqual([]);
  });

  it('keeps every Shaman option useful when its row unlocks', () => {
    const tree = rowTreeFor('shaman');
    if (!tree) throw new Error('Missing Shaman talent rows');

    for (const row of tree) {
      for (const option of row.options) {
        for (const group of prerequisiteGroups(option.effect)) {
          expect(
            group.some((abilityId) => isKnownBy(abilityId, row.level)),
            `${option.name} at level ${row.level} requires one of: ${group.join(', ')}`,
          ).toBe(true);
        }
      }
    }
  });
});
