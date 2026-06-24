// Proof shot for the race panel: boots offline, GM-mounts a flyer, starts a
// (solo) race, and captures the race HUD panel mid-countdown over the rings.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = 'docs/screenshots/mounts';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH, headless: 'new',
  args: ['--window-size=1000,820', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1000, height: 820 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForSelector('#btn-offline', { timeout: 15000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await sleep(200);
await page.type('#char-name', 'Racer');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await sleep(2800);

await page.evaluate(() => {
  const g = window.__game; const p = g.sim.player;
  g.sim.setPlayerLevel(20, p.id);
  p.gm = true; p.maxHp = 99999; p.hp = 99999; p.mountTier = 11; p.mountId = 'sovereign';
  for (const e of g.sim.entities.values()) if (e.kind === 'mob') { e.hostile = false; e.aiState = 'idle'; }
  g.sim.startRace('skytrial_vale'); // solo race (teleports to the start, countdown)
  g.input.camDist = 18; g.input.camPitch = 0.4;
  // keep the race panel + the world; hide the rest of the HUD clutter
  const ui = document.querySelector('#ui');
  if (ui) for (const c of ui.children) if (c.id !== 'race-hud' && c.id !== 'course-hud') c.style.display = 'none';
  const np = document.querySelector('#nameplates'); if (np) np.style.display = 'none';
});
await sleep(900); // mid-countdown ("Get ready N")
await page.screenshot({ path: `${OUT}/race-panel.png` });
console.log(`done -> ${OUT}/race-panel.png`);
await browser.close();
