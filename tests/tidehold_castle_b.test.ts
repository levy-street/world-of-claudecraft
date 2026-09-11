// Castle B on the crown (bl_castle_b.py, 2026-09-10): the walled keep that
// replaced the first keep. Pins the seams a building asset has to get right, // where it stands, that its floors are decks the sim walks on, that the gate is
// open and its walls are not, that its guards stand inside it, and that its
// collision fits the per-placement caps.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { interiorSpecFor } from '../src/render/interior_reveal';
import { queryOpenWorldColliders } from '../src/sim/colliders';
import { setActiveWorldContent } from '../src/sim/data';
import { TH_CASTLE_B_FLAMES, TIDEHOLD_RESIDENTS } from '../src/sim/deepglass/citadel';
import { ASSET_PALETTE, ringPlacements } from '../src/sim/deepglass/citadel_ring';
import { pol, RING_CASTLE, RING_CROWN } from '../src/sim/deepglass/citadel_ring_frame';
import { buildDeepglassWorld, DEEPGLASS_MAP_ENTRY } from '../src/sim/deepglass/world';
import { MAX_PLACEMENT_HITBOXES, MAX_PLACEMENT_RAMPS } from '../src/sim/map_doc';
import { groundHeightNear } from '../src/sim/world';

const SEED = DEEPGLASS_MAP_ENTRY.seed;
const S = 1.35;
const seat = pol(RING_CASTLE.r, RING_CASTLE.phi);
// kit (x, y) of the build script -> world
const cb = (xk: number, yk: number) => ({ x: seat.x + xk * S, z: seat.z - yk * S });

