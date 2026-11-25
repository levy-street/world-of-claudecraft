// Renders one large still per creature and NPC model for the player encyclopedia, so a
// creature or NPC page can show the real model instead of a small portrait icon. It reuses
// the Guide's headless still harness (scripts/wiki/render_model_stills.mjs and its browser
// entry stills_render_entry.js), but covers every creature and NPC rather than the Guide's
// showcase figures, renders larger, and writes a lookup the wiki generator reads:
// scripts/mediawiki/entity_stills.json maps "mob/<id>" and "npc/<id>" to an image URL.
//
// Run: node scripts/mediawiki/render_entity_stills.mjs  (STILL_PX overrides the size,
// ONLY=mob/wolf,npc/marla limits the run, REAL_GPU=1 uses the GPU instead of swiftshader).
// Like the Guide stills these are deterministic on one machine only, so they are committed
// and existence-checked, never diff-checked.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import * as esbuild from 'esbuild';
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';
import { BROWSER_PATH } from '../browser_path.mjs';
import { modelSpecFor, modelTintFor } from '../wiki/model_spec.mjs';
import { stillKey } from '../wiki/still_key.mjs';

const root = process.cwd();
const publicDir = path.join(root, 'public');
const STILLS_DIR = 'encyclopedia-stills';
const outDir = path.join(publicDir, STILLS_DIR);
const OUT_PX = Number(process.env.STILL_PX || 400); // shipped size; entry supersamples at 512
mkdirSync(outDir, { recursive: true });

