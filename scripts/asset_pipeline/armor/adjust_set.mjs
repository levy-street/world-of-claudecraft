// Exact per-vertex resize of a skinned armor set: compute each vertex's REST
// position (jointWorldRest * IBM blend), scale it about the ground/center
// anchor, and push it back into bind space through the inverse of that
// vertex's blend matrix. Only Set_* nodes are touched.
// Usage: node adjust_set.mjs <in.glb> <out.glb> <scale> [anchorY] [shiftY] [nodeRegex] [shiftZ]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const [
  inPath,
  outPath,
  scaleArg,
  anchorYArg = '0',
  shiftYArg = '0',
  nodeRegexArg = '^Set_',
  shiftZArg = '0',
] = process.argv.slice(2);
const c = Number(scaleArg);
const anchorY = Number(anchorYArg);
const shiftY = Number(shiftYArg);
const shiftZ = Number(shiftZArg);
const nodeRegex = new RegExp(nodeRegexArg);
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
const root = doc.getRoot();
const w = new Map();
const worldOf = (node) => {
  if (w.has(node)) return w.get(node);
  const p = node.getParentNode?.();
  const m = p ? mul(worldOf(p), node.getMatrix()) : node.getMatrix();
  w.set(node, m);
  return m;
};
let touched = 0;
for (const node of root.listNodes()) {
  const mesh = node.getMesh();
  if (!mesh || !node.getSkin() || !nodeRegex.test(node.getName())) continue;
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
      const rest2 = [
        rest[0] * c,
        (rest[1] - anchorY) * c + anchorY + shiftY,
        rest[2] * c + shiftZ,
      ];
      pa.setElement(v, applyM(invert(blend), rest2));
      touched++;
    }
  }
}
await io.write(outPath, doc);
console.log(`adjusted ${touched} verts (scale ${c}) -> ${outPath}`);
