// The world-owned ally substrate (src/sim/ally.ts): allied combat mobs that are
// friendly to every player, fight hostile mobs, survive the hostility safety
// net, die without loot or respawnMob revival, and stay rng-draw-silent while
// idle (the parity-critical property). Drives a real Sim with a test-injected
// ally template.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALLY_CORPSE_SECONDS, ALLY_LEASH, spawnAllyAt } from '../src/sim/ally';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Rng } from '../src/sim/rng';
import { Sim } from '../src/sim/sim';
import { addThreat } from '../src/sim/threat';
import { terrainHeight } from '../src/sim/world';

type AnySim = Sim & Record<string, any>;

const TEST_ALLY = 'test_world_ally';

beforeAll(() => {
  (MOBS as any)[TEST_ALLY] = {
    id: TEST_ALLY,
    name: 'Test Warden',
    minLevel: 25,
    maxLevel: 25,
    family: 'humanoid',
    hpBase: 300,
    hpPerLevel: 25,
    dmgBase: 16,
    dmgPerLevel: 3,
    attackSpeed: 2,
    armorPerLevel: 10,
    moveSpeed: 8,
    aggroRadius: 10,
    loot: [],
    scale: 1,
    color: 0xffffff,
    allyOfPlayers: true,
  };
});
afterAll(() => {
  delete (MOBS as any)[TEST_ALLY];
});

function makeSim(): AnySim {
  return new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true }) as AnySim;
}

// A quiet flat spot in Eastbrook Vale, clear of camps and roads.
const POST = { x: -60, z: -60 };

function teleportPlayer(sim: AnySim, x: number, z: number): void {
  const e = sim.player;
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = terrainHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
}

function spawnTestAlly(sim: AnySim, x = POST.x, z = POST.z) {
  return spawnAllyAt(sim.ctx, TEST_ALLY, 25, x, z, 0, {
    post: { x, y: 0, z },
    engageRadius: 30,
    moveTo: null,
  });
}

function spawnHostileNear(sim: AnySim, x: number, z: number) {
  const tplId = Object.keys(MOBS).find(
    (id) => MOBS[id].minLevel >= 20 && MOBS[id].minLevel <= 28 && !MOBS[id].allyOfPlayers,
  )!;
  const m = createMob(sim.ctx.nextId++, MOBS[tplId], 24, sim.ctx.groundPos(x, z));
  sim.ctx.addEntity(m);
  return m;
}

describe('world-owned ally substrate', () => {
  it('survives the hostility safety net: stays non-hostile across 100 ticks', () => {
    const sim = makeSim();
    const ally = spawnTestAlly(sim);
    for (let i = 0; i < 100; i++) sim.tick();
    expect(ally.hostile).toBe(false);
    expect(ally.dead).toBe(false);
  });

  it('is a real target: a threatening mob chases and kills it; no loot, no respawnMob', () => {
    const sim = makeSim();
    const ally = spawnTestAlly(sim);
    const mob = spawnHostileNear(sim, POST.x + 4, POST.z);
    mob.level = 40; // overwhelming, so the kill completes quickly
    addThreat(mob, ally.id, 50);
    mob.aggroTargetId = ally.id;
    mob.aiState = 'chase';
    mob.inCombat = true;
    for (let i = 0; i < 20 * 30 && !ally.dead; i++) sim.tick();
    expect(ally.dead).toBe(true);
    expect(ally.lootable ?? false).toBe(false);
    expect(ally.respawnTimer).toBe(Number.POSITIVE_INFINITY);
    expect(ally.corpseTimer).toBe(ALLY_CORPSE_SECONDS);
    expect(ally.hostile).toBe(false);
  });

  it('fights back: ally damage lands threat on the attacker', () => {
    const sim = makeSim();
    teleportPlayer(sim, POST.x - 6, POST.z);
    const ally = spawnTestAlly(sim);
    const mob = spawnHostileNear(sim, POST.x + 3, POST.z);
    // the mob is fighting the PLAYER (engaged), standing beside the ally
    (sim as AnySim).dealDamage(sim.player, mob, 5, false, 'physical', null, 'hit');
    for (let i = 0; i < 20 * 6; i++) sim.tick();
    expect(mob.threat.has(ally.id)).toBe(true);
  });

  it('is friendly to players: not attackable, heal-able', () => {
    const sim = makeSim();
    const ally = spawnTestAlly(sim);
    expect((sim as any).isHostileTo(sim.player, ally)).toBe(false);
    expect((sim as any).isFriendlyTo(sim.player, ally)).toBe(true);
  });

  it('leashes: dragged past the leash it abandons the fight and walks home', () => {
    const sim = makeSim();
    const ally = spawnTestAlly(sim);
    const mob = spawnHostileNear(sim, POST.x + ALLY_LEASH + 14, POST.z);
    addThreat(mob, ally.id, 50);
    mob.aggroTargetId = ally.id;
    // drag the ally out beside the mob, far past its leash
    ally.pos = sim.ctx.groundPos(POST.x + ALLY_LEASH + 12, POST.z);
    ally.prevPos = { ...ally.pos };
    (sim as AnySim).rebucket(ally);
    const before = Math.hypot(ally.pos.x - POST.x, ally.pos.z - POST.z);
    for (let i = 0; i < 20 * 4; i++) sim.tick();
    const after = Math.hypot(ally.pos.x - POST.x, ally.pos.z - POST.z);
    expect(after).toBeLessThan(before - 5); // walking home
    expect(ally.aggroTargetId).toBeNull();
  });

  it('is rng-draw-silent while idle (parity-critical)', () => {
    const countDraws = (withAlly: boolean): number => {
      const sim = makeSim();
      if (withAlly) spawnTestAlly(sim);
      let draws = 0;
      (sim as AnySim).rng.setObserver(() => {
        draws++;
      });
      for (let i = 0; i < 200; i++) sim.tick();
      (sim as AnySim).rng.setObserver(null);
      return draws;
    };
    expect(countDraws(true)).toBe(countDraws(false));
  });
});
