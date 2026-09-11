// Install Blender-authored collision sidecars as Collision Master overrides.
//
// Each entry names a sidecar (tmp/asset_src/deepglass/<tag>.collision.json:
// glTF frame, model yards, boxes + flat/rising `ramps` decks, and `minY`), the
// catalogue id, and how asset_scale.ts normalizes the model:
//   authored  - targetHeightFor(path) = maxDim, so norm 1
//   wall-kit  - targetHeightFor(path) = maxDim * 2.2 / 4 (the Warden wall's
//               yards-per-scale), so norm 0.55
// The sidecar's Y values are measured from z=0 in Blender; the loader seats the
// model's LOWEST vertex on the ground and the sim's override space has its base
// at y=0, so minY is subtracted first. The script refuses to install when the
// asset_scale.ts table for the entry does not carry the sidecar's max dim
// (`--pin` rewrites the table from the sidecars instead).
// Run after build_assets; then `node scripts/gen_collision_overrides.mjs`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const ENTRIES = [
  {
    tag: 'warden_gate_closed',
    id: 'deepglass/warden_gate_closed',
    mode: 'wall-kit',
    table: 'WARDEN_GATE_MAX_DIM',
    key: 'warden_gate_closed',
  },
  {
    tag: 'warden_gate_open',
    id: 'deepglass/warden_gate_open',
    mode: 'wall-kit',
    table: 'WARDEN_GATE_MAX_DIM',
    key: 'warden_gate_open',
  },
  { tag: 'dock_stairs', id: 'props/dock_stairs', mode: 'authored', const: 'DOCK_STAIRS_MAX_DIM' },
  {
    tag: 'dock_deck',
    id: 'props/dock_deck',
    mode: 'authored',
    table: 'DOCK_DECK_MAX_DIM',
    key: 'dock_deck',
  },
  {
    tag: 'dock_deck_rail',
    id: 'props/dock_deck_rail',
    mode: 'authored',
    table: 'DOCK_DECK_MAX_DIM',
    key: 'dock_deck_rail',
  },
  { tag: 'plot_sign', id: 'props/plot_sign', mode: 'authored', const: 'PLOT_SIGN_MAX_DIM' },
];
const pin = process.argv.includes('--pin');
const r4 = (v) => Math.round(v * 10000) / 10000;
const scalePath = path.join(root, 'src/render/asset_scale.ts');
let scaleSrc = fs.readFileSync(scalePath, 'utf8');
const overridesPath = path.join(root, 'data/asset_collision_overrides.json');
const overrides = JSON.parse(fs.readFileSync(overridesPath, 'utf8'));
for (const e of ENTRIES) {
  const side = JSON.parse(
    fs.readFileSync(path.join(root, `tmp/asset_src/deepglass/${e.tag}.collision.json`), 'utf8'),
  );
  const maxDim = Math.max(...side.size);
  const re = e.table
    ? new RegExp(`(  ${e.key}: )([0-9.]+)(,)`)
    : new RegExp(`(const ${e.const} = )([0-9.]+)(;)`);
  const m = re.exec(scaleSrc);
  if (!m) throw new Error(`asset_scale.ts has no pin for ${e.id}`);
  if (Math.abs(Number(m[2]) - maxDim) > 1e-3) {
    if (!pin)
      throw new Error(
        `asset_scale.ts pin for ${e.id} is ${m[2]}, sidecar says ${maxDim} (run with --pin)`,
      );
    scaleSrc = scaleSrc.replace(re, `$1${maxDim}$3`);
  }
  const norm = e.mode === 'wall-kit' ? 2.2 / 4 : 1;
  const minY = side.minY ?? 0;
  const boxes = side.boxes.map((b) => ({
    x: r4(b.x * norm),
    y: r4((b.y - minY) * norm),
    z: r4(b.z * norm),
    hx: r4(b.hx * norm),
    hy: r4(b.hy * norm),
    hz: r4(b.hz * norm),
  }));
  const ramps = (side.ramps ?? []).map((d) => ({
    x: r4(d.x * norm),
    z: r4(d.z * norm),
    hx: r4(d.hx * norm),
    hz: r4(d.hz * norm),
    y0: r4((d.y0 - minY) * norm),
    y1: r4((d.y1 - minY) * norm),
  }));
  const override = { mode: 'baked', boxes };
  if (ramps.length > 0) override.ramps = ramps;
  overrides[e.id] = override;
  console.log(
    `${e.id}: ${boxes.length} boxes, ${ramps.length} deck(s), maxDim ${maxDim}, norm ${norm}, minY ${minY}`,
  );
}
fs.writeFileSync(scalePath, scaleSrc);
fs.writeFileSync(overridesPath, JSON.stringify(overrides, null, 2) + '\n');
console.log(`installed ${ENTRIES.length} overrides -> ${path.relative(root, overridesPath)}`);
