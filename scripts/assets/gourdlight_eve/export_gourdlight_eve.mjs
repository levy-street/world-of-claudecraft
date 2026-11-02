// Export and optimize Gourdlight Eve's props (the city dressing kit and the
// wearable pumpkin head).
//
//   node scripts/assets/gourdlight_eve/export_gourdlight_eve.mjs [--blender=<path>]
//
// 1. Runs the Blender factory (model.py) in --background: the raw GLBs land in
//    tmp/asset_src/gourdlight_eve/ (and a .blend beside them for review).
// 2. Optimizes them through scripts/assets/build_assets.mjs with
//    specs/gourdlight_eve.json into public/models/props/.
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

mkdirSync(RAW_DIR, { recursive: true });
run(BLENDER, [
  '--background',
  '--factory-startup',
  '--python',
  path.join(HERE, 'model.py'),
  '--',
  '--out',
  RAW_DIR,
  '--blend',
  path.join(RAW_DIR, 'gourdlight.blend'),
]);
run(process.execPath, [
  path.join(ROOT, 'scripts/assets/build_assets.mjs'),
  path.join(ROOT, 'scripts/assets/specs/gourdlight_eve.json'),
]);
