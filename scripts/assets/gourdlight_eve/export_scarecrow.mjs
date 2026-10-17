// Export and optimize Old Thatchgrin and his strawling (Gourdlight Eve's field boss).
//
//   node scripts/assets/gourdlight_eve/export_scarecrow.mjs [--blender=<path>]
//
// 1. Runs the Blender factory (scarecrow.py) once per character in --background (one
//    rig per process, so the glTF exporter's action-per-rig matching can never mix the
//    two clip sets): the raw GLBs land in tmp/asset_src/gourdlight_eve/, then a third
//    run saves the review .blend with both side by side, and a fourth builds the
//    Swelling Gourd (swelling_gourd.py).
// 2. Optimizes them through scripts/assets/build_assets.mjs with
//    specs/gourdlight_scarecrow.json into public/models/creatures/.
// Then regenerate the media manifest:
//   node scripts/build_media_manifest.mjs generate
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const RAW_DIR = path.join(ROOT, 'tmp/asset_src/gourdlight_eve');
const blenderArg = process.argv.find((arg) => arg.startsWith('--blender='));
const BLENDER = blenderArg
  ? blenderArg.slice('--blender='.length)
  : 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe';

function run(cmd, args) {
  const result = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${path.basename(cmd)} failed (${result.status})`);
}

const factory = path.join(HERE, 'scarecrow.py');
mkdirSync(RAW_DIR, { recursive: true });
for (const who of ['thatchgrin', 'strawling']) {
  run(BLENDER, [
    '--background',
    '--factory-startup',
    '--python',
    factory,
    '--',
    '--out',
    RAW_DIR,
    '--only',
    who,
  ]);
}
run(BLENDER, [
  '--background',
  '--factory-startup',
  '--python',
  factory,
  '--',
  '--blend',
  path.join(RAW_DIR, 'scarecrow.blend'),
]);
// the Swelling Gourd, his giant pumpkin add (its own small factory, the same kit)
run(BLENDER, [
  '--background',
  '--factory-startup',
  '--python',
  path.join(HERE, 'swelling_gourd.py'),
  '--',
  '--out',
  path.join(RAW_DIR, 'gourdlight_swelling_gourd.glb'),
  '--blend',
  path.join(RAW_DIR, 'swelling_gourd.blend'),
]);
run(process.execPath, [
  path.join(ROOT, 'scripts/assets/build_assets.mjs'),
  path.join(ROOT, 'scripts/assets/specs/gourdlight_scarecrow.json'),
]);