// 1) Bundle the browser entry. loadGltf -> assetUrl reads import.meta.env.DEV (DEV gates the
//    root-relative /<logical> paths our static server maps into public/). esbuild matches each
//    FULL member path exactly (a bare `import.meta.env` define does NOT fold `.DEV`), so define
//    every Vite flag a transitive module reads (`grep -rho 'import\.meta\.env\.[A-Za-z_]*' src/`):
//    media.ts / i18n.ts read DEV/PROD, and render/gfx.ts pulls in client_origin.ts and
//    (transitively) runtime.ts for native/desktop-app origin detection, none of which apply to
//    this static headless render. Keep the list exhaustive and at web-browser defaults.
//
//    A missed define no longer surfaces as a raw `import.meta` SyntaxError: current esbuild
//    rewrites `import.meta` to an EMPTY OBJECT in an IIFE (with a warning), so `({}).env.X`
//    TypeErrors at page boot and the harness hangs at the __ready wait instead (surfacing only
//    as a PAGEERR and a 20s wait-for timeout). client_origin.ts reading VITE_NATIVE_APP hit
//    exactly that. The guard below therefore checks BOTH shapes: a literal `import.meta` and
//    the rewritten empty-object env reads.
const bundled = await esbuild.build({
  entryPoints: [path.join(root, 'scripts', 'wiki', 'stills_render_entry.js')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  define: {
    'import.meta.env.DEV': 'true',
    'import.meta.env.PROD': 'false',
    'import.meta.env.TEST': 'false',
    // three's KTX2Loader (reached through loadGltf -> ktx2_support) builds its default
    // transcoder URLs from import.meta.url at MODULE SCOPE, so the empty-object rewrite
    // throws `new URL(x, undefined)` before the page can boot. A placeholder origin keeps
    // that construction valid; the runtime overrides the path to /basis/ (same-origin on
    // the harness server below) via setTranscoderPath before any texture is transcoded.
    'import.meta.url': '"https://local.bundle/"',
    // src/client_origin.ts and src/runtime.ts (pulled in transitively via the guide
    // viewer's asset chain) also read import.meta.env at module scope; esbuild replaces
    // the whole import.meta object with {} for a non-ESM output format, so an undefined
    // field access here throws in the browser page rather than failing this build step
    // (the assert below only catches a literal `import.meta` surviving the bundle, not
    // an unmatched member access on the now-empty stand-in object). esbuild matches the
    // FULL member path, so every VITE_* member those modules read needs its own entry.
    'import.meta.env.BASE_URL': '"/"',
    'import.meta.env.VITE_API_ORIGIN': '""',
    'import.meta.env.VITE_DESKTOP_API_ORIGIN': '""',
    'import.meta.env.VITE_DESKTOP_APP': '""',
    'import.meta.env.VITE_DESKTOP_RELATIVE_API': '""',
    'import.meta.env.VITE_DISCORD_DISABLED': '""',
    'import.meta.env.VITE_NATIVE_APP': '""',
    'import.meta.env.VITE_REOWN_PROJECT_ID': '""',
    'import.meta.env.VITE_TURNSTILE_SITEKEY': '""',
    'import.meta.env.VITE_WALLET_DISABLED': '""',
  },
  write: false,
  logLevel: 'silent',
});
const bundleJs = bundled.outputFiles[0].text;
// Both failure shapes of a missed define: a raw `import.meta` (older esbuild kept it: a
// SyntaxError in a classic script) and the current empty-object rewrite (import_meta = {} /
// import_meta.env.X: a boot-time TypeError the __ready wait can only report as a timeout).
if (bundleJs.includes('import.meta') || /\bimport_meta\b/.test(bundleJs)) {
  throw new Error(
    'stills bundle still reads an import.meta.env field with no define (esbuild rewrites ' +
      'import.meta to an empty object in an IIFE, so the page TypeErrors at boot). Add an ' +
      "'import.meta.env.<field>' define above; esbuild matches the full member path.",
  );
}

// 2) Load the baked Guide content (the figure set + model specs) by bundling the generated
//    module to a data URL, the same trick build_content.mjs uses (never import raw .ts).
const dataEntry = [
  "export { VISUALS, visualKeyFor } from './src/render/characters/manifest.ts';",
  "export { wocArmorPackUrl } from './src/render/characters/woc_armor_core.ts';",
  "export { MOBS, NPCS, BUILTIN_WORLD } from './src/sim/data.ts';",
].join('\n');
const dataBuilt = await esbuild.build({
  stdin: {
    contents: dataEntry,
    resolveDir: root,
    sourcefile: 'entity-stills-data.ts',
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  logLevel: 'silent',
  define: { 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'true' },
});
const dataUrl = `data:text/javascript;base64,${Buffer.from(dataBuilt.outputFiles[0].text).toString('base64')}`;
const { VISUALS, visualKeyFor, wocArmorPackUrl, MOBS, NPCS, BUILTIN_WORLD } = await import(dataUrl);

const hexOf = (n) => (n == null ? null : `#${Number(n).toString(16).padStart(6, '0')}`);
// One job per distinct (model, tint, strength); many creatures share a rig and a tint.
const jobs = new Map();
const lookup = {};
function addEntity(kind, id, color) {
  let visualKey;
  try {
    visualKey = visualKeyFor({ kind, templateId: id });
  } catch {
    return;
  }
  const def = VISUALS[visualKey];
  if (!def?.url) return;
  // A character body (an NPC, or a creature that borrows a player or NPC rig) wears an
  // authored face, hair and props in game that this viewer cannot draw, so it would come
  // out as a generic class model. Leave those to the page icon rather than mislead.
  if (def.wocCharacter || /^(?:player|npc)_/.test(visualKey)) return;
  const tint = hexOf(modelTintFor(def, color ?? 0xffffff));
  const strength = def.tint !== undefined ? (def.tintStrength ?? 0.4) : undefined;
  const key = stillKey(visualKey, tint, strength);
  if (!jobs.has(key))
    jobs.set(key, { key, model: visualKey, spec: modelSpecFor(def, wocArmorPackUrl), tint });
  lookup[`${kind}/${id}`] = `/${STILLS_DIR}/${key}.webp`;
}
for (const m of Object.values(MOBS)) addEntity('mob', m.id, m.color);
for (const n of Object.values({ ...NPCS, ...BUILTIN_WORLD.npcs })) addEntity('npc', n.id, n.color);

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
const wanted = only
  ? new Set(
      Object.entries(lookup)
        .filter(([k]) => only.has(k))
        .map(([, url]) => url),
    )
  : null;

await page.goto(`${origin}/__stills.html`, { waitUntil: 'load', timeout: 30000 });
await page.waitForFunction('window.__ready === true', { timeout: 20000 });

let ok = 0;
let failed = 0;
for (const job of jobs.values()) {
  if (wanted && !wanted.has(`/${STILLS_DIR}/${job.key}.webp`)) continue;
  const spec = job.spec;
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
// Only point the wiki at images that exist, so a failed render falls back to the icon.
const rendered = Object.fromEntries(
  Object.entries(lookup)
    .filter(([, url]) => existsSync(path.join(publicDir, url.slice(1))))
    .sort(([a], [b]) => a.localeCompare(b)),
);
writeFileSync(
  path.join(root, 'scripts', 'mediawiki', 'entity_stills.json'),
  `${JSON.stringify(rendered, null, 2)}\n`,
);
console.log(
  `\nrendered ${ok}/${jobs.size} stills to public/${STILLS_DIR}/ (${OUT_PX}px, ${failed} failed, pageErrors=${pageErr}); ${Object.keys(rendered).length} pages have one`,
);
