// Verify the rendered weapon icons show up in the real HUD. Boots the offline
// game, drops a spread of weapons (epic→common, every type) into the player's
// bags via the sim, opens the bag window, and screenshots it. Needs `npm run dev`.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
fs.mkdirSync('tmp', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push('PAGEERR ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('CON ' + m.text()); });

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.click('#btn-offline');
await new Promise((r) => setTimeout(r, 200));
await page.type('#char-name', 'Iconsmith');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await new Promise((r) => setTimeout(r, 2500));

const result = await page.evaluate(() => {
  const sim = window.__game.sim;
  const pid = sim.player.id;
  const ids = [
    'wyrmfang_greatblade', 'staff_of_the_gravewyrm', 'fang_of_korzul', // epic
    'valeborn_spellblade', 'gravecaller_staff', 'moggers_copper_cudgel', 'fen_reaver_glaive', 'drogmars_skullcleaver', // rare
    'redbrook_blade', 'voss_sanctified_mace', // uncommon
    'worn_sword', 'rusty_hatchet', // common
  ];
  for (const id of ids) sim.addItem(id, 1, pid);
  // Render + force-show the bag panel (#bags is hidden via CSS, so a single
  // toggleBags() would read style.display==='' and close it instead).
  window.__game.hud.renderBags();
  document.querySelector('#bags').style.display = 'flex';
  return {
    inv: window.__game.world.inventory.map((s) => s.itemId),
  };
});
await new Promise((r) => setTimeout(r, 700));
await page.screenshot({ path: 'tmp/icons_bags.png' });

// confirm the <img> srcs actually point at our jpgs and loaded
const imgInfo = await page.evaluate(() => {
  const imgs = [...document.querySelectorAll('.item-icon')];
  const weaponImgs = imgs.filter((i) => i.src.includes('/ui/weapons/'));
  return {
    total: imgs.length,
    weaponSrcs: weaponImgs.length,
    sample: weaponImgs.slice(0, 4).map((i) => ({ src: i.src.split('/').pop(), w: i.naturalWidth })),
  };
});

console.log('inventory:', result.inv.join(', '));
console.log('icon imgs:', imgInfo.total, '| weapon-jpg imgs:', imgInfo.weaponSrcs);
console.log('sample (filename, naturalWidth>0 = loaded):', JSON.stringify(imgInfo.sample));
console.log('errors:', errs.length); errs.slice(0, 6).forEach((e) => console.log(' ', e));
await browser.close();
