// Verify the painted per-item weapon icons show up in the real HUD. Boots the offline
// game, drops a spread of weapons (epic→common, every type) into the player's
// bags via the sim, opens the bag window, and screenshots it. Needs `npm run dev`.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const EXPECTED_WEAPON_IDS = [
  'wyrmfang_greatblade',
  'staff_of_the_gravewyrm',
  'fang_of_korzul',
  'valeborn_spellblade',
  'gravecaller_staff',
  'moggers_copper_cudgel',
  'fen_reaver_glaive',
  'drogmars_skullcleaver',
  'redbrook_blade',
  'voss_sanctified_mace',
  'worn_sword',
  'rusty_hatchet',
];
fs.mkdirSync('tmp', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
const pageErrors = [];
const consoleErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
const booted = await enterOfflineGame(page, {
  charClass: 'warrior',
  charName: 'Iconsmith',
  settleMs: 500,
  gameBootTimeoutMs: 90000,
});
if (!booted) throw new Error('offline world did not boot');
await page.waitForSelector('#ui', { visible: true, timeout: 15000 });
await page.evaluate(() => window.__game.hud.closeOptions());

const result = await page.evaluate((expectedWeaponIds) => {
  const sim = window.__game.sim;
  const pid = sim.player.id;
  const ids = [...expectedWeaponIds];
  for (const id of ids) sim.addItem(id, 1, pid);
  // Render + force-show the bag panel (#bags is hidden via CSS, so a single
  // toggleBags() would read style.display==='' and close it instead).
  window.__game.hud.renderBags();
  document.querySelector('#bags').style.display = 'flex';
  return {
    inv: window.__game.world.inventory.map((s) => s.itemId),
  };
}, EXPECTED_WEAPON_IDS);
await new Promise((r) => setTimeout(r, 700));
await page.screenshot({ path: 'tmp/icons_bags.png' });

// Confirm the <img> sources point at per-item WebPs and decoded.
const imgInfo = await page.evaluate((expectedWeaponIds) => {
  const imgs = [...document.querySelectorAll('.item-icon')];
  const weaponIds = new Set(expectedWeaponIds);
  const weaponImgs = imgs.flatMap((img) => {
    const url = new URL(img.src);
    const match = url.pathname.match(/\/([^/]+)\.webp$/);
    const id = match?.[1];
    if (id === undefined || !weaponIds.has(id)) return [];
    return [
      {
        id,
        path: url.pathname,
        complete: img.complete,
        width: img.naturalWidth,
        height: img.naturalHeight,
      },
    ];
  });
  return {
    total: imgs.length,
    weaponImgs,
  };
}, EXPECTED_WEAPON_IDS);

const failures = [];
for (const id of EXPECTED_WEAPON_IDS) {
  const matches = imgInfo.weaponImgs.filter((img) => img.id === id);
  if (matches.length === 0) {
    failures.push(`missing rendered icon for ${id}`);
    continue;
  }
  for (const match of matches) {
    const expectedPath = `/ui/items/${id}.webp`;
    if (
      match.path !== expectedPath ||
      !match.complete ||
      match.width !== 128 ||
      match.height !== 128
    ) {
      failures.push(`${id} did not decode as ${expectedPath} at 128x128: ${JSON.stringify(match)}`);
    }
  }
}
for (const id of EXPECTED_WEAPON_IDS) {
  if (!result.inv.includes(id)) failures.push(`inventory setup omitted ${id}`);
}
for (const message of pageErrors) failures.push(`page error: ${message}`);

console.log('inventory:', result.inv.join(', '));
console.log('icon imgs:', imgInfo.total, '| painted weapon WebPs:', imgInfo.weaponImgs.length);
console.log('decoded weapon icons:', JSON.stringify(imgInfo.weaponImgs));
console.log('console errors:', consoleErrors.length);
consoleErrors.slice(0, 6).forEach((e) => {
  console.log(' ', e);
});
await browser.close();
if (failures.length > 0) {
  throw new Error(`weapon icon verification failed:\n- ${failures.join('\n- ')}`);
}
