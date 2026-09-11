import { afterEach, describe, expect, it } from 'vitest';
import { roadDistance, setAuthoredRoads } from '../src/sim/world';

// Content-aware road override: setAuthoredRoads swaps the smoothed road set
// roadDistance reads, and null restores the built-in world byte-identically.

// Scan a coarse grid for a point every built-in road ignores (Infinity) and a
// few points a built-in road reaches (finite), so the test does not hardcode
// authored road coordinates that could drift.
function scanPoints(): { far: { x: number; z: number }; near: { x: number; z: number }[] } {
  let far: { x: number; z: number } | null = null;
  const near: { x: number; z: number }[] = [];
  for (let x = -2000; x <= 2000; x += 50) {
    for (let z = -2000; z <= 2000; z += 50) {
      const d = roadDistance(x, z);
      if (d === Infinity) {
        if (!far) far = { x, z };
      } else if (near.length < 4) {
        near.push({ x, z });
      }
      if (far && near.length >= 4) return { far, near };
    }
  }
  if (!far) throw new Error('no road-free point found in scan');
  return { far, near };
}

describe('sim road override (setAuthoredRoads)', () => {
  afterEach(() => setAuthoredRoads(null));

  it('authored roads reach a point the built-in roads never touch', () => {
    const { far } = scanPoints();
    expect(roadDistance(far.x, far.z)).toBe(Infinity);

    setAuthoredRoads([
      [
        { x: far.x - 20, z: far.z },
        { x: far.x + 20, z: far.z },
      ],
    ]);
    // The meander warp shifts the query by a few yards at most; the point sits
    // on the authored segment, so the distance stays small.
    expect(roadDistance(far.x, far.z)).toBeLessThan(8);
  });

  it('setAuthoredRoads(null) restores the built-in set', () => {
    const { far } = scanPoints();
    setAuthoredRoads([
      [
        { x: far.x - 20, z: far.z },
        { x: far.x + 20, z: far.z },
      ],
    ]);
    expect(roadDistance(far.x, far.z)).toBeLessThan(8);
    setAuthoredRoads(null);
    expect(roadDistance(far.x, far.z)).toBe(Infinity);
  });

  it('built-in road distances are byte-identical after an override round trip', () => {
    const { far, near } = scanPoints();
    expect(near.length).toBeGreaterThan(0);
    const before = near.map((p) => roadDistance(p.x, p.z));

    setAuthoredRoads([
      [
        { x: far.x - 20, z: far.z },
        { x: far.x + 20, z: far.z },
      ],
    ]);
    setAuthoredRoads(null);

    const after = near.map((p) => roadDistance(p.x, p.z));
    expect(after).toEqual(before);
  });
});
