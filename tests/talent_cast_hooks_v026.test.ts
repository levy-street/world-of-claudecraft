import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';

describe('v0.26 canonical successful-cast hooks', () => {
  it('routes a selected castNth row through the normal instant-cast lifecycle', () => {
    const sim = new Sim({ seed: 2603, playerClass: 'mage', autoEquip: false });
    sim.setPlayerLevel(20);
    expect(sim.selectTalentRow(8, 'mag_r8_ice_nova')).toBe(true);

    sim.castAbility('frost_nova');

    expect(sim.player.auras).toContainEqual(
      expect.objectContaining({
        id: 'mag_rime_ambush',
        kind: 'next_cast_instant',
        empowerAbilities: ['frostbolt'],
      }),
    );
  });

  it('emits an authored Warrior cast cue with the stable ability id', () => {
    const sim = new Sim({ seed: 2604, playerClass: 'warrior', autoEquip: false });
    sim.events = [];

    sim.castAbility('battle_shout');

    expect(sim.events).toContainEqual({
      type: 'spellfx',
      sourceId: sim.player.id,
      targetId: sim.player.id,
      school: 'physical',
      fx: 'shout',
      ability: 'battle_shout',
    });
  });
});
