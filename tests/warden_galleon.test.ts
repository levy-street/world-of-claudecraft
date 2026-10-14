// The Tidehold galleon (deepglass/wharf_galleon, scripts/assets/deepglass/
// dg_galleon.py) is a WoW-scale three-master that players walk. Floated on a
// -2 sea the way the Studio seats it (float_on_water_core: groundY = water -
// 1.72), its main deck and the boarding landings overhanging both gangway
// ports are world 6.08, level with a Warden pier's planks; the quarterdeck is
// 8.98, the poop 11.68, the forecastle 8.38 and the crow's nest 18.64. Its
// installed override carries walkable ramp decks for the main deck, the
// landings, the forecastle (raked forward with the stem), the nest and the
// stair flights (through the tread nosings); the quarterdeck and the poop,
// which roof the two cabins, are standable slabs; a ladder climbs the main
// mast to the nest (sim/ladders.ts). Blocking boxes cover the bulwarks,
// castle walls, rails, masts, furniture and the hull a swimmer meets.

import { describe, expect, it } from 'vitest';
import { FLOATERS, floatingGroundY } from '../src/editor/float_on_water_core';
import { boxesForAssetId, laddersForAssetId, rampsForAssetId } from '../src/sim/asset_collision';
import { MANTLE_REACH, resolvePosition, supportHeightAt } from '../src/sim/colliders';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import { MAX_PLACEMENT_HITBOXES, MAX_PLACEMENT_RAMPS } from '../src/sim/map_doc';
import { floorHeightAt, MAX_STEP_HEIGHT, moveCharacter } from '../src/sim/physics/character';
import { placementRampFloorAt } from '../src/sim/placement_ramps';
import { GRAVITY, JUMP_VELOCITY } from '../src/sim/player_motion';
import { Sim } from '../src/sim/sim';
import type { MoveInput, WorldContent } from '../src/sim/types';

const SEED = 20061;
// open sea in the builtin world: flat seabed at -9.3, under every deck
const AT = { x: 300, z: -900 };
const WATER = -2;
const G = WATER - 1.72; // the floating seat
const MAIN = G + 9.8;
const QD = G + 12.7;
const POOP = G + 15.4;
const FC = G + 12.1;
const NEST = G + 20.36;
const SWIM = WATER - 0.75; // a swimmer's body

type Placement = NonNullable<WorldContent['placements']>[number];

function galleon(rotY: number): Placement {
  return {
    assetId: 'deepglass/wharf_galleon',
    path: '/models/deepglass/wharf_galleon.glb',
    x: AT.x,
    z: AT.z,
    rotY,
    scale: 1,
    collide: true,
    collideRadius: 0.8, // the map pipeline stamps one on every colliding placement
    collisionMode: 'baked',
    detached: true,
    groundY: G,
  } as unknown as Placement;
}

/** World (x, z) of a point on the ship given in the Blender build frame
 *  (x toward the bow, y to port): glTF (x, -y) under the placement yaw. */
function on(p: Placement, bx: number, by: number): [number, number] {
  const lx = bx;
  const lz = -by;
  const c = Math.cos(p.rotY);
  const s = Math.sin(p.rotY);
  return [p.x + lx * c + lz * s, p.z - lx * s + lz * c];
}

function withShip(rotY: number, fn: (world: WorldContent, ship: Placement) => void): void {
  const ship = galleon(rotY);
  const world: WorldContent = { ...BUILTIN_WORLD, placements: [ship] };
  setActiveWorldContent(world);
  try {
    fn(world, ship);
  } finally {
    setActiveWorldContent(BUILTIN_WORLD);
  }
}

/** The surface a body standing at `feet` walks on: a ramp deck or a slab top. */
function standingFloor(world: WorldContent, x: number, z: number, feet: number): number {
  return Math.max(
    placementRampFloorAt(world, SEED, x, z, feet),
    supportHeightAt(SEED, x, z, 0.5, feet + 0.05),
  );
}

