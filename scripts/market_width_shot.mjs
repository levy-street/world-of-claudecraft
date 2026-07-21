// Desktop capture for PR #1058 follow-up: the wider World Market window so the
// close button no longer overlaps the title. Boots the offline game on a desktop
// viewport, floods the market, opens it, and screenshots the window. Run with
// `npm run dev` up; override the port with GAME_URL=.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = 'docs/pr-assets/market-mobile-scroll';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1280,860', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1280, height: 860 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await enterOfflineGame(page, { charClass: 'warrior', charName: 'Trader', settleMs: 2800 });
await sleep(500);
await page.evaluate(() => {
  document.querySelector('.tut-skip')?.click();
  const hud = window.__game?.hud;
  for (let i = 0; i < 20 && hud?.closeAll?.(); i++) {}
});
await sleep(300);

await page.evaluate(() => {
  const sim = window.__game.sim;
  const merchant = [...sim.entities.values()].find((e) => e.templateId === 'the_merchant');
  const at = (e, x, z) => {
    const p = sim.groundPos(x, z);
    e.pos = p;
    e.prevPos = { ...p };
  };
  at(sim.player, merchant.pos.x, merchant.pos.z - 3.2);
  sim.players.get(sim.player.id).copper = 500000;
  const goods = [
    'wolf_fang',
    'wolf_pelt',
    'spider_leg',
    'roasted_boar',
    'keen_dirk',
    'oiled_boots',
  ];
  for (let i = 0; i < 10; i++) {
    const pid = sim.addPlayer(
      ['mage', 'rogue', 'priest', 'hunter'][i % 4],
      'Seller' + 'ABCDEFGHIJ'[i],
    );
    for (let j = 0; j < 10; j++) {
      sim.addItem(goods[(i + j) % goods.length], 1, pid);
      sim.marketList(goods[(i + j) % goods.length], 1, 100 + j * 10, pid);
    }
  }
});
await page.evaluate(() => window.__game.hud.openMarket());
await sleep(600);
await page.evaluate(() => {
  for (const w of document.querySelectorAll('.window')) {
    if (w.id !== 'market-window') w.style.display = 'none';
  }
});
const box = await page.evaluate(() => {
  const w = document.querySelector('#market-window');
  const r = w.getBoundingClientRect();
  return {
    x: Math.round(r.x),
    y: Math.round(r.y),
    width: Math.round(r.width),
    height: Math.round(r.height),
  };
});
console.log('market box:', JSON.stringify(box));
await page.screenshot({
  path: `${OUT}/desktop-wider.png`,
  clip: { x: box.x, y: box.y, width: box.width, height: box.height },
});
console.log('captured ->', OUT);
await browser.close();
