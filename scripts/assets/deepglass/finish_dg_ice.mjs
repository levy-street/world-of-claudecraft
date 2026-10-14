// Install the Blender-built Deepglass ice (bl_dg_ice.py): meshopt, opaque
// single-sided materials, and a collision box per piece (a berg is solid, a
// floe is a walkable slab, a spire is a thin pillar).
//   node scripts/assets/deepglass/finish_dg_ice.mjs <blender_out_dir>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const src = path.resolve(process.argv[2] ?? 'tmp/tidehold/work/ice');
const meta = JSON.parse(fs.readFileSync(path.join(src, 'dg_ice.json'), 'utf8'));
await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const r3 = (v) => Math.round(v * 1000) / 1000;
const overridesFile = path.join(root, 'data/asset_collision_overrides.json');
const overrides = JSON.parse(fs.readFileSync(overridesFile, 'utf8'));

for (const [name, m] of Object.entries(meta)) {
  const doc = await io.read(path.join(src, `${name}.glb`));
  for (const mat of doc.getRoot().listMaterials()) {
    mat.setDoubleSided(false).setAlphaMode('OPAQUE').setMetallicFactor(0).setRoughnessFactor(0.25);
  }
  await doc.transform(
    dedup(),
    prune({ keepAttributes: true }),
    meshopt({ encoder: MeshoptEncoder, level: 'high' }),
  );
  const out = path.join(root, 'public/models/deepglass', `${name}.glb`);
  await io.write(out, doc);
  const [w, h, d] = m.dims; // x, y(up), z
  // A berg's draft is below the waterline and must not block a swimmer, so its
  // box starts at the water; a floe is a thin standable slab; the rest are solid.
  const y0 = m.kind === 'berg' ? 0 : 0;
  const hy = m.kind === 'berg' ? h * 0.32 : h / 2;
  overrides[`deepglass/${name}`] = {
    mode: 'baked',
    boxes: [
      {
        x: 0,
        y: r3(y0 + hy),
        z: 0,
        hx: r3(w * 0.42),
        hy: r3(hy),
        hz: r3(d * 0.42),
        moveTopY: r3(y0 + hy * 2),
      },
    ],
  };
  console.log(
    `${name}: ${m.tris} tris, ${(fs.statSync(out).size / 1024).toFixed(0)} KB, max dim ${Math.max(...m.dims)}`,
  );
}
fs.writeFileSync(overridesFile, `${JSON.stringify(overrides, null, 2)}\n`);
fs.writeFileSync(path.join(root, 'data/dg_ice_kit.json'), `${JSON.stringify(meta, null, 1)}\n`);
console.log(
  `\nDG_ICE_MAX_DIM:\n${Object.entries(meta)
    .map(([n, m]) => `  ${n}: ${Math.max(...m.dims)},`)
    .join('\n')}`,
);
