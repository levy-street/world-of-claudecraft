// Merge a rigged character's FBX files into ONE glTF (.glb) with all its
// animation clips. Handles the two common shapes:
//   1. a folder of Mixamo-style exports: one FBX holds the skinned mesh (+ its
//      idle), the rest are animation-only (walk/attack/death/...), same skeleton;
//   2. a single FBX that already contains the mesh + several animation takes.
//
// It parses FBX with three.js FBXLoader inside headless Chrome (the same loader
// the game uses), grafts every clip onto the mesh by bone name, optionally
// applies a base-color texture, and writes a clean GLB via GLTFExporter +
// gltf-transform. This is why it works where standalone Node FBX->glTF tools
// fail: FBX parsing, skinning and embedded textures are done by a real engine.
//
// USAGE
//   Folder mode (easiest):
//     node scripts/combine_fbx_to_glb.mjs <inputDir> <out.glb> [options]
//       - the FBX that has the mesh becomes the base; its first clip is named
//         from its filename's last token (e.g. lich_boss_Idle.fbx -> "Idle")
//       - every other FBX contributes its clip, named the same way
//         (lich_boss_walk.fbx -> "Walk", *_Swipe.fbx -> "Swipe", ...)
//       - a lone .png/.jpg in the folder is used as the base-color texture
//   Explicit mode:
//     node scripts/combine_fbx_to_glb.mjs --base mesh.fbx --anim walk.fbx \
//       --anim run.fbx=Run --tex skin.png out.glb
//       - --anim file.fbx=Name overrides the clip name (default: filename token)
//
// OPTIONS
//   --tex <file>        external base-color texture (else preserve the embedded one)
//   --height <n>        normalize model height to n world units (default: keep native)
//   --strip-root        lock root horizontal motion (in-place loop; server-driven mobs)
//   --rest-clip <name>  freeze the bind/rest pose on this clip (avoids a T-pose at rest)
//   --rest-t <sec>      time into --rest-clip to freeze on (default 1.0)
//   --strip-armature    drop the skeleton-root track per clip (fixes some cooked-axis exports)
//   --all | --first     keep ALL clips per FBX (default) or only the first
//   --min-dur <sec>     skip junk takes shorter than this (default 0.1)
//   --meshopt           meshopt-compress geometry (needs a meshopt-aware loader, e.g. three.js)
//   --webp              convert textures to webp (needs EXT_texture_webp support)
//   --webp-size <px>    resize textures to px square when converting (implies --webp)
//   -h, --help          show this help
//
// World of ClaudeCraft assets were built with: --strip-root --rest-clip Idle
//   --rest-t 1 --height <n> --meshopt --webp-size 1024  (game uses meshopt + webp).

import { execSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, textureCompress } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

// ---- arg parsing -----------------------------------------------------------
const argv = process.argv.slice(2);
if (argv.length === 0 || argv.includes('-h') || argv.includes('--help')) {
  console.log(
    readFileSync(new URL(import.meta.url))
      .toString()
      .split('\n')
      .filter((l) => l.startsWith('//'))
      .map((l) => l.replace(/^\/\/ ?/, ''))
      .join('\n'),
  );
  process.exit(argv.length === 0 ? 1 : 0);
}
const opt = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const flag = (name) => argv.includes(name);
const clipNameFromFile = (p) => {
  const stem = basename(p, extname(p));
  const tok = stem.split(/[_\s-]+/).pop() || stem;
  return tok.charAt(0).toUpperCase() + tok.slice(1);
};

const VALUE_FLAGS = new Set([
  '--base',
  '--anim',
  '--tex',
  '--height',
  '--rest-clip',
  '--rest-t',
  '--min-dur',
  '--webp-size',
]);
const explicitBase = opt('--base');
const animArgs = argv.map((a, i) => (a === '--anim' ? argv[i + 1] : null)).filter(Boolean);
const positionals = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    if (VALUE_FLAGS.has(a)) i++;
    continue;
  } // skip flag (+ its value)
  positionals.push(a);
}

const fbxFiles = []; // { path, name }
let texFile = opt('--tex') || null;
let out;

