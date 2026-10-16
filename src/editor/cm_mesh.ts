// Collision Master v3 mesh volumes: real editable triangle meshes (Blender
// semantics, moving one vertex moves ONE vertex), with primitives that are
// true triangulated solids (a cylinder is an N-gon prism, not two crossed
// boxes). The sim still walks Y-banded OBBs, so meshes are the EDITOR's truth
// and meshToHitboxes() derives the sim box set at Lock In: the mesh is sliced
// into horizontal bands and each band's convex cross-section gets a min-area
// yawed rectangle (adjacent identical bands merge back, so an untouched box
// stays exactly one box). Pure math, no three.js: Vitest-covered.

import type { AuthoredCollisionRamp, MapHitbox } from '../sim/map_doc';

/** One editable collision volume: flat xyz vertex triplets + CCW-outward
 *  index triplets, in the asset's model space (the CM scene frame).
 *  `ramp` marks a WALKABLE volume: instead of decomposing into blocking
 *  boxes, it locks in as a rising walkable deck (meshToRamp) the player can
 *  walk up, the Wedge primitive defaults to this. */
export interface CmMesh {
  verts: number[];
  tris: number[];
  ramp?: boolean;
}

export type CmComponentMode = 'vertex' | 'edge' | 'face';

/** Mirrors the gizmo's world-delta stream (GizmoHitboxChange), extended with
 *  the X/Z rotation rings meshes unlock (boxes were yaw-only OBBs). */
export interface CmGizmoDelta {
  dx?: number;
  dy?: number;
  dz?: number;
  dRotX?: number;
  dRotY?: number;
  dRotZ?: number;
  ratio?: number;
  axis?: 'x' | 'y' | 'z' | 'uniform';
}

const MAX_COORD = 100;
const MIN_SPAN = 0.02;

const clampC = (v: number): number => Math.max(-MAX_COORD, Math.min(MAX_COORD, v));

// ---- primitives ---------------------------------------------------------------

/** Axis-aligned box: 8 verts, 12 tris. */
export function cmBox(hx: number, hy: number, hz: number, cy: number): CmMesh {
  const verts: number[] = [];
  for (const sy of [-1, 1]) {
    for (const sz of [-1, 1]) {
      for (const sx of [-1, 1]) {
        verts.push(sx * hx, cy + sy * hy, sz * hz);
      }
    }
  }
  // Vert order: y-,z-,x- =0 | y-,z-,x+ =1 | y-,z+,x- =2 | y-,z+,x+ =3 | top +4.
  const q = (a: number, b: number, c: number, d: number): number[] => [a, b, c, a, c, d];
  const tris = [
    ...q(0, 2, 3, 1), // bottom (viewed from below: CCW outward = downward normal)
    ...q(4, 5, 7, 6), // top
    ...q(0, 1, 5, 4), // z- side
    ...q(3, 2, 6, 7), // z+ side
    ...q(0, 4, 6, 2), // x- side
    ...q(1, 3, 7, 5), // x+ side
  ];
  return { verts, tris };
}

/** Thin wall panel: a box with a slim Z span (the old "plane" starter). */
export function cmPlane(hx: number, hy: number, cy: number): CmMesh {
  return cmBox(hx, hy, 0.05, cy);
}

export const CM_CYLINDER_SEGMENTS = 12;

/** TRUE triangulated cylinder: two N-gon rings + cap fans (4N tris). */
export function cmCylinder(r: number, h: number, cy: number, seg = CM_CYLINDER_SEGMENTS): CmMesh {
  const verts: number[] = [];
  const tris: number[] = [];
  const y0 = cy - h / 2;
  const y1 = cy + h / 2;
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    verts.push(Math.cos(a) * r, y0, Math.sin(a) * r);
  }
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    verts.push(Math.cos(a) * r, y1, Math.sin(a) * r);
  }
  const cBot = verts.length / 3;
  verts.push(0, y0, 0);
  const cTop = cBot + 1;
  verts.push(0, y1, 0);
  for (let i = 0; i < seg; i++) {
    const j = (i + 1) % seg;
    // Ring winding runs +X toward +Z, so outward side faces are (i, i+N, j).
    tris.push(i, i + seg, j, j, i + seg, j + seg);
    tris.push(cBot, j, i); // bottom cap faces down
    tris.push(cTop, i + seg, j + seg); // top cap faces up
  }
  return { verts, tris };
}

/** UV sphere approximation (rings x segments), triangles everywhere. */
export function cmSphere(r: number, cy: number, rings = 5, seg = 10): CmMesh {
  const verts: number[] = [0, cy - r, 0];
  for (let ri = 1; ri <= rings; ri++) {
    const phi = (ri / (rings + 1)) * Math.PI - Math.PI / 2; // -90..90 exclusive
    const y = Math.sin(phi) * r;
    const rr = Math.cos(phi) * r;
    for (let si = 0; si < seg; si++) {
      const a = (si / seg) * Math.PI * 2;
      verts.push(Math.cos(a) * rr, cy + y, Math.sin(a) * rr);
    }
  }
  const top = verts.length / 3;
  verts.push(0, cy + r, 0);
  const tris: number[] = [];
  const ring = (ri: number, si: number): number => 1 + ri * seg + (si % seg);
  for (let si = 0; si < seg; si++) tris.push(0, ring(0, si), ring(0, si + 1));
  for (let ri = 0; ri < rings - 1; ri++) {
    for (let si = 0; si < seg; si++) {
      const a = ring(ri, si);
      const b = ring(ri, si + 1);
      const c = ring(ri + 1, si);
      const d = ring(ri + 1, si + 1);
      tris.push(a, c, b, b, c, d);
    }
  }
  for (let si = 0; si < seg; si++) tris.push(top, ring(rings - 1, si + 1), ring(rings - 1, si));
  return { verts, tris };
}

/** Ramp: a triangular prism rising along +X (6 verts, 8 tris). */
export function cmWedge(hx: number, h: number, hz: number): CmMesh {
  const verts = [
    -hx,
    0,
    -hz, // 0 low back
    hx,
    0,
    -hz, // 1 high-side base
    hx,
    0,
    hz, // 2
    -hx,
    0,
    hz, // 3 low front
    hx,
    h,
    -hz, // 4 top edge
    hx,
    h,
    hz, // 5
  ];
  const tris = [
    0,
    3,
    2,
    0,
    2,
    1, // bottom (faces down)
    1,
    2,
    5,
    1,
    5,
    4, // vertical back at x=+hx
    0,
    4,
    5,
    0,
    5,
    3, // slope
    0,
    1,
    4, // z- side triangle
    3,
    5,
    2, // z+ side triangle
  ];
  return { verts, tris };
}

