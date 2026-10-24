// The Hollow Crypt's world entrance, the Fallen Chapel
// (src/sim/hollow_crypt_entrance.ts, drawn by src/render/hollow_crypt_entrance.ts):
// its stair-house portal is the door's jambs and the lane between them is the
// walk-in trigger; a player walks in through the gable door, up the nave and
// into the crypt, and back out from the exit drop; the six quest objects that
// lie round the stair are walked to; the old ruin ring is bare and the chapel's
// own piers stand in the nave; every footing of the Blender
// model sits on the sim's own ground (no gap, no sinking); and nothing around
// the door, mob spawns included, is walled in.
import { describe, expect, it } from 'vitest';
import { isBlocked, queryOpenWorldColliders } from '../src/sim/colliders';
import {
  DUNGEON_X_THRESHOLD,
  DUNGEONS,
  GATHER_NODES,
  GROUND_OBJECTS,
  NPCS,
  PROPS,
} from '../src/sim/data';
import {
  HOLLOW_CRYPT_ENTRANCE_COLLIDERS,
  HOLLOW_CRYPT_ENTRANCE_FOOTINGS,
  HOLLOW_CRYPT_ENTRANCE_LANE_HALF_WIDTH,
  HOLLOW_CRYPT_NAVE_RING,
  hollowCryptEntranceColliders,
} from '../src/sim/hollow_crypt_entrance';
import { PLAYER_BODY_RADIUS } from '../src/sim/pathfind';
import { ruinRingColumns } from '../src/sim/prop_layout';
import { Sim } from '../src/sim/sim';
import type { MoveInput } from '../src/sim/types';
import { groundHeight, terrainHeight } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

const SEED = WORLD_SEED;
const DOOR = DUNGEONS.hollow_crypt.doorPos;
// The walk-in trigger (instances/dungeons.ts DOOR_TRIGGER_RADIUS): a shipped
// constant the module does not export, pinned here as the literal it is.
const DOOR_TRIGGER_RADIUS = 2;
const EXIT_DROP = { x: DOOR.x, z: DOOR.z - 4 };
// The approach: south of the gable, through its doorway, up the nave.
const APPROACH = { x: DOOR.x, z: DOOR.z - 27 };
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

