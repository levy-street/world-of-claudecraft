// A building must not be surrounded by invisible wall.
//
// Every hand-placed building collides as a CIRCLE, and these models are
// rectangles. A circle drawn around one stands off its flat walls, worst at the
// middle of each wall, and the player's own 0.5yd radius widens that band again:
// you stop in open air with the wall still a stride away. Player report: "the
// collision on things like the stables is too large causing a buffer around the
// building making it seem like there is an invisible wall".
//
// Measuring the kit turned up the mirror defect too. The stables' circle is
// SMALLER than its model, so it cuts 4.4yd off the paddock's corners while
// clipping into it along the axes. Both are the same root cause: one radius
// cannot describe a rectangle.
//
// Buildings flagged `boxed` now collide as the model's measured box, so a body
// stops exactly its own radius from the drawn wall on every face.
import { describe, expect, it } from 'vitest';
import { CASTLE_BUILDINGS, castleBuildingProps } from '../src/sim/castle_layout';
import { isBlocked } from '../src/sim/colliders';
import { HEX_BUILDING_UNIT, hexBuildingBox, hexBuildingFamily } from '../src/sim/hex_building_dims';
import { PLAYER_BODY_RADIUS } from '../src/sim/pathfind';

const SEED = 20061;

describe('castle buildings collide as the shape they are drawn as', () => {
  it('has a measured footprint for every model the castle places', () => {
    for (const b of CASTLE_BUILDINGS) {
      expect(
        HEX_BUILDING_UNIT[hexBuildingFamily(b.key)],
        `${b.key} has no measured footprint, so it cannot be boxed`,
      ).toBeDefined();
    }
  });

  it('carries the box through to the emitted prop, derived not hand-typed', () => {
    const props = castleBuildingProps();
    expect(props.length).toBe(CASTLE_BUILDINGS.length);
    for (let i = 0; i < props.length; i++) {
      const b = CASTLE_BUILDINGS[i];
      const p = props[i];
      expect(p.r, `${b.key} lost its clearance radius`).toBe(b.r);
      if (!b.boxed) {
        expect(p.hw, `${b.key} is not boxed but carries a box`).toBeUndefined();
        continue;
      }
      const box = hexBuildingBox(b.key, b.scale);
      expect(p.hw, `${b.key} box drifted from the model`).toBeCloseTo(box?.hw ?? -1, 6);
      expect(p.hd, `${b.key} box drifted from the model`).toBeCloseTo(box?.hd ?? -1, 6);
    }
  });

  it('stops a body one radius off a boxed building, not a stride out', () => {
    // Walk in along each of the model's four face normals and find where the
    // ground stops being standable. On a boxed building that distance is the
    // body radius; the circle it replaced stood off by up to 2.14yd more.
    for (const b of CASTLE_BUILDINGS) {
      if (!b.boxed) continue;
      const box = hexBuildingBox(b.key, b.scale);
      if (!box) throw new Error(`no box for ${b.key}`);
      for (const [lx, lz, half] of [
        [1, 0, box.hw],
        [-1, 0, box.hw],
        [0, 1, box.hd],
        [0, -1, box.hd],
      ] as const) {
        // the face normal in world space (the collider rotates by the same rot)
        const cos = Math.cos(b.rot);
        const sin = Math.sin(b.rot);
        const wx = lx * cos + lz * sin;
        const wz = -lx * sin + lz * cos;
        let stand = -1;
        for (let d = 0; d <= 4; d += 0.05) {
          const x = b.x + wx * (half + d);
          const z = b.z + wz * (half + d);
          if (!isBlocked(SEED, x, z, PLAYER_BODY_RADIUS)) {
            stand = d;
            break;
          }
        }
        expect(stand, `${b.key} face (${lx},${lz}) never opens up`).toBeGreaterThanOrEqual(0);
        // one body radius, plus a sample step, plus room for a neighbouring
        // mass that legitimately stands nearby
        expect(
          stand,
          `${b.key} holds the player ${stand.toFixed(2)}yd off its own wall`,
        ).toBeLessThan(PLAYER_BODY_RADIUS + 1.3);
      }
    }
  });
});
