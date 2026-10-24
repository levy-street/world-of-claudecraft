// The chase boom stops at placed-asset colliders (sim/colliders.ts
// cameraBoomMaxDist): a building between the eye and the camera shortens the
// boom, one the boom clears overhead does not, and thin props never do.
// Authored maps only: the built-in world keeps the release camera, which never
// clamped to colliders, so these run on an authored copy of the shipped world.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Collider, cameraBoomMaxDist, queryOpenWorldColliders } from '../src/sim/colliders';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import { groundHeight } from '../src/sim/world';

beforeAll(() => setActiveWorldContent({ ...BUILTIN_WORLD, placements: [] }));
afterAll(() => setActiveWorldContent(null));

const SEED = 1;

function firstBuilding(): Extract<Collider, { type: 'obb' }> {
  const found: Collider[] = [];
  queryOpenWorldColliders(SEED, -300, -300, 300, 300, found);
  const hit = found.find(
    (c) => c.type === 'obb' && c.hw >= 2 && c.hd >= 2 && c.cameraTopY !== undefined,
  );
  if (hit?.type !== 'obb') throw new Error('no building collider near the origin');
  return hit;
}

describe('camera boom vs asset colliders', () => {
  it('never clamps on the built-in world', () => {
    const b = firstBuilding();
    const reach = Math.hypot(b.hw, b.hd) + 3;
    const eye = { x: b.x - reach, z: b.z };
    const y = groundHeight(eye.x, eye.z, SEED) + 2;
    setActiveWorldContent(null);
    try {
      expect(cameraBoomMaxDist(SEED, eye.x, y, eye.z, b.x + reach, y, b.z, 0.3)).toBe(Infinity);
    } finally {
      setActiveWorldContent({ ...BUILTIN_WORLD, placements: [] });
    }
  });

  it('stops short of a building standing between the eye and the camera', () => {
    const b = firstBuilding();
    const reach = Math.hypot(b.hw, b.hd) + 3;
    const eye = { x: b.x - reach, z: b.z };
    const y = groundHeight(eye.x, eye.z, SEED) + 2;
    const max = cameraBoomMaxDist(SEED, eye.x, y, eye.z, b.x + reach, y, b.z, 0.3);
    expect(max).toBeLessThan(reach);
    expect(max).toBeGreaterThanOrEqual(0);
  });

  it('runs free when the boom clears the roof', () => {
    const b = firstBuilding();
    const reach = Math.hypot(b.hw, b.hd) + 3;
    const y = (b.cameraTopY ?? 0) + 5;
    expect(cameraBoomMaxDist(SEED, b.x - reach, y, b.z, b.x + reach, y, b.z, 0.3)).toBe(Infinity);
  });

  it('ignores a collider that already holds the eye', () => {
    const b = firstBuilding();
    const y = groundHeight(b.x, b.z, SEED) + 2;
    const reach = Math.hypot(b.hw, b.hd) + 3;
    // from the building's centre outward: the only collider in the way is the
    // one the eye is inside, which shortening cannot escape
    const max = cameraBoomMaxDist(SEED, b.x, y, b.z, b.x - reach, y, b.z, 0.3);
    expect(max === Infinity || max > Math.min(b.hw, b.hd)).toBe(true);
  });
});