/** A yawed sim hitbox as an editable box mesh (opening existing overrides). */
export function meshFromHitbox(b: MapHitbox): CmMesh {
  const m = cmBox(b.hx, b.hy, b.hz, 0);
  const c = Math.cos(b.ry ?? 0);
  const s = Math.sin(b.ry ?? 0);
  for (let i = 0; i < m.verts.length; i += 3) {
    const x = m.verts[i];
    const z = m.verts[i + 2];
    // three.js rotation.y convention: model = (x cos + z sin, -x sin + z cos).
    m.verts[i] = b.x + x * c + z * s;
    m.verts[i + 1] += b.y;
    m.verts[i + 2] = b.z - x * s + z * c;
  }
  return m;
}

// ---- topology ------------------------------------------------------------------

function triNormal(m: CmMesh, t: number): [number, number, number] {
  const [a, b, c] = [m.tris[t * 3] * 3, m.tris[t * 3 + 1] * 3, m.tris[t * 3 + 2] * 3];
  const ux = m.verts[b] - m.verts[a];
  const uy = m.verts[b + 1] - m.verts[a + 1];
  const uz = m.verts[b + 2] - m.verts[a + 2];
  const vx = m.verts[c] - m.verts[a];
  const vy = m.verts[c + 1] - m.verts[a + 1];
  const vz = m.verts[c + 2] - m.verts[a + 2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

const edgeKey = (a: number, b: number): string => (a < b ? `${a}:${b}` : `${b}:${a}`);

/** edge key -> adjacent tri indices. */
function edgeTriMap(m: CmMesh): Map<string, number[]> {
  const map = new Map<string, number[]>();
  const triCount = m.tris.length / 3;
  for (let t = 0; t < triCount; t++) {
    for (let e = 0; e < 3; e++) {
      const a = m.tris[t * 3 + e];
      const b = m.tris[t * 3 + ((e + 1) % 3)];
      const k = edgeKey(a, b);
      const arr = map.get(k);
      if (arr) arr.push(t);
      else map.set(k, [t]);
    }
  }
  return map;
}

const COPLANAR_DOT = 0.9995;

/** Feature edges (Blender look): tri edges NOT shared by two coplanar tris ,
 *  triangulation diagonals inside flat faces stay hidden. */
export function featureEdges(m: CmMesh): [number, number][] {
  const normals: [number, number, number][] = [];
  for (let t = 0; t < m.tris.length / 3; t++) normals.push(triNormal(m, t));
  const out: [number, number][] = [];
  for (const [key, ts] of edgeTriMap(m)) {
    const coplanar =
      ts.length === 2 &&
      normals[ts[0]][0] * normals[ts[1]][0] +
        normals[ts[0]][1] * normals[ts[1]][1] +
        normals[ts[0]][2] * normals[ts[1]][2] >
        COPLANAR_DOT;
    if (!coplanar) {
      const [a, b] = key.split(':');
      out.push([Number(a), Number(b)]);
    }
  }
  return out;
}

/** Blender "faces": connected coplanar tri groups (a box quad = 2 tris = 1
 *  face). Returns tri-index groups. */
export function polyFaces(m: CmMesh): number[][] {
  const triCount = m.tris.length / 3;
  const normals: [number, number, number][] = [];
  for (let t = 0; t < triCount; t++) normals.push(triNormal(m, t));
  // tri -> coplanar neighbors
  const adj: number[][] = Array.from({ length: triCount }, () => []);
  for (const ts of edgeTriMap(m).values()) {
    if (ts.length !== 2) continue;
    const [a, b] = ts;
    const dot =
      normals[a][0] * normals[b][0] + normals[a][1] * normals[b][1] + normals[a][2] * normals[b][2];
    if (dot > COPLANAR_DOT) {
      adj[a].push(b);
      adj[b].push(a);
    }
  }
  const seen = new Array<boolean>(triCount).fill(false);
  const groups: number[][] = [];
  for (let t = 0; t < triCount; t++) {
    if (seen[t]) continue;
    const group: number[] = [];
    const stack = [t];
    seen[t] = true;
    while (stack.length > 0) {
      const cur = stack.pop();
      if (cur === undefined) break;
      group.push(cur);
      for (const nb of adj[cur]) {
        if (!seen[nb]) {
          seen[nb] = true;
          stack.push(nb);
        }
      }
    }
    groups.push(group);
  }
  return groups;
}

/** Unique vertex indices of a tri group. */
export function faceVerts(m: CmMesh, triGroup: readonly number[]): number[] {
  const set = new Set<number>();
  for (const t of triGroup) {
    set.add(m.tris[t * 3]);
    set.add(m.tris[t * 3 + 1]);
    set.add(m.tris[t * 3 + 2]);
  }
  return [...set];
}

/** Centroid of a vertex subset (or the whole mesh), model space. */
export function vertsCentroid(m: CmMesh, idxs?: readonly number[]): [number, number, number] {
  const list = idxs ?? Array.from({ length: m.verts.length / 3 }, (_, i) => i);
  let x = 0;
  let y = 0;
  let z = 0;
  for (const i of list) {
    x += m.verts[i * 3];
    y += m.verts[i * 3 + 1];
    z += m.verts[i * 3 + 2];
  }
  const n = Math.max(1, list.length);
  return [x / n, y / n, z / n];
}

export function meshBounds(m: CmMesh): {
  min: [number, number, number];
  max: [number, number, number];
} {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.verts.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = m.verts[i + a];
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }
  return { min, max };
}

// ---- editing -------------------------------------------------------------------

/** Apply one gizmo delta to a vertex subset around a pivot: translate the
 *  verts, rotate them about the pivot's axis, or scale them from the pivot.
 *  Returns a NEW mesh (the gesture applies deltas to the gesture-start
 *  snapshot, exactly like the hitbox gizmo contract). */
export function applyCmGizmo(
  m: CmMesh,
  idxs: readonly number[],
  pivot: readonly [number, number, number],
  d: CmGizmoDelta,
): CmMesh {
  const verts = m.verts.slice();
  const rot = (i: number, a: number, u: 0 | 1 | 2, v: 0 | 1 | 2): void => {
    // Rotate the (u,v) plane components about the pivot by angle a.
    const pu = verts[i + u] - pivot[u];
    const pv = verts[i + v] - pivot[v];
    const c = Math.cos(a);
    const s = Math.sin(a);
    verts[i + u] = pivot[u] + pu * c + pv * s;
    verts[i + v] = pivot[v] - pu * s + pv * c;
  };
  for (const vi of idxs) {
    const i = vi * 3;
    if (d.dx !== undefined || d.dy !== undefined || d.dz !== undefined) {
      verts[i] = clampC(verts[i] + (d.dx ?? 0));
      verts[i + 1] = clampC(verts[i + 1] + (d.dy ?? 0));
      verts[i + 2] = clampC(verts[i + 2] + (d.dz ?? 0));
    }
    // Axis conventions match the sim/three yaw math (model = R(a) · local).
    if (d.dRotY !== undefined) rot(i, d.dRotY, 0, 2);
    if (d.dRotX !== undefined) rot(i, d.dRotX, 2, 1);
    if (d.dRotZ !== undefined) rot(i, d.dRotZ, 1, 0);
    if (d.ratio !== undefined) {
      const r = Math.max(0.02, Math.min(50, d.ratio));
      const axis = d.axis ?? 'uniform';
      if (axis === 'uniform' || axis === 'x') {
        verts[i] = clampC(pivot[0] + (verts[i] - pivot[0]) * r);
      }
      if (axis === 'uniform' || axis === 'y') {
        verts[i + 1] = clampC(pivot[1] + (verts[i + 1] - pivot[1]) * r);
      }
      if (axis === 'uniform' || axis === 'z') {
        verts[i + 2] = clampC(pivot[2] + (verts[i + 2] - pivot[2]) * r);
      }
    }
  }
  const out: CmMesh = { verts, tris: m.tris.slice() };
  if (m.ramp) out.ramp = true;
  return out;
}

/** Deep copy. */
export function cloneMesh(m: CmMesh): CmMesh {
  const out: CmMesh = { verts: m.verts.slice(), tris: m.tris.slice() };
  if (m.ramp) out.ramp = true;
  return out;
}

/** Persistence rounding: 4 decimals keeps the JSON diff small and stable. */
export function roundMesh(m: CmMesh): CmMesh {
  const out: CmMesh = {
    verts: m.verts.map((v) => Math.round(v * 10000) / 10000),
    tris: m.tris.slice(),
  };
  if (m.ramp) out.ramp = true;
  return out;
}

/** Structural sanity for meshes arriving from JSON: index bounds + triplets. */
export function sanitizeCmMesh(v: unknown): CmMesh | null {
  if (!v || typeof v !== 'object') return null;
  const m = v as { verts?: unknown; tris?: unknown; ramp?: unknown };
  if (!Array.isArray(m.verts) || !Array.isArray(m.tris)) return null;
  if (m.verts.length % 3 !== 0 || m.tris.length % 3 !== 0) return null;
  if (m.verts.length < 9 || m.verts.length > 3000 || m.tris.length > 6000) return null;
  const vertCount = m.verts.length / 3;
  const verts: number[] = [];
  for (const n of m.verts) {
    if (typeof n !== 'number' || !Number.isFinite(n)) return null;
    verts.push(clampC(n));
  }
  const tris: number[] = [];
  for (const n of m.tris) {
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n >= vertCount) return null;
    tris.push(n);
  }
  const out: CmMesh = { verts, tris };
  if (m.ramp === true) out.ramp = true;
  return out;
}

