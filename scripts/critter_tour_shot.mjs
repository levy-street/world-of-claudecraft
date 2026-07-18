// Screenshot tour for ambient critters (issue #1862): boots the offline game,
// visits a handful of zones with ambient wildlife, and captures wide + closeup
// framings so the forward-axis and ground-seating fix is visible in context.
// Needs `npm run dev` (:5173). Override URL with GAME_URL=, output dir with OUT=.
//
//   OUT=tmp/critter_tour_after node scripts/critter_tour_shot.mjs
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = process.env.OUT ?? 'tmp/critter_tour';
const W = 1600;
const H = 900;
fs.mkdirSync(OUT, { recursive: true });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Four spots that spread across the ambient-critter pool (open meadow, open
// vale, the Eastbrook<->Mirefen causeway, and the marsh edge past it), each
// with a wide establishing shot and one or two projected closeups of the
// nearest critter.
const STOPS = [
  { name: '01_meadow', x: 65, z: 0, pitch: 0.45, dist: 16, closeups: 2 },
  { name: '02_vale_open', x: 150, z: 210, pitch: 0.45, dist: 16, closeups: 2 },
  { name: '03_causeway', x: 40, z: 180, pitch: 0.45, dist: 14, closeups: 2 },
  { name: '04_marsh_edge', x: -40, z: 190, pitch: 0.45, dist: 14, closeups: 2 },
  { name: '05_eastbrook_open', x: 90, z: 60, pitch: 0.45, dist: 16, closeups: 2 },
];

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [`--window-size=${W},${H}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: W, height: H },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(`CONSOLE: ${msg.text()}`);
});

// Pre-set the first-run flags the real client honors, so the camera-mode-choice
// prompt never owns a frame (mirrors scripts/sheathe_family_shots.mjs).
await page.evaluateOnNewDocument(() => {
  try {
    window.localStorage.setItem('woc.cameraModePrompt.shown', '1');
  } catch {
    /* private mode: dismissed below instead */
  }
});

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.evaluate(() => document.querySelector('#btn-offline')?.click());
await wait(300);
await page.type('#char-name', 'Naturalist');
await page.evaluate(() => {
  document.querySelector('#offline-select .mini-class[data-class="warrior"]')?.click();
  document.querySelector('#btn-start-offline')?.click();
});
await page.waitForFunction(() => !!window.__game?.sim?.player, { timeout: 30000 }).catch(() => {});
await wait(2500); // let the spawn cinematic run its course

// Belt-and-suspenders dismissal: a keydown/pointerdown already skips the intro
// cinematic (main.ts skipIntro), but fire one explicitly, then clear the
// tutorial popup and the camera-mode prompt if either is still showing.
await page.keyboard.press('Escape');
await wait(200);
await page.evaluate(() => {
  document.querySelector('.camera-prompt-confirm')?.click();
  for (const b of document.querySelectorAll('button')) {
    if (/skip tutorial/i.test(b.textContent ?? '')) b.click();
  }
});
await wait(500);

// Verify no first-run overlay is left in the DOM before shooting anything.
const overlayCheck = await page.evaluate(() => ({
  introVisible: (() => {
    const el = document.getElementById('intro-logo');
    return !!el && el.style.display !== 'none' && el.style.opacity !== '0';
  })(),
  tutorialVisible: !!document.querySelector(
    '[class*="tutorial"][style*="display: block"], .tutorial-overlay:not([hidden])',
  ),
  cameraPromptVisible: !!document.querySelector('.camera-prompt-confirm'),
}));
console.log('overlay check:', JSON.stringify(overlayCheck));

for (const stop of STOPS) {
  await page.evaluate((s) => {
    const g = window.__game;
    const p = g.sim.player;
    p.pos.x = s.x;
    p.pos.z = s.z;
    p.hp = p.maxHp = 999999;
    g.renderer.camPitch = s.pitch;
    g.renderer.camDist = s.dist;
  }, stop);
  // Re-assert god-mode HP a few times while the pool settles: local mobs
  // (mire prowlers etc) can otherwise chip the player down and pop the
  // death screen mid-wait, which is not a clean gameplay frame to ship.
  for (let i = 0; i < 20; i++) {
    await wait(200);
    await page.evaluate(() => {
      const p = window.__game.sim.player;
      p.hp = p.maxHp = 999999;
    });
  }
  await page.screenshot({ path: `${OUT}/${stop.name}_wide.png` });

  const crops = await page.evaluate((n) => {
    const g = window.__game;
    const cam = g.renderer.camera;
    const cf = g.renderer.critters;
    if (!cf) return [];
    const p = g.sim.player;
    const candidates = cf.group.children
      .filter((m) => m.visible)
      .map((m) => {
        const d = Math.hypot(m.position.x - p.pos.x, m.position.z - p.pos.z);
        const v = m.position.clone();
        v.y += 0.25;
        v.project(cam);
        const sx = (v.x * 0.5 + 0.5) * window.innerWidth;
        const sy = (-v.y * 0.5 + 0.5) * window.innerHeight;
        return {
          d,
          sx,
          sy,
          inFront: v.z > -1 && v.z < 1,
          onScreen: sx >= 0 && sx <= window.innerWidth && sy >= 0 && sy <= window.innerHeight,
        };
      })
      .filter((c) => c.inFront && c.onScreen)
      .sort((a, b) => a.d - b.d)
      .slice(0, n);
    return candidates.map(({ sx, sy, d }) => ({ sx, sy, dist: +d.toFixed(1) }));
  }, stop.closeups);
  console.log(`${stop.name} nearest critters:`, JSON.stringify(crops));
  for (let i = 0; i < crops.length; i++) {
    const c = crops[i];
    const S = 300;
    const x = Math.max(0, Math.min(W - S, Math.round(c.sx - S / 2)));
    const y = Math.max(0, Math.min(H - S, Math.round(c.sy - S / 2)));
    await page.screenshot({
      path: `${OUT}/${stop.name}_closeup${i + 1}.png`,
      clip: { x, y, width: S, height: S },
    });
  }
}

if (errors.length) {
  console.log('=== PAGE ERRORS ===');
  for (const e of errors.slice(0, 20)) console.log(e);
} else {
  console.log('no page errors');
}
await browser.close();
