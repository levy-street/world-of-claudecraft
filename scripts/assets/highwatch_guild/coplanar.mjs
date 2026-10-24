// Z-fighting audit for the Highwatch guild (written for the retired Highwatch manor, whose kit
// the guild was built on): every pair of triangles that lie in (nearly) the same plane, face
// the same way and overlap in area flickers in the depth buffer (a rug on the floor, a banner
// on a wall, a tile course on the roof base). The build lifts such pieces by a real gap; this
// finds any pair that is still closer than that, over the shipped GLB, so a test can pin what
// is left and catch anything new (tests/highwatch_guild_asset.test.ts).
//
//   node scripts/assets/highwatch_guild/coplanar.mjs [path/to/guild.glb]

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

/** Defaults: within a degree, closer than 3 cm, overlapping by more than 6 x 6 cm (a sliver
 * narrower than that at a joint reads as an edge, not a flicker). */
export const COPLANAR_LIMITS = { angleDeg: 1, gap: 0.03, minArea: 0.004 };

function transformPoint(m, p) {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

/** A triangle's place in the canonical order: its part, then where it sits (its centre, then
 *  its corners, to a tenth of a millimetre), then its material and colour. */
function canonicalKey(t) {
  const centre = [0, 1, 2].map((k) => ((t.a[k] + t.b[k] + t.c[k]) / 3).toFixed(4)).join(',');
  const corners = [t.a, t.b, t.c].map((p) => p.map((v) => v.toFixed(4)).join(',')).join(';');
  const color = t.color.map((v) => v.toFixed(4)).join(',');
  return `${t.part}|${centre}|${corners}|${t.material}|${color}`;
}

/**
 * World-space triangles of every mesh in the document: { part, material, a, b, c }, in a
 * canonical order (by part, then by where each sits), so the audit weighs the same model the
 * same way however its faces are split into primitives: a texture pass that files one
 * builder's material under several painted ones reorders them, and the audit's cover test
 * breaks ties in the order it meets surfaces.
 */
export function documentTriangles(doc) {
  const out = [];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      if (!pos) continue;
      const col = prim.getAttribute('COLOR_0');
      const cel = [];
      const colorAt = (i) => (col ? col.getElement(i, cel).slice(0, 3) : [1, 1, 1]);
      const verts = [];
      const el = [];
      for (let i = 0; i < pos.getCount(); i++) verts.push(transformPoint(m, pos.getElement(i, el)));
      const idx = prim.getIndices();
      const count = idx ? idx.getCount() : verts.length;
      const at = (i) => (idx ? idx.getScalar(i) : i);
      const material = prim.getMaterial()?.getName() ?? '';
      for (let i = 0; i + 2 < count; i += 3) {
        out.push({
          part: node.getName(),
          material,
          a: verts[at(i)],
          b: verts[at(i + 1)],
          c: verts[at(i + 2)],
          color: [at(i), at(i + 1), at(i + 2)]
            .map(colorAt)
            .reduce((acc, c) => acc.map((v, k) => v + c[k] / 3), [0, 0, 0]),
        });
      }
    }
  }
  const keyed = out.map((t) => [canonicalKey(t), t]);
  keyed.sort((p, q) => (p[0] < q[0] ? -1 : p[0] > q[0] ? 1 : 0));
  return keyed.map((entry) => entry[1]);
}

const sub = (p, q) => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
const cross = (p, q) => [
  p[1] * q[2] - p[2] * q[1],
  p[2] * q[0] - p[0] * q[2],
  p[0] * q[1] - p[1] * q[0],
];

function polygonArea(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    s += p[0] * q[1] - q[0] * p[1];
  }
  return s / 2;
}

