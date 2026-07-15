import { describe, expect, it } from 'vitest';
import { abilitiesKnownAt } from '../src/sim/content/classes';
import { SWORDMASTER_ROWS } from '../src/sim/content/swordmaster_rows';
import { SWORDMASTER_TALENTS } from '../src/sim/content/swordmaster_talents';
import { computeTalentModifiers, ROW_LEVELS, validateRowTree } from '../src/sim/content/talents';

describe('SwordMaster specializations', () => {
  it('defines three DPS specs with the canonical signature ids', () => {
    expect(
      SWORDMASTER_TALENTS.specs.map(({ id, role, signature }) => ({ id, role, signature })),
    ).toEqual([
      { id: 'tempest', role: 'dps', signature: 'blade_cyclone' },
      { id: 'duelist', role: 'dps', signature: 'duelist_flurry' },
      { id: 'azure_blade', role: 'dps', signature: 'azure_rush' },
    ]);
  });

  for (const [spec, signature] of [
    ['tempest', 'blade_cyclone'],
    ['duelist', 'duelist_flurry'],
    ['azure_blade', 'azure_rush'],
  ] as const) {
    it(`${spec} grants only its own signature`, () => {
      const mods = computeTalentModifiers('swordmaster', { spec, rows: {} }, 20);
      const known = abilitiesKnownAt('swordmaster', 20, mods).map((ability) => ability.def.id);
      expect(known).toContain(signature);
      expect(
        known.filter((id) => ['blade_cyclone', 'duelist_flurry', 'azure_rush'].includes(id)),
      ).toEqual([signature]);
      expect(mods.role).toBe('dps');
    });
  }
});

describe('SwordMaster talent rows', () => {
  it('has exactly six valid rows at 5, 8, 11, 14, 17, and 20 with three unique choices each', () => {
    expect(validateRowTree(SWORDMASTER_ROWS)).toEqual([]);
    expect(SWORDMASTER_ROWS.map((row) => row.level)).toEqual(ROW_LEVELS);
    expect(SWORDMASTER_ROWS.every((row) => row.options.length === 3)).toBe(true);
    const ids = SWORDMASTER_ROWS.flatMap((row) => row.options.map((option) => option.id));
    expect(ids).toHaveLength(18);
    expect(new Set(ids).size).toBe(18);
  });

  it('precomputes a selected damage row into the resolved dual-weapon effect', () => {
    const base = abilitiesKnownAt('swordmaster', 20).find(
      (ability) => ability.def.id === 'twin_slash',
    );
    const mods = computeTalentModifiers(
      'swordmaster',
      { spec: null, rows: { 8: 'sm_row_keen_twins' } },
      20,
    );
    const talented = abilitiesKnownAt('swordmaster', 20, mods).find(
      (ability) => ability.def.id === 'twin_slash',
    );
    expect(base?.effects[0]).toMatchObject({ mainhandMult: 0.75, offhandMult: 0.55 });
    expect(talented?.effects[0]).toMatchObject({ type: 'dualWeaponStrike' });
    if (talented?.effects[0]?.type !== 'dualWeaponStrike') {
      throw new Error('Twin Slash did not resolve to a dual-weapon strike');
    }
    expect(talented.effects[0].mainhandMult).toBeCloseTo(0.9, 8);
    expect(talented.effects[0].offhandMult).toBeCloseTo(0.66, 8);
  });

  it('scales flat, fractional, and neutral-one SwordMaster buffs by their real bonus', () => {
    const cases = [
      ['parrying_flow', 'sm_row_parrying_current', 0.25],
      ['quickening', 'sm_row_quicksilver', 1.3],
      ['sword_aura', 'sm_row_azure_tempering', 15],
    ] as const;

    for (const [abilityId, talentId, expectedValue] of cases) {
      const mods = computeTalentModifiers(
        'swordmaster',
        { spec: null, rows: { 14: talentId } },
        20,
      );
      const ability = abilitiesKnownAt('swordmaster', 20, mods).find(
        (known) => known.def.id === abilityId,
      );
      const buff = ability?.effects.find((effect) => effect.type === 'selfBuff');
      expect(buff?.value, abilityId).toBeCloseTo(expectedValue, 8);
    }
  });
});
