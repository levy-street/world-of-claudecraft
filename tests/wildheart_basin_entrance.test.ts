// The Wildheart Basin's world entrance, the Jaguar Maw
// (src/sim/wildheart_basin_entrance.ts, drawn by
// src/render/wildheart_basin_entrance.ts): the idol's muzzle is the door's
// jambs and the lane between its lower teeth is the walk-in trigger; the door
// stands on the low rise beside the Sunken Idol's ring, and a player walks to
// it from the road's end or from the ring on near-flat open ground, is taken
// by the door under the fangs, and stands on open ground at the exit drop; the
// palms the set piece stands on are cleared and the ones cleared for its old
// place stand again; every footing of the Blender model sits in the sim's own
// ground; and nothing around the door, mob spawns included, is walled in.
import { describe, expect, it } from 'vitest';
import { isBlocked } from '../src/sim/colliders';
import { DUNGEON_X_THRESHOLD, DUNGEONS, GATHER_NODES, MOBS, NPCS, ROADS } from '../src/sim/data';
import { isExcludedDecoration } from '../src/sim/decoration_exclusions';
import { MAX_AGGRO_RADIUS } from '../src/sim/mob/locomotion';
import { PLAYER_BODY_RADIUS } from '../src/sim/pathfind';
import { Sim } from '../src/sim/sim';
import type { MoveInput } from '../src/sim/types';
import {
  onWildheartBasinEntranceCauseway,
  WILDHEART_BASIN_ENTRANCE_CLEARED_SCATTER,
  WILDHEART_BASIN_ENTRANCE_COLLIDERS,
  WILDHEART_BASIN_ENTRANCE_FOOTINGS,
  WILDHEART_BASIN_ENTRANCE_LANE_HALF_WIDTH,
  WILDHEART_BASIN_ENTRANCE_RING,
  WILDHEART_BASIN_ENTRANCE_WAYS,
  wildheartBasinEntranceColliders,
} from '../src/sim/wildheart_basin_entrance';
import {
  generateDecorationsInBounds,
  groundHeight,
  reachPalmSpots,
  terrainHeight,
  terrainSteepness,
  WATER_LEVEL,
} from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

const SEED = WORLD_SEED;
const DOOR = DUNGEONS.wildheart_basin.doorPos;
// The walk-in trigger (instances/dungeons.ts DOOR_TRIGGER_RADIUS): a shipped
// constant the module does not export, pinned here as the literal it is.
const DOOR_TRIGGER_RADIUS = 2;
const EXIT_DROP = { x: DOOR.x, z: DOOR.z - 4 };
// Where the road comes up from the south and turns away north-east.
const ROAD_END = { x: -256, z: 1072 };
// A way in is this wide either side of its line: three bodies abreast.
const WAY_HALF_WIDTH = 1.5;
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

