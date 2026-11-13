// Measures the release's prop models (read from git HEAD, so it still works after a prop is
// replaced): each one's bounds in its own units, its node names and its material names. The
// new props are built to the same bounds, so every size rule and collider the game keeps
// for a prop still fits (scripts/assets/eastbrook_houses/build_props.py).
//
//   node scripts/assets/eastbrook_houses/measure_old.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getBounds, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const FOLDERS = ['public/models/props', 'public/models/biome', 'public/models/dungeon'];
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const out = {};
const tracked = execFileSync('git', ['ls-tree', '-r', '--name-only', 'HEAD', ...FOLDERS], {
  cwd: ROOT,
  encoding: 'utf8',
  maxBuffer: 1 << 26,
})
  .split('\n')
  .filter((f) => f.endsWith('.glb'));
for (const file of tracked) {
  try {
    const bytes = execFileSync('git', ['show', `HEAD:${file}`], { cwd: ROOT, maxBuffer: 1 << 28 });
    const doc = await io.readBinary(new Uint8Array(bytes));
    const scene = doc.getRoot().listScenes()[0];
    const { min, max } = getBounds(scene);
    const round = (v) => Math.round(v * 10000) / 10000;
    let triangles = 0;
    for (const mesh of doc.getRoot().listMeshes())
      for (const prim of mesh.listPrimitives())
        triangles +=
          (prim.getIndices()?.getCount() ?? prim.getAttribute('POSITION').getCount()) / 3;
    out[file.replace('public/models/', '').replace('.glb', '')] = {
      size: [round(max[0] - min[0]), round(max[1] - min[1]), round(max[2] - min[2])],
      min: min.map(round),
      max: max.map(round),
      triangles: Math.round(triangles),
      bytes: bytes.length,
      materials: doc
        .getRoot()
        .listMaterials()
        .map((m) => m.getName()),
      nodes: doc
        .getRoot()
        .listNodes()
        .map((n) => n.getName())
        .filter(Boolean)
        .slice(0, 24),
    };
  } catch (error) {
    out[file] = { error: String(error).slice(0, 120) };
  }
}
mkdirSync(path.join(ROOT, 'tmp/eastbrook_houses'), { recursive: true });
writeFileSync(path.join(ROOT, 'tmp/eastbrook_houses/old_props.json'), JSON.stringify(out, null, 1));
console.log(`${Object.keys(out).length} models measured`);
