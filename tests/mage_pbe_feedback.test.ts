import { describe, expect, it } from 'vitest';
import { onCastCompleted, onDamageTaken } from '../src/sim/combat/talent_procs';
import { MAGE_CHOICE_ROWS } from '../src/sim/content/choice_rows_classic';
import { ABILITIES } from '../src/sim/data';
import { Sim } from '../src/sim/sim';

function mage(rows: Record<number, string> = {}): Sim {
  const sim = new Sim({ seed: 2026, playerClass: 'mage', autoEquip: false });
  sim.setPlayerLevel(20);
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
