// Visual capture for the buff/debuff effect tooltip line. Boots the offline game,
// injects a representative buff + debuff set onto the player (fresh chars have none),
// hovers each aura icon to surface the #tooltip, and screenshots it. The new
// `.tt-effect` line ("Increases attack power by 50", "Deals 15 Shadow damage every
// 3 sec", etc.) is what this adds. Needs `npm run dev` on :5173.
//
// Env: GAME_URL (default http://localhost:5173; append ?lang=zh_CN etc to capture a
// localized run), SHOT_PREFIX (default aura_tooltip) for the tmp/ output filenames.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const PREFIX = process.env.SHOT_PREFIX ?? 'aura_tooltip';
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await page.bringToFront();

const jsClick = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.waitForSelector('#btn-offline', { timeout: 30000 });
await jsClick('#btn-offline');
await sleep(400);
await page.waitForSelector('#char-name', { timeout: 30000 });
await page.type('#char-name', 'Warlord');
await jsClick('#offline-select .mini-class[data-class="warrior"]');
await sleep(300);
await jsClick('#btn-start-offline');
await page.bringToFront();
await page.waitForFunction(() => window.__game?.sim?.player, { timeout: 60000 });
await sleep(1500);

// Stamp a representative buff + debuff set onto the player's `.auras` array. Data
// only, no eval. One per effect family: flat stat buff, DoT, slow, stacking armor.
await page.evaluate(() => {
  window.__game.sim.player.auras = [
    {
      id: 'battle_shout',
      name: 'Battle Shout',
      kind: 'buff_ap',
      remaining: 118,
      duration: 120,
      value: 50,
      sourceId: 0,
      school: 'physical',
    },
    {
      id: 'deep_wounds',
      name: 'Gaping Wounds',
      kind: 'dot',
      remaining: 12,
      duration: 15,
      value: 15,
      tickInterval: 3,
      sourceId: 0,
      school: 'shadow',
    },
    {
      id: 'hamstring',
      name: 'Hamstring',
      kind: 'slow',
      remaining: 8,
      duration: 15,
      value: 0.5,
      sourceId: 0,
      school: 'physical',
    },
    {
      id: 'sunder_armor',
      name: 'Sunder Armor',
      kind: 'sunder',
      remaining: 30,
      duration: 30,
      value: 0.04,
      stacks: 5,
      sourceId: 0,
      school: 'physical',
    },
  ];
  // Force a HUD repaint (the rAF render loop is throttled in headless Chromium).
  window.__game.hud.update();
});
await sleep(400);

async function shoot(sel, path, pad = 14) {
  const b = await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, sel);
  if (!b || b.w === 0) {
    console.log('no element', sel);
    return;
  }
  await page.screenshot({
    path,
    clip: {
      x: Math.max(0, b.x - pad),
      y: Math.max(0, b.y - pad),
      width: b.w + pad * 2,
      height: b.h + pad * 2,
    },
  });
}

const count = await page.evaluate(() => document.querySelectorAll('#buff-bar .buff').length);
console.log('aura icons rendered:', count);

for (let i = 0; i < count; i++) {
  // Reset the pointer first so the previous tooltip clears and the next mouseenter
  // re-fires cleanly (otherwise the pointer can land on the tooltip itself).
  await page.mouse.move(900, 700);
  await sleep(150);
  const icons = await page.$$('#buff-bar .buff');
  if (!icons[i]) continue;
  await icons[i].hover();
  await sleep(350);
  const txt = await page.evaluate(() => document.querySelector('#tooltip')?.innerText ?? '');
  console.log(`tooltip ${i + 1}:`, txt.replace(/\n/g, ' | '));
  await shoot('#tooltip', `tmp/${PREFIX}_${i + 1}.png`);
}

console.log(`screenshots written to tmp/${PREFIX}_*.png`);
await browser.close();
