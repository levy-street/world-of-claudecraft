// Visual proof of the collectible-mounts feature: boots the offline game,
// levels to 20 via the dev sim handle, grants every reins item, screenshots
// the bags (the collection), the character sheet's mount picker, and mounted
// riders in the world (the rigged Valorsteed, the epic griffin and gobbler,
// and the clipless hover cycle). Z rides the pick directly; the pick changes in the
// character sheet's picker (the old Mounts window is retired).
//   node scripts/mounts_shot.mjs    (needs `npm run dev`; GAME_URL overrides :5173)
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

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

// `load` rather than networkidle0: a cold vite dev server streams module
// transforms well past the idle window on first hit.
await page.goto(URL, { waitUntil: 'load', timeout: 90000 });
await page.waitForSelector('#btn-offline', { timeout: 90000 });
const jsClick = (sel) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) throw new Error(`missing ${s}`);
    el.click();
  }, sel);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(400);
await jsClick('#btn-offline');
await sleep(300);
await page.type('#char-name', 'Rider');
await jsClick('#offline-select .mini-class[data-class="warrior"]');
await jsClick('#btn-start-offline');
await page.waitForFunction(() => window.__game?.sim?.player, { timeout: 40000 });
await sleep(2000);

// Dismiss the new-adventurer tutorial overlay, which otherwise intercepts input.
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) =>
    /skip tutorial/i.test(b.textContent || ''),
  );
  btn?.click();
});
await sleep(400);

// The HUD container reveals a beat after the tutorial dismissal; wait for it so
// the window shots include the chrome (bags/minimap/hotbar), not a bare world.
await page.waitForFunction(
  () => getComputedStyle(document.querySelector('#ui')).display !== 'none',
  { timeout: 20000, polling: 250 },
);

// Level past every mount gate and collect every reins item (the boss drops).
await page.evaluate(() => {
  const sim = window.__game.sim;
  sim.setPlayerLevel(20, sim.playerId);
  for (const id of [
    'reins_valorsteed',
    'reins_grag_bear',
    'reins_stalkglider_snail',
    'reins_aether_hover_cycle',
    'reins_shadowjump_toad',
    'reins_stormfeather_griffin',
    'reins_thunderstrut_gobbler',
    'reins_drakemaw_raptor',
    'reins_terrorspark_groundshaker',
  ])
    sim.addItem(id, 1);
});
await sleep(300);

// The collection in the bags: reins items with their rarity colors + tooltip hint.
await page.evaluate(() => window.__game.hud.toggleBags());
await sleep(600);
await page.screenshot({ path: 'tmp/mounts_bag_items.png' });
console.log('bag items: tmp/mounts_bag_items.png');
await page.evaluate(() => window.__game.hud.toggleBags());
await sleep(300);

// The character sheet's mount picker (a bag click on a reins item opens this
// too, highlighting that mount's card).
await page.evaluate(() => {
  window.__game.hud.openCharacterWithMount('stormfeather_griffin');
});
await sleep(800);
await page.screenshot({ path: 'tmp/mounts_char_picker.png' });
console.log('character-sheet picker: tmp/mounts_char_picker.png');

// Pick the base horse in the picker, close the sheet.
await page.evaluate(() => {
  window.__game.sim.selectMount('valorsteed');
});
await sleep(300);
await page.waitForFunction(
  () => {
    const win = document.querySelector('#char-window');
    if (win?.style.display === 'block') {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true }),
      );
    }
    return win?.style.display !== 'block';
  },
  { timeout: 10000, polling: 250 },
);
await sleep(400);
// Ride via the real Z keybind (synthetic KeyboardEvent through the live input
// handler): Z now mounts the pick immediately, no window in between; retry
// until the sim reports mounted, then let the GLB lazy-load.
await page.waitForFunction(
  () => {
    const sim = window.__game.sim;
    if (!sim.player.mountKey) {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyZ', key: 'z', bubbles: true }));
    }
    return sim.player.mountKey === 'valorsteed';
  },
  { timeout: 10000, polling: 250 },
);
// Wait for the lazy GLB fetch + the renderer's mount visual, not a fixed nap.
await page.waitForFunction(
  () => !!window.__game.renderer?.views?.get(window.__game.sim.playerId)?.mountVisual,
  { timeout: 20000, polling: 300 },
);
await sleep(800);
// A short run so the shot shows the gallop clip mid-stride.
await page.keyboard.down('w');
await sleep(900);
await page.screenshot({ path: 'tmp/mounts_valorsteed_run.png' });
await page.keyboard.up('w');
console.log('valorsteed: tmp/mounts_valorsteed_run.png');
console.log(
  'state:',
  await page.evaluate(() => {
    const sim = window.__game.sim;
    return {
      selected: sim.selectedMount(),
      owned: sim.ownedMounts(),
      mountKey: sim.player.mountKey,
      speedMult: Math.round(sim.moveSpeedMult(sim.player) * 100) / 100,
    };
  }),
);

// Swap live onto the epic Sky-Reach Stormfeather, then the clipless hover cycle,
// waiting out each lazy GLB fetch via the renderer's view state.
const swapTo = async (key, path) => {
  await page.evaluate((k) => {
    window.__game.sim.selectMount(k);
  }, key);
  await page.waitForFunction(
    (k) =>
      window.__game.renderer?.views?.get(window.__game.sim.playerId)?.mountVisualKey ===
      `mount_${k}`,
    { timeout: 20000, polling: 300 },
    key,
  );
  await sleep(800);
  await page.screenshot({ path });
  console.log(`${key}: ${path}`);
};
await swapTo('stormfeather_griffin', 'tmp/mounts_griffin.png');
await swapTo('thunderstrut_gobbler', 'tmp/mounts_gobbler.png');
await swapTo('aether_hover_cycle', 'tmp/mounts_hover_cycle.png');

await browser.close();
