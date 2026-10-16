import { beforeAll, describe, expect, it } from 'vitest';
import { type Collider, lineOfSightClear, queryOpenWorldColliders } from '../src/sim/colliders';
import {
  MIREFEN_TAVERN_NPCS,
  TAVERN_ARCH,
  TAVERN_BAR_PLATFORM,
  TAVERN_DOOR,
  TAVERN_FLOOR_Y,
  TAVERN_HALL,
  TAVERN_HATCH,
  TAVERN_KEEPER_ENTITY_ID,
  TAVERN_KEEPER_LOCAL,
  TAVERN_ORIGIN,
  TAVERN_PIT,
  TAVERN_PORCH,
  TAVERN_PROPS,
  TAVERN_STAGE,
  TAVERN_TOWER,
  TAVERN_WING,
  TAVERN_YAW,
  tavernToWorld,
} from '../src/sim/content/mirefen_tavern';
import { TAVERN_PATRON_NPC_IDS } from '../src/sim/content/mirefen_tavern_patrons';
import { BUILTIN_WORLD, GATHER_NODES, ITEMS, NPCS } from '../src/sim/data';
import { isExcludedDecoration } from '../src/sim/decoration_exclusions';
import {
  mirefenTavernColliders,
  TAVERN_TOWER_WALL_RUNS,
  tavernHallWalls,
  tavernInsideLocal,
  tavernRestsAt,
  tavernWingWalls,
} from '../src/sim/mirefen_tavern';
import {
  mirefenTavernCovers,
  mirefenTavernSurface,
  tavernLocalHeight,
} from '../src/sim/mirefen_tavern_floor';
import { PLAYER_MAX_CLIMB_SLOPE } from '../src/sim/pathfind';
import { isResting } from '../src/sim/progression/xp';
import { Sim } from '../src/sim/sim';
import { type Entity, INTERACT_RANGE, STATIC_WORLD_SERVICE_ENTITY_ID_MIN } from '../src/sim/types';
import { groundHeight, roadDistance, terrainHeight } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';
import { worldEntityText } from '../src/ui/world_entity_i18n';

// The Mirefen tavern (src/sim/content/mirefen_tavern.ts, src/sim/mirefen_tavern_floor.ts,
// src/sim/mirefen_tavern.ts): the walk-in inn on the Fenbridge road, one storey for players.
// Pins its site (clear of the road, the camps, the nodes and the scatter; the floor over the
// ground everywhere, no terrain edit), its generous scale against the 2.6 yd player, its
// floor (the hearth step, the bar platform, the stage, and no upper floor anywhere), its walls
// minus the door and the arch (the kitchen hatch no way through), the rest area, the
// innkeeper, and walks the whole building with the real movement kernel: road, door, hearth
// ring, bar, stage, booth, the tower's nook, and out.

const S = WORLD_SEED;
const PLAYER_H = 2.6;
const w = (lx: number, lz: number) => tavernToWorld(lx, lz);
const floorAt = (lx: number, lz: number): number => {
  const p = w(lx, lz);
  return groundHeight(p.x, p.z, S) - TAVERN_FLOOR_Y;
};

