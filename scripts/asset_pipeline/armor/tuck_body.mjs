// Tucked-body variants: radially compress a character's Torso mesh toward the
// body axis (rest space, exact inverse-blend back to bind) so garments do not
// bulge out of an equipped breastplate's side openings. The picker swaps the
// live Torso geometry for this one while a forged breastplate is worn, keeping
// whatever texture variant the user selected (geometry-only swap).
// Usage: node tuck_body.mjs <char.glb> <out.glb> <radialScale>
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const [inPath, outPath, scaleArg] = process.argv.slice(2);
const c = Number(scaleArg);
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

const mul = (a, b) => {
  const o = new Array(16).fill(0);
  for (let r = 0; r < 4; r++)
    for (let c2 = 0; c2 < 4; c2++)
      for (let k = 0; k < 4; k++) o[c2 * 4 + r] += a[k * 4 + r] * b[c2 * 4 + k];
  return o;
};
const applyM = (m, [x, y, z]) => [
  m[0] * x + m[4] * y + m[8] * z + m[12],
  m[1] * x + m[5] * y + m[9] * z + m[13],
  m[2] * x + m[6] * y + m[10] * z + m[14],
];
function invert(m) {
  const i = new Array(16);
  i[0]=m[5]*m[10]*m[15]-m[5]*m[11]*m[14]-m[9]*m[6]*m[15]+m[9]*m[7]*m[14]+m[13]*m[6]*m[11]-m[13]*m[7]*m[10];
  i[4]=-m[4]*m[10]*m[15]+m[4]*m[11]*m[14]+m[8]*m[6]*m[15]-m[8]*m[7]*m[14]-m[12]*m[6]*m[11]+m[12]*m[7]*m[10];
  i[8]=m[4]*m[9]*m[15]-m[4]*m[11]*m[13]-m[8]*m[5]*m[15]+m[8]*m[7]*m[13]+m[12]*m[5]*m[11]-m[12]*m[7]*m[9];
  i[12]=-m[4]*m[9]*m[14]+m[4]*m[10]*m[13]+m[8]*m[5]*m[14]-m[8]*m[6]*m[13]-m[12]*m[5]*m[10]+m[12]*m[6]*m[9];
  i[1]=-m[1]*m[10]*m[15]+m[1]*m[11]*m[14]+m[9]*m[2]*m[15]-m[9]*m[3]*m[14]-m[13]*m[2]*m[11]+m[13]*m[3]*m[10];
  i[5]=m[0]*m[10]*m[15]-m[0]*m[11]*m[14]-m[8]*m[2]*m[15]+m[8]*m[3]*m[14]+m[12]*m[2]*m[11]-m[12]*m[3]*m[10];
  i[9]=-m[0]*m[9]*m[15]+m[0]*m[11]*m[13]+m[8]*m[1]*m[15]-m[8]*m[3]*m[13]-m[12]*m[1]*m[11]+m[12]*m[3]*m[9];
  i[13]=m[0]*m[9]*m[14]-m[0]*m[10]*m[13]-m[8]*m[1]*m[14]+m[8]*m[2]*m[13]+m[12]*m[1]*m[10]-m[12]*m[2]*m[9];
  i[2]=m[1]*m[6]*m[15]-m[1]*m[7]*m[14]-m[5]*m[2]*m[15]+m[5]*m[3]*m[14]+m[13]*m[2]*m[7]-m[13]*m[3]*m[6];
  i[6]=-m[0]*m[6]*m[15]+m[0]*m[7]*m[14]+m[4]*m[2]*m[15]-m[4]*m[3]*m[14]-m[12]*m[2]*m[7]+m[12]*m[3]*m[6];
  i[10]=m[0]*m[5]*m[15]-m[0]*m[7]*m[13]-m[4]*m[1]*m[15]+m[4]*m[3]*m[13]+m[12]*m[1]*m[7]-m[12]*m[3]*m[5];
  i[14]=-m[0]*m[5]*m[14]+m[0]*m[6]*m[13]+m[4]*m[1]*m[14]-m[4]*m[2]*m[13]-m[12]*m[1]*m[6]+m[12]*m[2]*m[5];
  i[3]=-m[1]*m[6]*m[11]+m[1]*m[7]*m[10]+m[5]*m[2]*m[11]-m[5]*m[3]*m[10]-m[9]*m[2]*m[7]+m[9]*m[3]*m[6];
  i[7]=m[0]*m[6]*m[11]-m[0]*m[7]*m[10]-m[4]*m[2]*m[11]+m[4]*m[3]*m[10]+m[8]*m[2]*m[7]-m[8]*m[3]*m[6];
  i[11]=-m[0]*m[5]*m[11]+m[0]*m[7]*m[9]+m[4]*m[1]*m[11]-m[4]*m[3]*m[9]-m[8]*m[1]*m[7]+m[8]*m[3]*m[5];
  i[15]=m[0]*m[5]*m[10]-m[0]*m[6]*m[9]-m[4]*m[1]*m[10]+m[4]*m[2]*m[9]+m[8]*m[1]*m[6]-m[8]*m[2]*m[5];
  const det = m[0]*i[0]+m[1]*i[4]+m[2]*i[8]+m[3]*i[12];
  if (Math.abs(det) < 1e-12) throw new Error('singular');
  return i.map((v) => v / det);
}

