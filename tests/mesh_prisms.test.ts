import { describe, expect, it } from 'vitest';
import { cmBox, cmCylinder, cmSphere, cmWedge } from '../src/editor/cm_mesh';
import {
  type CollisionPrism,
  convexHullXZ,
  MAX_MESH_PRISMS,
  meshToPrisms,
  polyArea,
} from '../src/sim/mesh_prisms';

/** Is (x, z) inside a prism's outline at height y? Mirrors insidePrism in
 *  sim/colliders.ts (counter-clockwise outline, interior on the left). */
function insidePrism(p: CollisionPrism, x: number, y: number, z: number): boolean {
  if (y < p.y0 || y > p.y1) return false;
  // Height-aware, mirroring colliders.ts prismPolyAt: a lofted band collides
  // as the interpolated section at this height, not as its union hull.
  let poly: readonly number[] = p.poly;
  if (p.polyLo && p.polyHi && p.polyLo.length === p.poly.length && p.y1 - p.y0 > 1e-9) {
    const t = (y - p.y0) / (p.y1 - p.y0);
    const lerped: number[] = [];
    for (let i = 0; i < p.polyLo.length; i++) {
      lerped.push(p.polyLo[i] + (p.polyHi[i] - p.polyLo[i]) * t);
    }
    poly = lerped;
  }
  const n = poly.length;
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n;
    const ax = poly[i];
    const az = poly[i + 1];
    const ex = poly[j] - ax;
    const ez = poly[j + 1] - az;
    if ((x - ax) * ez - (z - az) * ex > 1e-9) return false;
  }
  return true;
}

/** Point-in-mesh by +X ray parity (the volumes are closed). */
function insideMesh(
  m: { verts: readonly number[]; tris: readonly number[] },
  px: number,
  py: number,
  pz: number,
): boolean {
  let crossings = 0;
  for (let t = 0; t < m.tris.length; t += 3) {
    const a = m.tris[t] * 3;
    const b = m.tris[t + 1] * 3;
    const c = m.tris[t + 2] * 3;
    const ay = m.verts[a + 1];
    const by = m.verts[b + 1];
    const cy = m.verts[c + 1];
    const az = m.verts[a + 2];
    const bz = m.verts[b + 2];
    const cz = m.verts[c + 2];
    const d1 = (by - ay) * (pz - az) - (bz - az) * (py - ay);
    const d2 = (cy - by) * (pz - bz) - (cz - bz) * (py - by);
    const d3 = (ay - cy) * (pz - cz) - (az - cz) * (py - cy);
    if ((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0)) continue;
    const den = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
    if (Math.abs(den) < 1e-12) continue;
    const w1 = ((py - ay) * (cz - az) - (pz - az) * (cy - ay)) / den;
    const w2 = ((by - ay) * (pz - az) - (bz - az) * (py - ay)) / den;
    const hit = m.verts[a] + w1 * (m.verts[b] - m.verts[a]) + w2 * (m.verts[c] - m.verts[a]);
    if (hit > px) crossings++;
  }
  return (crossings & 1) === 1;
}

/** Fraction of sampled collider volume that falls OUTSIDE the authored mesh
 *  ("phantom", an invisible wall) and of mesh volume with no collider
 *  ("missing", walking through what you drew), relative to the mesh volume. */
function measureFit(
  mesh: { verts: readonly number[]; tris: readonly number[] },
  prisms: readonly CollisionPrism[],
  step = 0.05,
): { phantom: number; missing: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < mesh.verts.length; i += 3) {
    minX = Math.min(minX, mesh.verts[i]);
    maxX = Math.max(maxX, mesh.verts[i]);
    minY = Math.min(minY, mesh.verts[i + 1]);
    maxY = Math.max(maxY, mesh.verts[i + 1]);
    minZ = Math.min(minZ, mesh.verts[i + 2]);
    maxZ = Math.max(maxZ, mesh.verts[i + 2]);
  }
  const pad = 0.2;
  let inMesh = 0;
  let phantom = 0;
  let missing = 0;
  // Off-lattice start: a sample sitting exactly ON a face is inside the prism
  // but ambiguous for ray parity, which would score a box's own faces as error.
  const jitter = step * 0.371;
  for (let x = minX - pad + jitter; x <= maxX + pad; x += step) {
    for (let y = minY - pad + jitter; y <= maxY + pad; y += step) {
      for (let z = minZ - pad + jitter; z <= maxZ + pad; z += step) {
        const m = insideMesh(mesh, x, y, z);
        const p = prisms.some((pr) => insidePrism(pr, x, y, z));
        if (m) inMesh++;
        if (!m && p) phantom++;
        if (m && !p) missing++;
      }
    }
  }
  return { phantom: phantom / inMesh, missing: missing / inMesh };
}

