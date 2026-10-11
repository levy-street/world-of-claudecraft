import { beforeAll, describe, expect, it } from 'vitest';
import { supportHeightAt } from '../src/sim/colliders';
import {
  EASTBROOK_FERRY_HULL,
  EASTBROOK_NIGHTBLOOM_FERRY,
  WICKHARBOR_DRAKELANDS_FERRY,
} from '../src/sim/content/transport_ships';
import {
  WICKHARBOR_WHARF_ABOVE_WATER,
  WICKHARBOR_WHARF_DECKS,
  WICKHARBOR_WHARF_ROT,
} from '../src/sim/content/wickharbor_wharf';
import { WYRMWATCH_HARBOR_DECKS } from '../src/sim/content/wyrmwatch_harbor';
import { PROPS } from '../src/sim/data';
import { EASTBROOK_HARBOR_DECKS } from '../src/sim/eastbrook_harbor';
import { FERRY_PIER_DECK_ABOVE_WATER, FERRY_PIER_DECKS } from '../src/sim/ferry_piers';
import { entityLineOfSightClear } from '../src/sim/line_of_sight_elevation';
import { MAX_STEP_HEIGHT } from '../src/sim/physics/character';
import { Sim } from '../src/sim/sim';
import { transportBerthColliders } from '../src/sim/transport_gates';
import { transportVoyageSeconds } from '../src/sim/transport_schedule';
import { shipToWorld, worldToShip } from '../src/sim/transport_ship';
import type { Entity } from '../src/sim/types';
import { groundHeight, terrainHeight, WATER_LEVEL } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

// The ferries' berths: moored across the ferry pier's T-head at Eastbrook
// (Phase 1), across the ferry wharf's berth head at Wickharbor (Phase 2), and
// across the ends of the Moonrest and Wyrmwatch ferry piers at the far berths
// (sim/ferry_piers.ts), the deck walkable while the ship lies docked. These pin the berths
// (position, waterline, the harbor they displaced), the boarding route from
// each pier onto the deck and up to the quarterdeck, the rails that keep a
// crowd aboard, and sight lines across the open deck, by driving the real
// movement kernel through the shipped content. The schedule is held at a
// docked moment (Sim.transportClockOffset) for every walk.

const ROUTE = EASTBROOK_NIGHTBLOOM_FERRY;
const ferry = ROUTE.berths[0];
const WICK = WICKHARBOR_DRAKELANDS_FERRY.berths[0];
const HULL = EASTBROOK_FERRY_HULL;
/** Clocks at which the ship lies docked at each berth (every route lies at
 *  its first berth at clock 0). */
const DOCKED_EAST = 1;
const DOCKED_WICK = 1;

function pose() {
  return { x: ferry.x, z: ferry.z, rot: ferry.rot, baseY: WATER_LEVEL };
}

function wickPose() {
  return { x: WICK.x, z: WICK.z, rot: WICK.rot, baseY: WATER_LEVEL };
}

