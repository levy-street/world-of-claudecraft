// Pre-renders one transparent WebP portrait per Dungeon Finder encounter and
// one head-focused portrait with a baked backdrop per mob template
// (docs/prd/dungeon-finder.md): the finder window previews bosses with static
// prerendered art, never a live Three.js scene. Output lands in
// public/ui/dungeons/<mobId>.webp and public/ui/mobs/<mobId>.webp, and is
// committed. The finder window reads the URL baked by
// src/ui/dungeon_finder_view.ts (FINDER_PORTRAIT_DIR).
//
// A sibling of scripts/wiki/render_model_stills.mjs: it reuses that pipeline's
// browser entry (window.renderStill over headless Chrome + swiftshader) but
// derives its job list from the finder catalogue (encounter mob ids) through
// the renderer's VisualDef manifest, exactly the way the game resolves each
// mob's model and tint. Deliberately NOT part of guide-stills: the guide's
// orphan-WebP guard only covers public/guide-stills/, and the raid boss is a
// guide spoiler but a finder fact.
//
// Prereqs: a Chrome/Edge/Chromium binary (scripts/browser_path.mjs) and the
// committed GLBs under public/. Run: node scripts/render_finder_portraits.mjs
// (optionally ONLY=<mobId,mobId> to re-render a subset).
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import * as esbuild from 'esbuild';
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';
import { BROWSER_PATH } from './browser_path.mjs';
import { mobPortraitBackgroundSvg } from './lib/mob_portrait_background.mjs';
import {
  buildMobPortraitJobs,
  buildPortraitRendererContract,
  PORTRAIT_RENDER_DEFINES,
  portraitRendererFingerprint,
  sha256,
} from './lib/mob_portrait_jobs.mjs';

const root = process.cwd();
const publicDir = path.join(root, 'public');
const outDir = path.join(publicDir, 'ui', 'dungeons');
const mobOutDir = path.join(publicDir, 'ui', 'mobs');
const OUT_PX = Number(process.env.PORTRAIT_PX || 128); // shipped size; the window shows 64px
const receiptPath = process.env.PORTRAIT_RECEIPT
  ? path.resolve(root, process.env.PORTRAIT_RECEIPT)
  : null;
mkdirSync(outDir, { recursive: true });
mkdirSync(mobOutDir, { recursive: true });
if (receiptPath) rmSync(receiptPath, { force: true });

