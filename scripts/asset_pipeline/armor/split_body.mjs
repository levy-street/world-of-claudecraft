// Split a manual-rig 'body' mesh back into named per-part nodes so per-piece
// material swaps work. manual_rig keeps one primitive per raw part (positions
// copied 1:1), so each prim is matched to its raw part by unique vertex count.
// Usage: node split_body.mjs <rigged.glb> <raw.glb> <out.glb>
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const [riggedPath, rawPath, outPath] = process.argv.slice(2);
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

const raw = await io.read(rawPath);
const names = new Map(); // vertex count -> part name
for (const node of raw.getRoot().listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  for (const prim of mesh.listPrimitives()) {
    const count = prim.getAttribute('POSITION').getCount();
    if (names.has(count)) throw new Error(`ambiguous part vertex count ${count}`);
    names.set(count, node.getName());
  }
}

const doc = await io.read(riggedPath);
for (const ext of doc.getRoot().listExtensionsUsed()) {
  if (ext.extensionName.includes('meshopt')) ext.dispose();
}
const root = doc.getRoot();
const bodyNode = root.listNodes().find((n) => n.getMesh() && n.getName() === 'body');
if (!bodyNode) throw new Error('no body node found');
const skin = bodyNode.getSkin();
const scene = root.listScenes()[0];
const prims = bodyNode.getMesh().listPrimitives();
for (const prim of prims) {
  const count = prim.getAttribute('POSITION').getCount();
  const name = names.get(count);
  if (!name) throw new Error(`no raw part with ${count} verts`);
  const mesh = doc.createMesh(name).addPrimitive(prim);
  const node = doc.createNode(name).setMesh(mesh).setSkin(skin);
  scene.addChild(node);
  console.log(`split ${name} (${count} verts)`);
}
bodyNode.getMesh().dispose();
bodyNode.dispose();
await io.write(outPath, doc);
console.log('wrote', outPath);