describe('Eastbrook ferry berth', () => {
  it('moors one ferry broadside across the ferry pier T-head, on the waterline', () => {
    // the scheduled route owns the ship: no static decorProps row moors it
    expect(PROPS.decorProps?.filter((prop) => prop.key === 'eastbrookFerry')).toHaveLength(0);
    expect(ferry).toMatchObject({ id: 'eastbrook', x: -125, z: -54.8, rot: 0 });
    // the ferry pier keeps its authored width (no widening for the ship)
    const pier = EASTBROOK_HARBOR_DECKS[1];
    expect(pier).toMatchObject({ x: -107, z: -54, hl: 10, hw: 2.2 });
    // the port gangway looks square down the pier's axis
    const gangway = HULL.boarding.find((b) => b.side === 'port');
    if (!gangway) throw new Error('no port gangway');
    const at = shipToWorld(pose(), gangway.x, gangway.z);
    expect(at.z).toBeCloseTo(pier.z, 6);
    // the gap the gangplank spans, from the hull side to the pier's end
    expect(pier.x - pier.hl - at.x).toBeGreaterThan(2);
    expect(pier.x - pier.hl - at.x).toBeLessThan(3.5);
  });

  it('records the harbor it displaced: one hull retired, boats and buoys moved to open water', () => {
    const props = PROPS.decorProps ?? [];
    expect(props.some((p) => p.key === 'hexShipBlue' && p.x === -115 && p.z === -45)).toBe(false);
    expect(props.some((p) => p.key === 'hexShipBlue' && p.x === -115 && p.z === -63)).toBe(false);
    expect(
      props.filter((p) => p.key === 'hexShipBlue' && p.x === -170 && p.z === -22),
    ).toHaveLength(1);
    expect(
      props.filter((p) => p.key === 'seaBoatFishing' && p.x === -113 && p.z === -46),
    ).toHaveLength(1);
    // the fairway buoys flank the western approach, outside the hull and
    // clear of its swing out of the cove (Phase 3)
    expect(props.filter((p) => p.key === 'seaBuoy' && p.x === -160 && p.z === -58)).toHaveLength(1);
    expect(
      props.filter((p) => p.key === 'seaBuoyFlag' && p.x === -160 && p.z === -90),
    ).toHaveLength(1);
  });

  it('floats in water across its whole length, keel clear of the seabed', () => {
    const p = pose();
    for (const z of [-15, -10, -5, 0, 5, 10, 14]) {
      const at = shipToWorld(p, 0, z);
      const seabed = terrainHeight(at.x, at.z, WORLD_SEED);
      // the keel is 2.4 below the waterline amidships and rises toward the ends
      const keel = z > 6.5 || z < -10.5 ? 1.6 : HULL.draft;
      expect(seabed, `seabed at ship z ${z}`).toBeLessThan(WATER_LEVEL - keel);
    }
  });

  it('keeps every other moored hull and the piers clear of its decks', () => {
    const p = pose();
    const decks = HULL.volumes.filter((v) => v.kind === 'deck');
    for (const other of PROPS.decorProps ?? []) {
      // every floating row, walk-through dressing (buoys) included
      if (other.float === undefined) continue;
      const clearance = other.r ?? 1;
      const local = worldToShip(p, other.x, other.z);
      for (const d of decks) {
        const dx = Math.max(0, Math.abs(local.x - d.x) - (d.hw ?? 0));
        const dz = Math.max(0, Math.abs(local.z - d.z) - (d.hd ?? 0));
        expect(Math.hypot(dx, dz), `${other.key} at (${other.x}, ${other.z})`).toBeGreaterThan(
          clearance,
        );
      }
    }
    for (const d of decks) {
      const at = shipToWorld(p, d.x, d.z);
      expect(groundHeight(at.x, at.z, WORLD_SEED)).toBeLessThan(WATER_LEVEL);
    }
  });

  it('seats the deck volumes on the rendered waterline', () => {
    // one hull per berth, each tagged with its berth's schedule gate (the
    // berths' harbor route marker posts ride along ungated)
    const colliders = transportBerthColliders(WORLD_SEED).filter((c) => c.gate !== undefined);
    expect(colliders).toHaveLength(4 * HULL.volumes.length);
    expect(new Set(colliders.map((c) => c.gate))).toEqual(
      new Set([
        'eastbrookNightbloom:0',
        'eastbrookNightbloom:1',
        'wickharborDrakelands:0',
        'wickharborDrakelands:1',
      ]),
    );
    const main = HULL.volumes.find((v) => v.id === 'main_deck_aft');
    if (!main) throw new Error('no main deck');
    const at = shipToWorld(pose(), main.x + 2, main.z);
    const top = supportHeightAt(WORLD_SEED, at.x, at.z, 0.5, WATER_LEVEL + 10);
    expect(top).toBeCloseTo(WATER_LEVEL + HULL.mainDeckY, 6);
  });
});

