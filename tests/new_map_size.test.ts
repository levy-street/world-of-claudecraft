import { afterEach, describe, expect, it } from 'vitest';
import { newFlatCustomMap } from '../src/editor/custom_map';
import { setActiveWorldContent } from '../src/sim/data';
import { MAX_BLOCKER_LENGTH, MAX_BLOCKERS, sanitizeMapDoc } from '../src/sim/map_doc';

// Sized blank maps (the New Map dialog): the zone band carries the z extent,
// worldHalfX the x extent, a level-stamp grid flattens the interior, and
// perimeter blockers make the bounds collide.

afterEach(() => {
  setActiveWorldContent(null);
});

describe('newFlatCustomMap with a size', () => {
  it('bounds a small interior map', () => {
    const map = newFlatCustomMap('T', 'id', 0, { width: 60, height: 60 });
    expect(map.worldHalfX).toBe(30);
    expect(map.content.zones[0].zMin).toBe(-30);
    expect(map.content.zones[0].zMax).toBe(30);
    // Perimeter blockers trace the exact bounds.
    const xs = (map.blockers ?? []).flatMap((b) => [b.x1, b.x2]);
    expect(Math.min(...xs)).toBe(-30);
    expect(Math.max(...xs)).toBe(30);
    for (const b of map.blockers ?? []) {
      expect(Math.hypot(b.x2 - b.x1, b.z2 - b.z1)).toBeLessThanOrEqual(MAX_BLOCKER_LENGTH + 1e-6);
    }
  });

  it('a large map stays within the blocker cap and stamp budget', () => {
    const map = newFlatCustomMap('T', 'id', 0, { width: 2000, height: 2000 });
    expect((map.blockers ?? []).length).toBeLessThanOrEqual(MAX_BLOCKERS);
    expect(map.terrainEdits.length).toBeLessThan(200);
  });

  it('clamps out-of-range dimensions', () => {
    const map = newFlatCustomMap('T', 'id', 0, { width: 5, height: 99999 });
    expect(map.worldHalfX).toBe(20); // width floored to 40
    expect(map.content.zones[0].zMax).toBe(1000); // height capped at 2000
  });

  it('without a size, the legacy world-sized flat map is unchanged', () => {
    const map = newFlatCustomMap('T', 'id', 0);
    expect(map.worldHalfX).toBeUndefined();
    expect(map.blockers).toBeUndefined();
    expect(map.terrainEdits).toHaveLength(4);
  });

  it('the sanitizer round-trips worldHalfX (and the sized doc parses)', () => {
    const map = newFlatCustomMap('T', 'id', 0, { width: 100, height: 200 });
    const doc = sanitizeMapDoc(JSON.stringify(map));
    expect(doc).not.toBeNull();
    expect(doc?.worldHalfX).toBe(50);
    expect(doc?.blockers?.length).toBe(map.blockers?.length);
    expect(doc?.terrainEdits.length).toBe(map.terrainEdits.length);
  });
});
