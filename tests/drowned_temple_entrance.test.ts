// The Drowned Temple's world entrance, the Moon Stair
// (src/sim/drowned_temple_entrance.ts and the walk surface in
// src/sim/drowned_temple_stair.ts, drawn by
// src/render/drowned_temple_entrance.ts): the moongate ring's two feet frame
// the door's lane, and the lane is the walk-in trigger; the dais and the
// flight are a built mass over the gully, walked on through groundHeight; a
// player wades the mirror, climbs the flight and is taken by the door, and
// walks back down from the exit drop; Ondrel keeps his post beside the breach
// in the west cheek and is walked to through it; the four warded shore-rocks
// stay within reach (one lies on a tread, on purpose); the old column ring is
// gone but the ground it calmed is unchanged; every footing of the Blender
// model sits in the sim's own terrain; and nothing round the door, mob spawns
// included, is walled in.
import { describe, expect, it } from 'vitest';
import { isBlocked } from '../src/sim/colliders';
import { TEMPLE_PROPS } from '../src/sim/content/temple';
import { DUNGEON_X_THRESHOLD, DUNGEONS, GATHER_NODES, GROUND_OBJECTS, NPCS } from '../src/sim/data';
import {
  DROWNED_TEMPLE_ENTRANCE_COLLIDERS,
  DROWNED_TEMPLE_ENTRANCE_FOOTINGS,
  DROWNED_TEMPLE_ENTRANCE_LANE_HALF_WIDTH,
  DROWNED_TEMPLE_ENTRANCE_LEVELS,
  drownedTempleEntranceColliders,
} from '../src/sim/drowned_temple_entrance';
import {
  DROWNED_TEMPLE_STAIR,
  DROWNED_TEMPLE_STAIR_DOOR,
  drownedTempleStairHalfWidth,
  drownedTempleStairLocalSurface,
  drownedTempleStairSurface,
} from '../src/sim/drowned_temple_stair';
import { PLAYER_BODY_RADIUS, PLAYER_MAX_CLIMB_SLOPE } from '../src/sim/pathfind';
import { Sim } from '../src/sim/sim';
import type { MoveInput } from '../src/sim/types';
import { groundHeight, terrainHeight } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

const SEED = WORLD_SEED;
const DOOR = DUNGEONS.drowned_temple.doorPos;
const BASE = terrainHeight(DOOR.x, DOOR.z, SEED);
// The walk-in trigger (instances/dungeons.ts DOOR_TRIGGER_RADIUS): a shipped
// constant the module does not export, pinned here as the literal it is.
const DOOR_TRIGGER_RADIUS = 2;
const EXIT_DROP = { x: DOOR.x, z: DOOR.z - 4 };
const S = DROWNED_TEMPLE_STAIR;
const L = DROWNED_TEMPLE_ENTRANCE_LEVELS;
const at = (lx: number, lz: number) => ({ x: DOOR.x + lx, z: DOOR.z + lz });
const ground = (lx: number, lz: number) => groundHeight(DOOR.x + lx, DOOR.z + lz, SEED) - BASE;
const terrain = (lx: number, lz: number) => terrainHeight(DOOR.x + lx, DOOR.z + lz, SEED) - BASE;
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

