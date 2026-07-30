// Graft the class body's handslot.r/.l bones into a forged set GLB, so the
// armored/suit visual holds weapons exactly like the base body (same parent
// bone, same local TRS). Run LAST, after cap/normal fixes (their gltf-transform
// rewrites could prune plain leaf nodes).
//   node scripts/glb_graft_handslots.mjs <body.glb> <set.glb>
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const [bodyPath, setPath] = process.argv.slice(2);
const body = await io.read(bodyPath);
const set = await io.read(setPath);

const parentOf = (doc, name) => {
  for (const node of doc.getRoot().listNodes())
    for (const child of node.listChildren()) if (child.getName() === name) return node;
  return null;
};

let grafted = 0;
for (const slot of ['handslot.r', 'handslot.l']) {
  const src = body
    .getRoot()
    .listNodes()
    .find((n) => n.getName() === slot);
  if (!src) throw new Error(`body has no ${slot}`);
  const srcParent = parentOf(body, slot);
  if (!srcParent) throw new Error(`${slot} has no parent in the body`);
  if (
    set
      .getRoot()
      .listNodes()
      .some((n) => n.getName() === slot)
  ) {
    console.log(`  ${slot} already present, skipping`);
    continue;
  }
  const dstParent = set
    .getRoot()
    .listNodes()
    .find((n) => n.getName() === srcParent.getName());
  if (!dstParent) throw new Error(`set has no bone ${srcParent.getName()} to parent ${slot}`);
  const node = set
    .createNode(slot)
    .setTranslation(src.getTranslation())
    .setRotation(src.getRotation())
    .setScale(src.getScale());
  dstParent.addChild(node);
  console.log(
    `  grafted ${slot} under ${dstParent.getName()} t=[${src.getTranslation().map((v) => v.toFixed(4))}] s=[${src.getScale().map((v) => v.toFixed(3))}]`,
  );
  grafted++;
}
await io.write(setPath, set);
console.log(`wrote ${setPath} (${grafted} grafted)`);
