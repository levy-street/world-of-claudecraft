import { beforeAll, describe, expect, it } from 'vitest';
import { SPEC_BASELINES } from '../src/sim/content/spec_baselines';
import { computeTalentModifiers, TALENTS } from '../src/sim/content/talents';
import { ABILITIES } from '../src/sim/data';
import { scalePrimaryHealing } from '../src/sim/primary_healing';
import { offensiveSpecTuningFor, primaryHealingMultiplier } from '../src/sim/spec_output_tuning';
import { resolveTalentHitMult } from '../src/sim/talent_hit_mult';
import type { PlayerClass } from '../src/sim/types';
import { ensureLocaleLoaded, setLanguage, supportedLanguages, t } from '../src/ui/i18n';
import { specBaselineDescription } from '../src/ui/talent_i18n';

function specDef(cls: PlayerClass, id: string) {
  const spec = TALENTS[cls]?.specs.find((candidate) => candidate.id === id);
  if (!spec) throw new Error(`missing spec ${cls}/${id}`);
  return spec;
}

function line(cls: PlayerClass, id: string): string {
  return specBaselineDescription(specDef(cls, id)) ?? '';
}

describe('spec card Specialization bonus line (hidden spec power made visible)', () => {
  beforeAll(async () => {
    await ensureLocaleLoaded('en');
    setLanguage('en');
  });

  it('describes every spec with a baseline or output tuning, and nothing for the rest', () => {
    for (const [cls, talents] of Object.entries(TALENTS) as [
      PlayerClass,
      (typeof TALENTS)[PlayerClass],
    ][]) {
      for (const spec of talents?.specs ?? []) {
        const described = specBaselineDescription(spec);
        const hidden =
          SPEC_BASELINES[cls]?.[spec.id] !== undefined ||
          offensiveSpecTuningFor(cls, spec.id) !== undefined ||
          primaryHealingMultiplier(cls, spec.id) !== 1;
        if (hidden) {
          expect(described, `${cls}/${spec.id}`).toBeTruthy();
          expect(described, `${cls}/${spec.id}`).not.toContain('undefined');
          expect(described, `${cls}/${spec.id}`).not.toContain('NaN');
        } else {
          expect(described, `${cls}/${spec.id}`).toBeNull();
        }
      }
    }
  });

  it('shows the rogue AP and crit floors that set the specs apart', () => {
    const knifework = line('rogue', 'assassination');
    const thuggery = line('rogue', 'combat');
    const skulduggery = line('rogue', 'subtlety');
    expect(knifework).toContain('Increases critical strike chance by 12%.');
    expect(knifework).toContain('Increases attack power by 57%.');
    expect(thuggery).toContain('Increases attack power by 24.');
    expect(thuggery).toContain('Increases critical strike chance by 14%.');
    expect(thuggery).toContain('Increases attack power by 20%.');
    expect(skulduggery).toContain('Increases critical strike chance by 10%.');
    expect(skulduggery).toContain('Increases attack power by 45%.');
    expect(skulduggery).toContain('Increases melee ability damage by 14%.');
  });

  it('folds the output-tuning bonus into one total per damage bucket', () => {
    // 0.22 legacy meleeDmgPct + 0.10 offense bonus.
    expect(line('rogue', 'assassination')).toContain('Increases melee ability damage by 32%.');
    expect(line('rogue', 'assassination')).not.toContain('by 22%');
    // 0.10 legacy spellDmgPct + 0.22 (Necromancy) and + 0.11 (Ruination).
    expect(line('warlock', 'demonology')).toContain('Increases spell damage by 32%.');
    expect(line('warlock', 'destruction')).toContain('Increases spell damage by 21%.');
    // No legacy bucket: the offense bonus stands alone.
    expect(line('hunter', 'marksmanship')).toContain(
      'Increases melee and ranged ability damage by 10%.',
    );
    expect(line('hunter', 'survival')).toContain(
      'Increases melee and ranged ability damage by 45%.',
    );
    expect(line('shaman', 'elemental')).toContain('Increases spell damage by 5%.');
  });

  it('reads Doctrine as plain damage and the healer factors as healing done', () => {
    expect(line('priest', 'discipline')).toContain('Increases damage by 30%.');
    expect(line('priest', 'discipline')).not.toContain('melee ability damage');
    expect(line('paladin', 'holy')).toBe(
      'Increases primary healing by 10% after other healing bonuses.',
    );
    expect(line('shaman', 'restoration')).toContain(
      'Increases primary healing by 10% after other healing bonuses.',
    );
    expect(line('druid', 'restoration')).toContain('Increases healing done by 8%.');
    expect(line('druid', 'restoration')).toContain(
      'Increases primary healing by 5% after other healing bonuses.',
    );
    expect(line('druid', 'restoration')).not.toContain('13.4%');
  });

  it('names healing, periodic healing, shields and damage by their live effect type', () => {
    expect(line('priest', 'holy')).toContain(`${ABILITIES.lesser_heal.name} healing by 18%.`);
    expect(line('priest', 'holy')).toContain(`${ABILITIES.heal.name} healing by 18%.`);
    expect(line('shaman', 'restoration')).toContain(
      `${ABILITIES.healing_wave.name} healing by 10%.`,
    );
    expect(line('druid', 'restoration')).toContain(
      `${ABILITIES.rejuvenation.name} healing by 24%.`,
    );
    expect(line('priest', 'discipline')).toContain(
      `${ABILITIES.power_word_shield.name} absorption by 18%.`,
    );
    expect(line('rogue', 'subtlety')).toContain(`${ABILITIES.backstab.name} damage by 16%.`);
    expect(line('priest', 'holy')).not.toContain(`${ABILITIES.heal.name} damage`);
    expect(line('priest', 'discipline')).not.toContain(
      `${ABILITIES.power_word_shield.name} damage`,
    );
  });

  it.each([
    ['druid', 'restoration', 'rejuvenation', 1.386],
    ['shaman', 'restoration', 'healing_wave', 1.21],
  ] as const)(
    'preserves %s primary healing composition at two power amounts',
    (cls, spec, ability, total) => {
      const mods = computeTalentModifiers(cls, { spec, rows: {} }, 20);
      const multiplier = resolveTalentHitMult(ABILITIES[ability], mods).healMult;
      const primary = primaryHealingMultiplier(cls, spec);
      for (const raw of [1000, 2000]) {
        expect(scalePrimaryHealing(raw * multiplier, primary)).toBe(Math.round(raw * total));
      }
      expect(line(cls, spec)).toContain(
        `${ABILITIES[ability].name} healing by ${cls === 'druid' ? 24 : 10}%.`,
      );
      expect(line(cls, spec)).toContain('after other healing bonuses.');
    },
  );

  it('leaves the untouched specs blank', () => {
    expect(specBaselineDescription(specDef('warrior', 'arms'))).toBeNull();
    expect(specBaselineDescription(specDef('mage', 'fire'))).toBeNull();
    expect(specBaselineDescription(specDef('paladin', 'protection'))).toBeNull();
  });

  it('renders the semantic labels in every locale, including inherited dialects', async () => {
    try {
      for (const lang of supportedLanguages) {
        await ensureLocaleLoaded(lang);
        setLanguage(lang);
        expect(line('druid', 'restoration'), lang).toContain(t('hudChrome.specPanel.healing'));
        expect(line('priest', 'discipline'), lang).toContain(t('hudChrome.specPanel.absorption'));
        expect(line('hunter', 'marksmanship'), lang).toContain(
          t('hudChrome.specPanel.physicalAbilityDamage'),
        );
        expect(line('druid', 'restoration'), lang).not.toContain('undefined');
        if (lang !== 'en' && lang !== 'en_CA') {
          expect(t('hudChrome.specPanel.specBonus'), lang).not.toBe('Specialization bonus');
          expect(t('hudChrome.specPanel.primaryHealingBonus', { pct: '5%' }), lang).not.toBe(
            'Increases primary healing by 5% after other healing bonuses.',
          );
        }
      }
    } finally {
      setLanguage('en');
    }
  });
});
