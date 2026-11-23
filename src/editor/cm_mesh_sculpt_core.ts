// Pure dynamic-mesh sculpting for editor-authored CmMesh surfaces. The app
// supplies model-space brush samples; this module owns falloff, deformation,
// and local topology refinement without depending on DOM or three.js.

import { MAX_MODEL_MESH_TRIS, MAX_MODEL_MESH_VERTS } from '../sim/map_doc';
import type { CmMesh } from './cm_mesh';

export type CmSculptTool = 'grab' | 'inflate' | 'deflate' | 'smooth' | 'pinch' | 'crease' | 'relax';
export interface CmSculptSymmetry {
  x: boolean;
  y: boolean;
  z: boolean;
}

export interface CmSculptSample {
  tool: CmSculptTool;
  center: readonly [number, number, number];
  radius: number;
  /** World-space yards applied at the brush center for this sample. */
  strength: number;
  /** Grab translation in model space. Ignored by the other brushes. */
  offset?: readonly [number, number, number];
  /** Locally split/collapse edges around the brush before deformation. */
  dynamicTopology?: boolean;
  /** Desired local edge length in yards when dynamicTopology is enabled. */
  targetEdgeLength?: number;
}

export interface CmSculptResult {
  mesh: CmMesh;
  affectedVerts: number[];
  changed: boolean;
  topologyChanged: boolean;
}

export interface CmRemeshOptions {
  center: readonly [number, number, number];
  radius: number;
  targetEdgeLength: number;
  maxSplits?: number;
  maxCollapses?: number;
}

const MAX_COORD = 100;
const MAX_VERTS = MAX_MODEL_MESH_VERTS;
const MAX_TRIS = MAX_MODEL_MESH_TRIS;

const clampCoord = (v: number): number => Math.max(-MAX_COORD, Math.min(MAX_COORD, v));
const edgeKey = (a: number, b: number): string => (a < b ? `${a}:${b}` : `${b}:${a}`);

function cloneMesh(m: CmMesh): CmMesh {
  const out: CmMesh = { verts: m.verts.slice(), tris: m.tris.slice() };
  if (m.ramp) out.ramp = true;
  return out;
}

function vertex(m: CmMesh, i: number): [number, number, number] {
  return [m.verts[i * 3], m.verts[i * 3 + 1], m.verts[i * 3 + 2]];
}

function distanceSq(a: readonly number[], b: readonly number[]): number {
  const x = a[0] - b[0];
  const y = a[1] - b[1];
  const z = a[2] - b[2];
  return x * x + y * y + z * z;
}

function normalized(x: number, y: number, z: number): [number, number, number] {
  const len = Math.hypot(x, y, z);
  return len > 1e-9 ? [x / len, y / len, z / len] : [0, 1, 0];
}