describe('Mirefen tavern: the site', () => {
  it('stands beside the Fenbridge road, its door toward it, its steps ending short of it', () => {
    const door = w(0, TAVERN_PORCH.z1);
    // the door faces world +x, the road's side
    expect(TAVERN_YAW).toBeCloseTo(Math.PI / 2, 12);
    expect(w(0, 1).x - w(0, 0).x).toBeCloseTo(1, 12);
    // the road passes a few yards beyond the steps' foot, and never under the building
    expect(roadDistance(door.x + 7, door.z)).toBeLessThan(3);
    for (let x = TAVERN_ORIGIN.x - 30; x <= TAVERN_ORIGIN.x + 16.4; x += 1) {
      for (let z = TAVERN_ORIGIN.z - 17; z <= TAVERN_ORIGIN.z + 17; z += 1) {
        if (!mirefenTavernCovers(x, z)) continue;
        expect(roadDistance(x, z), `(${x}, ${z})`).toBeGreaterThan(3.5);
      }
    }
  });

  it('keeps clear of every camp, node, quest object and NPC', () => {
    const c = BUILTIN_WORLD;
    for (const camp of c.camps) {
      // a camp's spread plus its mobs' reach never touches the walls
      const d = Math.hypot(camp.center.x - TAVERN_ORIGIN.x, camp.center.z - TAVERN_ORIGIN.z);
      expect(d - camp.radius, camp.mobId).toBeGreaterThan(40);
    }
    for (const n of GATHER_NODES) {
      expect(mirefenTavernCovers(n.pos.x, n.pos.z, 4), n.id).toBe(false);
    }
    for (const o of c.groundObjects) {
      for (const at of o.positions) {
        expect(mirefenTavernCovers(at.x, at.z, 4), o.itemId).toBe(false);
      }
    }
    for (const npc of Object.values(NPCS)) {
      // the tavern's own people stand (or sit) inside it
      if (npc.id === 'innkeeper_maudie' || TAVERN_PATRON_NPC_IDS.includes(npc.id)) continue;
      expect(mirefenTavernCovers(npc.pos.x, npc.pos.z, 4), npc.id).toBe(false);
    }
  });

  it('floats its floor over the ground everywhere under it: no terrain edit', () => {
    // the terrain the renderer draws is untouched; the floor stands clear of it, so no
    // ground shows through a floorboard (the steps alone run down to meet it)
    for (let lx = -16; lx <= 16; lx += 0.5) {
      for (let lz = -28; lz <= TAVERN_PORCH.z1; lz += 0.5) {
        const p = w(lx, lz);
        const s = mirefenTavernSurface(p.x, p.z);
        if (s === -Infinity) continue;
        expect(s - terrainHeight(p.x, p.z, S), `(${lx}, ${lz})`).toBeGreaterThan(0.3);
      }
    }
    // and the surface is nothing off the footprint
    const off = w(0, 30);
    expect(mirefenTavernSurface(off.x, off.z)).toBe(-Infinity);
    expect(mirefenTavernSurface(TAVERN_ORIGIN.x + 60, TAVERN_ORIGIN.z)).toBe(-Infinity);
  });

  it('clears the scatter off its footprint, and nothing but its own colliders stands in it', () => {
    const mine = new Set(mirefenTavernColliders(S));
    const near: Collider[] = [];
    // (the grounds reach further west than the building: the stable and the cart beside it)
    queryOpenWorldColliders(
      S,
      TAVERN_ORIGIN.x - 30,
      TAVERN_ORIGIN.z - 18,
      TAVERN_ORIGIN.x + 25,
      TAVERN_ORIGIN.z + 32,
      near,
    );
    const ours = near.filter((c) => [...mine].some((m) => m.x === c.x && m.z === c.z));
    expect(ours.length).toBe(mine.size);
    for (const c of near) {
      if (ours.includes(c)) continue;
      expect(mirefenTavernCovers(c.x, c.z, 2), `${c.type} at (${c.x}, ${c.z})`).toBe(false);
    }
    expect(isExcludedDecoration(TAVERN_ORIGIN.x, TAVERN_ORIGIN.z)).toBe(true);
    expect(isExcludedDecoration(TAVERN_ORIGIN.x + 60, TAVERN_ORIGIN.z)).toBe(false);
  });
});

