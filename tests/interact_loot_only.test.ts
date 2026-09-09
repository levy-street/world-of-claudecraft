import { describe, expect, it, vi } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { HARVEST_CAST_SECONDS } from '../src/sim/professions/harvest_admission';
import { Sim } from '../src/sim/sim';
import { DT } from '../src/sim/types';
import { EMPTY_TEST_WORLD } from './sim_shared';

// Intentional Gathering PR3: corpse harvest now starts a timed cast rather
// than resolving on the same tick (tests/corpse_harvest_command.test.ts).
const TICKS_PER_CAST = Math.round(HARVEST_CAST_SECONDS / DT);

function setup(targeted: boolean) {
  const sim = new Sim({ seed: 11, playerClass: 'warrior', world: EMPTY_TEST_WORLD });
  // Grounded via sim.groundPos, with a matching prevPos and onGround true (the
  // corpse_harvest_command.test.ts coherent-rest rig): a mismatched y reads
  // as an airborne body to the physics step, and the resulting per-tick fall
  // is exactly the position drift the timed harvest cast's own displacement
  // check would catch and invalidate the cast on.
  sim.player.pos = sim.groundPos(0, 0);
  sim.player.prevPos = { ...sim.player.pos };
  sim.player.vx = 0;
  sim.player.vy = 0;
  sim.player.vz = 0;
  sim.player.onGround = true;
  const mob = createMob(9999, MOBS.forest_wolf, 1, sim.groundPos(1, 0));
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

    // Harvest is now a timed Field Kit cast (PR3), not an instant grant: it
    // is refused with no kit, and even once admitted nothing lands until the
    // real cast completes over HARVEST_CAST_SECONDS worth of ticks.
    sim.addItem('field_kit', 1);
    const started = sim.harvestCorpse(mob.id);
    expect(started).toBe(true);
    expect(mob.harvestClaimedBy).toBeNull();
    expect(draws).not.toHaveBeenCalled();
    for (let i = 0; i < TICKS_PER_CAST; i++) sim.tick();
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
