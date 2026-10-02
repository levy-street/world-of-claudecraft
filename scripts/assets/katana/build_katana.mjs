// Procedural katana GLBs (three colorways), grip at the origin, blade up +Y,
// edge facing +Z, matching the shipped sword convention (sword_b: grip at 0,
// blade tip near y 1.4). Writes raw GLBs to tmp/asset_src/katana_<v>.glb, which
// then go through `pipeline.mjs weapon --model-file` for normalize + icon +
// registration.
//
//   node scripts/assets/katana/build_katana.mjs
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';

const OUT = resolve('tmp/asset_src');
mkdirSync(OUT, { recursive: true });

const VARIANTS = {
  katana_sword_a: {
    blade: [0.82, 0.84, 0.88],
    edge: [0.95, 0.96, 0.98],
    wrap: [0.08, 0.08, 0.1],
    diamond: [0.75, 0.72, 0.62],
    guard: [0.22, 0.2, 0.2],
    metal: [0.55, 0.5, 0.42],
  },
  katana_sword_b: {
    blade: [0.78, 0.84, 0.92],
    edge: [0.9, 0.96, 1.0],
    wrap: [0.1, 0.2, 0.55],
    diamond: [0.85, 0.86, 0.9],
    guard: [0.62, 0.64, 0.7],
    metal: [0.75, 0.77, 0.82],
  },
  katana_sword_c: {
    blade: [0.25, 0.08, 0.1],
    edge: [1.0, 0.35, 0.3],
    wrap: [0.55, 0.06, 0.08],
    diamond: [0.95, 0.75, 0.25],
    guard: [0.9, 0.68, 0.2],
    metal: [0.95, 0.75, 0.25],
    glow: [1.0, 0.25, 0.15],
  },
};

// Tiny mesh builder: flat-shaded triangles with per-part color buckets.
function builder() {
  const parts = new Map();
  const tri = (key, a, b, c) => {
    let p = parts.get(key);
    if (!p) parts.set(key, (p = []));
    p.push(a, b, c);
  };
  const quad = (key, a, b, c, d) => {
    tri(key, a, b, c);
    tri(key, a, c, d);
  };
  return { parts, tri, quad };
}

// A box-ish prism from a bottom ring and a top ring of 4+ points (same count).
function loft(b, key, lo, hi) {
  const n = lo.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    b.quad(key, lo[i], lo[j], hi[j], hi[i]);
  }
}
function cap(b, key, ring, flip) {
  for (let i = 1; i < ring.length - 1; i++)
    flip ? b.tri(key, ring[0], ring[i + 1], ring[i]) : b.tri(key, ring[0], ring[i], ring[i + 1]);
}
const ringAt = (y, rx, rz, n, zOff = 0, rot = 0) =>
  Array.from({ length: n }, (_, i) => {
    const a = rot + (i / n) * Math.PI * 2;
    return [Math.cos(a) * rx, y, Math.sin(a) * rz + zOff];
  });