// ---- topology editing (loop cut / extrude) --------------------------------------
//
// Blender-style geometry ADDITIONS on the triangulated CmMesh, reasoning about
// the QUAD topology reconstructed from coplanar tri pairs (polyFaces). Pure
// array math, Vitest-covered; every op returns a NEW mesh + the indices of the
// verts it created (so the caller auto-selects them for the gizmo).

// Flat-vertex cap = 1000 verts (3000 numbers) / 2000 tris (6000 numbers),
// matching sanitizeCmMesh, an op that would overflow bails to null.
const MAX_MESH_NUMS = 3000;
const MAX_TRI_NUMS = 6000;

/** One quad face: the 4 cycle verts (CCW-outward) + its two owning tri indices.
 *  Reconstructed from a coplanar tri PAIR that shares one diagonal. */
export interface CmQuad {
  cycle: [number, number, number, number];
  tris: [number, number];
}

/** Every quad in the mesh: coplanar groups of EXACTLY two triangles sharing a
 *  diagonal (a box side, a cylinder wall panel). Triangle fans / caps / odd
 *  groups are skipped (not quads). */
export function quadFaces(m: CmMesh): CmQuad[] {
  const out: CmQuad[] = [];
  for (const group of polyFaces(m)) {
    if (group.length !== 2) continue;
    const [t0, t1] = group;
    const v0 = [m.tris[t0 * 3], m.tris[t0 * 3 + 1], m.tris[t0 * 3 + 2]];
    const v1 = [m.tris[t1 * 3], m.tris[t1 * 3 + 1], m.tris[t1 * 3 + 2]];
    const shared = v0.filter((v) => v1.includes(v)); // the 2 diagonal verts
    if (shared.length !== 2) continue;
    const b = v0.find((v) => !shared.includes(v)); // t0's opposite vert
    const d = v1.find((v) => !shared.includes(v)); // t1's opposite vert
    if (b === undefined || d === undefined) continue;
    // Cycle interleaves the diagonal (a,c) with the opposite verts (b,d): the
    // t0 winding a->b->c gives a,b,c; d closes it (the t1 opposite vert).
    out.push({ cycle: [shared[0], b, shared[1], d], tris: [t0, t1] });
  }
  return out;
}

const cycleEdges = (c: readonly number[]): [number, number][] => [
  [c[0], c[1]],
  [c[1], c[2]],
  [c[2], c[3]],
  [c[3], c[0]],
];

/** The edge parallel to (and opposite) `edge` in a quad cycle, or null. */
function oppositeCycleEdge(
  cycle: readonly number[],
  edge: [number, number],
): [number, number] | null {
  const es = cycleEdges(cycle);
  const idx = es.findIndex(
    (e) => (e[0] === edge[0] && e[1] === edge[1]) || (e[0] === edge[1] && e[1] === edge[0]),
  );
  return idx < 0 ? null : es[(idx + 2) % 4];
}

/**
 * Insert an edge loop through the quad ring that crosses the picked edge
 * (ea,eb): a parallel ring of new verts at `slideT` along each ring edge, with
 * every crossed quad split in two and re-triangulated (outward winding kept by
 * reusing the parent cycle order). Returns null when the picked edge is not a
 * quad cycle edge (a cap/triangle/diagonal edge), when the ring hits a non-quad
 * face, or when the result would overflow the mesh caps. `newVerts` are the
 * inserted loop verts, ready to slide with the gizmo.
 */
