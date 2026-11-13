// Measures each street lamp's collider radius off its shipped model, the way
// tests/streetlamp_colliders.test.ts re-measures it: the widest horizontal reach of any
// vertex within the collider band of the foot, from the centre of the fixture's footprint,
// at the scale the renderer places it, rounded UP to the centimetre. Prints the rows for
// STREETLAMP_COLLIDER_RADIUS in src/sim/streetlamp_style.ts.
//
//   node scripts/assets/eastbrook_houses/measure_lamp_radii.mjs
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const style = readFileSync(path.join(ROOT, 'src/sim/streetlamp_style.ts'), 'utf8');
const assets = readFileSync(path.join(ROOT, 'src/render/streetlamp_assets.ts'), 'utf8');
const HEIGHT = Number(/STREETLAMP_FIXTURE_HEIGHT = ([\d.]+)/.exec(style)[1]);
const BAND = Number(/STREETLAMP_COLLIDER_BAND = ([\d.]+)/.exec(style)[1]);
const MAX_FOOTPRINT = Number(/const MAX_FOOTPRINT = ([\d.]+)/.exec(assets)[1]);

function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return out;
}
function points(document) {
  const out = [];
  const scene = document.getRoot().getDefaultScene() ?? document.getRoot().listScenes()[0];
  const walk = (node, parent) => {
    const local = multiply(parent, node.getMatrix());
    const mesh = node.getMesh();
    if (mesh) {
      for (const primitive of mesh.listPrimitives()) {
        const position = primitive.getAttribute('POSITION');
        if (!position) continue;
        for (let i = 0; i < position.getCount(); i++) {
          const [x, y, z] = position.getElement(i, []);
          out.push([
            local[0] * x + local[4] * y + local[8] * z + local[12],
            local[1] * x + local[5] * y + local[9] * z + local[13],
            local[2] * x + local[6] * y + local[10] * z + local[14],
          ]);
        }
      }
    }
    for (const child of node.listChildren()) walk(child, local);
  };
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const node of scene.listChildren()) walk(node, identity);
  return out;
}
const rows = [];
for (const file of readdirSync(path.join(ROOT, 'public/models/props'))
  .filter((name) => /^streetlamp_.*\.glb$/.test(name))
  .sort()) {
  const pts = points(await io.read(path.join(ROOT, 'public/models/props', file)));
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const zs = pts.map((p) => p[2]);
  const min = [Math.min(...xs), Math.min(...ys), Math.min(...zs)];
  const max = [Math.max(...xs), Math.max(...ys), Math.max(...zs)];
  const uniform = HEIGHT / (max[1] - min[1]);
  const radial = Math.min(
    1,
    MAX_FOOTPRINT / Math.max((max[0] - min[0]) * uniform, (max[2] - min[2]) * uniform, 1e-4),
  );
  const cx = (min[0] + max[0]) / 2;
  const cz = (min[2] + max[2]) / 2;
  let measured = 0;
  for (const [x, y, z] of pts) {
    if ((y - min[1]) * uniform > BAND) continue;
    measured = Math.max(
      measured,
      Math.hypot((x - cx) * uniform * radial, (z - cz) * uniform * radial),
    );
  }
  rows.push(
    `  ${file.replace(/^streetlamp_|\.glb$/g, '')}: ${Math.ceil(measured * 100 - 1e-9) / 100},`,
  );
}
console.log(rows.join('\n'));
