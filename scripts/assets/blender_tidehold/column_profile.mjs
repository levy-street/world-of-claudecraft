// Is the awning actually carried? Take a thin vertical column at a post centre
// and ask which heights inside it are OCCUPIED BY GEOMETRY, a triangle whose
// x/z bounds overlap the column and whose y range covers that height. The
// largest unoccupied run is the gap a player sees under a floating roof.
//
// (Do not do this by vertex spacing: a post is a long box with vertices only
// at its ends, so every post would read as one big gap.)
//
// READ THE SURFACE LIST, not just the gap: a kit post is a HOLLOW box, so the
// ray's biggest gap is usually its own interior. What matters is whether the
// list runs continuously from the post's top cap up to the roof's underside.
// Tavern B's east awning, before and after the 2026-09-22 rebuild:
//   before  ... 5.55 5.73 5.75 6.26 6.39 6.65 ... 7.06   post top 5.55, roof
//               underside ~7.1, the 5.09-6.39 member is a HouseBase moulding
//               that reaches neither
//   after   ... 5.36 5.36 5.37 5.92 5.92 6.39 6.60       post top 5.36 = beam
//               bottom, beam top 5.92 = roof underside: no air anywhere
//
//   node scripts/assets/blender_tidehold/column_profile.mjs <glb> <x> <z> [<x> <z> ...]   (model yards)
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dequantize } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';

await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const mul = (a, b) => {
  const o = new Array(16).fill(0);
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++)
      for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};
const xf = (m, p) => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
];

const doc = await io.read(process.argv[2]);
await doc.transform(dequantize());
const tris = [];
const walk = (n, m0) => {
  const m = mul(m0, n.getMatrix());
  const mesh = n.getMesh();
  if (mesh)
    for (const pr of mesh.listPrimitives()) {
      const a = pr.getAttribute('POSITION');
      if (!a) continue;
      const idx = pr.getIndices();
      const cnt = idx ? idx.getCount() : a.getCount();
      const gi = (i) => (idx ? idx.getScalar(i) : i);
      const e = [0, 0, 0];
      for (let t = 0; t + 2 < cnt; t += 3) {
        const v = [];
        for (let k = 0; k < 3; k++) {
          a.getElement(gi(t + k), e);
          v.push(xf(m, e));
        }
        tris.push(v);
      }
    }
  for (const c of n.listChildren()) walk(c, m);
};
const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
for (const s of doc.getRoot().listScenes()) for (const n of s.listChildren()) walk(n, I);

const RAYS = [
  [0, 0],
  [0.12, 0.12],
  [-0.12, -0.12],
  [0.12, -0.12],
  [-0.12, 0.12],
];
function hitsAt(px, pz) {
  const ys = [];
  for (const t of tris) {
    const [a, b, c] = t;
    const d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
    if (Math.abs(d) < 1e-9) continue; // triangle seen edge-on
    const w0 = ((b[2] - c[2]) * (px - c[0]) + (c[0] - b[0]) * (pz - c[2])) / d;
    const w1 = ((c[2] - a[2]) * (px - c[0]) + (a[0] - c[0]) * (pz - c[2])) / d;
    const w2 = 1 - w0 - w1;
    if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
    ys.push(w0 * a[1] + w1 * b[1] + w2 * c[1]);
  }
  return ys.sort((x, y) => x - y);
}

for (let i = 3; i + 1 < process.argv.length; i += 2) {
  const px = +process.argv[i],
    pz = +process.argv[i + 1];
  // Five rays through the column: one down the middle and one at each corner,
  // so a ray that happens to slip between two members is not the whole story.
  let best = null;
  for (const [dx, dz] of RAYS) {
    const ys = hitsAt(px + dx, pz + dz);
    if (ys.length < 2) continue;
    let gap = 0,
      at = 0;
    for (let k = 1; k < ys.length; k++) {
      if (ys[k] - ys[k - 1] > gap) {
        gap = ys[k] - ys[k - 1];
        at = ys[k - 1];
      }
    }
    if (!best || gap < best.gap) best = { gap, at, ys, dx, dz };
  }
  if (!best) {
    console.log(`(${px.toFixed(2)}, ${pz.toFixed(2)}): no ray hit anything`);
    continue;
  }
  const top = best.ys[best.ys.length - 1];
  console.log(
    `(${px.toFixed(2).padStart(7)}, ${pz.toFixed(2).padStart(6)}): ${best.ys.length} surfaces, ` +
      `y ${best.ys[0].toFixed(2)}..${top.toFixed(2)}, biggest air gap ${best.gap.toFixed(2)} yd above y ${best.at.toFixed(2)}`,
  );
  console.log(`        surfaces: ${best.ys.map((v) => v.toFixed(2)).join(' ')}`);
}
