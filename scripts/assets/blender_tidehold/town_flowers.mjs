// Decode the undergrowth kit's window-box plants (shipped meshopt-compressed,
// which Blender cannot import) into plain GLBs for bl_town.py's flower():
//   node scripts/assets/blender_tidehold/town_flowers.mjs [out_dir]
// (town_install.sh runs it; run it by hand before a live town_gui.py build).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const KINDS = ['shrub_bloom', 'shrub_heather'];
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const out = path.resolve(process.argv[2] ?? path.join(root, 'tmp/asset_src/tidehold_town/flowers'));
fs.mkdirSync(out, { recursive: true });
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
for (const kind of KINDS) {
  const doc = await io.read(path.join(root, `public/models/deepglass/${kind}.glb`));
  for (const ext of doc.getRoot().listExtensionsUsed()) {
    if (/meshopt|quantiz/i.test(ext.extensionName)) ext.dispose();
  }
  await io.write(path.join(out, `${kind}.glb`), doc);
}
console.log(`decoded ${KINDS.length} window-box plants -> ${path.relative(root, out)}`);