/** Circle-vs-shape overlap against the chapel's own solids only. */
function chapelHits(x: number, z: number, r: number): boolean {
  return hollowCryptEntranceColliders(SEED, DOOR).some((c) => {
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

describe('the Fallen Chapel stands in for the generic door arch', () => {
  it('the door is still the Crypt door at (80, 90), on the ground the model was built on', () => {
    expect(DOOR).toEqual({ x: 80, z: 90 });
    expect(terrainHeight(DOOR.x, DOOR.z, SEED)).toBeCloseTo(2.1779, 3);
  });

  it('the stair-house walls the door, and its lane is open and narrower than the trigger', () => {
    for (const sx of [-1, 1]) {
      expect(isBlocked(SEED, DOOR.x + sx * 2.4, DOOR.z + 2, 0.4), `side ${sx}`).toBe(true);
      expect(isBlocked(SEED, DOOR.x + sx * 2.4, DOOR.z - 0.4, 0.4), `front ${sx}`).toBe(true);
      // the mourners' pedestals in front of the jambs
      expect(isBlocked(SEED, DOOR.x + sx * 2.05, DOOR.z - 1.15, 0.2), `mourner ${sx}`).toBe(true);
    }
    // a body crossing the arch inside the lane is always inside the trigger
    expect(HOLLOW_CRYPT_ENTRANCE_LANE_HALF_WIDTH).toBeLessThan(DOOR_TRIGGER_RADIUS);
    expect(HOLLOW_CRYPT_ENTRANCE_LANE_HALF_WIDTH).toBeGreaterThan(PLAYER_BODY_RADIUS + 0.5);
    for (const lz of [-3, -2, -1, -0.2, 0.4]) {
      for (const lx of [-0.7, 0, 0.7]) {
        expect(isBlocked(SEED, DOOR.x + lx, DOOR.z + lz, PLAYER_BODY_RADIUS), `${lx},${lz}`).toBe(
          false,
        );
      }
    }
    // a body wider than the lane is walled at the jambs, and the stair is closed
    for (const sx of [-1, 1]) {
      expect(isBlocked(SEED, DOOR.x + sx * 1.1, DOOR.z + 0.2, PLAYER_BODY_RADIUS)).toBe(true);
    }
    expect(isBlocked(SEED, DOOR.x, DOOR.z + 3, 0.4), 'the dark stair').toBe(true);
    expect(EXIT_DROP.z, 'the exit drop is outside the trigger').toBeLessThan(
      DOOR.z - DOOR_TRIGGER_RADIUS,
    );
    expect(isBlocked(SEED, EXIT_DROP.x, EXIT_DROP.z, 0.9)).toBe(false);
  });

  it('the gable, the nave walls and the apse block; the gable doorway and the breaches do not', () => {
    for (const sx of [-1, 1]) {
      expect(isBlocked(SEED, DOOR.x + sx * 6, DOOR.z - 22, 0.4), `gable ${sx}`).toBe(true);
      expect(isBlocked(SEED, DOOR.x + sx * 8.5, DOOR.z - 18, 0.4), `nave ${sx}`).toBe(true);
    }
    expect(isBlocked(SEED, DOOR.x + 5.52, DOOR.z + 8.02, 0.4), 'apse').toBe(true);
    // the apse's north run fell to a step: its breach is open ground
    expect(isBlocked(SEED, DOOR.x, DOOR.z + 10.3, PLAYER_BODY_RADIUS), 'apse breach').toBe(false);
    for (let z = DOOR.z - 27; z <= DOOR.z - 19; z += 0.5) {
      expect(isBlocked(SEED, DOOR.x, z, PLAYER_BODY_RADIUS), `gable door z ${z}`).toBe(false);
    }
    // the west wall's first breach (t 0.37 to 0.47 of its run)
    expect(isBlocked(SEED, DOOR.x + 8.5, DOOR.z - 13.5, PLAYER_BODY_RADIUS)).toBe(false);
  });
});

describe('the old ruin ring is bare, and the chapel brings its own nave piers', () => {
  it('ruinRingColumns omits by index and keeps every other column where it stood', () => {
    const plain = ruinRingColumns({ x: 0, z: 0, ringR: 7, columns: 7 });
    const less = ruinRingColumns({ x: 0, z: 0, ringR: 7, columns: 7, omit: [0] });
    expect(plain).toHaveLength(7);
    expect(less).toEqual(plain.slice(1));
    expect(plain[0]).toMatchObject({ index: 0, intact: false });
    expect(plain[0].x).toBeCloseTo(0, 9);
    expect(plain[0].z).toBeCloseTo(7, 9);
    // every fourth column is the tall monolith; tops follow the drawn scale
    expect(plain[1]).toMatchObject({ intact: true, scaleY: 4, top: 3.9 });
    expect(plain[2].top).toBeCloseTo(0.65 * (1.7 + 2 * 0.85) - 0.1, 9);
  });

  it('the ring at the chapel draws and collides nothing: no kit column, no toppled relic', () => {
    const ring = PROPS.ruinRings.find(
      (r) => r.x === HOLLOW_CRYPT_NAVE_RING.x && r.z === HOLLOW_CRYPT_NAVE_RING.z,
    );
    expect(ring?.bare).toBe(true);
    if (!ring) return;
    // every other ring of the world still stands
    expect(PROPS.ruinRings.filter((r) => !r.bare).length).toBeGreaterThan(5);
    const all = queryOpenWorldColliders(
      SEED,
      ring.x - ring.ringR - 1,
      ring.z - ring.ringR - 1,
      ring.x + ring.ringR + 1,
      ring.z + ring.ringR + 1,
      [],
    );
    // the spot the lane column stood on, a yard south of the exit drop
    expect(isBlocked(SEED, ring.x, ring.z + ring.ringR, 0.3)).toBe(false);
    // where each kit column stood, no kit collider is left
    for (const col of ruinRingColumns(ring)) {
      const kit = all.filter(
        (c) => c.type === 'circle' && c.r === 0.6 && Math.hypot(c.x - col.x, c.z - col.z) < 0.05,
      );
      expect(kit, `kit column ${col.index}`).toHaveLength(0);
    }
    // the toppled statue head stood here: only a chapel solid may block it now
    expect(isBlocked(SEED, ring.x - 2.4, ring.z - 2.7, 0.2)).toBe(
      chapelHits(ring.x - 2.4, ring.z - 2.7, 0.2),
    );
  });

  it('six masonry piers and the fallen one stand in the nave, clear of the aisle', () => {
    const piers = HOLLOW_CRYPT_ENTRANCE_COLLIDERS.filter((c) => c.name.startsWith('nave_pier_'));
    expect(piers).toHaveLength(6);
    for (const pier of piers) {
      expect(isBlocked(SEED, DOOR.x + pier.lx, DOOR.z + pier.lz, 0.3), pier.name).toBe(true);
      // an arcade either side of the aisle, inside the nave walls
      expect(Math.abs(pier.lx)).toBeGreaterThan(3.5);
      expect(Math.abs(pier.lx)).toBeLessThan(7);
    }
    expect(HOLLOW_CRYPT_ENTRANCE_COLLIDERS.some((c) => c.name === 'fallen_pier')).toBe(true);
    for (let z = DOOR.z - 20; z <= DOOR.z - 4; z += 0.5) {
      expect(isBlocked(SEED, DOOR.x, z, PLAYER_BODY_RADIUS), `aisle z ${z}`).toBe(false);
    }
  });
});

describe('a player walks in through the gable, up the nave and into the Crypt', () => {
  it('approach to trigger, then the exit drop and back out through the gable', () => {
    const sim = makeSim();
    const p = sim.player;
    place(sim, APPROACH.x, APPROACH.z, 0);
    // through the gable doorway to the middle of the nave
    expect(walkTo(sim, DOOR.x, DOOR.z - 8, 0.8, 500), 'reached the nave').toBe(true);
    // aim past the arch: the walk ends the moment the trigger takes it
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
    expect(walkTo(sim, APPROACH.x, APPROACH.z, 0.8, 600), 'back out to the approach').toBe(true);
  });

  it('the lychgate lane on the approach is open', () => {
    for (let z = DOOR.z - 33.5; z <= DOOR.z - 28.5; z += 0.5) {
      expect(isBlocked(SEED, DOOR.x - 2.5, z, PLAYER_BODY_RADIUS), `lychgate z ${z}`).toBe(false);
    }
    for (const sx of [-1, 1]) {
      expect(isBlocked(SEED, DOOR.x - 2.5 + sx * 2.35, DOOR.z - 31, 0.3)).toBe(true);
    }
  });
});

describe('the quest objects round the stair stay within reach', () => {
  const near = GROUND_OBJECTS.flatMap((g) =>
    g.positions
      .filter((pos) => Math.hypot(pos.x - DOOR.x, pos.z - DOOR.z) < 12)
      .map((pos) => ({ itemId: g.itemId, pos })),
  );

  it('the six sigils, ledger pages and the grimoire lie on open ground inside the chapel', () => {
    expect(near.map((o) => o.itemId).sort()).toEqual([
      'gravecaller_sigil',
      'gravecaller_sigil',
      'morthen_grimoire',
      'weathered_ledger_page',
      'weathered_ledger_page',
      'weathered_ledger_page',
    ]);
    for (const { itemId, pos } of near) {
      const at = `${itemId} at ${pos.x},${pos.z}`;
      expect(isBlocked(SEED, pos.x, pos.z, PLAYER_BODY_RADIUS), at).toBe(false);
      expect(chapelHits(pos.x, pos.z, PLAYER_BODY_RADIUS), at).toBe(false);
    }
  });

  it('a player walks from the exit drop to every one of them', () => {
    const sim = makeSim();
    for (const { itemId, pos } of near) {
      place(sim, EXIT_DROP.x, EXIT_DROP.z, 0);
      // the two beside the stair-house are walked to round its mourner, by the
      // nave's side (this walker only re-aims, it does not path)
      const lx = pos.x - DOOR.x;
      if (pos.z > DOOR.z && Math.abs(lx) > 3.5) {
        expect(walkTo(sim, DOOR.x + Math.sign(lx) * 4.3, DOOR.z - 1.9, 0.6, 300)).toBe(true);
      }
      expect(walkTo(sim, pos.x, pos.z, 1.2, 300), `reach ${itemId} at ${pos.x},${pos.z}`).toBe(
        true,
      );
      expect(sim.player.pos.x, 'never taken by the door on the way').toBeLessThan(
        DUNGEON_X_THRESHOLD,
      );
    }
  });
});

describe('the Fallen Chapel sits on the real ground', () => {
  // Each footing's design burial under its LOWEST ground (build_crypt_entrance.py).
  const DESIGN_BURY: readonly [string, number][] = [
    ['gable_', 0.45],
    ['nave_wall_', 0.45],
    ['chancel_wall_', 0.45],
    ['apse_', 0.45],
    ['stairhouse', 0.5],
    ['vestry_wall', 0.45],
    ['lychgate_wall_', 0.4],
    ['yard_wall_', 0.35],
    ['headstone_', 0.35],
    ['fallen_bell', 0.4],
    ['yew', 0.3],
    ['mourner_', 0.1],
    ['font', 0.09],
    ['lectern', 0.07],
    ['altar_slab', 0.06],
    ['nave_pier_', 0.13],
    ['fallen_pier', 0.15],
    ['table_tomb_', 0.05],
  ];
  // A long wall's lowest ground is sampled along its whole run, so a corner
  // may sit a little higher than the run's own low point.
  const BURY_TOLERANCE = 0.3;

  it('every footing is below the ground at all of its corners, and never deeper than its design burial', () => {
    const base = terrainHeight(DOOR.x, DOOR.z, SEED);
    expect(HOLLOW_CRYPT_ENTRANCE_FOOTINGS.length).toBeGreaterThan(40);
    for (const f of HOLLOW_CRYPT_ENTRANCE_FOOTINGS) {
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
        ).toBeLessThan(0.05);
        lowest = Math.min(lowest, ground);
      }
      // no sinking: at its lowest corner the footing is cut no deeper than designed
      expect(lowest - f.bottom, `${f.name} is sunk`).toBeLessThanOrEqual(
        (design?.[1] ?? 0) + BURY_TOLERANCE,
      );
    }
  });

  it('every collider row is well formed and stays inside the set piece', () => {
    expect(HOLLOW_CRYPT_ENTRANCE_COLLIDERS.length).toBeGreaterThan(40);
    const names = new Set<string>();
    for (const row of HOLLOW_CRYPT_ENTRANCE_COLLIDERS) {
      expect(names.has(row.name), `${row.name} is unique`).toBe(false);
      names.add(row.name);
      expect(Math.hypot(row.lx, row.lz), row.name).toBeLessThan(40);
      expect(row.top, row.name).toBeGreaterThan(0.5);
      if (row.type === 'obb') {
        expect(row.hw, row.name).toBeGreaterThan(0.1);
        expect(row.hd, row.name).toBeGreaterThan(0.1);
      } else {
        expect(row.r, row.name).toBeGreaterThan(0.3);
      }
      if (row.standTop !== undefined) expect(row.standTop).toBeLessThanOrEqual(row.top);
    }
  });
});

const near80 = (x: number, z: number) => Math.hypot(x - DOOR.x, z - DOOR.z) < 80;

describe('the Fallen Chapel seals nobody in', () => {
  it('a body walks from the exit drop to every part of the set piece', () => {
    // Flood the ground a player's body can occupy, a quarter yard at a time,
    // from the exit drop, over the whole footprint and a margin round it.
    const STEP = 0.25;
    const X0 = -24;
    const Z0 = -52;
    const NX = Math.round(48 / STEP) + 1;
    const NZ = Math.round(68 / STEP) + 1;
    const open = new Uint8Array(NX * NZ);
    const seen = new Uint8Array(NX * NZ);
    for (let j = 0; j < NZ; j++) {
      for (let i = 0; i < NX; i++) {
        const blocked = isBlocked(
          SEED,
          DOOR.x + X0 + i * STEP,
          DOOR.z + Z0 + j * STEP,
          PLAYER_BODY_RADIUS,
        );
        open[j * NX + i] = blocked ? 0 : 1;
      }
    }
    const cell = (lx: number, lz: number) =>
      Math.round((lz - Z0) / STEP) * NX + Math.round((lx - X0) / STEP);
    const queue = [cell(0, -4)];
    seen[queue[0]] = 1;
    for (let head = 0; head < queue.length; head++) {
      const at = queue[head];
      const i = at % NX;
      for (const next of [at - 1, at + 1, at - NX, at + NX]) {
        if (next < 0 || next >= open.length || seen[next] || !open[next]) continue;
        if (Math.abs((next % NX) - i) > 1) continue;
        seen[next] = 1;
        queue.push(next);
      }
    }
    const spots: readonly [string, number, number][] = [
      ['the approach', 0, -27],
      ['under the lychgate', -2.5, -31],
      ['the nave by the font', 3.4, -19.4],
      ['the vestry nook', -4.6, -4.6],
      ['west of the stair-house', 5.4, 1.2],
      ['east of the stair-house, by the altar slab', -5.6, 1.6],
      ['the apse behind the stair', 0, 7.6],
      ['beside the east yard', -19, -9],
      ['beside the west yard', 19, -16.5],
      ['outside the apse', 0, 12.5],
    ];
    for (const [name, lx, lz] of spots) {
      expect(open[cell(lx, lz)], `${name} is open ground`).toBe(1);
      expect(seen[cell(lx, lz)], `${name} is reachable`).toBe(1);
    }
    // and no open pocket in the footprint is cut off from the rest: only a
    // crumb between two close solids (a few quarter-yard cells, where a body
    // centre would fit but can never arrive) may stay unvisited
    let sealed = 0;
    for (let k = 0; k < open.length; k++) if (open[k] && !seen[k]) sealed++;
    expect(sealed, 'open cells no body can walk to').toBeLessThan(10);
  });
});

describe('the Fallen Chapel walls nothing in', () => {
  it('no NPC or gather node stands inside a chapel collider', () => {
    for (const npc of Object.values(NPCS)) {
      if (!near80(npc.pos.x, npc.pos.z)) continue;
      expect(chapelHits(npc.pos.x, npc.pos.z, 0.6), npc.id).toBe(false);
    }
    let nodes = 0;
    for (const node of GATHER_NODES) {
      if (!near80(node.pos.x, node.pos.z)) continue;
      expect(chapelHits(node.pos.x, node.pos.z, 1.5), node.id).toBe(false);
      nodes++;
    }
    // the guard is not vacuous: the door has neighbours to keep clear
    expect(nodes).toBeGreaterThanOrEqual(2);
  });

  it('no mob of a fresh world spawns inside a chapel collider', () => {
    const sim = makeSim();
    let mobs = 0;
    for (const e of sim.entities.values()) {
      if (e.kind !== 'mob' || !near80(e.pos.x, e.pos.z)) continue;
      mobs++;
      expect(
        chapelHits(e.pos.x, e.pos.z, 0.3),
        `${e.templateId} at ${e.pos.x.toFixed(1)},${e.pos.z.toFixed(1)}`,
      ).toBe(false);
    }
    // the Restless Bones, Maldrec and Verlan all camp round the chapel
    expect(mobs).toBeGreaterThanOrEqual(8);
  });
});
