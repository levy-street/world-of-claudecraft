import { describe, expect, it } from 'vitest';
import { type Collider, queryOpenWorldColliders } from '../src/sim/colliders';
import {
  EASTBROOK_FERRY_HULL,
  eastbrookFerryHalfBeam,
  TRANSPORT_ROUTES,
} from '../src/sim/content/transport_ships';
import { PROPS } from '../src/sim/data';
import { deckToWorld, worldToDeck } from '../src/sim/transport_deck';
import {
  type TransportPose,
  transportLaneLength,
  transportLanePoseAt,
} from '../src/sim/transport_schedule';
import { groundHeight, WATER_LEVEL, waterLevelAt } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

// The ferries' sea lanes (content/transport_ships.ts) against the real world:
// the ship sails the whole voyage in sight, so every yard of every lane must
// keep the hull afloat (never over dry land) and clear of every pier, post,
// buoy and prop that stands above the water. A lane authored across a spit or
// through a pier would draw the ship through it and knock its passengers
// about (the deck's rails meet the world's colliders in the kernel).

const HULL = EASTBROOK_FERRY_HULL;
/** Water the keel line always keeps over the bed (yards), per route: the
 *  Nightbloom run's long western shallows keep about a quarter yard (the
 *  owner-accepted keel-in-sand look), everything else the full margin. */
const KEEL_WATER: Readonly<Record<string, number>> = {
  eastbrookNightbloom: 0.2,
  wickharborDrakelands: 0.3,
};

/** Every lane of every route, named for the test titles. */
const LANES = TRANSPORT_ROUTES.flatMap((route) =>
  route.lanes.map((lane, i) => ({
    lane,
    name: `${route.berths[i].id} to ${route.berths[1 - i].id}`,
    keelWater: KEEL_WATER[route.id],
  })),
);

/** Ship-frame points around the hull's deck outline, and its centre line. */
function outline(): { deck: [number, number][]; keel: [number, number][] } {
  const deck: [number, number][] = [];
  const keel: [number, number][] = [];
  for (let z = -HULL.length / 2; z <= HULL.length / 2; z += 1) {
    const hb = eastbrookFerryHalfBeam(z);
    deck.push([hb, z], [-hb, z]);
    keel.push([0, z]);
  }
  return { deck, keel };
}

function inside(c: Collider, x: number, z: number): boolean {
  if (c.type === 'circle') return Math.hypot(x - c.x, z - c.z) < c.r;
  const cos = Math.cos(-c.rot);
  const sin = Math.sin(-c.rot);
  const lx = (x - c.x) * cos + (z - c.z) * sin;
  const lz = -(x - c.x) * sin + (z - c.z) * cos;
  return Math.abs(lx) < c.hw && Math.abs(lz) < c.hd;
}

describe('the ferry sea lanes', () => {
  const { deck, keel } = outline();
  const pose: TransportPose = { x: 0, z: 0, rot: 0 };
  const at = { x: 0, z: 0 };

  it('covers both routes, each lane from its departure berth to the far one', () => {
    expect(LANES.map((l) => l.name)).toEqual([
      'eastbrook to nightbloom',
      'nightbloom to eastbrook',
      'wickharbor to drakelands',
      'drakelands to wickharbor',
    ]);
    for (const route of TRANSPORT_ROUTES) {
      route.lanes.forEach((lane, i) => {
        const from = route.berths[i];
        const to = route.berths[1 - i];
        expect([lane[0].x, lane[0].z, lane[0].rot]).toEqual([from.x, from.z, from.rot]);
        const end = lane[lane.length - 1];
        expect([end.x, end.z, end.rot]).toEqual([to.x, to.z, to.rot]);
      });
    }
  });

  it('every route has its keel margin', () => {
    for (const route of TRANSPORT_ROUTES) expect(KEEL_WATER[route.id]).toBeGreaterThan(0);
  });

  for (const { lane, name, keelWater } of LANES) {
    it(`${name}: afloat and clear of every standing collider, yard by yard`, () => {
      const length = transportLaneLength(lane);
      const dry: string[] = [];
      const hits = new Set<string>();
      for (let d = 0; d <= length; d += 1) {
        transportLanePoseAt(lane, d, pose);
        // the waterline hull (about four fifths of the deck's beam) is always
        // over water: sea everywhere under it, never a beach or a spit
        for (const [lx, lz] of deck) {
          deckToWorld(pose, lx * 0.8, lz * 0.97, at);
          const water = waterLevelAt(at.x, at.z, WORLD_SEED);
          const ground = groundHeight(at.x, at.z, WORLD_SEED);
          if (!Number.isFinite(water) || ground > WATER_LEVEL - 0.1) {
            dry.push(`${d.toFixed(0)}:${at.x.toFixed(0)},${at.z.toFixed(0)}`);
          }
        }
        // ...and the keel line never runs aground
        for (const [lx, lz] of keel) {
          deckToWorld(pose, lx, lz, at);
          if (groundHeight(at.x, at.z, WORLD_SEED) > WATER_LEVEL - keelWater) {
            dry.push(`keel ${d.toFixed(0)}`);
          }
        }
        const cols: Collider[] = [];
        queryOpenWorldColliders(
          WORLD_SEED,
          pose.x - 20,
          pose.z - 20,
          pose.x + 20,
          pose.z + 20,
          cols,
        );
        for (const c of cols) {
          // the ship's own moored decks, and anything that stays under water
          if (c.gate) continue;
          if (c.moveTopY !== undefined && c.moveTopY < WATER_LEVEL + 0.3) continue;
          for (const [lx, lz] of deck) {
            deckToWorld(pose, lx, lz, at);
            if (inside(c, at.x, at.z)) hits.add(`${c.type}@${c.x.toFixed(1)},${c.z.toFixed(1)}`);
          }
        }
      }
      expect(dry).toEqual([]);
      expect([...hits]).toEqual([]);
    });
  }

  it('never sails through a moored boat, ship or buoy (decor with no collider included)', () => {
    const floating = (PROPS.decorProps ?? []).filter((d) => /ship|boat|buoy/i.test(d.key));
    expect(floating.length).toBeGreaterThan(5);
    const close: string[] = [];
    for (const { lane } of LANES) {
      const length = transportLaneLength(lane);
      for (let d = 0; d <= length; d += 0.5) {
        transportLanePoseAt(lane, d, pose);
        for (const it of floating) {
          if (Math.hypot(it.x - pose.x, it.z - pose.z) > 40) continue;
          const l = worldToDeck(pose, it.x, it.z, at);
          const half = HULL.length / 2;
          const hb = Math.abs(l.z) <= half ? eastbrookFerryHalfBeam(l.z) : 0;
          const gap = Math.hypot(
            Math.max(0, Math.abs(l.x) - hb),
            Math.max(0, Math.abs(l.z) - half),
          );
          // three yards from the hull's outline to the prop's centre
          if (gap < 3) close.push(`${it.key}@${it.x},${it.z} d=${d}`);
        }
      }
    }
    expect(close).toEqual([]);
  });

  it('each lane is one long sea road, not a hop between neighbouring harbors', () => {
    for (const { lane } of LANES) {
      expect(transportLaneLength(lane)).toBeGreaterThan(1200);
      expect(transportLaneLength(lane)).toBeLessThan(2200);
    }
  });
});
