// Transplant a head mesh from one character onto the warrior-family skeleton
// as an equippable alternative head. The donor head's skinned-rest geometry is
// scaled/centered onto the target's head rest bbox, weights are copied from
// the target's own Head vertices (nearest neighbor), and positions are pushed
// into the target bind space through the inverse blend, exactly like the
// forged-set pipeline. Output: a GLB with one Set_Head node.
// Usage: node transplant_head.mjs <donor.glb> <donorHeadNode> <target.glb> <out.glb> [scaleMul]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const [donorPath, donorNode, targetPath, outPath, scaleMulArg] = process.argv.slice(2);
const scaleMul = Number(scaleMulArg ?? 1) || 1;
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
const worldMap = (root) => {
  const w = new Map();
  const worldOf = (node) => {
    if (w.has(node)) return w.get(node);
    const p = node.getParentNode?.();
    const m = p ? mul(worldOf(p), node.getMatrix()) : node.getMatrix();
    w.set(node, m);
    return m;
  };
  return worldOf;
};
const skinMats = (node, worldOf) => {
  const skin = node.getSkin();
  const acc = skin.getInverseBindMatrices();
  const el = new Array(16);
  return skin.listJoints().map((j, i) => {
    acc.getElement(i, el);
    return mul(worldOf(j), [...el]);
  });
};
function readRest(node, worldOf) {
  const mats = skinMats(node, worldOf);
  const prim = node.getMesh().listPrimitives()[0];
  const read = (name, comps) => {
    const acc = prim.getAttribute(name);
    if (!acc) return null;
    const out = new Float32Array(acc.getCount() * comps);
    const e = new Array(comps);
    for (let i = 0; i < acc.getCount(); i++) {
      acc.getElement(i, e);
      for (let k = 0; k < comps; k++) out[i * comps + k] = e[k];
    }
    return out;
  };
  const pos = read('POSITION', 3);
  const nrm = read('NORMAL', 3);
  const uv = read('TEXCOORD_0', 2);
  const j = read('JOINTS_0', 4);
  const w2 = read('WEIGHTS_0', 4);
  const n = pos.length / 3;
  const rest = new Float32Array(n * 3);
  const rnrm = nrm ? new Float32Array(n * 3) : null;
  for (let v = 0; v < n; v++) {
    let blend = null;
    for (let k = 0; k < 4; k++) {
      const wgt = w2[v * 4 + k];
      if (!wgt) continue;
      const jm = mats[j[v * 4 + k]];
      if (!blend) blend = jm.map((x) => x * wgt);
      else for (let t = 0; t < 16; t++) blend[t] += jm[t] * wgt;
    }
    rest.set(applyM(blend, [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]]), v * 3);
    if (nrm) {
      const o = applyM(blend, [0, 0, 0]);
      const q = applyM(blend, [nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]]);
      const r = [q[0] - o[0], q[1] - o[1], q[2] - o[2]];
      const len = Math.hypot(...r) || 1;
      rnrm.set([r[0] / len, r[1] / len, r[2] / len], v * 3);
    }
  }
  const idx = prim.getIndices();
  const tex = prim.getMaterial()?.getBaseColorTexture();
  return {
    rest,
    nrm: rnrm,
    uv,
    j,
    w: w2,
    indices: idx ? Array.from(idx.getArray()) : null,
    tex: tex ? { img: tex.getImage(), mime: tex.getMimeType() } : null,
  };
}
const bbox = (pos) => {
  const min = [1e9, 1e9, 1e9];
  const max = [-1e9, -1e9, -1e9];
  for (let v = 0; v < pos.length; v += 3)
    for (let k = 0; k < 3; k++) {
      if (pos[v + k] < min[k]) min[k] = pos[v + k];
      if (pos[v + k] > max[k]) max[k] = pos[v + k];
    }
  return { min, max };
};

// donor head (rest space of ITS skeleton)
const donor = await io.read(donorPath);
const dWorld = worldMap(donor.getRoot());
const dNode = donor.getRoot().listNodes().find((n) => n.getMesh() && n.getName() === donorNode);
if (!dNode) throw new Error(`donor node ${donorNode} not found`);
const dHead = readRest(dNode, dWorld);
const dBox = bbox(dHead.rest);

// target head (anchor + weight source)
const target = await io.read(targetPath);
const tWorld = worldMap(target.getRoot());
const tNode = target.getRoot().listNodes().find((n) => n.getMesh() && n.getName() === 'Head');
const tHead = readRest(tNode, tWorld);
const tBox = bbox(tHead.rest);

