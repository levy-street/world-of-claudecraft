// Build the Willowfen props (willow tree, water lilies, river reeds,
// mushroom clusters, log) from the maintainer's dense generated models in
// ~/Downloads/willowfen, at the flower-bed fidelity recipe: weld + BOUNDED
// simplify (small error so filigree survives; the ratio is chosen per item
// from a triangle target), prune/dedup, 1024px webp textures, meshopt.
// One-shot equivalent of the build_foliage + gentle-resimplify pair used
// for the Galecrest statues. Where the 0.009 error bound stops short of the
// target, run a second pass over the outputs with error 0.03.
// Usage: node scripts/assets/build_willowfen_props.mjs
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, simplify, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

// Scatter-tier targets (2026-07): these props are BULK-instanced (fen floor,
// every temperate lake via water_flora), so the old flower-bed budgets put
// 17.2M triangles on one zone's dressing. The shipped GLBs were re-tiered via
// the second-pass recipe above (sources live on the maintainer's machine);
// verified indistinguishable in-game at 3x magnification before landing. A
// source rebuild should use these targets, not the old 30-80k ones.
const ITEMS = [
  { src: 'willow-tree.glb', out: 'willow_tree.glb', target: 11000 },
  { src: 'water-lilies.glb', out: 'fen_lilies.glb', target: 6000 },
  { src: 'river-reeds.glb', out: 'fen_reeds.glb', target: 6000 },
  { src: 'musroom-clusters.glb', out: 'fen_mushrooms.glb', target: 7000 },
  { src: 'log.glb', out: 'fen_log.glb', target: 5000 },
];
const SRC_DIR = '<redacted-local-path>';
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
