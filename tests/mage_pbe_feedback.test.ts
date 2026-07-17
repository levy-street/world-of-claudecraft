import { describe, expect, it } from 'vitest';
import {
  onCastCompleted,
  onDamageTaken,
  onSpellCrit,
  tickProcState,
} from '../src/sim/combat/talent_procs';
import { MAGE_CHOICE_ROWS } from '../src/sim/content/choice_rows_classic';
import { ABILITIES, ITEMS } from '../src/sim/data';
import { Sim } from '../src/sim/sim';

function mage(rows: Record<number, string> = {}, level = 20): Sim {
  const sim = new Sim({ seed: 2026, playerClass: 'mage', autoEquip: false });
  sim.setPlayerLevel(level);
  expect(sim.applyTalents({ spec: null, rows })).toBe(true);
  return sim;
}

describe('PBE-2 Mage feedback', () => {
  it('aligns the Icy Veins cooldown with Flashfire at 120 seconds', () => {
    expect(ABILITIES.icy_veins.cooldown).toBe(120);
    expect(ABILITIES.icy_veins.cooldown).toBe(ABILITIES.combustion.cooldown);
  });

  it('scales Third Current to 8% maximum mana and keeps its cheap-spell half', () => {
    const sim = mage({ 5: 'mag_r5_mana_attunement' });
    sim.player.resource = 0;

    for (let index = 0; index < 3; index++) {
      onCastCompleted(sim.ctx, sim.player, 'fireball');
    }

    expect(sim.player.resource / sim.player.maxResource).toBeCloseTo(0.08, 2);
    expect(sim.player.auras).toContainEqual(
      expect.objectContaining({
        id: 'mag_mana_attunement',
        kind: 'next_cast_cheap',
        value: 0.5,
        remaining: 8,
      }),
    );
  });

  it('auto-procs Racing Mind from spell criticals on a 15 second rhythm', () => {
    const sim = mage({ 14: 'mag_r14_presence_of_mind' });
    expect(sim.known.some((known) => known.def.id === 'presence_of_mind')).toBe(false);

    onSpellCrit(sim.ctx, sim.player, 'fireball', sim.player);

    expect(sim.player.auras).toContainEqual(
      expect.objectContaining({
        id: 'mag_racing_mind',
        kind: 'next_cast_instant',
        empowerAbilities: [
          'fireball',
          'frostbolt',
          'polymorph',
          'flamestrike',
          'scorch',
          'pyroblast',
        ],
        remaining: 8,
      }),
    );

    sim.player.auras.length = 0;
    onSpellCrit(sim.ctx, sim.player, 'frostbolt', sim.player);
    expect(sim.player.auras).toEqual([]);

    tickProcState(sim.player, 15);
    onSpellCrit(sim.ctx, sim.player, 'frostbolt', sim.player);
    expect(sim.player.auras).toContainEqual(
      expect.objectContaining({ id: 'mag_racing_mind', kind: 'next_cast_instant' }),
    );
  });

  it('matches top-rank conjured food and water to the best vendor consumables', () => {
    expect(ABILITIES.conjure_water.ranks?.at(-1)?.rank).toBe(3);
    expect(ABILITIES.conjure_food.ranks?.at(-1)?.rank).toBe(3);
    expect(ITEMS.conjured_water3.drinkMana).toBe(ITEMS.glacier_melt.drinkMana);
    expect(ITEMS.conjured_bread3.foodHp).toBe(ITEMS.roast_mountain_goat.foodHp);
    expect([
      ITEMS.conjured_water.drinkMana,
      ITEMS.conjured_water2.drinkMana,
      ITEMS.conjured_water3.drinkMana,
    ]).toEqual([76, 288, 900]);
    expect([
      ITEMS.conjured_bread.foodHp,
      ITEMS.conjured_bread2.foodHp,
      ITEMS.conjured_bread3.foodHp,
    ]).toEqual([61, 243, 874]);
  });

  it('raises Fire spell DoTs and exposes their totals through the over-time token', () => {
    const cinderboltRanks = [
      { level: 1, total: 4, duration: 4, interval: 2, perTick: 2 },
      { level: 6, total: 9, duration: 6, interval: 2, perTick: 3 },
      { level: 12, total: 18, duration: 6, interval: 2, perTick: 6 },
      { level: 18, total: 32, duration: 8, interval: 2, perTick: 8 },
    ];

    for (const expected of cinderboltRanks) {
      const cinderbolt = mage({}, expected.level).resolvedAbility('fireball');
      const cinderboltDot = cinderbolt?.effects.find((effect) => effect.type === 'dot');
      expect(cinderboltDot).toMatchObject({
        total: expected.total,
        duration: expected.duration,
        interval: expected.interval,
      });
      expect(
        cinderboltDot && cinderboltDot.total / (cinderboltDot.duration / cinderboltDot.interval),
      ).toBe(expected.perTick);
    }

    const sim = mage();
    const pyrelance = sim.resolvedAbility('pyroblast');
    const pyrelanceDot = pyrelance?.effects.find((effect) => effect.type === 'dot');

    expect(pyrelanceDot).toMatchObject({ total: 72, duration: 12, interval: 2 });
    expect(
      pyrelanceDot && pyrelanceDot.total / (pyrelanceDot.duration / pyrelanceDot.interval),
    ).toBe(12);
    expect(ABILITIES.fireball.description).toContain('$o');
    expect(ABILITIES.pyroblast.description).toContain('$o');
  });

  it('makes Flickerstep baseline and keeps three distinct level-17 choices', () => {
    const baseline = mage();
    expect(baseline.known.some((known) => known.def.id === 'blink')).toBe(true);

    const row = MAGE_CHOICE_ROWS.rows.find((entry) => entry.level === 17);
    expect(row?.options.map((option) => option.id)).toEqual([
      'mag_r17_frigid_reversal',
      'mag_r17_ice_block',
      'mag_r17_battlemage_armor',
    ]);
  });

  it('resets Flickerstep and primes Rimelance after a large hit on a 20 sec ICD', () => {
    const sim = mage({ 17: 'mag_r17_frigid_reversal' });
    sim.player.cooldowns.set('blink', 10);

    onDamageTaken(sim.ctx, sim.player, sim.player.maxHp * 0.15);

    expect(sim.player.cooldowns.has('blink')).toBe(false);
    expect(sim.player.auras).toContainEqual(
      expect.objectContaining({
        id: 'mag_frigid_reversal',
        kind: 'next_cast_instant',
        empowerAbilities: ['frostbolt'],
        remaining: 8,
      }),
    );

    sim.player.cooldowns.set('blink', 10);
    sim.player.auras.length = 0;
    onDamageTaken(sim.ctx, sim.player, sim.player.maxHp);

    expect(sim.player.cooldowns.get('blink')).toBe(10);
    expect(sim.player.auras).toEqual([]);
  });
});
