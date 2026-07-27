// Split a rig-manual 'body' mesh back into per-slot skinned nodes using the
// slot manifest merge_slots.mjs wrote (prim order is preserved through
// manual_rig). Also emits a preview GLB with the base warrior body meshes.
// Usage: node split_by_slots.mjs <rigged.glb> <slots.json> <out_set.glb> <out_preview.glb>
import { readFile } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const [riggedPath, slotsJson, outSetPath, outPreviewPath] = process.argv.slice(2);
const manifest = JSON.parse(await readFile(slotsJson, 'utf8'));
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

async function build(keepBodyFrom) {
  const doc = await io.read(riggedPath);
  for (const ext of doc.getRoot().listExtensionsUsed()) {
    if (ext.extensionName.includes('meshopt')) ext.dispose();
  }
  const root = doc.getRoot();
  const scene = root.listScenes()[0];
  const bodyNode = root.listNodes().find((n) => n.getMesh() && n.getName() === 'body');
  if (!bodyNode) throw new Error('no body node in rigged GLB');
  const skin = bodyNode.getSkin();
  const prims = bodyNode.getMesh().listPrimitives();
  if (prims.length !== manifest.length) {
    throw new Error(`prim count ${prims.length} != manifest ${manifest.length}`);
  }
  const bySlot = new Map();
  prims.forEach((prim, i) => {
    const { slot, verts } = manifest[i];
    const n = prim.getAttribute('POSITION').getCount();
    if (n !== verts) throw new Error(`prim ${i} verts ${n} != manifest ${verts} (${slot})`);
    if (!bySlot.has(slot)) bySlot.set(slot, []);
    bySlot.get(slot).push(prim);
  });
  for (const [slot, slotPrims] of bySlot) {
    const mesh = doc.createMesh(`Set_${slot}`);
    for (const p of slotPrims) mesh.addPrimitive(p);
    const node = doc.createNode(`Set_${slot}`).setMesh(mesh).setSkin(skin);
    scene.addChild(node);
  }
  bodyNode.getMesh().dispose();
  bodyNode.dispose();
  if (keepBodyFrom) {
    // graft the base warrior body meshes (they share the same skeleton node
    // names; reuse this doc's skins by matching mesh names to base skins)
    const base = await io.read(keepBodyFrom);
    const jointByName = new Map(
      root
        .listNodes()
        .filter((n) => !n.getMesh())
        .map((n) => [n.getName(), n]),
    );
    // three.js folds a skinned node's world matrix into its bindMatrix, so the
    // grafted node must carry the base node's world transform (it may encode
    // the quantization dequant scale).
    const mulM = (a, b) => {
      const o = new Array(16).fill(0);
      for (let r = 0; r < 4; r++)
        for (let c = 0; c < 4; c++)
          for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
      return o;
    };
    const bw = new Map();
    const bWorldOf = (node) => {
      if (bw.has(node)) return bw.get(node);
      const parent = node.getParentNode?.();
      const m = parent ? mulM(bWorldOf(parent), node.getMatrix()) : node.getMatrix();
      bw.set(node, m);
      return m;
    };
    for (const bnode of base.getRoot().listNodes()) {
      const bmesh = bnode.getMesh();
      if (!bmesh || /^Armor_/.test(bnode.getName())) continue;
      const bskin = bnode.getSkin();
      if (!bskin) continue;
      // rebuild mesh in this doc
      const buffer = root.listBuffers()[0];
      const mkAcc = (arr, type) =>
        doc.createAccessor().setArray(arr).setType(type).setBuffer(buffer);
      const nskin = doc.createSkin();
      const ibm = bskin.getInverseBindMatrices();
      const el = new Array(16);
      const flat = new Float32Array(bskin.listJoints().length * 16);
      bskin.listJoints().forEach((j, i) => {
        const tj = jointByName.get(j.getName());
        if (!tj) throw new Error(`joint ${j.getName()} missing in rigged doc`);
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
      const nnode = doc
        .createNode(bnode.getName())
        .setMesh(nmesh)
        .setSkin(nskin)
        .setMatrix(bWorldOf(bnode));
      scene.addChild(nnode);
    }
  }
  const { prune } = await import('@gltf-transform/functions');
  await doc.transform(prune());
  return doc;
}

await io.write(outSetPath, await build(null));
console.log('wrote', outSetPath);
await io.write(outPreviewPath, await build('tmp/asset_pipeline/armor_picker/work/warrior_plain.glb'));
console.log('wrote', outPreviewPath);
