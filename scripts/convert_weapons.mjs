// Batch-convert KayKit weapon .gltf (+.bin +external texture) into single,
// self-contained .glb files with the texture embedded — the only model format
// the game's loader accepts. Uses @gltf-transform's NodeIO (reads the gltf,
// resolves buffers/images, writes a binary glb). Not wired into npm; run with:
//   node scripts/convert_weapons.mjs [destDir]
// Source packs live under public/models/_New_Imports (deleted after import).
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { readdirSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';

// Register all KHR/EXT extensions so emissive-strength glow (the flashy
// weapons) and other material data survive the gltf → glb round-trip.
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const IMPORTS = 'public/models/_New_Imports';

const SRC_DIRS = [
  { dir: `${IMPORTS}/KayKit Fantasy Weapons Bits 1.0/Assets/gltf`, tag: '' },
  { dir: `${IMPORTS}/KayKit Adventurers 2.0/Assets/gltf`, tag: 'adv_' },
];

// Adventurers pack ships consumables/props alongside weapons — skip those.
const SKIP = /potion|mug|crate|barrel|coin|bottle|bomb|ammo|turret|book|key|base/i;

const dest = process.argv[2] || 'tmp/weapon_src';
mkdirSync(dest, { recursive: true });

let n = 0;
for (const { dir, tag } of SRC_DIRS) {
  if (!existsSync(dir)) { console.warn(`(skip, missing) ${dir}`); continue; }
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.gltf')) continue;
    if (tag && SKIP.test(f)) continue;
    const base = f.replace(/\.gltf$/, '').toLowerCase();
    const out = path.join(dest, `${tag}${base}.glb`);
    const doc = await io.read(path.join(dir, f));
    await io.write(out, doc);
    n++;
    console.log(`✓ ${tag}${base}.glb`);
  }
}
console.log(`\nconverted ${n} weapons → ${dest}`);
