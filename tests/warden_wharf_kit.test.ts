// The Warden wharf kit (deepglass/wharf_*, scripts/assets/deepglass/dg_wharf.py)
// is Tidehold's harbour docks. Pile-borne pieces stand on their pile feet with
// the deck 36 yd above them; a layout seats them detached at groundY 6.08 - 36
// so the planks lie 8 cm over the Low Wards cobbles (world 6). Their installed
// overrides carry WALKABLE decks at that height (the quay sector, the pier
// modules, the octagonal pier head as four face-to-face slabs, the stair
// flight as a rising deck that starts under the waterline so a swimmer walks
// out), and blocking boxes for the piles, rails, parapets and plinths. The
// Tidehold layout (wharf_layout.py) grows the pile-borne pieces 1.5x in plan
// only (scaleX = scaleZ = 1.5): the planks stay at 6.08 and the rails at
// walking height; each main wharf ends in the open-faced pier head with the
// berth gangway out to a galleon.

import { describe, expect, it } from 'vitest';
import { TARGET_HEIGHT, targetHeightFor } from '../src/render/asset_scale';
import { colliderInternalsForTest } from '../src/sim/colliders';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import { placementRampFloorAt } from '../src/sim/placement_ramps';
import type { WorldContent } from '../src/sim/types';
import { groundHeightAtBody, terrainHeight } from '../src/sim/world';

const SEED = 20061;
const DECK_Y = 6.08;
const SEAT = DECK_Y - 36; // pile feet
const ROT = 0.7; // off-axis on purpose: every check runs through the yaw math

type Placement = NonNullable<WorldContent['placements']>[number];

function piece(
  tag: string,
  x: number,
  z: number,
  groundY: number,
  rotY = ROT,
  plan = 1,
): Placement {
  return {
    assetId: `deepglass/${tag}`,
    path: `/models/deepglass/${tag}.glb`,
    x,
    z,
    rotY,
    scale: 1,
    ...(plan !== 1 ? { scaleX: plan, scaleZ: plan } : {}),
    collide: true,
    collideRadius: 0.8, // the map pipeline stamps one on every colliding placement
    collisionMode: 'baked',
    detached: true,
    groundY,
  } as unknown as Placement;
}

/** World point for a model-local (glTF x, z) offset under the placement yaw
 *  and plan scale. */
function at(p: Placement, lx: number, lz: number): [number, number] {
  const c = Math.cos(p.rotY);
  const s = Math.sin(p.rotY);
  const k = (p as { scaleX?: number }).scaleX ?? 1;
  return [p.x + (lx * c + lz * s) * k, p.z + (-lx * s + lz * c) * k];
}

function withWorld(placements: Placement[], fn: (world: WorldContent) => void): void {
  const world: WorldContent = { ...BUILTIN_WORLD, placements };
  setActiveWorldContent(world);
  try {
    fn(world);
  } finally {
    setActiveWorldContent(BUILTIN_WORLD);
  }
}