// 1) Bundle the shared browser render entry (see render_model_stills.mjs for the
//    import.meta.env define rationale).
const bundled = await esbuild.build({
  entryPoints: [path.join(root, 'scripts', 'wiki', 'stills_render_entry.js')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  // Every env field the transitive graph reads needs its own define (esbuild
  // matches the FULL member path). The runtime/client-origin fields arrived with
  // the v0.34 native/desktop work; without them current esbuild rewrites
  // import.meta to an EMPTY OBJECT in an IIFE and the page TypeErrors at boot,
  // which surfaces only as a __ready timeout. Same fix as
  // scripts/wiki/render_model_stills.mjs, whose guard comment carries the detail.
  // This is the union of both sides of the merge: the release added the five
  // runtime/client-origin fields, and this branch's art-pipeline unblock added
  // BASE_URL plus the discord/reown/turnstile/wallet fields the same graph reads.
  // Pinned for the same reason as the acceptance builder in lib/mob_portrait_jobs.mjs:
  // esbuild's per-module path comments are relative to absWorkingDir (cwd by default),
  // so the bundle digest this run stamps into the receipt would otherwise depend on the
  // launch directory. Both sites must pass the same value or receipts stop validating.
  absWorkingDir: root,
  define: PORTRAIT_RENDER_DEFINES,
  write: false,
  logLevel: 'silent',
});
const bundleJs = bundled.outputFiles[0].text;
// Both failure shapes of a missed define, the same check scripts/wiki/render_model_stills.mjs
// runs: a raw `import.meta` (older esbuild kept it: a SyntaxError in a classic script) and
// the current empty-object rewrite (import_meta = {} / import_meta.env.X: a boot-time
// TypeError the __ready wait can only report as a timeout).
if (bundleJs.includes('import.meta') || /\bimport_meta\b/.test(bundleJs)) {
  throw new Error(
    'portrait bundle still reads an import.meta.env field with no define (esbuild rewrites ' +
      'import.meta to an empty object in an IIFE, so the page TypeErrors at boot). Add an ' +
      "'import.meta.env.<field>' define above; esbuild matches the full member path.",
  );
}

// 2) Build the exact live render jobs through the shared source-contract seam.
//    The acceptance manifest imports this same builder, so its fingerprints
//    cannot drift away from the jobs the renderer actually executes.
const jobs = await buildMobPortraitJobs(root);

// 3) Serve public/ + the harness, same-origin (mirrors render_model_stills.mjs).
const HARNESS = `<!doctype html><html><head><meta charset="utf8"><style>html,body{margin:0;background:transparent}</style></head><body><script src="/__portraits_bundle.js"></script></body></html>`;
const MIME = {
  '.glb': 'model/gltf-binary',
  '.bin': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ktx2': 'image/ktx2',
  '.hdr': 'image/vnd.radiance',
  '.json': 'application/json',
  '.gltf': 'model/gltf+json',
};
const server = http.createServer(async (req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/__portraits.html') {
    res.setHeader('content-type', 'text/html');
    res.end(HARNESS);
    return;
  }
  if (url === '/__portraits_bundle.js') {
    res.setHeader('content-type', 'text/javascript');
    res.end(bundleJs);
    return;
  }
  const filePath = path.normalize(path.join(publicDir, url));
  if (filePath !== publicDir && !filePath.startsWith(publicDir + path.sep)) {
    res.statusCode = 403;
    res.end('forbidden');
    return;
  }
  try {
    const buf = await readFile(filePath);
    res.setHeader(
      'content-type',
      MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
    );
    res.end(buf);
  } catch {
    res.statusCode = 404;
    res.end('not found');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const origin = `http://127.0.0.1:${port}`;

// 4) Drive headless Chrome (software WebGL) and render each encounter portrait.
const glArgs = process.env.REAL_GPU
  ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl']
  : ['--use-angle=swiftshader', '--use-gl=angle', '--ignore-gpu-blocklist', '--enable-webgl'];
const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [...glArgs, '--no-sandbox'],
});
const page = await browser.newPage();
let pageErr = 0;
page.on('pageerror', (e) => {
  pageErr++;
  console.error('PAGEERR', e.message);
});
page.on('console', (m) => {
  if (m.type() === 'error') console.error('CONSOLE', m.text());
});

const only = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
if (only) {
  const knownIds = new Set(jobs.map((job) => job.mobId));
  const unknownIds = [...only].filter((id) => !knownIds.has(id));
  if (unknownIds.length > 0)
    throw new Error(`unknown ONLY portrait id(s): ${unknownIds.join(', ')}`);
}

await page.goto(`${origin}/__portraits.html`, { waitUntil: 'load', timeout: 30000 });
await page.waitForFunction('window.__ready === true', { timeout: 20000 });

let ok = 0;
let failed = 0;
const renderedPortraits = [];
for (const job of jobs) {
  if (only && !only.has(job.mobId)) continue;
  const tintNum =
    job.tint === null || job.tint === undefined
      ? null
      : typeof job.tint === 'number'
        ? job.tint
        : parseInt(String(job.tint).replace('#', ''), 16);
  try {
    const pngUrl = await page.evaluate((s, t) => window.renderStill(s, t), job.spec, tintNum);
    const png = Buffer.from(pngUrl.split(',')[1], 'base64');
    const alpha = (await sharp(png).stats()).channels[3];
    if (!alpha || alpha.max < 8 || alpha.mean < 1) {
      throw new Error(
        `blank render (alpha max ${alpha ? alpha.max : 'none'}, mean ${alpha ? alpha.mean : 'none'})`,
      );
    }
    const webp = await sharp(png)
      .resize(OUT_PX, OUT_PX, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .webp({ quality: 88, alphaQuality: 100, effort: 6 })
      .toBuffer();
    if (job.finder) writeFileSync(path.join(outDir, `${job.mobId}.webp`), webp);
    const trimmed = await sharp(png).trim().png().toBuffer();
    const { width = 0, height = 0 } = await sharp(trimmed).metadata();
    const bustHeight = height > width * 0.8 ? Math.max(1, Math.round(height * 0.65)) : height;
    const inset = Math.max(1, Math.round(OUT_PX * 0.07));
    const portraitLayer = await sharp(trimmed)
      .extract({ left: 0, top: 0, width, height: bustHeight })
      .resize(OUT_PX - inset * 2, OUT_PX - inset * 2, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .extend({
        top: inset,
        bottom: inset,
        left: inset,
        right: inset,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();
    const mobWebp = await sharp(Buffer.from(mobPortraitBackgroundSvg(job.family, OUT_PX)))
      .composite([{ input: portraitLayer }])
      .webp({ quality: 88, alphaQuality: 100, effort: 6 })
      .toBuffer();
    writeFileSync(path.join(mobOutDir, `${job.mobId}.webp`), mobWebp);
    renderedPortraits.push({
      id: job.mobId,
      sourceFingerprint: job.sourceFingerprint,
      output: { bytes: mobWebp.length, sha256: sha256(mobWebp) },
    });
    ok++;
    console.log(`ok ${job.mobId}.webp (${(webp.length / 1024).toFixed(1)} KB)`);
  } catch (e) {
    rmSync(path.join(mobOutDir, `${job.mobId}.webp`), { force: true });
    if (job.finder) rmSync(path.join(outDir, `${job.mobId}.webp`), { force: true });
    console.error(`FAILED ${job.mobId}: ${e.message}`);
    failed++;
  }
}

await browser.close();
server.close();
console.log(
  `\nrendered ${ok}/${jobs.length} portrait jobs (${OUT_PX}px, ${failed} failed, pageErrors=${pageErr})`,
);
if (failed > 0 || pageErr > 0) process.exit(1);
if (receiptPath) {
  if (OUT_PX !== 128) {
    throw new Error('PORTRAIT_RECEIPT is only valid for the shipping 128px render contract');
  }
  const renderer = await buildPortraitRendererContract(root, bundled.outputFiles[0].contents);
  const receipt = {
    schemaVersion: 1,
    generatedBy: 'scripts/render_finder_portraits.mjs',
    rendererFingerprint: portraitRendererFingerprint(renderer),
    portraits: renderedPortraits.sort((left, right) => left.id.localeCompare(right.id)),
  };
  mkdirSync(path.dirname(receiptPath), { recursive: true });
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(`wrote renderer receipt ${path.relative(root, receiptPath)}`);
}