export function loopCut(
  m: CmMesh,
  ea: number,
  eb: number,
  slideT = 0.5,
): { mesh: CmMesh; newVerts: number[] } | null {
  const quads = quadFaces(m);
  if (quads.length === 0) return null;
  // edge key -> quad indices that have it as a cycle edge.
  const edgeToQuads = new Map<string, number[]>();
  quads.forEach((q, qi) => {
    for (const [a, b] of cycleEdges(q.cycle)) {
      const k = edgeKey(a, b);
      const arr = edgeToQuads.get(k);
      if (arr) arr.push(qi);
      else edgeToQuads.set(k, [qi]);
    }
  });
  const startKey = edgeKey(ea, eb);
  if (!edgeToQuads.has(startKey)) return null; // not a quad edge: graceful no-op
  // BFS the ring in BOTH directions from the picked edge: collect crossed quads
  // and the ring edges (each crossed quad contributes its entry + opposite edge).
  const crossedQuads = new Set<number>();
  const ringEdges = new Map<string, [number, number]>();
  ringEdges.set(startKey, [ea, eb]);
  const stack: [number, number][] = [[ea, eb]];
  while (stack.length > 0) {
    const e = stack.pop();
    if (!e) break;
    for (const qi of edgeToQuads.get(edgeKey(e[0], e[1])) ?? []) {
      if (crossedQuads.has(qi)) continue;
      const opp = oppositeCycleEdge(quads[qi].cycle, e);
      if (!opp) return null; // malformed quad
      crossedQuads.add(qi);
      const ok = edgeKey(opp[0], opp[1]);
      if (!ringEdges.has(ok)) {
        ringEdges.set(ok, opp);
        stack.push(opp);
      }
    }
  }
  if (crossedQuads.size === 0) return null;
  const verts = m.verts.slice();
  const mid = new Map<string, number>();
  for (const [k, [a, b]] of ringEdges) {
    const ni = verts.length / 3;
    verts.push(
      clampC(m.verts[a * 3] + (m.verts[b * 3] - m.verts[a * 3]) * slideT),
      clampC(m.verts[a * 3 + 1] + (m.verts[b * 3 + 1] - m.verts[a * 3 + 1]) * slideT),
      clampC(m.verts[a * 3 + 2] + (m.verts[b * 3 + 2] - m.verts[a * 3 + 2]) * slideT),
    );
    mid.set(k, ni);
  }
  const newVerts = [...mid.values()];
  // Keep every tri not owned by a crossed quad; split each crossed quad.
  const crossedTris = new Set<number>();
  for (const qi of crossedQuads) {
    crossedTris.add(quads[qi].tris[0]);
    crossedTris.add(quads[qi].tris[1]);
  }
  const tris: number[] = [];
  for (let t = 0; t < m.tris.length / 3; t++) {
    if (crossedTris.has(t)) continue;
    tris.push(m.tris[t * 3], m.tris[t * 3 + 1], m.tris[t * 3 + 2]);
  }
  const emitQuad = (p: number, q: number, r: number, s: number): void => {
    tris.push(p, q, r, p, r, s);
  };
  for (const qi of crossedQuads) {
    const [a, b, c, d] = quads[qi].cycle;
    const kAB = edgeKey(a, b);
    const kCD = edgeKey(c, d);
    const kBC = edgeKey(b, c);
    const kDA = edgeKey(d, a);
    if (mid.has(kAB) && mid.has(kCD)) {
      const mAB = mid.get(kAB) ?? -1;
      const mCD = mid.get(kCD) ?? -1;
      emitQuad(a, mAB, mCD, d);
      emitQuad(mAB, b, c, mCD);
    } else if (mid.has(kBC) && mid.has(kDA)) {
      const mBC = mid.get(kBC) ?? -1;
      const mDA = mid.get(kDA) ?? -1;
      emitQuad(b, mBC, mDA, a);
      emitQuad(mBC, c, d, mDA);
    } else {
      return null; // a crossed quad without a parallel ring pair: bail cleanly
    }
  }
  if (verts.length > MAX_MESH_NUMS || tris.length > MAX_TRI_NUMS) return null;
  const out: CmMesh = { verts, tris };
  if (m.ramp) out.ramp = true;
  return { mesh: out, newVerts };
}

/** Average OUTWARD normal of a coplanar tri group (the extrude axis). Oriented
 *  to point away from the mesh centroid, so it is reliably outward regardless of
 *  the primitive's triangle winding (the CM primitives are inward-wound, which
 *  never mattered for the double-sided overlay or position-based collision but
 *  would flip an extrude inward). */
export function faceNormal(m: CmMesh, triGroup: readonly number[]): [number, number, number] {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (const t of triGroup) {
    const [x, y, z] = triNormal(m, t);
    nx += x;
    ny += y;
    nz += z;
  }
  const len = Math.hypot(nx, ny, nz);
  if (len < 1e-9) return [0, 1, 0];
  nx /= len;
  ny /= len;
  nz /= len;
  const fc = vertsCentroid(m, faceVerts(m, triGroup));
  const mc = vertsCentroid(m);
  if (nx * (fc[0] - mc[0]) + ny * (fc[1] - mc[1]) + nz * (fc[2] - mc[2]) < 0) {
    nx = -nx;
    ny = -ny;
    nz = -nz;
  }
  return [nx, ny, nz];
}

/**
 * Extrude a coplanar face (tri group): duplicate its verts, RETARGET the cap
 * tris onto the duplicates, and BRIDGE each boundary half-edge with two side
 * tris (winding kept from the cap so the walls face outward). The duplicates
 * start coincident with the originals (zero-height); the caller slides them
 * along the face normal. Returns null on cap overflow. Blender Poly Build's
 * dominant gesture.
 */
