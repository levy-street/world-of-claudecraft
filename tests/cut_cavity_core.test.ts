import { describe, expect, it } from 'vitest';
import { buildCavityMesh } from '../src/render/cut_cavity_core';
import { carveFieldAt } from '../src/sim/terrain_cuts';
import type { TerrainCut } from '../src/sim/types';

// The carve interior mesher: marching tetrahedra over the SAME field the sim
// stands on, clipped to below the terrain surface.

const SPHERE: TerrainCut = { x: 0, y: -6, z: 0, radius: 5, carve: true };
const fieldAt = (x: number, y: number, z: number): number =>
  carveFieldAt([SPHERE], undefined, x, y, z);

function grid(cell: number, half: number, heightAt: (x: number, z: number) => number) {
  const n = Math.ceil((half * 2) / cell);
  return {
    x0: -half,
    y0: -6 - half,
    z0: -half,
    cell,
    nx: n,
    ny: n,
    nz: n,
    fieldAt,
    heightAt,
  };
}

describe('buildCavityMesh (render/cut_cavity_core.ts)', () => {
  it('meshes a buried sphere: every vertex sits on the field zero set', () => {
    const mesh = buildCavityMesh(grid(0.5, 7, () => 3));
    expect(mesh).not.toBeNull();
    const count = mesh!.positions.length / 3;
    expect(count).toBeGreaterThan(200);
    for (let v = 0; v < count; v++) {
      const d = fieldAt(
        mesh!.positions[v * 3],
        mesh!.positions[v * 3 + 1],
        mesh!.positions[v * 3 + 2],
      );
      expect(Math.abs(d)).toBeLessThan(0.03);
    }
  });

  it('normals face INTO the cavity (against the field gradient)', () => {
    const mesh = buildCavityMesh(grid(0.5, 7, () => 3))!;
    const count = mesh.positions.length / 3;
    for (let v = 0; v < count; v++) {
      const px = mesh.positions[v * 3];
      const py = mesh.positions[v * 3 + 1];
      const pz = mesh.positions[v * 3 + 2];
      // For a sphere cavity the inward normal points at the centre.
      const toCentre = [0 - px, -6 - py, 0 - pz];
      const dot =
        mesh.normals[v * 3] * toCentre[0] +
        mesh.normals[v * 3 + 1] * toCentre[1] +
        mesh.normals[v * 3 + 2] * toCentre[2];
      expect(dot).toBeGreaterThan(0);
    }
    // Triangles wind to agree with those normals.
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const a = mesh.indices[t] * 3;
      const b = mesh.indices[t + 1] * 3;
      const c = mesh.indices[t + 2] * 3;
      const ux = mesh.positions[b] - mesh.positions[a];
      const uy = mesh.positions[b + 1] - mesh.positions[a + 1];
      const uz = mesh.positions[b + 2] - mesh.positions[a + 2];
      const vx = mesh.positions[c] - mesh.positions[a];
      const vy = mesh.positions[c + 1] - mesh.positions[a + 1];
      const vz = mesh.positions[c + 2] - mesh.positions[a + 2];
      const dot =
        (uy * vz - uz * vy) * mesh.normals[a] +
        (uz * vx - ux * vz) * mesh.normals[a + 1] +
        (ux * vy - uy * vx) * mesh.normals[a + 2];
      expect(dot).toBeGreaterThanOrEqual(0);
    }
  });

  it('clips to below the terrain surface', () => {
    // Surface at -6 slices the sphere through its centre: only the lower bowl
    // survives, and nothing pokes more than a whisker above the plane.
    const mesh = buildCavityMesh(grid(0.5, 7, () => -6))!;
    const count = mesh.positions.length / 3;
    let minY = Infinity;
    for (let v = 0; v < count; v++) {
      const y = mesh.positions[v * 3 + 1];
      expect(y).toBeLessThanOrEqual(-6 + 0.05 + 1e-6);
      minY = Math.min(minY, y);
    }
    expect(minY).toBeLessThan(-10.5); // the bowl still reaches the bottom
  });

  it('returns null when the grid never crosses the surface', () => {
    expect(
      buildCavityMesh({
        x0: 40,
        y0: 40,
        z0: 40,
        cell: 1,
        nx: 4,
        ny: 4,
        nz: 4,
        fieldAt,
        heightAt: () => 100,
      }),
    ).toBeNull();
  });

  it('adjacent tiles at the same alignment share identical border crossings', () => {
    const heightAt = (): number => 3;
    const left = buildCavityMesh({
      x0: -8,
      y0: -14,
      z0: -8,
      cell: 0.5,
      nx: 16,
      ny: 32,
      nz: 32,
      fieldAt,
      heightAt,
    })!;
    const right = buildCavityMesh({
      x0: 0,
      y0: -14,
      z0: -8,
      cell: 0.5,
      nx: 16,
      ny: 32,
      nz: 32,
      fieldAt,
      heightAt,
    })!;
    const border = (m: { positions: Float32Array }): string[] => {
      const out: string[] = [];
      for (let v = 0; v < m.positions.length / 3; v++) {
        if (Math.abs(m.positions[v * 3]) < 1e-6) {
          out.push(`${m.positions[v * 3 + 1].toFixed(4)}:${m.positions[v * 3 + 2].toFixed(4)}`);
        }
      }
      // Duplicates are fine (a clip vertex can land on an edge vertex); a
      // CRACK would be a position present on one side and absent on the other.
      return [...new Set(out)].sort();
    };
    const lb = border(left);
    const rb = border(right);
    expect(lb.length).toBeGreaterThan(4);
    expect(lb).toEqual(rb);
  });
});
