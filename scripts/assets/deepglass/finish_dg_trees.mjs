// Finish the Blender-built Deepglass trees (bl_dg_trees.py) and install them:
//   - foliage material: alpha CUTOUT (Blender exports BLEND), single-sided (the
//     cards already carry both windings with one shared normal), and an
//     emissive floor off the same atlas so a self-shadowed crown never shades
//     to black (the Tree Generator's "black canopy" lesson);
//   - writes public/models/deepglass/<name>.glb;
//   - trunk and root collision into data/asset_collision_overrides.json (a
//     tree's auto-fit box would be its whole 27 yd crown), then regenerates
//     the sim's table from it.
//   node scripts/assets/deepglass/finish_dg_trees.mjs <blender_out_dir>
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
const src = path.resolve(process.argv[2] ?? 'tmp/tidehold/work/trees');
const meta = JSON.parse(fs.readFileSync(path.join(src, 'dg_trees.json'), 'utf8'));
await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
// Low: the canopy now carries its own value gradient and dark undersides, and a
// uniform glow was flattening it (round-3 review). Still enough that nothing goes
// black. (The too-dark shade side is lifted by the leaf shader's sky wrap,
// foliage_edge_fade.ts, which follows the scene's light; a glow would not.)
const CANOPY_EMISSIVE = 0.08;
const r3 = (v) => Math.round(v * 1000) / 1000;

// DG_QA_OUT=<dir>: write the finished GLBs there for review and install
// NOTHING (no public/ models, no collision, no kit record).
const QA_OUT = process.env.DG_QA_OUT ? path.resolve(process.env.DG_QA_OUT) : null;
if (QA_OUT) fs.mkdirSync(QA_OUT, { recursive: true });
const overridesFile = path.join(root, 'data/asset_collision_overrides.json');
const overrides = JSON.parse(fs.readFileSync(overridesFile, 'utf8'));
for (const [name, m] of Object.entries(meta)) {
  const doc = await io.read(path.join(src, `${name}.glb`));
  for (const mat of doc.getRoot().listMaterials()) {
    mat.setDoubleSided(false).setMetallicFactor(0).setRoughnessFactor(1);
    if (/^Leaves/.test(mat.getName())) {
      mat.setAlphaMode('MASK').setAlphaCutoff(0.5);
      mat.setEmissiveTexture(mat.getBaseColorTexture());
      mat.setEmissiveFactor([CANOPY_EMISSIVE, CANOPY_EMISSIVE, CANOPY_EMISSIVE]);
    } else mat.setAlphaMode('OPAQUE');
  }
  // meshopt, like every other shipped kit (build_drakelands_props.mjs)
  // v2 builders emit both faces of every card themselves (dg_foliage_lib.py);
  // only a one-sided (v1) build needs its back faces added here
  if (!m.two_sided) doubleWindLeaves(doc);
  m.tris = triCount(doc);
  await doc.transform(
    dedup(),
    prune({ keepAttributes: true }),
    meshopt({ encoder: MeshoptEncoder, level: 'high' }),
  );
  // The foliage atlas ships LOSSLESS (SPACEY, 2026-09-20: "just not compress
  // them"): the generated leaf art is the whole point and WebP at q88 eats the
  // fine needle edges. Costs download size, NOT runtime, GPU memory is set by
  // the texture's dimensions (2048x1024, unchanged), not by how the bytes were
  // packed in the file.
  const out = path.join(QA_OUT ?? path.join(root, 'public/models/deepglass'), `${name}.glb`);
  await io.write(out, doc);
  // Collision: the trunk to head height and beyond, plus the root mass of a
  // giant. Authored yards at placement scale 1 (asset_scale.ts keeps the size).
  // Rooty trees carry their whole base collision from the builder, fitted to
  // the bark (bl_dg_trees.py base_collision: a round trunk on the foot's real
  // axis and walkable terraces up each root). Pines keep one trunk box.
  const trunkH = Math.min(m.height * 0.55, 12);
  const boxes = m.boxes_complete
    ? [...m.boxes]
    : [{ x: 0, y: r3(trunkH / 2), z: 0, hx: r3(m.base_r), hy: r3(trunkH / 2), hz: r3(m.base_r) }];
  overrides[`deepglass/${name}`] = { mode: 'baked', boxes };
  console.log(
    `${name}: ${m.tris} tris, ${(fs.statSync(out).size / 1024).toFixed(0)} KB, max dim ${Math.max(...m.dims)}`,
  );
}
if (!QA_OUT) fs.writeFileSync(overridesFile, `${JSON.stringify(overrides, null, 2)}\n`);
// The sim reads the GENERATED table, not the JSON: without this the new boxes
// sat unused and the crag kept its old collision (2026-09-24)
if (!QA_OUT)
  execFileSync('node', [path.join(root, 'scripts/gen_collision_overrides.mjs')], {
    stdio: 'inherit',
  });
// the kit record the gate test reads (tests/dg_tree_kit.test.ts)
if (!QA_OUT)
  fs.writeFileSync(path.join(root, 'data/dg_tree_kit.json'), `${JSON.stringify(meta, null, 1)}\n`);
const table = Object.entries(meta)
  .map(([n, m]) => `  ${n}: ${Math.max(...m.dims)},`)
  .join('\n');
console.log(`\nDG_TREE_MAX_DIM:\n${table}`);
