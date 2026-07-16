// Visual check for the customizable performance overlay. Boots the offline game
// in headless Chromium, enables the overlay with a rich metric set, and saves
// screenshots of the in-world overlay + the Options > Performance panel to tmp/.
// Captures the panel on desktop, mobile landscape, and mobile portrait so the
// responsive layout (single column, full-width touch targets) can be eyeballed.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
fs.mkdirSync('tmp', { recursive: true });

const ALL_METRICS = {
  fps: true,
  frameTime: true,
  fps1Low: true,
  fps01Low: true,
  hitches: true,
  ping: true,
  jitter: true,
  snapshot: true,
  connection: true,
  drawCalls: true,
  triangles: true,
  geometries: true,
  textures: true,
  programs: true,
  renderScale: true,
  gpu: true,
  memory: true,
  entities: true,
};

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=1600,1000', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 1000 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push('CONSOLE: ' + msg.text());
});

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForSelector('#btn-offline', { timeout: 15000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await new Promise((r) => setTimeout(r, 250));
await page.type('#char-name', 'Adventurer');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await page.waitForFunction(
  () => window.__game && window.__game.hud && window.__game.hud.optionsHooks,
  { timeout: 30000 },
);
await new Promise((r) => setTimeout(r, 1500));

// Enable the overlay and turn on a rich set of metrics + the graph.
const applied = await page.evaluate((metrics) => {
  const h = window.__game.hud.optionsHooks;
  h.onSettingChange('showFps', true);
  h.perfOverlay.patch({ graph: true, thresholds: true, metrics });
  return h.perfOverlay.get();
}, ALL_METRICS);
console.log('config:', JSON.stringify(applied.metrics));

// Let the frame meter warm up + repaint a few times, then shoot the live overlay.
await new Promise((r) => setTimeout(r, 2500));
await page.screenshot({ path: 'tmp/perf_overlay_world.png' });
const box = await page.evaluate(() => {
  const el = document.querySelector('#perf-overlay');
  const r = el.getBoundingClientRect();
  return {
    x: r.x,
    y: r.y,
    width: r.width,
    height: r.height,
    visible: getComputedStyle(el).display,
  };
});
console.log('overlay box:', JSON.stringify(box));
if (box.width > 0) {
  await page.screenshot({
    path: 'tmp/perf_overlay_crop.png',
    clip: {
      x: Math.max(0, box.x - 6),
      y: Math.max(0, box.y - 6),
      width: box.width + 12,
      height: box.height + 12,
    },
  });
}

// Open Options > Performance.
await page.evaluate(() => window.__game.hud.toggleOptionsMenu());
await new Promise((r) => setTimeout(r, 150));
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('#options-menu .opt-btn')].find((b) =>
    /Performance/i.test(b.textContent),
  );
  btn?.click();
});
await new Promise((r) => setTimeout(r, 250));

// Capture the panel at a given viewport; `touch` forces body.mobile-touch so the
// touch CSS applies (the 16px input floor is separately checked by
// mobile_input_zoom_check.mjs). Re-ensures the panel is open after the resize.
async function shotPanel(name, { width, height, touch }) {
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await new Promise((r) => setTimeout(r, 150));
  const panel = await page.evaluate((isTouch) => {
    document.body.classList.toggle('mobile-touch', isTouch);
    // On a phone the panel is full-width, so the draggable live overlay (placement
    // mode) floats over it. Hide it so the panel layout reads cleanly in the shot.
    if (isTouch) window.__game.hud.optionsHooks.onSettingChange('showFps', false);
    // Hide the portrait rotate gate + preflight so the panel is unobstructed.
    for (const id of ['rotate-device', 'mobile-preflight']) {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    }
    // Re-open Options > Performance if the resize dropped the menu.
    const menu = document.querySelector('#options-menu');
    if (
      !menu ||
      getComputedStyle(menu).display === 'none' ||
      !menu.classList.contains('perf-wide')
    ) {
      const hud = window.__game.hud;
      if (!menu || getComputedStyle(menu).display === 'none') hud.toggleOptionsMenu();
      const btn = [...document.querySelectorAll('#options-menu .opt-btn')].find((b) =>
        /Performance/i.test(b.textContent),
      );
      btn?.click();
    }
    const el = document.querySelector('#options-menu');
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }, !!touch);
  await new Promise((r) => setTimeout(r, 250));
  await page.screenshot({
    path: `tmp/${name}.png`,
    clip: {
      x: Math.max(0, panel.x),
      y: Math.max(0, panel.y),
      width: Math.min(panel.width, width - Math.max(0, panel.x)),
      height: Math.min(panel.height, height - Math.max(0, panel.y)),
    },
  });
  console.log(`${name} box:`, JSON.stringify(panel));
}

await shotPanel('perf_overlay_panel', { width: 1600, height: 1000, touch: false });
await shotPanel('perf_overlay_panel_landscape', { width: 844, height: 460, touch: true });
await shotPanel('perf_overlay_panel_portrait', { width: 414, height: 896, touch: true });

console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();
