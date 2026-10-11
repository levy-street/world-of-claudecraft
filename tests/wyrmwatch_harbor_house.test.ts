import { beforeAll, describe, expect, it } from 'vitest';
import { type Collider, queryOpenWorldColliders } from '../src/sim/colliders';
import { WYRMWATCH_HARBOR_DECKS } from '../src/sim/content/wyrmwatch_harbor';
import {
  HARBOR_HOUSE,
  HARBOR_HOUSE_FLOOR_ABOVE_WATER,
  HARBOR_HOUSE_INTERIOR,
  HARBOR_HOUSE_KEEPER_ENTITY_ID,
  HARBOR_HOUSE_LANTERNS,
  HARBOR_HOUSE_MAP,
  HARBOR_HOUSE_NPC_FACING,
  HARBOR_HOUSE_NPC_POS,
  HARBOR_HOUSE_PROPS,
  WYRMWATCH_HARBOR_NPCS,
} from '../src/sim/content/wyrmwatch_harbor_house';
import { BUILTIN_WORLD, NPCS } from '../src/sim/data';
import { MAX_STEP_HEIGHT } from '../src/sim/physics/character';
import { isResting } from '../src/sim/progression/xp';
import { Sim } from '../src/sim/sim';
import { type Entity, INTERACT_RANGE, STATIC_WORLD_SERVICE_ENTITY_ID_MIN } from '../src/sim/types';
import { groundHeight, terrainHeight, WATER_LEVEL } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';
import { wyrmwatchHarborColliders } from '../src/sim/wyrmwatch_harbor';
import {
  harborHouseColliders,
  harborHouseFloorY,
  harborHouseRestsAt,
  harborHouseWalls,
} from '../src/sim/wyrmwatch_harbor_house';
import { worldEntityText } from '../src/ui/world_entity_i18n';

// The Harbormaster's House at the Wyrmwatch cliff harbor (src/sim/content/wyrmwatch_harbor_house.ts,
// src/sim/wyrmwatch_harbor_house.ts): the enlarged walk-in house on stilts that replaced the
// harbormaster's shack. Pins its footprint over the water (no terrain edit, nothing on land),
// its walls minus the doorway, the rest area over its floor (the inn rule), its keeper, and
// walks in and out of it with the real movement kernel.

const S = WORLD_SEED;
const aw = (x: number, z: number): number => groundHeight(x, z, S) - WATER_LEVEL;
const H = HARBOR_HOUSE;
const I = HARBOR_HOUSE_INTERIOR;
const DOOR_Z = H.z + H.hd; // the door wall's outer face

/** Clearance between a circle and a collider (negative = overlap). */
function clearance(x: number, z: number, r: number, c: Collider): number {
  if (c.type === 'circle') return Math.hypot(x - c.x, z - c.z) - c.r - r;
  const cos = Math.cos(-c.rot);
  const sin = Math.sin(-c.rot);
  const lx = (x - c.x) * cos + (z - c.z) * sin;
  const lz = -(x - c.x) * sin + (z - c.z) * cos;
  const dx = Math.max(0, Math.abs(lx) - c.hw);
  const dz = Math.max(0, Math.abs(lz) - c.hd);
  return Math.hypot(dx, dz) - r;
}

