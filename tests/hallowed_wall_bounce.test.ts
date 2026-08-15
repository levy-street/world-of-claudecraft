import { describe, expect, it } from 'vitest';
import { grantDevotion } from '../src/sim/paladin_devotion';
import { Sim } from '../src/sim/sim';

describe('Holy Shield active mitigation', () => {
  it('replaces the old bouncing attack with a free block and absorb window', () => {
    const sim = new Sim({ seed: 7, playerClass: 'paladin', autoEquip: true });
    sim.setPlayerLevel(20);
    expect(sim.setSpec('protection')).toBe(true);
    grantDevotion(sim.player, 3);

    sim.castAbility('holy_shield');

    expect(sim.player.paladinDevotion?.value).toBe(3);
    expect(sim.player.auras).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'holy_shield', kind: 'buff_block', value: 0.3 }),
        expect.objectContaining({
          id: 'holy_shield_absorb',
          kind: 'absorb',
          value: Math.round(sim.player.maxHp * 0.1),
        }),
      ]),
    );
  });
});