export function extrudeFace(
  m: CmMesh,
  triGroup: readonly number[],
): { mesh: CmMesh; newVerts: number[] } | null {
  const F = faceVerts(m, triGroup);
  if (F.length < 3) return null;
  const verts = m.verts.slice();
  const map = new Map<number, number>();
  for (const v of F) {
    const ni = verts.length / 3;
    verts.push(m.verts[v * 3], m.verts[v * 3 + 1], m.verts[v * 3 + 2]);
    map.set(v, ni);
  }
  // Boundary edges of the group = undirected edges used by exactly one tri.
  const edgeCount = new Map<string, number>();
  for (const t of triGroup) {
    for (let e = 0; e < 3; e++) {
      const k = edgeKey(m.tris[t * 3 + e], m.tris[t * 3 + ((e + 1) % 3)]);
      edgeCount.set(k, (edgeCount.get(k) ?? 0) + 1);
    }
  }
  const tris = m.tris.slice();
  // Retarget cap tris to the duplicates (the raised face).
  for (const t of triGroup) {
    for (let i = 0; i < 3; i++) tris[t * 3 + i] = map.get(m.tris[t * 3 + i]) ?? m.tris[t * 3 + i];
  }
  // Bridge each boundary directed edge u->v (read from the ORIGINAL tris).
  for (const t of triGroup) {
    for (let e = 0; e < 3; e++) {
      const u = m.tris[t * 3 + e];
      const v = m.tris[t * 3 + ((e + 1) % 3)];
      if ((edgeCount.get(edgeKey(u, v)) ?? 0) !== 1) continue;
      const u2 = map.get(u);
      const v2 = map.get(v);
      if (u2 === undefined || v2 === undefined) continue;
      tris.push(u, u2, v2, u, v2, v);
    }
  }
  if (verts.length > MAX_MESH_NUMS || tris.length > MAX_TRI_NUMS) return null;
  const out: CmMesh = { verts, tris };
  if (m.ramp) out.ramp = true;
  return { mesh: out, newVerts: [...map.values()] };
}

/** Extrude a single feature edge into a new quad (open-shape building): the two
 *  new verts start coincident and the caller drags them out. */
export function extrudeEdge(
  m: CmMesh,
  a: number,
  b: number,
): { mesh: CmMesh; newVerts: number[] } | null {
  const verts = m.verts.slice();
  const a2 = verts.length / 3;
  verts.push(m.verts[a * 3], m.verts[a * 3 + 1], m.verts[a * 3 + 2]);
  const b2 = a2 + 1;
  verts.push(m.verts[b * 3], m.verts[b * 3 + 1], m.verts[b * 3 + 2]);
  const tris = m.tris.slice();
  // Double-sided quad (a,b,b2,a2) so the new panel is visible from both faces.
  tris.push(a, b, b2, a, b2, a2, a, b2, b, a, a2, b2);
  if (verts.length > MAX_MESH_NUMS || tris.length > MAX_TRI_NUMS) return null;
  const out: CmMesh = { verts, tris };
  if (m.ramp) out.ramp = true;
  return { mesh: out, newVerts: [a2, b2] };
}

function compactMesh(verts: number[], tris: number[], ramp: boolean): CmMesh | null {
  if (tris.length < 3) return null;
  const used = new Set(tris);
  const remap = new Map<number, number>();
  const nextVerts: number[] = [];
  for (let old = 0; old < verts.length / 3; old++) {
    if (!used.has(old)) continue;
    remap.set(old, nextVerts.length / 3);
    nextVerts.push(verts[old * 3], verts[old * 3 + 1], verts[old * 3 + 2]);
  }
  const nextTris = tris.map((index) => remap.get(index) ?? -1);
  if (nextTris.some((index) => index < 0) || nextVerts.length < 9) return null;
  const out: CmMesh = { verts: nextVerts, tris: nextTris };
  if (ramp) out.ramp = true;
  return out;
}

/** Delete selected Blender-style components while retaining the rest of the mesh. */
export function deleteMeshComponents(
  m: CmMesh,
  mode: CmComponentMode,
  selectedVerts: readonly number[],
): CmMesh | null {
  const selected = new Set(selectedVerts);
  if (selected.size === 0) return null;
  const deleteTris = new Set<number>();
  if (mode === 'face') {
    for (const group of polyFaces(m)) {
      const verts = faceVerts(m, group);
      if (verts.length > 0 && verts.every((index) => selected.has(index))) {
        for (const tri of group) deleteTris.add(tri);
      }
    }
  } else {
    for (let t = 0; t < m.tris.length / 3; t++) {
      const tri = [m.tris[t * 3], m.tris[t * 3 + 1], m.tris[t * 3 + 2]];
      const hits = tri.filter((index) => selected.has(index)).length;
      if (mode === 'vertex' ? hits > 0 : hits >= 2) deleteTris.add(t);
    }
  }
  if (deleteTris.size === 0) return null;
  const tris: number[] = [];
  for (let t = 0; t < m.tris.length / 3; t++) {
    if (!deleteTris.has(t)) tris.push(m.tris[t * 3], m.tris[t * 3 + 1], m.tris[t * 3 + 2]);
  }
  return compactMesh(m.verts, tris, m.ramp === true);
}

/** Merge selected vertices at their centroid and remove degenerate triangles. */
export function weldMeshVertices(
  m: CmMesh,
  selectedVerts: readonly number[],
): { mesh: CmMesh; selected: number[] } | null {
  const selected = [...new Set(selectedVerts)].filter(
    (index) => index >= 0 && index < m.verts.length / 3,
  );
  if (selected.length < 2) return null;
  const [x, y, z] = vertsCentroid(m, selected);
  const target = selected[0];
  const selectedSet = new Set(selected);
  const verts = m.verts.slice();
  verts[target * 3] = x;
  verts[target * 3 + 1] = y;
  verts[target * 3 + 2] = z;
  const tris: number[] = [];
  for (let t = 0; t < m.tris.length / 3; t++) {
    const tri = [m.tris[t * 3], m.tris[t * 3 + 1], m.tris[t * 3 + 2]].map((index) =>
      selectedSet.has(index) ? target : index,
    );
    if (new Set(tri).size === 3) tris.push(...tri);
  }
  const compacted = compactMesh(verts, tris, m.ramp === true);
  if (!compacted) return null;
  const merged = Array.from({ length: compacted.verts.length / 3 }, (_, i) => i).find(
    (i) =>
      Math.abs(compacted.verts[i * 3] - x) < 1e-7 &&
      Math.abs(compacted.verts[i * 3 + 1] - y) < 1e-7 &&
      Math.abs(compacted.verts[i * 3 + 2] - z) < 1e-7,
  );
  return { mesh: compacted, selected: merged === undefined ? [] : [merged] };
}

