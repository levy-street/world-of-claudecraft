// Build the Mirefen mudfin huts (src/sim/mudfin_huts.ts, drawn by
// src/render/props.ts at the five mud huts on the Deepfen shallows) from the
// art lead's Tripo3D web models, kept OUT of git under
// tmp/asset_src/mudfin_huts/ (Murlock_Hut_A_v02.glb, the round hut with its
// plank door, and Murloc_Hut_B.glb: unit scale, base at y 0, door facing +Z,
// one 1024px JPEG albedo each).
//
// Recipe: weld + BOUNDED simplify toward the target (a second pass at error
// 0.03 when the 0.009 bound stops short, the build_veiled_hollow_props.mjs
// recipe), then the asset pipeline's normalizeProp: base at y 0, centred on
// X/Z, the world height MUDFIN_HUT_MODELS draws (so the GLB is real size in
// the Studio asset browser too), prune/dedup, a resized WebP albedo and
// meshopt. KTX2 is its own step afterwards (compress_glb_textures.mjs, which
// needs KTX-Software):
//
//   node scripts/assets/build_mudfin_huts.mjs [a|b]   (one hut, or both)
//   KTX_BIN="C:/Program Files/KTX-Software/bin" node scripts/assets/compress_glb_textures.mjs \
//     public/models/props/mudfin_hut_a.glb public/models/props/mudfin_hut_b.glb
//   node scripts/gen_prop_natural_size.mjs
//   node scripts/build_media_manifest.mjs generate
// biome-ignore assist/source/organizeImports: sharp must initialize before @gltf-transform/functions on Windows.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  compactPrimitive,
  dedup,
  dequantize,
  prune,
  simplify,
  weld,
} from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { normalizeProp } from '../asset_pipeline/lib/glb.mjs';

void sharp;

// Heights are MUDFIN_HUT_MODELS' drawn heights (src/sim/mudfin_huts.ts);
// targets sit under the prop family's 6000-triangle hard cap
// (scripts/asset_pipeline/lib/families.mjs) for a walk-up building.
const ITEMS = [
  { model: 'a', src: 'Murlock_Hut_A_v02.glb', out: 'mudfin_hut_a.glb', target: 5500, height: 4.75 },
  { model: 'b', src: 'Murloc_Hut_B.glb', out: 'mudfin_hut_b.glb', target: 3000, height: 6 },
];
/** Rebuild one hut and leave the other's shipped bytes alone. */
const ONLY = process.argv[2];
const TRIANGLE_CAP = 6000;
const SRC_DIR = 'tmp/asset_src/mudfin_huts';
const WORK_DIR = 'tmp/asset_src/mudfin_huts/work';
const OUT_DIR = 'public/models/props';
// The prop family's normal map size; compress_glb_textures.mjs then encodes a
// tripo_* albedo as UASTC, about 0.6 MB a hut at 512 against 1.2 MB at 1024.
const MAX_TEX = 512;

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

function triangles(doc) {
  let tris = 0;
  for (const mesh of doc.getRoot().listMeshes())
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      tris += idx ? idx.getCount() / 3 : prim.getAttribute('POSITION').getCount() / 3;
    }
  return tris;
}

fs.mkdirSync(WORK_DIR, { recursive: true });
for (const item of ITEMS.filter((it) => !ONLY || it.model === ONLY)) {
  const doc = await io.read(path.join(SRC_DIR, item.src));
  const before = triangles(doc);
  await doc.transform(
    weld(),
    simplify({
      simplifier: MeshoptSimplifier,
      ratio: Math.min(1, item.target / before),
      error: 0.009,
    }),
    prune(),
    dedup(),
  );
  let after = triangles(doc);
  // Tripo's many UV islands pin the simplifier at their seams, so a single
  // looser pass can stop short too: widen the bound until the hut is within
  // 30% of its target (always under the 6000 hard cap).
  for (const error of [0.03, 0.06, 0.1]) {
    if (after <= item.target * 1.3) break;
    await doc.transform(
      dequantize(),
      weld(),
      simplify({ simplifier: MeshoptSimplifier, ratio: item.target / after, error }),
      prune(),
      dedup(),
    );
    after = triangles(doc);
  }
  // Still over the hard cap: one small PERMISSIVE step that may collapse across
  // UV seams, the UVs weighted hard into the error so the painted albedo stays
  // put (a big permissive step tears dark wedges into the plaster walls).
  if (after > Math.min(TRIANGLE_CAP, item.target * 1.3)) {
    await doc.transform(dequantize());
    for (const mesh of doc.getRoot().listMeshes())
      for (const prim of mesh.listPrimitives()) {
        const indices = prim.getIndices();
        const uv = prim.getAttribute('TEXCOORD_0');
        if (!indices || !uv) continue;
        const source = new Uint32Array(indices.getArray());
        const wanted = Math.floor((source.length * item.target) / after / 3) * 3;
        const [kept] = MeshoptSimplifier.simplifyWithAttributes(
          source,
          new Float32Array(prim.getAttribute('POSITION').getArray()),
          3,
          new Float32Array(uv.getArray()),
          2,
          [4, 4],
          null,
          wanted,
          0.02,
          ['Permissive'],
        );
        indices.setArray(kept);
        compactPrimitive(prim);
      }
    await doc.transform(prune(), dedup());
    after = triangles(doc);
  }
  const simplified = path.join(WORK_DIR, item.out);
  await io.write(simplified, doc);
  const outPath = path.join(OUT_DIR, item.out);
  const { scale } = await normalizeProp(simplified, outPath, {
    height: item.height,
    maxTex: MAX_TEX,
  });
  const kb = Math.round(fs.statSync(outPath).size / 1024);
  console.log(
    `${item.out}: ${before} -> ${after} tris (target ${item.target}), scale ${scale}, ${kb}KB`,
  );
}