describe('meshToPrisms', () => {
  it('hulls come back counter-clockwise (the outward-normal convention)', () => {
    const hull = convexHullXZ([
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
      [1, 1],
    ]);
    expect(hull).toHaveLength(4);
    let signed = 0;
    for (let i = 0; i < hull.length; i++) {
      const [ax, az] = hull[i];
      const [bx, bz] = hull[(i + 1) % hull.length];
      signed += ax * bz - bx * az;
    }
    expect(signed).toBeGreaterThan(0);
  });

  it('a box is ONE prism: a straight-sided volume never spends bands', () => {
    const prisms = meshToPrisms(cmBox(1, 2, 0.5, 2));
    expect(prisms).toHaveLength(1);
    expect(prisms[0].y0).toBeCloseTo(0, 4);
    expect(prisms[0].y1).toBeCloseTo(4, 4);
    expect(prisms[0].poly).toHaveLength(8); // 4 corners
    expect(polyArea(prisms[0].poly)).toBeCloseTo(2 * 1, 3); // 2 x 1 footprint
  });

  it('a cylinder keeps its real section instead of a fitted rectangle', () => {
    const prisms = meshToPrisms(cmCylinder(1, 2, 1, 12));
    expect(prisms).toHaveLength(1);
    // A regular 12-gon of circumradius 1, not a 2x2 square: area 3, not 4.
    expect(polyArea(prisms[0].poly)).toBeCloseTo(3, 1);
    const { phantom, missing } = measureFit(cmCylinder(1, 2, 1, 12), prisms);
    expect(phantom).toBeLessThan(0.02);
    expect(missing).toBeLessThan(0.02);
  });

  it('collides within a hair of the authored volume, both directions', () => {
    // LOFTED bands: each band interpolates between its authored end sections
    // (CollisionPrism.polyLo/polyHi), so a linear taper collides EXACTLY as
    // drawn and even the sphere - curvature in both axes, the pathological
    // ceiling for any banded representation - holds a ~2.7% skin at six
    // bands. phantom = collider outside the mesh (invisible wall); missing =
    // mesh outside the collider (walking into what you drew). Both budgets
    // are TIGHT on purpose: the loft rework took the wedge from 30% phantom
    // to 0.3%, and this test exists to keep it there.
    const budget: [
      string,
      { verts: readonly number[]; tris: readonly number[] },
      number,
      number,
    ][] = [
      ['box', cmBox(1, 1, 1, 1), 0.005, 0.005],
      ['cylinder', cmCylinder(0.8, 2.4, 1.2, 12), 0.005, 0.005],
      ['wedge', cmWedge(1, 1.5, 1), 0.02, 0.02],
      // The sphere keeps a thicker under-skin on purpose: under-coverage
      // is tolerated over invisible walls (UNDER_COVER_SLACK), and the
      // asymmetric criterion stops at ~4 lofted bands.
      ['sphere', cmSphere(1, 1), 0.02, 0.12],
    ];
    for (const [name, mesh, maxPhantom, maxMissing] of budget) {
      const { phantom, missing } = measureFit(mesh, meshToPrisms(mesh));
      expect(phantom, `${name} phantom`).toBeLessThan(maxPhantom);
      expect(missing, `${name} missing`).toBeLessThan(maxMissing);
    }
  });

  it('bands a sphere into a handful of lofted segments that tile it', () => {
    const prisms = meshToPrisms(cmSphere(1, 1));
    expect(prisms.length).toBeGreaterThan(1);
    expect(prisms.length).toBeLessThanOrEqual(MAX_MESH_PRISMS);
    // Every band carries a loft (piecewise cone segments of the dome).
    for (const p of prisms) {
      expect(p.polyLo).toBeDefined();
      expect(p.polyHi).toBeDefined();
    }
    // Bands tile the volume with no gap and no overlap.
    for (let i = 1; i < prisms.length; i++) {
      expect(prisms[i].y0).toBeCloseTo(prisms[i - 1].y1, 6);
    }
  });

  it('beats the fitted-rectangle decomposition it replaces', async () => {
    const { meshToHitboxes } = await import('../src/editor/cm_mesh');
    const mesh = cmCylinder(1, 2, 1, 12);
    const boxes = meshToHitboxes(mesh);
    const asPrisms: CollisionPrism[] = boxes.map((b) => {
      const c = Math.cos(b.ry ?? 0);
      const s = Math.sin(b.ry ?? 0);
      const corners: [number, number][] = [];
      for (const [sx, sz] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ] as const) {
        const lx = sx * b.hx;
        const lz = sz * b.hz;
        corners.push([b.x + lx * c + lz * s, b.z - lx * s + lz * c]);
      }
      const poly: number[] = [];
      for (const [px, pz] of convexHullXZ(corners)) poly.push(px, pz);
      return { y0: b.y - b.hy, y1: b.y + b.hy, poly };
    });
    const before = measureFit(mesh, asPrisms);
    const after = measureFit(mesh, meshToPrisms(mesh));
    expect(after.phantom).toBeLessThan(before.phantom);
  });

  it('walkable ramp volumes are never blockers', () => {
    expect(meshToPrisms({ ...cmWedge(1, 1, 1), ramp: true })).toEqual([]);
  });

  it('degenerate input comes back empty instead of throwing', () => {
    expect(meshToPrisms({ verts: [], tris: [] })).toEqual([]);
    expect(meshToPrisms({ verts: [0, 0, 0, 1, 0, 0, 0, 0, 1], tris: [0, 1, 2] })).toEqual([]);
  });
});