function buildKatana(v) {
  const b = builder();
  // --- handle (tsuka): an oval cylinder with diamond wrap bands ---
  const H0 = -0.36;
  const H1 = -0.02;
  const SEG = 8;
  for (let k = 0; k < SEG; k++) {
    const y0 = H0 + ((H1 - H0) * k) / SEG;
    const y1 = H0 + ((H1 - H0) * (k + 1)) / SEG;
    const lo = ringAt(y0, 0.026, 0.034, 8);
    const hi = ringAt(y1, 0.026, 0.034, 8);
    loft(b, k % 2 ? 'wrap' : 'diamond', lo, hi);
  }
  // pommel (kashira)
  {
    const lo = ringAt(H0 - 0.03, 0.022, 0.03, 8);
    const hi = ringAt(H0, 0.03, 0.038, 8);
    loft(b, 'metal', lo, hi);
    cap(b, 'metal', lo, true);
  }
  // --- guard (tsuba): a flat rounded-square disc ---
  {
    const lo = ringAt(-0.02, 0.085, 0.07, 12, 0, Math.PI / 12);
    const hi = ringAt(0.0, 0.085, 0.07, 12, 0, Math.PI / 12);
    loft(b, 'guard', lo, hi);
    cap(b, 'guard', lo, true);
    cap(b, 'guard', hi, false);
  }
  // collar (habaki)
  {
    const lo = ringAt(0.0, 0.02, 0.03, 4, 0, Math.PI / 4);
    const hi = ringAt(0.05, 0.018, 0.028, 4, 0, Math.PI / 4);
    loft(b, 'metal', lo, hi);
  }
  // --- blade: curved (sori), spine at -Z, edge at +Z, tapering to a kissaki ---
  const B0 = 0.05;
  const B1 = 1.32;
  const STEPS = 14;
  const curve = (t) => -0.07 * t * t; // spine curves back
  const width = (t) => 0.034 - 0.008 * t;
  const thick = (t) => 0.008 - 0.003 * t;
  const sec = (t) => {
    const y = B0 + (B1 - B0) * t;
    const z = curve(t);
    const w = width(t);
    const th = thick(t);
    // 4-point section: spine, side +x, edge, side -x (edge bevel at +Z)
    return {
      spine: [0, y, z - w * 0.5],
      left: [th, y, z + w * 0.05],
      edge: [0, y, z + w * 0.5],
      right: [-th, y, z + w * 0.05],
    };
  };
  for (let s = 0; s < STEPS; s++) {
    const a = sec(s / STEPS);
    const c = sec((s + 1) / STEPS);
    b.quad('blade', a.spine, a.left, c.left, c.spine);
    b.quad('blade', a.right, a.spine, c.spine, c.right);
    b.quad('edge', a.left, a.edge, c.edge, c.left);
    b.quad('edge', a.edge, a.right, c.right, c.edge);
  }
  // kissaki tip: the last section closes to a point leaning toward the edge
  {
    const a = sec(1);
    const tip = [0, B1 + 0.09, curve(1) + 0.004];
    b.tri('blade', a.spine, a.left, tip);
    b.tri('blade', a.right, a.spine, tip);
    b.tri('edge', a.left, a.edge, tip);
    b.tri('edge', a.edge, a.right, tip);
  }
  return b.parts;
}

function normalsFor(pos) {
  const n = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i += 9) {
    const ax = pos[i + 3] - pos[i],
      ay = pos[i + 4] - pos[i + 1],
      az = pos[i + 5] - pos[i + 2];
    const bx = pos[i + 6] - pos[i],
      by = pos[i + 7] - pos[i + 1],
      bz = pos[i + 8] - pos[i + 2];
    let nx = ay * bz - az * by,
      ny = az * bx - ax * bz,
      nz = ax * by - ay * bx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    for (let k = 0; k < 3; k++) n.set([nx, ny, nz], i + k * 3);
  }
  return n;
}

const io = new NodeIO();
for (const [name, v] of Object.entries(VARIANTS)) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const mesh = doc.createMesh(name);
  const parts = buildKatana(v);
  const look = {
    blade: { color: v.blade, metal: 0.9, rough: 0.25 },
    edge: { color: v.edge, metal: 0.95, rough: 0.15, glow: v.glow },
    wrap: { color: v.wrap, metal: 0, rough: 0.9 },
    diamond: { color: v.diamond, metal: 0.1, rough: 0.8 },
    guard: { color: v.guard, metal: 0.7, rough: 0.4 },
    metal: { color: v.metal, metal: 0.8, rough: 0.35 },
  };
  for (const [key, verts] of parts) {
    const pos = new Float32Array(verts.flat());
    const L = look[key];
    const material = doc
      .createMaterial(`${name}_${key}`)
      .setBaseColorFactor([...L.color, 1])
      .setMetallicFactor(L.metal)
      .setRoughnessFactor(L.rough);
    if (L.glow) material.setEmissiveFactor(L.glow);
    const prim = doc
      .createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(pos).setBuffer(buffer))
      .setAttribute(
        'NORMAL',
        doc.createAccessor().setType('VEC3').setArray(normalsFor(pos)).setBuffer(buffer),
      )
      .setMaterial(material);
    mesh.addPrimitive(prim);
  }
  const node = doc.createNode(name).setMesh(mesh);
  doc.createScene('Scene').addChild(node);
  const out = resolve(OUT, `${name}.glb`);
  await io.write(out, doc);
  console.log('wrote', out);
}