describe('Mirefen tavern: scaled for the player', () => {
  it('is a big room, a big door, a big nook and a high roof next to a 2.6 yd player', () => {
    const inside = TAVERN_HALL.x1 - TAVERN_HALL.x0 - 2 * TAVERN_HALL.wall;
    expect(inside).toBeGreaterThanOrEqual(28);
    expect(inside).toBeLessThanOrEqual(34);
    expect(TAVERN_DOOR.height).toBeGreaterThanOrEqual(4.5);
    expect(TAVERN_DOOR.height).toBeLessThanOrEqual(5.5);
    expect(TAVERN_DOOR.width).toBeGreaterThan(PLAYER_H + 1.5);
    // open to the roof: the lowest timber over the room (the hammer beams) is near four
    // bodies up, well over any camera the room holds
    expect(TAVERN_HALL.truss).toBeGreaterThan(3.5 * PLAYER_H);
    expect(TAVERN_HALL.truss).toBeLessThan(TAVERN_HALL.eave + 0.5);
    // the arch into the tower's nook is taller than two bodies, the nook a room of its own
    expect(TAVERN_ARCH.height).toBeGreaterThan(2 * PLAYER_H);
    expect(2 * TAVERN_TOWER.rIn).toBeGreaterThan(4 * PLAYER_H);
    // the stage and the bar stand half a yard up; the kitchen hatch is over the counter's
    // height and wide enough to pass a tray, never a body
    expect(TAVERN_STAGE.lift).toBeLessThan(0.25 * PLAYER_H);
    expect(TAVERN_HATCH.sill).toBeGreaterThan(TAVERN_BAR_PLATFORM.lift + 0.5 * PLAYER_H);
    expect(TAVERN_HATCH.x1 - TAVERN_HATCH.x0).toBeLessThan(TAVERN_DOOR.width);
  });

  it('sizes the furniture to the player: tables at the waist, seats a body sits in', () => {
    for (const p of TAVERN_PROPS) {
      if (p.kind === 'table' || p.kind === 'roundTable') {
        expect(p.height, p.kind).toBeGreaterThanOrEqual(0.5 * PLAYER_H);
        expect(p.height, p.kind).toBeLessThanOrEqual(0.7 * PLAYER_H);
      }
      if (p.kind === 'chair' || p.kind === 'stool' || p.kind === 'bench' || p.kind === 'settle') {
        expect(p.height, p.kind).toBeGreaterThanOrEqual(0.3 * PLAYER_H);
        expect(p.height, p.kind).toBeLessThanOrEqual(0.45 * PLAYER_H);
      }
      if (p.kind === 'counter') expect(p.height).toBeGreaterThan(0.55 * PLAYER_H);
    }
  });
});

describe('Mirefen tavern: the floor', () => {
  it('steps down one step into the hearth ring and up one onto the bar, both walkable', () => {
    expect(floorAt(TAVERN_PIT.x, TAVERN_PIT.z + 3)).toBeCloseTo(-TAVERN_PIT.depth, 9);
    expect(floorAt(TAVERN_PIT.x, TAVERN_PIT.z + TAVERN_PIT.rim + 0.1)).toBeCloseTo(0, 9);
    expect(floorAt(8, -5)).toBeCloseTo(TAVERN_BAR_PLATFORM.lift, 9);
    // the edges are ramps a stride walks, never walls: the steepest is under the climb gate
    for (let d = 0; d < 1; d += 0.05) {
      const a = floorAt(0, TAVERN_PIT.z + TAVERN_PIT.r + d);
      const b = floorAt(0, TAVERN_PIT.z + TAVERN_PIT.r + d + 0.05);
      expect(Math.abs(b - a) / 0.05).toBeLessThan(PLAYER_MAX_CLIMB_SLOPE);
      const c = floorAt(8, TAVERN_BAR_PLATFORM.z1 + d);
      const e = floorAt(8, TAVERN_BAR_PLATFORM.z1 + d + 0.05);
      expect(Math.abs(e - c) / 0.05).toBeLessThan(PLAYER_MAX_CLIMB_SLOPE);
    }
  });

  it("raises the bard's stage half a yard in the back left corner, its edges walkable ramps", () => {
    const st = TAVERN_STAGE;
    expect(floorAt((st.x0 + st.x1) / 2, (st.z0 + st.z1) / 2)).toBeCloseTo(st.lift, 9);
    expect(floorAt(st.x1 + st.rim + 0.1, (st.z0 + st.z1) / 2)).toBeCloseTo(0, 9);
    expect(floorAt((st.x0 + st.x1) / 2, st.z1 + st.rim + 0.1)).toBeCloseTo(0, 9);
    for (let d = 0; d < 1; d += 0.05) {
      const a = floorAt(-12, st.z1 + d);
      const b = floorAt(-12, st.z1 + d + 0.05);
      expect(Math.abs(b - a) / 0.05).toBeLessThan(PLAYER_MAX_CLIMB_SLOPE);
      const c = floorAt(st.x1 + d, -11);
      const e = floorAt(st.x1 + d + 0.05, -11);
      expect(Math.abs(e - c) / 0.05).toBeLessThan(PLAYER_MAX_CLIMB_SLOPE);
    }
  });

  it('has no upper floor: nothing over the footprint walks higher than the bar platform', () => {
    // the old gallery, the stair tower's spiral and landing, and the wing's rooms are gone:
    // the tower is a flagged nook and the wing a closed kitchen, both on the ground floor
    const top = Math.max(TAVERN_BAR_PLATFORM.lift, TAVERN_STAGE.lift);
    let sampled = 0;
    for (let lx = -16; lx <= 16; lx += 0.25) {
      for (let lz = -28; lz <= TAVERN_PORCH.z1; lz += 0.25) {
        const h = tavernLocalHeight(lx, lz);
        if (Number.isNaN(h)) continue;
        sampled++;
        expect(h, `(${lx}, ${lz})`).toBeLessThanOrEqual(top + 1e-9);
      }
    }
    expect(sampled).toBeGreaterThan(10000);
    // the nook and the closed wing lie level with the hall
    const t = TAVERN_TOWER;
    for (const [dx, dz] of [
      [0, 0],
      [3, -3],
      [-4.5, 1],
      [0, -5.5],
    ]) {
      expect(floorAt(t.x + dx, t.z + dz), `nook (${dx}, ${dz})`).toBe(0);
    }
    expect(floorAt(10, -20)).toBe(0);
    expect(floorAt(-1.5, -13.5)).toBe(0);
  });
});

