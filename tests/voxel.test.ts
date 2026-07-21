import { describe, expect, it } from 'vitest';
import { isSolidVoxel, TUNNELS, tunnelBounds, voxelDensity } from '../src/sim/voxel';
import { terrainHeight } from '../src/sim/world';

describe('voxel density field', () => {
  it('matches the existing heightfield outdoors, away from any tunnel', () => {
    const seed = 1;
    const x = -400;
    const z = -400; // far from the authored tunnel
    const surface = terrainHeight(x, z, seed);
    const y = surface + 3.7; // arbitrary offset, not the surface itself
    expect(voxelDensity(x, y, z, seed)).toBeCloseTo(y - terrainHeight(x, z, seed));
    expect(voxelDensity(x, surface - 1, z, seed)).toBeLessThan(0);
    expect(voxelDensity(x, surface + 1, z, seed)).toBeGreaterThan(0);
    expect(isSolidVoxel(x, surface - 1, z, seed)).toBe(true);
    expect(isSolidVoxel(x, surface + 1, z, seed)).toBe(false);
  });

  it('is a pure function: same inputs always give the same density', () => {
    const seed = 7;
    const a = voxelDensity(12.34, -1.2, 56.78, seed);
    const b = voxelDensity(12.34, -1.2, 56.78, seed);
    expect(a).toBe(b);
  });

  it('carves open air at the center of an authored tunnel waypoint', () => {
    const seed = 1;
    const tunnel = TUNNELS[0];
    const mid = tunnel.waypoints[1];
    expect(voxelDensity(mid.x, mid.y, mid.z, seed)).toBeGreaterThan(0);
    expect(isSolidVoxel(mid.x, mid.y, mid.z, seed)).toBe(false);
  });

  it('stays solid well outside a tunnel waypoint radius', () => {
    const seed = 1;
    const tunnel = TUNNELS[0];
    const far = tunnel.waypoints[1];
    expect(isSolidVoxel(far.x + far.radius + 20, far.y, far.z, seed)).toBe(true);
  });

  it('reports a bounding box expanded by each waypoint radius, not just the center', () => {
    const b = tunnelBounds(TUNNELS[0]);
    for (const w of TUNNELS[0].waypoints) {
      expect(b.minX).toBeLessThanOrEqual(w.x - w.radius);
      expect(b.maxX).toBeGreaterThanOrEqual(w.x + w.radius);
      expect(b.minY).toBeLessThanOrEqual(w.y - w.radius);
      expect(b.maxY).toBeGreaterThanOrEqual(w.y + w.radius);
      expect(b.minZ).toBeLessThanOrEqual(w.z - w.radius);
      expect(b.maxZ).toBeGreaterThanOrEqual(w.z + w.radius);
    }
  });
});