/** Uniformly split every triangle into four, sharing edge midpoints. */
export function subdivideMesh(m: CmMesh): { mesh: CmMesh; newVerts: number[] } | null {
  if (m.tris.length * 4 > MAX_TRI_NUMS) return null;
  const verts = m.verts.slice();
  const midpoint = new Map<string, number>();
  const mid = (a: number, b: number): number => {
    const key = edgeKey(a, b);
    const cached = midpoint.get(key);
    if (cached !== undefined) return cached;
    const index = verts.length / 3;
    verts.push(
      (m.verts[a * 3] + m.verts[b * 3]) / 2,
      (m.verts[a * 3 + 1] + m.verts[b * 3 + 1]) / 2,
      (m.verts[a * 3 + 2] + m.verts[b * 3 + 2]) / 2,
    );
    midpoint.set(key, index);
    return index;
  };
  const tris: number[] = [];
  for (let t = 0; t < m.tris.length / 3; t++) {
    const a = m.tris[t * 3];
    const b = m.tris[t * 3 + 1];
    const c = m.tris[t * 3 + 2];
    const ab = mid(a, b);
    const bc = mid(b, c);
    const ca = mid(c, a);
    tris.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
  }
  if (verts.length > MAX_MESH_NUMS) return null;
  const out: CmMesh = { verts, tris };
  if (m.ramp) out.ramp = true;
  return { mesh: out, newVerts: [...midpoint.values()] };
}

/** Inset the selected coplanar face, keeping a connected border ring. */
export function insetMeshFace(
  m: CmMesh,
  selectedVerts: readonly number[],
  ratio = 0.72,
): { mesh: CmMesh; newVerts: number[] } | null {
  const selected = new Set(selectedVerts);
  const group = polyFaces(m).find((candidate) => {
    const verts = faceVerts(m, candidate);
    return verts.length === selected.size && verts.every((index) => selected.has(index));
  });
  if (!group) return null;
  const extruded = extrudeFace(m, group);
  if (!extruded) return null;
  const center = vertsCentroid(m, [...selected]);
  const verts = extruded.mesh.verts.slice();
  const r = Math.max(0.05, Math.min(0.95, ratio));
  for (const index of extruded.newVerts) {
    verts[index * 3] = center[0] + (verts[index * 3] - center[0]) * r;
    verts[index * 3 + 1] = center[1] + (verts[index * 3 + 1] - center[1]) * r;
    verts[index * 3 + 2] = center[2] + (verts[index * 3 + 2] - center[2]) * r;
  }
  return { mesh: { ...extruded.mesh, verts }, newVerts: extruded.newVerts };
}

/** Fill a roughly planar selected boundary with a triangle fan. */
export function fillMeshSelection(m: CmMesh, selectedVerts: readonly number[]): CmMesh | null {
  const selected = [...new Set(selectedVerts)].filter(
    (index) => index >= 0 && index < m.verts.length / 3,
  );
  if (selected.length < 3) return null;
  const center = vertsCentroid(m, selected);
  const ranges = [0, 1, 2].map((axis) => {
    const values = selected.map((index) => m.verts[index * 3 + axis]);
    return Math.max(...values) - Math.min(...values);
  });
  const dropAxis = ranges.indexOf(Math.min(...ranges));
  const axes = [0, 1, 2].filter((axis) => axis !== dropAxis);
  selected.sort(
    (a, b) =>
      Math.atan2(
        m.verts[a * 3 + axes[1]] - center[axes[1]],
        m.verts[a * 3 + axes[0]] - center[axes[0]],
      ) -
      Math.atan2(
        m.verts[b * 3 + axes[1]] - center[axes[1]],
        m.verts[b * 3 + axes[0]] - center[axes[0]],
      ),
  );
  const tris = m.tris.slice();
  for (let i = 1; i + 1 < selected.length; i++) {
    tris.push(selected[0], selected[i], selected[i + 1]);
  }
  if (tris.length > MAX_TRI_NUMS) return null;
  const out: CmMesh = { verts: m.verts.slice(), tris };
  if (m.ramp) out.ramp = true;
  return out;
}

/** Non-destructive symmetry: keep the source and append a mirrored half. */
export function mirrorMesh(
  m: CmMesh,
  axis: 'x' | 'y' | 'z' = 'x',
): { mesh: CmMesh; newVerts: number[] } | null {
  if (m.verts.length * 2 > MAX_MESH_NUMS || m.tris.length * 2 > MAX_TRI_NUMS) return null;
  const offset = m.verts.length / 3;
  const component = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
  const verts = m.verts.slice();
  for (let i = 0; i < offset; i++) {
    verts.push(
      component === 0 ? -m.verts[i * 3] : m.verts[i * 3],
      component === 1 ? -m.verts[i * 3 + 1] : m.verts[i * 3 + 1],
      component === 2 ? -m.verts[i * 3 + 2] : m.verts[i * 3 + 2],
    );
  }
  const tris = m.tris.slice();
  for (let t = 0; t < m.tris.length / 3; t++) {
    tris.push(m.tris[t * 3] + offset, m.tris[t * 3 + 2] + offset, m.tris[t * 3 + 1] + offset);
  }
  const out: CmMesh = { verts, tris };
  if (m.ramp) out.ramp = true;
  return {
    mesh: out,
    newVerts: Array.from({ length: offset }, (_, index) => index + offset),
  };
}

// ---- decomposition (mesh -> sim Y-banded OBBs) ----------------------------------

interface Rect2 {
  cx: number;
  cz: number;
  hx: number;
  hz: number;
  ry: number;
  hullArea: number;
  hullCount: number;
  /** The section outline itself, so a crossed-square substitution can be FITTED
   *  to it rather than guessed from the rectangle (see crossedSquareSide). */
  hull: readonly [number, number][];
}

