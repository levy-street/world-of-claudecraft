import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { spawnNythraxisAdds } from '../src/sim/encounters/nythraxis';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

// Boss-summoned adds spawn seeded on the boss's current target (the tank) with
// a REAL threat lead, not a token one. The old seed was 1 point: the healer's
// first heal on the tank (healing threat splits to every mob aware of the
// healed target) out-threatened it instantly, so every summon wave beelined
// the healer, whose cloth pool a single add swing one-shots. With a 750 seed
// the tank holds the wave through normal healing, while sustained focus fire
// from DPS can still legitimately rip an add loose (taunt and tank threat
// answer it, the classic dance).

const SEED = 4242;

function setup() {
  const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
  const tankPid = sim.addPlayer('warrior', 'Tank');
  sim.setPlayerLevel(20, tankPid);
  const tank = sim.entities.get(tankPid)!;
  tank.maxHp = 1e7;
  tank.hp = 1e7;
  const boss = createMob(sim.nextId++, MOBS.vael_the_mistcaller, 20, {
    x: tank.pos.x + 2,
    y: tank.pos.y,
    z: tank.pos.z,
  });
  boss.hostile = true;
  (sim as unknown as { addEntity(e: Entity): void }).addEntity(boss);
  boss.inCombat = true;
  boss.aiState = 'attack';
  boss.aggroTargetId = tankPid;
  boss.threat.set(tankPid, 5000);
  (sim as unknown as { spawnBossAdds(b: Entity, id: string, n: number): void }).spawnBossAdds(
    boss,
    'drowned_thrall',
    2,
  );
  const adds = [...sim.entities.values()].filter(
    (e) => e.kind === 'mob' && e.templateId === 'drowned_thrall' && !e.dead,
  );
  expect(adds).toHaveLength(2);
  return { sim, tankPid, tank, boss, adds };
}

describe('summon threat seeding', () => {
  it('the raid script waves carry the same seed as spawnBossAdds', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    const tankPid = sim.addPlayer('warrior', 'Tank');
    sim.setPlayerLevel(20, tankPid);
    const tank = sim.entities.get(tankPid)!;
    tank.maxHp = 1e7;
    tank.hp = 1e7;
    const boss = createMob(sim.nextId++, MOBS.nythraxis_scourge_of_thornpeak, 20, {
      x: tank.pos.x + 2,
      y: tank.pos.y,
      z: tank.pos.z,
    });
    boss.hostile = true;
    (sim as unknown as { addEntity(e: Entity): void }).addEntity(boss);
    boss.inCombat = true;
    boss.aiState = 'attack';
    boss.aggroTargetId = tankPid;
    boss.threat.set(tankPid, 5000);
    spawnNythraxisAdds(sim.ctx, boss);
    const adds = [...sim.entities.values()].filter(
      (e) => e.kind === 'mob' && e.templateId === 'nythraxis_skeleton_warrior' && !e.dead,
    );
    expect(adds.length).toBeGreaterThan(0);
    for (const add of adds) {
      expect(add.aggroTargetId).toBe(tankPid);
      expect(add.threat.get(tankPid)).toBe(750);
    }
  });

  it('seeds the tank with a 750 lead, not a token point', () => {
    const { tankPid, adds } = setup();
    for (const add of adds) {
      expect(add.aggroTargetId).toBe(tankPid);
      expect(add.threat.get(tankPid)).toBe(750);
    }
  });

  it('the healer freely heals through a summon wave without peeling it', () => {
    const { sim, tankPid, tank, adds } = setup();
    const healerPid = sim.addPlayer('priest', 'Healer');
    sim.setPlayerLevel(20, healerPid);
    const healer = sim.entities.get(healerPid)!;
    healer.maxHp = 1e7;
    healer.hp = 1e7;
    teleportNear(sim, healerPid, tank);
    // A wounded tank and ten seconds of real healing: the threat the heals
    // generate on the adds must stay under the tank's seed.
    for (let i = 0; i < 20 * 10; i++) {
      tank.hp = Math.round(tank.maxHp * 0.5);
      const h = sim.entities.get(healerPid)!;
      if (!h.castingAbility) {
        h.targetId = tankPid;
        sim.castAbility('flash_heal', healerPid);
      }
      h.resource = h.maxResource;
      sim.tick();
    }
    for (const add of adds) {
      expect(add.aggroTargetId, 'add peeled onto a non-tank').toBe(tankPid);
    }
  });

  it('sustained focus fire still rips an add off an idle tank', () => {
    const { sim, tankPid, adds } = setup();
    const magePid = sim.addPlayer('mage', 'Mage');
    sim.setPlayerLevel(20, magePid);
    const mage = sim.entities.get(magePid)!;
    mage.maxHp = 1e7;
    mage.hp = 1e7;
    mage.spellPower = 300; // a geared mage: the rip must be reachable, not instant
    const target = adds[0];
    target.maxHp = 1e7; // keep it alive long enough to measure the turn
    target.hp = 1e7;
    teleportNear(sim, magePid, target);
    for (let i = 0; i < 20 * 20 && target.aggroTargetId === tankPid; i++) {
      const m = sim.entities.get(magePid)!;
      if (!m.castingAbility) {
        m.targetId = target.id;
        m.facing = Math.atan2(target.pos.x - m.pos.x, target.pos.z - m.pos.z);
        m.prevFacing = m.facing;
        sim.castAbility('fireball', magePid);
      }
      m.resource = m.maxResource;
      sim.tick();
    }
    expect(target.aggroTargetId).toBe(magePid);
  });
});

function teleportNear(sim: Sim, pid: number, near: Entity) {
  const e = sim.entities.get(pid)!;
  e.pos.x = near.pos.x + 3;
  e.pos.z = near.pos.z + 3;
  e.pos.y = near.pos.y;
  e.prevPos = { ...e.pos };
}
