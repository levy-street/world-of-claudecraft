import { describe, expect, it } from 'vitest';
import {
  applyCmGizmo,
  type CmMesh,
  cmBox,
  cmCylinder,
  cmSphere,
  cmWedge,
  convexHull2,
  deleteMeshComponents,
  extrudeEdge,
  extrudeFace,
  faceNormal,
  faceVerts,
  featureEdges,
  fillMeshSelection,
  insetMeshFace,
  loopCut,
  meshBounds,
  meshFromHitbox,
  meshToHitboxes,
  meshToRamp,
  minAreaRect,
  mirrorMesh,
  polyFaces,
  quadFaces,
  sanitizeCmMesh,
  subdivideMesh,
  vertsCentroid,
  weldMeshVertices,
} from '../src/editor/cm_mesh';
import {
  dynamicRemeshCmMesh,
  sculptCmMesh,
  sculptCmMeshSymmetric,
} from '../src/editor/cm_mesh_sculpt_core';

// Every interior edge is shared by exactly 2 triangles (a closed, crack-free
// surface); boundary edges (open meshes) are shared by 1.
function edgeUseCounts(m: CmMesh): Map<string, number> {
  const c = new Map<string, number>();
  for (let t = 0; t < m.tris.length / 3; t++) {
    for (let e = 0; e < 3; e++) {
      const a = m.tris[t * 3 + e];
      const b = m.tris[t * 3 + ((e + 1) % 3)];
      const k = a < b ? `${a}:${b}` : `${b}:${a}`;
      c.set(k, (c.get(k) ?? 0) + 1);
    }
  }
  return c;
}
const isWatertight = (m: CmMesh): boolean => [...edgeUseCounts(m).values()].every((n) => n === 2);

describe('primitives', () => {
  it('box has 8 verts, 12 tris, 12 feature edges, 6 faces', () => {
    const m = cmBox(1, 1, 1, 1);
    expect(m.verts.length / 3).toBe(8);
    expect(m.tris.length / 3).toBe(12);
    expect(featureEdges(m).length).toBe(12);
    expect(polyFaces(m).length).toBe(6);
  });

  it('cylinder is a true triangulated prism: 2N+2 verts, 4N tris', () => {
    const m = cmCylinder(1, 2, 1, 12);
    expect(m.verts.length / 3).toBe(26);
    expect(m.tris.length / 3).toBe(48);
    // Feature edges: N vertical + 2N ring = 3N (cap fans are coplanar-hidden).
    expect(featureEdges(m).length).toBe(36);
    // Faces: N sides + 2 caps.
    expect(polyFaces(m).length).toBe(14);
    const { min, max } = meshBounds(m);
    expect(min[1]).toBeCloseTo(0);
    expect(max[1]).toBeCloseTo(2);
  });

  it('wedge is a 6-vert prism with a slope', () => {
    const m = cmWedge(2, 1.5, 1);
    expect(m.verts.length / 3).toBe(6);
    expect(m.tris.length / 3).toBe(8);
    expect(polyFaces(m).length).toBe(5);
  });

  it('sphere triangulates closed', () => {
    const m = cmSphere(1, 1);
    // Closed manifold: every edge is shared by exactly 2 tris => feature edge
    // detection never sees a boundary edge.
    expect(m.tris.length % 3).toBe(0);
    expect(meshBounds(m).max[1]).toBeCloseTo(2);
  });
});

