import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, resample } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const key = process.argv[2],
  out = `E:/woc/entregas/santuario/trash/${key}`;
await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(`${out}/${key}.raw.glb`);
await doc.transform(
  resample({ tolerance: 1e-6 }),
  prune({ keepExtras: true }),
  dedup(),
  meshopt({
    encoder: MeshoptEncoder,
    level: 'medium',
    quantizePosition: 16,
    quantizeNormal: 12,
    quantizeWeight: 16,
  }),
);
await io.write(`${out}/${key}.glb`, doc);
console.log('OPTIMIZED', key, fs.statSync(`${out}/${key}.glb`).size);
