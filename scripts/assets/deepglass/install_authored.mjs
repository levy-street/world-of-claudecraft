// Install Blender-authored collision sidecars as Collision Master overrides.
//
// Each entry names a sidecar (tmp/asset_src/deepglass/<tag>.collision.json:
// glTF frame, model yards, boxes + flat/rising `ramps` decks, climbable
// `ladders`, and `minY`), the
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
  // Warden wharf kit (dg_wharf.py) + the galleon and its gangplank
  // (dg_galleon.py). Boxes and decks may carry a yaw `ry`.
  ...[
    'wharf_deck',
    'wharf_deck_rail',
    'wharf_deck_rails',
    'wharf_quay',
    'wharf_quay_rail',
    'wharf_bastion',
    'wharf_stairs',
    'wharf_crane',
    'wharf_mast',
    'wharf_lamp',
    'wharf_bollard',
    'wharf_rail',
    'wharf_shed',
    'wharf_quay_wide',
    'wharf_quay_wide_rail',
    'wharf_berth',
    'wharf_bastion_open',
    'wharf_galleon',
    'wharf_gangplank',
    'wharf_mine_support',
  ].map((tag) => ({
    tag,
    id: `deepglass/${tag}`,
    mode: 'authored',
    table: 'WHARF_KIT_MAX_DIM',
    key: tag,
  })),
  // The arena kit (bl_dg_arena.py). Its collision is AUTHORED, not baked: a
  // voxel bake seals the arcade and the vomitory and turns the 34-row rake
  // into a wall, so each wedge ships boxes for its walls and walkable decks
  // for its seating.
  ...[
    'arena_stand',
    'arena_stand_vom',
    'arena_gatehouse',
    'arena_concourse',
    'arena_canopy',
    'arena_brazier',
    'arena_banner',
    'arena_box',
    'arena_scoreboard',
    'arena_pennant',
    'arena_causeway',
    'arena_floor',
    'arena_floor_gate',
    'arena_floor_core',
  ].map((tag) => ({
    tag,
    id: `deepglass/${tag}`,
    mode: 'authored',
    table: 'DG_ARENA_MAX_DIM',
    key: tag,
  })),
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
    ...(b.ry ? { ry: r4(b.ry) } : {}),
    // a shaped top (MapHitbox.slope): pitch and fall are drops per yard, so
    // a uniform norm leaves them as they are; the eave is a height
    ...(b.slope
      ? {
          slope: b.slope,
          pitch: r4(b.pitch),
          ...(b.fall ? { fall: r4(b.fall) } : {}),
          ...(b.eave !== undefined ? { eave: r4((b.eave - minY) * norm) } : {}),
        }
      : {}),
  }));
  const ramps = (side.ramps ?? []).map((d) => ({
    x: r4(d.x * norm),
    z: r4(d.z * norm),
    hx: r4(d.hx * norm),
    hz: r4(d.hz * norm),
    ...(d.ry ? { ry: r4(d.ry) } : {}),
    y0: r4((d.y0 - minY) * norm),
    y1: r4((d.y1 - minY) * norm),
  }));
  const ladders = (side.ladders ?? []).map((l) => ({
    x: r4(l.x * norm),
    z: r4(l.z * norm),
    ...(l.ry ? { ry: r4(l.ry) } : {}),
    hw: r4(l.hw * norm),
    y0: r4((l.y0 - minY) * norm),
    y1: r4((l.y1 - minY) * norm),
  }));
  const override = { mode: 'baked', boxes };
  if (ramps.length > 0) override.ramps = ramps;
  if (ladders.length > 0) override.ladders = ladders;
  overrides[e.id] = override;
  console.log(
    `${e.id}: ${boxes.length} boxes, ${ramps.length} deck(s)${ladders.length ? `, ${ladders.length} ladder(s)` : ''}, maxDim ${maxDim}, norm ${norm}, minY ${minY}`,
  );
}
fs.writeFileSync(scalePath, scaleSrc);
fs.writeFileSync(overridesPath, JSON.stringify(overrides, null, 2) + '\n');
console.log(`installed ${ENTRIES.length} overrides -> ${path.relative(root, overridesPath)}`);