describe('Castle B', () => {
  it('stands on the crown where the first keep stood, and the first keep is gone', () => {
    const all = ringPlacements() as { path: string; x: number; z: number }[];
    const b = all.filter((p) => p.path.endsWith('/castle_b.glb'));
    expect(b).toHaveLength(1);
    expect(b[0].x).toBeCloseTo(seat.x, 1);
    expect(b[0].z).toBeCloseTo(seat.z, 1);
    expect(all.some((p) => p.path.endsWith('/castle.glb'))).toBe(false);
    expect(ASSET_PALETTE.has('tidehold/castle_b')).toBe(true);
  });

  it('nothing else the generator builds stands inside its walls', () => {
    const all = ringPlacements() as { path: string; x: number; z: number }[];
    const inside = all.filter(
      (p) =>
        !p.path.endsWith('/castle_b.glb') &&
        Math.abs(p.x - seat.x) < 33 &&
        p.z > seat.z - 32 &&
        p.z < seat.z + 26,
    );
    expect(
      inside.map((p) => `${p.path.split('/').pop()} @${p.x.toFixed(0)},${p.z.toFixed(0)}`),
    ).toEqual([]);
  });

  it('keeps its collision inside the per-placement caps', () => {
    const o = JSON.parse(fs.readFileSync('data/asset_collision_overrides.json', 'utf8'))[
      'tidehold/castle_b'
    ];
    expect(o.boxes.length).toBeLessThanOrEqual(MAX_PLACEMENT_HITBOXES);
    expect(o.ramps.length).toBeLessThanOrEqual(MAX_PLACEMENT_RAMPS);
  });

  it('the hall, the wings and the courtyard are decks the sim stands on', () => {
    setActiveWorldContent(buildDeepglassWorld());
    const base = RING_CROWN.y;
    const probe = (xk: number, yk: number) => {
      const p = cb(xk, yk);
      return groundHeightNear(p.x, p.z, SEED, base + 1) - base;
    };
    expect(probe(0, -9)).toBeGreaterThan(0.1); // the great hall
    expect(probe(0, -9)).toBeLessThan(0.6);
    expect(probe(19, -7)).toBeGreaterThan(0.1); // the kitchen wing
    expect(probe(-19, -7)).toBeGreaterThan(0.1); // the barracks
    expect(probe(0, 11)).toBeGreaterThan(0.1); // the courtyard
    expect(probe(0, 11)).toBeLessThan(0.6);
    // the dais is a step up, reached by its treads
    expect(probe(0, -13.5)).toBeGreaterThan(1.0);
  });

  it("the Warden's floor is reached by the stair up the hall's west bay", () => {
    setActiveWorldContent(buildDeepglassWorld());
    const base = RING_CROWN.y;
    const over = (xk: number, yk: number, feet: number) => {
      const p = cb(xk, yk);
      return groundHeightNear(p.x, p.z, SEED, base + feet) - base;
    };
    // flight A up the west bay to the landing at the middle floor
    expect(over(-11.2, -3.4, 1)).toBeGreaterThan(0.3);
    expect(over(-11.2, -3.4, 1)).toBeLessThan(2.0);
    const headA = over(-11.2, -12.37, 7.5); // the last tread, at the landing's edge
    expect(headA).toBeGreaterThan(6.5);
    const landing = over(-11.2, -13.9, 7.5);
    expect(landing).toBeGreaterThan(6.5);
    expect(landing).toBeLessThanOrEqual(headA + 0.01);
    // flight B east along the back wall to the Warden's floor
    expect(over(-9.5, -13.9, 7.5)).toBeGreaterThanOrEqual(landing - 0.05);
    const headB = over(-3.02, -13.9, 14); // the last tread of B, at the floor's edge
    expect(headB).toBeGreaterThan(13.3);
    const floor = over(0, -9, 14.2);
    expect(floor).toBeGreaterThan(13.4);
    expect(over(0, 0.6, 14.2)).toBeGreaterThan(13.3); // out on the balcony
    expect(floor).toBeLessThanOrEqual(headB + 0.01);
    expect(headB - floor).toBeLessThan(0.3);
  });

  it('each wing has a stair from its floor to the room above', () => {
    setActiveWorldContent(buildDeepglassWorld());
    const base = RING_CROWN.y;
    const over = (xk: number, yk: number, feet: number) => {
      const p = cb(xk, yk);
      return groundHeightNear(p.x, p.z, SEED, base + feet) - base;
    };
    for (const sx of [-1, 1]) {
      const foot = over(sx * 21.8, -9.6, 1);
      expect(foot, `wing ${sx} foot`).toBeGreaterThan(0.3);
      expect(foot, `wing ${sx} foot`).toBeLessThan(1.6);
      const head = over(sx * 21.8, -3.22, 8); // the last tread, at the landing
      expect(head, `wing ${sx} head`).toBeGreaterThan(6.4);
      const floor = over(sx * 17, -7, 8);
      expect(floor, `wing ${sx} floor`).toBeGreaterThan(6.4);
      expect(floor, `wing ${sx} floor`).toBeLessThanOrEqual(head + 0.01);
      expect(over(sx * 19, -2, 1), `wing ${sx} door`).toBeLessThan(0.6); // the doorway is ground
    }
  });

  it('the middle floor sits over the hall, a step under the flight where it passes', () => {
    setActiveWorldContent(buildDeepglassWorld());
    const base = RING_CROWN.y;
    const over = (xk: number, yk: number, feet: number) => {
      const p = cb(xk, yk);
      return groundHeightNear(p.x, p.z, SEED, base + feet) - base;
    };
    const mid = over(0, -9, 7.5); // the middle floor's box (5.08 kit)
    expect(mid).toBeGreaterThan(6.6);
    expect(mid).toBeLessThan(7.3);
    const flight = over(-11.2, -7.6, 7.5); // flight A beside it, on its way up
    expect(flight).toBeGreaterThan(2.5);
    expect(flight).toBeLessThan(mid);
    expect(over(0, -9, 1)).toBeLessThan(0.6); // the hall floor is still the ground under it
    expect(over(0, -9, 14.2)).toBeGreaterThan(13.4); // and the Warden's floor above
  });

  it('a wall walk runs along the three courtyard walls, each with its flight', () => {
    setActiveWorldContent(buildDeepglassWorld());
    const base = RING_CROWN.y;
    const over = (xk: number, yk: number, feet: number) => {
      const p = cb(xk, yk);
      return groundHeightNear(p.x, p.z, SEED, base + feet) - base;
    };
    for (const sx of [-1, 1]) {
      // the side flight y 2 -> 8 up the inside of the curtain (strip x 22.6..24.1 at the 1.8 curtain)
      expect(over(sx * 23.35, 2.4, 1), `side ${sx} foot`).toBeGreaterThan(0.3);
      expect(over(sx * 23.35, 2.4, 1), `side ${sx} foot`).toBeLessThan(1.5);
      const head = over(sx * 23.35, 7.95, 6);
      expect(head, `side ${sx} head`).toBeGreaterThan(4.6);
      const walk = over(sx * 23.35, 15, 6);
      expect(walk, `side ${sx} walk`).toBeGreaterThan(4.6);
      expect(walk, `side ${sx} walk`).toBeLessThanOrEqual(head + 0.01);
      // the gate-wall flight x 8 -> 14, the walk on to the corner
      expect(over(sx * 8.4, 22.4, 1), `front ${sx} foot`).toBeGreaterThan(0.3);
      const fhead = over(sx * 13.95, 22.4, 6);
      expect(fhead, `front ${sx} head`).toBeGreaterThan(4.6);
      const fwalk = over(sx * 18, 22.4, 6);
      expect(fwalk, `front ${sx} walk`).toBeGreaterThan(4.6);
      expect(fwalk, `front ${sx} walk`).toBeLessThanOrEqual(fhead + 0.01);
    }
  });

  it('the gate is open and the curtain either side of it blocks', () => {
    setActiveWorldContent(buildDeepglassWorld());
    const base = RING_CROWN.y;
    const at = (xk: number, yk: number) => {
      const p = cb(xk, yk);
      return queryOpenWorldColliders(SEED, p.x - 0.3, p.z - 0.3, p.x + 0.3, p.z + 0.3, []).filter(
        (c: any) => {
          if (c.type !== 'obb') return false;
          // point-in-OBB in the box's own frame (either handedness of `rot`)
          const dx = p.x - c.x;
          const dz = p.z - c.z;
          const inFrame = (rot: number) => {
            const cs = Math.cos(rot);
            const sn = Math.sin(rot);
            const lx = dx * cs + dz * sn;
            const lz = -dx * sn + dz * cs;
            return Math.abs(lx) < c.hw + 0.3 && Math.abs(lz) < c.hd + 0.3;
          };
          const hit = inFrame(c.rot ?? 0) || inFrame(-(c.rot ?? 0));
          return (
            hit && (c.baseY ?? 0) < base + 2.0 && (c.moveTopY ?? c.cameraTopY ?? 0) > base + 0.5
          );
        },
      );
    };
    expect(at(0, 24), 'the gate tunnel').toHaveLength(0);
    expect(at(0, -2), 'the keep door').toHaveLength(0);
    expect(at(12, 24).length, 'the front curtain').toBeGreaterThan(0);
    expect(at(25, 5).length, 'the side curtain').toBeGreaterThan(0);
  });

  it('the Watch stands inside the castle', () => {
    const guards = TIDEHOLD_RESIDENTS.filter((r) => r.def.id.startsWith('th_keep_guard'));
    expect(guards.length).toBeGreaterThanOrEqual(8);
    for (const g of guards) {
      const p = g.def.pos;
      expect(Math.abs(p.x - seat.x), g.def.id).toBeLessThan(33);
      expect(p.z, g.def.id).toBeGreaterThan(seat.z - 31);
      expect(p.z, g.def.id).toBeLessThan(seat.z + 24);
    }
  });

  it('its fires and its reveal volumes sit inside the model', () => {
    for (const f of TH_CASTLE_B_FLAMES) {
      expect(Math.abs(f.x)).toBeLessThan(38.1);
      expect(Math.abs(f.z)).toBeLessThan(36.8);
      expect(f.y).toBeGreaterThan(0);
    }
    const spec = interiorSpecFor('/models/tidehold/castle_b.glb');
    expect(spec?.volumes).toHaveLength(3);
  });
});
