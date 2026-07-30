// Pre-renders one 512px WebP store thumbnail per Season 1 Armory weapon skin:
// the committed GLB with its live rarity VFX (the game's own weapon_vfx module)
// over a rarity-themed painted backdrop, so a legendary card visibly outclasses
// an epic one. Output lands in public/ui/store/armory/<skinId>.webp and is
// committed; tests/weapon_skins.test.ts guards that every paid skin has a file.
//
// Pattern mirrors scripts/wiki/render_model_stills.mjs: esbuild-bundle a browser
// entry as an IIFE, serve the committed public/ dir plus the harness same-origin
// over a throwaway local server, and drive headless Chrome on the software
// WebGL path. Deterministic per machine, existence-gated (never diff-gated).
//
// Run: node scripts/armory_thumbs.mjs   (ONLY=<skinId,skinId> to re-render some)
import { mkdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import * as esbuild from 'esbuild';
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';
import { BROWSER_PATH } from './browser_path.mjs';

const root = process.cwd();
const publicDir = path.join(root, 'public');
const outDir = path.join(publicDir, 'ui', 'store', 'armory');
const OUT_PX = Number(process.env.THUMB_PX || 512);
mkdirSync(outDir, { recursive: true });

const bundled = await esbuild.build({
  entryPoints: [path.join(root, 'scripts', 'armory_thumbs_entry.js')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  define: { 'import.meta.env.DEV': 'true', 'import.meta.env.PROD': 'false' },
  write: false,
  logLevel: 'silent',
});
const bundleJs = bundled.outputFiles[0].text;
if (bundleJs.includes('import.meta')) {
  throw new Error(
    'armory thumbs bundle still contains a raw `import.meta`: add the matching ' +
      '`import.meta.env.<field>` define (esbuild matches full member paths).',
  );
}

const HARNESS = `<!doctype html><html><head><meta charset="utf8"><style>html,body{margin:0;background:#000}</style></head><body><script src="/__armory_bundle.js"></script></body></html>`;
const MIME = {
  '.glb': 'model/gltf-binary',
  '.bin': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.hdr': 'image/vnd.radiance',
  '.json': 'application/json',
};
const server = http.createServer(async (req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/__armory.html') {
    res.setHeader('content-type', 'text/html');
    res.end(HARNESS);
    return;
  }
  if (url === '/__armory_bundle.js') {
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
const origin = `http://127.0.0.1:${server.address().port}`;

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

await page.goto(`${origin}/__armory.html`, { waitUntil: 'load', timeout: 30000 });
await page.waitForFunction('window.__ready === true', { timeout: 20000 });

const ids = await page.evaluate(() => window.armorySkinIds);
const only = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;

let ok = 0;
let failed = 0;
for (const skinId of ids) {
  if (only && !only.has(skinId)) continue;
  try {
    const pngUrl = await page.evaluate((id) => window.renderArmoryThumb(id), skinId);
    const png = Buffer.from(pngUrl.split(',')[1], 'base64');
    // Reject a silently black frame (context loss / render failure): the painted
    // backdrop guarantees a real render carries luminance variance.
    const stats = await sharp(png).stats();
    const spread = Math.max(...stats.channels.slice(0, 3).map((c) => c.max - c.min));
    if (spread < 24) throw new Error(`near-uniform render (spread ${spread})`);
    const webp = await sharp(png)
      .resize(OUT_PX, OUT_PX, { fit: 'cover' })
      .webp({ quality: 88, effort: 6 })
      .toBuffer();
    writeFileSync(path.join(outDir, `${skinId}.webp`), webp);
    ok++;
    console.log(`ok ${skinId}.webp (${(webp.length / 1024).toFixed(1)} KB)`);
  } catch (e) {
    console.error(`FAILED ${skinId}: ${e.message}`);
    failed++;
  }
}

await browser.close();
server.close();
console.log(
  `\nrendered ${ok}/${only ? only.size : ids.length} armory thumbs to public/ui/store/armory/ (${OUT_PX}px, ${failed} failed, pageErrors=${pageErr})`,
);
process.exit(failed > 0 ? 1 : 0);