describe("Harbormaster's House: where it stands", () => {
  it('stands on its own floor deck at the quays height, over the water north of the yard', () => {
    const floor = WYRMWATCH_HARBOR_DECKS.find((d) => d.id === 'houseFloor');
    if (!floor) throw new Error('no houseFloor deck');
    expect(floor.x).toBe(H.x);
    expect(floor.z).toBe(H.z);
    expect(floor.hw).toBe(H.hw);
    expect(floor.hl).toBe(H.hd);
    expect(HARBOR_HOUSE_FLOOR_ABOVE_WATER).toBe(floor.nearAboveWater);
    expect(HARBOR_HOUSE_FLOOR_ABOVE_WATER).toBe(floor.farAboveWater);
    const yard = WYRMWATCH_HARBOR_DECKS.find((d) => d.id === 'northYard');
    if (!yard) throw new Error('no yard');
    // the floor and the yard share a height, the yard laps under the door wall
    expect(yard.nearAboveWater).toBe(HARBOR_HOUSE_FLOOR_ABOVE_WATER);
    expect(yard.z - yard.hl).toBeLessThan(DOOR_Z - 0.2);
    // everywhere under the footprint the floor stands over the ground: the house grows
    // over the sea and the beach, never into the land (no terrain edit)
    for (let x = H.x - H.hw + 0.05; x <= H.x + H.hw - 0.05; x += 0.25) {
      for (let z = H.z - H.hd + 0.05; z <= H.z + H.hd - 0.05; z += 0.25) {
        expect(aw(x, z), `(${x.toFixed(2)}, ${z.toFixed(2)})`).toBeCloseTo(
          HARBOR_HOUSE_FLOOR_ABOVE_WATER,
          6,
        );
        expect(terrainHeight(x, z, S) - WATER_LEVEL).toBeLessThan(
          HARBOR_HOUSE_FLOOR_ABOVE_WATER - 1,
        );
      }
    }
  });

  it('is generously sized for the player: a tall room, a door a body walks through', () => {
    // the player stands 2.6 to the crown on a 0.5 radius: the room is more than twice that
    // to the tie beams and roomy across, the doorway clear by a body either side
    expect(H.tieBeam).toBeGreaterThan(2.5 * 2.6);
    expect(I.x1 - I.x0).toBeGreaterThan(9);
    expect(I.z1 - I.z0).toBeGreaterThan(8);
    expect(H.door.height).toBeGreaterThan(2.6 + 1);
    expect(H.door.width).toBeGreaterThanOrEqual(2.4);
    // the old shack was 3.5 by 4.4: the house is more than twice as big on each side
    expect(H.hw * 2).toBeGreaterThan(2 * 3.5);
    expect(H.hd * 2).toBeGreaterThan(2 * 4.4);
    // ...grown seaward: its west wall stands where the yard's landward rail stood, and
    // nothing of it reaches the yard's landward edge
    expect(H.x - H.hw).toBeGreaterThan(487.5);
  });
});

describe("Harbormaster's House: walls minus the doorway", () => {
  const walls = harborHouseWalls();
  const colliders = harborHouseColliders(S);

  it('closes the room on every side but the doorway', () => {
    // four walls, the door wall in two pieces either side of the doorway
    expect(walls.map((w) => w.id).sort()).toEqual(['east', 'north', 'south', 'southEast', 'west']);
    const south = walls.find((w) => w.id === 'south');
    const southEast = walls.find((w) => w.id === 'southEast');
    if (!south || !southEast) throw new Error('door wall');
    const gap0 = south.x + south.hw;
    const gap1 = southEast.x - southEast.hw;
    expect(gap0).toBeCloseTo(H.door.x - H.door.width / 2, 9);
    expect(gap1).toBeCloseTo(H.door.x + H.door.width / 2, 9);
    // the walls meet at the corners (no slit a body could slip through)
    for (const w of walls) {
      expect(w.x - w.hw).toBeGreaterThanOrEqual(H.x - H.hw - 1e-9);
      expect(w.x + w.hw).toBeLessThanOrEqual(H.x + H.hw + 1e-9);
      expect(w.z - w.hd).toBeGreaterThanOrEqual(H.z - H.hd - 1e-9);
      expect(w.z + w.hd).toBeLessThanOrEqual(H.z + H.hd + 1e-9);
    }
    // every point on the room's boundary is inside a wall box, except the doorway
    const inWall = (x: number, z: number): boolean =>
      walls.some((w) => Math.abs(x - w.x) <= w.hw + 1e-9 && Math.abs(z - w.z) <= w.hd + 1e-9);
    for (let t = 0; t <= 1; t += 0.01) {
      const x = H.x - H.hw + 0.1 + (H.hw * 2 - 0.2) * t;
      const z = H.z - H.hd + 0.1 + (H.hd * 2 - 0.2) * t;
      expect(inWall(x, H.z - H.hd + 0.1), `north ${x}`).toBe(true);
      expect(inWall(H.x - H.hw + 0.1, z), `west ${z}`).toBe(true);
      expect(inWall(H.x + H.hw - 0.1, z), `east ${z}`).toBe(true);
      const inDoor = x > gap0 + 1e-6 && x < gap1 - 1e-6;
      expect(inWall(x, DOOR_Z - 0.1), `south ${x}`).toBe(!inDoor);
    }
  });

  it('blocks at full height for movement and sight, and joins the live static grid', () => {
    const top = harborHouseFloorY() + H.wallTop;
    for (const c of colliders.slice(0, walls.length)) {
      expect(c.moveTopY, 'walls block at any height').toBeUndefined();
      expect(c.standable).toBeUndefined();
      expect(c.cameraTopY).toBeCloseTo(top, 9);
    }
    const harbor = wyrmwatchHarborColliders(S);
    for (const c of colliders) {
      expect(harbor).toContainEqual(c);
      const near: Collider[] = [];
      queryOpenWorldColliders(S, c.x - 0.1, c.z - 0.1, c.x + 0.1, c.z + 0.1, near);
      expect(near.some((n) => n.x === c.x && n.z === c.z && n.gate === undefined)).toBe(true);
    }
  });

  it('seats every furnishing on the floor inside the walls, the solid ones full height', () => {
    for (const p of HARBOR_HOUSE_PROPS) {
      if (p.kind === 'chimney') {
        // outside the land wall, over the shingle, clear of the yard's rail line
        expect(p.x + (p.hw ?? 0)).toBeLessThanOrEqual(H.x - H.hw + 1e-9);
        continue;
      }
      const ex = p.r ?? p.hw ?? 0;
      const ez = p.r ?? p.hd ?? 0;
      expect(p.x - ex, p.kind).toBeGreaterThanOrEqual(I.x0 - 1e-9);
      expect(p.x + ex, p.kind).toBeLessThanOrEqual(I.x1 + 1e-9);
      expect(p.z - ez, p.kind).toBeGreaterThanOrEqual(I.z0 - 1e-9);
      expect(p.z + ez, p.kind).toBeLessThanOrEqual(I.z1 + 1e-9);
      expect(aw(p.x, p.z), p.kind).toBeCloseTo(HARBOR_HOUSE_FLOOR_ABOVE_WATER, 6);
      if (p.kind === 'hearth') expect(p.standable).toBeUndefined();
      else expect(p.standable, p.kind).toBe(true);
    }
  });
});