describe('Warden wharf kit', () => {
  it('keeps every piece at its authored size (scale 1 = as built in yards)', () => {
    const pinned: Record<string, number> = { wharf_deck: 36, wharf_quay: 36, wharf_bastion: 38.08 };
    for (const [tag, maxDim] of Object.entries(pinned)) {
      expect(targetHeightFor(`/models/deepglass/${tag}.glb`)).toBeCloseTo(maxDim, 2);
    }
    for (const tag of [
      'wharf_deck_rail',
      'wharf_deck_rails',
      'wharf_quay_rail',
      'wharf_stairs',
      'wharf_crane',
      'wharf_mast',
      'wharf_lamp',
      'wharf_bollard',
      'wharf_rail',
      'wharf_shed',
      'wharf_quay_wide',
      'wharf_quay_wide_rail',
      'wharf_berth',
      'wharf_bastion_open',
    ]) {
      expect(targetHeightFor(`/models/deepglass/${tag}.glb`)).not.toBe(TARGET_HEIGHT);
    }
  });

  it('floors every deck at the plank tops, across the whole footprint', () => {
    const deck = piece('wharf_deck', 0, 0, SEAT);
    const quay = piece('wharf_quay', 60, 0, SEAT);
    const head = piece('wharf_bastion', 120, 0, SEAT);
    withWorld([deck, quay, head], (world) => {
      const floor = (xz: [number, number]) => placementRampFloorAt(world, SEED, xz[0], xz[1]);
      // the 8 x 8 pier module, centre to just inside its corners
      for (const [lx, lz] of [
        [0, 0],
        [3.8, 3.8],
        [-3.8, 3.8],
        [3.8, -3.8],
      ]) {
        expect(floor(at(deck, lx, lz))).toBeCloseTo(DECK_Y, 2);
      }
      // the quay sector: its inner (land) edge, middle and outer (sea) edge,
      // out to the corners it shares with the next sector along the arc
      for (const [lx, lz] of [
        [0, -7.8],
        [5.4, -7.8],
        [0, 0],
        [5.7, 7.8],
        [-5.7, 7.8],
      ]) {
        expect(floor(at(quay, lx, lz))).toBeCloseTo(DECK_Y, 2);
      }
      // the octagonal pier head: its slabs cover the octagon to the coping,
      // along the axes AND the diagonals, out to the corners
      for (let k = 0; k < 16; k++) {
        const a = (k * Math.PI) / 8;
        const r = 6.6;
        expect(floor(at(head, Math.cos(a) * r, Math.sin(a) * r))).toBeCloseTo(DECK_Y, 2);
      }
      for (let k = 0; k < 8; k++) {
        const a = Math.PI / 8 + (k * Math.PI) / 4;
        expect(floor(at(head, Math.cos(a) * 7.5, Math.sin(a) * 7.5))).toBeCloseTo(DECK_Y, 2);
      }
      // ...and nothing past the stone: no floor out over the water, off any
      // face (two overlapped squares made an eight-point star reaching 10.2)
      for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 4;
        expect(floor(at(head, Math.cos(a) * 8.2, Math.sin(a) * 8.2))).toBe(
          Number.NEGATIVE_INFINITY,
        );
      }
    });
  });

  it('runs the stair flight from under the waterline up to the deck', () => {
    const stairs = piece('wharf_stairs', 0, 0, SEAT);
    withWorld([stairs], (world) => {
      const floor = (lx: number) => placementRampFloorAt(world, SEED, ...at(stairs, lx, 0));
      expect(floor(0)).toBeCloseTo(DECK_Y, 2); // the top landing
      const foot = floor(-15.9);
      expect(foot).toBeLessThan(-2.8); // under the swim line: a swimmer walks onto it
      expect(floor(-9)).toBeGreaterThan(foot);
      expect(floor(-9)).toBeLessThan(DECK_Y);
      // steady climb, never a step a walker cannot take
      let prev = foot;
      for (let lx = -15.5; lx <= -1.7; lx += 0.5) {
        const f = floor(lx);
        expect(f).toBeGreaterThanOrEqual(prev);
        expect(f - prev).toBeLessThan(0.5);
        prev = f;
      }
    });
  });

  it('keeps a swimmer under a deck on the seabed, and a walker on the planks', () => {
    const deck = piece('wharf_deck', 0, 0, SEAT);
    withWorld([deck], () => {
      const bed = terrainHeight(0, 0, SEED);
      expect(groundHeightAtBody(0, 0, SEED, -2.75)).toBeCloseTo(bed, 2);
      expect(groundHeightAtBody(0, 0, SEED, DECK_Y)).toBeCloseTo(DECK_Y, 2);
    });
  });

  it('blocks at the rails, piles, parapet and dressing, never on the walkway', () => {
    const rail = piece('wharf_deck_rail', 0, 0, SEAT, 0);
    const head = piece('wharf_bastion', 80, 0, SEAT, 0);
    const lamp = piece('wharf_lamp', 40, 0, DECK_Y, 0);
    withWorld([rail, head, lamp], () => {
      const cs = colliderInternalsForTest.staticWorldColliders(SEED) as unknown as {
        x: number;
        z: number;
        hw: number;
        hd: number;
        baseY: number;
        moveTopY: number;
      }[];
      const hits = (x: number, z: number, y: number) =>
        cs.filter(
          (c) =>
            Math.abs(c.x - x) <= c.hw + 0.3 &&
            Math.abs(c.z - z) <= Math.max(c.hd, c.hw) + 0.3 &&
            c.baseY <= y &&
            c.moveTopY >= y,
        );
      const waist = DECK_Y + 1.0;
      // the rope rail on the module's +X side stops a walker at waist height
      expect(hits(3.55, 0, waist).length).toBeGreaterThan(0);
      // the middle of the pier is clear at walking height
      expect(hits(0, 0, waist).length).toBe(0);
      // under the planks the piles stand in the water
      expect(hits(3.55, 2, -2).length).toBeGreaterThan(0);
      // the pier head's seaward parapet (glTF +Z) blocks; its pier side is open
      expect(hits(80, 7.0, waist).length).toBeGreaterThan(0);
      expect(hits(80, -6.5, waist).length).toBe(0);
      // a lamp post is a thing you walk round
      expect(hits(40, 0, waist).length).toBeGreaterThan(0);
    });
  });

  it('ends a 1.5x wharf in the open pier head, its berth level out to the open end', () => {
    // as wharf_layout.py lays it: head on the pier axis, berth out of its
    // open seaward face (glTF +Z), both grown 1.5x in plan only
    const K = 1.5;
    const head = piece('wharf_bastion_open', 0, 0, SEAT, 0, K);
    const berth = piece('wharf_berth', 0, 7.36 * K, SEAT, -Math.PI / 2, K);
    const pier = piece('wharf_deck', 0, -(7.2 + 4) * K, SEAT, 0, K);
    withWorld([head, berth, pier], (world) => {
      const floor = (x: number, z: number) => placementRampFloorAt(world, SEED, x, z);
      // one level walk from the pier's end over the head and the gangway,
      // to the berth's open end (the deck reaches a hand past it)
      for (let z = -(7.2 + 1) * K; z <= (7.36 + 2.5) * K + 0.25; z += 0.25) {
        expect(floor(1.5, z), `planks at z ${z.toFixed(2)}`).toBeCloseTo(DECK_Y, 2);
      }
      expect(floor(0, (7.36 + 2.5) * K + 0.6)).toBe(Number.NEGATIVE_INFINITY);
      // the 12 yd module keeps the planks at 6.08 out to its corners
      expect(floor(...at(pier, 3.9, 3.9))).toBeCloseTo(DECK_Y, 2);
      const cs = colliderInternalsForTest.staticWorldColliders(SEED) as unknown as {
        type: string;
        x: number;
        z: number;
        hw: number;
        hd: number;
        rot: number;
        baseY: number;
        moveTopY: number;
      }[];
      const waist = DECK_Y + 1.0;
      const blocked = (x: number, z: number) =>
        cs.some((c) => {
          if (c.type !== 'obb' || c.baseY > waist || c.moveTopY < waist) return false;
          const dx = x - c.x;
          const dz = z - c.z;
          const u = dx * Math.cos(c.rot) - dz * Math.sin(c.rot);
          const v = dx * Math.sin(c.rot) + dz * Math.cos(c.rot);
          return Math.abs(u) <= c.hw && Math.abs(v) <= c.hd;
        });
      // the head's straight seaward face is open where the gangway runs out...
      expect(blocked(0, 6.9 * K)).toBe(false);
      expect(blocked(1.5, 6.9 * K)).toBe(false);
      // ...between the corner piers, with the diagonal parapets either side
      expect(blocked(2.9 * K, 7.0 * K)).toBe(true);
      expect(blocked(-2.9 * K, 7.0 * K)).toBe(true);
      expect(blocked(5.0 * K, 5.0 * K)).toBe(true);
      // the gangway: gateway posts and rope rails at its sides, clear between
      expect(blocked(2.05 * K, (7.36 + 0.25) * K)).toBe(true);
      expect(blocked(2.18 * K, (7.36 + 1.5) * K)).toBe(true);
      expect(blocked(-2.18 * K, (7.36 + 1.5) * K)).toBe(true);
      expect(blocked(0, (7.36 + 1.5) * K)).toBe(false);
    });
  });
});
