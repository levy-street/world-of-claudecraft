import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';

// Spawn a fresh Knight-Commander Olen (the seeded cleaver) at the origin and
// register it with the sim. Returns the live entity.
function spawnOlen(sim: Sim): Entity {
  const mob = createMob((sim as any).nextId++, MOBS.knight_commander_olen, 13, {
    x: 0,
    y: 0,
    z: 0,
  });
  mob.hostile = true;
  mob.hp = mob.maxHp;
  (sim as any).addEntity(mob);
  return mob;
}

function spawnSexton(sim: Sim): Entity {
  const mob = createMob((sim as any).nextId++, MOBS.sexton_marrow, 9, {
    x: 0,
    y: 0,
    z: 0,
  });
  mob.hostile = true;
  mob.hp = mob.maxHp;
  (sim as any).addEntity(mob);
  return mob;
}

// Place a player's entity at a position (pos.y matched to the mob's so dist2d is
// the planar distance) and give it enough HP to survive a cleave splash.
function placePlayer(sim: Sim, pid: number, x: number, z: number): Entity {
  const e = sim.entities.get(pid)!;
  e.pos = { x, y: 0, z };
  e.prevPos = { ...e.pos };
  e.maxHp = 5000;
  e.hp = 5000;
  return e;
}

describe('mob cleave', () => {
  it('Knight-Commander Olen is seeded with the Cleave mechanic', () => {
    expect(MOBS.knight_commander_olen.cleave).toEqual({
      radius: 8,
      mult: 0.6,
      name: 'Reaping Arc',
    });
  });

  it('Sexton Marrow is seeded with a readable tank-facing cleave', () => {
    expect(MOBS.sexton_marrow.cleave).toEqual({
      radius: 8,
      mult: 0.55,
      name: 'Bone Saw',
      angle: Math.PI / 3,
    });
  });

  it('a landed swing splashes onto a second player near the primary target', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const main = sim.addPlayer('warrior', 'Tank');
    const near = sim.addPlayer('warrior', 'Cleaved');
    const olen = spawnOlen(sim);
    const mainE = placePlayer(sim, main, 0, 2); // primary target, in melee
    const nearE = placePlayer(sim, near, 1, 4); // in front, within radius 8
    olen.facing = 0;

    const events: SimEvent[] = [];
    const origEmit = (sim as any).emit.bind(sim);
    (sim as any).emit = (ev: SimEvent) => {
      events.push(ev);
      return origEmit(ev);
    };

    // Force a guaranteed hit rather than relying on the swing RNG.
    for (let i = 0; i < 50; i++) {
      events.length = 0;
      (sim as any).mobSwing(olen, mainE);
      const dmg = events.filter((e) => e.type === 'damage') as any[];
      const splash = dmg.find((e) => e.targetId === nearE.id && e.amount > 0);
      if (splash) {
        expect(splash.ability).toBe('Reaping Arc');
        return; // a hit landed and cleaved — done
      }
    }
    throw new Error('expected a cleave splash within 50 swings');
  });

  it('does not splash onto a player outside the cleave radius', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });
    const main = sim.addPlayer('warrior', 'Tank');
    const far = sim.addPlayer('warrior', 'Safe');
    const olen = spawnOlen(sim);
    const mainE = placePlayer(sim, main, 0, 2);
    const farE = placePlayer(sim, far, 0, 40); // well beyond radius 8
    olen.facing = 0;

    const events: SimEvent[] = [];
    const origEmit = (sim as any).emit.bind(sim);
    (sim as any).emit = (ev: SimEvent) => {
      events.push(ev);
      return origEmit(ev);
    };

    for (let i = 0; i < 50; i++) (sim as any).mobSwing(olen, mainE);
    const splash = (events.filter((e) => e.type === 'damage') as any[]).find(
      (e) => e.targetId === farE.id && e.amount > 0,
    );
    expect(splash).toBeUndefined();
  });

  it('uses mob facing so a tank-facing cleave does not hit players behind the boss', () => {
    const sim = new Sim({ seed: 9, playerClass: 'warrior', noPlayer: true });
    const main = sim.addPlayer('warrior', 'Tank');
    const front = sim.addPlayer('warrior', 'Front');
    const behind = sim.addPlayer('warrior', 'Behind');
    const sexton = spawnSexton(sim);
    const mainE = placePlayer(sim, main, 0, 2);
    const frontE = placePlayer(sim, front, 1, 3);
    const behindE = placePlayer(sim, behind, 0, -2);
    sexton.facing = 0;

    const events: SimEvent[] = [];
    const origEmit = (sim as any).emit.bind(sim);
    (sim as any).emit = (ev: SimEvent) => {
      events.push(ev);
      return origEmit(ev);
    };

    for (let i = 0; i < 50; i++) {
      events.length = 0;
      (sim as any).mobSwing(sexton, mainE);
      const dmg = events.filter((e) => e.type === 'damage') as any[];
      const frontHit = dmg.find((e) => e.targetId === frontE.id && e.ability === 'Bone Saw');
      if (frontHit) {
        const behindHit = dmg.find((e) => e.targetId === behindE.id && e.ability === 'Bone Saw');
        expect(behindHit).toBeUndefined();
        return;
      }
    }
    throw new Error('expected Sexton Marrow to cleave a player in front within 50 swings');
  });

  it('a non-cleaving mob does not splash', () => {
    const sim = new Sim({ seed: 1, playerClass: 'warrior', noPlayer: true });
    const main = sim.addPlayer('warrior', 'Tank');
    const near = sim.addPlayer('warrior', 'Bystander');
    // A plain wolf has no cleave field.
    const wolf = createMob((sim as any).nextId++, MOBS.forest_wolf, 5, { x: 0, y: 0, z: 0 });
    wolf.hostile = true;
    wolf.hp = wolf.maxHp;
    (sim as any).addEntity(wolf);
    const mainE = placePlayer(sim, main, 1, 0);
    const nearE = placePlayer(sim, near, 1, 2);

    const events: SimEvent[] = [];
    const origEmit = (sim as any).emit.bind(sim);
    (sim as any).emit = (ev: SimEvent) => {
      events.push(ev);
      return origEmit(ev);
    };

    for (let i = 0; i < 50; i++) (sim as any).mobSwing(wolf, mainE);
    const splash = (events.filter((e) => e.type === 'damage') as any[]).find(
      (e) => e.targetId === nearE.id && e.amount > 0,
    );
    expect(splash).toBeUndefined();
  });
});