describe("Harbormaster's House: the rest area (the inn rule)", () => {
  const at = (x: number, y: number, z: number, inCombat = false): Entity =>
    ({ pos: { x, y, z }, inCombat }) as unknown as Entity;
  const floorY = WATER_LEVEL + HARBOR_HOUSE_FLOOR_ABOVE_WATER;

  it('covers the whole floor inside the walls, and nothing outside them', () => {
    for (let x = I.x0 + 0.05; x <= I.x1 - 0.05; x += 0.5) {
      for (let z = I.z0 + 0.05; z <= I.z1 - 0.05; z += 0.5) {
        expect(harborHouseRestsAt(x, floorY, z), `(${x}, ${z})`).toBe(true);
        expect(isResting(at(x, floorY, z)), `(${x}, ${z})`).toBe(true);
      }
    }
    // the yard outside the door, the quay, the water off the sea wall
    for (const [x, z] of [
      [H.door.x, DOOR_Z + 0.6],
      [491, 1899.4],
      [H.x + H.hw + 1, H.z],
    ] as const) {
      expect(isResting(at(x, aw(x, z) + WATER_LEVEL, z)), `(${x}, ${z})`).toBe(false);
    }
  });

  it('never rests a swimmer under the stilts, a fighter, or another world', () => {
    const x = (I.x0 + I.x1) / 2;
    const z = (I.z0 + I.z1) / 2;
    expect(isResting(at(x, WATER_LEVEL - 0.5, z))).toBe(false);
    // ...nor anything above the room (over the wall plate)
    expect(isResting(at(x, floorY + H.wallTop + 0.5, z))).toBe(false);
    expect(isResting(at(x, floorY, z, true))).toBe(false);
    expect(isResting(at(x, floorY, z), [], [], false)).toBe(false);
    expect(isResting(at(x, floorY, z), [], [], true)).toBe(true);
  });

  it('is the built-in world only', () => {
    // the default reads the active world, which is the built-in one here
    expect(BUILTIN_WORLD.npcs.harbormaster_tamsin).toBeDefined();
  });
});

