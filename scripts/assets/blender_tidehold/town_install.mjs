// Install the Tidehold town kit (bl_town.py) after build_assets + KTX2:
//
//   - data/asset_collision_overrides.json `tidehold/<name>`: the sidecar's
//     authored boxes and walkable decks, in the loader's normalized space
//     (x 2.2/maxDim, y measured up from the model's LOWEST vertex), maxDim and
//     minY MEASURED on the shipped GLB (the numbers the loader will use).
//   - `tidehold_parts/<name>/*`: the old kit-piece entries of a rebuilt
//     building are dropped and each Edit-pieces node gets its share of the
//     collision (tmp/asset_src/tidehold_town/tidehold_<name>.pieces.json).
//   - data/prefab_pieces/<name>.json: the manifest Studio's "Edit pieces"
//     explodes a placement with (then run scripts/gen_prefab_pieces.mjs).
//   - src/sim/deepglass/citadel.ts SIZE + AUTHORED, and the enterable
//     buildings' volumes/storeySplit in src/render/interior_reveal.ts.
//   - tmp/asset_src/tidehold_town/install_report.json: sizes, minY, flames,
//     NPC seats, for the map placement pass (town_place.mjs).
//
//   node scripts/assets/blender_tidehold/town_install.mjs [name ...]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error - shared zero-dep JS tool
import { measureFloors } from '../tidehold_rebase_overrides.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SRC = path.join(root, 'tmp/asset_src/tidehold_town');
const ALL = [
  'house_a',
  'house_b',
  'house_c',
  'house_d',
  'house_e',
  'tavern',
  'tavern_b',
  'smithy',
  'market',
  'hall',
  'shop_a',
  'shop_b',
];
// registered in interior_reveal.ts (roof / upper storey hide from inside). NOT
// the hall: its eaves stand 9 yd up, so the camera stays under the roof, and
// hiding G_H2 there only strips the open timber trusses and leaves the
// chandeliers hanging in the sky (the castle's rule, same reason).
const ENTERABLE = ['tavern', 'tavern_b', 'smithy', 'market', 'shop_a', 'shop_b', 'bank'];
const names = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const WANT = names.length ? names : ALL;
const r4 = (v) => Math.round(v * 10000) / 10000;
const r2 = (v) => Math.round(v * 100) / 100;

/** Sidecar boxes/decks (glTF frame, model yards) -> override space. */
function normalize(coll, maxDim, minY) {
  const k = 2.2 / maxDim;
  const boxes = (coll.boxes ?? []).map((b) => ({
    x: r4(b.x * k),
    y: r4((b.y - minY) * k),
    z: r4(b.z * k),
    hx: r4(b.hx * k),
    hy: r4(b.hy * k),
    hz: r4(b.hz * k),
    ...(b.ry ? { ry: r4(b.ry) } : {}),
  }));
  const ramps = (coll.ramps ?? []).map((d) => ({
    x: r4(d.x * k),
    z: r4(d.z * k),
    hx: r4(d.hx * k),
    hz: r4(d.hz * k),
    y0: r4((d.y0 - minY) * k),
    y1: r4((d.y1 - minY) * k),
    ...(d.ry ? { ry: r4(d.ry) } : {}),
  }));
  if (boxes.length > 64 || ramps.length > 24)
    throw new Error(`override over the caps: ${boxes.length} boxes, ${ramps.length} ramps`);
  // a piece with nothing solid (the window-box plants) walks through: an
  // empty 'baked' override is invalid, and no override at all would give it
  // a default footprint
  if (!boxes.length && !ramps.length) return { mode: 'none' };
  return { mode: 'baked', boxes, ...(ramps.length ? { ramps } : {}) };
}

const overridesPath = path.join(root, 'data/asset_collision_overrides.json');
const overrides = JSON.parse(fs.readFileSync(overridesPath, 'utf8'));
const citadelPath = path.join(root, 'src/sim/deepglass/citadel.ts');
let citadel = fs.readFileSync(citadelPath, 'utf8');
const revealPath = path.join(root, 'src/render/interior_reveal.ts');
let reveal = fs.readFileSync(revealPath, 'utf8');
const reportPath = path.join(SRC, 'install_report.json');
const report = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8')) : {};