const doc = await io.read(inPath);
for (const ext of doc.getRoot().listExtensionsUsed()) {
  if (ext.extensionName.includes('meshopt')) ext.dispose();
}
const root = doc.getRoot();
const w = new Map();
const worldOf = (node) => {
  if (w.has(node)) return w.get(node);
  const p = node.getParentNode?.();
  const m = p ? mul(worldOf(p), node.getMatrix()) : node.getMatrix();
  w.set(node, m);
  return m;
};
function restVerts(node) {
  const skin = node.getSkin();
  const acc = skin.getInverseBindMatrices();
  const el = new Array(16);
  const mats = skin.listJoints().map((j, i) => {
    acc.getElement(i, el);
    return mul(worldOf(j), [...el]);
  });
  const out = [];
  for (const prim of node.getMesh().listPrimitives()) {
    const pa = prim.getAttribute('POSITION');
    const ja = prim.getAttribute('JOINTS_0');
    const wa = prim.getAttribute('WEIGHTS_0');
    const pe = [0, 0, 0];
    const je = [0, 0, 0, 0];
    const we = [0, 0, 0, 0];
    for (let v = 0; v < pa.getCount(); v++) {
      pa.getElement(v, pe);
      ja.getElement(v, je);
      wa.getElement(v, we);
      let blend = null;
      for (let k = 0; k < 4; k++) {
        if (!we[k]) continue;
        const jm = mats[je[k]];
        if (!blend) blend = jm.map((x) => x * we[k]);
        else for (let t = 0; t < 16; t++) blend[t] += jm[t] * we[k];
      }
      out.push({ pa, v, blend, rest: applyM(blend, pe) });
    }
  }
  return out;
}

let touched = 0;
for (const node of root.listNodes()) {
  const mesh = node.getMesh();
  if (!mesh || !node.getSkin()) continue;
  if (node.getName() === 'Torso') {
    for (const it of restVerts(node)) {
      const r2 = [it.rest[0] * c, it.rest[1], 0.03 + (it.rest[2] - 0.03) * c];
      it.pa.setElement(it.v, applyM(invert(it.blend), r2));
      touched++;
    }
  } else if (node.getName() === 'Arms') {
    // Compress each arm radially toward its own hanging axis so bracer/sleeve
    // bulges tuck under gauntlets. Hands (the bottom of the hanging arm) are
    // exempt, with a smooth blend so no seam shows at the wrist.
    const verts = restVerts(node);
    for (const s of [-1, 1]) {
      const side = verts.filter((it) => (it.rest[0] < 0 ? -1 : 1) === s);
      if (!side.length) continue;
      const mean = [0, 1, 2].map((k) => side.reduce((a, it) => a + it.rest[k], 0) / side.length);
      const minY = Math.min(...side.map((it) => it.rest[1]));
      const maxY = Math.max(...side.map((it) => it.rest[1]));
      const handTop = minY + 0.16 * (maxY - minY);
      const blendTop = handTop + 0.05 * (maxY - minY);
      for (const it of side) {
        const y = it.rest[1];
        // 0 at/below handTop (no tuck), 1 above blendTop (full tuck)
        const t = Math.max(0, Math.min(1, (y - handTop) / (blendTop - handTop)));
        const f = 1 + (0.7 - 1) * t;
        const r2 = [
          mean[0] + (it.rest[0] - mean[0]) * f,
          y,
          mean[2] + (it.rest[2] - mean[2]) * f,
        ];
        it.pa.setElement(it.v, applyM(invert(it.blend), r2));
        touched++;
      }
    }
  } else if (node.getName() === 'Legs') {
    // Pants/garment on the legs tucks toward the body axis so it stays inside
    // an equipped greave set's skirt and shin shells (bound to the Greaves
    // slot in the picker, when the body's own boots are covered anyway).
    for (const it of restVerts(node)) {
      const r2 = [it.rest[0] * 0.8, it.rest[1], 0.03 + (it.rest[2] - 0.03) * 0.8];
      it.pa.setElement(it.v, applyM(invert(it.blend), r2));
      touched++;
    }
  }
}
await io.write(outPath, doc);
console.log(`tucked ${touched} torso+arm verts (radial ${c}) -> ${outPath}`);
