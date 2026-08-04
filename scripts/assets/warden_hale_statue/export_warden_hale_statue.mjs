// Deterministic Warden Hale memorial export: Blender factory -> raw GLB ->
// build_assets optimization -> shipping public/models/props/wardenHaleStatue.glb.
//
// Usage:
//   node scripts/assets/warden_hale_statue/export_warden_hale_statue.mjs
//   node scripts/assets/warden_hale_statue/export_warden_hale_statue.mjs --raw-only
//
// Unlike the eastbrook-era exporters (browser + three GLTFExporter under
// puppeteer), this asset is authored in Blender: the figure is the rigged KayKit
// knight re-posed and skin-baked, which needs an armature evaluator the browser
// path does not have. Everything else follows the same archetype, so the raw GLB
// still lands in tmp/asset_src and still ships through build_assets.mjs.
//
// Blender 4.2+ is required (tested on 5.2 LTS). Point BLENDER_PATH at the binary
// if it is not on PATH; the export is run-by-hand, never part of `npm run build`.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const FACTORY = path.join(HERE, 'model.py');
const RAW_DIR = path.join(ROOT, 'tmp/asset_src/warden_hale_statue');
const RAW_OUT = path.join(RAW_DIR, 'warden_hale_statue-final.glb');
const SPEC = path.join(ROOT, 'scripts/assets/specs/warden_hale_statue.json');
const BUILD_ASSETS = path.join(ROOT, 'scripts/assets/build_assets.mjs');
const SHIPPING_OUT = path.join(ROOT, 'public/models/props/wardenHaleStatue.glb');

const CANDIDATES = [
  process.env.BLENDER_PATH,
  '/Applications/Blender.app/Contents/MacOS/Blender',
  'blender',
].filter(Boolean);

function resolveBlender() {
  for (const candidate of CANDIDATES) {
    const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
    if (probe.status === 0) return candidate;
  }
  throw new Error(
    'Blender not found. Install it or set BLENDER_PATH to the binary ' +
      '(macOS: /Applications/Blender.app/Contents/MacOS/Blender).',
  );
}

const rawOnly = process.argv.includes('--raw-only');

const blender = resolveBlender();
mkdirSync(RAW_DIR, { recursive: true });

console.log(`blender: ${blender}`);
const built = spawnSync(blender, ['--background', '--python', FACTORY], {
  encoding: 'utf8',
  env: { ...process.env, STATUE_OUT: RAW_OUT },
});
if (built.status !== 0 || !existsSync(RAW_OUT)) {
  console.error(built.stdout ?? '');
  console.error(built.stderr ?? '');
  throw new Error('Blender factory failed');
}
// the factory prints a STATS line carrying the measured bounds; those are the
// numbers the placement record (r, h) in src/sim/content/farshore.ts pins.
const stats = (built.stdout ?? '').split('\n').find((l) => l.startsWith('STATS '));
if (stats) console.log(stats);
console.log(`raw: ${RAW_OUT} (${(statSync(RAW_OUT).size / 1024).toFixed(0)}KB)`);

if (rawOnly) process.exit(0);

const opt = spawnSync(process.execPath, [BUILD_ASSETS, SPEC], {
  encoding: 'utf8',
  cwd: ROOT,
});
process.stdout.write(opt.stdout ?? '');
if (opt.status !== 0) {
  process.stderr.write(opt.stderr ?? '');
  throw new Error('build_assets optimization failed');
}
console.log(`shipping: ${SHIPPING_OUT} (${(statSync(SHIPPING_OUT).size / 1024).toFixed(0)}KB)`);
console.log('remember: node scripts/build_media_manifest.mjs generate');
