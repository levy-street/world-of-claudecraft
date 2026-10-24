// One-shot provenance step: lift the Drakemaw Raptor's bare mesh and texture out
// of the Tripo-rigged mount GLB the game shipped through v0.45, into the
// unrigged source the Blender build starts from (source/drakemaw_raptor_source.glb).
//
//   node scripts/assets/drakemaw_raptor/extract_source.mjs <old shipped glb> <out source glb>
//
// The old file's skin, its 41 Tripo joints and its four gait-baked clips are
// dropped: nothing of that rig survives into the rebuild. The mesh keeps every
// vertex, normal, UV and triangle in its bind pose; the KTX2 texture's bytes and
// the material are carried over untouched, so the rebuilt mount wears exactly
// the paint it shipped with.
//
// The shipped positions are quantized with the dequantization folded into the
// skin's inverse bind matrices (a skinned mesh ignores its node transform), so
// the bind shape is recovered as jointWorld * inverseBind, which is the same
// matrix for every joint of a file exported in its bind pose (checked below).
import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt, prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const [, , input, output] = process.argv;
if (!input || !output) {
  console.error('usage: extract_source.mjs <old shipped glb> <out source glb>');
  process.exit(1);
}

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
io.setLogger({ debug() {}, info() {}, warn() {}, error: (m) => console.error(m) });
const doc = await io.readBinary(fs.readFileSync(input));
const root = doc.getRoot();

// 4x4 column-major helpers
const mul = (a, b) => {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};
const apply = (m, p) => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
];

const meshNode = root.listNodes().find((n) => n.getMesh() && n.getSkin());
if (!meshNode) throw new Error('no skinned mesh node');
const skin = meshNode.getSkin();
const ibm = skin.getInverseBindMatrices();
const joints = skin.listJoints();
const binds = joints.map((j, i) => mul(j.getWorldMatrix(), ibm.getElement(i, new Array(16))));
const bind = binds[0];
const spread = Math.max(...binds.flatMap((m) => m.map((v, k) => Math.abs(v - bind[k]))));
if (spread > 1e-4) throw new Error(`joints disagree on the bind shape (spread ${spread})`);

const mesh = meshNode.getMesh();
for (const prim of mesh.listPrimitives()) {
  const pos = prim.getAttribute('POSITION');
  const out = new Float32Array(pos.getCount() * 3);
  const el = [0, 0, 0];
  for (let i = 0; i < pos.getCount(); i++) out.set(apply(bind, pos.getElement(i, el)), i * 3);
  prim.setAttribute(
    'POSITION',
    doc.createAccessor('POSITION').setType('VEC3').setArray(out).setBuffer(pos.getBuffer()),
  );
  // the bind shape is a uniform scale plus a shift: normals keep their directions
  for (const semantic of ['NORMAL', 'TEXCOORD_0']) {
    const a = prim.getAttribute(semantic);
    const n = a.getElementSize();
    const arr = new Float32Array(a.getCount() * n);
    const tmp = new Array(n).fill(0);
    for (let i = 0; i < a.getCount(); i++) arr.set(a.getElement(i, tmp), i * n);
    if (semantic === 'NORMAL')
      for (let i = 0; i < arr.length; i += 3) {
        const l = Math.hypot(arr[i], arr[i + 1], arr[i + 2]) || 1;
        arr[i] /= l;
        arr[i + 1] /= l;
        arr[i + 2] /= l;
      }
    prim.setAttribute(
      semantic,
      doc.createAccessor(semantic).setType(a.getType()).setArray(arr).setBuffer(a.getBuffer()),
    );
  }
  prim.setAttribute('JOINTS_0', null);
  prim.setAttribute('WEIGHTS_0', null);
}

// the rig goes: the skin, every joint, every clip
meshNode.setSkin(null);
for (const anim of root.listAnimations()) anim.dispose();
const scene = root.listScenes()[0];
for (const child of scene.listChildren()) scene.removeChild(child);
for (const node of root.listNodes()) if (node !== meshNode) node.dispose();
meshNode.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
meshNode.setName('DrakemawRaptor');
mesh.setName('DrakemawRaptor');
scene.addChild(meshNode);
skin.dispose();

await doc.transform(prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
doc.getRoot().getAsset().generator = 'World of ClaudeCraft extract_source.mjs';
const buf = Buffer.from(await io.writeBinary(doc));
fs.writeFileSync(output, buf);

const check = await io.readBinary(buf);
const p = check.getRoot().listMeshes()[0].listPrimitives()[0];
const min = [Infinity, Infinity, Infinity];
const max = [-Infinity, -Infinity, -Infinity];
const node = check
  .getRoot()
  .listNodes()
  .find((n) => n.getMesh());
const world = node.getWorldMatrix();
const v = [0, 0, 0];
for (let i = 0; i < p.getAttribute('POSITION').getCount(); i++) {
  const w = apply(world, p.getAttribute('POSITION').getElement(i, v));
  for (let k = 0; k < 3; k++) {
    min[k] = Math.min(min[k], w[k]);
    max[k] = Math.max(max[k], w[k]);
  }
}
console.log('wrote', output, buf.length, 'bytes');
console.log(
  'vertices',
  p.getAttribute('POSITION').getCount(),
  'triangles',
  p.getIndices().getCount() / 3,
);
console.log(
  'bounds (glTF, Y up) min',
  min.map((x) => x.toFixed(4)),
  'max',
  max.map((x) => x.toFixed(4)),
);
console.log(
  'skins',
  check.getRoot().listSkins().length,
  'animations',
  check.getRoot().listAnimations().length,
);
console.log(
  'images',
  check
    .getRoot()
    .listTextures()
    .map((t) => `${t.getMimeType()} ${t.getImage().byteLength}`),
);
