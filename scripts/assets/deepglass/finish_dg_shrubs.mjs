// Finish the Blender-built Deepglass undergrowth (bl_dg_shrubs.py) and install
// it. Same contract as finish_dg_trees.mjs, with two differences that matter:
//   - collision is 'none'. Shrubs and grass are walk-through dressing, like
//     the clutter pieces; a knee-high bush you cannot walk past is worse than
//     no bush, and it costs the sim a volume per placement for nothing.
//   - the pieces author NO new texture art. Every card samples the TREE
//     atlas (tree_tex/dg_tree_leaves.png) and every stem the same derived
//     bark, so nothing new has to be painted, and the kit adds 13 x ~186 KB
//     of download rather than a second sheet.
//     BUT NOT zero VRAM: glTF embeds the atlas in EVERY file, so these are 13
//     more copies of it on the GPU (~2 MB each at 1024x512), exactly the trap
//     the tree kit already carries. Sharing one atlas across a kit needs an
//     external image URI plus a loader-side cache and is a separate job.
//   node scripts/assets/deepglass/finish_dg_shrubs.mjs <blender_out_dir>
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import { doubleWindLeaves, triCount } from './foliage_glb.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const src = path.resolve(process.argv[2] ?? 'tmp/tidehold/work/shrubs');
const meta = JSON.parse(fs.readFileSync(path.join(src, 'dg_shrubs.json'), 'utf8'));
await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
// Undergrowth sits in shadow under trees and against snow; without a floor it
// silhouettes black the way the tree canopy did before its emissive lift.
// Low, as the trees: the dome shading carries the value now.
const LEAF_EMISSIVE = 0.1;

// DG_QA_OUT=<dir>: write the finished GLBs there for review and install
// NOTHING (no public/ models, no collision, no kit record).
const QA_OUT = process.env.DG_QA_OUT ? path.resolve(process.env.DG_QA_OUT) : null;
if (QA_OUT) fs.mkdirSync(QA_OUT, { recursive: true });
const overridesFile = path.join(root, 'data/asset_collision_overrides.json');
const overrides = JSON.parse(fs.readFileSync(overridesFile, 'utf8'));
const table = [];
for (const [name, m] of Object.entries(meta)) {
  const doc = await io.read(path.join(src, `${name}.glb`));
  for (const mat of doc.getRoot().listMaterials()) {
    mat.setDoubleSided(false).setMetallicFactor(0).setRoughnessFactor(1);
    if (/^Leaves/.test(mat.getName())) {
      mat.setAlphaMode('MASK').setAlphaCutoff(0.5);
      mat.setEmissiveTexture(mat.getBaseColorTexture());
      mat.setEmissiveFactor([LEAF_EMISSIVE, LEAF_EMISSIVE, LEAF_EMISSIVE]);
    } else mat.setAlphaMode('OPAQUE');
  }
  // v2 builders emit both faces of every card themselves (dg_foliage_lib.py);
  // only a one-sided (v1) build needs its back faces added here
  if (!m.two_sided) doubleWindLeaves(doc);
  m.tris = triCount(doc);
  await doc.transform(
    dedup(),
    prune({ keepAttributes: true }),
    meshopt({ encoder: MeshoptEncoder, level: 'high' }),
  );
  const out = path.join(QA_OUT ?? path.join(root, 'public/models/deepglass'), `${name}.glb`);
  await io.write(out, doc);
  // Walk-through, except a piece that carries solid parts (the moss rock's
  // stone): those ship its authored boxes.
  overrides[`deepglass/${name}`] = m.boxes?.length
    ? { mode: 'baked', boxes: m.boxes }
    : { mode: 'none' };
  const maxDim = Math.max(...m.dims);
  table.push([name, maxDim]);
  console.log(
    `${name}: ${m.tris} tris, ${(fs.statSync(out).size / 1024).toFixed(0)} KB, max dim ${maxDim}`,
  );
}
if (!QA_OUT) fs.writeFileSync(overridesFile, `${JSON.stringify(overrides, null, 2)}\n`);
// The sim reads the GENERATED table, not the JSON: without this the new boxes
// sat unused and the crag kept its old collision (2026-09-24)
if (!QA_OUT)
  execFileSync('node', [path.join(root, 'scripts/gen_collision_overrides.mjs')], {
    stdio: 'inherit',
  });
if (!QA_OUT)
  fs.writeFileSync(path.join(root, 'data/dg_shrub_kit.json'), `${JSON.stringify(meta, null, 1)}\n`);
console.log(`\nDG_SHRUB_MAX_DIM:\n${table.map(([n, d]) => `  ${n}: ${d},`).join('\n')}`);