/** Andrew's monotone chain convex hull, XZ plane. */
export function convexHull2(points: readonly [number, number][]): [number, number][] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  // Collapse near-duplicates so hull edges are meaningful.
  const uniq: [number, number][] = [];
  for (const p of pts) {
    const last = uniq[uniq.length - 1];
    if (!last || Math.abs(last[0] - p[0]) > 1e-6 || Math.abs(last[1] - p[1]) > 1e-6) uniq.push(p);
  }
  if (uniq.length <= 2) return uniq;
  const cross = (o: [number, number], a: [number, number], b: [number, number]): number =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const p of uniq) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: [number, number][] = [];
  for (let i = uniq.length - 1; i >= 0; i--) {
    const p = uniq[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function polygonArea(hull: readonly [number, number][]): number {
  let a = 0;
  for (let i = 0; i < hull.length; i++) {
    const [x0, z0] = hull[i];
    const [x1, z1] = hull[(i + 1) % hull.length];
    a += x0 * z1 - x1 * z0;
  }
  return Math.abs(a) / 2;
}

/** Minimum-area yawed rectangle over a point set (calipers on hull edges). */
export function minAreaRect(points: readonly [number, number][]): Rect2 | null {
  const hull = convexHull2(points);
  if (hull.length === 0) return null;
  if (hull.length === 1) {
    return {
      cx: hull[0][0],
      cz: hull[0][1],
      hx: MIN_SPAN,
      hz: MIN_SPAN,
      ry: 0,
      hullArea: 0,
      hullCount: 1,
      hull,
    };
  }
  let best: Rect2 | null = null;
  const angles =
    hull.length === 2 ? [Math.atan2(hull[1][1] - hull[0][1], hull[1][0] - hull[0][0])] : [];
  for (let i = 0; i < hull.length && hull.length > 2; i++) {
    const [x0, z0] = hull[i];
    const [x1, z1] = hull[(i + 1) % hull.length];
    angles.push(Math.atan2(z1 - z0, x1 - x0));
  }
  const hullArea = polygonArea(hull);
  for (const a of angles) {
    const c = Math.cos(a);
    const s = Math.sin(a);
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const [x, z] of hull) {
      // Into the candidate frame: u along the edge, v across it.
      const u = x * c + z * s;
      const v = -x * s + z * c;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    let hx = Math.max(MIN_SPAN, (maxU - minU) / 2);
    let hz = Math.max(MIN_SPAN, (maxV - minV) / 2);
    const cu = (minU + maxU) / 2;
    const cv = (minV + maxV) / 2;
    // Frame -> MapHitbox yaw. Local +X maps to model (cos ry, -sin ry); our u
    // axis is (c, s), so ry = -a. CANONICALIZE (long side on hx, yaw in
    // [0, pi)) with a deterministic angle tie-break: equal-area candidates
    // (regular sections tie across every hull edge) must resolve identically
    // for every Y band, or band merging falls apart.
    let ry = -a;
    if (hx < hz - 1e-9) {
      const t = hx;
      hx = hz;
      hz = t;
      ry += Math.PI / 2;
    }
    ry = ((ry % Math.PI) + Math.PI) % Math.PI;
    if (ry > Math.PI - 1e-9) ry = 0;
    const area = hx * hz;
    if (
      !best ||
      area < best.hx * best.hz - 1e-9 ||
      (area < best.hx * best.hz + 1e-9 && ry < best.ry - 1e-9)
    ) {
      best = {
        // Frame center back to model space (inverse of the u/v projection).
        cx: cu * c - cv * s,
        cz: cu * s + cv * c,
        hx,
        hz,
        ry,
        hullArea,
        hullCount: hull.length,
        hull,
      };
    }
  }
  return best;
}

/**
 * Half-side for the crossed-square pair that best hugs `r`'s section outline.
 *
 * The pair's reach at an angle is `side / max(|cos|, |sin|)` measured in each
 * square's own frame, so the union runs from `side` at the flats out to
 * `side * sqrt(2)` at its eight corners. A fixed shrink of the rectangle (this
 * was `rad * 0.92`) ignores that spread entirely: on a real authored section it
 * left the collider up to 41% OUTSIDE the drawn shape at the corners while
 * sitting 17% inside it on the flats, the maker draws a tower and walks into
 * an invisible wall short of it, which is what "the collision does not match
 * Collision Master" looks like from inside the game.
 *
 * Fit it instead. `side * f(angle)` is the collider's reach and `hull(angle)`
 * the drawn reach, so the relative error is `side * f/hull - 1` and the side
 * that minimises the WORST error either way is the harmonic midpoint of the
 * tightest inscribed and loosest circumscribed fits.
 */
function crossedSquareSide(r: Rect2): number {
  const reach = (ang: number, yaw: number): number => {
    const a = ang - yaw;
    return 1 / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)));
  };
  let lo = Infinity; // tightest ratio: the inscribed fit
  let hi = 0; // loosest: the circumscribed fit
  for (let k = 0; k < 180; k++) {
    const ang = (k * Math.PI) / 180;
    const ux = Math.cos(ang);
    const uz = Math.sin(ang);
    let support = 0;
    for (const [hx, hz] of r.hull) {
      const d = (hx - r.cx) * ux + (hz - r.cz) * uz;
      if (d > support) support = d;
    }
    if (support <= 1e-6) continue;
    const f = Math.max(reach(ang, r.ry), reach(ang, r.ry + Math.PI / 4)) / support;
    if (f < lo) lo = f;
    if (f > hi) hi = f;
  }
  if (!Number.isFinite(lo) || hi <= 0) return ((r.hx + r.hz) / 2) * 0.92;
  return 2 / (lo + hi);
}

// Finer bands = the derived sim boxes hug the authored mesh, so the maker's
// modeled shape IS (near enough) the collision, not a chunky approximation.
const BAND_TARGET = 0.35; // yards per band before merging
const MAX_BANDS = 16;

/** Slice a mesh into Y bands and fit each band's cross-section with a yawed
 *  rectangle; adjacent bands with matching rectangles merge, so exact boxes
 *  come back as ONE box. "Round" sections (cylinders) emit the classic
 *  crossed-square pair for a tighter footprint than one fat rectangle. */
