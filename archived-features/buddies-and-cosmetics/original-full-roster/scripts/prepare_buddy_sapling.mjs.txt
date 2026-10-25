// Prepare the approved sapling animation export for the buddy roster.
// Usage: node scripts/prepare_buddy_sapling.mjs <sapling-waddle.glb>
// Then run scripts/assets/compress_glb_textures.mjs on the output GLB.
// No geometry simplification or animation retargeting: retain the approved waddle.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  dedup,
  meshopt,
  prune,
  resample,
  tangents,
  textureCompress,
  unweld,
  weld,
} from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import { generateTangents } from 'mikktspace';
import sharp from 'sharp';
import { openGlb, saveGlb } from './asset_pipeline/lib/glb.mjs';

const input = process.argv[2];
if (!input) throw new Error('Pass the approved sapling-waddle.glb source.');
const output = path.resolve('public/models/buddies/sapling.glb');
if (path.resolve(input) === output)
  throw new Error('Keep the approved source separate from the export.');
const doc = await openGlb(input);
const root = doc.getRoot();
const names = root.listAnimations().map((clip) => clip.getName());
for (const name of ['Idle', 'Walk', 'Run']) {
  if (!names.includes(name)) throw new Error(`Approved source is missing ${name}.`);
}
// A skin is positioned by its joints. Keep skinned mesh nodes at scene root,
// and rotate the complete skeleton from the source's +X to the game's +Z.
for (const scene of root.listScenes()) {
  for (const node of root.listNodes()) {
    if (!node.getSkin()) continue;
    for (const parent of [...node.listParents()]) {
      if (parent.propertyType === 'Node') parent.removeChild(node);
    }
    scene.addChild(node);
  }
  const axis = doc.createNode('SaplingForward').setRotation([0, -Math.SQRT1_2, 0, Math.SQRT1_2]);
  for (const node of [...scene.listChildren()]) {
    if (node.getSkin()) continue;
    scene.removeChild(node);
    axis.addChild(node);
  }
  scene.addChild(axis);
}
await MeshoptEncoder.ready;
await doc.transform(
  unweld(),
  tangents({ generateTangents }),
  weld(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [512, 512] }),
  resample(),
  prune(),
  dedup(),
  meshopt({ encoder: MeshoptEncoder, level: 'high' }),
);
root.setExtras({
  ...root.getExtras(),
  asset: 'Sapling buddy',
  sourceSha256: createHash('sha256').update(readFileSync(input)).digest('hex'),
  generationTask: '210d80e7-3360-4f16-8682-3eac128249e7',
  rigTask: 'b0e39abb-708f-4e53-987e-a0970ffda400',
  animation: 'Locally authored Idle, Walk and Run; approved side-to-side waddle.',
  orientation:
    'Y up, +Z forward; height and ground normalization supplied by the character loader.',
});
await saveGlb(doc, output);
console.log(`Prepared ${output}`);
