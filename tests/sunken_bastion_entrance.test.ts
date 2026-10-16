// The Sunken Bastion's world entrance, the Drowned Gate Tower
// (src/sim/sunken_bastion_entrance.ts, drawn by
// src/render/sunken_bastion_entrance.ts): its inner arch's piers are the
// door's jambs and the lane between them is the walk-in trigger; a player
// climbs the road, passes under the jammed portcullis into the gate court and
// is taken by the door, and walks back down from the exit drop; the two ward
// stones the quest asks for stay on open ground and are walked to; the scatter
// the gatehouse stands on is cleared; every footing of the Blender model sits
// on the sim's own ground (no gap, no sinking); and nothing around the door,
// mob spawns included, is walled in.
import { describe, expect, it } from 'vitest';
import { isBlocked } from '../src/sim/colliders';
import { DUNGEON_X_THRESHOLD, DUNGEONS, GATHER_NODES, GROUND_OBJECTS, NPCS } from '../src/sim/data';
import { isExcludedDecoration } from '../src/sim/decoration_exclusions';
import { PLAYER_BODY_RADIUS } from '../src/sim/pathfind';
import { Sim } from '../src/sim/sim';
import {
  SUNKEN_BASTION_ENTRANCE_CLEARED_SCATTER,
  SUNKEN_BASTION_ENTRANCE_COLLIDERS,
  SUNKEN_BASTION_ENTRANCE_FOOTINGS,
  SUNKEN_BASTION_ENTRANCE_GATE_HALF_WIDTH,
  SUNKEN_BASTION_ENTRANCE_LANE_HALF_WIDTH,
  sunkenBastionEntranceColliders,
} from '../src/sim/sunken_bastion_entrance';
import type { MoveInput } from '../src/sim/types';
import { generateDecorationsInBounds, groundHeight, terrainHeight } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

const SEED = WORLD_SEED;
const DOOR = DUNGEONS.sunken_bastion.doorPos;
// The walk-in trigger (instances/dungeons.ts DOOR_TRIGGER_RADIUS): a shipped
// constant the module does not export, pinned here as the literal it is.
const DOOR_TRIGGER_RADIUS = 2;
const EXIT_DROP = { x: DOOR.x, z: DOOR.z - 4 };
// The approach: twenty yards down the north fen road, which climbs to the
// door from (20, 470).
const APPROACH = { x: DOOR.x - 9.7, z: DOOR.z - 17.5 };
const IDLE: MoveInput = {
  forward: false,
  back: false,
  turnLeft: false,
  turnRight: false,
  strafeLeft: false,
  strafeRight: false,
  jump: false,
  dive: false,
  surface: false,
};

function place(sim: Sim, x: number, z: number, facing: number): void {
  const p = sim.player;
  p.pos.x = x;
  p.pos.z = z;
  p.pos.y = groundHeight(x, z, SEED);
  p.prevPos = { ...p.pos };
  p.fallStartY = p.pos.y;
  p.facing = facing;
  p.onGround = true;
  p.vx = 0;
  p.vy = 0;
  p.vz = 0;
  sim.rebucket(p);
}

/** Walk toward a point, re-aiming every tick (so a small prop is skirted). */
function walkTo(sim: Sim, x: number, z: number, reach: number, maxTicks: number): boolean {
  const p = sim.player;
  const meta = sim.players.get(p.id);
  if (!meta) throw new Error('no meta');
  for (let i = 0; i < maxTicks; i++) {
    if (Math.hypot(p.pos.x - x, p.pos.z - z) <= reach) return true;
    p.facing = Math.atan2(x - p.pos.x, z - p.pos.z);
    Object.assign(meta.moveInput, IDLE, { forward: true });
    sim.tick();
  }
  return Math.hypot(p.pos.x - x, p.pos.z - z) <= reach;
}

function makeSim(): Sim {
  const sim = new Sim({ seed: SEED, playerClass: 'warrior', autoEquip: true, devCommands: true });
  sim.setPlayerLevel(20);
  sim.player.devNoAggro = true;
  return sim;
}

