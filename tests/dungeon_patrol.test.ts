// Dungeon patrols (src/sim/mob/patrol.ts): the loop math, the walk through a
// real Hollow Crypt claim (the c2 skeleton squad circles the ossuary monument), the
// pull from a patrol, and determinism.

import { describe, expect, it } from 'vitest';
import { BUILTIN_WORLD, DUNGEONS, instanceOrigin } from '../src/sim/data';
import { enterDungeon } from '../src/sim/instances/dungeons';
import { patrolLoopLength, patrolPointAt, stampDungeonPatrol } from '../src/sim/mob/patrol';
import {
  LOOP_REJOIN_OFFSET,
  LOOP_ROUTE_LOOKAHEAD,
  loopRouteTarget,
  projectOntoLoop,
  shuttleLoop,
} from '../src/sim/mob/patrol_route';
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

describe('patrol routing along the loop (mob/patrol_route.ts)', () => {
  it('projects a body onto its loop with the arc length of its foot', () => {
    expect(projectOntoLoop(SQUARE, 5, -2)).toMatchObject({ s: 5, x: 5, z: 0, d: 2 });
    expect(projectOntoLoop(SQUARE, 12, 7)).toMatchObject({ s: 17, x: 10, z: 7, d: 2 });
    // An out-and-back loop resolves to its outbound leg.
    const out = [
      { x: 0, z: 0 },
      { x: 10, z: 0 },
    ];
    expect(projectOntoLoop(out, 4, 0).s).toBe(4);
  });

  it('steers back onto the loop first, then along it the shorter way, never past the goal', () => {
    // Off the loop: straight to its foot.
    expect(loopRouteTarget(SQUARE, 5, -3, 30)).toEqual({ x: 5, z: 0 });
    // On it, the goal ahead: a lookahead step forward.
    const fwd = loopRouteTarget(SQUARE, 2, 0, 9);
    expect(fwd.x).toBeCloseTo(2 + LOOP_ROUTE_LOOKAHEAD, 9);
    expect(fwd.z).toBeCloseTo(0, 9);
    // The goal just behind: back along the loop, not the long way round.
    const back = loopRouteTarget(SQUARE, 2, 0, 39);
    expect(back.x).toBeCloseTo(0, 9);
    expect(back.z).toBeCloseTo(1, 9);
    // The goal nearer than the lookahead: no overshoot.
    expect(loopRouteTarget(SQUARE, 2, 0, 3.5)).toMatchObject({ x: 3.5, z: 0 });
    expect(LOOP_REJOIN_OFFSET).toBeGreaterThan(0);
  });

  it('builds an out-and-back as a closed racetrack: two lanes, a half-circle at each end', () => {
    const loop = shuttleLoop(
      [
        { x: 0, z: 0 },
        { x: 0, z: 20 },
      ],
      2,
      4,
      0.5,
    );
    const xs = loop.map((p) => p.x);
    const zs = loop.map((p) => p.z);
    // Two lanes 2 yd either side, the turns bulging 2 yd past each end.
    expect(Math.min(...xs)).toBeCloseTo(-2, 6);
    expect(Math.max(...xs)).toBeCloseTo(2, 6);
    expect(Math.min(...zs)).toBeCloseTo(-2, 1);
    expect(Math.max(...zs)).toBeCloseTo(22, 1);
    // Never a sharp turn, never a jump.
    for (let i = 0; i < loop.length; i++) {
      const a = loop[(i + loop.length - 1) % loop.length];
      const b = loop[i];
      const c = loop[(i + 1) % loop.length];
      expect(Math.hypot(c.x - b.x, c.z - b.z)).toBeLessThan(20.01);
      let d = Math.abs(Math.atan2(c.x - b.x, c.z - b.z) - Math.atan2(b.x - a.x, b.z - a.z));
      d %= Math.PI * 2;
      if (d > Math.PI) d = Math.PI * 2 - d;
      expect(d).toBeLessThan(0.45);
    }
    // A corner rounds on two arcs concentric with the centre line's fillet
    // (radius 5 round (5, 15) here): the inner lane on 3, the outer on 7.
    const bent = shuttleLoop(
      [
        { x: 0, z: 0 },
        { x: 0, z: 20 },
        { x: 20, z: 20 },
      ],
      2,
      5,
      0.5,
    );
    let onArc = 0;
    for (const p of bent) {
      if (p.x > 5 || p.z < 15 || p.z > 22.5) continue;
      const r = Math.hypot(p.x - 5, p.z - 15);
      expect(Math.min(Math.abs(r - 3), Math.abs(r - 7))).toBeLessThan(0.02);
      onArc++;
    }
    expect(onArc).toBeGreaterThan(8);
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

  it('a claim made hours into the clock starts every walker ON its patrol point', () => {
    const sim = new Sim({ seed: 8, playerClass: 'warrior', noPlayer: true, world: WORLD });
    (sim as unknown as { time: number }).time = 7777.7;
    const pid = sim.addPlayer('warrior', 'Late');
    expect(enterDungeon(sim.ctx, 'hollow_crypt', pid)).toBe(true);
    const inst = sim.ctx.instances.find(
      (i) => i.dungeonId === 'hollow_crypt' && i.partyKey !== null,
    ) as InstanceSlot;
    const walkers = p2(sim, inst);
    expect(walkers.length).toBeGreaterThan(1);
    for (const m of walkers) {
      const st = m.dungeonPatrol;
      if (!st) throw new Error('no patrol');
      const want = patrolPointAt(st.points, sim.ctx.time * m.moveSpeed * st.pace + st.offset);
      expect(Math.hypot(m.pos.x - want.x, m.pos.z - want.z)).toBeLessThan(0.05);
      expect(m.spawnPos.x).toBeCloseTo(m.pos.x, 6);
    }
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
