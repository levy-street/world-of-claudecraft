// Copy the warrior suit's Armor_* skin weights onto another class's suit.
//
// Every per-class mech suit is the SAME source mesh (identical vertex count and
// order; the forge only transforms positions), but each class's weight transfer
// pulls from ITS body's segments — and robe bodies (warlock/priest/druid) carry
// cloth-drape leg weights, so their suit boots inherit shin/knee bones and
// stretch mid-walk. The warrior transfer is the proven-good assignment for this
// mesh, so copy its JOINTS_0/WEIGHTS_0 per Armor_* prim, remapping joint
// indices by bone name (each ArmorSkin lists the shared donor bones in its own
// order). IBMs are untouched: each suit keeps its own bind.
//   node scripts/glb_copy_suit_weights.mjs <donor.glb> <target.glb>
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const [donorPath, targetPath] = process.argv.slice(2);
const donor = await io.read(donorPath);
const target = await io.read(targetPath);

const armorNodes = (doc) =>
  doc.getRoot().listNodes().filter((n) => n.getName().startsWith('Armor_') && n.getMesh());

const donorNodes = new Map(armorNodes(donor).map((n) => [n.getName(), n]));
let copied = 0;
for (const tNode of armorNodes(target)) {
  const dNode = donorNodes.get(tNode.getName());
  if (!dNode) throw new Error(`donor lacks ${tNode.getName()}`);
  const dJoints = dNode.getSkin().listJoints().map((j) => j.getName());
  const tJoints = tNode.getSkin().listJoints().map((j) => j.getName());
  const remap = dJoints.map((name) => {
    const idx = tJoints.indexOf(name);
    if (idx < 0) throw new Error(`target skin lacks joint ${name}`);
    return idx;
  });
  const dPrim = dNode.getMesh().listPrimitives()[0];
  const tPrim = tNode.getMesh().listPrimitives()[0];
  const dJ = dPrim.getAttribute('JOINTS_0');
  const dW = dPrim.getAttribute('WEIGHTS_0');
  const tJ = tPrim.getAttribute('JOINTS_0');
  const tW = tPrim.getAttribute('WEIGHTS_0');
  if (dJ.getCount() !== tJ.getCount()) {
    throw new Error(`${tNode.getName()} vertex count mismatch: ${dJ.getCount()} vs ${tJ.getCount()}`);
  }
  const je = [0, 0, 0, 0];
  const we = [0, 0, 0, 0];
  for (let i = 0; i < dJ.getCount(); i++) {
    dJ.getElement(i, je);
    dW.getElement(i, we);
    for (let k = 0; k < 4; k++) je[k] = we[k] > 0 ? remap[je[k]] : 0;
    tJ.setElement(i, je);
    tW.setElement(i, we);
  }
  copied++;
}
await io.write(targetPath, target);
console.log(`${targetPath.split('/').pop()}: copied weights for ${copied} Armor_* meshes`);
