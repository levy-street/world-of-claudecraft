// One subject: the Gauntlet's fence lanterns carrying the course at night.
// Boots offline, accepts the run quest, forces /daynight night, soaks until
// the grade lands, and shoots from the first lane. Needs `npm run dev`.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

// gfx=high on purpose: the night light field (the lanterns' ground light)
// rides standard materials, which SwiftShader's auto-detect would refuse.
const URL = `${process.env.GAME_URL ?? 'http://localhost:5173'}?gfx=high`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync('tmp', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  protocolTimeout: 240_000,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--window-size=1600,960',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
  defaultViewport: { width: 1600, height: 960 },
});
const page = await browser.newPage();
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await page.evaluate(() => localStorage.clear());
const booted = await enterOfflineGame(page, {
  charClass: 'warrior',
  charName: 'Prover',
  gameBootTimeoutMs: 180_000,
  selectorTimeoutMs: 60_000,
});
if (!booted) throw new Error('offline world did not boot');
await page.waitForFunction(() => !!document.getElementById('tutorial-greeting'), {
  timeout: 15000,
  polling: 200,
});
await page.evaluate(() => document.querySelector('#tutorial-greeting [data-play]')?.click());
await page.waitForFunction(
  () => {
    const sim = window.__game.sim;
    return sim.entities.get(sim.playerId).pos.x < -180;
  },
  { timeout: 15000, polling: 200 },
);
await sleep(2500);
// Odo's arrival note reuses the greeting shell and can open a beat late;
// close whatever note is up, then take the run so the card engages.
await page.evaluate(() => document.querySelector('#tutorial-greeting button')?.click());
await sleep(1500);
await page.evaluate(() => document.querySelector('#tutorial-greeting button')?.click());
await page.evaluate(() => window.__game.sim.acceptQuest('q_ps_the_gauntlet'));

// Force night through real chat (the streetlamp_night_shots.mjs recipe).
await page.evaluate(() => document.activeElement?.blur?.());
await page.keyboard.press('Enter');
await sleep(500);
await page.click('#chat-input').catch(async () => page.focus('#chat-input'));
await sleep(200);
await page.evaluate(() => {
  const c = document.querySelector('#chat-input');
  c.value = '/daynight night';
  c.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.keyboard.press('Enter');
await page.evaluate(() => document.querySelector('#chat-input')?.blur());

// Stand in lane 1 looking west while the grade lands.
await page.evaluate(() => {
  const g = window.__game;
  const p = g.sim.entities.get(g.sim.playerId);
  p.pos.x = -288;
  p.pos.z = -16;
  p.facing = Math.atan2(-304 - -288, -18 - -16);
  const inp = g.input;
  inp.camYaw = p.facing;
  inp.camDist = 9;
  inp.camPitch = 0.2;
});
// The visual grade follows the sun, which takes real minutes to land.
await sleep(150_000);
await page.screenshot({ path: 'tmp/proving-shore-gauntlet-night.png' });
console.log('night shot written');
await browser.close();
