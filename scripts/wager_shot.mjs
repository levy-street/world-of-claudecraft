// Proof shot for the Wager Race UI: a host opens a staked race (gold + a Mount
// Charter) and the lobby panel shows the pot, the host entry, and the actions.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = 'docs/screenshots/mounts';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH, headless: 'new',
  args: ['--window-size=1100,860', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1100, height: 860 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForSelector('#btn-offline', { timeout: 15000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await sleep(200);
await page.type('#char-name', 'Better');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await sleep(2800);

const info = await page.evaluate(() => {
  const g = window.__game; const p = g.sim.player;
  g.sim.setPlayerLevel(20, p.id);
  p.gm = true; p.maxHp = 99999; p.hp = 99999; p.mountTier = 11; p.mountId = 'sovereign';
  g.sim.players.get(p.id).copper = 500000;
  g.sim.addItem('charter_goldcrest', 1, p.id);
  for (const e of g.sim.entities.values()) if (e.kind === 'mob') { e.hostile = false; e.aiState = 'idle'; }
  g.sim.proposeWagerRace('skytrial_vale', 25000, 'charter_goldcrest'); // 2G 50S + a Charter
  g.input.camDist = 14; g.input.camPitch = 0.4;
  const wag = g.sim.wagerInfo;
  return wag ? `pot ${wag.potCopper}c +${wag.potCharters} charter, members ${wag.members.length}` : 'NO LOBBY';
});
console.log('wagerInfo:', info);
await sleep(600);
await page.screenshot({ path: `${OUT}/wager-lobby.png` });
console.log(`done -> ${OUT}/wager-lobby.png`);
await browser.close();
