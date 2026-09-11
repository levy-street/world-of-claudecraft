// NPC waypoint patrol routes (src/sim/npc_routes.ts): routed NPCs walk their
// authored waypoints (loop or pingpong), pause at waypoints that declare a
// wait, and routeless NPCs stay put. The whole system draws zero rng, so two
// same-seed sims stay in lockstep.
import { describe, expect, it } from 'vitest';
import { BUILTIN_WORLD } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import {
  dist2d,
  type Entity,
  type NpcDef,
  type NpcRoute,
  type WorldContent,
} from '../src/sim/types';

const SEED = 42;

// Open meadow west of the player start: flat, above the waterline, and clear of
// the town props, so patrol legs are unobstructed. Moved out here in the v0.31
// merge: the Eastbrook rebuild dropped the Grand Armoury footprint (17.5, -5.5,
// 13x9) across the old x 10..22, z -10 leg, so the walker collided mid-route.
const A = { x: -60, z: -45 };
const B = { x: -54, z: -45 };
const C = { x: -48, z: -45 };

function npcDef(id: string, route?: NpcRoute): NpcDef {
  return {
    id,
    name: 'Patrol Tester',
    title: 'Test Walker',
    pos: { x: A.x, z: A.z },
    facing: 0,
    color: 0xffffff,
    questIds: [],
    greeting: 'Just walking my rounds.',
    route,
  };
}

// Camps and ground objects stripped so the only moving entity is the NPC under
// test (mirrors the wolves-only world idiom in fixes_loot_npcs.test.ts).
function makeSim(npcs: Record<string, NpcDef>, seed = SEED): Sim {
  const world: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs, groundObjects: [] };
  return new Sim({ seed, playerClass: 'warrior', world });
}

function npcByTemplate(sim: Sim, templateId: string): Entity {
  const npc = [...sim.entities.values()].find(
    (e) => e.kind === 'npc' && e.templateId === templateId,
  );
  expect(npc, `npc ${templateId} spawned`).toBeDefined();
  return npc as Entity;
}

describe('npc waypoint patrol routes', () => {
  it('walks a loop route toward the next waypoint over ticks', () => {
    const sim = makeSim({
      walker: npcDef('walker', { points: [A, B], mode: 'loop', speed: 3 }),
    });
    const npc = npcByTemplate(sim, 'walker');
    const start = { x: npc.pos.x, z: npc.pos.z };
    const d0 = dist2d(npc.pos, { x: B.x, y: 0, z: B.z });

    for (let i = 0; i < 20; i++) sim.tick(); // 1 second at 3 yd/s

    const d1 = dist2d(npc.pos, { x: B.x, y: 0, z: B.z });
    expect(dist2d(npc.pos, { x: start.x, y: 0, z: start.z })).toBeGreaterThan(1);
    expect(d1).toBeLessThan(d0 - 1);

    // Given a few more seconds it closes on the waypoint itself.
    let closest = d1;
    for (let i = 0; i < 20 * 6; i++) {
      sim.tick();
      closest = Math.min(closest, dist2d(npc.pos, { x: B.x, y: 0, z: B.z }));
    }
    expect(closest).toBeLessThan(1);
  });

  it('pauses about wait seconds at a waypoint before moving on', () => {
    const sim = makeSim({
      pauser: npcDef('pauser', {
        points: [A, { x: B.x, z: B.z, wait: 1 }],
        mode: 'loop',
        speed: 3,
      }),
    });
    const npc = npcByTemplate(sim, 'pauser');

    // Walk until the sim registers the arrival at B and arms the pause
    // (generous ceiling; terrain slides allowed).
    let arrived = false;
    for (let i = 0; i < 20 * 20 && !arrived; i++) {
      sim.tick();
      arrived = (npc.routeWaitLeft ?? 0) > 0;
    }
    expect(arrived).toBe(true);
    expect(dist2d(npc.pos, { x: B.x, y: 0, z: B.z })).toBeLessThan(0.5);

    // Count how many ticks it holds position before setting off again.
    let still = 0;
    for (let i = 0; i < 20 * 5; i++) {
      const before = { x: npc.pos.x, z: npc.pos.z };
      sim.tick();
      const moved = Math.abs(npc.pos.x - before.x) > 1e-6 || Math.abs(npc.pos.z - before.z) > 1e-6;
      if (moved) break;
      still++;
    }
    // wait: 1 is 20 ticks; allow slack for the arrival tick bookkeeping.
    expect(still).toBeGreaterThanOrEqual(15);
    expect(still).toBeLessThanOrEqual(30);
  });

  it('pingpong reverses direction at the last waypoint', () => {
    const sim = makeSim({
      bouncer: npcDef('bouncer', { points: [A, B, C], mode: 'pingpong', speed: 4 }),
    });
    const npc = npcByTemplate(sim, 'bouncer');

    // Walk out to the far end (C is the max-x point of the line) until the
    // sim's own arrival flips the walk direction.
    let maxX = npc.pos.x;
    let flipped = false;
    for (let i = 0; i < 20 * 30 && !flipped; i++) {
      sim.tick();
      maxX = Math.max(maxX, npc.pos.x);
      flipped = npc.routeDir === -1;
    }
    expect(flipped).toBe(true);
    expect(dist2d(npc.pos, { x: C.x, y: 0, z: C.z })).toBeLessThan(0.6);

    // It now walks back toward B, not past C.
    for (let i = 0; i < 20 * 3; i++) sim.tick();
    expect(npc.pos.x).toBeLessThan(maxX - 1);
  });

  it('loop wraps back to waypoint 0', () => {
    const sim = makeSim({
      looper: npcDef('looper', { points: [A, B], mode: 'loop', speed: 4 }),
    });
    const npc = npcByTemplate(sim, 'looper');

    let visitedB = false;
    let returnedToA = false;
    for (let i = 0; i < 20 * 30 && !returnedToA; i++) {
      sim.tick();
      if (!visitedB) {
        visitedB = dist2d(npc.pos, { x: B.x, y: 0, z: B.z }) < 0.4;
      } else {
        returnedToA = dist2d(npc.pos, { x: A.x, y: 0, z: A.z }) < 1;
      }
    }
    expect(visitedB).toBe(true);
    expect(returnedToA).toBe(true);
  });

  it('an NPC without a route never moves', () => {
    const sim = makeSim({ sitter: npcDef('sitter') });
    const npc = npcByTemplate(sim, 'sitter');
    const start = { x: npc.pos.x, z: npc.pos.z };

    for (let i = 0; i < 100; i++) sim.tick();

    expect(npc.pos.x).toBe(start.x);
    expect(npc.pos.z).toBe(start.z);
    expect(npc.routeIdx).toBeUndefined();
  });

  it('same seed and content give identical NPC positions (determinism)', () => {
    const run = (): { x: number; z: number }[] => {
      const sim = makeSim({
        walker: npcDef('walker', {
          points: [A, { x: B.x, z: B.z, wait: 0.5 }, C],
          mode: 'pingpong',
          speed: 3,
        }),
      });
      for (let i = 0; i < 300; i++) sim.tick();
      return [...sim.entities.values()]
        .filter((e) => e.kind === 'npc')
        .map((e) => ({ x: e.pos.x, z: e.pos.z }));
    };
    expect(run()).toEqual(run());
  });
});