describe('Mirefen tavern: walls, openings and rails', () => {
  const colliders = mirefenTavernColliders(S);
  it('leaves the front doorway and the nook arch open and closes the rest, the hatch too', () => {
    const walls = tavernHallWalls();
    const inWall = (x: number, z: number) =>
      walls.some(
        (b) => x >= b[0] - 1e-9 && x <= b[1] + 1e-9 && z >= b[2] - 1e-9 && z <= b[3] + 1e-9,
      );
    for (let x = TAVERN_HALL.x0; x <= TAVERN_HALL.x1; x += 0.1) {
      const door = Math.abs(x - TAVERN_DOOR.x) < TAVERN_DOOR.width / 2 - 1e-6;
      expect(inWall(x, TAVERN_HALL.z1 - 0.4), `front ${x}`).toBe(!door);
      const arch = x > TAVERN_ARCH.x0 + 1e-6 && x < TAVERN_ARCH.x1 - 1e-6;
      // the kitchen hatch is no way through: the back wall runs on over it
      expect(inWall(x, TAVERN_HALL.z0 + 0.4), `back ${x}`).toBe(!arch);
    }
    expect(inWall((TAVERN_HATCH.x0 + TAVERN_HATCH.x1) / 2, TAVERN_HALL.z0 + 0.4)).toBe(true);
    // walls block at any height; the porch parapets block a body under their top and are
    // never stood on
    for (const c of colliders) {
      if (c.moveTopY === undefined) expect(c.standable).toBeUndefined();
    }
    // the tower's ring is whole but for the arch: no passage out of the nook
    expect(TAVERN_TOWER_WALL_RUNS).toHaveLength(1);
    expect(TAVERN_TOWER_WALL_RUNS[0][1] - TAVERN_TOWER_WALL_RUNS[0][0]).toBeCloseTo(
      2 * Math.PI - (96 * Math.PI) / 180,
      9,
    );
  });

  it("keeps the wing's walls out of the tower's nook, closing up to its ring", () => {
    // the wing's west wall stops at the tower's outside face, where the model's wall stops:
    // past it the tower's ring is the wall (a run inside the tower would stand as an
    // invisible wall in the nook)
    const t = TAVERN_TOWER;
    for (const [x0, x1, z0, z1] of tavernWingWalls()) {
      for (let x = x0; x <= x1 + 1e-9; x += 0.1) {
        for (let z = z0; z <= z1 + 1e-9; z += 0.1) {
          expect(Math.hypot(x - t.x, z - t.z), `${x}, ${z}`).toBeGreaterThan(t.rIn);
        }
      }
    }
    // ...and still closes the wing's west side up to the ring, leaving no slit
    const w = TAVERN_WING;
    const run = tavernWingWalls().find((b) => b[1] === w.x0 + w.wall && b[2] === w.z0);
    if (!run) throw new Error('west run');
    expect(Math.hypot(w.x0 + w.wall - t.x, run[3] - t.z)).toBeLessThanOrEqual(t.rOut + 1e-9);
  });

  it('joins the live static grid', () => {
    for (const c of colliders) {
      const near: Collider[] = [];
      queryOpenWorldColliders(S, c.x - 0.1, c.z - 0.1, c.x + 0.1, c.z + 0.1, near);
      expect(near.some((n) => n.x === c.x && n.z === c.z)).toBe(true);
    }
  });

  it('stops a spell at the walls but lets it cross the room', () => {
    const a = w(-10, 5);
    const outside = w(-22, 5);
    expect(lineOfSightClear(S, a, outside)).toBe(false);
    const b = w(10, 5);
    expect(lineOfSightClear(S, a, b)).toBe(true);
  });
});