for (const name of WANT) {
  const side = JSON.parse(
    fs.readFileSync(path.join(SRC, `tidehold_${name}.collision.json`), 'utf8'),
  );
  const pieces = JSON.parse(
    fs.readFileSync(path.join(SRC, `tidehold_${name}.pieces.json`), 'utf8'),
  );
  const m = await measureFloors(path.join(root, `public/models/tidehold/${name}.glb`));
  const maxDim = m.maxDim;
  const minY = m.minY;
  if (Math.abs(minY - side.minY) > 0.02)
    console.warn(`  ${name}: GLB minY ${minY.toFixed(3)} vs sidecar ${side.minY}`);
  // the building
  overrides[`tidehold/${name}`] = normalize(side, maxDim, minY);
  // its Edit pieces: old kit-piece entries out, the new nodes in
  for (const k of Object.keys(overrides))
    if (k.startsWith(`tidehold_parts/${name}/`)) delete overrides[k];
  if (pieces.shell) {
    overrides[`tidehold_parts/${name}/shell`] = normalize(
      pieces.shell.coll,
      pieces.shell.maxDim,
      pieces.shell.min[1],
    );
  }
  for (const p of pieces.pieces) {
    overrides[`tidehold_parts/${name}/${p.node}`] = normalize(p.coll, p.maxDim, p.min[1]);
  }
  const manifest = {
    name,
    assetId: `tidehold/${name}`,
    parts: `/models/tidehold/${name}.parts.glb`,
    maxDim: r4(maxDim),
    min: m.min.map(r4),
    shell: pieces.shell
      ? {
          nodes: pieces.shell.nodes,
          maxDim: pieces.shell.maxDim,
          min: pieces.shell.min,
          max: pieces.shell.max,
        }
      : null,
    pieces: pieces.pieces.map(({ coll: _c, ...rest }) => rest),
  };
  fs.writeFileSync(
    path.join(root, `data/prefab_pieces/${name}.json`),
    `${JSON.stringify(manifest, null, 1)}\n`,
  );
  // SIZE (x, y, z) and AUTHORED (= maxDim)
  const size = m.size.map(r2);
  const sizeRe = new RegExp(`('tidehold/${name}': )\\[[^\\]]*\\]`);
  if (!sizeRe.test(citadel)) throw new Error(`citadel.ts has no SIZE row for tidehold/${name}`);
  citadel = citadel.replace(sizeRe, `$1[${size.join(', ')}]`);
  const authRe = new RegExp(`(\\n  ${name}: )[0-9.]+(,)`);
  if (authRe.test(citadel)) citadel = citadel.replace(authRe, `$1${r2(maxDim)}$2`);
  // interior reveal volumes for the enterable ones
  if (ENTERABLE.includes(name) && side.reveal) {
    const at = reveal.indexOf(`'/models/tidehold/${name}.glb': {`);
    if (at < 0) throw new Error(`interior_reveal.ts has no entry for ${name}`);
    const end = reveal.indexOf('\n  },\n', at) + '\n  },\n'.length;
    const vols = side.reveal.volumes
      .map(
        (v) =>
          `{ x0: ${r2(v.x0)}, x1: ${r2(v.x1)}, y0: ${r2(v.y0)}, y1: ${r2(v.y1)}, z0: ${r2(v.z0)}, z1: ${r2(v.z1)} }`,
      )
      .join(',\n      ');
    const split =
      side.reveal.storeySplit !== undefined ? `\n    storeySplit: ${side.reveal.storeySplit},` : '';
    const block =
      `'/models/tidehold/${name}.glb': {\n` +
      `    // bl_town.py (the town kit): measured from its sidecar on install\n` +
      (side.reveal.volumes.length === 1
        ? `    volumes: [${vols}],${split}\n  },\n` // biome keeps a lone volume on one line
        : `    volumes: [\n      ${vols},\n    ],${split}\n  },\n`);
    reveal = reveal.slice(0, at) + block + reveal.slice(end);
  }
  report[name] = {
    maxDim: r4(maxDim),
    minY: r4(minY),
    size,
    floors: m.floors.slice(0, 3).map((f) => ({ y: r2(f.y), area: r2(f.area) })),
    flames: side.flames ?? [],
    npcs: side.npcs ?? {},
  };
  console.log(
    `  ${name}: maxDim ${maxDim.toFixed(2)} minY ${minY.toFixed(3)} boxes ${side.boxes.length} ramps ${side.ramps.length} ` +
      `pieces ${pieces.pieces.length}${pieces.shell ? '+shell' : ''} flames ${(side.flames ?? []).length}`,
  );
}
fs.writeFileSync(overridesPath, `${JSON.stringify(overrides, null, 2)}\n`);
fs.writeFileSync(citadelPath, citadel);
fs.writeFileSync(revealPath, reveal);
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 1)}\n`);
console.log(`installed ${WANT.length} town building(s)`);
