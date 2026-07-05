// Pre-renders one transparent WebP still per distinct (model, tint) figure used by the
// Guide, so the /wiki bestiary, class, warlock, and gallery pages can show the real
// creature by default with zero per-card WebGL. Output lands in public/guide-stills/ and
// is committed; the page reads the baked `still` URL (see scripts/wiki/build_content.mjs)
// and tests/guide.test.ts guards (so CI fails) that every figure has a committed file and
// that no committed file is orphaned. The render is deterministic on one machine but not
// byte-identical across machines/GPUs, so the stills are existence-gated, not diff-gated:
// regenerate on the swiftshader path.
//
// Pattern mirrors scripts/render_weapon_icons.mjs (headless Chrome + swiftshader over an
// esbuild-bundled browser entry). The difference: the entry reuses the Guide viewer's own
// buildModel, which fetches GLBs via loadGltf, so we serve public/ over localhost and the
// page loads models same-origin. loadGltf -> assetUrl reads import.meta.env, which esbuild
// leaves intact for a classic IIFE, so we define the whole env object at bundle time.
//
// Prereqs: a Chrome/Edge/Chromium binary (scripts/browser_path.mjs) and the committed
// GLBs under public/. Run: `npm run wiki:stills` (or node scripts/wiki/render_model_stills.mjs).
import { mkdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import * as esbuild from 'esbuild';
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';
import { BROWSER_PATH } from '../browser_path.mjs';
import { STILLS_DIR, stillKey } from './still_key.mjs';

const root = process.cwd();
const publicDir = path.join(root, 'public');
const outDir = path.join(publicDir, STILLS_DIR);
const OUT_PX = Number(process.env.STILL_PX || 320); // shipped size; entry supersamples at 512
mkdirSync(outDir, { recursive: true });

// 1) Bundle the browser entry. loadGltf -> assetUrl reads import.meta.env.DEV (DEV gates the
//    root-relative /<logical> paths our static server maps into public/), which esbuild leaves
//    intact for a classic IIFE <script src> and would be a SyntaxError. esbuild matches each
//    FULL member path exactly (a bare `import.meta.env` define does NOT fold `.DEV`), so define
//    both Vite flags media.ts / i18n.ts read; the assert below fails loudly if a transitive
//    module ever reads another import.meta field this define misses.
const bundled = await esbuild.build({
  entryPoints: [path.join(root, 'scripts', 'wiki', 'stills_render_entry.js')],
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
    'stills bundle still contains a raw `import.meta`: a transitive module reads an ' +
      'import.meta.env field with no define. Add an `import.meta.env.<field>` define above ' +
      '(esbuild matches the full member path) before it SyntaxErrors in the IIFE.',
  );
}

// 2) Load the baked Guide content (the figure set + model specs) by bundling the generated
//    module to a data URL, the same trick build_content.mjs uses (never import raw .ts).
const dataEntry = `export { GUIDE_CLASSES, GUIDE_WARLOCK_PETS, GUIDE_FAMILIES, GUIDE_MODELS } from './src/guide/content.generated.ts';`;
const dataBuilt = await esbuild.build({
  stdin: {
    contents: dataEntry,
    resolveDir: root,
    sourcefile: 'stills-data-entry.ts',
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  logLevel: 'silent',
});
const dataUrl = `data:text/javascript;base64,${Buffer.from(dataBuilt.outputFiles[0].text).toString('base64')}`;
const { GUIDE_CLASSES, GUIDE_WARLOCK_PETS, GUIDE_FAMILIES, GUIDE_MODELS } = await import(dataUrl);

// Flatten every figure to a distinct (model, tint) render job, deduped by still key.
const jobs = new Map();
const addFigure = (model, tint) => {
  if (!model || !GUIDE_MODELS[model]) return;
  const key = stillKey(model, tint);
  if (!jobs.has(key)) jobs.set(key, { key, model, tint: tint ?? null });
};
for (const c of GUIDE_CLASSES) addFigure(c.model, c.tint);
for (const p of GUIDE_WARLOCK_PETS) addFigure(p.model, p.tint);
for (const f of GUIDE_FAMILIES) for (const c of f.creatures) addFigure(c.model, c.tint);

// 3) Serve public/ (for the GLBs) plus the render harness and bundle, all same-origin so
//    the page's `/models/...` fetches resolve to the committed assets.
const HARNESS = `<!doctype html><html><head><meta charset="utf8"><style>html,body{margin:0;background:transparent}</style></head><body><script src="/__stills_bundle.js"></script></body></html>`;
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
  if (url === '/__stills.html') {
    res.setHeader('content-type', 'text/html');
    res.end(HARNESS);
    return;
  }
  if (url === '/__stills_bundle.js') {
    res.setHeader('content-type', 'text/javascript');
    res.end(bundleJs);
    return;
  }
  // Static file under public/, with a guard against path traversal. Require the resolved path
  // to be publicDir itself or sit BELOW it (trailing separator), so a sibling like `public-x`
  // cannot satisfy a bare prefix check. The only client is our own harness, but keep it honest.
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

// 4) Drive headless Chrome (software WebGL) over the harness and render each figure.
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

await page.goto(`${origin}/__stills.html`, { waitUntil: 'load', timeout: 30000 });
await page.waitForFunction('window.__ready === true', { timeout: 20000 });

let ok = 0;
let failed = 0;
for (const job of jobs.values()) {
  if (only && !only.has(job.model)) continue;
  const spec = GUIDE_MODELS[job.model];
  const tintNum = job.tint ? parseInt(String(job.tint).replace('#', ''), 16) : null;
  // One try wraps the whole job (render + the blank check + sharp encode + write) so any of
  // them attributes the failure to job.key, tallies it, and still reaches the clean shutdown.
  try {
    const pngUrl = await page.evaluate((s, t) => window.renderStill(s, t), spec, tintNum);
    const png = Buffer.from(pngUrl.split(',')[1], 'base64');
    // Reject a silently blank/off-frame render (the exact failure this pipeline exists to fix):
    // a still that frames nothing still encodes a valid, fully transparent PNG that existsSync
    // in tests/guide.test.ts cannot detect. If the alpha channel carries no opaque pixel, the
    // creature was not drawn, so fail the job rather than commit an invisible figure.
    const alpha = (await sharp(png).stats()).channels[3];
    if (!alpha || alpha.max < 8) {
      throw new Error(`blank render (alpha max ${alpha ? alpha.max : 'none'})`);
    }
    const webp = await sharp(png)
      .resize(OUT_PX, OUT_PX, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .webp({ quality: 90, alphaQuality: 100, effort: 6 })
      .toBuffer();
    writeFileSync(path.join(outDir, `${job.key}.webp`), webp);
    ok++;
    console.log(`ok ${job.key}.webp (${(webp.length / 1024).toFixed(1)} KB)`);
  } catch (e) {
    console.error(`FAILED ${job.key}: ${e.message}`);
    failed++;
  }
}

await browser.close();
server.close();
console.log(
  `\nrendered ${ok}/${jobs.size} stills to public/guide-stills/ (${OUT_PX}px, ${failed} failed, pageErrors=${pageErr})`,
);
if (failed > 0 || pageErr > 0) process.exit(1);