/** Circle-vs-shape overlap against the set piece's own solids only. */
function setHits(x: number, z: number, r: number): boolean {
  return drownedTempleEntranceColliders(SEED, DOOR).some((c) => {
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

const near = (x: number, z: number) => Math.hypot(x - DOOR.x, z - DOOR.z) < 60;
const row = (name: string) => {
  const found = DROWNED_TEMPLE_ENTRANCE_COLLIDERS.find((r) => r.name === name);
  if (!found) throw new Error(`no collider row ${name}`);
  return found;
};

describe('the Moon Stair stands in for the generic door arch', () => {
  it('the door is still the Temple door at (-70, 792), on the ground the model was built on', () => {
    expect(DOOR).toEqual({ x: -70, z: 792 });
    expect(DROWNED_TEMPLE_STAIR_DOOR.x).toBe(DOOR.x);
    expect(DROWNED_TEMPLE_STAIR_DOOR.z).toBe(DOOR.z);
    // the stair's leaf carries the door's terrain height as a literal (it may
    // not import the world): pinned here against the terrain itself
    expect(BASE).toBeCloseTo(6.623246433153554, 9);
    expect(DROWNED_TEMPLE_STAIR_DOOR.y).toBeCloseTo(BASE, 9);
    // the gully: six yards down to the old lake shelf in thirteen
    expect(terrain(0, -13)).toBeLessThan(-6);
    expect(terrain(0, -13)).toBeGreaterThan(-6.4);
  });

  it('the old column ring is gone: its row stays, with no columns, as the terrain calm anchor it was', () => {
    // the row stays as a terrain calm anchor with no columns: nothing of it
    // draws or collides (colliders.ts and render/props.ts skip a ring of none)
    expect(TEMPLE_PROPS.ruinRings).toEqual([{ x: -70, z: 792, ringR: 7, columns: 0 }]);
    // its toppled relics stood on the stair's head: open now
    for (const [lx, lz] of [
      [-2.4, -2.7],
      [0.1, -4.3],
      [-0.5, -5.2],
    ]) {
      expect(isBlocked(SEED, DOOR.x + lx, DOOR.z + lz, 0.3), `${lx},${lz}`).toBe(false);
    }
    // and one of its columns stood on the exit drop's lane
    expect(isBlocked(SEED, DOOR.x, DOOR.z - 7, 0.4)).toBe(false);
  });

  it('the ring, the cheeks, the colonnade, the penitents, the weir and the stelae block', () => {
    for (const sx of [-1, 1]) {
      expect(isBlocked(SEED, DOOR.x + sx * 3.75, DOOR.z, 0.4), `ring foot ${sx}`).toBe(true);
      expect(isBlocked(SEED, DOOR.x + sx * 5.2, DOOR.z - 4.6, 0.3), `column ${sx}`).toBe(true);
      expect(isBlocked(SEED, DOOR.x + sx * 6.7, DOOR.z - 15.7, 0.4), `penitent ${sx}`).toBe(true);
      // no slipping between the ring and its sill
      expect(isBlocked(SEED, DOOR.x + sx * 2.0, DOOR.z, PLAYER_BODY_RADIUS)).toBe(true);
    }
    expect(isBlocked(SEED, DOOR.x - 3.4, DOOR.z - 6, 0.3), 'east cheek').toBe(true);
    expect(isBlocked(SEED, DOOR.x + 3.4, DOOR.z - 3.4, 0.3), 'west cheek above the breach').toBe(
      true,
    );
    expect(isBlocked(SEED, DOOR.x + 3.4, DOOR.z - 9, 0.3), 'west cheek below the breach').toBe(
      true,
    );
    for (const name of ['weir_3', 'weir_5', 'stela_162', 'fallen_drums']) {
      const r = row(name);
      expect(isBlocked(SEED, DOOR.x + r.lx, DOOR.z + r.lz, 0.3), name).toBe(true);
    }
  });

  it('the lane over the sill is open and narrower than the trigger', () => {
    expect(DROWNED_TEMPLE_ENTRANCE_LANE_HALF_WIDTH).toBeLessThan(DOOR_TRIGGER_RADIUS);
    for (let lx = -1; lx <= 1; lx += 0.5) {
      for (const lz of [-2.2, -1, 0, 1]) {
        expect(isBlocked(SEED, DOOR.x + lx, DOOR.z + lz, PLAYER_BODY_RADIUS), `${lx},${lz}`).toBe(
          false,
        );
      }
    }
    // the ring's feet begin where the lane ends: nobody walks the ring's plane outside the trigger
    for (let lx = DROWNED_TEMPLE_ENTRANCE_LANE_HALF_WIDTH + 0.5; lx < 5.9; lx += 0.25) {
      expect(isBlocked(SEED, DOOR.x + lx, DOOR.z, PLAYER_BODY_RADIUS), `west ${lx}`).toBe(true);
      expect(isBlocked(SEED, DOOR.x - lx, DOOR.z, PLAYER_BODY_RADIUS), `east ${lx}`).toBe(true);
    }
    // the exit drop is outside the trigger, on the flight, open
    expect(Math.hypot(EXIT_DROP.x - DOOR.x, EXIT_DROP.z - DOOR.z)).toBeGreaterThan(
      DOOR_TRIGGER_RADIUS,
    );
    expect(isBlocked(SEED, EXIT_DROP.x, EXIT_DROP.z, 0.9)).toBe(false);
  });
});

describe('the dais and the flight are walked on', () => {
  it('the walk surface is the masonry: the dais floor, then one tread after another', () => {
    expect(ground(0, -1.5)).toBeCloseTo(S.dais, 6);
    expect(ground(-5, 0.5)).toBeCloseTo(S.dais, 6);
    // the middle of every dry tread stands on that tread's top
    for (let k = 0; k < 22; k++) {
      const lz = S.daisZ0 - (k + 0.5) * S.tread;
      expect(ground(0, lz), `tread ${k}`).toBeCloseTo(S.dais - (k + 1) * S.riser, 6);
      expect(ground(0, lz) - terrain(0, lz), `tread ${k} stands over the gully`).toBeGreaterThan(
        0.3,
      );
    }
    // the surface is the leaf's own, and absolute
    expect(drownedTempleStairSurface(DOOR.x, DOOR.z - 6, SEED)).toBeCloseTo(
      BASE + drownedTempleStairLocalSurface(0, -6),
      9,
    );
    expect(drownedTempleStairSurface(DOOR.x + 40, DOOR.z, SEED)).toBe(Number.NEGATIVE_INFINITY);
    expect(drownedTempleStairSurface(DOOR.x, DOOR.z + 30, SEED)).toBe(Number.NEGATIVE_INFINITY);
    // one dais: the leaf's and the set piece's
    expect(S.dais).toBe(L.dais);
    // the flight meets the mirror's water at its twenty-third riser
    expect(S.dais - 23 * S.riser).toBeCloseTo(L.water, 6);
  });

  it('the flight runs out into the bed and the dais into the bank with no step', () => {
    // down the middle from the dais to the shelf: never a rise or a fall a body cannot walk
    let prev = ground(0, S.daisZ1 + 1);
    for (let lz = S.daisZ1 + 0.9; lz >= -20; lz -= 0.1) {
      const g = ground(0, lz);
      expect(Math.abs(g - prev) / 0.1, `at lz ${lz.toFixed(1)}`).toBeLessThan(
        PLAYER_MAX_CLIMB_SLOPE + 0.01,
      );
      prev = g;
    }
    // past the flight's foot the ground is the bed again
    expect(ground(0, -18) - terrain(0, -18)).toBeLessThan(0.01);
    // off each end of the dais the floor falls to the bank
    for (const sx of [-1, 1]) {
      let last = ground(sx * 7, -1);
      for (let lx = 7.1; lx <= 11; lx += 0.1) {
        const g = ground(sx * lx, -1);
        expect(Math.abs(g - last) / 0.1, `dais end ${sx} at ${lx.toFixed(1)}`).toBeLessThan(
          PLAYER_MAX_CLIMB_SLOPE + 0.01,
        );
        last = g;
      }
      expect(ground(sx * 11, -1) - terrain(sx * 11, -1)).toBeLessThan(0.01);
    }
    // the flight fans out below its cheeks
    expect(drownedTempleStairHalfWidth(-6)).toBe(S.halfWidth);
    expect(drownedTempleStairHalfWidth(-14)).toBeGreaterThan(S.halfWidth + 1);
  });

  it('a player wades the mirror, climbs the flight and is taken by the door, then walks back down', () => {
    const sim = makeSim();
    const p = sim.player;
    const foot = at(0.5, -21);
    place(sim, foot.x, foot.z, 0);
    // the mirror is dressing: the bed under it is the ground
    expect(p.pos.y - BASE).toBeLessThan(L.water);
    expect(walkTo(sim, DOOR.x, DOOR.z - 6, 0.8, 600), 'climbed the flight').toBe(true);
    expect(p.pos.y - BASE, 'on the treads, over the gully').toBeGreaterThan(terrain(0, -6) + 1);
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
    expect(walkTo(sim, foot.x, foot.z, 0.8, 800), 'back down to the mirror').toBe(true);
  }, 180_000);
});

describe('the walk surface belongs to the shipped world only', () => {
  it('on any other seed the door keeps its own natural ground: no mesa over a different gully', () => {
    for (const seed of [0, 1, 123, 4242]) {
      expect(seed).not.toBe(SEED);
      expect(drownedTempleStairSurface(DOOR.x, DOOR.z - 6, seed)).toBe(Number.NEGATIVE_INFINITY);
      for (const [lx, lz] of [
        [0, -1],
        [0, -6],
        [2, -11],
        [-6, 0],
      ]) {
        const x = DOOR.x + lx;
        const z = DOOR.z + lz;
        expect(groundHeight(x, z, seed), `seed ${seed} at ${lx},${lz}`).toBe(
          terrainHeight(x, z, seed),
        );
      }
    }
    // and the shipped seed does lift it
    expect(groundHeight(DOOR.x, DOOR.z - 6, SEED)).toBeGreaterThan(
      terrainHeight(DOOR.x, DOOR.z - 6, SEED) + 1,
    );
  });

  it('the open edges of the flight and the dais never wedge a walker', () => {
    const sim = makeSim();
    // up the fanned foot of the flight along each open edge, below the cheeks
    for (const sx of [-1, 1]) {
      const from = at(sx * (drownedTempleStairHalfWidth(-14) - 0.3), -14);
      place(sim, from.x, from.z, 0);
      expect(
        walkTo(sim, DOOR.x + sx * 1.5, DOOR.z - 9, 0.8, 400),
        `up the flight's edge ${sx}`,
      ).toBe(true);
    }
    // Off the south edge of the dais beside the west cheek: the nook between
    // the dais, the cheek, the first column and Ondrel's fire is no trap. A
    // walker drops into it and walks back up where the dais meets the bank.
    const edge = at(5.4, -2.0);
    place(sim, edge.x, edge.z, Math.PI);
    expect(walkTo(sim, DOOR.x + 5.4, DOOR.z - 3.3, 0.5, 300), 'off the dais into the nook').toBe(
      true,
    );
    expect(sim.player.pos.y - BASE, 'down on the natural ground').toBeLessThan(S.dais - 0.3);
    expect(walkTo(sim, DOOR.x + 6.8, DOOR.z - 3.0, 0.5, 300), 'along the foot of the dais').toBe(
      true,
    );
    expect(walkTo(sim, DOOR.x + 6.8, DOOR.z - 1.6, 0.5, 300), 'back up onto the dais').toBe(true);
    expect(sim.player.pos.y - BASE).toBeCloseTo(S.dais, 2);
    // and off the east edge the bank is open all the way out
    const east = at(-5.4, -2.0);
    place(sim, east.x, east.z, Math.PI);
    expect(walkTo(sim, DOOR.x - 5.6, DOOR.z - 3.2, 0.5, 300), 'off the dais on the east').toBe(
      true,
    );
    expect(walkTo(sim, DOOR.x - 9.5, DOOR.z - 4.5, 0.8, 400), 'out along the east bank').toBe(true);
    expect(sim.player.pos.x, 'never taken by the door').toBeLessThan(DUNGEON_X_THRESHOLD);
  }, 180_000);
});

describe('Ondrel, his camp and the shore-rocks stay within reach', () => {
  it('Ondrel stands on his own authored spot, on natural ground, clear of every solid', () => {
    const def = NPCS.tidewatcher_ondrel;
    expect(def.pos).toEqual({ x: -66, z: 786 });
    const sim = makeSim();
    const npc = [...sim.entities.values()].find((e) => e.templateId === 'tidewatcher_ondrel');
    expect(npc).toBeDefined();
    if (!npc) return;
    // not nudged off his post by a wall of the set piece
    expect(npc.pos.x).toBe(def.pos.x);
    expect(npc.pos.z).toBe(def.pos.z);
    expect(
      groundHeight(def.pos.x, def.pos.z, SEED) - terrainHeight(def.pos.x, def.pos.z, SEED),
    ).toBeLessThan(0.01);
    expect(setHits(def.pos.x, def.pos.z, 0.75)).toBe(false);
  }, 180_000);

  it('a player walks from the flight through the breach in the west cheek to Ondrel and on to his camp', () => {
    const sim = makeSim();
    const start = at(0, -5.2);
    place(sim, start.x, start.z, 0);
    const def = NPCS.tidewatcher_ondrel;
    expect(walkTo(sim, def.pos.x - 0.9, def.pos.z + 0.4, 0.7, 300), 'through the breach').toBe(
      true,
    );
    expect(sim.player.pos.x, 'never taken by the door').toBeLessThan(DUNGEON_X_THRESHOLD);
    // and on past him to the fire and the tent
    expect(walkTo(sim, DOOR.x + 8.6, DOOR.z - 5.6, 0.8, 300), 'to the camp').toBe(true);
    // and back up through the breach onto the flight
    expect(walkTo(sim, start.x, start.z, 0.8, 500), 'back onto the flight').toBe(true);
  }, 180_000);

  const rocks = GROUND_OBJECTS.flatMap((g) =>
    g.positions.filter((pos) => near(pos.x, pos.z)).map((pos) => ({ itemId: g.itemId, pos })),
  );

  it('the four warded shore-rocks keep their spots: three on natural ground, one on a tread', () => {
    expect(rocks.map((o) => o.itemId)).toEqual(Array(4).fill('moongate_rubbing'));
    expect(rocks.map((o) => [o.pos.x - DOOR.x, o.pos.z - DOOR.z])).toEqual([
      [-4, -6],
      [2, -9],
      [-6, 4],
      [6, 2],
    ]);
    for (const { pos } of rocks) {
      expect(setHits(pos.x, pos.z, 0.12), `${pos.x},${pos.z} is not inside a wall`).toBe(false);
    }
    const lifts = rocks.map(
      ({ pos }) => groundHeight(pos.x, pos.z, SEED) - terrainHeight(pos.x, pos.z, SEED),
    );
    expect(lifts[0]).toBeLessThan(0.01);
    expect(lifts[2]).toBeLessThan(0.01);
    expect(lifts[3]).toBeLessThan(0.01);
    // the second lies ON the flight (tests/ground_object_placement.test.ts allows exactly it)
    expect(lifts[1]).toBeGreaterThan(1);
    const sim = makeSim();
    const onTread = [...sim.entities.values()].find(
      (e) => e.kind === 'object' && e.pos.x === rocks[1].pos.x && e.pos.z === rocks[1].pos.z,
    );
    expect(onTread?.pos.y).toBeCloseTo(groundHeight(rocks[1].pos.x, rocks[1].pos.z, SEED), 6);
  }, 180_000);

  it('a player walks to each of them', () => {
    const sim = makeSim();
    // the one on the flight, from the exit drop
    place(sim, EXIT_DROP.x, EXIT_DROP.z, Math.PI);
    expect(walkTo(sim, rocks[1].pos.x, rocks[1].pos.z, 0.7, 300), 'on the tread').toBe(true);
    // the one at the foot of the east cheek, from the east bank
    const bank = at(-9, -8);
    place(sim, bank.x, bank.z, 0);
    expect(
      walkTo(sim, rocks[0].pos.x - 0.7, rocks[0].pos.z, 0.7, 300),
      'under the east cheek',
    ).toBe(true);
    // the two behind the gate, round each end of the dais
    for (const [rock, side] of [
      [rocks[2], -1],
      [rocks[3], 1],
    ] as const) {
      const end = at(side * 9.5, -1);
      place(sim, end.x, end.z, 0);
      expect(
        walkTo(sim, rock.pos.x + side * 0.6, rock.pos.z + 0.8, 0.8, 400),
        `behind the gate ${side}`,
      ).toBe(true);
    }
    expect(sim.player.pos.x, 'never taken by the door on the way').toBeLessThan(
      DUNGEON_X_THRESHOLD,
    );
  }, 180_000);
});

describe('the Moon Stair sits in the real ground', () => {
  // Each footing's design burial under the LOWEST ground anywhere under it
  // (build_temple_entrance.py), by name prefix.
  const DESIGN_BURY: readonly (readonly [string, number])[] = [
    ['dais', 0.6],
    ['stair', 0.5],
    ['pier_', 0.5],
    ['cheek_', 0.5],
    ['column_', 0.55],
    ['penitent_', 0.6],
    ['weir_', 0.55],
    ['moon_pool', 0.55],
    ['stela_', 0.5],
  ];
  // The builder samples the same half-yard grid on a half-yard table of the
  // sim's own terrain: a hair of interpolation and nothing else.
  const BURY_TOLERANCE = 0.09;

  it('every footing is under the ground everywhere beneath it, and never deeper than its design burial', () => {
    expect(DROWNED_TEMPLE_ENTRANCE_FOOTINGS.length).toBeGreaterThanOrEqual(36);
    for (const f of DROWNED_TEMPLE_ENTRANCE_FOOTINGS) {
      const design = DESIGN_BURY.find(([prefix]) => f.name.startsWith(prefix));
      expect(design, `${f.name} has a design burial`).toBeDefined();
      const c = Math.cos(f.rot);
      const s = Math.sin(f.rot);
      const nx = Math.max(1, Math.floor((f.hw * 2) / 0.5));
      const nz = Math.max(1, Math.floor((f.hd * 2) / 0.5));
      let lowest = Infinity;
      for (let i = 0; i <= nx; i++) {
        for (let j = 0; j <= nz; j++) {
          const u = -f.hw + (2 * f.hw * i) / nx;
          const v = -f.hd + (2 * f.hd * j) / nz;
          // three.js rotation.y, the colliders' own convention
          const natural = terrain(f.lx + u * c + v * s, f.lz - u * s + v * c);
          // no gap: the underside never floats above the natural ground, nor
          // above what is walked on over it
          expect(
            f.bottom - natural,
            `${f.name} floats at ${u.toFixed(1)},${v.toFixed(1)}`,
          ).toBeLessThan(0.02);
          lowest = Math.min(lowest, natural);
        }
      }
      // no sinking: under its lowest point the footing is cut exactly as designed
      expect(lowest - f.bottom, `${f.name} is sunk`).toBeLessThanOrEqual(
        (design?.[1] ?? 0) + BURY_TOLERANCE,
      );
      expect(lowest - f.bottom, `${f.name} is shallow`).toBeGreaterThanOrEqual(
        (design?.[1] ?? 0) - BURY_TOLERANCE,
      );
    }
  });

  it('every collider row is well formed and stays inside the set piece', () => {
    expect(DROWNED_TEMPLE_ENTRANCE_COLLIDERS.length).toBeGreaterThanOrEqual(24);
    const names = new Set<string>();
    for (const r of DROWNED_TEMPLE_ENTRANCE_COLLIDERS) {
      expect(names.has(r.name), `${r.name} is unique`).toBe(false);
      names.add(r.name);
      expect(Math.hypot(r.lx, r.lz), r.name).toBeLessThan(36);
      expect(r.top, r.name).toBeGreaterThan(L.water);
      if (r.type === 'obb') {
        expect(r.hw, r.name).toBeGreaterThan(0.1);
        expect(r.hd, r.name).toBeGreaterThan(0.1);
      } else {
        expect(r.r, r.name).toBeGreaterThan(0.3);
      }
    }
  });

  it('everything towers over a 1.8 yd character', () => {
    // the ring's feet stand over six yards at the lane (its crown is pinned on the GLB's own
    // bounds, tests/drowned_temple_entrance_asset.test.ts)
    expect(row('moongate_foot_e').top - S.dais).toBeGreaterThan(6);
    expect(row('moongate_foot_w').top - S.dais).toBeGreaterThan(6);
    // the penitents: four to five yards out of the water they stand in
    for (const name of ['penitent_e', 'penitent_w']) {
      expect(row(name).top - L.water, name).toBeGreaterThan(4);
      expect(row(name).top - L.water, name).toBeLessThan(6);
    }
    // the whole columns: over seven yards from their own ground
    expect(row('column_w_5').top - terrain(5.2, -4.6)).toBeGreaterThan(7);
    expect(row('column_e_5').top - terrain(-5.2, -4.6)).toBeGreaterThan(7);
  });

  it('the camera tops are seated on the door height', () => {
    const built = drownedTempleEntranceColliders(SEED, DOOR);
    expect(built).toHaveLength(DROWNED_TEMPLE_ENTRANCE_COLLIDERS.length);
    built.forEach((c, i) => {
      const r = DROWNED_TEMPLE_ENTRANCE_COLLIDERS[i];
      expect(c.cameraTopY).toBeCloseTo(BASE + r.top, 9);
      expect(c.x).toBeCloseTo(DOOR.x + r.lx, 9);
      expect(c.z).toBeCloseTo(DOOR.z + r.lz, 9);
    });
  });
});

describe('the Moon Stair walls nothing in', () => {
  it('no NPC or gather node stands inside a collider of the set piece', () => {
    let npcs = 0;
    for (const npc of Object.values(NPCS)) {
      if (!near(npc.pos.x, npc.pos.z)) continue;
      npcs++;
      expect(setHits(npc.pos.x, npc.pos.z, 0.6), npc.id).toBe(false);
    }
    let nodes = 0;
    for (const node of GATHER_NODES) {
      if (!near(node.pos.x, node.pos.z)) continue;
      expect(setHits(node.pos.x, node.pos.z, 1.5), node.id).toBe(false);
      nodes++;
    }
    // the guards are not vacuous: Ondrel, and the four stands of wood round the mere
    expect(npcs).toBeGreaterThanOrEqual(1);
    expect(nodes).toBeGreaterThanOrEqual(4);
    // the wood under the weir is worked from the pit side
    const wood = GATHER_NODES.find((n) => n.pos.x === -63 && n.pos.z === 771);
    expect(wood?.type).toBe('wood');
    expect(isBlocked(SEED, -63 + 1.4, 771 - 1.2, PLAYER_BODY_RADIUS)).toBe(false);
  });

  it('no mob of a fresh world spawns inside a collider of the set piece', () => {
    const sim = makeSim();
    let mobs = 0;
    for (const e of sim.entities.values()) {
      if (e.kind !== 'mob' || !near(e.pos.x, e.pos.z)) continue;
      mobs++;
      expect(
        setHits(e.pos.x, e.pos.z, 0.3),
        `${e.templateId} at ${e.pos.x.toFixed(1)},${e.pos.z.toFixed(1)}`,
      ).toBe(false);
    }
    // the waders in the mirror and the votaries on the terrace
    expect(mobs).toBeGreaterThanOrEqual(10);
  }, 180_000);

  it('the shelf behind the weir is never a trap: a player walks out of the mirror by the east bank', () => {
    const sim = makeSim();
    const mid = at(-8, -22);
    place(sim, mid.x, mid.z, 0);
    expect(walkTo(sim, DOOR.x - 26, DOOR.z - 20, 1, 600), 'out by the east bank').toBe(true);
  }, 180_000);
});
