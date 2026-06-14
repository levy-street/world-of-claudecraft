// Screenshot tour of Mog's Castle: boots offline, teleports south to the royal
// capital and shoots the approach, the gatehouse, the courtyard services, King
// Mog on his throne before the Keep, the tournament yard, and the world map.
// Saves tmp/castle_*.png. Needs `npm run dev` running and a browser (set
// BROWSER_PATH or rely on scripts/browser_path.mjs autodetect).
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = (process.env.GAME_URL ?? 'http://localhost:5173') + '/?gfx=' + (process.env.GFX_TIER ?? 'high');
fs.mkdirSync('tmp', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (msg) => { if (msg.type() === 'error') errors.push('CONSOLE: ' + msg.text()); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (name) => page.screenshot({ path: `tmp/castle_${name}.png` });

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.click('#btn-offline');
await sleep(200);
await page.click('.class-card[data-class="warrior"]');
await page.waitForFunction(() => window.__game?.sim?.player, { timeout: 60000 });
await sleep(2500);

await page.evaluate(() => {
  const g = window.__game;
  g.sim.setPlayerLevel(10);
  const p = g.sim.player; p.maxHp = 999999; p.hp = 999999;
});

const tp = async (x, z, facing = Math.PI) => {
  await page.evaluate(({ x, z, facing }) => {
    const g = window.__game, p = g.sim.player;
    const pos = g.sim.groundPos(x, z);
    p.pos = pos; p.prevPos = { ...pos };
    p.facing = facing; p.prevFacing = facing;
    g.input.camYaw = facing;
  }, { x, z, facing });
  await sleep(1000);
};

const W = -Math.PI / 2, E = Math.PI / 2, S = Math.PI;
const faceTo = (x, z) => Math.atan2(0 - x, -360 - z); // look toward castle center

// 1) a three-quarter establishing view from the north-east
await tp(54, -304, faceTo(54, -304));
await shot('01_approach');

// confirm the castle actually built + the King and services are present
const census = await page.evaluate(() => {
  const g = window.__game;
  const ents = [...g.sim.entities.values()];
  const has = (id) => ents.some((e) => e.templateId === id);
  return {
    king: ents.find((e) => e.templateId === 'king_mog')?.name ?? null,
    weaponsmith: has('royal_weaponsmith'), armorer: has('royal_armorer'),
    provisioner: has('royal_provisioner'), trader: has('royal_trader'),
    market: has('market_keeper'), guards: ents.filter((e) => e.templateId.startsWith('guard_')).length,
    castlePieces: g.sim.cfg ? undefined : undefined,
  };
});
console.log('castle census:', JSON.stringify(census));

// 2) the gatehouse, up close
await tp(0, -300, S);
await shot('02_gatehouse');

// 3) inside the walls — courtyard, services, keep ahead
await tp(0, -338, S);
await shot('03_courtyard');

// 4) King Mog on his throne dais before the Keep
await tp(0, -356, S);
await shot('04_king_mog');

// 5) the market / forge side of the courtyard
await tp(12, -360, W);
await shot('05_services');

// 6) the eastern tournament yard (archery butts + pavilions), wall behind
await tp(66, -360, W);
await shot('06_tournament');

// 7) the windmill, west wall and a corner tower
await tp(-66, -322, faceTo(-66, -322));
await shot('07_walls');

// 8) the world map — Mog's Castle now sits south of Eastbrook
await tp(0, -300, S);
await page.keyboard.press('m');
await sleep(600);
await shot('08_map');
await page.keyboard.press('m');

console.log(errors.length ? 'PAGE ERRORS:\n' + errors.slice(0, 8).join('\n') : 'no page errors');
await browser.close();
