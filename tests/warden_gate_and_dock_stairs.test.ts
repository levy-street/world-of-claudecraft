// Two Blender-authored kit pieces whose collision must line up with the art:
//  - the Warden gate: closed = the leaves bar the arch, open = the passage is
//    clear and the leaves lie along the passage walls; the arch stays over
//    head height either way.
//  - the dock stairs: one walkable deck climbs the flight through the tread
//    tops to a flat landing; nothing solid stands on the treads.
import { describe, expect, it } from 'vitest';
import { targetHeightFor } from '../src/render/asset_scale';
import { colliderInternalsForTest } from '../src/sim/colliders';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import { placementRampFloorAt } from '../src/sim/placement_ramps';
import type { WorldContent } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

const SEED = 20061;
type Placement = NonNullable<WorldContent['placements']>[number];
const place = (assetId: string, x: number, z: number, scale: number, groundY: number): Placement =>
  ({
    assetId,
    path: `/models/${assetId}.glb`,
    x,
    z,
    rotY: 0,
    scale,
    collide: true,
    collideRadius: 4,
    collisionMode: 'baked',
    detached: true,
    groundY,
  }) as unknown as Placement;

interface Band {
  x: number;
  z: number;
  baseY?: number;
  hiY?: number;
  hw?: number;
  hd?: number;
  r?: number;
}
const near = (x: number, z: number, r: number): Band[] =>
  (colliderInternalsForTest.staticWorldColliders(SEED) as unknown as Band[]).filter(
    (c) => Math.hypot(c.x - x, c.z - z) < r,
  );
/** Does an axis-aligned box collider cover world point (px, pz)? */
const covers = (c: Band, px: number, pz: number): boolean =>
  c.hw !== undefined && c.hd !== undefined
    ? Math.abs(px - c.x) <= c.hw && Math.abs(pz - c.z) <= c.hd
    : c.r !== undefined
      ? Math.hypot(px - c.x, pz - c.z) <= c.r
      : false;

describe('Warden gate', () => {
  it('scales with the wall kit (a gate at wall scale is 1.6x a wall)', () => {
    // The wall is 4 model yards at 2.2 per scale; the gate keeps that ratio.
    const gate = targetHeightFor('/models/deepglass/warden_gate_closed.glb');
    expect(gate).toBeGreaterThan(4); // 8.34 * 0.55
    expect(targetHeightFor('/models/deepglass/warden_gate_open.glb')).toBeCloseTo(gate, 6);
  });

  it('bars the arch when closed and clears it when open, arch over head both ways', () => {
    const S = 1.8; // wall run at height 4 * 1.8 = 7.2 yd; gate 11.5 yd
    const cx = 40;
    // Seated high in the air (detached), so every collider up there is the
    // gate's own and nothing of the built-in world can stand in for it.
    const SEAT = 500;
    const world: WorldContent = {
      ...BUILTIN_WORLD,
      placements: [
        place('deepglass/warden_gate_closed', cx, 0, S, SEAT),
        place('deepglass/warden_gate_open', cx + 60, 0, S, SEAT),
      ],
    };
    setActiveWorldContent(world);
    try {
      const head = SEAT + 2.2;
      const up = (c: Band): boolean => (c.baseY ?? -Infinity) > SEAT - 5;
      // Closed: something solid covers the centre of the opening at foot level.
      const closed = near(cx, 0, 20).filter(up);
      expect(closed.length).toBeGreaterThan(0);
      // Each leaf stops a hair short of the centre line: probe just off it.
      for (const dx of [-0.4, 0.4]) {
        const barring = closed.filter((c) => covers(c, cx + dx, 0) && (c.baseY ?? 0) <= SEAT + 0.2);
        expect(barring.length).toBeGreaterThan(0);
      }
      // Open: nothing at foot level covers the centre line of the passage; the
      // arch above it starts over head height; the leaves lie beside the line.
      const open = near(cx + 60, 0, 20).filter(up);
      expect(open.length).toBeGreaterThan(0);
      const onLine = open.filter((c) => covers(c, cx + 60, 0));
      for (const c of onLine) expect(c.baseY ?? 0).toBeGreaterThan(head);
      const leaves = open.filter(
        (c) => !covers(c, cx + 60, 0) && Math.abs(c.x - (cx + 60)) < 1.5 * S,
      );
      expect(leaves.length).toBeGreaterThanOrEqual(2);
    } finally {
      setActiveWorldContent(null);
    }
  });
});

