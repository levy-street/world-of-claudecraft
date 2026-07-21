import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

type TestSim = Sim & {
  nextId: number;
  addEntity(e: Entity): void;
  mobSwing(mob: Entity, target: Entity): void;
  moveSpeedMult(e: Entity): number;
  rng: {
    next(): number;
  };
};

function testSim(sim: Sim): TestSim {
  return sim as unknown as TestSim;
}

// Spawn a Stormcrag Elemental and register it with the sim.
function spawnElemental(sim: Sim): Entity {
  const inner = testSim(sim);
  const mob = createMob(inner.nextId++, MOBS.stormcrag_elemental, 18, { x: 0, y: 0, z: 0 });
  mob.hostile = true;
  mob.hp = mob.maxHp;
  inner.addEntity(mob);
  return mob;
}

function placePlayer(sim: Sim, pid: number, x: number, z: number): Entity {
  const e = sim.entities.get(pid);
  if (!e) throw new Error(`Missing player entity ${pid}`);
  e.pos = { x, y: 0, z };
  e.prevPos = { ...e.pos };
  e.maxHp = 100000;
  e.hp = 100000;
  return e;
}

function landedSwing(sim: Sim, mob: Entity, target: Entity) {
  const inner = testSim(sim);
  const rng = inner.rng;
  const realNext = rng.next.bind(rng);
  let firstRoll = true;
  rng.next = () => {
    if (firstRoll) {
      firstRoll = false;
      return 0.999;
    }
    return 0.5;
  };
  try {
    inner.mobSwing(mob, target);
  } finally {
    rng.next = realNext;
  }
}

describe('mob chill-on-hit', () => {
  it('the Stormcrag Elemental template carries a Numbing Chill proc', () => {
    expect(MOBS.stormcrag_elemental.chillOnHit).toMatchObject({
      chance: 0.35,
      mult: 0.5,
      duration: 6,
      name: 'Numbing Chill',
    });
  });

  it('a landed swing can apply a movement-slowing chill to the victim', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Frostbit');
    const victim = placePlayer(sim, pid, 1, 0);
    const elemental = spawnElemental(sim);

    const baseSpeed = testSim(sim).moveSpeedMult(victim);
    expect(baseSpeed).toBe(1);

    const chill = MOBS.stormcrag_elemental.chillOnHit;
    if (!chill) throw new Error('Stormcrag elemental must have chillOnHit');
    const originalChance = chill.chance;
    chill.chance = 1;
    landedSwing(sim, elemental, victim);
    chill.chance = originalChance;
    expect(victim.auras.some((a) => a.kind === 'slow' && a.name === 'Numbing Chill')).toBe(true);

    const aura = victim.auras.find((a) => a.name === 'Numbing Chill');
    if (!aura) throw new Error('Missing Numbing Chill aura');
    expect(aura.kind).toBe('slow');
    expect(aura.school).toBe('frost');
    expect(aura.value).toBe(0.5);
    // the slow aura actually drags movement down through the shared path
    expect(testSim(sim).moveSpeedMult(victim)).toBe(0.5);
  });

  it('an ordinary mob with no chill field never applies the slow', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Safe');
    const victim = placePlayer(sim, pid, 1, 0);
    const inner = testSim(sim);
    const wolf = createMob(inner.nextId++, MOBS.forest_wolf, 3, { x: 0, y: 0, z: 0 });
    wolf.hostile = true;
    wolf.hp = wolf.maxHp;
    inner.addEntity(wolf);

    for (let i = 0; i < 200; i++) inner.mobSwing(wolf, victim);
    expect(victim.auras.some((a) => a.kind === 'slow')).toBe(false);
  });
});
