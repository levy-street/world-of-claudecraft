// Apply per-piece variant atlases to a character GLB (each listed piece gets a
// cloned material with the variant PNG as baseColor; everything else keeps the
// base art). Usage:
//   node apply_pieces.mjs <in.glb> <out.glb> Piece=atlas.png [Piece=atlas.png ...]
import { readFile } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const [inPath, outPath, ...pairs] = process.argv.slice(2);
if (!pairs.length) {
  console.error('usage: apply_pieces.mjs <in.glb> <out.glb> Piece=atlas.png ...');
  process.exit(2);
}
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(inPath);
for (const ext of doc.getRoot().listExtensionsUsed()) {
  if (ext.extensionName.includes('meshopt')) ext.dispose();
}
const byName = new Map();
for (const node of doc.getRoot().listNodes()) {
  if (node.getMesh()) byName.set(node.getName(), node);
}
for (const pair of pairs) {
  const [piece, png] = pair.split('=');
  const node = byName.get(piece);
  if (!node) throw new Error(`piece "${piece}" not found`);
  const prim = node.getMesh().listPrimitives()[0];
  const mat = prim.getMaterial().clone().setName(`${piece}_variant`);
  const tex = doc
    .createTexture(`${piece}_variant`)
    .setImage(await readFile(png))
    .setMimeType('image/png');
  mat.setBaseColorTexture(tex);
  // A cloned mesh keeps other nodes' prims untouched when meshes are shared.
  const mesh = node.getMesh().clone();
  mesh.listPrimitives()[0].setMaterial(mat);
  node.setMesh(mesh);
  console.log(`applied ${png} -> ${piece}`);
}
if (process.env.APPLY_NO_ANIMS === '1') {
  for (const anim of doc.getRoot().listAnimations()) anim.dispose();
}
await io.write(outPath, doc);
console.log('wrote', outPath);