describe('walking aboard (the real movement kernel)', () => {
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

  function place(x: number, z: number, y = groundHeight(x, z, WORLD_SEED)): void {
    const p = sim.player;
    p.pos.x = x;
    p.pos.z = z;
    p.pos.y = y;
    p.prevPos = { ...p.pos };
    p.vx = 0;
    p.vy = 0;
    p.vz = 0;
    p.onGround = true;
  }

  function placeLocal(x: number, z: number, y: number): void {
    const at = shipToWorld(pose(), x, z);
    place(at.x, at.z, pose().baseY + y);
  }

  /** Walk toward a ship-frame point; returns where the walk ended, ship frame.
   *  The timetable is held docked at Eastbrook for the whole walk. */
  function walkToLocal(tx: number, tz: number, jump = false, maxTicks = 240) {
    sim.transportClockOffset = DOCKED_EAST - sim.time;
    const target = shipToWorld(pose(), tx, tz);
    const meta = sim.players.get(sim.player.id);
    if (!meta) throw new Error('player meta missing');
    for (let i = 0; i < maxTicks; i++) {
      const p = sim.player;
      const dx = target.x - p.pos.x;
      const dz = target.z - p.pos.z;
      if (Math.hypot(dx, dz) < 0.25) break;
      p.facing = Math.atan2(dx, dz);
      Object.assign(meta.moveInput, { ...idle, forward: true, jump: jump && p.onGround });
      sim.tick();
    }
    Object.assign(meta.moveInput, idle);
    for (let i = 0; i < 20; i++) sim.tick();
    const p = sim.player;
    const local = worldToShip(pose(), p.pos.x, p.pos.z);
    return {
      x: local.x,
      z: local.z,
      y: p.pos.y - pose().baseY,
      overboard: p.pos.y < WATER_LEVEL + 1,
    };
  }

  beforeAll(() => {
    sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', autoEquip: true });
    sim.setPlayerLevel(60);
  });

  it('boards from the pier over the gangplank onto the main deck', () => {
    place(-110, -54);
    const pierDeck = sim.player.pos.y - WATER_LEVEL;
    expect(pierDeck).toBeCloseTo(2.64, 2);
    const gangway = HULL.boarding.find((b) => b.side === 'port');
    if (!gangway) throw new Error('no port gangway');
    // every rise on the way is a stride, never a jump
    expect(HULL.mainDeckY - pierDeck).toBeLessThan(MAX_STEP_HEIGHT);
    const onGangway = walkToLocal(gangway.x - 0.3, gangway.z);
    expect(onGangway.y).toBeCloseTo(HULL.mainDeckY, 3);
    const onDeck = walkToLocal(1.5, gangway.z);
    expect(onDeck.y).toBeCloseTo(HULL.mainDeckY, 3);
    expect(Math.abs(onDeck.x - 1.5)).toBeLessThan(0.3);
  });

  it('climbs the port stair to the quarterdeck and the centre stair to the forecastle', () => {
    placeLocal(1.5, 0.8, HULL.mainDeckY);
    walkToLocal(3.72, -1.8);
    const top = walkToLocal(3.72, -8.2);
    expect(top.y).toBeCloseTo(HULL.captainDeckY, 3);
    const helm = walkToLocal(1.4, -12.2);
    expect(helm.y).toBeCloseTo(HULL.captainDeckY, 3);
    placeLocal(-1.2, 5.5, HULL.mainDeckY);
    walkToLocal(0, 6.6);
    const fc = walkToLocal(-1.2, 10.0);
    expect(fc.y).toBeCloseTo(HULL.forecastleY, 3);
  });

  it('the rails hold: walking or jumping at the side keeps the player aboard', () => {
    placeLocal(0, 3.5, HULL.mainDeckY);
    const walked = walkToLocal(-8, 3.5, false, 90);
    expect(walked.overboard).toBe(false);
    expect(walked.x).toBeGreaterThan(-5.2);
    placeLocal(0, -1.8, HULL.mainDeckY);
    const jumped = walkToLocal(8, -1.8, true, 90);
    expect(jumped.overboard).toBe(false);
    expect(jumped.x).toBeLessThan(5.2);
    // the starboard gangway is barred while no dock meets it
    placeLocal(-2, 0.8, HULL.mainDeckY);
    const barred = walkToLocal(-8, 0.8, false, 90);
    expect(barred.overboard).toBe(false);
    expect(barred.x).toBeGreaterThan(-5.2);
    // the quarterdeck's front rail: no walking off onto the waist
    placeLocal(0, -9.5, HULL.captainDeckY);
    const edge = walkToLocal(0, -3.0, false, 90);
    expect(edge.y).toBeCloseTo(HULL.captainDeckY, 3);
    // the bow rail closes the forecastle at the stem
    placeLocal(0.8, 12.5, HULL.forecastleY);
    const bow = walkToLocal(0.8, 18, false, 90);
    expect(bow.y).toBeCloseTo(HULL.forecastleY, 3);
  }, 60_000);

  it('the rails hold beside the edge dressing too (bench, barrels, crates)', () => {
    // jumping at the rail from right beside the bench and the barrels holds too
    placeLocal(3.3, 5.0, HULL.mainDeckY);
    const fromBench = walkToLocal(8, 5.0, true, 90);
    expect(fromBench.overboard).toBe(false);
    placeLocal(-2.4, 7.4, HULL.mainDeckY);
    const fromBarrels = walkToLocal(-8, 7.4, true, 90);
    expect(fromBarrels.overboard).toBe(false);
    placeLocal(2.2, 7.5, HULL.mainDeckY);
    const fromCrates = walkToLocal(8, 7.5, true, 90);
    expect(fromCrates.overboard).toBe(false);
  }, 60_000);

  it('sees across the open deck, while a mast still blocks', () => {
    const at = (x: number, z: number, y: number) => {
      const w = shipToWorld(pose(), x, z);
      return { x: w.x, y: pose().baseY + y, z: w.z };
    };
    // the length of the waist, over the hatch and between the benches
    const a = { ...sim.player, pos: at(2.5, -1.5, HULL.mainDeckY) } as Entity;
    const b = { ...sim.player, id: -1, pos: at(2.5, 6.5, HULL.mainDeckY) } as Entity;
    expect(entityLineOfSightClear(WORLD_SEED, a, b)).toBe(true);
    // across the beam, over both rails' height, from gangway to gangway
    const port = { ...sim.player, id: -5, pos: at(4.2, 0.8, HULL.mainDeckY) } as Entity;
    const starboard = { ...sim.player, id: -6, pos: at(-4.2, 0.8, HULL.mainDeckY) } as Entity;
    expect(entityLineOfSightClear(WORLD_SEED, port, starboard)).toBe(true);
    // from the waist up to the quarterdeck, over its front rail
    const c = { ...sim.player, id: -2, pos: at(0.5, -11, HULL.captainDeckY) } as Entity;
    expect(entityLineOfSightClear(WORLD_SEED, a, c)).toBe(true);
    // straight down the centre line the main mast stands in the way
    const d = { ...sim.player, id: -3, pos: at(0, -2, HULL.mainDeckY) } as Entity;
    const e = { ...sim.player, id: -4, pos: at(0, 7, HULL.mainDeckY) } as Entity;
    expect(entityLineOfSightClear(WORLD_SEED, d, e)).toBe(false);
  });
});