describe("Harbormaster's House: its keeper", () => {
  const npc = WYRMWATCH_HARBOR_NPCS.harbormaster_tamsin;

  it('is registered as a gossip NPC with localized name, title and greeting keys', () => {
    expect(NPCS.harbormaster_tamsin).toBe(npc);
    // a singleton under a reserved id: the world-init loop skips her, so no other entity's id
    // moves (the FURY / Crucible vendor idiom)
    expect(npc.dynamic).toBe(true);
    expect(HARBOR_HOUSE_KEEPER_ENTITY_ID).toBeGreaterThanOrEqual(1_000_000_000);
    expect(HARBOR_HOUSE_KEEPER_ENTITY_ID).toBeLessThan(STATIC_WORLD_SERVICE_ENTITY_ID_MIN);
    expect(npc.questIds).toEqual([]);
    expect(npc.vendorItems).toBeUndefined();
    const npcs = worldEntityText.en.entities.npcs as Record<string, Record<string, string>>;
    expect(npcs.harbormaster_tamsin).toEqual({
      name: npc.name,
      title: npc.title,
      greeting: npc.greeting,
    });
    // the gossip names both routes and the map, never a timetable
    expect(npc.greeting).toMatch(/Wickharbor/);
    expect(npc.greeting).toMatch(/Eastbrook/);
    expect(npc.greeting).toMatch(/Nightbloom/);
    expect(npc.greeting).toMatch(/map/);
    expect(npc.greeting).not.toMatch(/\d|minute|hour|schedule|timetable/i);
  });

  it('stands on the floor behind the chart table, clear of every solid, in reach from the room', () => {
    expect(npc.pos).toEqual(HARBOR_HOUSE_NPC_POS);
    for (const c of harborHouseColliders(S)) {
      expect(clearance(npc.pos.x, npc.pos.z, 0.5, c), `(${c.x}, ${c.z})`).toBeGreaterThan(0);
    }
    const table = HARBOR_HOUSE_PROPS.find((p) => p.kind === 'chartTable');
    if (!table) throw new Error('table');
    // across the table from the room's middle: a player on the table's near side talks
    const talkX = table.x;
    const talkZ = table.z + (table.hd ?? 0) + 0.7;
    expect(Math.hypot(talkX - npc.pos.x, talkZ - npc.pos.z)).toBeLessThan(INTERACT_RANGE);
    // the wall map hangs on the north wall's inner face behind her
    expect(Math.abs(HARBOR_HOUSE_MAP.x - npc.pos.x)).toBeLessThan(HARBOR_HOUSE_MAP.width);
    expect(HARBOR_HOUSE_MAP.x - HARBOR_HOUSE_MAP.width / 2).toBeGreaterThan(I.x0);
    expect(HARBOR_HOUSE_MAP.x + HARBOR_HOUSE_MAP.width / 2).toBeLessThan(I.x1);
    expect(HARBOR_HOUSE_MAP.top).toBeLessThan(H.tieBeam);
    // the lanterns hang inside the room, over a player's head
    for (const l of HARBOR_HOUSE_LANTERNS) {
      expect(l.x).toBeGreaterThan(I.x0);
      expect(l.x).toBeLessThan(I.x1);
      expect(l.z).toBeGreaterThan(I.z0);
      expect(l.z).toBeLessThan(I.z1);
      expect(H.tieBeam - l.drop).toBeGreaterThan(2.6 + 1);
    }
  });
});