/** Circle-vs-shape overlap against the gatehouse's own solids only. */
function gateHits(x: number, z: number, r: number): boolean {
  return sunkenBastionEntranceColliders(SEED, DOOR).some((c) => {
    if (c.type === 'circle') return Math.hypot(x - c.x, z - c.z) < c.r + r;
    // the set piece hands circles and boxes only
    if (c.type !== 'obb') throw new Error(`unexpected ${c.type} collider in the set piece`);
    const dx = x - c.x;
    const dz = z - c.z;
    const cs = Math.cos(c.rot);
    const sn = Math.sin(c.rot);
    const u = dx * cs - dz * sn;
    const v = dx * sn + dz * cs;
    return Math.hypot(Math.max(Math.abs(u) - c.hw, 0), Math.max(Math.abs(v) - c.hd, 0)) < r;
  });
}

describe('the Drowned Gate Tower stands in for the generic door arch', () => {
  it('the door is still the Bastion door at (45, 515), on the knoll the model was built on', () => {
    expect(DOOR).toEqual({ x: 45, z: 515 });
    expect(terrainHeight(DOOR.x, DOOR.z, SEED)).toBeCloseTo(13.4223, 3);
    // the knoll is steep: the exit drop four yards down the road is two yards lower
    expect(
      terrainHeight(DOOR.x, DOOR.z, SEED) - terrainHeight(EXIT_DROP.x, EXIT_DROP.z, SEED),
    ).toBeGreaterThan(1.5);
  });

  it('the towers, the gate front, the court and the door piers block', () => {
    for (const sx of [-1, 1]) {
      expect(isBlocked(SEED, DOOR.x + sx * 7.2, DOOR.z - 1.2, 0.4), `tower ${sx}`).toBe(true);
      expect(isBlocked(SEED, DOOR.x + sx * 3.4, DOOR.z - 3, 0.3), `gate front ${sx}`).toBe(true);
      expect(isBlocked(SEED, DOOR.x + sx * 2.65, DOOR.z - 1.45, 0.3), `court ${sx}`).toBe(true);
      expect(isBlocked(SEED, DOOR.x + sx * 2.2, DOOR.z, 0.3), `door pier ${sx}`).toBe(true);
      expect(isBlocked(SEED, DOOR.x + sx * 1.62, DOOR.z + 3, 0.2), `passage ${sx}`).toBe(true);
      // no slipping between a tower and the gate front
      expect(isBlocked(SEED, DOOR.x + sx * 4.67, DOOR.z - 3, PLAYER_BODY_RADIUS)).toBe(true);
    }
    // the black water behind the flood sill is closed
    expect(isBlocked(SEED, DOOR.x, DOOR.z + 1.5, 0.4), 'the flooded passage').toBe(true);
    expect(isBlocked(SEED, DOOR.x, DOOR.z + 4.5, 0.4), 'its far end').toBe(true);
    // the curtain wall's two runs and the fallen blocks beside the road
    expect(isBlocked(SEED, DOOR.x - 12.3, DOOR.z + 1.55, 0.3), 'curtain').toBe(true);
    expect(isBlocked(SEED, DOOR.x - 17.25, DOOR.z + 5.1, 0.3), 'curtain end').toBe(true);
    expect(isBlocked(SEED, DOOR.x - 10.6, DOOR.z - 8.6, 0.3), 'fallen blocks').toBe(true);
  });

  it('the road runs open under the portcullis into the court, and the lane is narrower than the trigger', () => {
    expect(SUNKEN_BASTION_ENTRANCE_LANE_HALF_WIDTH).toBeLessThan(DOOR_TRIGGER_RADIUS);
    expect(SUNKEN_BASTION_ENTRANCE_LANE_HALF_WIDTH).toBeGreaterThan(PLAYER_BODY_RADIUS + 0.5);
    expect(SUNKEN_BASTION_ENTRANCE_GATE_HALF_WIDTH).toBeGreaterThan(
      SUNKEN_BASTION_ENTRANCE_LANE_HALF_WIDTH,
    );
    for (const lz of [-7, -6, -5, -4, -3.5, -3, -2.5, -2.1]) {
      for (const lx of [-1, 0, 1]) {
        expect(isBlocked(SEED, DOOR.x + lx, DOOR.z + lz, PLAYER_BODY_RADIUS), `${lx},${lz}`).toBe(
          false,
        );
      }
    }
    // a body in the door's own lane, up to the flood sill
    for (const lz of [-1.5, -1, -0.6]) {
      expect(isBlocked(SEED, DOOR.x, DOOR.z + lz, PLAYER_BODY_RADIUS), `lane ${lz}`).toBe(false);
    }
    // a body wider than the lane is walled at the piers
    for (const sx of [-1, 1]) {
      expect(isBlocked(SEED, DOOR.x + sx * 1.0, DOOR.z + 0.0, PLAYER_BODY_RADIUS)).toBe(true);
    }
  });

  it('nobody stands in the court past the trigger: every open spot north of the winch is inside it', () => {
    let open = 0;
    // (an off-lattice grid: a centre exactly on the corner two solids share is
    // pushed both ways and reads as unmoved)
    for (let lz = -0.99; lz <= 0.6; lz += 0.07) {
      for (let lx = -3.21; lx <= 3.2; lx += 0.07) {
        if (isBlocked(SEED, DOOR.x + lx, DOOR.z + lz, PLAYER_BODY_RADIUS)) continue;
        open++;
        expect(Math.hypot(lx, lz), `${lx.toFixed(2)},${lz.toFixed(2)}`).toBeLessThan(
          DOOR_TRIGGER_RADIUS,
        );
      }
    }
    expect(open).toBeGreaterThan(40);
  });

  it('the exit drop is outside the trigger, on open ground under the outer arch', () => {
    expect(EXIT_DROP.z).toBeLessThan(DOOR.z - DOOR_TRIGGER_RADIUS);
    expect(isBlocked(SEED, EXIT_DROP.x, EXIT_DROP.z, 0.9)).toBe(false);
    expect(gateHits(EXIT_DROP.x, EXIT_DROP.z, 0.5)).toBe(false);
  });
});