describe('editing', () => {
  it('moving one vertex moves ONLY that vertex', () => {
    const m = cmBox(1, 1, 1, 1);
    const next = applyCmGizmo(m, [3], [0, 1, 0], { dx: 0.5, dy: 0.25 });
    for (let i = 0; i < 8; i++) {
      const dx = next.verts[i * 3] - m.verts[i * 3];
      const dy = next.verts[i * 3 + 1] - m.verts[i * 3 + 1];
      if (i === 3) {
        expect(dx).toBeCloseTo(0.5);
        expect(dy).toBeCloseTo(0.25);
      } else {
        expect(dx).toBe(0);
        expect(dy).toBe(0);
      }
    }
  });

  it('rotates selected verts around the pivot (yaw)', () => {
    const m = cmBox(1, 1, 1, 0);
    const all = Array.from({ length: 8 }, (_, i) => i);
    const next = applyCmGizmo(m, all, [0, 0, 0], { dRotY: Math.PI / 2 });
    // (1,z) -> model = R(a)·p with model x = x cos + z sin: (1,-1) -> (-1,-1)
    const c = vertsCentroid(next);
    expect(c[0]).toBeCloseTo(0);
    expect(c[2]).toBeCloseTo(0);
    const r = Math.hypot(next.verts[0], next.verts[2]);
    expect(r).toBeCloseTo(Math.SQRT2);
  });

  it('scales from the pivot on one axis', () => {
    const m = cmBox(1, 1, 1, 1);
    const all = Array.from({ length: 8 }, (_, i) => i);
    const next = applyCmGizmo(m, all, [0, 1, 0], { ratio: 2, axis: 'x' });
    const { min, max } = meshBounds(next);
    expect(max[0]).toBeCloseTo(2);
    expect(min[0]).toBeCloseTo(-2);
    expect(max[2]).toBeCloseTo(1); // z untouched
  });
});

describe('dynamic mesh sculpting', () => {
  it('grab moves only vertices inside the brush falloff', () => {
    const m = cmBox(1, 1, 1, 1);
    const center: [number, number, number] = [m.verts[0], m.verts[1], m.verts[2]];
    const res = sculptCmMesh(m, {
      tool: 'grab',
      center,
      radius: 0.5,
      strength: 0.2,
      offset: [0.2, 0.1, -0.05],
    });
    expect(res.changed).toBe(true);
    expect(res.affectedVerts).toEqual([0]);
    expect(res.mesh.verts[0]).toBeCloseTo(m.verts[0] + 0.2);
    expect(res.mesh.verts[1]).toBeCloseTo(m.verts[1] + 0.1);
    expect(res.mesh.verts[2]).toBeCloseTo(m.verts[2] - 0.05);
    expect(res.mesh.verts.slice(3)).toEqual(m.verts.slice(3));
  });

  it('inflate pushes the sphere pole along its averaged surface normal', () => {
    const m = cmSphere(1, 0);
    const top = m.verts.length / 3 - 1;
    const res = sculptCmMesh(m, {
      tool: 'inflate',
      center: [0, 1, 0],
      radius: 0.55,
      strength: 0.2,
    });
    expect(res.affectedVerts).toContain(top);
    expect(res.mesh.verts[top * 3 + 1]).toBeGreaterThan(m.verts[top * 3 + 1]);
  });

  it('smooth reduces a local spike without changing topology', () => {
    const m = cmBox(1, 1, 1, 1);
    m.verts[1] += 2;
    const res = sculptCmMesh(m, {
      tool: 'smooth',
      center: [m.verts[0], m.verts[1], m.verts[2]],
      radius: 0.5,
      strength: 1,
    });
    expect(res.topologyChanged).toBe(false);
    expect(res.mesh.verts[1]).toBeLessThan(m.verts[1]);
    expect(res.mesh.tris).toEqual(m.tris);
  });

  it('splits long brush-region edges without cracking a closed mesh', () => {
    const m = cmBox(1, 1, 1, 1);
    const refined = dynamicRemeshCmMesh(m, {
      center: [0, 1, 0],
      radius: 5,
      targetEdgeLength: 0.65,
      maxCollapses: 0,
    });
    expect(refined.verts.length).toBeGreaterThan(m.verts.length);
    expect(refined.tris.length).toBeGreaterThan(m.tris.length);
    expect(isWatertight(refined)).toBe(true);
    expect(refined.verts.every(Number.isFinite)).toBe(true);
  });

  it('safe edge collapses reduce a dense sphere and preserve its manifold', () => {
    const m = cmSphere(1, 0, 8, 16);
    const relaxed = dynamicRemeshCmMesh(m, {
      center: [0, 0, 0],
      radius: 5,
      targetEdgeLength: 1.25,
      maxSplits: 0,
      maxCollapses: 16,
    });
    expect(relaxed.verts.length).toBeLessThan(m.verts.length);
    expect(isWatertight(relaxed)).toBe(true);
    expect(relaxed.tris.every((v) => v >= 0 && v < relaxed.verts.length / 3)).toBe(true);
  });

  it('pinch, crease, and relax never emit invalid coordinates', () => {
    let m = cmSphere(1, 0);
    for (const tool of ['pinch', 'crease', 'relax'] as const) {
      m = sculptCmMesh(m, {
        tool,
        center: [0, 1, 0],
        radius: 1.2,
        strength: 0.25,
      }).mesh;
    }
    expect(m.verts.every(Number.isFinite)).toBe(true);
    expect(m.tris.every(Number.isInteger)).toBe(true);
  });

  it('adds topology along a long grab stretch', () => {
    const m = cmBox(1, 1, 1, 1);
    const result = sculptCmMesh(m, {
      tool: 'grab',
      center: [-1, 0, -1],
      radius: 0.4,
      strength: 0.2,
      offset: [5, 0, 0],
      dynamicTopology: true,
      targetEdgeLength: 0.4,
    });
    expect(result.topologyChanged).toBe(true);
    expect(result.mesh.verts.length).toBeGreaterThan(m.verts.length);
  });

  it('mirrors a sculpt sample across the selected axes', () => {
    const m = cmSphere(1, 0);
    const result = sculptCmMeshSymmetric(
      m,
      {
        tool: 'inflate',
        center: [0.7, 0, 0],
        radius: 0.7,
        strength: 0.2,
      },
      { x: true, y: false, z: false },
    );
    const xs = result.affectedVerts.map((index) => result.mesh.verts[index * 3]);
    expect(xs.some((x) => x > 0.4)).toBe(true);
    expect(xs.some((x) => x < -0.4)).toBe(true);
  });
});

