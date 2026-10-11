// Make a shipped GLB importable by Blender.
//
// Blender's glTF importer refuses any file that DECLARES KHR_texture_basisu, and every
// shipped creature GLB here is KTX2-compressed, so authoring against the real rig is
// impossible without this step. Materials and textures go too: the authoring pass only
// ever needs the skeleton, and dropping them is what lets the extension declaration be
// disposed at all.
//
// The output is a THROWAWAY under tmp/. Nothing is ever written back through it; the clip
// bake targets the original shipped file, so the stripped copy cannot leak into the game.
//
// Usage: node scripts/strip_glb_for_blender.mjs <in.glb> <out.glb>
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(),
  'draco3d.encoder': await draco3d.createEncoderModule(),
  'meshopt.decoder': MeshoptDecoder,
  'meshopt.encoder': MeshoptEncoder,
});
const doc = await io.read(process.argv[2]);
const root = doc.getRoot();
for (const mat of root.listMaterials()) mat.dispose();
for (const tex of root.listTextures()) tex.dispose();
for (const ext of root.listExtensionsUsed()) ext.dispose();
await io.write(process.argv[3], doc);
console.log('wrote', process.argv[3]);
console.log(
  'clips:',
  root
    .listAnimations()
    .map((a) => a.getName())
    .join(', '),
);