// fit: uniform scale on the larger of the width/height ratios (chibi heads
// read by width; height-only fitting leaves a narrow donor head undersized),
// center-align x/z, align BOTTOMS (neck line)
const s =
  Math.max(
    (tBox.max[1] - tBox.min[1]) / (dBox.max[1] - dBox.min[1]),
    (tBox.max[0] - tBox.min[0]) / (dBox.max[0] - dBox.min[0]),
  ) * scaleMul;
const dc = [0, 2].map(() => 0);
const off = [
  (tBox.min[0] + tBox.max[0]) / 2 - ((dBox.min[0] + dBox.max[0]) / 2) * s,
  tBox.min[1] - dBox.min[1] * s,
  (tBox.min[2] + tBox.max[2]) / 2 - ((dBox.min[2] + dBox.max[2]) / 2) * s,
];
const n = dHead.rest.length / 3;
for (let v = 0; v < n; v++)
  for (let k = 0; k < 3; k++) dHead.rest[v * 3 + k] = dHead.rest[v * 3 + k] * s + off[k];
console.log(`fit: scale ${s.toFixed(3)}, offset [${off.map((x) => x.toFixed(2)).join(',')}]`);

// output: clone target doc, drop all meshes, add the transplanted head
const doc = await io.read(targetPath);
for (const ext of doc.getRoot().listExtensionsUsed()) {
  if (ext.extensionName.includes('meshopt')) ext.dispose();
}
const root = doc.getRoot();
const oWorld = worldMap(root);
const headSkinNode = root.listNodes().find((n2) => n2.getMesh() && n2.getName() === 'Head');
const outSkin = headSkinNode.getSkin();
const outMats = skinMats(headSkinNode, oWorld);
for (const node of root.listNodes()) {
  if (node.getMesh()) {
    node.getMesh().dispose();
    node.dispose();
  }
}
const buffer = root.listBuffers()[0];
const mkAcc = (arr, type) => doc.createAccessor().setArray(arr).setType(type).setBuffer(buffer);
const jOut = new Uint16Array(n * 4);
const wOut = new Float32Array(n * 4);
const bindPos = new Float32Array(n * 3);
const tn = tHead.rest.length / 3;
for (let v = 0; v < n; v++) {
  const px = dHead.rest[v * 3];
  const py = dHead.rest[v * 3 + 1];
  const pz = dHead.rest[v * 3 + 2];
  let bi = 0;
  let bd = Infinity;
  for (let u = 0; u < tn; u++) {
    const dx = tHead.rest[u * 3] - px;
    const dy = tHead.rest[u * 3 + 1] - py;
    const dz = tHead.rest[u * 3 + 2] - pz;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < bd) {
      bd = d2;
      bi = u;
    }
  }
  let blend = null;
  for (let k = 0; k < 4; k++) {
    jOut[v * 4 + k] = tHead.j[bi * 4 + k];
    const wgt = tHead.w[bi * 4 + k];
    wOut[v * 4 + k] = wgt;
    if (!wgt) continue;
    const jm = outMats[tHead.j[bi * 4 + k]];
    if (!blend) blend = jm.map((x) => x * wgt);
    else for (let t = 0; t < 16; t++) blend[t] += jm[t] * wgt;
  }
  bindPos.set(applyM(invert(blend), [px, py, pz]), v * 3);
}
const mat = doc.createMaterial('alt_head').setMetallicFactor(0).setRoughnessFactor(0.85);
if (dHead.tex) {
  mat.setBaseColorTexture(
    doc.createTexture('alt_head').setImage(dHead.tex.img).setMimeType(dHead.tex.mime),
  );
}
const prim = doc
  .createPrimitive()
  .setMode(4)
  .setMaterial(mat)
  .setAttribute('POSITION', mkAcc(bindPos, 'VEC3'))
  .setAttribute('JOINTS_0', mkAcc(jOut, 'VEC4'))
  .setAttribute('WEIGHTS_0', mkAcc(wOut, 'VEC4'));
if (dHead.nrm) prim.setAttribute('NORMAL', mkAcc(dHead.nrm, 'VEC3'));
if (dHead.uv) prim.setAttribute('TEXCOORD_0', mkAcc(dHead.uv, 'VEC2'));
if (dHead.indices) prim.setIndices(mkAcc(new Uint32Array(dHead.indices), 'SCALAR'));
const mesh = doc.createMesh('Set_Head').addPrimitive(prim);
root.listScenes()[0].addChild(doc.createNode('Set_Head').setMesh(mesh).setSkin(outSkin));
const { prune } = await import('@gltf-transform/functions');
await doc.transform(prune());
await io.write(outPath, doc);
console.log('wrote', outPath);
