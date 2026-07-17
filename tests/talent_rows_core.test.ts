import { describe, expect, it } from 'vitest';
import {
  cloneAllocation,
  computeTalentModifiers,
  emptyAllocation,
  exportBuild,
  importBuild,
  ROW_LEVELS,
  ROW_TREES,
  repairAllocation,
  rowTreeFor,
  sanitizeAllocation,
  TALENT_BUILD_VERSION,
  TALENTS,
  type TalentAllocation,
  type TalentRowLevel,
  validateAllocation,
  validateRowTree,
} from '../src/sim/content/talents';
import { ABILITIES } from '../src/sim/data';
import { ALL_CLASSES, type PlayerClass } from '../src/sim/types';

const EXPECTED_WARRIOR_OPTIONS = [
  'war_row_double_charge',
  'war_row_pursuit',
  'war_row_crushing_charge',
  'war_row_second_wind',
  'war_row_die_by_the_sword',
  'war_row_victory_rush',
  'war_row_piercing_howl',
  'war_row_storm_bolt',
  'war_row_lingering_dread',
  'war_row_anger_management',
  'war_row_blood_offering',
  'war_row_battle_rhythm',
  'war_row_recklessness',
  'war_row_avatar',
  'war_row_bloodbath',
  'war_row_colossal_might',
  'war_row_bladestorm',
  'war_row_sanguine_aura',
] as const;

function requiredTree(cls: PlayerClass) {
  const tree = rowTreeFor(cls);
  if (!tree) throw new Error(`missing row tree for ${cls}`);
  return tree;
}

describe('canonical Talents V2 row registry', () => {
  it('has exactly one six-row tree for each of the nine playable classes', () => {
    expect(ALL_CLASSES).toHaveLength(9);
    expect(Object.keys(ROW_TREES).sort()).toEqual([...ALL_CLASSES].sort());
    expect(Object.keys(TALENTS).sort()).toEqual([...ALL_CLASSES].sort());

    let rowCount = 0;
    let optionCount = 0;
    for (const cls of ALL_CLASSES) {
      const tree = requiredTree(cls);
      expect(validateRowTree(tree), cls).toEqual([]);
      expect(
        tree.map((row) => row.level),
        cls,
      ).toEqual(ROW_LEVELS);
      expect(tree, cls).toHaveLength(6);
      expect(
        tree.every((row) => row.options.length === 3),
        cls,
      ).toBe(true);
      rowCount += tree.length;
      optionCount += tree.reduce((sum, row) => sum + row.options.length, 0);
    }
    expect(rowCount).toBe(54);
    expect(optionCount).toBe(162);
  });

  it('registers only the authored winning Warrior options', () => {
    const warrior = requiredTree('warrior');
    expect(warrior.flatMap((row) => row.options.map((option) => option.id))).toEqual(
      EXPECTED_WARRIOR_OPTIONS,
    );
    expect(
      warrior
        .find((row) => row.level === 11)
        ?.options.find((o) => o.id === 'war_row_lingering_dread')?.effect.global,
    ).toEqual({ fearBreakPct: 0.2 });
    expect(
      warrior
        .find((row) => row.level === 14)
        ?.options.find((o) => o.id === 'war_row_blood_offering'),
    ).toMatchObject({ name: 'Combat Mastery', effect: { global: { stanceMastery: 1 } } });
    expect(
      warrior
        .find((row) => row.level === 8)
        ?.options.find((option) => option.id === 'war_row_die_by_the_sword')?.description,
    ).toBe(ABILITIES.die_by_sword.description);
  });

  it('keeps the evolved non-Warrior spec identities and only the winning Warrior masteries', () => {
    for (const cls of ALL_CLASSES) expect(TALENTS[cls].specs, cls).toHaveLength(3);
    expect(ALL_CLASSES.flatMap((cls) => TALENTS[cls].specs)).toHaveLength(27);

    expect(TALENTS.mage.specs.find((spec) => spec.id === 'fire')?.mastery.effect).toEqual({
      global: { critDmgSpellPct: 0.5 },
      stats: { crit: 0.02 },
      procs: [
        {
          id: 'mag_afterflame',
          name: 'Afterflame',
          spec: 'fire',
          requiresKnownAbility: 'combustion',
          school: 'fire',
          trigger: {
            on: 'spellCrit',
            abilities: ['fireball', 'fire_blast', 'scorch', 'pyroblast'],
          },
          responses: [{ kind: 'rollingDot', pctDamage: 0.2, duration: 6, interval: 2 }],
        },
        {
          id: 'mag_afterflame_detonate',
          name: 'Afterflame',
          spec: 'fire',
          requiresKnownAbility: 'combustion',
          school: 'fire',
          trigger: { on: 'spellHit', abilities: ['fire_blast'] },
          responses: [{ kind: 'detonateOwnedDot', auraId: 'mag_afterflame' }],
        },
      ],
    });
    expect(TALENTS.paladin.specs.find((spec) => spec.id === 'holy')?.mastery.effect).toEqual({
      global: { critDmgHealPct: 0.5 },
    });
    expect(TALENTS.rogue.specs.find((spec) => spec.id === 'subtlety')?.mastery.effect).toEqual({
      global: { critDmgPhysPct: 0.4 },
      stats: { agiPct: 0.1 },
      proc: {
        id: 'rog_false_face',
        name: 'False Face',
        spec: 'subtlety',
        requiresKnownAbility: 'hemorrhage',
        school: 'shadow',
        trigger: { on: 'castNth', n: 1, abilities: ['ambush', 'garrote', 'cheap_shot'] },
        responses: [
          {
            kind: 'empowerNext',
            aura: 'next_ability_damage',
            abilities: ['hemorrhage'],
            duration: 8,
            dmgPct: 0.5,
          },
        ],
      },
    });

    const warrior = Object.fromEntries(
      TALENTS.warrior.specs.map((spec) => [spec.id, spec.mastery]),
    );
    expect(warrior).toEqual({
      arms: {
        name: 'Master Armorer',
        description: 'While wielding a two-handed weapon, all damage you deal is increased by 10%.',
        effect: { global: { masteryTwoHandDmgPct: 0.1 } },
      },
      fury: {
        name: 'Bloodletter',
        description: 'Increases your critical strike chance by 5% and attack power by 10.',
        effect: { stats: { crit: 0.05, ap: 10 } },
      },
      prot: {
        name: 'Recompense',
        description:
          'Increases all threat you generate by 30% and your armor by 10%. Vanguard: your Stamina is increased by 40% and you gain armor equal to 70% of your Strength.',
        effect: {
          global: { threatPct: 0.3 },
          stats: { armorPct: 0.1, staPct: 0.4, armorFromStrPct: 0.7 },
        },
      },
    });
    expect(JSON.stringify(warrior)).not.toMatch(/"threatPct":0\.5|"armorPct":0\.2/);
  });
});