describe('Wickharbor berth (Phase 2)', () => {
  const pier = WICKHARBOR_WHARF_DECKS[0];
  const head = WICKHARBOR_WHARF_DECKS[1];

  it('lies broadside across the wharf berth head, its gangway on the pier axis', () => {
    expect(pier).toMatchObject({ id: 'pier', rot: WICKHARBOR_WHARF_ROT });
    expect(head).toMatchObject({ id: 'berthHead', rot: WICKHARBOR_WHARF_ROT });
    // the same relation to its pier as at Eastbrook: ship rot = pier rot + PI/2
    expect(WICK.rot).toBeCloseTo(pier.rot + Math.PI / 2, 9);
    const gangway = HULL.boarding.find((b) => b.side === 'port');
    if (!gangway) throw new Error('no port gangway');
    const at = shipToWorld(wickPose(), gangway.x, gangway.z);
    // on the pier's centre line (zero across offset)
    const dx = at.x - pier.x;
    const dz = at.z - pier.z;
    const across = dx * Math.cos(pier.rot) - dz * Math.sin(pier.rot);
    expect(Math.abs(across)).toBeLessThan(0.05);
  });

  it('meets the gangplank with the berth head at the ferry pier height', () => {
    const along = (d: typeof head, x: number, z: number) =>
      (x - d.x) * Math.sin(d.rot) + (z - d.z) * Math.cos(d.rot);
    // the head reaches under the gangplank's outer tread (ship x 7.1..8.3)
    // and stops short of the hull (ship x 5.15)
    const plankOuter = shipToWorld(wickPose(), 8.3, 0.8);
    const plankInner = shipToWorld(wickPose(), 7.1, 0.8);
    const hullSide = shipToWorld(wickPose(), 5.15, 0.8);
    expect(Math.abs(along(head, plankOuter.x, plankOuter.z))).toBeLessThan(head.hl);
    expect(Math.abs(along(head, plankInner.x, plankInner.z))).toBeLessThan(head.hl);
    expect(along(head, hullSide.x, hullSide.z)).toBeGreaterThan(head.hl);
    // the plank's outer tread is a stride above the head, as at every other berth
    expect(WICKHARBOR_WHARF_ABOVE_WATER).toBe(FERRY_PIER_DECK_ABOVE_WATER);
    const rise = HULL.mainDeckY - 0.44 - WICKHARBOR_WHARF_ABOVE_WATER;
    expect(rise).toBeLessThan(MAX_STEP_HEIGHT);
    expect(rise).toBeGreaterThan(0);
    const centre = groundHeight(head.x, head.z, WORLD_SEED);
    expect(centre - WATER_LEVEL).toBeCloseTo(WICKHARBOR_WHARF_ABOVE_WATER, 6);
    const pierTop = groundHeight(pier.x, pier.z, WORLD_SEED);
    expect(pierTop).toBeCloseTo(centre, 9);
  });

  it('floats in water across its whole footprint', () => {
    const p = wickPose();
    for (const z of [-15, -10, -5, 0, 5, 10, 14]) {
      for (const x of [-4, 0, 4]) {
        const at = shipToWorld(p, x, z);
        // the bay is shallow here (1.5 to 2.1 yd): the hull is wet end to end,
        // its keel reaching into the sand under water where the bay is shoal
        expect(terrainHeight(at.x, at.z, WORLD_SEED)).toBeLessThan(WATER_LEVEL - 1.4);
      }
    }
  });

  it('keeps every Wickharbor hull clear of its decks (one moved out into the bay)', () => {
    const p = wickPose();
    const decks = HULL.volumes.filter((v) => v.kind === 'deck');
    const props = PROPS.decorProps ?? [];
    expect(props.some((q) => q.key === 'hexShipBlue' && q.x === 487 && q.z === 370.1)).toBe(false);
    expect(props.filter((q) => q.key === 'hexShipBlue' && q.x === 515 && q.z === 392)).toHaveLength(
      1,
    );
    for (const other of props) {
      if (other.float === undefined) continue;
      const clearance = other.r ?? 1;
      const local = worldToShip(p, other.x, other.z);
      for (const d of decks) {
        const dx = Math.max(0, Math.abs(local.x - d.x) - (d.hw ?? 0));
        const dz = Math.max(0, Math.abs(local.z - d.z) - (d.hd ?? 0));
        expect(Math.hypot(dx, dz), `${other.key} at (${other.x}, ${other.z})`).toBeGreaterThan(
          clearance,
        );
      }
    }
  });

  it('boards from the wharf, over the gangplank, onto the deck', () => {
    const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior' });
    const p = sim.player;
    const meta = sim.players.get(p.id);
    if (!meta) throw new Error('meta');
    const start = WICK.landing;
    p.pos = { x: start.x, y: groundHeight(start.x, start.z, WORLD_SEED), z: start.z };
    p.prevPos = { ...p.pos };
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
    const walk = (lx: number, lz: number) => {
      sim.transportClockOffset = DOCKED_WICK - sim.time;
      const target = shipToWorld(wickPose(), lx, lz);
      for (let i = 0; i < 300; i++) {
        const dx = target.x - p.pos.x;
        const dz = target.z - p.pos.z;
        if (Math.hypot(dx, dz) < 0.25) break;
        p.facing = Math.atan2(dx, dz);
        Object.assign(meta.moveInput, { ...idle, forward: true });
        sim.tick();
      }
      Object.assign(meta.moveInput, idle);
      for (let i = 0; i < 10; i++) sim.tick();
    };
    walk(9, 0.8); // out along the pier onto the berth head
    walk(4.4, 0.8); // over the plank onto the gangway
    walk(1.5, 0.8); // onto the waist
    const local = worldToShip(wickPose(), p.pos.x, p.pos.z);
    expect(Math.abs(local.x - 1.5)).toBeLessThan(0.3);
    expect(p.pos.y - WATER_LEVEL).toBeCloseTo(HULL.mainDeckY, 3);
  }, 60_000);
});