/** The intersection of two convex counter-clockwise 2D polygons. */
function clipPolygon(subject, clip) {
  let out = subject;
  for (let i = 0; i < clip.length && out.length; i++) {
    const a = clip[i];
    const b = clip[(i + 1) % clip.length];
    const side = (p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    const input = out;
    out = [];
    for (let j = 0; j < input.length; j++) {
      const p = input[j];
      const q = input[(j + 1) % input.length];
      const sp = side(p);
      const sq = side(q);
      if (sp >= 0) out.push(p);
      if (sp >= 0 !== sq >= 0) {
        const t = sp / (sp - sq);
        out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      }
    }
  }
  return out;
}

function prepare(tri) {
  const n = cross(sub(tri.b, tri.a), sub(tri.c, tri.a));
  const len = Math.hypot(n[0], n[1], n[2]);
  if (len < 1e-9) return null;
  const normal = [n[0] / len, n[1] / len, n[2] / len];
  return { ...tri, normal, d: dot(normal, tri.a), area: len / 2 };
}

/**
 * Pairs of same-facing triangles within `angleDeg`, whose planes sit closer than `gap` and
 * whose areas overlap by more than `minArea` (projected on the first one's plane).
 */
export function findCoplanarOverlaps(triangles, limits = COPLANAR_LIMITS) {
  const { angleDeg, gap, minArea } = { ...COPLANAR_LIMITS, ...limits };
  const cosLimit = Math.cos((angleDeg * Math.PI) / 180);
  const tris = triangles.map(prepare).filter((t) => t && t.area > minArea / 4);
  // bucket by quantized normal, then sort each bucket by plane offset
  const NQ = 20;
  const buckets = new Map();
  const key = (n) => n.map((v) => Math.round(v * NQ)).join(',');
  for (const t of tris) {
    const k = key(t.normal);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(t);
  }
  const hits = [];
  const seen = new Set();
  tris.forEach((t, i) => {
    t.id = i;
  });
  for (const [k, list] of buckets) {
    // neighbouring normal buckets, so a tilt across a bucket edge is still compared
    const base = k.split(',').map(Number);
    const near = [];
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const other = buckets.get(`${base[0] + dx},${base[1] + dy},${base[2] + dz}`);
          if (other) near.push(...other);
        }
    near.sort((p, q) => p.d - q.d);
    const ds = near.map((t) => t.d);
    for (const t of list) {
      // binary search the first candidate within the gap
      let lo = 0;
      let hi = ds.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (ds[mid] < t.d - gap) lo = mid + 1;
        else hi = mid;
      }
      for (let j = lo; j < near.length && near[j].d <= t.d + gap; j++) {
        const u = near[j];
        if (u.id <= t.id) continue;
        const pair = `${t.id}:${u.id}`;
        if (seen.has(pair)) continue;
        seen.add(pair);
        if (dot(t.normal, u.normal) < cosLimit) continue;
        // the same material in the same colour: a fight between twins draws the same pixel
        if (
          t.material === u.material &&
          Math.max(...t.color.map((v, k) => Math.abs(v - u.color[k]))) < 0.03
        ) {
          continue;
        }
        // u's corners must sit within the gap of t's plane (not only u's own plane offset)
        const off = [u.a, u.b, u.c].map((p) => dot(t.normal, p) - t.d);
        if (Math.max(...off.map(Math.abs)) >= gap) continue;
        // project both on t's plane
        const ax = Math.abs(t.normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
        const e1 = cross(t.normal, ax);
        const l1 = Math.hypot(...e1);
        const u1 = e1.map((v) => v / l1);
        const v1 = cross(t.normal, u1);
        const proj = (p) => [dot(p, u1), dot(p, v1)];
        const ccw = (poly) => (polygonArea(poly) < 0 ? poly.reverse() : poly);
        const P = ccw([t.a, t.b, t.c].map(proj));
        const Q = ccw([u.a, u.b, u.c].map(proj));
        const poly = clipPolygon(P, Q);
        const area = poly.length >= 3 ? Math.abs(polygonArea(poly)) : 0;
        if (area > minArea) {
          // sample points of the shared area, back on t's plane
          const cx = poly.reduce((acc, q) => acc + q[0], 0) / poly.length;
          const cy = poly.reduce((acc, q) => acc + q[1], 0) / poly.length;
          const to3 = (x, y) => [0, 1, 2].map((k) => u1[k] * x + v1[k] * y + t.normal[k] * t.d);
          const samples = [
            to3(cx, cy),
            ...poly.map((q) => to3(cx + (q[0] - cx) * 0.8, cy + (q[1] - cy) * 0.8)),
          ];
          // the same points on u's plane (along t's normal), to test that both faces show there
          const lift = (q) => {
            const k = (dot(u.normal, u.a) - dot(u.normal, q)) / dot(u.normal, t.normal);
            return q.map((v, i) => v + t.normal[i] * k);
          };
          const samplesU = samples.map(lift);
          hits.push({
            parts: [`${t.part}/${t.material}`, `${u.part}/${u.material}`],
            gap: Math.max(...off.map(Math.abs)),
            area,
            samples,
            samplesU,
            ids: [t.id, u.id],
            at: t.a.map((v) => Math.round(v * 100) / 100),
            normal: t.normal.map((v) => Math.round(v * 100) / 100),
            normal3: t.normal,
            boxes: [t, u].map((q) => {
              const r = (k) => [q.a, q.b, q.c].map((p) => p[k]);
              return [0, 1, 2].map((k) =>
                [Math.min(...r(k)), Math.max(...r(k))].map((v) => Math.round(v * 1000) / 1000),
              );
            }),
          });
        }
      }
    }
  }
  return hits;
}

/**
 * Drops the overlaps no camera can see: every sample of the shared area is either covered
 * flush by a surface facing back at it (a block sat on a slab's top, a box on a core's face),
 * or sits inside a closed solid (the next surface out along the normal faces away from it).
 */