describe('topology helpers', () => {
  it('faceVerts of a box quad returns 4 verts', () => {
    const m = cmBox(1, 1, 1, 0);
    const faces = polyFaces(m);
    for (const f of faces) expect(faceVerts(m, f).length).toBe(4);
  });

  it('meshFromHitbox honors yaw and offset', () => {
    const m = meshFromHitbox({ x: 2, y: 1, z: -1, hx: 1, hy: 1, hz: 0.5, ry: Math.PI / 2 });
    const c = vertsCentroid(m);
    expect(c[0]).toBeCloseTo(2);
    expect(c[1]).toBeCloseTo(1);
    expect(c[2]).toBeCloseTo(-1);
    const { min, max } = meshBounds(m);
    // Yawed 90deg: the x span now reflects hz, the z span hx.
    expect(max[0] - min[0]).toBeCloseTo(1);
    expect(max[2] - min[2]).toBeCloseTo(2);
  });
});

describe('hull + min-area rect', () => {
  it('hull of a square is its corners', () => {
    const hull = convexHull2([
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0.5, 0.5],
    ]);
    expect(hull.length).toBe(4);
  });

  it('min-area rect recovers a yawed rectangle', () => {
    // A 2x1 rectangle yawed 30deg (MapHitbox convention: model = R(ry)·local).
    const ry = Math.PI / 6;
    const c = Math.cos(ry);
    const s = Math.sin(ry);
    const pts: [number, number][] = [];
    for (const [lx, lz] of [
      [-2, -1],
      [2, -1],
      [2, 1],
      [-2, 1],
    ]) {
      pts.push([lx * c + lz * s, -lx * s + lz * c]);
    }
    const rect = minAreaRect(pts);
    expect(rect).not.toBeNull();
    if (!rect) return;
    const dims = [rect.hx, rect.hz].sort((a, b) => a - b);
    expect(dims[0]).toBeCloseTo(1, 3);
    expect(dims[1]).toBeCloseTo(2, 3);
  });
});