describe('a player climbs the road, passes the gate and enters the Bastion', () => {
  it('approach to trigger, then the exit drop and back down the road', () => {
    const sim = makeSim();
    const p = sim.player;
    place(sim, APPROACH.x, APPROACH.z, 0);
    // up the road to the foot of the gate
    expect(walkTo(sim, DOOR.x, DOOR.z - 6, 0.8, 600), 'reached the gate').toBe(true);
    // aim past the door: the walk ends the moment the trigger takes it
    walkTo(sim, DOOR.x, DOOR.z + 6, 0.5, 400);
    expect(p.pos.x, 'walked into the instance').toBeGreaterThan(DUNGEON_X_THRESHOLD);
    const exit = [...sim.entities.values()].find((e) => e.templateId === 'dungeon_exit');
    expect(exit).toBeDefined();
    if (!exit) return;
    place(sim, exit.pos.x, exit.pos.z + 1.2, Math.PI);
    sim.tick();
    expect(p.pos.x).toBeLessThan(DUNGEON_X_THRESHOLD);
    expect(Math.hypot(p.pos.x - EXIT_DROP.x, p.pos.z - EXIT_DROP.z)).toBeLessThan(1.5);
    expect(isBlocked(SEED, p.pos.x, p.pos.z, PLAYER_BODY_RADIUS)).toBe(false);
    expect(walkTo(sim, APPROACH.x, APPROACH.z, 0.8, 800), 'back down to the approach').toBe(true);
  });
});

describe('the two ward stones stay within reach', () => {
  const stones = GROUND_OBJECTS.flatMap((g) =>
    g.positions
      .filter((pos) => Math.hypot(pos.x - DOOR.x, pos.z - DOOR.z) < 12)
      .map((pos) => ({ itemId: g.itemId, pos })),
  );

  it('one lies under the outer arch and one behind the gatehouse, both on open ground', () => {
    expect(stones.map((o) => o.itemId)).toEqual(['bastion_ward_stone', 'bastion_ward_stone']);
    expect(stones.map((o) => [o.pos.x - DOOR.x, o.pos.z - DOOR.z])).toEqual([
      [-2, -3],
      [3, 2],
    ]);
    for (const { pos } of stones) {
      // the stone itself is not inside a wall
      expect(gateHits(pos.x, pos.z, 0.15), `${pos.x},${pos.z}`).toBe(false);
    }
    // the far one has a yard of open ground on every side
    expect(gateHits(stones[1].pos.x, stones[1].pos.z, 1.0)).toBe(false);
  });

  it('a player walks from the exit drop to each: the near one in the arch, the far one round the west tower', () => {
    const sim = makeSim();
    place(sim, EXIT_DROP.x, EXIT_DROP.z, 0);
    expect(walkTo(sim, stones[0].pos.x + 0.9, stones[0].pos.z - 0.6, 0.6, 200), 'near stone').toBe(
      true,
    );
    expect(
      Math.hypot(sim.player.pos.x - stones[0].pos.x, sim.player.pos.z - stones[0].pos.z),
    ).toBeLessThan(2);
    expect(sim.player.pos.x, 'never taken by the door').toBeLessThan(DUNGEON_X_THRESHOLD);
    // round the outside of the west tower and up behind the gate front
    for (const [lx, lz] of [
      [2.5, -5.2],
      [7.6, -5.6],
      [11.4, -2.6],
      [11.0, 1.6],
      [7.2, 3.4],
      [3.7, 2.3],
    ]) {
      expect(walkTo(sim, DOOR.x + lx, DOOR.z + lz, 0.6, 500), `waypoint ${lx},${lz}`).toBe(true);
    }
    expect(
      Math.hypot(sim.player.pos.x - stones[1].pos.x, sim.player.pos.z - stones[1].pos.z),
    ).toBeLessThan(1.6);
    expect(sim.player.pos.x, 'never taken by the door on the way').toBeLessThan(
      DUNGEON_X_THRESHOLD,
    );
  });
});

