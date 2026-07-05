// Before/after visual proof for the perf frame-time graph reset fix.
//
// Boots the offline game at max graphics (?gfx=ultra) in headless Chromium,
// enables the performance overlay with EVERY metric + the sparkline (the wide
// "expanded" view), shoots it, then switches the metric set back to Minimal
// (FPS only) and shoots again. Before the fix the graph stayed pinned at the
// expanded width; after the fix it shrinks with the panel. Crops land in tmp/.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = (process.env.GAME_URL ?? 'http://localhost:5173') + '/?gfx=ultra';
fs.mkdirSync('tmp', { recursive: true });

const ALL_METRICS = {
  fps: true, frameTime: true, fps1Low: true, fps01Low: true, hitches: true,
  ping: true, jitter: true, snapshot: true, connection: true,
  drawCalls: true, triangles: true, geometries: true, textures: true,
  programs: true, renderScale: true, gpu: true, memory: true, entities: true,
};
const MINIMAL_METRICS = Object.fromEntries(Object.keys(ALL_METRICS).map((k) => [k, k === 'fps']));

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=1600,1000', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 1000 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (msg) => { if (msg.type() === 'error') errors.push('CONSOLE: ' + msg.text()); });

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForSelector('#btn-offline', { timeout: 15000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await new Promise((r) => setTimeout(r, 250));
await page.type('#char-name', 'Adventurer');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await page.waitForFunction(() => window.__game && window.__game.hud && window.__game.hud.optionsHooks, { timeout: 30000 });
await new Promise((r) => setTimeout(r, 1500));

const overlayBox = () => page.evaluate(() => {
  const el = document.querySelector('#perf-overlay');
  const r = el.getBoundingClientRect();
  const c = el.querySelector('.perf-graph');
  const cr = c ? c.getBoundingClientRect() : null;
  return {
    panelW: Math.round(r.width),
    graphW: cr ? Math.round(cr.width) : 0,
    graphCssW: c ? c.style.width : '',
    x: r.x, y: r.y, width: r.width, height: r.height,
  };
});

async function shoot(name) {
  const box = await overlayBox();
  await page.screenshot({
    path: `tmp/${name}.png`,
    clip: { x: Math.max(0, box.x - 8), y: Math.max(0, box.y - 8), width: box.width + 16, height: box.height + 16 },
  });
  console.log(`${name}:`, JSON.stringify({ panelW: box.panelW, graphW: box.graphW, graphCssW: box.graphCssW }));
  return box;
}

// 1) Everything + graph: the wide, expanded overlay.
await page.evaluate((metrics) => {
  const h = window.__game.hud.optionsHooks;
  h.onSettingChange('showFps', true);
  h.perfOverlay.patch({ graph: true, thresholds: true, metrics });
}, ALL_METRICS);
await new Promise((r) => setTimeout(r, 2800));
const everything = await shoot('perf_graph_everything');

// 2) Switch the metric set back to Minimal (FPS only). The graph must shrink with
//    the panel rather than staying stuck at the expanded width.
await page.evaluate((metrics) => {
  window.__game.hud.optionsHooks.perfOverlay.patch({ metrics });
}, MINIMAL_METRICS);
// Wait for the overlay to re-render down to the single FPS row + settle.
await page.waitForFunction(
  () => document.querySelectorAll('#perf-overlay .perf-row').length <= 1,
  { timeout: 8000 },
);
await new Promise((r) => setTimeout(r, 800));
const minimal = await shoot('perf_graph_minimal');

const shrank = minimal.graphW < everything.graphW - 20;
const pinned = /px$/.test(minimal.graphCssW);
console.log(`graph shrank on Minimal: ${shrank} (everything=${everything.graphW}px -> minimal=${minimal.graphW}px)`);
console.log(`canvas pins an absolute px width: ${pinned} (style.width="${minimal.graphCssW}")`);
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');

await browser.close();
if (!shrank || pinned) process.exit(1);