describe('meshToHitboxes decomposition', () => {
  it('an untouched box comes back as exactly one matching box', () => {
    const boxes = meshToHitboxes(cmBox(1.5, 1, 0.75, 1));
    expect(boxes.length).toBe(1);
    expect(boxes[0].hx).toBeCloseTo(1.5, 2);
    expect(boxes[0].hy).toBeCloseTo(1, 2);
    expect(boxes[0].hz).toBeCloseTo(0.75, 2);
    expect(boxes[0].y).toBeCloseTo(1, 2);
    expect(boxes[0].ry ?? 0).toBeCloseTo(0, 2);
  });

  it('a yawed box round-trips through mesh decomposition', () => {
    const src = { x: 1, y: 1, z: 2, hx: 2, hy: 1, hz: 0.5, ry: 0.6 };
    const boxes = meshToHitboxes(meshFromHitbox(src));
    expect(boxes.length).toBe(1);
    const b = boxes[0];
    expect(b.x).toBeCloseTo(1, 2);
    expect(b.z).toBeCloseTo(2, 2);
    const dims = [b.hx, b.hz].sort((a, c) => a - c);
    expect(dims[0]).toBeCloseTo(0.5, 2);
    expect(dims[1]).toBeCloseTo(2, 2);
    // Yaw matches mod pi (a rect is symmetric under half turns), sign-aware
    // via the round trip: rebuilding a mesh from the result must cover the
    // same footprint.
    const again = meshToHitboxes(meshFromHitbox(b));
    expect(again.length).toBe(1);
    expect(again[0].hx).toBeCloseTo(b.hx, 2);
    expect(again[0].hz).toBeCloseTo(b.hz, 2);
  });

  it('a cylinder decomposes to crossed squares (round detection)', () => {
    const boxes = meshToHitboxes(cmCylinder(1, 2, 1, 12));
    expect(boxes.length).toBe(2);
    expect(boxes[0].hx).toBeCloseTo(boxes[0].hz, 3);
    const dRy = Math.abs((boxes[1].ry ?? 0) - (boxes[0].ry ?? 0));
    expect(dRy).toBeCloseTo(Math.PI / 4, 2);
    // The pair is sized by REACH, not by the radius: crossed squares of half
    // side s reach s * sqrt(2) at their eight corners and s / cos(22.5 deg) at
    // their narrowest, so a side that hugs a radius-1 section sits well under 1.
    // (This is the fit crossedSquareSide balances; a side near the radius, as
    // the old flat `rad * 0.92` gave, would bulge ~30% past the drawn section.)
    const narrowest = boxes[0].hx / Math.cos(Math.PI / 8); // reach at 22.5 deg
    const widest = boxes[0].hx * Math.SQRT2; // reach at a corner
    expect(narrowest).toBeLessThan(1);
    expect(widest).toBeGreaterThan(1);
    // Balanced: the pair runs as far outside the section as it does inside.
    expect(widest - 1).toBeCloseTo(1 - narrowest, 1);
    // ...which puts the side well under the radius, unlike the old flat 0.92.
    expect(boxes[0].hx).toBeLessThan(0.85);
  });

  it('a wedge decomposes into rising steps (walkable ramp)', () => {
    const boxes = meshToHitboxes(cmWedge(2, 1.6, 1));
    expect(boxes.length).toBeGreaterThanOrEqual(2);
    // Sorted by band: higher bands sit on shorter x spans (the slope narrows).
    for (let i = 1; i < boxes.length; i++) {
      expect(boxes[i].y).toBeGreaterThan(boxes[i - 1].y);
      expect(boxes[i].hx).toBeLessThan(boxes[i - 1].hx + 1e-6);
    }
  });

  it('one moved vertex still produces a covering decomposition', () => {
    const m = applyCmGizmo(cmBox(1, 1, 1, 1), [7], [0, 1, 0], { dx: 1.5 });
    const boxes = meshToHitboxes(m);
    expect(boxes.length).toBeGreaterThanOrEqual(1);
    // The stretched corner must fall inside some box's XZ footprint.
    const px = m.verts[7 * 3];
    const pz = m.verts[7 * 3 + 2];
    const covered = boxes.some((b) => {
      const c = Math.cos(b.ry ?? 0);
      const s = Math.sin(b.ry ?? 0);
      const dx = px - b.x;
      const dz = pz - b.z;
      // Into the box frame (inverse of model = R(ry)·local).
      const lx = dx * c - dz * s;
      const lz = dx * s + dz * c;
      return Math.abs(lx) <= b.hx + 0.05 && Math.abs(lz) <= b.hz + 0.05;
    });
    expect(covered).toBe(true);
  });
});

