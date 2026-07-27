// Shrinkwrap-outward: push armor-shell vertices that sit INSIDE the wearer's
// body surface out along the body's normal, so boots/limbs never poke through.
// Works in skinned REST space; corrected vertices are pushed back into bind
// space through the inverse of their blend matrix (exact, per vertex).
// The body reference is the UNION of all wearer bodies passed in, so one shell
// clears every character it can be equipped on.
//
// Usage:
//   node fit_shell.mjs <set.glb> <out.glb> <slotNodeRegex> <bodyMeshRegex> <margin> <body1.glb> [body2.glb ...]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const [setPath, outPath, slotRegexArg, bodyRegexArg, marginArg, ...bodyPaths] =
  process.argv.slice(2);
const slotRegex = new RegExp(slotRegexArg);
const bodyRegex = new RegExp(bodyRegexArg);
const margin = Number(marginArg);
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
const applyM = (m, [x, y, z]) => [
  m[0] * x + m[4] * y + m[8] * z + m[12],
  m[1] * x + m[5] * y + m[9] * z + m[13],
  m[2] * x + m[6] * y + m[10] * z + m[14],
];
const applyRot = (m, [x, y, z]) => [
  m[0] * x + m[4] * y + m[8] * z,
  m[1] * x + m[5] * y + m[9] * z,
  m[2] * x + m[6] * y + m[10] * z,
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

function worldMap(root) {
  const w = new Map();
  const worldOf = (node) => {
    if (w.has(node)) return w.get(node);
    const p = node.getParentNode?.();
    const m = p ? mul(worldOf(p), node.getMatrix()) : node.getMatrix();
    w.set(node, m);
    return m;
  };
  return worldOf;
}

// --- collect body surface points + normals (rest space, all bodies) ---------
const bodyPts = [];
const bodyNrm = [];
for (const bodyPath of bodyPaths) {
  const doc = await io.read(bodyPath);
  const worldOf = worldMap(doc.getRoot());
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh || !node.getSkin() || !bodyRegex.test(node.getName())) continue;
    const skin = node.getSkin();
    const acc = skin.getInverseBindMatrices();
    const el = new Array(16);
    const mats = skin.listJoints().map((j, i) => {
      acc.getElement(i, el);
      return mul(worldOf(j), [...el]);
    });
    for (const prim of mesh.listPrimitives()) {
      const pa = prim.getAttribute('POSITION');
      const na = prim.getAttribute('NORMAL');
      const ja = prim.getAttribute('JOINTS_0');
      const wa = prim.getAttribute('WEIGHTS_0');
      const pe = [0, 0, 0];
      const ne = [0, 0, 0];
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
        bodyPts.push(applyM(blend, pe));
        if (na) {
          na.getElement(v, ne);
          const r = applyRot(blend, ne);
          const len = Math.hypot(...r) || 1;
          bodyNrm.push([r[0] / len, r[1] / len, r[2] / len]);
        } else {
          bodyNrm.push([0, 1, 0]);
        }
      }
    }
  }
}
console.log(`body reference: ${bodyPts.length} verts from ${bodyPaths.length} bodies`);

// --- push shell verts outward ------------------------------------------------
const doc = await io.read(setPath);
const worldOf = worldMap(doc.getRoot());
let pushed = 0;
let total = 0;
for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh();
  if (!mesh || !node.getSkin() || !slotRegex.test(node.getName())) continue;
  const skin = node.getSkin();
  const acc = skin.getInverseBindMatrices();
  const el = new Array(16);
  const mats = skin.listJoints().map((j, i) => {
    acc.getElement(i, el);
    return mul(worldOf(j), [...el]);
  });
  for (const prim of mesh.listPrimitives()) {
    const pa = prim.getAttribute('POSITION');
    const ja = prim.getAttribute('JOINTS_0');
    const wa = prim.getAttribute('WEIGHTS_0');
    const pe = [0, 0, 0];
    const je = [0, 0, 0, 0];
    const we = [0, 0, 0, 0];
    for (let v = 0; v < pa.getCount(); v++) {
      total++;
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
      const rest = applyM(blend, pe);
      // nearest body vertex
      let bi = -1;
      let bd = Infinity;
      for (let u = 0; u < bodyPts.length; u++) {
        const q = bodyPts[u];
        const d =
          (rest[0] - q[0]) ** 2 + (rest[1] - q[1]) ** 2 + (rest[2] - q[2]) ** 2;
        if (d < bd) {
          bd = d;
          bi = u;
        }
      }
      const b = bodyPts[bi];
      const n = bodyNrm[bi];
      const depth =
        (rest[0] - b[0]) * n[0] + (rest[1] - b[1]) * n[1] + (rest[2] - b[2]) * n[2];
      // Only correct verts NEAR the body that sit under the surface + margin.
      if (Math.sqrt(bd) < 0.12 && depth < margin) {
        const push = margin - depth;
        const rest2 = [rest[0] + n[0] * push, rest[1] + n[1] * push, rest[2] + n[2] * push];
        pa.setElement(v, applyM(invert(blend), rest2));
        pushed++;
      }
    }
  }
}
console.log(`pushed ${pushed}/${total} shell verts outward (margin ${margin})`);
await io.write(outPath, doc);
console.log('wrote', outPath);
