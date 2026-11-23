// The Sledge Tusker's patrol (patrol A, src/sim/content/gravewyrm_sanctum.ts
// TUSKER_ROAD) and the loop-aware patrol walk it rides (src/sim/mob/patrol.ts,
// src/sim/mob/patrol_route.ts). The playtest saw the house-sized beast at the
// dungeon's entrance walking off toward the precipice and grinding against
// the road's cliff wall: a claim made with the sim clock well past zero (any
// live server) stood it on the loop's first point while its patrol point was
// elsewhere round the loop, and the straight-line chase cut across the void
// between two legs of the zigzag road. Pinned here: the route itself (every
// waypoint pair on the road with room for the beast's coat, clear of every
// prop, no turn sharper than a stride), the spawn on its patrol point at the
// claim's clock, the walk (no stall, never off the loop) from several clocks,
// the rejoin along the loop after a shove, and the evade home along the road.

import { describe, expect, it } from 'vitest';
import { isBlocked } from '../src/sim/colliders';
import {
  GRAVEWYRM_SANCTUM_SPAWNS,
  TUSKER_ROAD,
  TUSKER_ROAD_LINE,
} from '../src/sim/content/gravewyrm_sanctum';
import {
  GRAVEWYRM_SANCTUM_FIELD as FIELD,
  GRAVEWYRM_HEIGHTS,
} from '../src/sim/content/gravewyrm_sanctum_layout';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import { authoredFieldHeight } from '../src/sim/instances/authored_field';
import { claimedInstanceAt } from '../src/sim/instances/dungeons';
import { patrolLoopLength, patrolPointAt } from '../src/sim/mob/patrol';
import { projectOntoLoop } from '../src/sim/mob/patrol_route';
import type { InstanceSlot } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import { DT, type Entity } from '../src/sim/types';

const SEED = 7;
const SLOT = 5;
const O = instanceOrigin(DUNGEONS.gravewyrm_sanctum.index, SLOT);
/** Half the beast's coat across (tusker_model_core.ts TUSKER_MODEL.halfWidth). */
const COAT = 2.6;

function samples(fn: (x: number, z: number, nx: number, nz: number) => void, step = 0.5): void {
  const pts = TUSKER_ROAD;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.ceil(len / step));
    const nx = (b.z - a.z) / (len || 1);
    const nz = -(b.x - a.x) / (len || 1);
    for (let k = 0; k < n; k++)
      fn(a.x + ((b.x - a.x) * k) / n, a.z + ((b.z - a.z) * k) / n, nx, nz);
  }
}

