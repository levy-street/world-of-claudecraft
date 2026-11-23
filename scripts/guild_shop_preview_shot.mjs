// Visual proof of Lantern Hall's quartermaster 3D preview: boots the offline game, walks to
// Garrick Holt in the Highwatch guild, fills the bags with Lantern Seals, opens his counter,
// previews and buys the Lantern Hall Destrier and the Blade of Lantern Hall, rides the
// horse and wears the appearance. Desktop and phone-width shots land in
// docs/screenshots/highwatch-guild/.
//   node scripts/guild_shop_preview_shot.mjs   (needs a dev server; GAME_URL overrides :5173)
//   PHONE=1 node scripts/guild_shop_preview_shot.mjs   (the phone-width counter only: the world
//   boots at desktop size, then CDP emulates a landscape phone with touch, which flips the HUD
//   to its touch layout without a reload)
// Uses the real GPU (no SwiftShader): the preview stages are WebGL.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = 'docs/screenshots/highwatch-guild';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** The loading curtain lifts once the world (and a teleport's new ground) is drawn. */
const waitLoaded = (page) =>
  page.waitForFunction(
    () => {
      const el = document.querySelector('#loading-screen');
      return !el || getComputedStyle(el).display === 'none' || el.offsetParent === null;
    },
    { timeout: 300000, polling: 500 },
  );

const PHONE = process.env.PHONE === '1';
const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=1600,900', '--ignore-gpu-blocklist', '--enable-gpu'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}]`, m.text());
});

await page.goto(URL, { waitUntil: 'load', timeout: 120000 });
await page.waitForSelector('#btn-offline', { timeout: 120000 });
const jsClick = (sel) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) throw new Error(`missing ${s}`);
    el.click();
  }, sel);
await sleep(400);
await jsClick('#btn-offline');
await sleep(300);
await page.type('#char-name', 'Wanderer');
await jsClick('#offline-select .mini-class[data-class="warrior"]');
await jsClick('#btn-start-offline');
await page.waitForFunction(() => window.__game?.sim?.player, { timeout: 60000 });
await sleep(2000);
await page.evaluate(() => {
  [...document.querySelectorAll('button')]
    .find((b) => /skip tutorial/i.test(b.textContent || ''))
    ?.click();
});
await page.waitForFunction(
  () => getComputedStyle(document.querySelector('#ui')).display !== 'none',
  { timeout: 30000, polling: 250 },
);

// Riding trained (the horse's buy gate) without owning the destrier: /dev mounts grants every
// reins, so the guild's are handed back before the purchase.
const setup = await page.evaluate(() => {
  const sim = window.__game.sim;
  sim.devCommands = true;
  sim.chat('/dev mounts');
  sim.removeItem('reins_lantern_hall_destrier', 1);
  sim.chat('/dev town highwatch');
  for (let i = 0; i < 3; i++) sim.chat('/dev give lantern_seal 20');
  const garrick = [...sim.entities.values()].find(
    (e) => e.templateId === 'guild_quartermaster_garrick_holt',
  );
  if (!garrick) return 'no garrick';
  const p = sim.player;
  window.__townSpot = { x: p.pos.x, y: p.pos.y, z: p.pos.z };
  p.pos.x = garrick.pos.x + 1.5;
  p.pos.z = garrick.pos.z + 1.5;
  p.pos.y = garrick.pos.y;
  return garrick.id;
});
console.log('garrick', setup);
await sleep(2000);
await waitLoaded(page);
await sleep(3000);
// the arrival notices (the ferryman's welcome) would sit over the counter
const dismiss = () =>
  page.evaluate(() => {
    for (const b of document.querySelectorAll('button')) {
      if (/^\s*understood\s*$/i.test(b.textContent || '') && b.offsetParent) b.click();
    }
  });
await dismiss();
await sleep(500);
if (PHONE) {
  const cdp = await page.createCDPSession();
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 844,
    height: 390,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await page.waitForFunction(() => document.body.classList.contains('mobile-touch'), {
    timeout: 20000,
  });
  await sleep(2500);
  await dismiss();
}
const talk = () =>
  page.evaluate((id) => window.__game.sim.talkToNpc(id), setup).then(() => sleep(800));
await talk();
await page.waitForFunction(
  () => getComputedStyle(document.querySelector('#guild-hall-window')).display !== 'none',
  { timeout: 10000 },
);
const pick = async (id) => {
  await jsClick(`[data-gh-offer="${id}"]`);
  await sleep(6000); // the stage links and uploads before it draws
};
const shot = (name) => page.screenshot({ path: `${OUT}/${name}.jpg`, type: 'jpeg', quality: 85 });

if (PHONE) {
  // the short landscape sheet scrolls: bring the stage into view, and clip to the phone
  const phoneShot = async (name) => {
    await page.evaluate(() =>
      document
        .querySelector('#guild-hall-window .gh-model-stage')
        ?.scrollIntoView({ block: 'center' }),
    );
    await sleep(1500);
    await page.screenshot({
      path: `${OUT}/${name}.jpg`,
      type: 'jpeg',
      quality: 85,
    });
  };
  await pick('mount_lantern_hall_destrier');
  await phoneShot('after_shop_3d_destrier_phone');
  await pick('weapon_skin_lantern_hall_sword');
  await phoneShot('after_shop_3d_lantern_sword_phone');
  await browser.close();
  process.exit(0);
}
await pick('mount_lantern_hall_destrier');
await shot('after_shop_3d_destrier_desktop');
await pick('weapon_skin_lantern_hall_sword');
await shot('after_shop_3d_lantern_sword_desktop');
const stages = await page.evaluate(() => ({
  canvases: document.querySelectorAll('#guild-hall-window .gh-stage canvas').length,
  label: document.querySelector('#guild-hall-window .gh-stage')?.getAttribute('aria-label'),
}));
console.log('stage', JSON.stringify(stages));

// buy both
await jsClick('[data-gh-buy="weapon_skin_lantern_hall_sword"]');
await sleep(800);
await pick('mount_lantern_hall_destrier');
await jsClick('[data-gh-buy="mount_lantern_hall_destrier"]');
await sleep(1200);
const owned = await page.evaluate(() => {
  const sim = window.__game.sim;
  return {
    mounts: sim.ownedMounts().includes('lantern_hall_destrier'),
    skin: sim.accountCosmetics.weaponSkinIds.includes('lantern_hall_sword'),
    seals: sim.inventory
      .filter((s) => s?.itemId === 'lantern_seal')
      .reduce((n, s) => n + s.count, 0),
  };
});
console.log('owned', JSON.stringify(owned));

// close, wear the appearance, ride the horse
await jsClick('#guild-hall-window [data-close]');
await dismiss();
await page.evaluate(() => {
  const sim = window.__game.sim;
  const spot = window.__townSpot;
  sim.player.pos.x = spot.x;
  sim.player.pos.y = spot.y;
  sim.player.pos.z = spot.z;
  sim.changeWeaponSkin('lantern_hall_sword', 'sword');
  sim.useItem('reins_lantern_hall_destrier');
});
await sleep(6000);
const rid = await page.evaluate(() => ({
  mounted: window.__game.sim.player.mountKey ?? null,
  loadout: JSON.stringify(window.__game.sim.accountCosmetics.weaponSkinLoadout),
}));
console.log('ride', JSON.stringify(rid));
await shot('after_destrier_ridden_lantern_sword');
await browser.close();
