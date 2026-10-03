// Dungeon patrols (src/sim/mob/patrol.ts): the loop math, the walk through a
// real Hollow Crypt claim (the c2 skeleton squad circles the ossuary monument), the
// pull from a patrol, and determinism.

import { describe, expect, it } from 'vitest';
import { BUILTIN_WORLD, DUNGEONS, instanceOrigin } from '../src/sim/data';
import { enterDungeon } from '../src/sim/instances/dungeons';
import { patrolLoopLength, patrolPointAt, stampDungeonPatrol } from '../src/sim/mob/patrol';
import type { InstanceSlot } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { Entity, WorldContent } from '../src/sim/types';

const WORLD: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };
const SQUARE = [
  { x: 0, z: 0 },
  { x: 10, z: 0 },
  { x: 10, z: 10 },
  { x: 0, z: 10 },
];

describe('patrol loop math', () => {
  it('measures and walks a closed loop, wrapping past the end', () => {
    expect(patrolLoopLength(SQUARE)).toBe(40);
    expect(patrolPointAt(SQUARE, 5)).toMatchObject({ x: 5, z: 0 });
    expect(patrolPointAt(SQUARE, 15)).toMatchObject({ x: 10, z: 5 });
    expect(patrolPointAt(SQUARE, 45)).toMatchObject({ x: 5, z: 0 });
    expect(patrolPointAt(SQUARE, -5)).toMatchObject({ x: 0, z: 5 });
    // Heading follows the segment (sim convention: 0 faces +z).
    expect(patrolPointAt(SQUARE, 15).facing).toBeCloseTo(0);
    expect(patrolPointAt(SQUARE, 5).facing).toBeCloseTo(Math.PI / 2);
  });

  it('stamps a spawn loop into world space with its offset and pace', () => {
    const stamp = stampDungeonPatrol({ points: SQUARE, offset: 3 }, 100, -50);
    expect(stamp.points[2]).toEqual({ x: 110, z: -40 });
    expect(stamp.offset).toBe(3);
    expect(stamp.pace).toBeGreaterThan(0);
  });
});

function claim(seed: number): { sim: Sim; pid: number; inst: InstanceSlot } {
  const sim = new Sim({ seed, playerClass: 'warrior', noPlayer: true, world: WORLD });
  const pid = sim.addPlayer('warrior', 'Watcher');
  expect(enterDungeon(sim.ctx, 'hollow_crypt', pid)).toBe(true);
  const inst = sim.ctx.instances.find(
    (i) => i.dungeonId === 'hollow_crypt' && i.partyKey !== null,
  ) as InstanceSlot;
  return { sim, pid, inst };
}

function p2(sim: Sim, inst: InstanceSlot): Entity[] {
  return DUNGEONS.hollow_crypt.spawns
    .map((s, i) => (s.packId === 'c2' ? (sim.ctx.entities.get(inst.mobIds[i]) as Entity) : null))
    .filter((e): e is Entity => e !== null);
}

describe('the monument patrol (c2) in a live claim', () => {
  it('walks the monument loop while idle and stays on it', () => {
    const { sim, inst } = claim(5);
    const [lead] = p2(sim, inst);
    expect(lead.dungeonPatrol?.points.length).toBe(4);
    const o = instanceOrigin(DUNGEONS.hollow_crypt.index, inst.slot);
    const seen = new Set<string>();
    for (let t = 0; t < 20 * 40; t++) {
      sim.tick();
      if (t % 20 === 0) {
        const lx = lead.pos.x - o.x;
        const lz = lead.pos.z - o.z;
        seen.add(`${Math.sign(Math.round(lx / 8))},${Math.sign(Math.round((lz + 30) / 8))}`);
        // Never strays far from the square loop around the monument.
        expect(Math.max(Math.abs(lx), Math.abs(lz + 30))).toBeLessThan(20);
      }
    }
    expect(lead.aiState).toBe('idle');
    // It visited more than one side of the monument.
    expect(seen.size).toBeGreaterThanOrEqual(3);
  });

  it('a player who walks into the patrol pulls the whole pack', () => {
    const { sim, pid, inst } = claim(6);
    const [a, b] = p2(sim, inst);
    const player = sim.ctx.entities.get(pid) as Entity;
    player.pos = { ...a.pos };
    player.prevPos = { ...player.pos };
    sim.rebucket(player);
    for (let t = 0; t < 10; t++) sim.tick();
    expect(a.aiState === 'chase' || a.aiState === 'attack').toBe(true);
    expect(b.aiState === 'chase' || b.aiState === 'attack').toBe(true);
  });

  it('is deterministic: one seed walks the same path', () => {
    const run = (): number[] => {
      const { sim, inst } = claim(9);
      for (let t = 0; t < 200; t++) sim.tick();
      return p2(sim, inst).flatMap((e) => [e.pos.x, e.pos.z]);
    };
    expect(run()).toEqual(run());
  });
});