describe('Tidehold galleon', () => {
  it('fits the Studio per-placement collision caps, so a Collision Master pass keeps every deck', () => {
    const boxes = boxesForAssetId('deepglass/wharf_galleon') ?? [];
    const ramps = rampsForAssetId('deepglass/wharf_galleon');
    expect(boxes.length).toBeGreaterThan(40);
    expect(boxes.length).toBeLessThanOrEqual(MAX_PLACEMENT_HITBOXES);
    expect(ramps.length).toBeGreaterThan(8);
    expect(ramps.length).toBeLessThanOrEqual(MAX_PLACEMENT_RAMPS);
  });

  it('floats at its waterline, with the gangplank seated on its main deck', () => {
    expect(floatingGroundY('deepglass/wharf_galleon', 1, WATER)).toBeCloseTo(G, 6);
    // the boarding level IS a Warden pier's planks
    expect(MAIN).toBeCloseTo(6.08, 6);
    // placed larger it sinks until the deck still meets the pier; smaller, it
    // keeps its waterline (a small ship cannot reach up to a pier anyway)
    for (const s of [1.5, 2.7]) {
      const seat = floatingGroundY('deepglass/wharf_galleon', s, WATER) ?? 0;
      expect(seat + 9.8 * s).toBeCloseTo(6.08, 6);
    }
    expect(floatingGroundY('deepglass/wharf_galleon', 0.5, WATER)).toBeCloseTo(WATER - 0.86, 6);
    expect(floatingGroundY('deepglass/wharf_galleon', 1, Number.NEGATIVE_INFINITY)).toBeNull();
    expect(floatingGroundY('deepglass/wharf_deck', 1, WATER)).toBeNull();
    // the float table's deck IS the main deck the installed override walks
    // on, and the gangplank seats on it
    const mainDeck = Math.min(...rampsForAssetId('deepglass/wharf_galleon').map((r) => r.y0));
    expect(mainDeck).toBeCloseTo(9.8, 3);
    expect(FLOATERS['deepglass/wharf_galleon'].deck).toBeCloseTo(mainDeck, 6);
    expect(floatingGroundY('deepglass/wharf_gangplank', 1, WATER)).toBeCloseTo(G + mainDeck, 6);
    expect(floatingGroundY('deepglass/wharf_gangplank', 2, WATER)).toBeCloseTo(G + mainDeck, 6);
    // ...and its plank climbs from that deck to the pier planks in steps a walker takes
    const plank = rampsForAssetId('deepglass/wharf_gangplank');
    expect(plank).toHaveLength(1);
    const seat = floatingGroundY('deepglass/wharf_gangplank', 1, WATER) ?? 0;
    expect(seat + plank[0].y0 - MAIN).toBeGreaterThanOrEqual(0);
    expect(seat + plank[0].y0 - MAIN).toBeLessThan(0.3);
    expect(Math.abs(seat + plank[0].y1 - 6.08)).toBeLessThan(0.3);
    // one ladder, up the main mast's aft face to the crow's nest
    const ladders = laddersForAssetId('deepglass/wharf_galleon');
    expect(ladders).toHaveLength(1);
    expect(ladders[0].y0).toBeCloseTo(9.8, 3);
    expect(ladders[0].y1).toBeCloseTo(20.36, 2);
  });

  it('floors every deck across its breadth, the raked forecastle out to the stem', () => {
    withShip(0.7, (world, ship) => {
      const floor = (bx: number, by: number, feet: number) =>
        standingFloor(world, ...on(ship, bx, by), feet);
      const decks: [number, number, number][] = [
        // main deck: waist to the bulwarks, both cabins' floors, the fore bulkhead
        [-1, 0, MAIN],
        [-1, 3.9, MAIN],
        [-1, -3.9, MAIN],
        [-15.5, 2.6, MAIN],
        [-15.5, -2.6, MAIN],
        [9.6, 2.8, MAIN],
        [9.6, -2.8, MAIN],
        // quarterdeck (the upper cabin's floor too)
        [-8.0, 0, QD],
        [-10, 3.3, QD],
        [-10, -3.3, QD],
        [-12.5, 2.6, QD],
        [-12.5, -2.6, QD],
        [-15.5, 2.4, QD],
        // poop
        [-15.0, 2.3, POOP],
        [-15.0, -2.3, POOP],
        [-16.8, 0, POOP],
        // forecastle, raked forward with the stem (world x runs past 18)
        [12.5, 1.8, FC],
        [12.5, -1.8, FC],
        [14.8, 1.3, FC],
        [17.0, 0.4, FC],
        [18.3, 0, FC],
      ];
      for (const [bx, by, y] of decks) {
        expect(floor(bx, by, y), `deck at (${bx}, ${by})`).toBeCloseTo(y, 2);
      }
      // the boarding landings: level decks from inside each gangway port out
      // past the hull to their open ends (the jut is short: 1.55 yd of it
      // stands proud of the planking, outer edge at 6.29)
      for (const side of [1, -1]) {
        for (const by of [4.2, 5.2, 6.2]) {
          expect(floor(3.8, side * by, MAIN), `landing at ${side * by}`).toBeCloseTo(MAIN, 2);
        }
      }
      // the crow's nest round the main mast
      for (const [bx, by] of [
        [-1.5, 0],
        [1.8, 1.8],
        [-1.8, -1.8],
      ]) {
        expect(floor(bx, by, NEST), `nest at (${bx}, ${by})`).toBeCloseTo(NEST, 2);
      }
      // nothing out over the water, past a landing's end or abeam the waist
      expect(placementRampFloorAt(world, SEED, ...on(ship, 3.8, 6.9))).toBe(
        Number.NEGATIVE_INFINITY,
      );
      expect(placementRampFloorAt(world, SEED, ...on(ship, 0, 7.5))).toBe(Number.NEGATIVE_INFINITY);
    });
  });

  it('lands a hop in either cabin back on the cabin floor, never on the deck above', () => {
    withShip(1.3, (_world, ship) => {
      const apex = (JUMP_VELOCITY * JUMP_VELOCITY) / (2 * GRAVITY);
      for (const [bx, by, cabin] of [
        [-11, 1.2, MAIN], // the captain's cabin, under the quarterdeck
        [-15, 0.5, QD], // the upper cabin, under the poop
      ] as const) {
        const [x, z] = on(ship, bx, by);
        // every airborne sample up to the apex, at the landing query's reach
        for (let h = 0; h <= apex; h += 0.05) {
          expect(floorHeightAt(SEED, x, z, 0.5, cabin + h + MANTLE_REACH)).toBeCloseTo(cabin, 2);
        }
        // and the deck overhead does not wall the room a walker crosses
        const r = resolvePosition(SEED, x, z, 0.5, false, undefined, { y: cabin, lift: 0 });
        expect(Math.hypot(r.x - x, r.z - z)).toBeLessThan(0.01);
      }
    });
  });

  it('climbs every stair flight in steps a walker can take', () => {
    withShip(-1.9, (world, ship) => {
      const floor = (bx: number, by: number, feet: number) =>
        standingFloor(world, ...on(ship, bx, by), feet);
      const flights: [number, number, number, number, number][] = [
        // [foot x, head x, y, foot deck, head deck]
        [-3.1, -7.5, 3.1, MAIN, QD],
        [-3.1, -7.5, -3.1, MAIN, QD],
        [7.4, 11.0, 1.65, MAIN, FC],
        [7.4, 11.0, -1.65, MAIN, FC],
        [-9.4, -13.2, 1.9, QD, POOP],
      ];
      for (const [x0, x1, y, lo, hi] of flights) {
        let prev = floor(x0 + Math.sign(x0 - x1) * 0.6, y, lo);
        expect(prev, `foot of the flight at y ${y}`).toBeCloseTo(lo, 2);
        // walked up: each sample is read from the feet of the one before
        for (let k = 0; k <= 20; k++) {
          const bx = x0 + ((x1 - x0) * k) / 20;
          const [x, z] = on(ship, bx, y);
          const f = Math.max(
            placementRampFloorAt(world, SEED, x, z, prev),
            supportHeightAt(SEED, x, z, 0.5, prev + 0.5),
          );
          expect(f).toBeGreaterThanOrEqual(prev - 1e-6);
          expect(f - prev).toBeLessThan(0.5);
          prev = f;
        }
        expect(
          floor(x1 - Math.sign(x0 - x1) * 0.6, y, hi),
          `head of the flight at y ${y}`,
        ).toBeCloseTo(hi, 2);
      }
    });
  });

  it('walls the bulwarks, castles and masts, and leaves the gangway ports and the cabin doors open', () => {
    withShip(0.4, (_world, ship) => {
      const pushed = (bx: number, by: number, feet: number) => {
        const [x, z] = on(ship, bx, by);
        const r = resolvePosition(SEED, x, z, 0.5, false, undefined, { y: feet, lift: 0 });
        return Math.hypot(r.x - x, r.z - z) > 0.01;
      };
      // the waist bulwark stops a walker; a step inboard is clear
      expect(pushed(-1, 4.3, MAIN)).toBe(true);
      expect(pushed(-1, -4.3, MAIN)).toBe(true);
      expect(pushed(-1, 3.6, MAIN)).toBe(false);
      // both gangway ports are open to the side, out along their landings,
      // whose rails close them fore and aft
      for (const side of [1, -1]) {
        expect(pushed(3.8, side * 4.4, MAIN)).toBe(false);
        expect(pushed(3.8, side * 5.9, MAIN)).toBe(false);
        expect(pushed(2.3, side * 5.4, MAIN)).toBe(true);
        expect(pushed(5.3, side * 5.4, MAIN)).toBe(true);
      }
      // the crow's nest balustrade
      expect(pushed(2.1, 0, NEST)).toBe(true);
      expect(pushed(1.4, 0, NEST)).toBe(false);
      // the castle bulwarks and the transom
      expect(pushed(-10, 3.45, QD)).toBe(true);
      expect(pushed(-10, 2.8, QD)).toBe(false);
      expect(pushed(-15.5, 2.5, POOP)).toBe(true);
      expect(pushed(-15.5, 1.8, POOP)).toBe(false);
      expect(pushed(-16.95, 0, POOP)).toBe(true);
      expect(pushed(12.5, 1.9, FC)).toBe(true);
      expect(pushed(12.5, 1.0, FC)).toBe(false);
      // the main mast; the cabin door under the quarterdeck, and its wall
      expect(pushed(0.3, 0, MAIN)).toBe(true);
      expect(pushed(-7.5, 0, MAIN)).toBe(false);
      expect(pushed(-7.5, 1.8, MAIN)).toBe(true);
      // the upper cabin under the poop: a body's width between the mizzen and
      // its door
      expect(pushed(-12.3, 0, QD)).toBe(false);
      expect(pushed(-13.2, 0, QD)).toBe(false);
      // a climber near the head of a quarterdeck flight passes over the cabin
      // wall's box (it stops a yard under the deck)
      expect(pushed(-6.95, 3.1, QD - 0.8)).toBe(false);
    });
  });

  it('walks the real movement kernel up every flight and through both cabin doors', () => {
    withShip(-0.6, (world, ship) => {
      const params = {
        seed: SEED,
        radius: 0.5,
        stepHeight: MAX_STEP_HEIGHT,
        maxSlope: 1.5,
        grounded: true,
        swimming: false,
        ignoreFences: false,
      };
      const out = { x: 0, y: 0, z: 0, blocked: false, stepped: 0 };
      // a 20 Hz walker (0.35 yd a tick) from one ship point toward another,
      // settling on whatever floor lies within a step of its feet
      const walk = (from: [number, number], to: [number, number], feet: number, ticks = 60) => {
        let [x, z] = on(ship, ...from);
        let y = feet;
        const [tx, tz] = on(ship, ...to);
        for (let i = 0; i < ticks; i++) {
          const d = Math.hypot(tx - x, tz - z);
          if (d < 0.2) break;
          moveCharacter(params, x, y, z, ((tx - x) / d) * 0.35, ((tz - z) / d) * 0.35, out);
          x = out.x;
          z = out.z;
          if (out.stepped > 0) y = out.y;
          const f = Math.max(
            placementRampFloorAt(world, SEED, x, z, y),
            supportHeightAt(SEED, x, z, 0.5, y + MAX_STEP_HEIGHT),
          );
          if (Math.abs(f - y) <= MAX_STEP_HEIGHT) y = f;
        }
        const dx = x - ship.x;
        const dz = z - ship.z;
        const c = Math.cos(ship.rotY);
        const s = Math.sin(ship.rotY);
        return { bx: dx * c - dz * s, by: -(dx * s + dz * c), y };
      };
      // up both quarterdeck flights and aft along the quarterdeck
      for (const side of [1, -1]) {
        const qd = walk([-2.5, side * 3.1], [-9.5, side * 3.1], MAIN);
        expect(qd.y).toBeCloseTo(QD, 2);
        expect(qd.bx).toBeLessThan(-9.2);
      }
      // up the poop flight to the taffrail
      const poop = walk([-8.7, 1.9], [-16.2, 1.9], QD);
      expect(poop.y).toBeCloseTo(POOP, 2);
      expect(poop.bx).toBeLessThan(-15.8);
      // up both forecastle flights and forward toward the stem
      for (const side of [1, -1]) {
        const fc = walk([6.8, side * 1.65], [13.5, side * 1.2], MAIN);
        expect(fc.y).toBeCloseTo(FC, 2);
        expect(fc.bx).toBeGreaterThan(13.2);
      }
      // through the captain's cabin door to the stern windows
      const cabin = walk([-5.0, 0], [-16.2, 0], MAIN);
      expect(cabin.y).toBeCloseTo(MAIN, 2);
      expect(cabin.bx).toBeLessThan(-15.8);
      // round the mizzen and through the upper cabin's door
      const upper = walk([-12.1, 0], [-16.2, 0], QD);
      expect(upper.y).toBeCloseTo(QD, 2);
      expect(upper.bx).toBeLessThan(-15.8);
      // out along each landing to its open end, level all the way
      for (const side of [1, -1]) {
        const out = walk([3.8, 0], [3.8, side * 6.2], MAIN);
        expect(out.y).toBeCloseTo(MAIN, 2);
        expect(Math.abs(out.by)).toBeGreaterThan(5.9);
      }
    });
  });

  it('meets a swimmer at the planks, not a yard off them', () => {
    withShip(2.6, (_world, ship) => {
      const pushed = (bx: number, by: number) => {
        const [x, z] = on(ship, bx, by);
        const r = resolvePosition(SEED, x, z, 0.5, false, undefined, { y: SWIM, lift: 0 });
        return Math.hypot(r.x - x, r.z - z) > 0.01;
      };
      for (const side of [1, -1]) {
        expect(pushed(-1, side * 5.4)).toBe(true); // midships, under the bilge
        expect(pushed(-1, side * 6.3)).toBe(false);
        expect(pushed(-16.8, side * 3.8)).toBe(true); // the stern quarter
        expect(pushed(-16.8, side * 4.6)).toBe(false);
        expect(pushed(14.0, side * 3.0)).toBe(true); // the bow
        expect(pushed(14.0, side * 4.3)).toBe(false);
      }
    });
  });

  it('climbs the main mast ladder to the lookout nest and back down (live Sim)', () => {
    const ship = galleon(0);
    const world: WorldContent = {
      ...BUILTIN_WORLD,
      camps: [],
      npcs: {},
      groundObjects: [],
      placements: [ship],
    };
    setActiveWorldContent(world);
    try {
      const sim = new Sim({ seed: SEED, playerClass: 'warrior', autoEquip: true, world });
      const p = sim.player;
      const meta = sim.players.get(p.id);
      if (!meta) throw new Error('missing player meta');
      const mi = (over: Partial<MoveInput> = {}): MoveInput => ({
        forward: false,
        back: false,
        turnLeft: false,
        turnRight: false,
        strafeLeft: false,
        strafeRight: false,
        jump: false,
        dive: false,
        surface: false,
        ...over,
      });
      const [sx, sz] = on(ship, -3.0, 0);
      p.pos = { x: sx, y: MAIN, z: sz };
      p.prevPos = { ...p.pos };
      p.fallStartY = MAIN;
      p.onGround = true;
      p.facing = Math.PI / 2; // toward the bow: at the ladder on the mast's aft face
      Object.assign(meta.moveInput, mi({ forward: true }));
      let latched = false;
      for (let i = 0; i < 160; i++) {
        sim.tick();
        latched ||= p.climbing === true;
        if (latched && !p.climbing) break;
      }
      expect(latched).toBe(true);
      expect(p.pos.y).toBeCloseTo(NEST, 2); // stepped off into the nest
      Object.assign(meta.moveInput, mi());
      for (let i = 0; i < 10; i++) sim.tick();
      expect(p.pos.y).toBeCloseTo(NEST, 2);
      // and down again, the view aimed down the ladder
      Object.assign(meta.moveInput, mi({ forward: true, dive: true }));
      latched = false;
      for (let i = 0; i < 160; i++) {
        sim.tick();
        latched ||= p.climbing === true;
        if (latched && !p.climbing) break;
      }
      expect(latched).toBe(true);
      expect(p.pos.y).toBeCloseTo(MAIN, 2);
    } finally {
      setActiveWorldContent(BUILTIN_WORLD);
    }
  });
});