describe("Harbormaster's House: walking it (the real movement kernel)", () => {
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

  function place(x: number, z: number): void {
    const p = sim.player;
    p.pos = { x, y: groundHeight(x, z, S), z };
    p.prevPos = { ...p.pos };
    p.vx = 0;
    p.vy = 0;
    p.vz = 0;
    p.onGround = true;
  }

  /** Walk toward (x, z); where it ended and the lowest the feet went under the ground. */
  function walk(tx: number, tz: number, jump = false, maxTicks = 300) {
    const p = sim.player;
    const meta = sim.players.get(p.id);
    if (!meta) throw new Error('meta');
    let sink = 0;
    for (let i = 0; i < maxTicks; i++) {
      const dx = tx - p.pos.x;
      const dz = tz - p.pos.z;
      if (Math.hypot(dx, dz) < 0.25) break;
      p.facing = Math.atan2(dx, dz);
      Object.assign(meta.moveInput, { ...idle, forward: true, jump: jump && p.onGround });
      sim.tick();
      sink = Math.min(sink, p.pos.y - groundHeight(p.pos.x, p.pos.z, S));
    }
    Object.assign(meta.moveInput, idle);
    for (let i = 0; i < 10; i++) sim.tick();
    return { x: p.pos.x, z: p.pos.z, y: p.pos.y - WATER_LEVEL, sink };
  }

  beforeAll(() => {
    sim = new Sim({ seed: S, playerClass: 'warrior' });
    sim.setPlayerLevel(10);
  });

  // from the pier's root up the yard, through the door, to the rest corner before the
  // hearth, on to the chart table, and back out the same way
  const IN: readonly (readonly [number, number])[] = [
    [491, 1899.4],
    [491, 1896.6],
    [H.door.x, 1893],
    [H.door.x, DOOR_Z + 0.8],
    [H.door.x, DOOR_Z - 1.5],
    [H.door.x, 1884.6], // the rest corner, before the fire
    [493.6, 1884.4], // beside the harbormaster
    [492.3, 1884.6], // round the chart table's west end
    [492.3, 1888.3],
    [494.3, 1888.3], // the chart table's near side
  ];

  it('walks from the quay through the door to the rest corner and the table, and back out', () => {
    place(IN[0][0], IN[0][1]);
    const legs = [...IN.slice(1), ...[...IN].reverse().slice(1)];
    for (const [x, z] of legs) {
      const end = walk(x, z);
      expect(Math.hypot(end.x - x, end.z - z), `to (${x}, ${z})`).toBeLessThan(0.4);
      // on the planks the whole way, never through the floor
      expect(end.y, `at (${x}, ${z})`).toBeCloseTo(HARBOR_HOUSE_FLOOR_ABOVE_WATER, 3);
      expect(end.sink, `to (${x}, ${z})`).toBeGreaterThan(-0.05);
    }
  }, 90_000);

  it('rests the player at the rest corner: rested experience accrues there', () => {
    place(H.door.x, 1884.6);
    const meta = sim.players.get(sim.player.id);
    if (!meta) throw new Error('meta');
    meta.restedXp = 0;
    for (let i = 0; i < 40; i++) sim.tick();
    expect(meta.restedXp).toBeGreaterThan(0);
    // ...and stops the moment the player steps out onto the yard
    place(H.door.x, DOOR_Z + 1.2);
    const before = meta.restedXp;
    for (let i = 0; i < 40; i++) sim.tick();
    expect(meta.restedXp).toBe(before);
  }, 60_000);

  it('never gets stuck in the doorway: straight through, both ways, and along its jambs', () => {
    for (const dx of [-0.5, 0, 0.5]) {
      const x = H.door.x + dx;
      place(x, DOOR_Z + 1.5);
      let end = walk(x, DOOR_Z - 1.5);
      expect(Math.hypot(end.x - x, end.z - (DOOR_Z - 1.5)), `in at ${x}`).toBeLessThan(0.4);
      end = walk(x, DOOR_Z + 1.5);
      expect(Math.hypot(end.x - x, end.z - (DOOR_Z + 1.5)), `out at ${x}`).toBeLessThan(0.4);
    }
  }, 60_000);

  it('the walls hold: walking or jumping at every wall keeps the player in the room', () => {
    // (start inside, push toward a point well outside the wall)
    const pushes: [number, number, number, number][] = [
      [496.4, 1885.0, 496.4, 1876], // north, east of the map
      [496.5, 1885.6, 505, 1885.6], // east, the sea wall at the bay window
      [490.2, 1888.2, 482, 1888.2], // west, the land wall (south of the hearth)
      [494.0, 1888.9, 494.0, 1896], // south, the door wall east of the doorway
      [489.1, 1888.9, 487, 1896], // south-west, the wall piece west of the doorway
    ];
    for (const jump of [false, true]) {
      for (const [x, z, tx, tz] of pushes) {
        place(x, z);
        const end = walk(tx, tz, jump, 80);
        const inside =
          end.x > I.x0 - 0.01 && end.x < I.x1 + 0.01 && end.z > I.z0 - 0.01 && end.z < I.z1 + 0.01;
        expect(inside, `${jump ? 'jump' : 'walk'} from (${x}, ${z})`).toBe(true);
        // on the floor, never through it or out into the water
        expect(end.y, `(${x}, ${z})`).toBeGreaterThan(HARBOR_HOUSE_FLOOR_ABOVE_WATER - 0.05);
      }
    }
    // a stride never climbs the walls: they are full height
    expect(MAX_STEP_HEIGHT).toBeLessThan(H.wallTop);
  }, 90_000);

  it('spawns the harbormaster once, under her reserved id, on the floor, turned toward the door', () => {
    const all = [...sim.entities.values()].filter(
      (x) => x.kind === 'npc' && x.templateId === 'harbormaster_tamsin',
    );
    expect(all).toHaveLength(1);
    const e = sim.entities.get(HARBOR_HOUSE_KEEPER_ENTITY_ID);
    if (!e) throw new Error('no harbormaster');
    expect(e).toBe(all[0]);
    expect(e.facing).toBeCloseTo(HARBOR_HOUSE_NPC_FACING, 9);
    // and she leaves the sequential ids alone: the player still takes the first free one
    expect(sim.player.id).toBeLessThan(1_000_000_000);
    expect(e.pos.x).toBeCloseTo(HARBOR_HOUSE_NPC_POS.x, 3);
    expect(e.pos.z).toBeCloseTo(HARBOR_HOUSE_NPC_POS.z, 3);
    expect(e.pos.y - WATER_LEVEL).toBeCloseTo(HARBOR_HOUSE_FLOOR_ABOVE_WATER, 3);
  });
});
