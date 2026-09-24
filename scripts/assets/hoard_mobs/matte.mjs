// Tripo reads translucent ice as polished metal: a fully metallic material, which the
// game lights as dark grey steel. Make a shipped body's materials matte so its painted
// colour shows.
//
//   node scripts/assets/hoard_mobs/matte.mjs <model.glb> [roughness]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const [file, roughness = '0.55'] = process.argv.slice(2);
if (!file) throw new Error('usage: matte.mjs <model.glb> [roughness]');
await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.decoder': MeshoptDecoder,
  'meshopt.encoder': MeshoptEncoder,
});
const doc = await io.read(file);
for (const material of doc.getRoot().listMaterials()) {
  console.log(
    material.getName(),
    'metallic',
    material.getMetallicFactor(),
    'roughness',
    material.getRoughnessFactor(),
  );
  material
    .setMetallicFactor(0)
    .setRoughnessFactor(Number(roughness))
    .setMetallicRoughnessTexture(null);
}
await io.write(file, doc);