describe('sanitize', () => {
  it('accepts a valid mesh and rejects malformed ones', () => {
    const m = cmBox(1, 1, 1, 0);
    expect(sanitizeCmMesh(m)).not.toBeNull();
    expect(sanitizeCmMesh({ verts: [0, 0], tris: [] })).toBeNull();
    expect(sanitizeCmMesh({ verts: m.verts, tris: [99, 0, 1] })).toBeNull();
    expect(
      sanitizeCmMesh({ verts: [...m.verts.slice(0, -1), Number.NaN], tris: m.tris }),
    ).toBeNull();
    expect(sanitizeCmMesh(null)).toBeNull();
  });

  it('preserves the walkable-ramp flag', () => {
    const m = cmWedge(2, 1.5, 1);
    expect(sanitizeCmMesh({ ...m, ramp: true })?.ramp).toBe(true);
    expect(sanitizeCmMesh(m)?.ramp).toBeUndefined();
  });
});

describe('meshToRamp', () => {
  it('a wedge fits a deck rising along +X from its base to its top edge', () => {
    const r = meshToRamp(cmWedge(2, 1.5, 1));
    expect(r).not.toBeNull();
    if (!r) return;
    expect(r.hx).toBeCloseTo(2, 3);
    expect(r.hz).toBeCloseTo(1, 3);
    expect(r.y0).toBeCloseTo(0, 3); // low end walks in at the ground
    expect(r.y1).toBeCloseTo(1.5, 3); // high end tops out at the wedge height
    expect(r.ry ?? 0).toBeCloseTo(0, 3);
  });

  it('a yawed wedge keeps its rise direction (deck height tracks the mesh)', () => {
    const base = cmWedge(2, 1.5, 1);
    const all = Array.from({ length: base.verts.length / 3 }, (_, i) => i);
    const yawed = applyCmGizmo(base, all, [0, 0, 0], { dRotY: Math.PI });
    const r = meshToRamp(yawed);
    expect(r).not.toBeNull();
    if (!r) return;
    // Representation-independent contract: the deck surface height at a model
    // point. After the half turn the wedge tops out at x=-2 and grounds at
    // x=+2, whatever frame the fitter picked.
    const deckAt = (X: number, Z: number): number => {
      const c = Math.cos(r.ry ?? 0);
      const s = Math.sin(r.ry ?? 0);
      const u = (X - r.x) * c - (Z - r.z) * s;
      const t = Math.min(1, Math.max(0, (u + r.hx) / (2 * r.hx)));
      return r.y0 + (r.y1 - r.y0) * t;
    };
    expect(deckAt(-2, 0)).toBeCloseTo(1.5, 3);
    expect(deckAt(2, 0)).toBeCloseTo(0, 3);
    expect(deckAt(0, 0)).toBeCloseTo(0.75, 3);
  });

  it('a flat box fits a level platform deck at its top', () => {
    const r = meshToRamp(cmBox(2, 0.5, 1, 0.5));
    expect(r).not.toBeNull();
    if (!r) return;
    expect(r.y0).toBeCloseTo(1, 3);
    expect(r.y1).toBeCloseTo(1, 3);
  });
});