describe('Mirefen tavern: the rest area (the inn rule)', () => {
  const at = (lx: number, lz: number, dy = 0, inCombat = false): Entity => {
    const p = w(lx, lz);
    return {
      pos: { x: p.x, y: groundHeight(p.x, p.z, S) + dy, z: p.z },
      inCombat,
    } as unknown as Entity;
  };

  it('covers the hall and the nook inside the walls and nothing outside', () => {
    for (let lx = -15; lx <= 15; lx += 1) {
      for (let lz = -27; lz <= 13; lz += 1) {
        if (!tavernInsideLocal(lx, lz)) continue;
        expect(isResting(at(lx, lz)), `(${lx}, ${lz})`).toBe(true);
      }
    }
    expect(isResting(at(0, 15))).toBe(false); // the porch
    expect(isResting(at(0, 20))).toBe(false); // the steps
    expect(isResting(at(-20, 0))).toBe(false); // outside the left wall
    expect(isResting(at(0, 5, 0, true))).toBe(false); // a fighter
    const p = w(0, 5);
    expect(tavernRestsAt(p.x, TAVERN_FLOOR_Y + TAVERN_HALL.ridge + 1, p.z)).toBe(false);
  });
});

describe('Mirefen tavern: the innkeeper', () => {
  const npc = MIREFEN_TAVERN_NPCS.innkeeper_maudie;
  it('is a gossip NPC with localized name, title and greeting keys', () => {
    expect(NPCS.innkeeper_maudie).toBe(npc);
    expect(npc.dynamic).toBe(true);
    expect(TAVERN_KEEPER_ENTITY_ID).toBeGreaterThanOrEqual(1_000_000_000);
    expect(TAVERN_KEEPER_ENTITY_ID).toBeLessThan(STATIC_WORLD_SERVICE_ENTITY_ID_MIN);
    expect(npc.questIds).toEqual([]);
    // a classic inn's victualler: bread and water for the road and the marsh's own fare,
    // every one an existing record some other Mirefen or starter vendor already stocks
    expect(npc.vendorItems).toEqual([
      'baked_bread',
      'spring_water',
      'fenbridge_rye',
      'marsh_mint_tea',
      'smoked_eel',
      'silvermist_cordial',
    ]);
    for (const id of npc.vendorItems ?? []) {
      const item = ITEMS[id];
      expect(item, id).toBeDefined();
      expect(['food', 'drink']).toContain(item.kind);
      expect(item.buyValue, id).toBeGreaterThan(0);
      const stockedElsewhere = Object.values(NPCS).some(
        (other) => other.id !== npc.id && other.vendorItems?.includes(id),
      );
      expect(stockedElsewhere, id).toBe(true);
    }
    expect(npc.title).toBe('Innkeeper');
    const npcs = worldEntityText.en.entities.npcs as Record<string, Record<string, string>>;
    expect(npcs.innkeeper_maudie).toEqual({
      name: npc.name,
      title: npc.title,
      greeting: npc.greeting,
    });
    expect(npc.greeting).toMatch(/Fenbridge/);
  });

  it('stands behind the bar, clear of every solid, in reach across the counter', () => {
    const p = w(TAVERN_KEEPER_LOCAL.x, TAVERN_KEEPER_LOCAL.z);
    expect(npc.pos).toEqual(p);
    for (const c of mirefenTavernColliders(S)) {
      if (c.type === 'circle') {
        expect(Math.hypot(p.x - c.x, p.z - c.z) - c.r - 0.5).toBeGreaterThan(0);
      }
    }
    const talk = w(TAVERN_KEEPER_LOCAL.x - 1.6, -5.9);
    expect(Math.hypot(talk.x - p.x, talk.z - p.z)).toBeLessThan(INTERACT_RANGE);
  });
});

