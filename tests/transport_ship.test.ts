import { describe, expect, it } from 'vitest';
import {
  EASTBROOK_FERRY_BEAM_STATIONS,
  EASTBROOK_FERRY_HULL,
  eastbrookFerryHalfBeam,
  TRANSPORT_SHIP_HULLS,
} from '../src/sim/content/transport_ships';
import { MAX_STEP_HEIGHT } from '../src/sim/physics/character';
import { GRAVITY, JUMP_VELOCITY } from '../src/sim/player_motion';
import {
  railRun,
  type ShipPose,
  shipHullColliders,
  shipToWorld,
  stairFlight,
  worldToShip,
} from '../src/sim/transport_ship';

// Unit coverage for the transport ship hull seam (src/sim/transport_ship.ts) and
// the Eastbrook ferry's authored volumes (src/sim/content/transport_ships.ts):
// the frame conversions, the collider mapping, the stair and rail helpers, and
// the scale rules the ferry is built to (tread rise, rail height, open waist).

const HULL = EASTBROOK_FERRY_HULL;
const JUMP_APEX = (JUMP_VELOCITY * JUMP_VELOCITY) / (2 * GRAVITY);

describe('ship frame', () => {
  it('rot 0 is the identity: +z bow, +x port', () => {
    const pose: ShipPose = { x: 10, z: -4, rot: 0, baseY: -4.3 };
    expect(shipToWorld(pose, 2, 5)).toEqual({ x: 12, z: 1 });
  });

  it('follows the three.js rotation.y convention and round-trips', () => {
    const pose: ShipPose = { x: -125, z: -54.8, rot: Math.PI / 2, baseY: -4.3 };
    // a quarter turn swings the bow (+z) onto world +x and port (+x) onto world -z
    const bow = shipToWorld(pose, 0, 10);
    expect(bow.x).toBeCloseTo(-115, 9);
    expect(bow.z).toBeCloseTo(-54.8, 9);
    const port = shipToWorld(pose, 3, 0);
    expect(port.x).toBeCloseTo(-125, 9);
    expect(port.z).toBeCloseTo(-57.8, 9);
    for (const rot of [0, 0.7, -2.1, Math.PI]) {
      const p: ShipPose = { ...pose, rot };
      const w = shipToWorld(p, 1.3, -7.2);
      const back = worldToShip(p, w.x, w.z);
      expect(back.x).toBeCloseTo(1.3, 9);
      expect(back.z).toBeCloseTo(-7.2, 9);
    }
  });
});

describe('shipHullColliders', () => {
  const pose: ShipPose = { x: 5, z: 7, rot: 0.4, baseY: -4.3 };
  const colliders = shipHullColliders(HULL, pose);

  it('emits one collider per volume, in order, seated on the waterline', () => {
    expect(colliders).toHaveLength(HULL.volumes.length);
    HULL.volumes.forEach((v, i) => {
      const c = colliders[i];
      expect(c.type).toBe(v.shape);
      expect(c.moveTopY).toBeCloseTo(pose.baseY + v.top, 9);
      expect(c.cameraTopY).toBeCloseTo(pose.baseY + (v.sightTop ?? v.top), 9);
      expect(c.standable === true).toBe(v.standable);
      const at = shipToWorld(pose, v.x, v.z);
      expect(c.x).toBeCloseTo(at.x, 9);
      expect(c.z).toBeCloseTo(at.z, 9);
      if (c.type === 'obb') expect(c.rot).toBeCloseTo(pose.rot + (v.rot ?? 0), 9);
    });
  });

  it('only open balustrades see through below their rail, never a floor or a mast', () => {
    const open = HULL.volumes.filter((v) => v.sightTop !== undefined);
    expect(open.map((v) => v.id).sort()).toEqual(
      [
        'rail_captain_front_1',
        'rail_port_forecastle_break_1',
        'rail_starboard_forecastle_break_1',
      ].sort(),
    );
    for (const v of open) {
      expect(v.standable).toBe(false);
      expect(v.sightTop).toBeLessThan(v.top);
    }
  });

  it('blocking volumes are walls, never floors', () => {
    for (const c of colliders) {
      if (c.standable) continue;
      expect(c.moveTopY).toBeDefined();
    }
  });
});

describe('authoring helpers', () => {
  it('a stair flight climbs in equal treads and lands exactly on the upper deck', () => {
    const flight = stairFlight('s', 1, 0.5, 0, -1, 0.5, 10, 3.3, 6.3);
    expect(flight).toHaveLength(10);
    expect(flight[9].top).toBeCloseTo(6.3, 9);
    for (let i = 0; i < flight.length; i++) {
      const below = i === 0 ? 3.3 : flight[i - 1].top;
      expect(flight[i].top - below).toBeCloseTo(0.3, 9);
      expect(flight[i].z).toBeCloseTo(-(i + 0.5) * 0.5, 9);
      expect(flight[i].standable).toBe(true);
    }
  });

  it('a rail run is a chain of overlapping walls along its polyline', () => {
    const run = railRun(
      'r',
      [
        [0, 0],
        [0, 3],
        [2, 5],
      ],
      4.5,
    );
    expect(run).toHaveLength(2);
    expect(run[0].rot).toBeCloseTo(0, 9); // along +z
    expect(run[1].rot).toBeCloseTo(Math.PI / 4, 9);
    expect(run[0].hd).toBeCloseTo(1.5 + 0.15, 9); // half length plus half thickness
    for (const seg of run) {
      expect(seg.standable).toBe(false);
      expect(seg.top).toBe(4.5);
    }
  });
});

