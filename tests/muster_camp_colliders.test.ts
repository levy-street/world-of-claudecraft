// The Mirefen muster camps' collision (src/sim/muster_camp_colliders.ts) and Balgath's
// keep-out circle round the command camp (mob/keep_out.ts, content/mirefen_muster.ts
// MUSTER_COMMAND_KEEP_OUT), measured against the real camp plan, the real static collider
// grid and a live Sim:
//   - the structure pieces block a player and the clutter never does;
//   - every designed opening stays walkable, no soldier post is inside a solid, the rack
//     is reachable from outside the command camp's gate, and no open ground inside any
//     camp is cut off from the outside (the colliders never trap anyone);
//   - Balgath never enters the command camp: every warpath leg and his walk to bed from
//     every stop clear it by a margin, a chase after a player standing at the rack stops
//     at the circle's rim, and a walk whose straight line crosses the camp goes round it.
import { describe, expect, it } from 'vitest';
import { isBlocked, queryOpenWorldColliders } from '../src/sim/colliders';
import {
  MUSTER_CAMPS,
  MUSTER_CIRCUIT,
  MUSTER_COMMAND_KEEP_OUT,
  MUSTER_RACK,
  musterCamp,
} from '../src/sim/content/mirefen_muster';
import { BUILTIN_WORLD, MOBS } from '../src/sim/data';
import { insideKeepOut, keepOutStep } from '../src/sim/mob/keep_out';
import {
  MUSTER_PIECE_COLLISION,
  MUSTER_POCKET_CELL,
  musterCampColliders,
  musterCampPockets,
  musterPlacementColliders,
  musterPocketSeals,
} from '../src/sim/muster_camp_colliders';
import {
  MUSTER_CLUTTER_KEYS,
  musterCampOpenings,
  musterFootprintCorners,
} from '../src/sim/muster_camp_layout';
import { musterCampPlan } from '../src/sim/muster_camp_plan';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import { DT, type Entity, INTERACT_RANGE, type WorldContent } from '../src/sim/types';
import { groundHeight, terrainHeight } from '../src/sim/world';
import { WORLD_BOSSES } from '../src/sim/world_boss';
import { WORLD_SEED } from '../src/sim/world_seed';

const SEED = WORLD_SEED;
const plan = musterCampPlan(SEED);
const command = musterCamp('command');
const BODY = 0.5; // the player body radius the movement kernel resolves with
const lair = WORLD_BOSSES.find((b) => b.templateId === 'balgath_cyclops')?.pos as {
  x: number;
  z: number;
};

/** Flood-fill the open ground around a camp on a half-yard grid (colliders only). The grid
 *  is offset a quarter yard from the one the build seals pockets on, so this re-measures the
 *  ground rather than re-reading the seals' own cells. */
function floodCamp(camp: { x: number; z: number }, radius: number) {
  const cell = 0.5;
  const cx = camp.x + 0.25;
  const cz = camp.z + 0.25;
  const n = Math.ceil(radius / cell);
  const key = (i: number, j: number) => `${i},${j}`;
  const open = new Map<string, boolean>();
  const at = (i: number, j: number) => {
    const k = key(i, j);
    let v = open.get(k);
    if (v === undefined) {
      v = !isBlocked(SEED, cx + i * cell, cz + j * cell, BODY);
      open.set(k, v);
    }
    return v;
  };
  const reached = new Set<string>();
  const queue: [number, number][] = [];
  // Seed from the whole outer ring: "outside the camp".
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      const r = Math.hypot(i, j) * cell;
      if (r > radius - cell && r <= radius && at(i, j)) {
        reached.add(key(i, j));
        queue.push([i, j]);
      }
    }
  }
  while (queue.length > 0) {
    const [i, j] = queue.pop() as [number, number];
    for (const [di, dj] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const a = i + di;
      const b = j + dj;
      if (Math.hypot(a, b) * cell > radius) continue;
      const k = key(a, b);
      if (reached.has(k) || !at(a, b)) continue;
      reached.add(k);
      queue.push([a, b]);
    }
  }
  return { cell, n, at, reached, key };
}

