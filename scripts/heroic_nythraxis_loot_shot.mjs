// Visual proof of the Heroic Nythraxis loot tier. Boots the offline game as a
// WARRIOR, drops a normal Nythraxis tier piece beside its heroic version, a
// bespoke heroic epic, and a normal + heroic legendary, then hovers each so the
// tooltip shows the "[HEROIC]" type-line tag and the scaled-up stats.
//   GAME_URL=http://localhost:5176 node scripts/heroic_nythraxis_loot_shot.mjs
// (needs `npm run dev` for this worktree running; default url below).
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5176';
const OUT = 'docs/screenshots';
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync('tmp', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=1600,1000', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 1000 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 40000 });
const jsClick = (sel) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) throw new Error(`missing ${s}`);
    el.click();
  }, sel);
await new Promise((r) => setTimeout(r, 500));
await jsClick('#btn-offline');
await new Promise((r) => setTimeout(r, 300));
await page.type('#char-name', 'Warforged');
await jsClick('#offline-select .mini-class[data-class="warrior"]');
await jsClick('#btn-start-offline');
await page.waitForFunction(() => window.__game?.sim?.player, { timeout: 45000 });
await new Promise((r) => setTimeout(r, 2000));
// Skip the intro cinematic, which otherwise keeps #ui hidden (display:none).
for (let i = 0; i < 3; i++) {
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 400));
}
await page.waitForFunction(
  () => getComputedStyle(document.querySelector('#ui')).display !== 'none',
  {
    timeout: 15000,
  },
);

// Level the character so the level-20 raid gear is not inert, then drop the
// pairs we want to compare.
const ITEMS = [
  'crownforged_dreadhelm', // normal set helm
  'crownforged_dreadhelm_heroic', // heroic version (same name, [HEROIC], scaled)
  'deathless_greatblade', // bespoke heroic epic weapon
  'kingsbane_last_oath', // normal legendary
  'kingsbane_last_oath_heroic', // heroic legendary
];
const inv = await page.evaluate((ids) => {
  const sim = window.__game.sim;
  for (const id of ids) sim.addItem(id, 1, sim.player.id);
  return sim.inventory.map((s) => s.itemId).filter(Boolean);
}, ITEMS);
console.log('inventory:', JSON.stringify(inv));

await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) =>
    /skip tutorial/i.test(b.textContent || ''),
  );
  btn?.click();
});
await new Promise((r) => setTimeout(r, 400));
await page.keyboard.press('b');
await new Promise((r) => setTimeout(r, 700));

async function hoverShot(nameNeedle, nth, file) {
  await page.mouse.move(10, 10);
  await new Promise((r) => setTimeout(r, 150));
  const ok = await page.evaluate(
    ({ nm, idx }) => {
      const rows = [...document.querySelectorAll('#bags button.bag-item')].filter((b) =>
        (b.getAttribute('aria-label') || '').startsWith(nm),
      );
      const row = rows[idx];
      if (!row) return false;
      const b = row.getBoundingClientRect();
      const x = b.x + b.width / 2;
      const y = b.y + b.height / 2;
      for (const type of ['mouseenter', 'mouseover', 'mousemove']) {
        row.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
      }
      return true;
    },
    { nm: nameNeedle, idx: nth },
  );
  if (!ok) {
    console.log('row not found:', nameNeedle, nth);
    return;
  }
  await new Promise((r) => setTimeout(r, 350));
  const info = await page.evaluate(() => {
    const tt = document.querySelector('#tooltip');
    const b = tt.getBoundingClientRect();
    return { text: tt?.innerText?.replace(/\n/g, ' | '), x: b.x, y: b.y, w: b.width, h: b.height };
  });
  console.log(`tooltip[${nameNeedle}#${nth}]:`, JSON.stringify(info.text));
  const pad = 8;
  await page.screenshot({
    path: `${OUT}/${file}`,
    clip: {
      x: Math.max(0, info.x - pad),
      y: Math.max(0, info.y - pad),
      width: info.w + pad * 2,
      height: info.h + pad * 2,
    },
  });
}

// Same name, but the heroic copy (added second) carries [HEROIC] and higher stats.
await hoverShot('Bonewrought Dreadhelm', 0, 'heroic_loot_dreadhelm_normal.png');
await hoverShot('Bonewrought Dreadhelm', 1, 'heroic_loot_dreadhelm_heroic.png');
await hoverShot('Deathless Greatblade', 0, 'heroic_loot_bespoke_greatblade.png');
await hoverShot('Thronebane', 0, 'heroic_loot_legendary_normal.png');
await hoverShot('Thronebane', 1, 'heroic_loot_legendary_heroic.png');

// Full bag context shot.
await page.mouse.move(10, 10);
await new Promise((r) => setTimeout(r, 150));
await page.screenshot({ path: `${OUT}/heroic_loot_bags.png` });

await browser.close();
console.log('done');
