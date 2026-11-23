// The cave-mouth collar (render/cut_cavity_core.ts RIM_COLLAR): where the
// marched wall is clipped at the terrain surface, a horizontal band hangs
// just under the ground around the opening so the strip between the wall's
// rim and the terrain's exact cut contour never shows daylight (SPACEY,
// 2026-09-18: "the caves have this really bad gap seams clean up the seams").

import { describe, expect, it } from 'vitest';
import { buildCavityMesh, clusterCavityMesh } from '../src/render/cut_cavity_core';
import { carveFieldAt } from '../src/sim/terrain_cuts';
import type { TerrainCut } from '../src/sim/types';

// A sphere whose top pierces a flat surface at y = 0: a round mouth.
const PIT: TerrainCut = { x: 0, y: -3, z: 0, radius: 5, carve: true };
const fieldAt = (x: number, y: number, z: number): number =>
  carveFieldAt([PIT], undefined, x, y, z);
const SURFACE = 0;

function grid(cell: number) {
  const half = 7;
  const n = Math.ceil((half * 2) / cell);
  return {
    x0: -half,
    y0: -3 - half,
    z0: -half,
    cell,
    nx: n,
    ny: n,
    nz: n,
    fieldAt,
    heightAt: () => SURFACE,
  };
}

describe('cave-mouth collar', () => {
  it('hangs a downward-facing band just under the surface around the rim', () => {
    const mesh = buildCavityMesh(grid(0.5));
    expect(mesh).not.toBeNull();
    const m = mesh!;
    const count = m.positions.length / 3;
    const collarStart = m.collarVertexStart ?? count;
    expect(collarStart).toBeGreaterThan(0);
    expect(collarStart).toBeLessThan(count);
    // wall vertices still sit on the field's zero set (below the clip)
    for (let v = 0; v < collarStart; v++) {
      const d = fieldAt(m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2]);
      expect(Math.abs(d)).toBeLessThan(0.03);
    }
    // collar vertices: sunk 0.06 under the surface, normal straight down,
    // and OUTSIDE the mouth (further from the axis than the wall's rim)
    let rimRadius = 0;
    for (let v = 0; v < collarStart; v++) {
      if (m.positions[v * 3 + 1] > SURFACE - 0.1) {
        rimRadius = Math.max(rimRadius, Math.hypot(m.positions[v * 3], m.positions[v * 3 + 2]));
      }
    }
    expect(rimRadius).toBeGreaterThan(3.5);
    for (let v = collarStart; v < count; v++) {
      expect(m.positions[v * 3 + 1]).toBeCloseTo(SURFACE - 0.06, 5);
      expect(m.normals[v * 3 + 1]).toBe(-1);
      const r = Math.hypot(m.positions[v * 3], m.positions[v * 3 + 2]);
      expect(r).toBeGreaterThan(rimRadius - 0.3);
      expect(r).toBeLessThan(rimRadius + 0.5);
    }
  });

  it('winds every collar triangle to face down', () => {
    const m = buildCavityMesh(grid(0.5))!;
    const collarStart = m.collarVertexStart ?? 0;
    let collarTris = 0;
    for (let t = 0; t < m.indices.length; t += 3) {
      const a = m.indices[t];
      const b = m.indices[t + 1];
      const c = m.indices[t + 2];
      if (a < collarStart && b < collarStart && c < collarStart) continue;
      collarTris++;
      const ax = m.positions[a * 3];
      const ay = m.positions[a * 3 + 1];
      const az = m.positions[a * 3 + 2];
      const ux = m.positions[b * 3] - ax;
      const uy = m.positions[b * 3 + 1] - ay;
      const uz = m.positions[b * 3 + 2] - az;
      const vx = m.positions[c * 3] - ax;
      const vy = m.positions[c * 3 + 1] - ay;
      const vz = m.positions[c * 3 + 2] - az;
      const ny = uz * vx - ux * vz;
      void uy;
      void vy;
      expect(ny).toBeLessThanOrEqual(1e-9);
    }
    expect(collarTris).toBeGreaterThan(20);
  });

  it('survives the vertex clustering pass unmerged', () => {
    const raw = buildCavityMesh(grid(0.5))!;
    const clustered = clusterCavityMesh(raw, 1.5, { x0: -7, y0: -10, z0: -7, size: 14 });
    const count = clustered.positions.length / 3;
    const collarCount = raw.positions.length / 3 - (raw.collarVertexStart ?? 0);
    const clusteredStart = clustered.collarVertexStart ?? count;
    expect(clusteredStart).toBe(count - collarCount);
    for (let v = clusteredStart; v < count; v++) {
      expect(clustered.positions[v * 3 + 1]).toBeCloseTo(SURFACE - 0.06, 5);
    }
  });

  it('adds no collar to a fully buried carve', () => {
    const buried = buildCavityMesh({ ...grid(0.5), heightAt: () => 6 })!;
    expect(buried.collarVertexStart).toBe(buried.positions.length / 3);
  });
});