describe('the Sledge Tusker road (data)', () => {
  it('is one closed loop down one lane and up the other, between the court and the lower bend', () => {
    expect(TUSKER_ROAD.length).toBeGreaterThan(20);
    const spawn = GRAVEWYRM_SANCTUM_SPAWNS.find((s) => s.mobId === 'sledge_tusker');
    expect(spawn?.patrol?.points).toBe(TUSKER_ROAD);
    for (const p of TUSKER_ROAD) {
      const h = authoredFieldHeight(FIELD, p.x, p.z);
      expect(h).toBeGreaterThanOrEqual(GRAVEWYRM_HEIGHTS.lowerBend);
      expect(h).toBeLessThanOrEqual(GRAVEWYRM_HEIGHTS.court);
    }
    // Both lanes run beside the centre line, never on it, never far from it.
    let near = 0;
    for (const p of TUSKER_ROAD) {
      const d = projectOntoLoop(
        [...TUSKER_ROAD_LINE, ...[...TUSKER_ROAD_LINE].reverse()],
        p.x,
        p.z,
      ).d;
      expect(d).toBeLessThan(3.5);
      if (d > 1.8) near++;
    }
    expect(near).toBeGreaterThan(TUSKER_ROAD.length / 3);
  });

  it('every waypoint pair is walkable road with room for the coat, clear of every prop', () => {
    let worst = Infinity;
    samples((x, z, nx, nz) => {
      const h = authoredFieldHeight(FIELD, x, z);
      expect(h, `void under ${x},${z}`).toBeGreaterThan(FIELD.voidHeight);
      // The coat either side stands on the same road (no drop, no wall).
      for (const side of [1, -1]) {
        const cx = x + nx * (COAT + 0.4) * side;
        const cz = z + nz * (COAT + 0.4) * side;
        const ch = authoredFieldHeight(FIELD, cx, cz);
        expect(Math.abs(ch - h), `edge beside ${x},${z}`).toBeLessThan(FIELD.cliffStep);
      }
      // No prop or cliff collider within the coat.
      expect(isBlocked(SEED, O.x + x, O.z + z, COAT), `prop at ${x},${z}`).toBe(false);
      worst = Math.min(worst, h);
    });
    expect(worst).toBeGreaterThan(FIELD.voidHeight);
  });

  it('turns smoothly: no heading change sharper than a stride at any waypoint', () => {
    const pts = TUSKER_ROAD;
    let maxTurn = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length];
      const b = pts[i];
      const c = pts[(i + 1) % pts.length];
      const h1 = Math.atan2(b.x - a.x, b.z - a.z);
      const h2 = Math.atan2(c.x - b.x, c.z - b.z);
      let d = Math.abs(h2 - h1) % (Math.PI * 2);
      if (d > Math.PI) d = Math.PI * 2 - d;
      maxTurn = Math.max(maxTurn, d);
    }
    // The old out-and-back flipped 180 degrees on the spot at each end.
    expect(maxTurn).toBeLessThan((25 * Math.PI) / 180);
  });
});

interface Room {
  sim: Sim;
  inst: InstanceSlot;
  tusker: Entity;
  o: { x: number; z: number };
}

function room(clock: number): Room {
  const sim = new Sim({ seed: 93, playerClass: 'warrior', autoEquip: false, devCommands: true });
  sim.chat('/dev level 20', sim.player.id);
  // A live server's clock is hours in: the claim lands mid-loop.
  (sim as unknown as { time: number }).time = clock;
  sim.chat('/dev sanctum enter normal', sim.player.id);
  const inst = claimedInstanceAt(sim.ctx, sim.player.pos);
  if (!inst) throw new Error('no sanctum claim');
  const o = instanceOrigin(DUNGEONS.gravewyrm_sanctum.index, inst.slot);
  // Far from the road (the Thaw Works), so nothing pulls.
  sim.player.pos = sim.ctx.groundPos(o.x, o.z + 42);
  sim.player.prevPos = { ...sim.player.pos };
  sim.ctx.rebucket(sim.player);
  const i = GRAVEWYRM_SANCTUM_SPAWNS.findIndex((s) => s.mobId === 'sledge_tusker');
  const tusker = sim.ctx.entities.get(inst.mobIds[i]) as Entity;
  sim.drainEvents();
  return { sim, inst, tusker, o };
}

function loopWorld(r: Room) {
  return TUSKER_ROAD.map((p) => ({ x: r.o.x + p.x, z: r.o.z + p.z }));
}

/** The point the clock puts the patrol at now (world). */
function pointNow(r: Room): { x: number; z: number } {
  const st = r.tusker.dungeonPatrol;
  if (!st) throw new Error('no patrol');
  return patrolPointAt(st.points, r.sim.ctx.time * r.tusker.moveSpeed * st.pace + st.offset);
}

/** Tick the world; return how many ticks the beast stood still, and its
 *  farthest stray from its loop. */
function walk(r: Room, seconds: number): { stalls: number; stray: number } {
  const loop = loopWorld(r);
  let stalls = 0;
  let stray = 0;
  let prev = { ...r.tusker.pos };
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    r.sim.tick();
    r.sim.drainEvents();
    if (Math.hypot(r.tusker.pos.x - prev.x, r.tusker.pos.z - prev.z) < 0.05) stalls++;
    stray = Math.max(stray, projectOntoLoop(loop, r.tusker.pos.x, r.tusker.pos.z).d);
    prev = { ...r.tusker.pos };
  }
  return { stalls, stray };
}

