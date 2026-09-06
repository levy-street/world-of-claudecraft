import { describe, expect, it, vi } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import { EMPTY_TEST_WORLD } from './sim_shared';

function setup(targeted: boolean) {
  const sim = new Sim({ seed: 11, playerClass: 'warrior', world: EMPTY_TEST_WORLD });
  sim.player.pos = { x: 0, y: 0, z: 0 };
  const mob = createMob(9999, MOBS.forest_wolf, 1, { x: 1, y: 0, z: 0 });
  mob.dead = true;
  mob.aiState = 'dead';
  mob.corpseTimer = 9999;
  mob.respawnTimer = 9999;
  mob.lootable = true;
  mob.loot = { copper: 10, items: [{ itemId: 'wolf_fang', count: 2 }] };
  sim.entities.set(mob.id, mob);
  sim.tick();
  sim.targetEntity(targeted ? mob.id : null);
  return { sim, mob };
}

describe('ordinary sim interaction leaves gathering deliberate', () => {
  it.each([true, false])('loots without harvesting with targeted=%s', (targeted) => {
    const { sim, mob } = setup(targeted);
    const before = sim.countItem('wolf_fang');
    const beforeCopper = sim.copper;
    const draws = vi.fn();
    sim.rng.setObserver(draws);

    sim.interact();
    sim.interact();
    sim.interact();

    expect(sim.countItem('wolf_fang')).toBe(before + 2);
    expect(sim.copper).toBe(beforeCopper + 10);
    expect(mob.harvestClaimedBy).toBeNull();
    expect(draws).not.toHaveBeenCalled();
    expect(sim.countItem('rough_hide')).toBe(0);

    sim.harvestCorpse(mob.id);
    expect(mob.harvestClaimedBy).toBe(sim.playerId);
    expect(draws).toHaveBeenCalled();
  });

  it.each([true, false])('ignores harvest-only bodies with targeted=%s', (targeted) => {
    const { sim, mob } = setup(targeted);
    mob.loot = null;
    const before = JSON.stringify(sim.inventory);
    const draws = vi.fn();
    sim.rng.setObserver(draws);

    sim.interact();
    sim.interact();

    expect(mob.harvestClaimedBy).toBeNull();
    expect(JSON.stringify(sim.inventory)).toBe(before);
    expect(draws).not.toHaveBeenCalled();
  });
});
