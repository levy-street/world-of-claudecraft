// Captures the character-sheet and inspect 3D previews with an Armory weapon
// skin active, offline: a rogue holding the starter dagger applies the
// Frostbite skin through the real changeWeaponSkin path, then (a) opens the
// character sheet and (b) inspects a staged dev bot wearing the same skin.
// Run with MODE=base on the base branch for the before set (base dagger model).
// Needs the dev client running:  npm run dev
//   BROWSER_PATH=... node scripts/preview_weapon_skin_shot.mjs

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const MODE = process.env.MODE ?? 'branch';
const PREFIX = MODE === 'base' ? 'before' : 'after';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync('tmp', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  protocolTimeout: 60000,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--window-size=1280,760',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
  defaultViewport: { width: 1280, height: 760, deviceScaleFactor: 2 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERR', e.message));

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
const booted = await enterOfflineGame(page, { charClass: 'rogue', charName: 'Sable' });
console.log('offline boot:', booted);
await page.evaluate(() => document.querySelector('.gpu-notice-dismiss')?.click());
await sleep(800);

// Grant + apply the skin through the real cosmetic path (the offline Sim
// enforces the weapon-type match; ownership is store-side, granted here).
const applied = await page.evaluate(() => {
  const sim = window.__game.sim;
  sim.accountCosmetics.weaponSkinIds.push('frostbite_dagger');
  sim.changeWeaponSkin('frostbite_dagger');
  return {
    loadout: sim.accountCosmetics.weaponSkinLoadout,
    worldSkin: sim.player.weaponSkinId ?? null,
  };
});
console.log('applied:', JSON.stringify(applied));
await sleep(400);

// (a) The character sheet.
await page.evaluate(() => window.__game.hud.toggleChar());
await sleep(1500);
const charClip = await page.evaluate(() => {
  const el = document.querySelector('#char-window');
  const r = el.getBoundingClientRect();
  return { x: Math.max(0, r.left), y: Math.max(0, r.top), width: r.width, height: r.height };
});
await page.screenshot({ path: `tmp/pws-${PREFIX}-charsheet.png`, clip: charClip });
console.log('char sheet shot');
await page.evaluate(() => window.__game.hud.toggleChar());
await sleep(300);

// (b) Inspect a staged bot wearing the same skin (its wire wsk equivalent).
const inspected = await page.evaluate(() => {
  const sim = window.__game.sim;
  const hud = window.__game.hud;
  const pid = sim.spawnDevBot('Mira');
  if (pid < 0) return 'bot failed';
  const bot = sim.entities.get(pid);
  bot.equippedItems = { ...bot.equippedItems, mainhand: 'rusty_dagger' };
  bot.weaponSkinId = 'frostbite_dagger';
  hud.openInspect(pid);
  return 'ok';
});
console.log('inspect:', inspected);
await sleep(1500);
const inspectClip = await page.evaluate(() => {
  const el = document.querySelector('#inspect-window');
  const r = el.getBoundingClientRect();
  return { x: Math.max(0, r.left), y: Math.max(0, r.top), width: r.width, height: r.height };
});
await page.screenshot({ path: `tmp/pws-${PREFIX}-inspect.png`, clip: inspectClip });
console.log('inspect shot');

await browser.close();
console.log('done');
