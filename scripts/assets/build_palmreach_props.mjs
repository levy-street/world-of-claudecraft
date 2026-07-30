// Build the Palmreach props (fallen coconuts) from the maintainer's dense
// generated models in ~/Downloads/palmreach, at the flower-bed fidelity
// recipe: weld + BOUNDED simplify (small error so detail survives; the
// ratio is chosen per item from a triangle target), prune/dedup, 1024px
// webp textures, meshopt. Same one-shot recipe as
// build_willowfen_props.mjs; where the 0.009 error bound stops short of
// the target, run a second pass over the outputs with error 0.03.
// Usage: node scripts/assets/build_palmreach_props.mjs
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, simplify, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

// Scatter-tier target (2026-07): the pile is bulk-instanced (335 spots in the
// Palmreach alone, plus the Farshore strand), so the flower-bed budget put
// 8.4M triangles on beach clutter. The shipped GLB was re-tiered via the
// second pass above; verified indistinguishable at 8 yards before landing.
const ITEMS = [{ src: 'coconut+3d+model.glb', out: 'fallen_coconuts.glb', target: 3000 }];
const SRC_DIR = '/Users/demihenderson/Downloads/palmreach';
const OUT_DIR = 'public/models/props';

await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

for (const item of ITEMS) {
  const srcPath = path.join(SRC_DIR, item.src);
  const doc = await io.read(srcPath);
  let tris = 0;
  for (const mesh of doc.getRoot().listMeshes())
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      tris += idx ? idx.getCount() / 3 : prim.getAttribute('POSITION').getCount() / 3;
    }
  const ratio = Math.min(1, item.target / tris);
  await doc.transform(
    weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.009 }),
    prune(),
    dedup(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024] }),
    meshopt({ encoder: MeshoptEncoder, level: 'high' }),
  );
  const outPath = path.join(OUT_DIR, item.out);
  await io.write(outPath, doc);
  const kb = Math.round(fs.statSync(outPath).size / 1024);
  console.log(
    `${item.out}: ${Math.round(tris / 1000)}k -> target ${item.target / 1000}k (ratio ${ratio.toFixed(3)}), ${kb}KB`,
  );
}
