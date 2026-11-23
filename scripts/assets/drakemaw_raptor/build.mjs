// Build the Drakemaw Raptor mount end to end: prep, Blender, ship, media manifest.
//
//   node scripts/assets/drakemaw_raptor/build.mjs [--blend <path>]
//
// Needs Blender 5.2+ (BLENDER=<binary>, else the macOS app path or `blender`
// on PATH) and Khronos's `ktx` (KTX-Software 4.3+ on PATH, or KTX_BIN). Writes
// public/models/mounts/drakemaw_raptor.glb and regenerates the media manifest;
// scratch goes to tmp/drakemaw_raptor/. --blend also saves the authoring .blend
// (the editable rig and every action) for tweaking a clip by hand in Blender.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { prepForBlender } from './prep.mjs';
import { ROOT, ship } from './ship.mjs';

const argv = process.argv.slice(2);
const blendAt = argv.includes('--blend') ? path.resolve(argv[argv.indexOf('--blend') + 1]) : null;
const here = path.join(ROOT, 'scripts/assets/drakemaw_raptor');
const work = path.join(ROOT, 'tmp/drakemaw_raptor');
fs.mkdirSync(work, { recursive: true });

const source = path.join(here, 'source/drakemaw_raptor_source.glb');
const prepped = path.join(work, 'source.blender.glb');
const raw = path.join(work, 'raw.glb');
const stats = path.join(work, 'stats.json');
const out = path.join(ROOT, 'public/models/mounts/drakemaw_raptor.glb');

function blenderBinary() {
  if (process.env.BLENDER) return process.env.BLENDER;
  const mac = '/Applications/Blender.app/Contents/MacOS/Blender';
  return fs.existsSync(mac) ? mac : 'blender';
}

await prepForBlender(source, prepped);
console.log('prep', path.relative(ROOT, prepped));
const args = [
  '-b',
  '--factory-startup',
  '--python',
  path.join(here, 'build.py'),
  '--',
  prepped,
  raw,
  '--stats',
  stats,
];
if (blendAt) args.push('--blend', blendAt);
execFileSync(blenderBinary(), args, { stdio: 'inherit' });
await ship(raw, source, stats, out);
execFileSync(process.execPath, [path.join(ROOT, 'scripts/build_media_manifest.mjs'), 'generate'], {
  cwd: ROOT,
  stdio: 'inherit',
});
const s = JSON.parse(fs.readFileSync(stats, 'utf8'));
console.log(
  `idle height ${s.idle_height} (manifest height), saddle rest (glTF) ${s.saddle_rest_gltf.join(', ')},`,
  `walkRef ${s.speeds.walk}, runRef ${s.speeds.run}, walkBackRef ${s.speeds.walkBack}`,
);
