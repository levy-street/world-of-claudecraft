// Screenshot tour for the zone-aware fishing catch table.
// Boots the offline game, fishes at Mirror Lake in Eastbrook Vale, and captures
// the cast, the varied catches in the combat log, and the bags window.
// Needs `npm run dev` (:5173). PNGs land in tmp/.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
fs.mkdirSync('tmp', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.click('#btn-offline');
await new Promise((r) => setTimeout(r, 200));
await page.type('#char-name', 'Angler');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await page.waitForFunction(() => window.__game?.sim?.player, { timeout: 60000 });
await new Promise((r) => setTimeout(r, 1500));

// Find a dry lake-edge spot facing fishable water, then start a real cast.
const spot = await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const p = sim.player;
  p.maxHp = 99999; p.hp = 99999;
  sim.addItem('simple_fishing_pole', 1);
  const LAKE = { x: -92, z: 88 };
  for (let r = 22; r <= 50; r += 1) {
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      const x = LAKE.x + Math.cos(a) * r;
      const z = LAKE.z + Math.sin(a) * r;
      const facing = Math.atan2(LAKE.x - x, LAKE.z - z);
      p.pos.x = x; p.pos.z = z; p.prevPos = { ...p.pos };
      p.facing = facing;
      g.input.camYaw = facing;
      sim.events = [];
      sim.useItem('simple_fishing_pole');
      if (p.castingAbility === 'fishing') return { x, z, facing };
    }
  }
  return null;
});
console.log('fishing spot:', JSON.stringify(spot));
await new Promise((r) => setTimeout(r, 1200));
await page.screenshot({ path: 'tmp/fishing_01_cast.png' });

// Reel in a generous variety of catches so the log + bags show the new content.
// Keep rolling until the rare Glimmerfin Koi appears so the log shows it.
await page.evaluate(() => {
  const sim = window.__game.sim;
  const meta = sim.meta(sim.player.id);
  // cancel the in-progress cast, then resolve catches directly (still real
  // zone-aware rolls from sim.rng) so we don't wait 5s each.
  sim.player.castingAbility = null;
  const has = () => meta.inventory.some((s) => s.itemId === 'glimmerfin_koi');
  for (let i = 0; i < 30; i++) sim.completeFishing(sim.player, meta);
  for (let i = 0; i < 600 && !has(); i++) sim.completeFishing(sim.player, meta);
});
await new Promise((r) => setTimeout(r, 800));
await page.screenshot({ path: 'tmp/fishing_02_catchlog_full.png' });
// Clip just the chat/combat log so the catch messages are legible.
const logBox = await page.$('#chatlog');
if (logBox) await logBox.screenshot({ path: 'tmp/fishing_02_catchlog.png' });

// Open the bags window to show the haul of different fish.
await page.keyboard.press('b');
await new Promise((r) => setTimeout(r, 600));
await page.screenshot({ path: 'tmp/fishing_03_bags_full.png' });
const bagBox = await page.$('#bags');
if (bagBox) await bagBox.screenshot({ path: 'tmp/fishing_03_bags.png' });

const haul = await page.evaluate(() => {
  const sim = window.__game.sim;
  const meta = sim.meta(sim.player.id);
  const ITEMS = {};
  for (const s of meta.inventory) ITEMS[s.itemId] = s.count;
  return ITEMS;
});
console.log('haul:', JSON.stringify(haul, null, 2));

await browser.close();
console.log('done — screenshots in tmp/fishing_*.png');