describe('muster camp colliders (the plan, as solids)', () => {
  it('turns every structure piece into solids and leaves every clutter piece walk-through', () => {
    const all = musterCampColliders(SEED);
    let expected = 0;
    for (const p of plan) {
      const parts = musterPlacementColliders(p, SEED);
      if (p.tierClass === 'clutter') {
        expect(parts, `${p.campId} ${p.key} is clutter`).toEqual([]);
        continue;
      }
      expect(MUSTER_PIECE_COLLISION[p.key], `${p.key} has a collision row`).toBeDefined();
      expect(parts.length).toBeGreaterThan(0);
      expected += parts.length;
    }
    // ...plus the drill yard's effigy post (musterEffigyCollider), the one non-plan solid.
    expect(all.length).toBe(expected + 1);
    // No clutter key ever has a row that could make it solid by default.
    for (const key of MUSTER_CLUTTER_KEYS) {
      if (key !== 'musterTorch') expect(MUSTER_PIECE_COLLISION[key]).toBeUndefined();
    }
    // Every wall, gate wing, tent and the rack sits inside its drawn footprint.
    for (const p of plan) {
      for (const c of musterPlacementColliders(p, SEED)) {
        const corners = musterFootprintCorners(p.key, p.x, p.z, p.rot);
        const reach = Math.max(...corners.map(([x, z]) => Math.hypot(x - p.x, z - p.z)));
        expect(Math.hypot(c.x - p.x, c.z - p.z), `${p.key} part off its piece`).toBeLessThan(reach);
      }
    }
  });

  it('puts the muster solids in the live static grid', () => {
    const near = queryOpenWorldColliders(
      SEED,
      MUSTER_RACK.x - 1,
      MUSTER_RACK.z - 1,
      MUSTER_RACK.x + 1,
      MUSTER_RACK.z + 1,
      [],
    );
    const rack = musterCampColliders(SEED).find(
      (c) => Math.hypot(c.x - MUSTER_RACK.x, c.z - MUSTER_RACK.z) < 1e-6,
    );
    expect(rack, 'the rack has a collider').toBeDefined();
    expect(near.some((c) => Math.hypot(c.x - MUSTER_RACK.x, c.z - MUSTER_RACK.z) < 1e-6)).toBe(
      true,
    );
    expect(isBlocked(SEED, MUSTER_RACK.x, MUSTER_RACK.z, BODY)).toBe(true);
  });

  it('blocks a player at every wall section, gate wing, tent and tower leg', () => {
    for (const p of plan) {
      if (p.tierClass !== 'structure') continue;
      for (const c of musterPlacementColliders(p, SEED)) {
        expect(isBlocked(SEED, c.x, c.z, BODY), `${p.campId} ${p.key} at ${c.x},${c.z}`).toBe(true);
      }
    }
  });

  it('stops a player walking into the command camp palisade (the real movement kernel)', () => {
    const wall = plan.find((p) => p.campId === 'command' && p.key === 'musterPalisade');
    if (!wall) throw new Error('the command camp has no palisade section');
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', autoEquip: true });
    const p = sim.player;
    // Start 4 yards outside the wall section, facing the camp centre through it.
    const out = { x: Math.sin(wall.rot), z: Math.cos(wall.rot) };
    p.pos.x = wall.x + out.x * 4;
    p.pos.z = wall.z + out.z * 4;
    p.pos.y = terrainHeight(p.pos.x, p.pos.z, SEED) + 0.05;
    p.prevPos = { ...p.pos };
    const meta = sim.meta(sim.playerId) as unknown as {
      moveInput: Record<string, boolean>;
    };
    p.facing = Math.atan2(-out.x, -out.z);
    meta.moveInput.forward = true;
    const startGap = Math.hypot(p.pos.x - command.center.x, p.pos.z - command.center.z);
    for (let i = 0; i < 20 * 4; i++) {
      p.facing = Math.atan2(-out.x, -out.z);
      sim.tick();
    }
    meta.moveInput.forward = false;
    // It walked up to the wall (moved) but is still on the outside of the stake line.
    const along = (p.pos.x - wall.x) * out.x + (p.pos.z - wall.z) * out.z;
    expect(
      startGap - Math.hypot(p.pos.x - command.center.x, p.pos.z - command.center.z),
    ).toBeGreaterThan(1);
    expect(along, 'the player walked through the palisade').toBeGreaterThan(0.3);
  });

  it('keeps every picket opening walkable from outside in to the squad', () => {
    for (const camp of MUSTER_CAMPS.filter((c) => c.onCircuit)) {
      const input = { camps: MUSTER_CAMPS, circuit: MUSTER_CIRCUIT, lair };
      for (const bearing of musterCampOpenings(camp, input)) {
        for (let r = 3; r <= 20; r += 0.5) {
          const x = camp.center.x + Math.sin(bearing) * r;
          const z = camp.center.z + Math.cos(bearing) * r;
          expect(isBlocked(SEED, x, z, BODY), `${camp.id} opening at r ${r}`).toBe(false);
        }
      }
    }
  });

  it('never stands a solid on a soldier post', () => {
    for (const camp of MUSTER_CAMPS) {
      for (const s of camp.soldiers) {
        const x = camp.center.x + s.dx;
        const z = camp.center.z + s.dz;
        expect(isBlocked(SEED, x, z, 0.4), `${camp.id} post ${s.templateId}`).toBe(false);
      }
    }
  });

  it('seals every pocket the build found, with a handful of knee-high bars', () => {
    // After the grid is built (and sealed), the build's own flood finds nothing left.
    expect(musterPocketSeals(SEED, (seed, x, z) => isBlocked(seed, x, z))).toEqual([]);
    // The seals are real (the plan does leave slivers), and each is a bar with no visual
    // top: it never blocks the camera or a sight line.
    let seals = 0;
    for (const camp of MUSTER_CAMPS) {
      const r = 24;
      const found = queryOpenWorldColliders(
        SEED,
        camp.center.x - r,
        camp.center.z - r,
        camp.center.x + r,
        camp.center.z + r,
        [],
      ).filter((c) => c.type === 'obb' && c.hw === MUSTER_POCKET_CELL * 0.6 && c.rot === 0);
      for (const c of found) {
        expect(
          (c.cameraTopY ?? Number.POSITIVE_INFINITY) - groundHeight(c.x, c.z, SEED),
        ).toBeLessThan(0.2);
      }
      seals += found.length;
    }
    expect(seals).toBeGreaterThan(0);
    // With nothing blocked there is nothing to seal: a pocket is only ever open ground the
    // flood could not reach.
    expect(musterCampPockets(command, () => false)).toEqual([]);
  });

  it('traps nobody: all open ground in every camp connects to the outside, and the rack is reachable', () => {
    for (const camp of MUSTER_CAMPS) {
      const radius = camp.onCircuit ? 18 : 23;
      const f = floodCamp(camp.center, radius);
      const pockets: string[] = [];
      for (let i = -f.n; i <= f.n; i++) {
        for (let j = -f.n; j <= f.n; j++) {
          if (Math.hypot(i, j) * f.cell > radius) continue;
          if (f.at(i, j) && !f.reached.has(f.key(i, j))) {
            pockets.push(
              `${camp.center.x + 0.25 + i * f.cell},${camp.center.z + 0.25 + j * f.cell}`,
            );
          }
        }
      }
      expect(pockets, `${camp.id} has open ground walled off from outside`).toEqual([]);
      if (camp.id !== 'command') continue;
      // Somewhere reachable from outside is inside the rack's interact reach, with room.
      let bestRack = Number.POSITIVE_INFINITY;
      for (const k of f.reached) {
        const [i, j] = k.split(',').map(Number);
        const x = camp.center.x + 0.25 + i * f.cell;
        const z = camp.center.z + 0.25 + j * f.cell;
        bestRack = Math.min(bestRack, Math.hypot(x - MUSTER_RACK.x, z - MUSTER_RACK.z));
      }
      expect(bestRack).toBeLessThan(INTERACT_RANGE - 2);
      // And the command camp really is walled: the way in is the gate, not the whole ring.
      let solidOnRing = 0;
      let samples = 0;
      for (let b = 0; b < Math.PI * 2; b += 0.05) {
        samples++;
        let blocked = false;
        for (let r = 14; r <= 18; r += 0.25) {
          if (
            isBlocked(SEED, camp.center.x + Math.sin(b) * r, camp.center.z + Math.cos(b) * r, BODY)
          ) {
            blocked = true;
            break;
          }
        }
        if (blocked) solidOnRing++;
      }
      expect(solidOnRing / samples).toBeGreaterThan(0.75);
    }
  });
});

