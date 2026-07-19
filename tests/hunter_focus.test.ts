import { describe, expect, it } from 'vitest';
import { updateRegen } from '../src/sim/combat/auras';
import { CLASSES } from '../src/sim/content/classes';
import type { PlayerMeta } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';

type TestSim = Sim & { tickCount: number; players: Map<number, PlayerMeta> };

describe('Hunter Focus', () => {
  it('uses a full 100-point Focus bar and starts without water', () => {
    const sim = new Sim({ seed: 271, playerClass: 'hunter' });

    expect(CLASSES.hunter.resourceType).toBe('focus');
    expect(sim.player.resourceType).toBe('focus');
    expect(sim.player.maxResource).toBe(100);
    expect(sim.player.resource).toBe(100);
    expect(sim.countItem('spring_water')).toBe(0);
  });

  it('spends Focus and reports the correct insufficient-resource error', () => {
    const sim = new Sim({ seed: 272, playerClass: 'hunter' });
    sim.setPlayerLevel(4);
    sim.player.resource = 20;

    sim.castAbility('aspect_of_the_hawk');
    expect(sim.player.resource).toBe(0);

    sim.player.gcdRemaining = 0;
    sim.drainEvents();
    sim.castAbility('aspect_of_the_hawk');
    expect(sim.drainEvents()).toContainEqual(
      expect.objectContaining({ type: 'error', text: 'Not enough focus!' }),
    );
  });

  it('regenerates 20 Focus every two seconds during combat', () => {
    const sim = new Sim({ seed: 273, playerClass: 'hunter' }) as TestSim;
    const meta = sim.players.get(sim.player.id);
    if (!meta) throw new Error('missing Hunter metadata');
    sim.player.resource = 0;
    sim.player.inCombat = true;
    sim.tickCount = 40;

    updateRegen(sim.ctx, sim.player, meta);

    expect(sim.player.resource).toBe(20);
  });
});
