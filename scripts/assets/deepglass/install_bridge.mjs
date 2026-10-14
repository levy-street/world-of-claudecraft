// Install the Warden bridge kit's collision: each module's build sidecar
// (tmp/asset_src/deepglass/bridge_<v>.collision.json, model yards, glTF frame)
// becomes a Collision Master override with a flat walkable DECK (ramp y0 ==
// y1) for the walkway and boxes for parapets, piers, towers and the lintel.
// Norm is 1 because src/render/asset_scale.ts keeps these modules at their
// authored size (BRIDGE_KIT_MAX_DIM); the check below refuses to install if
// that table drifts from the sidecars. Run after build_assets, then
// `node scripts/gen_collision_overrides.mjs`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const r4 = (v) => Math.round(v * 10000) / 10000;
const scaleSrc = fs.readFileSync(path.join(root, 'src/render/asset_scale.ts'), 'utf8');
const overridesPath = path.join(root, 'data/asset_collision_overrides.json');
const overrides = JSON.parse(fs.readFileSync(overridesPath, 'utf8'));
let n = 0;
for (const v of ['deck', 'lamp', 'pylon']) {
  const side = JSON.parse(
    fs.readFileSync(path.join(root, `tmp/asset_src/deepglass/bridge_${v}.collision.json`), 'utf8'),
  );
  const maxDim = Math.max(...side.size);
  const m = new RegExp(`bridge_${v}:\\s*([0-9.]+)`).exec(scaleSrc);
  if (!m || Math.abs(Number(m[1]) - maxDim) > 1e-3) {
    throw new Error(
      `asset_scale.ts BRIDGE_KIT_MAX_DIM.bridge_${v} (${m?.[1]}) != sidecar ${maxDim}`,
    );
  }
  const norm = 1; // targetHeightFor(path) / maxDim
  const boxes = side.boxes.map((b) => ({
    x: r4(b.x * norm),
    y: r4(b.y * norm),
    z: r4(b.z * norm),
    hx: r4(b.hx * norm),
    hy: r4(b.hy * norm),
    hz: r4(b.hz * norm),
  }));
  const ramps = side.ramps.map((d) => ({
    x: r4(d.x * norm),
    z: r4(d.z * norm),
    hx: r4(d.hx * norm),
    hz: r4(d.hz * norm),
    y0: r4(d.y0 * norm),
    y1: r4(d.y1 * norm),
  }));
  overrides[`deepglass/bridge_${v}`] = { mode: 'baked', boxes, ramps };
  n++;
  console.log(
    `deepglass/bridge_${v}: ${boxes.length} boxes, ${ramps.length} deck(s), maxDim ${maxDim}`,
  );
}
fs.writeFileSync(overridesPath, JSON.stringify(overrides, null, 2) + '\n');
console.log(`installed ${n} overrides -> ${path.relative(root, overridesPath)}`);
