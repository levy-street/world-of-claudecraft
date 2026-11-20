// Renders the raid atlas's boss portraits: one head-and-shoulders bust per
// Smith's Heart boss, from the boss's REAL in-game model, as a transparent
// WebP the atlas frames in its gilded medallion (and its boss tooltip).
// Output: public/ui/raid-atlas/<mobId>.webp (committed; the URL is
// raidAtlasPortraitUrl in src/ui/hud/raid_atlas/raid_atlas_boss_core.ts).
//
// The model, its idle clip and its tint come from the same job builder the mob
// portraits use (scripts/lib/mob_portrait_jobs.mjs: the renderer's VisualDef
// manifest resolved exactly as the game resolves it), so a re-skinned boss
// re-renders here with no table to update. Only the bust framing is authored
// (FRAMING below: where on the posed body the camera aims, how much it frames).
//
// No paid service, no network: headless Chrome or Edge renders the committed
// GLBs from a localhost server. Deterministic per GL stack (a fixed canvas,
// pixel ratio 1, idle pose time and yaw).
//
// Run: node scripts/raid_atlas/render_boss_portraits.mjs
//   ONLY=<mobId,mobId>   re-render a subset
//   REAL_GPU=1           use the machine's GPU (d3d11 on Windows) over swiftshader
//   PREVIEW_DIR=<dir>    also write each raw 768px render there, for review
import { mkdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import * as esbuild from 'esbuild';
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';
import { BROWSER_PATH } from '../browser_path.mjs';
import { buildMobPortraitJobs, PORTRAIT_RENDER_DEFINES } from '../lib/mob_portrait_jobs.mjs';

const root = process.cwd();
const publicDir = path.join(root, 'public');
const outDir = path.join(publicDir, 'ui', 'raid-atlas');
/** Shipped side: the tooltip shows it at 96 CSS px (2x density), the map at ~34. */
const OUT_PX = 192;

/**
 * The bust framing per boss: `aim` and `radius` are shares of the posed
 * height (aim from the feet), `yaw` turns the body further toward the camera,
 * `tilt` lifts the camera over the aim (a share of the framed radius), `dx`
 * slides the aim sideways, `rim` is the back light's colour (each vein's own), `body` which body a
 * multi-body rig shows, `key` a warmer key light than the guide's.
 */
const FRAMING = {
  heart_hammer_guardian: { aim: 0.83, radius: 0.2, yaw: 0.25, rim: 0xffc070 },
  heart_seam_singer: { aim: 0.83, radius: 0.2, yaw: 0.2, rim: 0xffd890 },
  heart_breath_guardian: { aim: 0.76, radius: 0.245, yaw: 0.35, rim: 0x7fd0ff },
  heart_quench_guardian: { aim: 0.84, radius: 0.17, yaw: 0.45, rim: 0x9ad8ff },
  heart_heat_guardian: { aim: 0.81, radius: 0.235, yaw: 0.3, rim: 0xffe6a0 },
  // The base form players meet first and fight in the ring: the Hammer's
  // golden basalt (final_body_core.ts finalBodyElement('ring')).
  heart_masterless_strength: {
    aim: 0.81,
    radius: 0.235,
    yaw: 0.3,
    rim: 0xffd27a,
    body: 'hammer',
    // The Heart's forge light: a warm key, so the basalt reads bronze as in the room.
    key: 0xffc27a,
  },
};

mkdirSync(outDir, { recursive: true });
const previewDir = process.env.PREVIEW_DIR ? path.resolve(process.env.PREVIEW_DIR) : null;
if (previewDir) mkdirSync(previewDir, { recursive: true });

const bundled = await esbuild.build({
  entryPoints: [path.join(root, 'scripts', 'raid_atlas', 'portrait_entry.js')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  absWorkingDir: root,
  define: PORTRAIT_RENDER_DEFINES,
  write: false,
  logLevel: 'silent',
});
const bundleJs = bundled.outputFiles[0].text;
if (bundleJs.includes('import.meta') || /\bimport_meta\b/.test(bundleJs)) {
  throw new Error(
    'portrait bundle reads an import.meta field with no define (see mob_portrait_jobs.mjs)',
  );
}

const jobs = (await buildMobPortraitJobs(root)).filter((job) => job.mobId in FRAMING);
const missing = Object.keys(FRAMING).filter((id) => !jobs.some((job) => job.mobId === id));
if (missing.length > 0) throw new Error(`no render job for: ${missing.join(', ')}`);

const HARNESS = `<!doctype html><html><head><meta charset="utf8"><style>html,body{margin:0;background:transparent}</style></head><body><script src="/__bust_bundle.js"></script></body></html>`;
const MIME = {
  '.glb': 'model/gltf-binary',
  '.bin': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ktx2': 'image/ktx2',
  '.hdr': 'image/vnd.radiance',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.js': 'text/javascript',
};
const server = http.createServer(async (req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/__bust.html') {
    res.setHeader('content-type', 'text/html');
    res.end(HARNESS);
    return;
  }
  if (url === '/__bust_bundle.js') {
    res.setHeader('content-type', 'text/javascript');
    res.end(bundleJs);
    return;
  }
  const filePath = path.normalize(path.join(publicDir, url));
  if (!filePath.startsWith(publicDir + path.sep)) {
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

const glArgs = process.env.REAL_GPU
  ? process.platform === 'win32'
    ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl']
    : ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl']
  : ['--use-angle=swiftshader', '--use-gl=angle', '--ignore-gpu-blocklist', '--enable-webgl'];
const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [...glArgs, '--no-sandbox'],
});
let failed = 0;
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => {
    failed++;
    console.error('PAGEERR', e.message);
  });
  await page.goto(`http://127.0.0.1:${port}/__bust.html`, { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction('window.__ready === true', { timeout: 20000 });
  const only = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
  for (const job of jobs) {
    if (only && !only.has(job.mobId)) continue;
    const tint =
      job.tint === null || job.tint === undefined
        ? null
        : typeof job.tint === 'number'
          ? job.tint
          : parseInt(String(job.tint).replace('#', ''), 16);
    try {
      const dataUrl = await page.evaluate(
        (s, t, f) => window.renderBust(s, t, f),
        job.spec,
        tint,
        FRAMING[job.mobId],
      );
      const png = Buffer.from(dataUrl.split(',')[1], 'base64');
      const alpha = (await sharp(png).stats()).channels[3];
      if (!alpha || alpha.max < 8 || alpha.mean < 1) throw new Error('blank render');
      if (previewDir) writeFileSync(path.join(previewDir, `${job.mobId}.png`), png);
      const webp = await sharp(png)
        .resize(OUT_PX, OUT_PX, { kernel: 'lanczos3' })
        .webp({ quality: 90, alphaQuality: 100, effort: 6 })
        .toBuffer();
      writeFileSync(path.join(outDir, `${job.mobId}.webp`), webp);
      console.log(`ok ${job.mobId}.webp (${(webp.length / 1024).toFixed(1)} KB)`);
    } catch (e) {
      failed++;
      console.error(`FAILED ${job.mobId}: ${e.message}`);
    }
  }
} finally {
  await browser.close();
  server.close();
}
if (failed > 0) process.exit(1);