describe('canonical Talents V2 allocation', () => {
  it('uses only spec and level-keyed rows and clones without sharing row state', () => {
    expect(emptyAllocation()).toEqual({ spec: null, rows: {} });
    const source: TalentAllocation = { spec: 'fire', rows: { 5: 'mag_r5_impulse' } };
    const copy = cloneAllocation(source);
    copy.rows[8] = 'mag_r8_spellsteal';
    expect(source).toEqual({ spec: 'fire', rows: { 5: 'mag_r5_impulse' } });
    expect(Object.keys(copy).sort()).toEqual(['rows', 'spec']);
  });

  it('validates row unlocks, mutual exclusion, option ownership, and specialization unlocks', () => {
    const level5: TalentAllocation = { spec: 'fire', rows: { 5: 'mag_r5_impulse' } };
    expect(validateAllocation('mage', level5, 5)).toEqual({ ok: true });
    expect(validateAllocation('mage', level5, 4)).toMatchObject({ ok: false });
    expect(
      validateAllocation('mage', { spec: 'fire', rows: { 8: 'mag_r8_spellsteal' } }, 7),
    ).toMatchObject({ ok: false });
    expect(
      validateAllocation('mage', { spec: 'fire', rows: { 5: 'hun_r5_quick_shots' } }, 20),
    ).toMatchObject({ ok: false });
    expect(
      validateAllocation(
        'mage',
        { spec: 'fire', rows: { 5: ['mag_r5_impulse', 'mag_r5_firestarter'] } } as unknown,
        20,
      ),
    ).toMatchObject({ ok: false });
    expect(
      validateAllocation(
        'mage',
        {
          spec: 'fire',
          rows: { 5: 'mag_r5_impulse' },
          ranks: { legacy: 1 },
        },
        20,
      ),
    ).toMatchObject({ ok: false });
  });

  it('sanitizes malformed input and repairs semantically stale rows idempotently', () => {
    const sanitized = sanitizeAllocation({
      spec: 'fire',
      rows: { 5: 'mag_r5_impulse', 8: 42, 9: 'bogus', 11: '' },
      ranks: { old_point_node: 5 },
      choices: { old_choice: 'legacy' },
      rowPicks: ['dual-model-baggage'],
    });
    expect(sanitized).toEqual({ spec: 'fire', rows: { 5: 'mag_r5_impulse' } });

    const repaired = repairAllocation(
      'mage',
      {
        spec: 'fire',
        rows: {
          5: 'mag_r5_impulse',
          8: 'hun_r8_startle_shot',
          20: 'mag_r20_meteor',
        },
      },
      8,
    );
    expect(repaired).toEqual({ spec: 'fire', rows: { 5: 'mag_r5_impulse' } });
    expect(repairAllocation('mage', repaired, 8)).toEqual(repaired);
  });

  it('folds each selected row exactly once', () => {
    const mods = computeTalentModifiers('mage', { spec: null, rows: { 5: 'mag_r5_impulse' } }, 20);
    expect(mods.abilities.fire_blast?.bonusCharges).toBe(1);
  });

  it('round-trips a versioned canonical build without legacy point-tree fields', () => {
    expect(TALENT_BUILD_VERSION).toBeGreaterThan(1);
    const alloc: TalentAllocation = {
      spec: 'arms',
      rows: Object.fromEntries(
        ROW_LEVELS.map((level, index) => [level, EXPECTED_WARRIOR_OPTIONS[index * 3]]),
      ) as Partial<Record<TalentRowLevel, string>>,
    };
    const imported = importBuild(exportBuild('warrior', alloc));
    expect(imported).toEqual({ ok: true, cls: 'warrior', alloc });
    if (imported.ok) expect(Object.keys(imported.alloc).sort()).toEqual(['rows', 'spec']);
  });

  it('rejects unknown class identities outside the playable roster', () => {
    const removedComparisonId = ['warrior', 'classic'].join('_') as PlayerClass;
    expect(rowTreeFor(removedComparisonId)).toBeNull();
    expect(validateAllocation(removedComparisonId, emptyAllocation(), 20)).toMatchObject({
      ok: false,
    });
  });
});