describe('the Eastbrook ferry hull', () => {
  const byKind = (kind: string) => HULL.volumes.filter((v) => v.kind === kind);

  it('is registered under its decorProps key', () => {
    expect(TRANSPORT_SHIP_HULLS.eastbrookFerry).toBe(HULL);
  });

  it('never gives a jump a floor to launch over a rail from: edge dressing is a wall', () => {
    const floors = HULL.volumes.filter((v) => v.kind === 'prop' && v.standable);
    expect(floors.map((v) => v.id)).toEqual(['hatch_main']);
    for (const v of floors) {
      // far from every rail: a body on it cannot reach the side in one jump
      expect(eastbrookFerryHalfBeam(v.z) - Math.abs(v.x) - (v.hw ?? 0)).toBeGreaterThan(2);
      expect(v.top - HULL.mainDeckY).toBeLessThan(0.3);
    }
  });

  it('has unique volume ids', () => {
    const ids = HULL.volumes.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps every tread and deck step well inside a stride', () => {
    const tops = [...new Set(byKind('stair').map((v) => v.top))].sort((a, b) => a - b);
    let prev = HULL.mainDeckY;
    for (const top of tops) {
      expect(top - prev).toBeLessThanOrEqual(0.31);
      expect(top - prev).toBeLessThan(MAX_STEP_HEIGHT);
      prev = top;
    }
    expect(tops).toContain(HULL.captainDeckY);
    expect(tops[tops.length - 1]).toBeCloseTo(HULL.captainDeckY, 9);
  });

  it('rails stand above a jump and above a stride from the deck they guard', () => {
    expect(HULL.railHeight).toBeGreaterThan(JUMP_APEX);
    expect(HULL.railHeight).toBeGreaterThan(MAX_STEP_HEIGHT);
    const floors = [HULL.mainDeckY, HULL.captainDeckY, HULL.forecastleY];
    for (const rail of [...byKind('rail'), ...byKind('gate')]) {
      const guarded = floors.filter((f) => Math.abs(rail.top - (f + HULL.railHeight)) < 1e-9);
      expect(guarded, `${rail.id} top ${rail.top}`).toHaveLength(1);
    }
  });

  it('keeps the walls inside the hull and the waist open on the centre line', () => {
    for (const v of HULL.volumes) {
      if (v.kind === 'gangway' || v.kind === 'gangplank') continue;
      expect(Math.abs(v.x), v.id).toBeLessThanOrEqual(eastbrookFerryHalfBeam(v.z) + 0.05);
    }
    // nothing but the main mast and the (low, standable) hatch stands on the
    // waist's centre strip
    const centre = HULL.volumes.filter(
      (v) =>
        v.kind !== 'deck' &&
        v.z > -2.5 &&
        v.z < 7 &&
        Math.abs(v.x) < 2.5 &&
        v.id !== 'mast_main' &&
        v.id !== 'hatch_main',
    );
    expect(centre.map((v) => v.id)).toEqual([]);
  });

  it('opens a boarding gangway on each side, the port one open, the starboard barred', () => {
    const port = HULL.boarding.find((b) => b.side === 'port');
    const starboard = HULL.boarding.find((b) => b.side === 'starboard');
    expect(port?.open).toBe(true);
    expect(starboard?.open).toBe(false);
    expect(port?.y).toBe(HULL.mainDeckY);
    // a comfortable opening: two bodies (radius 0.5) can pass abreast
    expect(port?.width).toBeGreaterThanOrEqual(2.0);
    // the port rail breaks for the full gangway width
    const portRails = byKind('rail').filter(
      (v) => v.x > 3 && v.z > -2.6 && v.z < 8.6 && v.top === 4.5,
    );
    for (const r of portRails) {
      const reach = (r.hd ?? 0) * Math.abs(Math.cos(r.rot ?? 0));
      const half = (port?.width ?? 0) / 2 - 1e-6;
      const clear = r.z + reach <= (port?.z ?? 0) - half || r.z - reach >= (port?.z ?? 0) + half;
      expect(clear, r.id).toBe(true);
    }
    expect(byKind('gate').length).toBeGreaterThan(0);
    for (const g of byKind('gate')) expect(g.x).toBeLessThan(0);
  });

  it('matches the beam stations it lofts through', () => {
    expect(eastbrookFerryHalfBeam(-100)).toBe(EASTBROOK_FERRY_BEAM_STATIONS[0][1]);
    expect(eastbrookFerryHalfBeam(0.8)).toBeCloseTo(5.15, 9);
    expect(eastbrookFerryHalfBeam(100)).toBe(
      EASTBROOK_FERRY_BEAM_STATIONS[EASTBROOK_FERRY_BEAM_STATIONS.length - 1][1],
    );
    expect(HULL.beam).toBeCloseTo(2 * 5.15, 9);
  });
});
