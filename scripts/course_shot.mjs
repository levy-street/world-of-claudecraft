// Proof shot for the hoop minigame: boots the offline client, GM-mounts a flyer,
// starts the Vale Skytrial, crosses the first ring (clock running), and captures
// the rings + the course HUD overlay. Writes docs/screenshots/mounts/course-hoop.png.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = 'docs/screenshots/mounts';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1000,820', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1000, height: 820 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE:', m.text()); });

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForSelector('#btn-offline', { timeout: 15000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await sleep(200);
await page.type('#char-name', 'Skyrider');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await sleep(2800);

// GM flyer, pacify the roster, summon a flyer instantly, start the trial.
await page.evaluate(() => {
  const g = window.__game;
  const p = g.sim.player;
  g.sim.setPlayerLevel(20, p.id);
  p.gm = true; p.maxHp = 99999; p.hp = 99999;
  p.mountTier = 11;
  p.mountId = 'goldcrest'; // a winged flyer (skip the summon cast for the shot)
  for (const e of g.sim.entities.values()) {
    if (e.kind === 'mob') { e.hostile = false; e.aggroTargetId = null; e.aiState = 'idle'; }
  }
  g.sim.startCourse('skytrial_vale'); // teleports to the start gate; rings spawn
});
await sleep(400);
// cross the first ring so the clock is running and the overlay shows progress
await page.evaluate(() => {
  const g = window.__game;
  const p = g.sim.player;
  // the first ring of the ring-loop sits at (38+30, 18, 138); place on it so the
  // clock starts and the overlay shows progress, then frame the loop.
  p.pos.x = 68; p.pos.y = 18; p.pos.z = 138;
  g.input.camDist = 16; g.input.camPitch = 0.34;
  // hide the rest of the HUD but keep the course overlay (a child of #ui)
  const ui = document.querySelector('#ui');
  if (ui) for (const c of ui.children) if (c.id !== 'course-hud') c.style.display = 'none';
  const np = document.querySelector('#nameplates');
  if (np) np.style.display = 'none';
});
await sleep(700);
await page.screenshot({ path: `${OUT}/course-hoop.png` });
console.log(`done -> ${OUT}/course-hoop.png`);
await browser.close();
