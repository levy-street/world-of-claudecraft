// Compose a fully-equipped preview GLB: character body (with the picker's
// runtime equipment rules applied statically: Armor_* plate hidden, Head_Hair
// hidden, body Shoulders pads hidden, Torso geometry tucked) + the forged set
// pieces. Used to audit base-through-shell leaks from every angle.
// Usage: node compose_preview.mjs <char> <set> <out.glb>
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const [char, setName, outPath] = process.argv.slice(2);
const DIR = 'tmp/asset_pipeline/armor_picker';
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

// Start from the set GLB (carries skeleton + clips + Set_* pieces).
const doc = await io.read(`${DIR}/work/set_${setName}.glb`);
for (const ext of doc.getRoot().listExtensionsUsed()) {
  if (ext.extensionName.includes('meshopt')) ext.dispose();
}
const root = doc.getRoot();
const scene = root.listScenes()[0];
const jointByName = new Map(
  root
    .listNodes()
    .filter((n) => !n.getMesh())
    .map((n) => [n.getName(), n]),
);

// Graft the body: tucked torso, no hair, no shoulder pads, no plate.
const bodyDoc = await io.read(`${DIR}/work/${char}_tucked.glb`);
const SKIP = /^(Armor_|Head_Hair$|Shoulders$)/;
const buffer = root.listBuffers()[0];
const mkAcc = (arr, type) => doc.createAccessor().setArray(arr).setType(type).setBuffer(buffer);
for (const bnode of bodyDoc.getRoot().listNodes()) {
  const bmesh = bnode.getMesh();
  if (!bmesh || !bnode.getSkin() || SKIP.test(bnode.getName())) continue;
  const bskin = bnode.getSkin();
  const nskin = doc.createSkin();
  const ibm = bskin.getInverseBindMatrices();
  const el = new Array(16);
  const flat = new Float32Array(bskin.listJoints().length * 16);
  bskin.listJoints().forEach((j, i) => {
    const tj = jointByName.get(j.getName());
    if (!tj) throw new Error(`joint ${j.getName()} missing`);
    nskin.addJoint(tj);
    ibm.getElement(i, el);
    flat.set(el, i * 16);
  });
  nskin.setInverseBindMatrices(mkAcc(flat, 'MAT4'));
  const nmesh = doc.createMesh(bnode.getName());
  for (const bprim of bmesh.listPrimitives()) {
    const cp = (name, comps, Arr) => {
      const acc = bprim.getAttribute(name);
      if (!acc) return null;
      const out = new Arr(acc.getCount() * comps);
      const e = new Array(comps);
      for (let i = 0; i < acc.getCount(); i++) {
        acc.getElement(i, e);
        for (let k = 0; k < comps; k++) out[i * comps + k] = e[k];
      }
      return out;
    };
    const bmat = bprim.getMaterial();
    const nmat = doc.createMaterial(bmat?.getName() ?? 'body');
    const btex = bmat?.getBaseColorTexture();
    if (btex) {
      nmat.setBaseColorTexture(
        doc.createTexture(bnode.getName()).setImage(btex.getImage()).setMimeType(btex.getMimeType()),
      );
    }
    nmat.setMetallicFactor(0).setRoughnessFactor(0.85);
    const prim = doc
      .createPrimitive()
      .setMode(4)
      .setMaterial(nmat)
      .setAttribute('POSITION', mkAcc(cp('POSITION', 3, Float32Array), 'VEC3'))
      .setAttribute('JOINTS_0', mkAcc(cp('JOINTS_0', 4, Uint16Array), 'VEC4'))
      .setAttribute('WEIGHTS_0', mkAcc(cp('WEIGHTS_0', 4, Float32Array), 'VEC4'));
    const nrm = cp('NORMAL', 3, Float32Array);
    if (nrm) prim.setAttribute('NORMAL', mkAcc(nrm, 'VEC3'));
    const uv = cp('TEXCOORD_0', 2, Float32Array);
    if (uv) prim.setAttribute('TEXCOORD_0', mkAcc(uv, 'VEC2'));
    const idx = bprim.getIndices();
    if (idx) prim.setIndices(mkAcc(new Uint32Array(idx.getArray()), 'SCALAR'));
    nmesh.addPrimitive(prim);
  }
  scene.addChild(doc.createNode(bnode.getName()).setMesh(nmesh).setSkin(nskin));
}
if (process.env.APPLY_NO_ANIMS === '1') {
  for (const anim of root.listAnimations()) anim.dispose();
}
const { prune } = await import('@gltf-transform/functions');
await doc.transform(prune());
await io.write(outPath, doc);
console.log('wrote', outPath);