// ---------------------------------------------------------------------------
// Balgath and the command camp
// ---------------------------------------------------------------------------

/** Min distance from the keep-out centre along a straight segment. */
function segmentClearance(a: { x: number; z: number }, b: { x: number; z: number }): number {
  let m = Number.POSITIVE_INFINITY;
  for (let t = 0; t <= 1; t += 1 / 400) {
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;
    m = Math.min(m, Math.hypot(x - MUSTER_COMMAND_KEEP_OUT.x, z - MUSTER_COMMAND_KEEP_OUT.z));
  }
  return m;
}

describe("Balgath never enters the muster's command camp", () => {
  const warpath = MOBS.balgath_cyclops?.warpath;
  const stops = warpath?.destinations ?? [];

  it('sizes the circle from the camp plan plus his body plus margin', () => {
    expect(MOBS.balgath_cyclops?.keepOut).toContain(MUSTER_COMMAND_KEEP_OUT);
    expect(MUSTER_COMMAND_KEEP_OUT.x).toBe(command.center.x);
    expect(MUSTER_COMMAND_KEEP_OUT.z).toBe(command.center.z);
    let reach = 0;
    for (const p of plan) {
      if (p.campId !== 'command') continue;
      for (const [x, z] of musterFootprintCorners(p.key, p.x, p.z, p.rot)) {
        reach = Math.max(reach, Math.hypot(x - command.center.x, z - command.center.z));
      }
    }
    // His shoulders are about three yards from his middle; two more is the margin.
    expect(reach + 3 + 2).toBeLessThanOrEqual(MUSTER_COMMAND_KEEP_OUT.radius);
  });

  it('keeps every warpath leg, his opening march and his walk to bed from every stop clear', () => {
    expect(stops.length).toBe(MUSTER_CIRCUIT.length);
    const margin = 5;
    const legs: [string, { x: number; z: number }, { x: number; z: number }][] = [
      ['bed to first stop', lair, stops[0]],
    ];
    for (let i = 0; i < stops.length; i++) {
      legs.push([`leg ${i}`, stops[i], stops[(i + 1) % stops.length]]);
      legs.push([`stop ${i} to bed`, stops[i], lair]);
    }
    for (const [name, a, b] of legs) {
      expect(segmentClearance(a, b), name).toBeGreaterThan(MUSTER_COMMAND_KEEP_OUT.radius + margin);
    }
    // Where he plants to wreck a stop (anywhere inside arriveRadius) is clear too.
    const arrive = warpath?.arriveRadius ?? 0;
    for (const s of stops) {
      expect(
        Math.hypot(s.x - MUSTER_COMMAND_KEEP_OUT.x, s.z - MUSTER_COMMAND_KEEP_OUT.z) - arrive,
      ).toBeGreaterThan(MUSTER_COMMAND_KEEP_OUT.radius + margin);
    }
    // His bed itself.
    expect(
      Math.hypot(lair.x - MUSTER_COMMAND_KEEP_OUT.x, lair.z - MUSTER_COMMAND_KEEP_OUT.z),
    ).toBeGreaterThan(MUSTER_COMMAND_KEEP_OUT.radius + margin);
  });

  // A bare world (no camps) with Balgath dropped wherever the case needs him.
  function world(): { sim: Sim; ctx: SimContext; boss: Entity } {
    const content: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', autoEquip: true, world: content });
    const inner = sim as unknown as {
      ctx: SimContext;
      spawnDevBoss(t: string, x: number, z: number): number;
    };
    const id = inner.spawnDevBoss('balgath_cyclops', lair.x, lair.z);
    return { sim, ctx: inner.ctx, boss: sim.entities.get(id) as Entity };
  }

  it('walks round the camp when the straight line home crosses it, and still gets home', () => {
    const { ctx, boss } = world();
    // South-east of the camp, so the straight line to his bed runs through it.
    const start = {
      x: command.center.x + 22 * Math.sin(2.6),
      z: command.center.z + 32 * Math.cos(2.6),
    };
    expect(segmentClearance(start, lair)).toBeLessThan(MUSTER_COMMAND_KEEP_OUT.radius);
    boss.pos.x = start.x;
    boss.pos.z = start.z;
    let arrived = false;
    let closest = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 20 * 120 && !arrived; i++) {
      arrived = ctx.moveToward(boss, { x: lair.x, y: 0, z: lair.z }, boss.moveSpeed);
      closest = Math.min(
        closest,
        Math.hypot(boss.pos.x - MUSTER_COMMAND_KEEP_OUT.x, boss.pos.z - MUSTER_COMMAND_KEEP_OUT.z),
      );
    }
    expect(arrived, 'he never got home').toBe(true);
    expect(closest).toBeGreaterThanOrEqual(MUSTER_COMMAND_KEEP_OUT.radius - 1e-6);
  });

  it('chases a player at the rack only to the rim, then gives up the pull (no safe perch)', () => {
    const { sim, boss } = world();
    const p = sim.player;
    p.pos.x = MUSTER_RACK.x;
    p.pos.z = MUSTER_RACK.z + 2;
    p.pos.y = terrainHeight(p.pos.x, p.pos.z, SEED);
    p.prevPos = { ...p.pos };
    // Just outside the rim, awake and on the player.
    boss.pos.x = MUSTER_COMMAND_KEEP_OUT.x - (MUSTER_COMMAND_KEEP_OUT.radius + 6);
    boss.pos.z = MUSTER_COMMAND_KEEP_OUT.z;
    boss.asleep = false;
    boss.hostile = true;
    boss.aiState = 'chase';
    boss.leashAnchor = { ...boss.pos };
    boss.spawnPos = { ...boss.pos };
    boss.aggroTargetId = p.id;
    boss.inCombat = true;
    boss.threat.set(p.id, 1000);
    let closest = Number.POSITIVE_INFINITY;
    let reachedRim = false;
    let evadedAt: number | null = null;
    for (let i = 0; i < 20 * 20; i++) {
      p.pos.x = MUSTER_RACK.x;
      p.pos.z = MUSTER_RACK.z + 2;
      sim.tick();
      const d = Math.hypot(
        boss.pos.x - MUSTER_COMMAND_KEEP_OUT.x,
        boss.pos.z - MUSTER_COMMAND_KEEP_OUT.z,
      );
      closest = Math.min(closest, d);
      if (d < MUSTER_COMMAND_KEEP_OUT.radius + 0.5) reachedRim = true;
      if (evadedAt === null && (boss.aiState as string) === 'evade') evadedAt = i / 20;
    }
    expect(closest).toBeGreaterThanOrEqual(MUSTER_COMMAND_KEEP_OUT.radius - 1e-6);
    // He did come for the player (a chase, not a body that never moved)...
    expect(reachedRim).toBe(true);
    // ...and a target he cannot reach behind the circle is the unreachable perch the
    // chase-stall rule denies: held on the rim, he drops the pull and goes home to heal,
    // so standing at the rack is never a free firing position.
    expect(evadedAt, 'he never gave up the unreachable target').not.toBeNull();
    expect(evadedAt as number).toBeLessThan(10);
    expect(boss.threat.has(p.id)).toBe(false);
  });

  it('walks a body that finds itself inside straight out, whatever it was chasing', () => {
    const { ctx, boss } = world();
    boss.pos.x = MUSTER_COMMAND_KEEP_OUT.x + 3;
    boss.pos.z = MUSTER_COMMAND_KEEP_OUT.z;
    let last = 3;
    for (let i = 0; i < 20 * 10; i++) {
      ctx.moveToward(boss, { x: MUSTER_RACK.x, y: 0, z: MUSTER_RACK.z }, boss.moveSpeed);
      const d = Math.hypot(
        boss.pos.x - MUSTER_COMMAND_KEEP_OUT.x,
        boss.pos.z - MUSTER_COMMAND_KEEP_OUT.z,
      );
      expect(d).toBeGreaterThanOrEqual(last - 1e-9);
      last = d;
    }
    expect(last).toBeGreaterThanOrEqual(MUSTER_COMMAND_KEEP_OUT.radius - 1e-6);
  });
});