describe('the far berths: the Moonrest and Wyrmwatch ferry piers', () => {
  const FAR = [
    { name: 'Moonrest', route: EASTBROOK_NIGHTBLOOM_FERRY, pier: FERRY_PIER_DECKS[0] },
    { name: 'Wyrmwatch', route: WICKHARBOR_DRAKELANDS_FERRY, pier: FERRY_PIER_DECKS[1] },
  ] as const;
  type Deck = (typeof FERRY_PIER_DECKS)[number];
  const farPose = (route: typeof ROUTE) => {
    const b = route.berths[1];
    return { x: b.x, z: b.z, rot: b.rot, baseY: WATER_LEVEL };
  };
  const along = (d: Deck, x: number, z: number) =>
    (x - d.x) * Math.sin(d.rot) + (z - d.z) * Math.cos(d.rot);
  const across = (d: Deck, x: number, z: number) =>
    (x - d.x) * Math.cos(d.rot) - (z - d.z) * Math.sin(d.rot);
  const point = (d: Deck, a: number) => ({
    x: d.x + Math.sin(d.rot) * a,
    z: d.z + Math.cos(d.rot) * a,
  });

  for (const { name, route, pier } of FAR) {
    it(`${name}: lies across the pier end like Eastbrook, its gangway on the pier axis`, () => {
      const p = farPose(route);
      const gangway = HULL.boarding.find((b) => b.side === 'port');
      if (!gangway) throw new Error('no port gangway');
      const at = shipToWorld(p, gangway.x, gangway.z);
      expect(Math.abs(across(pier, at.x, at.z))).toBeLessThan(0.05);
      // the pier's far end runs out under the gangplank's outer tread (ship
      // x 8.3) and stops short of the hull side (5.15), Eastbrook's relation
      const tip = shipToWorld(p, 8.3, gangway.z);
      const side = shipToWorld(p, 5.15, gangway.z);
      expect(along(pier, tip.x, tip.z)).toBeLessThan(pier.hl);
      expect(along(pier, side.x, side.z) - pier.hl).toBeGreaterThan(2);
      expect(along(pier, side.x, side.z) - pier.hl).toBeLessThan(3.5);
      // the planks stand at Eastbrook's pier height, a stride below the plank
      const top = groundHeight(pier.x, pier.z, WORLD_SEED) - WATER_LEVEL;
      expect(top).toBeCloseTo(FERRY_PIER_DECK_ABOVE_WATER, 6);
      expect(top).toBeCloseTo(2.64, 2);
      expect(HULL.mainDeckY - 0.44 - top).toBeLessThan(MAX_STEP_HEIGHT);
      // the landing spot is on the pier
      const landing = route.berths[1].landing;
      expect(Math.abs(along(pier, landing.x, landing.z))).toBeLessThan(pier.hl);
      expect(Math.abs(across(pier, landing.x, landing.z))).toBeLessThan(pier.hw);
    });

    it(`${name}: floats in deep water across its whole footprint`, () => {
      const p = farPose(route);
      for (const z of [-15, -10, -5, 0, 5, 10, 14]) {
        for (const x of [-4, 0, 4]) {
          const at = shipToWorld(p, x, z);
          expect(terrainHeight(at.x, at.z, WORLD_SEED)).toBeLessThan(WATER_LEVEL - 2.6);
        }
      }
    });

    it(`${name}: boards from the shore, down the pier and over the gangplank`, () => {
      const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior' });
      const p = sim.player;
      const meta = sim.players.get(p.id);
      if (!meta) throw new Error('meta');
      const docked = route.timings.docked + transportVoyageSeconds(route, 0) + 1;
      // start on the shore past the pier's root (at Wyrmwatch, at the pier's root
      // beside the cliff harbor's north yard: the climb down from the cliff top is
      // walked in tests/wyrmwatch_harbor.test.ts)
      const start = name === 'Wyrmwatch' ? { x: 490.9, z: 1898.4 } : point(pier, -pier.hl - 1.5);
      if (name !== 'Wyrmwatch') {
        expect(terrainHeight(start.x, start.z, WORLD_SEED)).toBeGreaterThan(WATER_LEVEL + 2);
      }
      p.pos = { x: start.x, y: groundHeight(start.x, start.z, WORLD_SEED), z: start.z };
      p.prevPos = { ...p.pos };
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
      const pose = farPose(route);
      const walk = (lx: number, lz: number) => {
        sim.transportClockOffset = docked - sim.time;
        const target = shipToWorld(pose, lx, lz);
        for (let i = 0; i < 400; i++) {
          const dx = target.x - p.pos.x;
          const dz = target.z - p.pos.z;
          if (Math.hypot(dx, dz) < 0.25) break;
          p.facing = Math.atan2(dx, dz);
          Object.assign(meta.moveInput, { ...idle, forward: true });
          sim.tick();
        }
        Object.assign(meta.moveInput, idle);
        for (let i = 0; i < 10; i++) sim.tick();
      };
      walk(9.5, 0.8); // down the pier to its end
      expect(p.pos.y - WATER_LEVEL).toBeCloseTo(2.64, 2);
      walk(4.4, 0.8); // over the plank onto the gangway
      walk(1.5, 0.8); // onto the waist
      const local = worldToShip(pose, p.pos.x, p.pos.z);
      expect(Math.abs(local.x - 1.5)).toBeLessThan(0.3);
      expect(p.pos.y - WATER_LEVEL).toBeCloseTo(HULL.mainDeckY, 3);
    }, 60_000);
  }

  it('Wyrmwatch: the pier root opens flush onto the cliff harbor quays', () => {
    const pier = FERRY_PIER_DECKS[1];
    // the north yard and the south quay each lap onto the pier's root, level with its
    // planks, so the walk off the pier onto either has no step (the climb itself is
    // pinned by tests/wyrmwatch_harbor.test.ts)
    for (const id of ['northYard', 'southQuay'] as const) {
      const quay = WYRMWATCH_HARBOR_DECKS.find((d) => d.id === id);
      if (!quay) throw new Error(id);
      const edge = id === 'northYard' ? quay.z + quay.hl - 0.1 : quay.z - quay.hl + 0.1;
      const x = id === 'northYard' ? 491 : 495;
      expect(Math.abs(across(pier, x, edge))).toBeLessThan(pier.hw);
      expect(groundHeight(x, edge, WORLD_SEED) - WATER_LEVEL).toBeCloseTo(2.64, 6);
    }
  });
});