export function meshToHitboxes(m: CmMesh, maxBoxes = 20): MapHitbox[] {
  const { min, max } = meshBounds(m);
  if (!Number.isFinite(min[1]) || !Number.isFinite(max[1])) return [];
  const height = max[1] - min[1];
  const bandCount = Math.max(1, Math.min(MAX_BANDS, Math.ceil(height / BAND_TARGET)));
  interface Band {
    y0: number;
    y1: number;
    rect: Rect2;
  }
  const bands: Band[] = [];
  for (let bi = 0; bi < bandCount; bi++) {
    const y0 = min[1] + (height * bi) / bandCount;
    const y1 = min[1] + (height * (bi + 1)) / bandCount;
    const pts: [number, number][] = [];
    // Verts inside the band.
    for (let i = 0; i < m.verts.length; i += 3) {
      const y = m.verts[i + 1];
      if (y >= y0 - 1e-6 && y <= y1 + 1e-6) pts.push([m.verts[i], m.verts[i + 2]]);
    }
    // Edge crossings of the band planes (a mid-band slice of a box has no
    // verts of its own: the section outline lives on the cut edges).
    for (let t = 0; t < m.tris.length; t += 3) {
      for (let e = 0; e < 3; e++) {
        const a = m.tris[t + e] * 3;
        const b = m.tris[t + ((e + 1) % 3)] * 3;
        for (const yc of [y0, y1]) {
          const ya = m.verts[a + 1];
          const yb = m.verts[b + 1];
          if ((ya < yc && yb > yc) || (yb < yc && ya > yc)) {
            const f = (yc - ya) / (yb - ya);
            pts.push([
              m.verts[a] + (m.verts[b] - m.verts[a]) * f,
              m.verts[a + 2] + (m.verts[b + 2] - m.verts[a + 2]) * f,
            ]);
          }
        }
      }
    }
    if (pts.length === 0) continue;
    const rect = minAreaRect(pts);
    if (rect) bands.push({ y0, y1, rect });
  }
  if (bands.length === 0) return [];
  // Merge adjacent bands whose rectangles agree (the yaw compares mod pi:
  // a rectangle is the same shape rotated half a turn).
  const merged: Band[] = [];
  const angEq = (a: number, b: number): boolean => {
    const d = Math.abs(a - b) % Math.PI;
    return d < 0.02 || Math.PI - d < 0.02;
  };
  for (const band of bands) {
    const prev = merged[merged.length - 1];
    if (
      prev &&
      Math.abs(prev.y1 - band.y0) < 1e-6 &&
      Math.abs(prev.rect.cx - band.rect.cx) < 0.03 &&
      Math.abs(prev.rect.cz - band.rect.cz) < 0.03 &&
      Math.abs(prev.rect.hx - band.rect.hx) < 0.03 &&
      Math.abs(prev.rect.hz - band.rect.hz) < 0.03 &&
      angEq(prev.rect.ry, band.rect.ry)
    ) {
      prev.y1 = band.y1;
    } else {
      merged.push({ ...band, rect: { ...band.rect } });
    }
  }
  const out: MapHitbox[] = [];
  for (const band of merged) {
    const r = band.rect;
    const y = (band.y0 + band.y1) / 2;
    const hy = Math.max(MIN_SPAN, (band.y1 - band.y0) / 2);
    const nearSquare = Math.abs(r.hx - r.hz) <= 0.2 * Math.max(r.hx, r.hz);
    const ratio = r.hullArea / Math.max(1e-6, r.hx * r.hz * 4);
    // A many-sided near-square hull that underfills its rectangle is a round
    // section: two crossed squares hug it far better than one fat rect.
    if (
      r.hullCount >= 8 &&
      nearSquare &&
      ratio > 0.7 &&
      ratio < 0.95 &&
      out.length + 2 <= maxBoxes
    ) {
      const side = crossedSquareSide(r);
      out.push({ x: r.cx, y, z: r.cz, hx: side, hy, hz: side, ry: r.ry || undefined });
      out.push({ x: r.cx, y, z: r.cz, hx: side, hy, hz: side, ry: r.ry + Math.PI / 4 });
    } else {
      const box: MapHitbox = { x: r.cx, y, z: r.cz, hx: r.hx, hy, hz: r.hz };
      if (Math.abs(r.ry) > 1e-4) box.ry = r.ry;
      out.push(box);
    }
    if (out.length >= maxBoxes) break;
  }
  // Round for stable JSON; strip degenerate yaws.
  return out.slice(0, maxBoxes).map((b) => {
    const r4 = (v: number): number => Math.round(v * 10000) / 10000;
    const box: MapHitbox = {
      x: r4(b.x),
      y: r4(b.y),
      z: r4(b.z),
      hx: r4(b.hx),
      hy: r4(b.hy),
      hz: r4(b.hz),
    };
    if (b.ry !== undefined && Math.abs(b.ry) > 1e-4) box.ry = r4(b.ry);
    return box;
  });
}

// ---- ramp fit (walkable mesh -> one rising deck) --------------------------------

/** How far from the deck center (as a fraction of the half extent) a vertex
 *  must sit to count as an "end" vertex for the rise fit. 0.4 catches a
 *  wedge's exact-end verts and tolerates lightly edited geometry. */
const RAMP_END_ZONE = 0.4;

/**
 * Fit ONE rising walkable deck over a ramp-flagged volume: the min-area XZ
 * rectangle of the mesh, rising linearly along whichever rect axis shows the
 * bigger top-surface height difference between its two ends (a wedge rises
 * along its slope; a flat box fits as a level platform deck). The deck is the
 * mesh's TOP surface: max vertex Y near each end. Null only for degenerate
 * input.
 */
export function meshToRamp(m: CmMesh): AuthoredCollisionRamp | null {
  const pts: [number, number][] = [];
  for (let i = 0; i < m.verts.length; i += 3) pts.push([m.verts[i], m.verts[i + 2]]);
  const rect = minAreaRect(pts);
  if (!rect) return null;
  const { max } = meshBounds(m);
  // Top height near each end of the axis at yaw `ry` with half extent `half`
  // (model -> deck-local u via the meshFromHitbox convention: u = X c - Z s).
  const endHeights = (ry: number, half: number): { lo: number; hi: number } => {
    const c = Math.cos(ry);
    const s = Math.sin(ry);
    let lo = Number.NEGATIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < m.verts.length; i += 3) {
      const u = (m.verts[i] - rect.cx) * c - (m.verts[i + 2] - rect.cz) * s;
      const y = m.verts[i + 1];
      if (u <= -half * RAMP_END_ZONE && y > lo) lo = y;
      if (u >= half * RAMP_END_ZONE && y > hi) hi = y;
    }
    // An end with no verts (degenerate/edited shape): a flat deck at the top.
    if (!Number.isFinite(lo)) lo = max[1];
    if (!Number.isFinite(hi)) hi = max[1];
    return { lo, hi };
  };
  const a = endHeights(rect.ry, rect.hx);
  const b = endHeights(rect.ry + Math.PI / 2, rect.hz);
  // Slope along the axis with the bigger rise; the frame rotates with it so
  // the deck's local +X is ALWAYS the rise axis.
  const useB = Math.abs(b.hi - b.lo) > Math.abs(a.hi - a.lo);
  const ry = useB ? rect.ry + Math.PI / 2 : rect.ry;
  const hx = Math.max(MIN_SPAN, useB ? rect.hz : rect.hx);
  const hz = Math.max(MIN_SPAN, useB ? rect.hx : rect.hz);
  const ends = useB ? b : a;
  const r4 = (v: number): number => Math.round(v * 10000) / 10000;
  const out: AuthoredCollisionRamp = {
    x: r4(rect.cx),
    z: r4(rect.cz),
    hx: r4(hx),
    hz: r4(hz),
    y0: r4(ends.lo),
    y1: r4(ends.hi),
  };
  // Wrap to (-pi, pi] WITHOUT the boxes' mod-pi collapse: a deck is not
  // symmetric under a half turn (rotating by pi swaps its high and low ends),
  // and y0/y1 above were measured in exactly this frame.
  const wrapped = ((((ry + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
  if (Math.abs(wrapped) > 1e-4) out.ry = r4(wrapped);
  return out;
}
