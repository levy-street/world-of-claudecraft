// Build the Drakelands rebuild kit (the owner's town and keep pieces for
// the placer's custom kit: buildings, church, barracks, stables, market
// stall, fences, graves, signage, racks, cart, well) from the owner's
// generated drop in ~/Downloads/drakelands, at the ignivar-prop fidelity
// recipe: weld + BOUNDED simplify (error 0.009; a second looser 0.03 pass
// where the tight bound stops short), prune, dedup, per-item webp texture
// sizing, meshopt. No emissive pass: these are daylight overworld pieces,
// not forge-grade dressing.
// The script prints each piece's normalized bounds (bbox over its longest
// axis) after optimization: those figures seed IGNIVAR_PROP_NATIVE rows in
// src/sim/ignivar_props.ts, which the placer's marker and future authored
// plans read.
// After this, run the mandatory KTX2 step + manifest regen:
//   node scripts/assets/compress_glb_textures.mjs
//   node scripts/build_media_manifest.mjs generate
// Usage: node scripts/assets/build_drakelands_kit.mjs [name...]
// With name arguments only those items rebuild.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getBounds, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, simplify, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

// Buildings carry the 12k/1024 budget the fortress kit set; mid furniture
// 8k, small stand-alone props 5k/512.
const ITEMS = [
  { src: 'alchemist.glb', name: 'alchemist', target: 9000, tex: 1024 },
  { src: 'barracks.glb', name: 'barracks', target: 12000, tex: 1024 },
  { src: 'building_1.glb', name: 'building_1', target: 12000, tex: 1024 },
  { src: 'building_2.glb', name: 'building_2', target: 12000, tex: 1024 },
  { src: 'building_base.glb', name: 'building_base', target: 12000, tex: 1024 },
  { src: 'building_base_roof.glb', name: 'building_base_roof', target: 12000, tex: 1024 },
  { src: 'castle_door.glb', name: 'castle_door', target: 9000, tex: 1024 },
  { src: 'church.glb', name: 'church', target: 12000, tex: 1024 },
  { src: 'dragon_statue.glb', name: 'dragon_statue', target: 8000, tex: 1024 },
  { src: 'dummy.glb', name: 'dummy', target: 5000, tex: 512 },
  { src: 'fence.glb', name: 'fence', target: 5000, tex: 512 },
  { src: 'gravestone_2.glb', name: 'gravestone_2', target: 5000, tex: 512 },
  { src: 'gravestone_3.glb', name: 'gravestone_3', target: 5000, tex: 512 },
  { src: 'horse_bell.glb', name: 'horse_bell', target: 5000, tex: 512 },
  { src: 'horse_head.glb', name: 'horse_head', target: 6000, tex: 512 },
  { src: 'house_1.glb', name: 'house_1', target: 12000, tex: 1024 },
  { src: 'market_stall.glb', name: 'market_stall', target: 8000, tex: 1024 },
  { src: 'notice_board.glb', name: 'notice_board', target: 5000, tex: 512 },
  { src: 'shield_rack.glb', name: 'shield_rack', target: 5000, tex: 512 },
  { src: 'signpost.glb', name: 'signpost', target: 5000, tex: 512 },
  { src: 'stables.glb', name: 'stables', target: 12000, tex: 1024 },
  { src: 'tavern_sign.glb', name: 'tavern_sign', target: 5000, tex: 512 },
  { src: 'weapon_rack.glb', name: 'weapon_rack', target: 5000, tex: 512 },
  // the two source files carry a stray + in their names; the kit keys do not
  { src: 'well+_pump.glb', name: 'well_pump', target: 8000, tex: 1024 },
  { src: 'wooden+_cart.glb', name: 'wooden_cart', target: 8000, tex: 1024 },
];
const SRC_DIR = path.join(os.homedir(), 'Downloads', 'drakelands');
const OUT_DIR = 'public/models/drakelands_kit';

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

const countTris = (doc) => {
  let tris = 0;
  for (const mesh of doc.getRoot().listMeshes())
    for (const prim of mesh.listPrimitives()) {
      const indices = prim.getIndices();
      tris += (indices ? indices.getCount() : (prim.getAttribute('POSITION')?.getCount() ?? 0)) / 3;
    }
  return tris;
};

fs.mkdirSync(OUT_DIR, { recursive: true });
const only = process.argv.slice(2);
const nativeRows = [];
for (const item of ITEMS) {
  if (only.length && !only.includes(item.name)) continue;
  const doc = await io.read(path.join(SRC_DIR, item.src));
  const before = countTris(doc);
  if (item.target && item.target < before) {
    await doc.transform(
      weld(),
      simplify({ simplifier: MeshoptSimplifier, ratio: item.target / before, error: 0.009 }),
    );
    const mid = countTris(doc);
    if (mid > item.target * 1.4)
      await doc.transform(
        simplify({ simplifier: MeshoptSimplifier, ratio: item.target / mid, error: 0.03 }),
      );
  } else {
    await doc.transform(weld());
  }
  await doc.transform(
    prune(),
    dedup(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [item.tex, item.tex] }),
  );
  // Normalized bounds BEFORE meshopt quantization, so the figures are the
  // float truth the runtime loader's canonical bake reproduces.
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  const b = getBounds(scene);
  const size = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
  // canonical long-axis-on-X: the runtime template bake (and the native-dims
  // pin in tests/ignivar_dressing_plan_core.test.ts) put the longer
  // HORIZONTAL extent on len, so the printed rows swap x/z the same way
  if (size[2] > size[0]) [size[0], size[2]] = [size[2], size[0]];
  const longest = Math.max(...size);
  const r = (v) => Math.round((v / longest) * 100) / 100;
  nativeRows.push(
    `  ${item.name}: { len: ${r(size[0])}, hei: ${r(size[1])}, dep: ${r(size[2])} },`,
  );
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'high' }));
  const root = doc.getRoot();
  for (const node of root.listNodes())
    if (node.getName().startsWith('tripo_')) node.setName(item.name);
  for (const mesh of root.listMeshes()) mesh.setName(item.name);
  for (const mat of root.listMaterials()) mat.setName(item.name);
  const outPath = path.join(OUT_DIR, `${item.name}.glb`);
  await io.write(outPath, doc);
  const kb = Math.round(fs.statSync(outPath).size / 1024);
  console.log(
    `${item.name}: ${Math.round(before / 1000)}k -> ${Math.round(countTris(doc) / 1000)}k tris, ${kb}KB`,
  );
}
console.log('\nIGNIVAR_PROP_NATIVE rows:');
console.log(nativeRows.join('\n'));
