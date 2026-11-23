// Boots the real editor in headless Chrome (SwiftShader WebGL) and exercises
// the two things unit tests cannot reach: the terrain splat SHADER (does it
// still link after the custom-texture rework?) and ground DECALS (do they mesh,
// texture, and stream?).
//
// Run a dev server first, then:
//   EDITOR_URL=http://localhost:5199 node scripts/decal_verify.mjs
//
// Exits non-zero on a shader-link failure, a page error, or a decal that never
// became visible. Screenshots land in tmp/.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const URL_BASE = process.env.EDITOR_URL ?? 'http://localhost:5199';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Headless SwiftShader produces no compositor frames, so requestAnimationFrame
// stalls after a few ticks and the editor's render loop simply stops. Drive its
// frame function directly instead, sleeping between batches so texture loads
// and other promises can settle.
async function pump(page, frames = 6, gapMs = 0) {
  // One round trip for the whole batch: a per-frame evaluate() costs more in
  // CDP latency than the SwiftShader frame itself.
  await page.evaluate(
    async (n, gap) => {
      const vp = window.__editor?.viewport3d;
      for (let i = 0; i < n; i++) {
        vp?.loop?.();
        // Yield so texture loads, decoders, and the asset queue can advance.
        await new Promise((r) => setTimeout(r, gap));
      }
    },
    frames,
    gapMs,
  );
}
fs.mkdirSync('tmp', { recursive: true });

const errors = [];
const shaderErrors = [];

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  protocolTimeout: 600000,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--window-size=1280,800',
    // Without these, Chrome throttles rAF in a headless page after a few
    // seconds and the editor's render loop simply stops between steps.
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
  ],
  defaultViewport: { width: 1280, height: 800 },
});

const page = await browser.newPage();
await page.bringToFront();
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  const text = m.text();
  if (/Shader Error|SHADER_INFO_LOG|Program Info Log|WebGLProgram/i.test(text)) {
    shaderErrors.push(text.slice(0, 2000));
  } else if (m.type() === 'error') errors.push(`console: ${text.slice(0, 400)}`);
});

console.log(`opening ${URL_BASE}/editor.html`);
await page.goto(`${URL_BASE}/editor.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => !!window.__editor, { timeout: 60000, polling: 250 });
// Let the terrain stream and the splat material compile.
await page.waitForFunction(() => !!window.__editor?.viewport3d?.renderer, {
  timeout: 60000,
  polling: 250,
});
await pump(page, 6);

// ---- 1. paint MORE textures than the old 24-slot cap --------------------------
const paint = await page.evaluate(async () => {
  const app = window.__editor;
  const mod = await import('/src/render/terrain_texture_sets.ts');
  const keys = mod.TERRAIN_TEXTURE_SETS.filter((s) => s.paintDefault).map((s) => s.key);
  const want = Math.min(keys.length, 40);
  for (let i = 0; i < want; i++) app.pickBuiltinTexture(keys[i]);
  const swatches = app.map.biomePaint?.custom ?? [];
  // Paint a stripe of ground with EACH textured swatch, so every slot is not
  // just declared but actually covered by paint-field weights.
  const bp = app.map.biomePaint;
  let painted = 0;
  if (bp) {
    for (let i = 0; i < swatches.length; i++) {
      app.paintBiome = swatches[i].id;
      const x = -60 + i * 3;
      app.paintBegin({ x, z: 0 });
      app.editEnd();
      painted++;
    }
  }
  return { requested: want, swatches: swatches.length, painted };
});
console.log('paint:', JSON.stringify(paint));
await pump(page, 6);
await page.screenshot({ path: 'tmp/decal_verify_paint.png' });

// ---- 2. stamp decals through the real tool path -------------------------------
const stamped = await page.evaluate(async () => {
  const app = window.__editor;
  const mod = await import('/src/render/decal_library.generated.ts');
  const keys = mod.DECAL_LIBRARY.map((d) => d.key);
  app.setTool('decal');
  const cam = app.viewport3d.renderer.camera.position;
  // A ring of stamps around the camera, plus one far away that must NOT be
  // resident (the streaming claim).
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    app.decalBrush = {
      ...app.decalBrush,
      tex: `builtin:${keys[i % keys.length]}`,
      size: 10,
      opacity: 1,
    };
    app.placeDecal({ x: cam.x + Math.cos(a) * 14, z: cam.z + Math.sin(a) * 14 });
  }
  app.placeDecal({ x: cam.x + 4000, z: cam.z + 4000 });
  return { count: app.map.decals?.length ?? 0, camX: cam.x, camZ: cam.z };
});
console.log('stamped:', JSON.stringify(stamped));

// Give the decal art time to fetch, pumping frames so the streamer meshes it
// and flips the decals visible once their textures land.
await pump(page, 6);
await sleep(2500);
await pump(page, 6);

const decalState = await page.evaluate(() => {
  const app = window.__editor;
  const scene = app.viewport3d.renderer.scene;
  const group = scene.getObjectByName('decals');
  if (!group) return { found: false };
  let visible = 0;
  let withMap = 0;
  for (const child of group.children) {
    if (child.visible) visible++;
    if (child.material?.map) withMap++;
  }
  return {
    found: true,
    resident: group.children.length,
    visible,
    withMap,
    documented: app.map.decals?.length ?? 0,
  };
});
console.log('decals:', JSON.stringify(decalState));

await page.screenshot({ path: 'tmp/decal_verify_scene.png' });

// ---- 3. streaming: walk far away, the meshes must be released -----------------
await page.evaluate(() => {
  // Through the editor's own camera control: poking three.js' camera directly
  // is overwritten by the orbit rig on the next frame.
  window.__editor.viewport3d.focusOn(3000, 3000, 40);
});
await pump(page, 4);
const afterWalk = await page.evaluate(() => {
  const group = window.__editor.viewport3d.renderer.scene.getObjectByName('decals');
  return { resident: group ? group.children.length : -1 };
});
console.log('after walking 2km away:', JSON.stringify(afterWalk));

await browser.close();

// ---- verdict ------------------------------------------------------------------
let failed = false;
if (shaderErrors.length > 0) {
  failed = true;
  console.error(`\nSHADER ERRORS (${shaderErrors.length}):`);
  for (const e of shaderErrors.slice(0, 3)) console.error(e);
}
if (errors.length > 0) {
  console.error(`\nPage/console errors (${errors.length}):`);
  for (const e of errors.slice(0, 10)) console.error(' -', e);
  failed = true;
}
if (!decalState.found || decalState.visible < 1) {
  console.error('\nNo decal became visible.');
  failed = true;
}
if (decalState.resident > decalState.documented) {
  console.error('\nMore decal meshes than documents, streaming leak.');
  failed = true;
}
if (afterWalk.resident !== 0) {
  console.error(`\nDecals still resident after walking away: ${afterWalk.resident}`);
  failed = true;
}
console.log(failed ? '\nFAILED' : '\nOK: shader linked, decals meshed and streamed');
process.exit(failed ? 1 : 0);