export function visibleOverlaps(triangles, hits, limits = COPLANAR_LIMITS) {
  const { gap } = { ...COPLANAR_LIMITS, ...limits };
  const tris = triangles.map(prepare).map((t, i) => t && { ...t, id: i });
  // A triangle of a closed solid shares every edge with another triangle of its part; a lone
  // flat face (a flag, a rug, a skin) does not, and hides nothing round its own edges, so only
  // closed surfaces count as covers below.
  const q = (p) => p.map((v) => Math.round(v * 2000)).join(',');
  const edgeKey = (part, p0, p1) => {
    const k0 = q(p0);
    const k1 = q(p1);
    return `${part}|${k0 < k1 ? `${k0}|${k1}` : `${k1}|${k0}`}`;
  };
  const edges = new Map();
  for (const t of tris) {
    if (!t) continue;
    for (const [p0, p1] of [
      [t.a, t.b],
      [t.b, t.c],
      [t.c, t.a],
    ]) {
      const k = edgeKey(t.part, p0, p1);
      edges.set(k, (edges.get(k) ?? 0) + 1);
    }
  }
  for (const t of tris) {
    if (!t) continue;
    t.closed = [
      [t.a, t.b],
      [t.b, t.c],
      [t.c, t.a],
    ].every(([p0, p1]) => (edges.get(edgeKey(t.part, p0, p1)) ?? 0) >= 2);
  }
  const CELL = 1;
  const grid = new Map();
  const cellKey = (x, y, z) => `${x},${y},${z}`;
  for (const t of tris) {
    if (!t) continue;
    const lo = [0, 1, 2].map((k) => Math.floor(Math.min(t.a[k], t.b[k], t.c[k]) / CELL));
    const hi = [0, 1, 2].map((k) => Math.floor(Math.max(t.a[k], t.b[k], t.c[k]) / CELL));
    for (let x = lo[0]; x <= hi[0]; x++)
      for (let y = lo[1]; y <= hi[1]; y++)
        for (let z = lo[2]; z <= hi[2]; z++) {
          const k = cellKey(x, y, z);
          if (!grid.has(k)) grid.set(k, []);
          grid.get(k).push(t);
        }
  }
  const REACH = 1.5;
  // the nearest surface along the ray from p in direction n, skipping the coplanar pair
  function firstHit(p, n, skip) {
    let best = null;
    const seen = new Set();
    for (let s = 0; s <= REACH + CELL; s += CELL / 2) {
      const q = [p[0] + n[0] * s, p[1] + n[1] * s, p[2] + n[2] * s];
      const k = cellKey(...q.map((v) => Math.floor(v / CELL)));
      for (const t of grid.get(k) ?? []) {
        if (seen.has(t.id) || skip.has(t.id)) continue;
        seen.add(t.id);
        const denom = dot(t.normal, n);
        if (Math.abs(denom) < 1e-6) continue;
        const dist = (t.d - dot(t.normal, p)) / denom;
        if (dist < -0.002 || dist > REACH) continue;
        const x = [p[0] + n[0] * dist, p[1] + n[1] * dist, p[2] + n[2] * dist];
        // inside the triangle (same-side test on each edge)
        const e = [
          [t.a, t.b],
          [t.b, t.c],
          [t.c, t.a],
        ];
        if (!e.every(([a, b]) => dot(cross(sub(b, a), sub(x, a)), t.normal) >= -1e-7)) continue;
        if (!best || dist < best.dist) best = { dist, facing: denom, closed: t.closed };
      }
    }
    return best;
  }
  return hits.filter((h) => {
    const skip = new Set(h.ids);
    const n = h.normal3;
    const shows = (p) => {
      const hit = firstHit(p, n, skip);
      if (!hit) return true;
      // a face lying flush on the spot, facing back at it, hides it (a floor over a sill's
      // underside), whether or not that face closes a solid
      if (hit.facing < 0 && hit.dist < 0.01) return false;
      if (!hit.closed) return true; // an open face further off hides only its own footprint
      if (hit.facing < 0 && hit.dist < gap + 0.1) return false; // covered (no eye fits between)
      if (hit.facing > 0) return false; // inside a solid
      return true;
    };
    // a fight needs both faces showing at the same spot
    return h.samples.some((p, i) => shows(p) && shows(h.samplesU[i]));
  });
}

export async function readManor(file) {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  return io.read(file);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file =
    process.argv[2] ??
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../../public/models/tidehold/highwatch/guild.glb',
    );
  const doc = await readManor(file);
  const tris = documentTriangles(doc);
  const all = findCoplanarOverlaps(tris);
  const hits = visibleOverlaps(tris, all);
  console.log(`${all.length} overlaps in all, ${hits.length} visible`);
  const groups = new Map();
  for (const h of hits) {
    const k = `${[...h.parts].sort().join(' x ')} n=${h.normal.join(',')}`;
    const g = groups.get(k) ?? { count: 0, area: 0, at: h.at, gap: h.gap };
    g.count++;
    g.area += h.area;
    groups.set(k, g);
  }
  console.log(`${tris.length} triangles, ${hits.length} coplanar overlaps`);
  for (const [k, g] of [...groups].sort((p, q) => q[1].area - p[1].area)) {
    console.log(
      `${g.count.toString().padStart(5)} ${g.area.toFixed(3).padStart(9)} m2  ${k}  e.g. ${g.at.join(',')} gap ${g.gap.toFixed(4)}`,
    );
  }
}