describe('quadFaces + loop cut', () => {
  it('a box has 6 quad faces', () => {
    expect(quadFaces(cmBox(1, 1, 1, 1)).length).toBe(6);
  });

  it('loop-cutting a vertical box edge inserts a horizontal ring (watertight)', () => {
    const box = cmBox(1, 1, 1, 1); // 8 verts, 12 tris; watertight
    expect(isWatertight(box)).toBe(true);
    // A vertical edge: verts 0 (y-,z-,x-) and 4 (y+,z-,x-), see cmBox order.
    const res = loopCut(box, 0, 4);
    expect(res).not.toBeNull();
    if (!res) return;
    // 4 side quads crossed -> 4 new midpoint verts on the vertical ring.
    expect(res.newVerts.length).toBe(4);
    expect(res.mesh.verts.length / 3).toBe(12); // 8 + 4
    expect(isWatertight(res.mesh)).toBe(true);
    // The shape is geometrically identical (only tessellated): same collision.
    const before = meshToHitboxes(box);
    const after = meshToHitboxes(res.mesh);
    expect(after).toEqual(before);
  });

  it('sliding the loop verts up grows the mesh only above the cut line', () => {
    const box = cmBox(1, 1, 1, 1);
    const res = loopCut(box, 0, 4, 0.5);
    if (!res) return;
    const b0 = meshBounds(res.mesh);
    // Move the ring verts up by 5: the top half stretches, bounds max Y grows.
    const moved = applyCmGizmo(res.mesh, res.newVerts, vertsCentroid(res.mesh, res.newVerts), {
      dy: 5,
    });
    const b1 = meshBounds(moved);
    expect(b1.max[1]).toBeGreaterThan(b0.max[1]);
  });

  it('returns null for a non-quad (cap/degenerate) edge pick', () => {
    // A sphere cap edge is a triangle fan, not a quad ring.
    const sphere = cmSphere(1, 1);
    // Pick two arbitrary adjacent verts that are not a quad cycle edge.
    expect(loopCut(sphere, 0, 1)).toBeNull();
    // A bogus edge on a box (a face diagonal, not a cycle edge) -> null.
    expect(loopCut(cmBox(1, 1, 1, 1), 0, 7)).toBeNull();
  });

  it('loop-cuts a cylinder wall (adds a horizontal ring), preserving watertightness', () => {
    const cyl = cmCylinder(1, 2, 1);
    const before = quadFaces(cyl).length;
    expect(before).toBeGreaterThan(0);
    // A vertical wall edge: ring vert i (bottom) to i+seg (top).
    const seg = 12;
    const res = loopCut(cyl, 0, seg);
    expect(res).not.toBeNull();
    if (!res) return;
    expect(res.newVerts.length).toBe(seg); // one midpoint per wall panel
    expect(isWatertight(res.mesh)).toBe(true);
  });
});