describe('the Drowned Gate Tower sits on the real ground', () => {
  // Each footing's design burial under its LOWEST ground (build_bastion_entrance.py).
  const DESIGN_BURY: readonly [string, number][] = [
    ['tower_', 0.8],
    ['gate_front', 0.6],
    ['court_wall_', 0.6],
    ['inner_arch', 0.6],
    ['flood_sill', 0.3],
    ['passage_wall_', 0.5],
    ['winch', 0.12],
    ['curtain_', 0.5],
    ['fallen_stones', 0.4],
  ];
  // The builder samples the same five points on a half-yard grid of the sim's
  // own terrain: a hair of interpolation and nothing else.
  const BURY_TOLERANCE = 0.08;

  it('every footing is below the ground at all of its corners, and never deeper than its design burial', () => {
    const base = terrainHeight(DOOR.x, DOOR.z, SEED);
    expect(SUNKEN_BASTION_ENTRANCE_FOOTINGS.length).toBeGreaterThanOrEqual(13);
    for (const f of SUNKEN_BASTION_ENTRANCE_FOOTINGS) {
      const design = DESIGN_BURY.find(([prefix]) => f.name.startsWith(prefix));
      expect(design, `${f.name} has a design burial`).toBeDefined();
      const c = Math.cos(f.rot);
      const s = Math.sin(f.rot);
      let lowest = Infinity;
      for (const [u, v] of [
        [0, 0],
        [-f.hw, -f.hd],
        [f.hw, -f.hd],
        [f.hw, f.hd],
        [-f.hw, f.hd],
      ]) {
        // three.js rotation.y, the colliders' own convention
        const x = DOOR.x + f.lx + u * c + v * s;
        const z = DOOR.z + f.lz - u * s + v * c;
        const ground = groundHeight(x, z, SEED) - base;
        // natural ground under every footing (no walkable lift field)
        expect(groundHeight(x, z, SEED) - terrainHeight(x, z, SEED)).toBeLessThan(0.01);
        // no gap: the underside never floats above the ground
        expect(
          f.bottom - ground,
          `${f.name} floats at ${x.toFixed(1)},${z.toFixed(1)}`,
        ).toBeLessThan(0.02);
        lowest = Math.min(lowest, ground);
      }
      // no sinking: at its lowest corner the footing is cut exactly as designed
      expect(lowest - f.bottom, `${f.name} is sunk`).toBeLessThanOrEqual(
        (design?.[1] ?? 0) + BURY_TOLERANCE,
      );
      expect(lowest - f.bottom, `${f.name} is shallow`).toBeGreaterThanOrEqual(
        (design?.[1] ?? 0) - BURY_TOLERANCE,
      );
    }
  });

  it('every collider row is well formed and stays inside the set piece', () => {
    expect(SUNKEN_BASTION_ENTRANCE_COLLIDERS.length).toBeGreaterThanOrEqual(15);
    const names = new Set<string>();
    for (const row of SUNKEN_BASTION_ENTRANCE_COLLIDERS) {
      expect(names.has(row.name), `${row.name} is unique`).toBe(false);
      names.add(row.name);
      expect(Math.hypot(row.lx, row.lz), row.name).toBeLessThan(24);
      expect(row.top, row.name).toBeGreaterThan(-2);
      if (row.type === 'obb') {
        expect(row.hw, row.name).toBeGreaterThan(0.1);
        expect(row.hd, row.name).toBeGreaterThan(0.1);
      } else {
        expect(row.r, row.name).toBeGreaterThan(0.3);
      }
    }
    // the towers stand well over a 1.8 yd character, the west one tallest
    const top = (name: string) =>
      SUNKEN_BASTION_ENTRANCE_COLLIDERS.find((r) => r.name === name)?.top ?? 0;
    expect(top('tower_w')).toBeGreaterThan(12);
    expect(top('tower_e')).toBeGreaterThan(7);
    expect(top('front_wall_w')).toBeGreaterThan(8);
    expect(top('tower_w')).toBeGreaterThan(top('tower_e'));
  });

  it('the camera tops are seated on the door height', () => {
    const base = terrainHeight(DOOR.x, DOOR.z, SEED);
    const built = sunkenBastionEntranceColliders(SEED, DOOR);
    expect(built).toHaveLength(SUNKEN_BASTION_ENTRANCE_COLLIDERS.length);
    built.forEach((c, i) => {
      const row = SUNKEN_BASTION_ENTRANCE_COLLIDERS[i];
      expect(c.x).toBeCloseTo(DOOR.x + row.lx, 9);
      expect(c.z).toBeCloseTo(DOOR.z + row.lz, 9);
      expect(c.cameraTopY).toBeCloseTo(base + row.top, 9);
      expect(c.type).toBe(row.type);
    });
  });
});

