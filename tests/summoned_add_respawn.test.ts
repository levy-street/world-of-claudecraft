// Summoned boss adds must UNRAVEL when slain, never respawn into the wild.
//
// spawnBossAdds anchors an add where it ERUPTED (deliberate: a kited boss must
// not hatch adds already past their own leash), so its spawnPos is wherever the
// fight happened to drag: on prod, Grix the Tunnelking kited to the Eastbrook
// town square left Deeprock Diggers squatting between the town NPCs. The dead-mob
// respawn gate treated those adds like camp mobs, respawning them at the eruption
// point on the normal cadence, and the only cleanup was despawnSummonedAdds on the
// summoner's own respawn, 432x base for a rare like Grix, hours away.

import { describe, expect, it } from 'vitest';
import { BUILTIN_WORLD, MOBS, setActiveWorldContent } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { WorldContent } from '../src/sim/types';

const SEED = 42;
const TOWN = { x: 2, z: -2 };

function makeWorld(): Sim {
  const world: WorldContent = {
    ...BUILTIN_WORLD,
    camps: [],
    npcs: {},
    groundObjects: [],
  };
  setActiveWorldContent(world);
  const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true, world });
  const pid = sim.addPlayer('warrior', 'Townsfolk');
  const p = sim.entities.get(pid);
  if (!p) throw new Error('player missing');
  p.pos = sim.groundPos(TOWN.x, TOWN.z);
  p.prevPos = { ...p.pos };
  sim.grid.update(p);
  sim.playerGrid.update(p);
  sim.setPlayerLevel(10, pid);
  sim.drainEvents();
  return sim;
}

function spawnGrixAt(sim: Sim, x: number, z: number) {
  const grix = createMob(920001, MOBS.grix_the_tunnelking, 7, sim.groundPos(x, z));
  sim.entities.set(grix.id, grix);
  sim.grid.update(grix);
  return grix;
}

function summonedAddsOf(sim: Sim, boss: { summonedIds: number[] }) {
  return boss.summonedIds
    .map((id) => sim.entities.get(id))
    .filter((e): e is NonNullable<typeof e> => e != null);
}

describe('summoned add lifecycle', () => {
  it('adds slain in the wild unravel with their corpse instead of respawning there', () => {
    const sim = makeWorld();
    const player = sim.player;
    // The kite proxy: Grix stands in town when his add wave erupts, so the adds
    // anchor (spawnPos) beside the town square, far from any camp.
    const grix = spawnGrixAt(sim, TOWN.x + 4, TOWN.z);

    // Cross the first summon threshold (55%) with the player as the aggressor.
    sim.ctx.dealDamage(player, grix, Math.ceil(grix.maxHp * 0.5), false, 'physical', null, 'hit');
    sim.tick();
    const adds = summonedAddsOf(sim, grix);
    expect(adds.length).toBeGreaterThan(0);
    for (const add of adds) {
      expect(add.templateId).toBe('tunnel_rat');
      expect(Math.hypot(add.spawnPos.x - grix.pos.x, add.spawnPos.z - grix.pos.z)).toBeLessThan(10);
    }

    // Slay every add, then let its corpse window fully elapse.
    for (const add of adds) {
      sim.ctx.dealDamage(null, add, add.maxHp * 10, false, 'physical', null, 'hit');
      expect(add.dead).toBe(true);
      add.corpseTimer = 0;
      add.respawnTimer = 0;
      add.lootable = false;
    }
    sim.tick();

    // The add unravels like a slain summoned demon: no respawn squatting at the
    // eruption point until the summoner's distant respawn cleans it up.
    for (const add of adds) {
      expect(sim.entities.has(add.id)).toBe(false);
    }
  });

  it('ordinary wild mobs still respawn at their spawn point', () => {
    const sim = makeWorld();
    const wolf = createMob(920002, MOBS.forest_wolf, 5, sim.groundPos(TOWN.x + 6, TOWN.z + 6));
    sim.entities.set(wolf.id, wolf);
    sim.grid.update(wolf);

    sim.ctx.dealDamage(null, wolf, wolf.maxHp * 10, false, 'physical', null, 'hit');
    expect(wolf.dead).toBe(true);
    wolf.corpseTimer = 0;
    wolf.respawnTimer = 0;
    wolf.lootable = false;
    sim.tick();

    const respawned = sim.entities.get(wolf.id);
    expect(respawned).toBeDefined();
    expect(respawned?.dead).toBe(false);
    expect(respawned?.pos.x).toBeCloseTo(wolf.spawnPos.x, 3);
    expect(respawned?.pos.z).toBeCloseTo(wolf.spawnPos.z, 3);
  });

  it('the summoner respawn cleanup still despawns any adds left alive', () => {
    const sim = makeWorld();
    const player = sim.player;
    const grix = spawnGrixAt(sim, TOWN.x + 4, TOWN.z);
    sim.ctx.dealDamage(player, grix, Math.ceil(grix.maxHp * 0.5), false, 'physical', null, 'hit');
    sim.tick();
    const adds = summonedAddsOf(sim, grix);
    expect(adds.length).toBeGreaterThan(0);

    // Grix dies; his live adds linger (loot rights et al), then his own respawn
    // sweeps them, the pre-existing contract.
    sim.ctx.dealDamage(null, grix, grix.maxHp * 100, false, 'physical', null, 'hit');
    expect(grix.dead).toBe(true);
    grix.corpseTimer = 0;
    grix.respawnTimer = 0;
    grix.lootable = false;
    sim.tick();

    expect(grix.dead).toBe(false);
    for (const add of adds) {
      expect(sim.entities.has(add.id)).toBe(false);
    }
  });
});