describe('poly build: extrude', () => {
  it('extruding a box top face adds a 4-vert cap + 4 side walls', () => {
    const box = cmBox(1, 1, 1, 1);
    // The top face is the coplanar group with all verts at max Y.
    const groups = polyFaces(box);
    const top = groups.find((g) => {
      const vs = faceVerts(box, g);
      return vs.every((v) => Math.abs(box.verts[v * 3 + 1] - 2) < 1e-6);
    });
    expect(top).toBeDefined();
    if (!top) return;
    const res = extrudeFace(box, top);
    expect(res).not.toBeNull();
    if (!res) return;
    expect(res.newVerts.length).toBe(4); // 4 duplicated cap verts
    expect(res.mesh.verts.length / 3).toBe(12); // 8 + 4
    // +8 side tris (4 boundary edges * 2), cap count unchanged (retargeted).
    expect(res.mesh.tris.length / 3).toBe(box.tris.length / 3 + 8);
    // Bounds unchanged until the new cap is moved.
    expect(meshBounds(res.mesh).max[1]).toBeCloseTo(2, 6);
    // Move the cap up: the mesh grows.
    const moved = applyCmGizmo(res.mesh, res.newVerts, vertsCentroid(res.mesh, res.newVerts), {
      dy: 3,
    });
    expect(meshBounds(moved).max[1]).toBeCloseTo(5, 6);
  });

  it('face normal points outward (+Y for the box top)', () => {
    const box = cmBox(1, 1, 1, 1);
    const top = polyFaces(box).find((g) =>
      faceVerts(box, g).every((v) => Math.abs(box.verts[v * 3 + 1] - 2) < 1e-6),
    );
    if (!top) return;
    const n = faceNormal(box, top);
    expect(n[1]).toBeGreaterThan(0.9);
  });

  it('extrudeEdge adds two verts and a quad', () => {
    const box = cmBox(1, 1, 1, 1);
    const res = extrudeEdge(box, 0, 1);
    expect(res).not.toBeNull();
    if (!res) return;
    expect(res.newVerts.length).toBe(2);
    expect(res.mesh.verts.length / 3).toBe(10);
  });
});

describe('Blender-style topology operations', () => {
  it('deletes a selected face without deleting the whole volume', () => {
    const box = cmBox(1, 1, 1, 1);
    const top = polyFaces(box).find((group) =>
      faceVerts(box, group).every((v) => Math.abs(box.verts[v * 3 + 1] - 2) < 1e-6),
    );
    if (!top) return;
    const result = deleteMeshComponents(box, 'face', faceVerts(box, top));
    expect(result).not.toBeNull();
    expect(result?.tris.length).toBe(box.tris.length - top.length * 3);
    expect(result && isWatertight(result)).toBe(false);
  });

  it('welds two vertices at their centroid and drops degenerate triangles', () => {
    const box = cmBox(1, 1, 1, 1);
    const result = weldMeshVertices(box, [0, 1]);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.mesh.verts.length / 3).toBeLessThan(box.verts.length / 3);
    expect(result.mesh.tris.length / 3).toBeLessThan(box.tris.length / 3);
    expect(sanitizeCmMesh(result.mesh)).not.toBeNull();
  });

  it('subdivides every triangle with shared edge midpoints', () => {
    const box = cmBox(1, 1, 1, 1);
    const result = subdivideMesh(box);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.mesh.tris.length).toBe(box.tris.length * 4);
    expect(isWatertight(result.mesh)).toBe(true);
  });

  it('insets a selected quad face with a connected border ring', () => {
    const box = cmBox(1, 1, 1, 1);
    const top = polyFaces(box).find((group) =>
      faceVerts(box, group).every((v) => Math.abs(box.verts[v * 3 + 1] - 2) < 1e-6),
    );
    if (!top) return;
    const result = insetMeshFace(box, faceVerts(box, top));
    expect(result).not.toBeNull();
    expect(result?.newVerts).toHaveLength(4);
    expect(result && isWatertight(result.mesh)).toBe(true);
  });

  it('fills a selected planar boundary and mirrors with reversed winding', () => {
    const open: CmMesh = {
      verts: [-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1],
      tris: [0, 1, 2],
    };
    const filled = fillMeshSelection(open, [0, 1, 2, 3]);
    expect(filled?.tris.length).toBe(open.tris.length + 6);
    const mirrored = mirrorMesh(cmWedge(1, 1, 1), 'x');
    expect(mirrored?.mesh.verts.length).toBe(cmWedge(1, 1, 1).verts.length * 2);
    expect(mirrored?.mesh.tris.length).toBe(cmWedge(1, 1, 1).tris.length * 2);
  });
});