describe('Mirefen tavern: walking it (the real movement kernel)', () => {
  let sim: Sim;
  const idle = {
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

  function place(lx: number, lz: number): void {
    const p = sim.player;
    const q = w(lx, lz);
    p.pos = { x: q.x, y: groundHeight(q.x, q.z, S), z: q.z };
    p.prevPos = { ...p.pos };
    p.vx = 0;
    p.vy = 0;
    p.vz = 0;
    p.onGround = true;
  }

  /** Walk toward local (lx, lz); where it ended (local) and the lowest the feet went. */
  function walk(lx: number, lz: number, jump = false, maxTicks = 300) {
    const p = sim.player;
    const meta = sim.players.get(p.id);
    if (!meta) throw new Error('meta');
    const t = w(lx, lz);
    let sink = 0;
    for (let i = 0; i < maxTicks; i++) {
      const dx = t.x - p.pos.x;
      const dz = t.z - p.pos.z;
      if (Math.hypot(dx, dz) < 0.25) break;
      p.facing = Math.atan2(dx, dz);
      Object.assign(meta.moveInput, { ...idle, forward: true, jump: jump && p.onGround });
      sim.tick();
      sink = Math.min(sink, p.pos.y - groundHeight(p.pos.x, p.pos.z, S));
    }
    Object.assign(meta.moveInput, idle);
    for (let i = 0; i < 10; i++) sim.tick();
    return {
      lx: TAVERN_ORIGIN.z - p.pos.z,
      lz: p.pos.x - TAVERN_ORIGIN.x,
      y: p.pos.y - TAVERN_FLOOR_Y,
      sink,
    };
  }

  beforeAll(() => {
    sim = new Sim({ seed: S, playerClass: 'warrior' });
    sim.setPlayerLevel(10);
  });

  const T = TAVERN_TOWER;
  const st = TAVERN_STAGE;
  // road, steps, porch, door, entry, into the hearth ring through the door-side gap, out by
  // the next gap, up onto the bar platform between the stools, across the room onto the
  // bard's stage, into the booth beside it, through the arch into the tower's nook and round
  // to its rose
  const ROUTE: readonly (readonly [number, number, number])[] = [
    [0, 22, Number.NaN],
    [0, 18.5, Number.NaN],
    [0, 15.2, 0],
    [0, 12, 0],
    [0, 8.8, 0],
    [0, 5.0, -TAVERN_PIT.depth],
    [4.2, 4.0, -TAVERN_PIT.depth],
    [6.4, 4.8, 0],
    [7.35, -2.5, 0],
    [7.35, -5.9, TAVERN_BAR_PLATFORM.lift],
    [7.35, -3.2, 0],
    [1.0, -4.4, 0],
    [-8.0, -7.2, 0],
    [-11.0, -10.2, st.lift],
    [-8.0, -7.2, 0],
    [-11.3, -4.6, 0],
    [-7.0, -5.0, 0],
    [-1.5, -10.5, 0],
    [-1.5, -14.5, 0],
    [T.x, T.z, 0],
    [T.x + 1.5, T.z - 1.5, 0],
  ];

  it('walks from the road to the fire, the bar, the stage, a booth and the nook, and back out', () => {
    place(ROUTE[0][0], ROUTE[0][1]);
    const legs = [...ROUTE.slice(1), ...[...ROUTE].reverse().slice(1)];
    for (const [lx, lz, y] of legs) {
      const end = walk(lx, lz);
      expect(
        Math.hypot(end.lx - lx, end.lz - lz),
        `to (${lx.toFixed(2)}, ${lz.toFixed(2)})`,
      ).toBeLessThan(0.45);
      if (!Number.isNaN(y))
        expect(end.y, `at (${lx.toFixed(2)}, ${lz.toFixed(2)})`).toBeCloseTo(y, 2);
      // on the floor the whole way, never through it
      expect(end.sink, `to (${lx.toFixed(2)}, ${lz.toFixed(2)})`).toBeGreaterThan(-0.05);
    }
  }, 180_000);

  it('never gets stuck in the doorway or the arch: straight through, both ways', () => {
    for (const dx of [-1.4, 0, 1.4]) {
      place(dx, 16);
      let end = walk(dx, 10);
      expect(Math.hypot(end.lx - dx, end.lz - 10), `in at ${dx}`).toBeLessThan(0.45);
      end = walk(dx, 16);
      expect(Math.hypot(end.lx - dx, end.lz - 16), `out at ${dx}`).toBeLessThan(0.45);
    }
    for (const dx of [-4.0, -1.5, 1.0]) {
      place(dx, -9);
      let end = walk(dx, -16);
      expect(Math.hypot(end.lx - dx, end.lz + 16), `into the nook at ${dx}`).toBeLessThan(0.45);
      end = walk(dx, -9);
      expect(Math.hypot(end.lx - dx, end.lz + 9), `out of the nook at ${dx}`).toBeLessThan(0.45);
    }
  }, 120_000);

  it('the walls and the hatch hold: walking or jumping at them keeps the player in', () => {
    // [start, push toward, the floor the player must stay on]
    const ring = (deg: number, r: number): [number, number] => [
      T.x + Math.sin((deg * Math.PI) / 180) * r,
      T.z + Math.cos((deg * Math.PI) / 180) * r,
    ];
    const [nx0, nz0] = ring(60, 3);
    const [nx1, nz1] = ring(60, 12);
    const pushes: [number, number, number, number, number][] = [
      [-12, 5, -25, 5, 0], // the left wall
      [12, 12, 12, 25, 0], // the front wall beside the door
      [-7, -11, -7, -25, 0], // the back wall between the stage and the arch
      [13.5, 5.5, 25, 5.5, 0], // the right wall
      [9.5, -10.5, 9.5, -25, TAVERN_BAR_PLATFORM.lift], // the kitchen hatch behind the bar
      [nx0, nz0, nx1, nz1, 0], // the nook's wall toward the wing
      [T.x, T.z, T.x - 12, T.z - 4, 0], // the nook's back, over its bench
    ];
    for (const jump of [false, true]) {
      for (const [x, z, tx, tz, y] of pushes) {
        place(x, z);
        const end = walk(tx, tz, jump, 80);
        expect(
          tavernInsideLocal(end.lx, end.lz),
          `${jump ? 'jump' : 'walk'} from (${x}, ${z})`,
        ).toBe(true);
        // over the nook's bench a body may end up stood on its seat, never higher
        const onBench = Math.abs(end.y - 0.85) < 0.1 && Math.hypot(end.lx - T.x, end.lz - T.z) > 4;
        expect(
          Math.abs(end.y - y) < 0.1 || onBench,
          `${jump ? 'jump' : 'walk'} from (${x}, ${z}) at ${end.y}`,
        ).toBe(true);
      }
    }
  }, 120_000);

  it('rests the player by the fire and stops at the door', () => {
    place(0, 8.5);
    const meta = sim.players.get(sim.player.id);
    if (!meta) throw new Error('meta');
    meta.restedXp = 0;
    for (let i = 0; i < 40; i++) sim.tick();
    expect(meta.restedXp).toBeGreaterThan(0);
    place(0, 15.5);
    const before = meta.restedXp;
    for (let i = 0; i < 40; i++) sim.tick();
    expect(meta.restedXp).toBe(before);
  }, 60_000);

  it('spawns the innkeeper once, under her reserved id, on the bar platform, facing the room', () => {
    const all = [...sim.entities.values()].filter(
      (x) => x.kind === 'npc' && x.templateId === 'innkeeper_maudie',
    );
    expect(all).toHaveLength(1);
    const e = sim.entities.get(TAVERN_KEEPER_ENTITY_ID);
    expect(e).toBe(all[0]);
    if (!e) return;
    expect(e.facing).toBeCloseTo(TAVERN_YAW, 9);
    expect(e.pos.y - TAVERN_FLOOR_Y).toBeCloseTo(TAVERN_BAR_PLATFORM.lift, 3);
    expect(sim.player.id).toBeLessThan(1_000_000_000);
  });
});
