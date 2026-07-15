import { describe, expect, it } from 'vitest';
import { onDamageTaken } from '../src/sim/combat/talent_procs';
import { MAGE_CHOICE_ROWS } from '../src/sim/content/choice_rows_classic';
import { Sim } from '../src/sim/sim';

function mage(rows: Record<number, string> = {}): Sim {
  const sim = new Sim({ seed: 2026, playerClass: 'mage', autoEquip: false });
  sim.setPlayerLevel(20);
  expect(sim.applyTalents({ spec: null, rows })).toBe(true);
  return sim;
}

describe('PBE-2 Mage feedback', () => {
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
