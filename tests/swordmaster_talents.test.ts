import { describe, expect, it } from 'vitest';
import { abilitiesKnownAt } from '../src/sim/content/classes';
import { SWORDMASTER_ROWS } from '../src/sim/content/swordmaster_rows';
import { SWORDMASTER_TALENTS } from '../src/sim/content/swordmaster_talents';
import { computeTalentModifiers, ROW_LEVELS, validateRowTree } from '../src/sim/content/talents';
import { Sim } from '../src/sim/sim';

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

  it('pins the complete mastery payload for every SwordMaster specialization', () => {
    expect(
      SWORDMASTER_TALENTS.specs.map(({ id, mastery }) => ({ id, mastery: mastery.effect })),
    ).toEqual([
      { id: 'tempest', mastery: { global: { meleeDmgPct: 0.12 } } },
      {
        id: 'duelist',
        mastery: { global: { meleeHastePct: 0.12 }, stats: { crit: 0.03 } },
      },
      {
        id: 'azure_blade',
        mastery: { stats: { agiPct: 0.12, dodge: 0.04 } },
      },
    ]);
  });

  it('applies each mastery to resolved attacks or live combat statistics', () => {
    const tempestMods = computeTalentModifiers('swordmaster', { spec: 'tempest', rows: {} }, 20);
    const tempestSlash = abilitiesKnownAt('swordmaster', 20, tempestMods).find(
      (ability) => ability.def.id === 'twin_slash',
    );
    const tempestStrike = tempestSlash?.effects[0];
    expect(tempestStrike?.type).toBe('dualWeaponStrike');
    if (tempestStrike?.type !== 'dualWeaponStrike') {
      throw new Error('Tempest Twin Slash did not retain its paired strike');
    }
    expect(tempestStrike.mainhandMult).toBeCloseTo(0.84, 8);
    expect(tempestStrike.offhandMult).toBeCloseTo(0.616, 8);

    const baseline = new Sim({ seed: 440, playerClass: 'swordmaster' });
    baseline.setPlayerLevel(20);
    const duelist = new Sim({ seed: 440, playerClass: 'swordmaster' });
    duelist.setPlayerLevel(20);
    duelist.setSpec('duelist');
    expect(duelist.player.meleeHaste).toBeCloseTo(0.12, 8);
    expect(duelist.player.critChance - baseline.player.critChance).toBeCloseTo(0.03, 8);

    const azure = new Sim({ seed: 440, playerClass: 'swordmaster' });
    azure.setPlayerLevel(20);
    azure.setSpec('azure_blade');
    expect(azure.player.stats.agi).toBeGreaterThan(baseline.player.stats.agi);
    expect(azure.player.dodgeChance - baseline.player.dodgeChance).toBeGreaterThan(0.04);
  });

  it('casts Duelist Flurry through the live lifecycle and reduces the real swing interval', () => {
    const sim = new Sim({ seed: 441, playerClass: 'swordmaster' });
    sim.setPlayerLevel(20);
    sim.setSpec('duelist');
    const intervalBefore = sim.swingIntervalMult(sim.player);

    sim.castAbility('duelist_flurry');

    expect(sim.player.auras).toContainEqual(
      expect.objectContaining({
        id: 'duelist_flurry',
        kind: 'buff_haste',
        value: 1.35,
        duration: 12,
        remaining: 12,
      }),
    );
    expect(sim.player.resource).toBe(80);
    expect(sim.player.cooldowns.get('duelist_flurry')).toBe(45);
    expect(sim.player.gcdRemaining).toBe(1);
    expect(sim.swingIntervalMult(sim.player)).toBeCloseTo(intervalBefore / 1.35, 8);
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

  it('pins every row choice to its authored mechanical payload', () => {
    const effects = Object.fromEntries(
      SWORDMASTER_ROWS.flatMap((row) =>
        row.options.map((option) => [option.id, option.effect] as const),
      ),
    );
    expect(effects).toEqual({
      sm_row_gale_footwork: {
        ability: [{ ability: 'fleet_step', cooldownPct: -0.3 }],
      },
      sm_row_slipstream: {
        ability: [{ ability: 'wind_lunge', costPct: -0.25, cooldownPct: -0.25 }],
      },
      sm_row_long_stride: { stats: { agi: 3 } },
      sm_row_keen_twins: {
        ability: [{ ability: 'twin_slash', dmgPct: 0.2 }],
      },
      sm_row_wide_crescent: {
        ability: [{ ability: 'crescent_sweep', dmgPct: 0.2 }],
      },
      sm_row_flowing_edge: { stats: { crit: 0.03 } },
      sm_row_relentless_rhythm: { global: { meleeHastePct: 0.08 } },
      sm_row_efficient_dance: {
        ability: [{ ability: 'blade_dance', costPct: -0.25 }],
      },
      sm_row_inner_current: { stats: { agiPct: 0.08 } },
      sm_row_parrying_current: {
        ability: [{ ability: 'parrying_flow', buffPct: 0.25, cooldownPct: -0.25 }],
      },
      sm_row_quicksilver: {
        ability: [{ ability: 'quickening', buffPct: 0.2, cooldownPct: -0.2 }],
      },
      sm_row_azure_tempering: {
        ability: [{ ability: 'sword_aura', buffPct: 0.25 }],
      },
      sm_row_cyclone_edge: {
        ability: [{ ability: 'blade_cyclone', dmgPct: 0.25 }],
      },
      sm_row_duelist_tempo: {
        ability: [{ ability: 'duelist_flurry', cooldownPct: -0.25 }],
      },
      sm_row_azure_momentum: {
        ability: [{ ability: 'azure_rush', cooldownPct: -0.25 }],
      },
      sm_row_storm_of_steel: {
        ability: [{ ability: 'blade_dance', dmgPct: 0.25 }],
      },
      sm_row_perfect_pair: {
        ability: [{ ability: 'twin_finisher', dmgPct: 0.3 }],
      },
      sm_row_unbound_motion: {
        ability: [
          { ability: 'fleet_step', cooldownPct: -0.3 },
          { ability: 'wind_lunge', cooldownPct: -0.3 },
        ],
      },
    });
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
