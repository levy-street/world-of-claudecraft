import { describe, expect, it } from 'vitest';
import { onCastCompleted, onMeleeSwing } from '../src/sim/combat/talent_procs';
import { ABILITIES, abilitiesKnownAt } from '../src/sim/content/classes';
import {
  rowForLevel,
  rowTreeFor,
  TALENTS,
  type TalentEffect,
  type TalentRowLevel,
  validateRowTree,
  validateTalentTree,
} from '../src/sim/content/talents';
import { Sim } from '../src/sim/sim';
import { ensureLocaleLoaded, setLanguage } from '../src/ui/i18n';
import { tTalent } from '../src/ui/talent_i18n';

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
  if (trigger.on === 'castNth' || trigger.on === 'spellHit' || trigger.on === 'meleeHit') {
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
  return (
    abilitiesKnownAt('shaman', rowLevel).some((known) => known.def.id === abilityId) ||
    TALENTS.shaman.specs.some((spec) => spec.signature === abilityId)
  );
}

function imbuedLifebloodHeal(level: number): { heal: number; maxHp: number } {
  const sim = new Sim({ seed: 260716, playerClass: 'shaman', autoEquip: false });
  sim.setPlayerLevel(level);
  expect(sim.applyTalents({ spec: null, rows: { 5: 'sha_r5_imbue_mastery' } })).toBe(true);
  sim.castAbility('rockbiter_weapon');
  expect(sim.player.auras.some((aura) => aura.kind === 'imbue')).toBe(true);
  const rng = sim.ctx.rng as typeof sim.ctx.rng & { chance(probability: number): boolean };
  rng.chance = () => false;
  const maxHp = sim.player.maxHp;
  sim.player.hp = 1;
  onMeleeSwing(sim.ctx, sim.player);
  return { heal: sim.player.hp - 1, maxHp };
}

function returningCurrentMana(level: number): { restored: number; maxMana: number } {
  const sim = new Sim({ seed: 260716, playerClass: 'shaman', autoEquip: false });
  sim.setPlayerLevel(level);
  expect(sim.applyTalents({ spec: null, rows: { 11: 'sha_r8_shock_efficiency' } })).toBe(true);
  sim.player.resource = 0;
  for (let cast = 0; cast < 3; cast++) {
    onCastCompleted(sim.ctx, sim.player, 'earth_shock');
  }
  return { restored: sim.player.resource, maxMana: sim.player.maxResource };
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

  it('grants Springwell when its new level-8 row unlocks', () => {
    const sim = new Sim({ seed: 260716, playerClass: 'shaman', autoEquip: false });
    sim.setPlayerLevel(8);

    expect(sim.resolvedAbility('healing_stream')).toBeNull();
    expect(sim.applyTalents({ spec: null, rows: { 8: 'sha_r11_healing_stream' } })).toBe(true);
    expect(sim.resolvedAbility('healing_stream')).toBeDefined();
  });
});

describe('Shaman PBE tuning feedback', () => {
  it('scales Imbued Lifeblood from about 8 healing at level 5 to 4% maximum health', () => {
    const at5 = imbuedLifebloodHeal(5);
    const at20 = imbuedLifebloodHeal(20);

    expect(at5.heal).toBe(Math.round(at5.maxHp * 0.04));
    expect(at5.heal).toBe(8);
    expect(at20.heal).toBe(Math.round(at20.maxHp * 0.04));
    expect(at20.heal).toBeGreaterThan(at5.heal * 3);

    const lifeblood = rowForLevel('shaman', 5)?.options.find(
      (option) => option.id === 'sha_r5_imbue_mastery',
    );
    expect(lifeblood?.description).toContain('4% of your maximum health');
  });

  it('renders the percentage heal from data in non-Latin locales', async () => {
    const lifeblood = rowForLevel('shaman', 5)?.options.find(
      (option) => option.id === 'sha_r5_imbue_mastery',
    );
    if (!lifeblood) throw new Error('Missing Imbued Lifeblood');

    await ensureLocaleLoaded('zh_CN');
    setLanguage('zh_CN');
    try {
      const description = tTalent({
        kind: 'talentChoice',
        choice: lifeblood,
        field: 'description',
      });
      expect(description).toMatch(/4\s?%/);
      expect(description).not.toContain('maximum health');
      expect(description).not.toContain('NaN');
    } finally {
      setLanguage('en');
    }
  });

  it('scales Returning Current to 8% maximum mana at its level 11 tier', () => {
    const at11 = returningCurrentMana(11);
    const at20 = returningCurrentMana(20);

    expect(at11.restored / at11.maxMana).toBeCloseTo(0.08, 5);
    expect(at20.restored / at20.maxMana).toBeCloseTo(0.08, 5);
    expect(at20.restored).toBeGreaterThan(at11.restored);

    const returningCurrent = rowForLevel('shaman', 11)?.options.find(
      (option) => option.id === 'sha_r8_shock_efficiency',
    );
    expect(returningCurrent?.description).toContain('8% of your maximum mana');
  });
});