if (explicitBase || animArgs.length) {
  // explicit mode: --base + --anim ... ; out = the trailing positional
  out = positionals[positionals.length - 1];
  if (explicitBase) fbxFiles.push({ path: explicitBase, name: clipNameFromFile(explicitBase) });
  for (const a of animArgs) {
    const [path, name] = a.split('=');
    fbxFiles.push({ path, name: name || clipNameFromFile(path) });
  }
} else {
  // folder mode: <inputDir> <out.glb>
  const dir = positionals[0];
  out = positionals[1];
  if (!dir || !out) {
    console.error('usage: combine_fbx_to_glb.mjs <inputDir> <out.glb>  (see --help)');
    process.exit(1);
  }
  if (!statSync(dir).isDirectory()) {
    console.error(`not a directory: ${dir}`);
    process.exit(1);
  }
  for (const f of readdirSync(dir).sort()) {
    const p = join(dir, f);
    if (/\.fbx$/i.test(f)) fbxFiles.push({ path: p, name: clipNameFromFile(p) });
    else if (!texFile && /\.(png|jpe?g)$/i.test(f) && !/^\./.test(f)) texFile = p;
  }
}
if (fbxFiles.length === 0) {
  console.error('no .fbx inputs found');
  process.exit(1);
}
if (!out) {
  console.error('no output path given');
  process.exit(1);
}

const combineOpts = {
  targetHeight: opt('--height') ? Number(opt('--height')) : null,
  stripRoot: flag('--strip-root'),
  stripArmature: flag('--strip-armature'),
  restClip: opt('--rest-clip') ?? null,
  restT: opt('--rest-clip') ? Number(opt('--rest-t') ?? 1.0) : null,
  minDur: opt('--min-dur') ? Number(opt('--min-dur')) : 0.1,
  allClips: !flag('--first'),
};
const wantMeshopt = flag('--meshopt');
const webpSize = opt('--webp-size') ? Number(opt('--webp-size')) : null;
const wantWebp = flag('--webp') || webpSize != null;

console.log(`base+anims: ${fbxFiles.map((f) => `${basename(f.path)}->${f.name}`).join(', ')}`);
console.log(`texture: ${texFile ? basename(texFile) : '(embedded / none)'}  out: ${out}`);

// ---- run the browser-side merge --------------------------------------------
const ENTRY = 'scripts/combine_fbx_to_glb_entry.js';
const BUNDLE = join(tmpdir(), 'combine_fbx_to_glb.bundle.js');
execSync(`npx esbuild ${ENTRY} --bundle --format=iife --outfile=${BUNDLE}`, { stdio: 'inherit' });
const html = `<!doctype html><html><head><meta charset="utf8"></head><body><script>${readFileSync(BUNDLE, 'utf8')}</script></body></html>`;
const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [
    '--use-angle=swiftshader',
    '--use-gl=angle',
    '--ignore-gpu-blocklist',
    '--no-sandbox',
    '--enable-webgl',
  ],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('PAGEERR', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.error('CONSOLE', m.text());
});
await page.setContent(html, { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true', { timeout: 20000 });

const files = fbxFiles.map((f) => ({ name: f.name, b64: readFileSync(f.path).toString('base64') }));
const externalTexB64 = texFile ? readFileSync(texFile).toString('base64') : null;
const { b64, dbg } = await page.evaluate((f, o) => window.combine(f, o), files, {
  ...combineOpts,
  externalTexB64,
});
await browser.close();
console.log('merge:', JSON.stringify(dbg));

// ---- post-process with gltf-transform --------------------------------------
const tmpRaw = join(tmpdir(), `combine_fbx_to_glb.${basename(out)}.raw.glb`);
writeFileSync(tmpRaw, Buffer.from(b64, 'base64'));
await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(tmpRaw);
const transforms = [prune(), dedup()];
if (wantWebp) {
  const sharp = (await import('sharp')).default;
  transforms.push(
    textureCompress({
      encoder: sharp,
      targetFormat: 'webp',
      ...(webpSize ? { resize: [webpSize, webpSize] } : {}),
    }),
  );
}
if (wantMeshopt) transforms.push(meshopt({ encoder: MeshoptEncoder, level: 'high' }));
await doc.transform(...transforms);
mkdirSync(dirname(out), { recursive: true });
await io.write(out, doc);
rmSync(tmpRaw, { force: true });
rmSync(BUNDLE, { force: true });
console.log(`wrote ${out}`);