function triangleNormal(
  m: CmMesh,
  a: number,
  b: number,
  c: number,
  override?: ReadonlyMap<number, readonly [number, number, number]>,
): [number, number, number] {
  const av = override?.get(a) ?? vertex(m, a);
  const bv = override?.get(b) ?? vertex(m, b);
  const cv = override?.get(c) ?? vertex(m, c);
  const ux = bv[0] - av[0];
  const uy = bv[1] - av[1];
  const uz = bv[2] - av[2];
  const vx = cv[0] - av[0];
  const vy = cv[1] - av[1];
  const vz = cv[2] - av[2];
  return normalized(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
}

function vertexAdjacency(m: CmMesh): Set<number>[] {
  const out = Array.from({ length: m.verts.length / 3 }, () => new Set<number>());
  for (let i = 0; i < m.tris.length; i += 3) {
    const a = m.tris[i];
    const b = m.tris[i + 1];
    const c = m.tris[i + 2];
    out[a].add(b);
    out[a].add(c);
    out[b].add(a);
    out[b].add(c);
    out[c].add(a);
    out[c].add(b);
  }
  return out;
}

function vertexNormals(m: CmMesh): [number, number, number][] {
  const sums = Array.from(
    { length: m.verts.length / 3 },
    () => [0, 0, 0] as [number, number, number],
  );
  for (let i = 0; i < m.tris.length; i += 3) {
    const a = m.tris[i];
    const b = m.tris[i + 1];
    const c = m.tris[i + 2];
    const av = vertex(m, a);
    const bv = vertex(m, b);
    const cv = vertex(m, c);
    const ux = bv[0] - av[0];
    const uy = bv[1] - av[1];
    const uz = bv[2] - av[2];
    const vx = cv[0] - av[0];
    const vy = cv[1] - av[1];
    const vz = cv[2] - av[2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const vi of [a, b, c]) {
      sums[vi][0] += nx;
      sums[vi][1] += ny;
      sums[vi][2] += nz;
    }
  }
  return sums.map((n) => normalized(n[0], n[1], n[2]));
}

interface MeshEdge {
  a: number;
  b: number;
  tris: number[];
  lengthSq: number;
  midpoint: [number, number, number];
}

function meshEdges(m: CmMesh): MeshEdge[] {
  const byKey = new Map<string, { a: number; b: number; tris: number[] }>();
  for (let t = 0; t < m.tris.length / 3; t++) {
    for (let e = 0; e < 3; e++) {
      const a = m.tris[t * 3 + e];
      const b = m.tris[t * 3 + ((e + 1) % 3)];
      const key = edgeKey(a, b);
      const found = byKey.get(key);
      if (found) found.tris.push(t);
      else byKey.set(key, { a, b, tris: [t] });
    }
  }
  return [...byKey.values()].map(({ a, b, tris }) => {
    const av = vertex(m, a);
    const bv = vertex(m, b);
    const midpoint: [number, number, number] = [
      (av[0] + bv[0]) / 2,
      (av[1] + bv[1]) / 2,
      (av[2] + bv[2]) / 2,
    ];
    return { a, b, tris, lengthSq: distanceSq(av, bv), midpoint };
  });
}

/** Split one complete manifold/boundary edge across every triangle using it. */
function splitEdge(m: CmMesh, a: number, b: number): CmMesh | null {
  if (m.verts.length / 3 >= MAX_VERTS) return null;
  const av = vertex(m, a);
  const bv = vertex(m, b);
  const mid = m.verts.length / 3;
  const verts = m.verts.concat([(av[0] + bv[0]) / 2, (av[1] + bv[1]) / 2, (av[2] + bv[2]) / 2]);
  const tris: number[] = [];
  let uses = 0;
  for (let t = 0; t < m.tris.length; t += 3) {
    const tri = [m.tris[t], m.tris[t + 1], m.tris[t + 2]];
    let splitAt = -1;
    for (let e = 0; e < 3; e++) {
      const u = tri[e];
      const v = tri[(e + 1) % 3];
      if ((u === a && v === b) || (u === b && v === a)) {
        splitAt = e;
        break;
      }
    }
    if (splitAt < 0) {
      tris.push(tri[0], tri[1], tri[2]);
      continue;
    }
    uses++;
    const u = tri[splitAt];
    const v = tri[(splitAt + 1) % 3];
    const w = tri[(splitAt + 2) % 3];
    tris.push(u, mid, w, mid, v, w);
  }
  if (uses === 0 || tris.length / 3 > MAX_TRIS) return null;
  const out: CmMesh = { verts, tris };
  if (m.ramp) out.ramp = true;
  return out;
}

function canCollapseEdge(m: CmMesh, edge: MeshEdge): boolean {
  if (edge.tris.length < 1 || edge.tris.length > 2) return false;
  const adj = vertexAdjacency(m);
  const common = [...adj[edge.a]].filter((v) => v !== edge.b && adj[edge.b].has(v));
  const opposite = new Set<number>();
  for (const t of edge.tris) {
    for (let i = 0; i < 3; i++) {
      const v = m.tris[t * 3 + i];
      if (v !== edge.a && v !== edge.b) opposite.add(v);
    }
  }
  // Link condition: collapsing must not join unrelated surface fans.
  if (common.length !== opposite.size || common.some((v) => !opposite.has(v))) return false;
  const mid = edge.midpoint;
  const override = new Map<number, readonly [number, number, number]>([
    [edge.a, mid],
    [edge.b, mid],
  ]);
  for (let t = 0; t < m.tris.length / 3; t++) {
    const tri = [m.tris[t * 3], m.tris[t * 3 + 1], m.tris[t * 3 + 2]];
    const touches = tri.includes(edge.a) || tri.includes(edge.b);
    if (!touches || (tri.includes(edge.a) && tri.includes(edge.b))) continue;
    const next = tri.map((v) => (v === edge.b ? edge.a : v));
    if (new Set(next).size < 3) continue;
    const oldN = triangleNormal(m, tri[0], tri[1], tri[2]);
    const newN = triangleNormal(m, next[0], next[1], next[2], override);
    const dot = oldN[0] * newN[0] + oldN[1] * newN[1] + oldN[2] * newN[2];
    if (dot < 0.15) return false;
  }
  return true;
}

function collapseEdge(m: CmMesh, edge: MeshEdge): CmMesh | null {
  if (!canCollapseEdge(m, edge)) return null;
  const verts = m.verts.slice();
  verts[edge.a * 3] = edge.midpoint[0];
  verts[edge.a * 3 + 1] = edge.midpoint[1];
  verts[edge.a * 3 + 2] = edge.midpoint[2];
  const remapped: number[] = [];
  for (let t = 0; t < m.tris.length; t += 3) {
    const a = m.tris[t] === edge.b ? edge.a : m.tris[t];
    const b = m.tris[t + 1] === edge.b ? edge.a : m.tris[t + 1];
    const c = m.tris[t + 2] === edge.b ? edge.a : m.tris[t + 2];
    if (a === b || b === c || c === a) continue;
    remapped.push(a, b, c);
  }
  if (remapped.length < 3) return null;
  const used = [...new Set(remapped)].sort((a, b) => a - b);
  const map = new Map<number, number>();
  const compactVerts: number[] = [];
  for (const old of used) {
    map.set(old, compactVerts.length / 3);
    compactVerts.push(verts[old * 3], verts[old * 3 + 1], verts[old * 3 + 2]);
  }
  const tris = remapped.map((v) => map.get(v) ?? 0);
  const out: CmMesh = { verts: compactVerts, tris };
  if (m.ramp) out.ramp = true;
  return out;
}

/**
 * Refine a brush-sized region toward a target edge length. Long edges split
 * across all adjacent triangles; safe short edges collapse only when the mesh
 * link condition and face-orientation checks pass.
 */
export function dynamicRemeshCmMesh(m: CmMesh, opts: CmRemeshOptions): CmMesh {
  const radius = Math.max(0.05, opts.radius);
  const target = Math.max(0.03, opts.targetEdgeLength);
  const radiusSq = radius * radius;
  let out = cloneMesh(m);
  const maxSplits = Math.max(0, Math.min(160, opts.maxSplits ?? 48));
  const maxCollapses = Math.max(0, Math.min(80, opts.maxCollapses ?? 24));
  for (let i = 0; i < maxSplits; i++) {
    if (out.verts.length / 3 >= MAX_VERTS || out.tris.length / 3 >= MAX_TRIS) break;
    const edge = meshEdges(out)
      .filter(
        (e) =>
          e.lengthSq > target * target * 2.25 && distanceSq(e.midpoint, opts.center) <= radiusSq,
      )
      .sort((a, b) => b.lengthSq - a.lengthSq)[0];
    if (!edge) break;
    const next = splitEdge(out, edge.a, edge.b);
    if (!next) break;
    out = next;
  }
  for (let i = 0; i < maxCollapses; i++) {
    const candidates = meshEdges(out)
      .filter(
        (e) =>
          e.lengthSq < target * target * 0.2025 && distanceSq(e.midpoint, opts.center) <= radiusSq,
      )
      .sort((a, b) => a.lengthSq - b.lengthSq);
    let next: CmMesh | null = null;
    for (const edge of candidates) {
      next = collapseEdge(out, edge);
      if (next) break;
    }
    if (!next) break;
    out = next;
  }
  return out;
}

function brushWeight(distance: number, radius: number): number {
  const t = Math.max(0, Math.min(1, distance / radius));
  const s = 1 - t * t;
  return s * s;
}

/** Apply one sculpt sample and return a new mesh plus the affected indices. */
export function sculptCmMesh(m: CmMesh, sample: CmSculptSample): CmSculptResult {
  const radius = Math.max(0.05, sample.radius);
  const target = Math.max(0.03, sample.targetEdgeLength ?? radius / 5);
  const remeshed = sample.dynamicTopology
    ? dynamicRemeshCmMesh(m, {
        center: sample.center,
        radius: radius * 1.15,
        targetEdgeLength: target,
      })
    : cloneMesh(m);
  const topologyChanged =
    remeshed.verts.length !== m.verts.length || remeshed.tris.length !== m.tris.length;
  const adj = vertexAdjacency(remeshed);
  const normals = vertexNormals(remeshed);
  const weights = new Map<number, number>();
  for (let i = 0; i < remeshed.verts.length / 3; i++) {
    const d = Math.sqrt(distanceSq(vertex(remeshed, i), sample.center));
    if (d <= radius) weights.set(i, brushWeight(d, radius));
  }
  if (weights.size === 0) {
    return { mesh: remeshed, affectedVerts: [], changed: topologyChanged, topologyChanged };
  }
  const source = remeshed.verts.slice();
  const verts = remeshed.verts.slice();
  const maxStep = radius * 0.5;
  const strength = Math.max(-maxStep, Math.min(maxStep, sample.strength));
  const offset = sample.offset ?? [0, 0, 0];
  for (const [i, weight] of weights) {
    const p: [number, number, number] = [source[i * 3], source[i * 3 + 1], source[i * 3 + 2]];
    const n = normals[i];
    let dx = 0;
    let dy = 0;
    let dz = 0;
    if (sample.tool === 'grab') {
      dx = offset[0] * weight;
      dy = offset[1] * weight;
      dz = offset[2] * weight;
    } else if (sample.tool === 'inflate' || sample.tool === 'deflate') {
      const sign = sample.tool === 'deflate' ? -1 : 1;
      dx = n[0] * strength * sign * weight;
      dy = n[1] * strength * sign * weight;
      dz = n[2] * strength * sign * weight;
    } else {
      const neighbours = [...adj[i]];
      let ax = p[0];
      let ay = p[1];
      let az = p[2];
      if (neighbours.length > 0) {
        ax = 0;
        ay = 0;
        az = 0;
        for (const nb of neighbours) {
          ax += source[nb * 3];
          ay += source[nb * 3 + 1];
          az += source[nb * 3 + 2];
        }
        ax /= neighbours.length;
        ay /= neighbours.length;
        az /= neighbours.length;
      }
      const lapX = ax - p[0];
      const lapY = ay - p[1];
      const lapZ = az - p[2];
      if (sample.tool === 'smooth') {
        const rate = Math.min(1, Math.abs(strength)) * weight;
        dx = lapX * rate;
        dy = lapY * rate;
        dz = lapZ * rate;
      } else if (sample.tool === 'relax') {
        const alongN = lapX * n[0] + lapY * n[1] + lapZ * n[2];
        const rate = Math.min(1, Math.abs(strength)) * weight;
        dx = (lapX - n[0] * alongN) * rate;
        dy = (lapY - n[1] * alongN) * rate;
        dz = (lapZ - n[2] * alongN) * rate;
      } else {
        const cx = sample.center[0] - p[0];
        const cy = sample.center[1] - p[1];
        const cz = sample.center[2] - p[2];
        const alongN = cx * n[0] + cy * n[1] + cz * n[2];
        const tx = cx - n[0] * alongN;
        const ty = cy - n[1] * alongN;
        const tz = cz - n[2] * alongN;
        const tangent = normalized(tx, ty, tz);
        const pinchStep = strength * weight;
        dx = tangent[0] * pinchStep;
        dy = tangent[1] * pinchStep;
        dz = tangent[2] * pinchStep;
        if (sample.tool === 'crease') {
          dx -= n[0] * Math.abs(strength) * weight * 0.45;
          dy -= n[1] * Math.abs(strength) * weight * 0.45;
          dz -= n[2] * Math.abs(strength) * weight * 0.45;
        }
      }
    }
    verts[i * 3] = clampCoord(p[0] + dx);
    verts[i * 3 + 1] = clampCoord(p[1] + dy);
    verts[i * 3 + 2] = clampCoord(p[2] + dz);
  }
  let out: CmMesh = { verts, tris: remeshed.tris.slice() };
  if (remeshed.ramp) out.ramp = true;
  const moved = [...weights].some(([i]) => {
    const o = i * 3;
    return (
      verts[o] !== source[o] || verts[o + 1] !== source[o + 1] || verts[o + 2] !== source[o + 2]
    );
  });
  let finalTopologyChanged = topologyChanged;
  let affectedVerts = [...weights.keys()];
  if (sample.dynamicTopology && sample.tool === 'grab') {
    const length = Math.hypot(offset[0], offset[1], offset[2]);
    if (length > target * 0.75) {
      const center: [number, number, number] = [
        sample.center[0] + offset[0] * 0.5,
        sample.center[1] + offset[1] * 0.5,
        sample.center[2] + offset[2] * 0.5,
      ];
      const refined = dynamicRemeshCmMesh(out, {
        center,
        radius: radius + length * 0.65,
        targetEdgeLength: target,
        maxSplits: 120,
        maxCollapses: 0,
      });
      finalTopologyChanged ||=
        refined.verts.length !== out.verts.length || refined.tris.length !== out.tris.length;
      out = refined;
      const reachSq = (radius + length) * (radius + length);
      affectedVerts = Array.from({ length: out.verts.length / 3 }, (_, index) => index).filter(
        (index) => distanceSq(vertex(out, index), sample.center) <= reachSq,
      );
    }
  }
  return {
    mesh: out,
    affectedVerts,
    changed: finalTopologyChanged || moved,
    topologyChanged: finalTopologyChanged,
  };
}

/** Apply a brush sample to its mirrored copies across any enabled local axes. */
export function sculptCmMeshSymmetric(
  mesh: CmMesh,
  sample: CmSculptSample,
  symmetry: CmSculptSymmetry,
): CmSculptResult {
  const axes = (['x', 'y', 'z'] as const).filter((axis) => symmetry[axis]);
  const copies = 1 << axes.length;
  const seen = new Set<string>();
  let out = cloneMesh(mesh);
  let changed = false;
  let topologyChanged = false;
  const affected = new Set<number>();
  for (let mask = 0; mask < copies; mask++) {
    const center = [...sample.center] as [number, number, number];
    const offset = [...(sample.offset ?? [0, 0, 0])] as [number, number, number];
    axes.forEach((axis, bit) => {
      if ((mask & (1 << bit)) === 0) return;
      const index = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
      center[index] *= -1;
      offset[index] *= -1;
    });
    const key = center.map((value) => value.toFixed(6)).join(':');
    if (seen.has(key)) continue;
    seen.add(key);
    const result = sculptCmMesh(out, { ...sample, center, offset });
    out = result.mesh;
    changed ||= result.changed;
    topologyChanged ||= result.topologyChanged;
    for (const index of result.affectedVerts) affected.add(index);
  }
  return { mesh: out, affectedVerts: [...affected], changed, topologyChanged };
}