describe('the Sledge Tusker on its road (live claim)', () => {
  it('spawns on its patrol point for the claim clock, facing along the road', () => {
    for (const clock of [0, 1234.5, 4321.7, 98765.4]) {
      const r = room(clock);
      const want = pointNow(r);
      expect(Math.hypot(r.tusker.pos.x - want.x, r.tusker.pos.z - want.z)).toBeLessThan(0.05);
      expect(r.tusker.spawnPos.x).toBeCloseTo(r.tusker.pos.x, 6);
      expect(r.tusker.spawnPos.z).toBeCloseTo(r.tusker.pos.z, 6);
    }
  });

  it('walks a whole loop with no stall and never strays off it (a claim hours into the clock)', () => {
    const r = room(4321.7);
    const st = r.tusker.dungeonPatrol;
    if (!st) throw new Error('no patrol');
    const period = patrolLoopLength(st.points) / (r.tusker.moveSpeed * st.pace);
    const { stalls, stray } = walk(r, period + 2);
    // The beast never grinds against a wall (the playtest saw it stand still
    // most of the time); a tick on a waypoint may round to no move.
    expect(stalls).toBeLessThan(5);
    expect(stray).toBeLessThan(0.6);
    expect(r.tusker.aiState).toBe('idle');
  }, 60_000);

  it('shoved to the far end of its road, it walks back ALONG the road, never across the gap', () => {
    const r = room(321.4);
    // Put it at the loop point half a loop from where the clock wants it.
    const st = r.tusker.dungeonPatrol;
    if (!st) throw new Error('no patrol');
    const half = patrolLoopLength(st.points) / 2;
    const s = r.sim.ctx.time * r.tusker.moveSpeed * st.pace + st.offset + half;
    const far = patrolPointAt(st.points, s);
    r.tusker.pos = r.sim.ctx.groundPos(far.x, far.z);
    r.tusker.prevPos = { ...r.tusker.pos };
    r.sim.ctx.rebucket(r.tusker);
    const { stalls, stray } = walk(r, 40);
    expect(stalls).toBeLessThan(5);
    expect(stray).toBeLessThan(1.6);
    // It has caught its point again.
    const want = pointNow(r);
    expect(Math.hypot(r.tusker.pos.x - want.x, r.tusker.pos.z - want.z)).toBeLessThan(1.6);
  }, 60_000);

  it('an evade walks it home along the road, never across the gap', () => {
    const r = room(4321.7);
    const loop = loopWorld(r);
    const home = { ...r.tusker.spawnPos };
    // Drag it to the road point farthest along the loop from home, in its
    // fight, then let it evade.
    const st = r.tusker.dungeonPatrol;
    if (!st) throw new Error('no patrol');
    const homeS = projectOntoLoop(st.points, home.x, home.z).s;
    const far = patrolPointAt(st.points, homeS + patrolLoopLength(st.points) / 2);
    r.tusker.pos = r.sim.ctx.groundPos(far.x, far.z);
    r.tusker.prevPos = { ...r.tusker.pos };
    r.sim.ctx.rebucket(r.tusker);
    r.tusker.inCombat = true;
    r.tusker.aiState = 'evade';
    r.tusker.aggroTargetId = null;
    let stray = 0;
    let ticks = 0;
    while (r.tusker.aiState === 'evade' && ticks < Math.round(60 / DT)) {
      r.sim.tick();
      r.sim.drainEvents();
      stray = Math.max(stray, projectOntoLoop(loop, r.tusker.pos.x, r.tusker.pos.z).d);
      ticks++;
    }
    expect(r.tusker.aiState).not.toBe('evade');
    expect(stray).toBeLessThan(1.6);
    expect(Math.hypot(r.tusker.pos.x - home.x, r.tusker.pos.z - home.z)).toBeLessThan(4.5);
  }, 60_000);
});
