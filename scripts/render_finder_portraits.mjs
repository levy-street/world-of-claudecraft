// Pre-renders one transparent WebP portrait per Dungeon Finder encounter
// (docs/prd/dungeon-finder.md): the finder window previews bosses with static
// prerendered art, never a live Three.js scene. Output lands in
// public/ui/dungeons/<mobId>.webp and is committed; the window reads the URL
// baked by src/ui/dungeon_finder_view.ts (FINDER_PORTRAIT_DIR).
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
const outDir = path.join(publicDir, 'ui', 'dungeons');
const OUT_PX = Number(process.env.PORTRAIT_PX || 128); // shipped size; the window shows 64px
mkdirSync(outDir, { recursive: true });

// 1) Bundle the shared browser render entry (see render_model_stills.mjs for the
//    import.meta.env define rationale).
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
  throw new Error('portrait bundle still contains a raw `import.meta` (add a define)');
}

// 2) Load the finder catalogue + mob templates + the renderer's visual manifest
//    via the data-URL bundling trick (never import raw .ts directly).
const dataEntry = `
  export { FINDER_ACTIVITIES } from './src/sim/content/dungeon_finder.ts';
  export { MOBS } from './src/sim/data.ts';
  export { VISUALS, visualKeyFor } from './src/render/characters/manifest.ts';
`;
const dataBuilt = await esbuild.build({
  stdin: { contents: dataEntry, resolveDir: root, sourcefile: 'portraits-data.ts', loader: 'ts' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  logLevel: 'silent',
});
const dataUrl = `data:text/javascript;base64,${Buffer.from(dataBuilt.outputFiles[0].text).toString('base64')}`;
const { FINDER_ACTIVITIES, MOBS, VISUALS, visualKeyFor } = await import(dataUrl);

// One job per distinct encounter mob id, resolved through the same visual
// manifest the game renderer uses (model spec + entity/fixed tint).
function specFor(visualKey) {
  const def = VISUALS[visualKey];
  if (!def) return null;
  const spec = { url: def.url, idle: def.clips?.idle ?? null, height: def.height };
  if (def.yaw) spec.yaw = def.yaw;
  if (def.hover) spec.hover = def.hover;
  if (def.show) spec.show = def.show;
  if (def.attach) spec.attach = def.attach;
  if (def.weaponFix) spec.weaponFix = def.weaponFix;
  if (def.tint !== undefined) spec.tintStrength = def.tintStrength ?? 0.4;
  return spec;
}

const jobs = new Map();
for (const activity of FINDER_ACTIVITIES) {
  for (const enc of activity.encounters) {
    if (jobs.has(enc.mobId)) continue;
    const mob = MOBS[enc.mobId];
    if (!mob) throw new Error(`finder encounter references unknown mob ${enc.mobId}`);
    const vk = visualKeyFor({ kind: 'mob', templateId: enc.mobId, family: mob.family });
    const spec = specFor(vk);
    if (!spec) throw new Error(`no visual for finder mob ${enc.mobId} (visual key ${vk})`);
    const def = VISUALS[vk];
    const tint =
      def.tint === undefined ? null : def.tint === 'entity' ? (mob.color ?? null) : def.tint;
    jobs.set(enc.mobId, { mobId: enc.mobId, spec, tint });
  }
}

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

await page.goto(`${origin}/__portraits.html`, { waitUntil: 'load', timeout: 30000 });
await page.waitForFunction('window.__ready === true', { timeout: 20000 });

let ok = 0;
let failed = 0;
for (const job of jobs.values()) {
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
    if (!alpha || alpha.max < 8) {
      throw new Error(`blank render (alpha max ${alpha ? alpha.max : 'none'})`);
    }
    const webp = await sharp(png)
      .resize(OUT_PX, OUT_PX, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .webp({ quality: 88, alphaQuality: 100, effort: 6 })
      .toBuffer();
    writeFileSync(path.join(outDir, `${job.mobId}.webp`), webp);
    ok++;
    console.log(`ok ${job.mobId}.webp (${(webp.length / 1024).toFixed(1)} KB)`);
  } catch (e) {
    console.error(`FAILED ${job.mobId}: ${e.message}`);
    failed++;
  }
}

await browser.close();
server.close();
console.log(
  `\nrendered ${ok}/${jobs.size} finder portraits to public/ui/dungeons/ (${OUT_PX}px, ${failed} failed, pageErrors=${pageErr})`,
);
if (failed > 0 || pageErr > 0) process.exit(1);
