import { describe, expect, it } from 'vitest';
import { voxelDensity } from '../src/sim/voxel';
import { meshVoxelChunk } from '../src/sim/voxel_mesh';

// A synthetic sphere density field (independent of terrain/tunnels) makes the
// seam assertion exact and easy to reason about: solid inside radius 5.
const sphereDensity = (x: number, y: number, z: number) => Math.hypot(x, y, z) - 5;

describe('voxel mesher', () => {
  it('produces a non-empty, deterministic mesh for a chunk crossing the sphere surface', () => {
    const bounds = { x0: -8, y0: -8, z0: -8, size: 16, resolution: 12 };
    const a = meshVoxelChunk(sphereDensity, bounds);
    const b = meshVoxelChunk(sphereDensity, bounds);
    expect(a.positions.length).toBeGreaterThan(0);
    expect(a.indices.length % 3).toBe(0);
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    expect(Array.from(a.indices)).toEqual(Array.from(b.indices));
  });

  it('normals point outward from the sphere center (regression for the inverted gradient bug)', () => {
    const bounds = { x0: -8, y0: -8, z0: -8, size: 16, resolution: 12 };
    const mesh = meshVoxelChunk(sphereDensity, bounds);
    expect(mesh.positions.length).toBeGreaterThan(0);
    for (let i = 0; i < mesh.positions.length / 3; i++) {
      const px = mesh.positions[i * 3];
      const py = mesh.positions[i * 3 + 1];
      const pz = mesh.positions[i * 3 + 2];
      const nx = mesh.normals[i * 3];
      const ny = mesh.normals[i * 3 + 1];
      const nz = mesh.normals[i * 3 + 2];
      expect(nx * px + ny * py + nz * pz).toBeGreaterThan(0);
    }
  });

  it('produces no vertices for a chunk entirely inside or outside the surface', () => {
    const insideBounds = { x0: -1, y0: -1, z0: -1, size: 2, resolution: 4 };
    const outsideBounds = { x0: 100, y0: 100, z0: 100, size: 2, resolution: 4 };
    expect(meshVoxelChunk(sphereDensity, insideBounds).positions.length).toBe(0);
    expect(meshVoxelChunk(sphereDensity, outsideBounds).positions.length).toBe(0);
  });

  // Counts triangles that bridge the x=0 plane (at least one vertex on each
  // side): the decisive signal for "is this shared face actually covered."
  function bridgingTriangleCount(mesh: ReturnType<typeof meshVoxelChunk>): number {
    let count = 0;
    for (let i = 0; i < mesh.indices.length; i += 3) {
      let hasNeg = false;
      let hasPos = false;
      for (let v = 0; v < 3; v++) {
        const x = mesh.positions[mesh.indices[i + v] * 3];
        if (x < 0) hasNeg = true;
        if (x > 0) hasPos = true;
      }
      if (hasNeg && hasPos) count++;
    }
    return count;
  }

  it('exact-abutting chunks crack: no triangle in either chunk bridges the shared face', () => {
    // Two 8-unit chunks sharing the x=0 boundary face, both crossing the sphere.
    const left = meshVoxelChunk(sphereDensity, { x0: -8, y0: -8, z0: -8, size: 8, resolution: 8 });
    const right = meshVoxelChunk(sphereDensity, { x0: 0, y0: -8, z0: -8, size: 8, resolution: 8 });
    // Each chunk only walks its own interior cell edges, so a quad whose four
    // cells straddle x=0 is emitted by neither side: the crack the
    // module-level comment in voxel_mesh.ts must describe accurately.
    expect(bridgingTriangleCount(left)).toBe(0);
    expect(bridgingTriangleCount(right)).toBe(0);
  });

  it('overlap-padded chunks seal the seam: triangles bridge the shared face', () => {
    // Same two chunks, each padded one voxel cell (step = size/resolution = 1)
    // past its own bounds into the neighbor's territory, exactly as
    // `voxel_terrain.ts` does. The overlap band now contains real quads that
    // cross x=0, closing the crack asserted above.
    const leftPadded = meshVoxelChunk(sphereDensity, {
      x0: -8,
      y0: -8,
      z0: -8,
      size: 9,
      resolution: 9,
    });
    const rightPadded = meshVoxelChunk(sphereDensity, {
      x0: -1,
      y0: -8,
      z0: -8,
      size: 9,
      resolution: 9,
    });
    expect(bridgingTriangleCount(leftPadded) + bridgingTriangleCount(rightPadded)).toBeGreaterThan(
      0,
    );
  });

  it('exercises the real terrain+tunnel density field without throwing', () => {
    const seed = 1;
    const mesh = meshVoxelChunk((x, y, z) => voxelDensity(x, y, z, seed), {
      x0: 56,
      y0: -12,
      z0: 146,
      size: 32,
      resolution: 16,
    });
    expect(mesh.positions.length).toBeGreaterThan(0);
  });
});