describe('keepOutStep (pure)', () => {
  const c = [{ x: 0, z: 0, radius: 10 }];
  const out = { x: 0, z: 0 };

  it('leaves a step that ends outside every circle untouched', () => {
    expect(keepOutStep(c, 20, 0, 19.7, 0, 0, 40, out)).toBe(false);
    expect(out).toEqual({ x: 19.7, z: 0 });
  });

  it('holds the rim for a destination inside, easing toward the rim point nearest it', () => {
    expect(keepOutStep(c, 10, 0, 9.7, 0.1, 0, 0, out)).toBe(true);
    expect(Math.hypot(out.x, out.z)).toBeCloseTo(10, 9);
    expect(out.z).toBeGreaterThan(0);
  });

  it('turns along the rim toward the side the destination lies on', () => {
    // Standing due east on the rim, heading for a point due west beyond the circle, a
    // hair north of the centre line: the step goes north round the rim.
    expect(keepOutStep(c, 10, 0, 9.7, 0, -30, 0.5, out)).toBe(true);
    expect(Math.hypot(out.x, out.z)).toBeCloseTo(10, 9);
    expect(out.z).toBeGreaterThan(0);
    expect(keepOutStep(c, 10, 0, 9.7, 0, -30, -0.5, out)).toBe(true);
    expect(out.z).toBeLessThan(0);
  });

  it('walks straight out from inside, and from the exact centre too', () => {
    expect(keepOutStep(c, 3, 4, 2.9, 3.9, 0, 0, out)).toBe(true);
    expect(Math.hypot(out.x, out.z)).toBeGreaterThan(5);
    keepOutStep(c, 0, 0, 0.1, 0.1, 0, 0, out);
    expect(Math.hypot(out.x, out.z)).toBeGreaterThan(0);
    expect(insideKeepOut(c, 1, 1)).toBe(true);
    expect(insideKeepOut(c, 11, 0)).toBe(false);
  });

  it('draws nothing it does not need: DT-sized steps round a rim never tunnel inside', () => {
    let x = 12;
    let z = 0;
    for (let i = 0; i < 400; i++) {
      const a = Math.atan2(-30 - x, 0.5 - z);
      const step = 6 * DT;
      keepOutStep(c, x, z, x + Math.sin(a) * step, z + Math.cos(a) * step, -30, 0.5, out);
      x = out.x;
      z = out.z;
      expect(Math.hypot(x, z)).toBeGreaterThanOrEqual(10 - 1e-9);
    }
    expect(x).toBeLessThan(-10);
  });
});