describe('dock stairs', () => {
  it('walk up the flight on one rising deck onto a flat landing, rails beside', () => {
    const x = 400;
    const seat = 50; // well above the built-in terrain there, so the deck IS the ground
    const world: WorldContent = {
      ...BUILTIN_WORLD,
      placements: [place('props/dock_stairs', x, 0, 1, seat)],
    };
    setActiveWorldContent(world);
    try {
      const maxDim = targetHeightFor('/models/props/dock_stairs.glb');
      expect(maxDim).toBeGreaterThan(7); // RUN 6 + LAND 1.6, authored yards
      expect(maxDim).toBeLessThan(9);
      // Foot edge half a riser up, head edge a half riser over the top tread,
      // landing flat at the top (RISE 4 over RUN 6, 10 steps of 0.4).
      const floor = (dx: number): number => placementRampFloorAt(world, SEED, x + dx, 0);
      // The landing is the top tread's level, 4 yd over the model base (the
      // base is the lowest vertex, a hair under the foot, so everything is
      // measured from the landing rather than the seat).
      const landing = floor(3.8);
      expect(landing).toBeGreaterThan(seat + 3.9);
      expect(landing).toBeLessThan(seat + 4.2);
      const base = landing - 4;
      expect(floor(-2.9)).toBeCloseTo(base + 0.2 + (0.1 / 6) * 4, 1);
      expect(floor(0)).toBeCloseTo(base + 0.2 + 2, 1);
      expect(floor(2.9)).toBeCloseTo(base + 0.2 + (5.9 / 6) * 4, 1);
      expect(floor(-2.9)).toBeLessThan(floor(0));
      expect(floor(0)).toBeLessThan(floor(2.9));
      expect(groundHeight(x, 0, SEED)).toBeCloseTo(floor(0), 2);
      // Nothing solid on the treads: every collider near the flight is a rail
      // off the walking line.
      for (const c of near(x, 0, 12)) expect(covers(c, x, 0)).toBe(false);
      expect(near(x, 0, 12).length).toBeGreaterThanOrEqual(2);
    } finally {
      setActiveWorldContent(null);
    }
  });
});

describe('dock deck modules', () => {
  it('stand one level floor at the stairs landing height, open one clear, rail one railed on +X', () => {
    const x = 500;
    const seat = 50;
    const world: WorldContent = {
      ...BUILTIN_WORLD,
      placements: [
        place('props/dock_stairs', x, 0, 1, seat),
        // butted on the stairs' landing end (x + RUN/2 + LAND + S/2)
        place('props/dock_deck', x + 3 + 1.6 + 3, 0, 1, seat),
        place('props/dock_deck_rail', x + 3 + 1.6 + 9, 0, 1, seat),
      ],
    };
    setActiveWorldContent(world);
    try {
      const floor = (px: number): number => placementRampFloorAt(world, SEED, px, 0);
      const landing = floor(x + 3.8);
      // the deck continues the landing level across both modules
      for (const dx of [5.0, 7.6, 10.5, 13.6, 16.5]) expect(floor(x + dx)).toBeCloseTo(landing, 1);
      expect(groundHeight(x + 7.6, 0, SEED)).toBeCloseTo(landing, 1);
      // open deck: nothing solid on the boards; rail deck: one rail along its +X edge
      const openC = near(x + 7.6, 0, 3.5).filter((c) => (c.baseY ?? 0) >= landing - 0.5);
      expect(openC.length).toBe(0);
      const railC = near(x + 13.6, 0, 3.5).filter((c) => (c.baseY ?? 0) >= landing - 0.5);
      expect(railC.length).toBe(1);
      expect(railC[0].x).toBeGreaterThan(x + 13.6 + 2.5);
    } finally {
      setActiveWorldContent(null);
    }
  });
});
