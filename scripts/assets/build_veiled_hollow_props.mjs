// Build the Veiled Hollow props (the two dungeon cave mouths that serve as
// the realm's entrance and exit) from the maintainer's dense generated
// models in ~/Downloads/veiled-hollow/dungeons, at the flower-bed fidelity
// recipe: weld + BOUNDED simplify, prune/dedup, 1024px webp, meshopt. Same
// one-shot recipe as build_willowfen_props.mjs; where the 0.009 error
// bound stops short of the target, a second pass at error 0.03 follows.
// Usage: node scripts/assets/build_veiled_hollow_props.mjs
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  dedup,
  dequantize,
  meshopt,
  prune,
  simplify,
  textureCompress,
  weld,
} from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

// Scatter-tier targets (2026-07): landmark walk-throughs re-tiered via a
// second simplify pass over the shipped outputs; a source rebuild should
// use these targets.
const ITEMS = [
  { src: 'crystal+cave+3d+model.glb', out: 'hollow_gate_crystal.glb', target: 12000 },
  { src: 'fantasy+tree+cave+3d+model.glb', out: 'hollow_gate_tree.glb', target: 14000 },
];
const SRC_DIR = '<redacted-local-path>';
const OUT_DIR = 'public/models/props';

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

for (const item of ITEMS) {
  const doc = await io.read(path.join(SRC_DIR, item.src));
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
  // the second pass when the error bound stopped short of the target
  const doc2 = await io.read(outPath);
  let tris2 = 0;
  for (const mesh of doc2.getRoot().listMeshes())
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      tris2 += idx ? idx.getCount() / 3 : prim.getAttribute('POSITION').getCount() / 3;
    }
  if (tris2 > item.target * 1.3) {
    await doc2.transform(
      dequantize(),
      weld(),
      simplify({ simplifier: MeshoptSimplifier, ratio: item.target / tris2, error: 0.03 }),
      prune(),
      dedup(),
      meshopt({ encoder: MeshoptEncoder, level: 'high' }),
    );
    await io.write(outPath, doc2);
  }
  const kb = Math.round(fs.statSync(outPath).size / 1024);
  console.log(
    `${item.out}: ${Math.round(tris / 1000)}k -> pass1 ${Math.round(tris2 / 1000)}k (target ${item.target / 1000}k), ${kb}KB`,
  );
}
