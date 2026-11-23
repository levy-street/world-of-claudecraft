import { describe, expect, it } from 'vitest';
import {
  bakeCategoryFor,
  bakeCollisionBoxes,
  bakeOptionsFor,
  type CollisionBox,
} from '../src/editor/collision_bake_core';

// The collision bake core: voxelize -> exterior flood fill -> greedy boxes.
// Pins the load-bearing behaviors: solid shapes bake solid, archway openings
// SURVIVE (the whole point vs one convex hull), trunk mode clips trees to the
// stem, sub-voxel detail smooths away, and output is deterministic.

/** Push one axis-aligned quad (two triangles) onto a triangle soup. */
function quad(
  out: number[],
  a: [number, number, number],
  b: [number, number, number],
  c: [number, number, number],
  d: [number, number, number],
): void {
  out.push(...a, ...b, ...c, ...a, ...c, ...d);
}

/** A closed axis-aligned box shell as 12 triangles. */
function boxTris(
  cx: number,
  cy: number,
  cz: number,
  hx: number,
  hy: number,
  hz: number,
  out: number[] = [],
): number[] {
  const x0 = cx - hx,
    x1 = cx + hx;
  const y0 = cy - hy,
    y1 = cy + hy;
  const z0 = cz - hz,
    z1 = cz + hz;
  quad(out, [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]); // -z
  quad(out, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]); // +z
  quad(out, [x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]); // -x
  quad(out, [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]); // +x
  quad(out, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]); // -y
  quad(out, [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]); // +y
  return out;
}

function containsPoint(boxes: CollisionBox[], x: number, y: number, z: number): boolean {
  return boxes.some(
    (b) => Math.abs(x - b.cx) <= b.hx && Math.abs(y - b.cy) <= b.hy && Math.abs(z - b.cz) <= b.hz,
  );
}

describe('bakeCollisionBoxes', () => {
  it('bakes a closed crate into a solid box hugging its bounds', () => {
    const tris = boxTris(0, 1, 0, 1, 1, 1);
    const boxes = bakeCollisionBoxes(tris, { resolution: 0.25, maxBoxes: 12 });
    expect(boxes.length).toBeGreaterThan(0);
    expect(boxes.length).toBeLessThanOrEqual(12);
    // The interior pocket solidified: the crate's center is inside a box.
    expect(containsPoint(boxes, 0, 1, 0)).toBe(true);
    // The collider hugs the mesh: nothing sticks out by more than a voxel.
    for (const b of boxes) {
      expect(b.cx - b.hx).toBeGreaterThanOrEqual(-1.3);
      expect(b.cx + b.hx).toBeLessThanOrEqual(1.3);
      expect(b.cy + b.hy).toBeLessThanOrEqual(2.3);
    }
  });

  it('keeps an archway OPEN while both jambs and the lintel block', () => {
    // Two pillars + a lintel spanning them: a 2yd-wide, 2.5yd-tall opening.
    const tris: number[] = [];
    boxTris(-1.5, 1.5, 0, 0.5, 1.5, 0.5, tris); // left jamb
    boxTris(1.5, 1.5, 0, 0.5, 1.5, 0.5, tris); // right jamb
    boxTris(0, 3.25, 0, 2, 0.25, 0.5, tris); // lintel across the top
    const boxes = bakeCollisionBoxes(tris, { resolution: 0.3, maxBoxes: 12 });
    // The opening the player walks through stays air.
    expect(containsPoint(boxes, 0, 1, 0)).toBe(false);
    expect(containsPoint(boxes, 0, 2, 0)).toBe(false);
    // The jambs and lintel block.
    expect(containsPoint(boxes, -1.5, 1.5, 0)).toBe(true);
    expect(containsPoint(boxes, 1.5, 1.5, 0)).toBe(true);
    expect(containsPoint(boxes, 0, 3.25, 0)).toBe(true);
  });

  it('trunk mode keeps the stem and drops the canopy', () => {
    // A "tree": thin trunk 0..4yd + a fat canopy ball above.
    const tris: number[] = [];
    boxTris(0, 2, 0, 0.3, 2, 0.3, tris); // trunk
    boxTris(0, 6, 0, 2.5, 2, 2.5, tris); // canopy
    const opts = bakeOptionsFor('trunk', { x: 5, y: 8, z: 5 });
    const boxes = bakeCollisionBoxes(tris, opts);
    expect(boxes.length).toBeGreaterThan(0);
    // Trunk blocks, canopy does not.
    expect(containsPoint(boxes, 0, 1, 0)).toBe(true);
    expect(containsPoint(boxes, 1.8, 6, 1.8)).toBe(false);
    expect(containsPoint(boxes, 0, 6.5, 0)).toBe(false);
  });

  it('smooths away sub-voxel snag detail', () => {
    // A wall with a tiny 0.1yd knob sticking out of its face.
    const tris: number[] = [];
    boxTris(0, 1.5, 0, 2, 1.5, 0.25, tris);
    boxTris(0, 1.5, 0.3, 0.05, 0.05, 0.05, tris); // the knob
    const boxes = bakeCollisionBoxes(tris, { resolution: 0.5, maxBoxes: 12 });
    // Nothing extends meaningfully past the wall face + one voxel.
    for (const b of boxes) expect(b.cz + b.hz).toBeLessThanOrEqual(0.3 + 0.5);
  });

  it('is deterministic', () => {
    const tris = boxTris(0.3, 1.2, -0.7, 1.1, 0.9, 0.6);
    const a = bakeCollisionBoxes(tris, { resolution: 0.3, maxBoxes: 12 });
    const b = bakeCollisionBoxes(tris, { resolution: 0.3, maxBoxes: 12 });
    expect(a).toEqual(b);
  });

  it('respects the box budget via coarsen-then-keep-biggest', () => {
    // A comb of 8 separate teeth wants 8 boxes; budget forces fewer.
    const tris: number[] = [];
    for (let i = 0; i < 8; i++) boxTris(i * 2, 0.5, 0, 0.4, 0.5, 0.4, tris);
    const boxes = bakeCollisionBoxes(tris, { resolution: 0.2, maxBoxes: 3 });
    expect(boxes.length).toBeLessThanOrEqual(3);
    expect(boxes.length).toBeGreaterThan(0);
  });
});

describe('bakeCategoryFor', () => {
  it('types assets sensibly', () => {
    expect(bakeCategoryFor('foliage/oak_1')).toBe('trunk');
    expect(bakeCategoryFor('foliage/pine_2')).toBe('trunk');
    expect(bakeCategoryFor('biome/beach_palm_1')).toBe('trunk');
    expect(bakeCategoryFor('foliage/bush_1')).toBe('none');
    expect(bakeCategoryFor('foliage/fern_1')).toBe('none');
    expect(bakeCategoryFor('foliage/rock_1')).toBe('default'); // a hugging box suits a rock
    expect(bakeCategoryFor('grass/patch')).toBe('none');
    expect(bakeCategoryFor('rock/generated')).toBe('none');
    expect(bakeCategoryFor('collider/plane')).toBe('none');
    expect(bakeCategoryFor('biome/city_wagon')).toBe('default');
    expect(bakeCategoryFor('props/barrel')).toBe('default');
    expect(bakeCategoryFor('local/abc123')).toBe('default');
  });
});