/** Circle-vs-shape overlap against the idol's own solids only. */
function idolHits(x: number, z: number, r: number): boolean {
  return wildheartBasinEntranceColliders(SEED, DOOR).some((c) => {
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

const row = (name: string) => {
  const found = WILDHEART_BASIN_ENTRANCE_COLLIDERS.find((r) => r.name === name);
  if (!found) throw new Error(`no collider row ${name}`);
  return found;
};

const way = (name: string) => {
  const found = WILDHEART_BASIN_ENTRANCE_WAYS.find((w) => w.name === name);
  if (!found) throw new Error(`no way ${name}`);
  return found;
};

/** A way's line in world coordinates, a sample every half yard. */
function waySamples(name: string): { x: number; z: number; lz: number; ux: number; uz: number }[] {
  const out: { x: number; z: number; lz: number; ux: number; uz: number }[] = [];
  const points = way(name).points;
  for (let i = 0; i + 1 < points.length; i++) {
    const [ax, az] = points[i];
    const [bx, bz] = points[i + 1];
    const length = Math.hypot(bx - ax, bz - az);
    const steps = Math.ceil(length / 0.5);
    for (let k = i === 0 ? 0 : 1; k <= steps; k++) {
      const t = k / steps;
      out.push({
        x: DOOR.x + ax + (bx - ax) * t,
        z: DOOR.z + az + (bz - az) * t,
        lz: az + (bz - az) * t,
        ux: (bx - ax) / length,
        uz: (bz - az) / length,
      });
    }
  }
  return out;
}

describe('the Jaguar Maw stands in for the generic door arch', () => {
  it('the door is the Basin door at (-237, 1093), on the rise beside the ring, well over the lagoon', () => {
    expect(DOOR).toEqual({ x: -237, z: 1093 });
    const base = terrainHeight(DOOR.x, DOOR.z, SEED);
    expect(base).toBeCloseTo(1.7269, 3);
    // six yards over the lagoon: the maw is never at the waterline again
    expect(base - WATER_LEVEL).toBeGreaterThan(5.5);
    // the exit drop is two thirds of a yard down the causeway, not up a knoll
    const drop = base - terrainHeight(EXIT_DROP.x, EXIT_DROP.z, SEED);
    expect(drop).toBeGreaterThan(0.3);
    expect(drop).toBeLessThan(1);
    // the ring of columns is the neighbour to the east, the road's end to the south-east
    const ring = WILDHEART_BASIN_ENTRANCE_RING;
    expect(Math.hypot(DOOR.x - ring.x, DOOR.z - ring.z)).toBeGreaterThan(ring.radius + 10);
    expect(Math.hypot(DOOR.x - ring.x, DOOR.z - ring.z)).toBeLessThan(22);
    expect(ROADS.some((road) => road.some((p) => p.x === ROAD_END.x && p.z === ROAD_END.z))).toBe(
      true,
    );
  });

  it('the head, the muzzle, the fire bowls, the tusks and the fallen ear block', () => {
    const head = row('head');
    expect(isBlocked(SEED, DOOR.x + head.lx, DOOR.z + head.lz, 0.4), 'head').toBe(true);
    // the round head from every side, a yard inside its face
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const r = (head.r ?? 0) - 1;
      expect(
        isBlocked(
          SEED,
          DOOR.x + head.lx + Math.sin(a) * r,
          DOOR.z + head.lz + Math.cos(a) * r,
          0.3,
        ),
        `head at ${k}`,
      ).toBe(true);
    }
    for (const sx of [-1, 1]) {
      expect(isBlocked(SEED, DOOR.x + sx * 3.2, DOOR.z - 0.4, 0.3), `muzzle ${sx}`).toBe(true);
      expect(isBlocked(SEED, DOOR.x + sx * 5.5, DOOR.z + 0.4, 0.3), `muzzle end ${sx}`).toBe(true);
      // the lower teeth: no slipping past the lane's edge into the stone
      expect(isBlocked(SEED, DOOR.x + sx * 1.9, DOOR.z - 0.6, PLAYER_BODY_RADIUS)).toBe(true);
    }
    for (const name of ['brazier_w', 'brazier_e', 'tusk_w', 'tusk_e', 'fallen_ear']) {
      const r = row(name);
      expect(isBlocked(SEED, DOOR.x + r.lx, DOOR.z + r.lz, 0.3), name).toBe(true);
    }
    // the black water in the throat is closed
    expect(isBlocked(SEED, DOOR.x, DOOR.z + 1.6, 0.4), 'the flooded throat').toBe(true);
    expect(isBlocked(SEED, DOOR.x, DOOR.z + 5, 0.4), 'its far end').toBe(true);
  });

  it('the lane between the lower teeth is open, and every place in it is inside the trigger', () => {
    const half = WILDHEART_BASIN_ENTRANCE_LANE_HALF_WIDTH;
    expect(half).toBeLessThan(DOOR_TRIGGER_RADIUS);
    expect(half).toBeGreaterThan(PLAYER_BODY_RADIUS * 2);
    // down the middle, from the causeway to the door
    for (const lz of [-3, -2, -1, 0]) {
      expect(isBlocked(SEED, DOOR.x, DOOR.z + lz, PLAYER_BODY_RADIUS), `lane ${lz}`).toBe(false);
    }
    // between the muzzle's two halves a body can only stand inside the trigger
    let open = 0;
    for (let lx = -half; lx <= half + 1e-6; lx += 0.15) {
      for (let lz = -1.2; lz <= 3; lz += 0.15) {
        if (idolHits(DOOR.x + lx, DOOR.z + lz, PLAYER_BODY_RADIUS)) continue;
        open++;
        expect(Math.hypot(lx, lz), `${lx.toFixed(2)},${lz.toFixed(2)}`).toBeLessThan(
          DOOR_TRIGGER_RADIUS,
        );
      }
    }
    expect(open).toBeGreaterThan(20);
  });

  it('the exit drop is outside the trigger, on open ground on the causeway', () => {
    expect(EXIT_DROP.z).toBeLessThan(DOOR.z - DOOR_TRIGGER_RADIUS);
    expect(isBlocked(SEED, EXIT_DROP.x, EXIT_DROP.z, 0.9)).toBe(false);
    expect(idolHits(EXIT_DROP.x, EXIT_DROP.z, 1.2)).toBe(false);
    expect(onWildheartBasinEntranceCauseway(DOOR, EXIT_DROP.x, EXIT_DROP.z)).toBe(true);
  });
});

describe('the ways in are easy: near-flat ground and nothing in the lane', () => {
  it('the three ways are the causeway, the road and the ring, and they meet', () => {
    expect(WILDHEART_BASIN_ENTRANCE_WAYS.map((w) => w.name)).toEqual(['causeway', 'road', 'ring']);
    const causeway = way('causeway').points;
    const road = way('road').points;
    const ring = way('ring').points;
    // the road's way starts on the road's end and hands over at the causeway's foot
    expect(DOOR.x + road[0][0]).toBe(ROAD_END.x);
    expect(DOOR.z + road[0][1]).toBe(ROAD_END.z);
    expect(road[road.length - 1]).toEqual(causeway[0]);
    // the ring's way starts on the ring's own edge, in its west gap, and joins the causeway
    const r = WILDHEART_BASIN_ENTRANCE_RING;
    expect(Math.hypot(DOOR.x + ring[0][0] - r.x, DOOR.z + ring[0][1] - r.z)).toBeCloseTo(
      r.radius,
      6,
    );
    const join = ring[ring.length - 1];
    expect(onWildheartBasinEntranceCauseway(DOOR, DOOR.x + join[0], DOOR.z + join[1])).toBe(true);
    // the causeway ends on the door's own step, inside the trigger
    const end = causeway[causeway.length - 1];
    expect(Math.hypot(end[0], end[1])).toBeLessThan(DOOR_TRIGGER_RADIUS);
    for (const [lx, lz] of causeway) {
      expect(onWildheartBasinEntranceCauseway(DOOR, DOOR.x + lx, DOOR.z + lz)).toBe(true);
    }
  });

  for (const name of ['causeway', 'road', 'ring'] as const) {
    it(`${name}: the walk surface never steepens past a gentle ramp`, () => {
      const samples = waySamples(name);
      expect(samples.length).toBeGreaterThan(20);
      let low = Infinity;
      let high = -Infinity;
      for (const s of samples) {
        const h = groundHeight(s.x, s.z, SEED);
        low = Math.min(low, h);
        high = Math.max(high, h);
        // along the way: under one yard up in three (the old door asked five in seven)
        const ahead = groundHeight(s.x + s.ux * 0.5, s.z + s.uz * 0.5, SEED);
        expect(Math.abs(ahead - h) / 0.5, `along ${name} at lz ${s.lz.toFixed(1)}`).toBeLessThan(
          0.3,
        );
        // across it: the lane does not tip a walker off its side
        for (const side of [-WAY_HALF_WIDTH, WAY_HALF_WIDTH]) {
          const beside = groundHeight(s.x - s.uz * side, s.z + s.ux * side, SEED);
          expect(
            Math.abs(beside - h) / WAY_HALF_WIDTH,
            `across ${name} at lz ${s.lz.toFixed(1)}`,
          ).toBeLessThan(0.35);
        }
        // and the terrain itself is nowhere near a wall
        expect(terrainSteepness(s.x, s.z, SEED), `steepness at lz ${s.lz.toFixed(1)}`).toBeLessThan(
          0.35,
        );
        // dry land all the way
        expect(h).toBeGreaterThan(WATER_LEVEL + 2);
      }
      // the whole way rises and falls by no more than the rise the door stands on
      expect(high - low).toBeLessThan(2.2);
    });

    it(`${name}: no collider, palm or rock stands in the lane`, () => {
      for (const s of waySamples(name)) {
        // the last yards of the causeway run between the fire bowls and then
        // between the lower teeth: there the lane is a body wide, by design
        const mouth = name === 'causeway' && s.lz > -2.6;
        const half = mouth ? PLAYER_BODY_RADIUS : WAY_HALF_WIDTH;
        expect(isBlocked(SEED, s.x, s.z, half), `${name} at lz ${s.lz.toFixed(1)}`).toBe(false);
      }
      const palms = reachPalmSpots(SEED);
      for (const s of waySamples(name)) {
        for (const p of palms) {
          expect(Math.hypot(p.x - s.x, p.z - s.z)).toBeGreaterThan(p.r + WAY_HALF_WIDTH + 1);
        }
      }
    });
  }

  it('the old door asked a climb the new one does not', () => {
    // The knoll that stood before the old door was the door's own calm pad
    // (terrain_calm_anchors.ts): with the door gone from (-232, 1112) the
    // shore there is the lagoon's own again, and the knoll's crest is low.
    expect(terrainHeight(-232, 1112, SEED)).toBeLessThan(WATER_LEVEL + 0.6);
    expect(terrainHeight(-236, 1106, SEED)).toBeLessThan(1);
    // nothing of the set piece is left there
    expect(idolHits(-232, 1112, 2)).toBe(false);
    expect(idolHits(-232, 1120.8, 1)).toBe(false);
  });
});

describe('a player walks in from the road and from the ring', () => {
  it("road's end to the causeway, up it into the trigger, then the exit drop and back down", () => {
    const sim = makeSim();
    const p = sim.player;
    place(sim, ROAD_END.x, ROAD_END.z, 0);
    for (const [lx, lz] of [
      ...way('road').points.slice(1),
      ...way('causeway').points.slice(1, -1),
    ]) {
      expect(walkTo(sim, DOOR.x + lx, DOOR.z + lz, 0.8, 400), `reached ${lx}, ${lz}`).toBe(true);
    }
    // the walk never left the ground it started on by more than the rise
    expect(p.pos.y - groundHeight(ROAD_END.x, ROAD_END.z, SEED)).toBeLessThan(2.4);
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
    const foot = way('causeway').points[0];
    expect(walkTo(sim, DOOR.x + foot[0], DOOR.z + foot[1], 0.8, 800), 'back to the foot').toBe(
      true,
    );
    expect(walkTo(sim, ROAD_END.x, ROAD_END.z, 0.8, 800), "back to the road's end").toBe(true);
  });

  it("the ring's west gap to the causeway and into the trigger", () => {
    const sim = makeSim();
    const p = sim.player;
    const points = way('ring').points;
    place(sim, DOOR.x + points[0][0], DOOR.z + points[0][1], 0);
    for (const [lx, lz] of points.slice(1)) {
      expect(walkTo(sim, DOOR.x + lx, DOOR.z + lz, 0.8, 400), `reached ${lx}, ${lz}`).toBe(true);
    }
    walkTo(sim, DOOR.x, DOOR.z - 3, 0.6, 400);
    walkTo(sim, DOOR.x, DOOR.z + 6, 0.5, 400);
    expect(p.pos.x, 'walked into the instance').toBeGreaterThan(DUNGEON_X_THRESHOLD);
  });
});

describe('the Blender model sits in the ground the sim walks on', () => {
  it('no footing floats over the ground under it', () => {
    const base = terrainHeight(DOOR.x, DOOR.z, SEED);
    expect(WILDHEART_BASIN_ENTRANCE_FOOTINGS.map((f) => f.name)).toEqual([
      'head',
      'muzzle',
      'brazier_w',
      'brazier_e',
      'tusk_w',
      'tusk_e',
      'fallen_ear',
    ]);
    for (const f of WILDHEART_BASIN_ENTRANCE_FOOTINGS) {
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
        const x = DOOR.x + f.lx + u * c + v * s;
        const z = DOOR.z + f.lz - u * s + v * c;
        lowest = Math.min(lowest, groundHeight(x, z, SEED) - base);
      }
      // cut under the lowest of its centre and four corners, and never absurdly deep
      expect(lowest - f.bottom, f.name).toBeGreaterThan(0.15);
      expect(lowest - f.bottom, f.name).toBeLessThan(1.5);
    }
  });

  it("the head's foot is under the ground all the way round its drum", () => {
    // The rise falls four yards from the maw round to the lagoon side: the
    // drum's foot is cut under the lowest of it, with room for the idol's lean.
    const base = terrainHeight(DOOR.x, DOOR.z, SEED);
    const head = row('head');
    const foot = WILDHEART_BASIN_ENTRANCE_FOOTINGS[0].bottom;
    let lowest = Infinity;
    let highest = -Infinity;
    for (let k = 0; k < 72; k++) {
      const a = (k / 72) * Math.PI * 2;
      const g =
        groundHeight(
          DOOR.x + head.lx + Math.sin(a) * (head.r ?? 0),
          DOOR.z + head.lz + Math.cos(a) * (head.r ?? 0),
          SEED,
        ) - base;
      lowest = Math.min(lowest, g);
      highest = Math.max(highest, g);
      expect(g - foot, `drum at ${k}`).toBeGreaterThan(0.6);
    }
    expect(highest - lowest).toBeGreaterThan(3);
    // and the knoll never stands in the maw: the ground under the window and
    // before the fangs stays within a hand of the door's own height
    for (const lz of [-1.6, -0.8, 0, 0.8, 1.3]) {
      for (const lx of [-1.3, 0, 1.3]) {
        const g = groundHeight(DOOR.x + lx, DOOR.z + lz, SEED) - base;
        expect(g, `maw floor at ${lx}, ${lz}`).toBeLessThan(0.3);
        expect(g, `maw floor at ${lx}, ${lz}`).toBeGreaterThan(-0.45);
      }
    }
  });

  it('every collider row is well formed and stays inside the set piece', () => {
    expect(WILDHEART_BASIN_ENTRANCE_COLLIDERS.map((r) => r.name)).toEqual([
      'head',
      'muzzle_w',
      'muzzle_e',
      'brazier_w',
      'brazier_e',
      'tusk_w',
      'tusk_e',
      'fallen_ear',
    ]);
    for (const r of WILDHEART_BASIN_ENTRANCE_COLLIDERS) {
      expect(Math.hypot(r.lx, r.lz), r.name).toBeLessThan(15);
      if (r.type === 'obb') {
        expect(r.hw, r.name).toBeGreaterThan(0.1);
        expect(r.hd, r.name).toBeGreaterThan(0.1);
      } else {
        expect(r.r, r.name).toBeGreaterThan(0.3);
      }
    }
    // the head stands eight character heights over the door, the muzzle four
    expect(row('head').top).toBeGreaterThan(14);
    expect(row('muzzle_w').top).toBeGreaterThan(7);
    expect(row('muzzle_w').lx).toBeCloseTo(-row('muzzle_e').lx, 6);
    // the fire bowls flank the maw at one height; the tusks stand at the causeway's foot
    expect(row('brazier_w').lx).toBeCloseTo(-row('brazier_e').lx, 6);
    expect(row('brazier_w').top).toBe(row('brazier_e').top);
    expect(row('tusk_w').lz).toBeLessThan(-10);
    expect(row('tusk_e').lz).toBeLessThan(-10);
    expect(row('tusk_w').lx - row('tusk_e').lx).toBeGreaterThan(8);
  });

  it("every solid keeps four yards clear of the Sunken Idol's ring of columns", () => {
    const ring = WILDHEART_BASIN_ENTRANCE_RING;
    expect(ring).toEqual({ x: -256, z: 1090, radius: 8, clear: 4 });
    for (const r of WILDHEART_BASIN_ENTRANCE_COLLIDERS) {
      const reach = r.type === 'obb' ? Math.hypot(r.hw ?? 0, r.hd ?? 0) : (r.r ?? 0);
      const d = Math.hypot(DOOR.x + r.lx - ring.x, DOOR.z + r.lz - ring.z) - reach;
      expect(d, r.name).toBeGreaterThanOrEqual(ring.radius + ring.clear);
    }
    // the causeway's paving too
    for (let lz = -15; lz <= 1; lz += 0.5) {
      for (let lx = -8; lx <= 8; lx += 0.5) {
        if (!onWildheartBasinEntranceCauseway(DOOR, DOOR.x + lx, DOOR.z + lz)) continue;
        expect(Math.hypot(DOOR.x + lx - ring.x, DOOR.z + lz - ring.z)).toBeGreaterThan(
          ring.radius + ring.clear,
        );
      }
    }
  });

  it('the camera tops are seated on the door height', () => {
    const base = terrainHeight(DOOR.x, DOOR.z, SEED);
    const built = wildheartBasinEntranceColliders(SEED, DOOR);
    expect(built).toHaveLength(WILDHEART_BASIN_ENTRANCE_COLLIDERS.length);
    built.forEach((c, i) => {
      const r = WILDHEART_BASIN_ENTRANCE_COLLIDERS[i];
      expect(c.x).toBeCloseTo(DOOR.x + r.lx, 9);
      expect(c.z).toBeCloseTo(DOOR.z + r.lz, 9);
      expect(c.cameraTopY).toBeCloseTo(base + r.top, 9);
      expect(c.type).toBe(r.type);
    });
  });
});

describe("the causeway's paving", () => {
  it('runs from the flat into the maw, swinging east at its foot', () => {
    const on = (lx: number, lz: number, pad = 0) =>
      onWildheartBasinEntranceCauseway(DOOR, DOOR.x + lx, DOOR.z + lz, pad);
    // between the lower teeth, a body and a half either side
    expect(on(0, 0)).toBe(true);
    expect(on(2.2, 0)).toBe(true);
    expect(on(2.4, 0)).toBe(false);
    expect(on(0, 1.0)).toBe(true);
    expect(on(0, 1.2)).toBe(false);
    // wider before the fire bowls, and never as far out as they stand
    expect(on(2.9, -3.4)).toBe(true);
    expect(on(row('brazier_w').lx - 1, -3.4)).toBe(false);
    // its foot is a yard and a half east of the door's line
    expect(on(-5, -14)).toBe(true);
    expect(on(2.2, -14)).toBe(false);
    expect(on(1.8, -14)).toBe(true);
    expect(on(-1.6, -14.6)).toBe(true);
    expect(on(-1.6, -14.7)).toBe(false);
    // the pad widens it on every side but the throat's
    expect(on(-1.6, -14.8, 0.3)).toBe(true);
    expect(on(2.5, 0, 0.3)).toBe(true);
    expect(on(0, 1.3, 0.3)).toBe(false);
  });
});

const near80 = (x: number, z: number) => Math.hypot(x - DOOR.x, z - DOOR.z) < 80;

describe('the Jaguar Maw walls nothing in', () => {
  it('the palms it stands on are cleared, and no other palm, tree or rock is inside a collider', () => {
    expect(WILDHEART_BASIN_ENTRANCE_CLEARED_SCATTER).toHaveLength(2);
    for (const spot of WILDHEART_BASIN_ENTRANCE_CLEARED_SCATTER) {
      expect(isExcludedDecoration(spot.x, spot.z)).toBe(true);
      expect(Math.hypot(spot.x - DOOR.x, spot.z - DOOR.z)).toBeLessThan(18);
    }
    // one grew on the door itself; the other stood by the way in from the road
    expect(
      Math.hypot(
        WILDHEART_BASIN_ENTRANCE_CLEARED_SCATTER[0].x - DOOR.x,
        WILDHEART_BASIN_ENTRANCE_CLEARED_SCATTER[0].z - DOOR.z,
      ),
    ).toBeLessThan(0.5);
    const palms = reachPalmSpots(SEED);
    // the guard is not vacuous: the strand still has its palms, three of them near the idol
    expect(palms.length).toBeGreaterThan(250);
    expect(palms.filter((p) => Math.hypot(p.x - DOOR.x, p.z - DOOR.z) < 26)).toHaveLength(3);
    for (const p of palms) {
      expect(idolHits(p.x, p.z, p.r + 0.4), `palm at ${p.x.toFixed(1)},${p.z.toFixed(1)}`).toBe(
        false,
      );
      for (const spot of WILDHEART_BASIN_ENTRANCE_CLEARED_SCATTER) {
        expect(Math.hypot(p.x - spot.x, p.z - spot.z)).toBeGreaterThan(1.2);
      }
    }
    const scatter = generateDecorationsInBounds(SEED, {
      minX: DOOR.x - 30,
      maxX: DOOR.x + 30,
      minZ: DOOR.z - 30,
      maxZ: DOOR.z + 30,
    });
    for (const d of scatter) {
      expect(idolHits(d.x, d.z, 0.6), `${d.kind} at ${d.x.toFixed(1)},${d.z.toFixed(1)}`).toBe(
        false,
      );
    }
  });

  it('the two palms cleared for the old door stand again', () => {
    const palms = reachPalmSpots(SEED);
    for (const old of [
      { x: -230.27577486773953, z: 1110.0866696499288 },
      { x: -243.16279729665257, z: 1118.9681632742286 },
    ]) {
      expect(isExcludedDecoration(old.x, old.z)).toBe(false);
      expect(palms.filter((p) => Math.hypot(p.x - old.x, p.z - old.z) < 0.01)).toHaveLength(1);
    }
  });

  it('no NPC or gather node stands inside a collider of the idol', () => {
    for (const npc of Object.values(NPCS)) {
      if (!near80(npc.pos.x, npc.pos.z)) continue;
      expect(idolHits(npc.pos.x, npc.pos.z, 0.6), npc.id).toBe(false);
    }
    for (const node of GATHER_NODES) {
      if (!near80(node.pos.x, node.pos.z)) continue;
      expect(idolHits(node.pos.x, node.pos.z, 1.5), node.id).toBe(false);
    }
  });

  it('no mob of a fresh world spawns inside a collider of the idol', () => {
    const sim = makeSim();
    let mobs = 0;
    for (const e of sim.entities.values()) {
      if (e.kind !== 'mob' || !near80(e.pos.x, e.pos.z)) continue;
      mobs++;
      expect(
        idolHits(e.pos.x, e.pos.z, 0.3),
        `${e.templateId} at ${e.pos.x.toFixed(1)},${e.pos.z.toFixed(1)}`,
      ).toBe(false);
    }
    // the Idol Guardian in its ring of columns is a neighbour
    expect(mobs).toBeGreaterThanOrEqual(1);
  });

  it('the Idol Guardian spawns in the far half of its ring, well off the exit drop', () => {
    // SCOPE: the spawn point only, like tests/dungeon_entry_clearance.test.ts.
    // Its camp sits in the east half of the ring, so it stands its 14 yd
    // aggro radius plus most of an idle wander (9 yd at most) from where a
    // party leaves the dungeon.
    const sim = makeSim();
    const ring = WILDHEART_BASIN_ENTRANCE_RING;
    const guardians = [...sim.entities.values()].filter((e) => e.templateId === 'idol_guardian');
    expect(guardians).toHaveLength(1);
    const g = guardians[0];
    expect(Math.hypot(g.pos.x - DOOR.x, g.pos.z - DOOR.z)).toBeGreaterThanOrEqual(
      MAX_AGGRO_RADIUS - 1e-6,
    );
    expect(Math.hypot(g.pos.x - ring.x, g.pos.z - ring.z)).toBeLessThan(ring.radius);
    expect(Math.hypot(g.pos.x - EXIT_DROP.x, g.pos.z - EXIT_DROP.z)).toBeGreaterThanOrEqual(
      (MOBS.idol_guardian.aggroRadius ?? 0) + 8,
    );
  });
});