const near80 = (x: number, z: number) => Math.hypot(x - DOOR.x, z - DOOR.z) < 80;

describe('the Drowned Gate Tower walls nothing in', () => {
  it('the scatter it stands on is cleared, and no other tree or rock is inside a collider', () => {
    expect(SUNKEN_BASTION_ENTRANCE_CLEARED_SCATTER).toHaveLength(2);
    for (const spot of SUNKEN_BASTION_ENTRANCE_CLEARED_SCATTER) {
      expect(isExcludedDecoration(spot.x, spot.z)).toBe(true);
      expect(Math.hypot(spot.x - DOOR.x, spot.z - DOOR.z)).toBeLessThan(10);
    }
    const scatter = generateDecorationsInBounds(SEED, {
      minX: DOOR.x - 30,
      maxX: DOOR.x + 30,
      minZ: DOOR.z - 30,
      maxZ: DOOR.z + 30,
    });
    // the guard is not vacuous: the knoll has its own trees and rocks
    expect(scatter.length).toBeGreaterThanOrEqual(8);
    for (const d of scatter) {
      expect(gateHits(d.x, d.z, 0.6), `${d.kind} at ${d.x.toFixed(1)},${d.z.toFixed(1)}`).toBe(
        false,
      );
      for (const spot of SUNKEN_BASTION_ENTRANCE_CLEARED_SCATTER) {
        expect(Math.hypot(d.x - spot.x, d.z - spot.z)).toBeGreaterThan(1.2);
      }
    }
  });

  it('no NPC or gather node stands inside a gatehouse collider', () => {
    let npcs = 0;
    for (const npc of Object.values(NPCS)) {
      if (!near80(npc.pos.x, npc.pos.z)) continue;
      npcs++;
      expect(gateHits(npc.pos.x, npc.pos.z, 0.6), npc.id).toBe(false);
    }
    let nodes = 0;
    for (const node of GATHER_NODES) {
      if (!near80(node.pos.x, node.pos.z)) continue;
      expect(gateHits(node.pos.x, node.pos.z, 1.5), node.id).toBe(false);
      nodes++;
    }
    // the guard is not vacuous: the ore node on the road below is a neighbour
    expect(nodes).toBeGreaterThanOrEqual(1);
    expect(npcs + nodes).toBeGreaterThanOrEqual(1);
  });

  it('no mob of a fresh world spawns inside a gatehouse collider', () => {
    const sim = makeSim();
    let mobs = 0;
    for (const e of sim.entities.values()) {
      if (e.kind !== 'mob' || !near80(e.pos.x, e.pos.z)) continue;
      mobs++;
      expect(
        gateHits(e.pos.x, e.pos.z, 0.3),
        `${e.templateId} at ${e.pos.x.toFixed(1)},${e.pos.z.toFixed(1)}`,
      ).toBe(false);
    }
    // Sister Nhalia and the Gravecallers camp below the knoll
    expect(mobs).toBeGreaterThanOrEqual(1);
  });
});
