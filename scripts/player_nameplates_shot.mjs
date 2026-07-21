// Captures the Show Player Nameplates interface toggle offline: three dev-bot
// players stand ahead of the local player; the world is shot with their plates
// visible, the Interface > General toggle is clicked OFF through the real
// options row (button[data-setting-key=showPlayerNameplates]), and the world is
// shot again with the plates gone. Desktop and mobile-landscape passes.
// Needs the dev client running:  npm run dev
//   GAME_URL=http://localhost:5173 node scripts/player_nameplates_shot.mjs
// Pass MODE=base when running on the base branch (no toggle row yet): captures
// only the options panel, for the before shot.

import fs from 'node:fs';
import puppeteer, { KnownDevices } from 'puppeteer-core';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const MODE = process.env.MODE ?? 'branch';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync('tmp', { recursive: true });

const BOTS = ['Aria', 'Borin', 'Cyra'];

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
  defaultViewport: { width: 1280, height: 760 },
});

async function stageScene(page) {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  const booted = await enterOfflineGame(page, { charClass: 'warrior', charName: 'Thorgar' });
  console.log('offline boot:', booted);
  await page.evaluate(() => document.querySelector('.gpu-notice-dismiss')?.click());
  await sleep(800);
  // Stage three player-kind entities in a loose rank ahead of the local player
  // so the camera frames a small crowd of plates (players have no AI: they hold).
  await page.evaluate((names) => {
    const sim = window.__game.sim;
    const p = sim.entities.get(sim.playerId);
    const dx = Math.sin(p.facing);
    const dz = Math.cos(p.facing);
    // camera-right vector for lateral spread
    const rx = Math.cos(p.facing);
    const rz = -Math.sin(p.facing);
    names.forEach((name, i) => {
      const id = sim.addPlayer('mage', name);
      const bot = sim.entities.get(id);
      const ahead = 6 + i * 1.5;
      const side = (i - 1) * 3;
      bot.pos = {
        x: p.pos.x + dx * ahead + rx * side,
        y: p.pos.y,
        z: p.pos.z + dz * ahead + rz * side,
      };
      bot.facing = p.facing + Math.PI;
    });
  }, BOTS);
  await page.evaluate(() => {
    const i = window.__game.input;
    if (i) i.camDist = 10;
  });
  await page.waitForFunction(
    (names) =>
      names.every((n) =>
        [...document.querySelectorAll('.nameplate')].some((pl) =>
          (pl.textContent ?? '').includes(n),
        ),
      ),
    { timeout: 10000, polling: 200 },
    BOTS,
  );
  await sleep(600);
}

async function openInterfaceGeneral(page) {
  await page.evaluate(() => {
    const hud = window.__game?.hud;
    if (!hud) return;
    const win = document.querySelector('#options-menu');
    if (win && getComputedStyle(win).display !== 'none') hud.toggleOptionsMenu();
    hud.toggleOptionsMenu();
    // Offline main menu: Key Bindings, Controller, Graphics, Interface, Audio, ...
    const buttons = Array.from(document.querySelectorAll('#options-menu .opt-btn'));
    buttons[3]?.click();
  });
  await page.waitForSelector('#options-menu .set-rows', { timeout: 8000 });
  await sleep(300);
  // Bring the nameplate rows into view (General is the landing tab).
  await page.evaluate(() => {
    document
      .querySelector('button[data-setting-key="showOwnNameplate"]')
      ?.scrollIntoView({ block: 'center' });
  });
  await sleep(300);
}

async function desktopPass() {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERR', e.message));

  if (MODE === 'base') {
    // Base branch: only the options panel (the row does not exist yet).
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const booted = await enterOfflineGame(page, { charClass: 'warrior', charName: 'Thorgar' });
    console.log('offline boot:', booted);
    await page.evaluate(() => document.querySelector('.gpu-notice-dismiss')?.click());
    await sleep(800);
    await openInterfaceGeneral(page);
    const clip = await page.evaluate(() => {
      const r = document.querySelector('#options-menu').getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    });
    await page.screenshot({ path: 'tmp/pn-before-options.png', clip });
    console.log('base options shot done');
    await page.close();
    return;
  }

  await stageScene(page);
  const clip = await page.evaluate((names) => {
    const rects = [...document.querySelectorAll('.nameplate')]
      .filter((pl) => names.some((n) => (pl.textContent ?? '').includes(n)))
      .map((pl) => pl.getBoundingClientRect());
    const left = Math.min(...rects.map((r) => r.left));
    const right = Math.max(...rects.map((r) => r.right));
    const top = Math.min(...rects.map((r) => r.top));
    const x = Math.max(0, left - 80);
    const y = Math.max(0, top - 50);
    return { x, y, width: Math.min(1280 - x, right - left + 160), height: Math.min(760 - y, 360) };
  }, BOTS);
  await page.screenshot({ path: 'tmp/pn-after-world-on.png', clip });
  console.log('world plates-on shot', clip);

  await openInterfaceGeneral(page);
  const optClip = await page.evaluate(() => {
    const r = document.querySelector('#options-menu').getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  });
  await page.screenshot({ path: 'tmp/pn-after-options.png', clip: optClip });
  console.log('options panel shot');

  // The REAL toggle click (not a debug-hook write): the row's own button.
  await page.click('button[data-setting-key="showPlayerNameplates"]');
  await sleep(300);
  await page.evaluate(() => window.__game.hud.toggleOptionsMenu());
  // All three bot plates must disappear.
  await page.waitForFunction(
    (names) =>
      names.every(
        (n) =>
          ![...document.querySelectorAll('.nameplate')].some(
            (pl) => getComputedStyle(pl).display !== 'none' && (pl.textContent ?? '').includes(n),
          ),
      ),
    { timeout: 8000, polling: 200 },
    BOTS,
  );
  await sleep(400);
  await page.screenshot({ path: 'tmp/pn-after-world-off.png', clip });
  console.log('world plates-off shot');
  await page.close();
}

async function mobilePass() {
  if (MODE === 'base') return;
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERR', e.message));
  // Mobile is landscape-only in-game on the web client.
  await page.emulate(KnownDevices['iPhone 13 landscape']);
  await stageScene(page);
  // Wait for the bot plates to be laid out with real width (projection settles a
  // beat after the DOM nodes exist under device emulation), then shoot the whole
  // landscape viewport: the full mobile HUD is the clutter story.
  await page.waitForFunction(
    (names) =>
      names.every((n) =>
        [...document.querySelectorAll('.nameplate')].some(
          (pl) => (pl.textContent ?? '').includes(n) && pl.getBoundingClientRect().width > 0,
        ),
      ),
    { timeout: 10000, polling: 200 },
    BOTS,
  );
  await sleep(500);
  await page.screenshot({ path: 'tmp/pn-after-mobile-on.png' });
  console.log('mobile plates-on shot (full viewport)');
  // On mobile drive the same real settings path the options row uses (the
  // options window layout differs; the applySetting dispatcher is identical).
  await page.evaluate(() => {
    window.__game.hud.optionsHooks.onSettingChange('showPlayerNameplates', false);
  });
  await page.waitForFunction(
    (names) =>
      names.every(
        (n) =>
          ![...document.querySelectorAll('.nameplate')].some(
            (pl) => getComputedStyle(pl).display !== 'none' && (pl.textContent ?? '').includes(n),
          ),
      ),
    { timeout: 8000, polling: 200 },
    BOTS,
  );
  await sleep(400);
  await page.screenshot({ path: 'tmp/pn-after-mobile-off.png' });
  console.log('mobile plates-off shot');
  await page.close();
}

if (process.env.SKIP_DESKTOP !== '1') await desktopPass();
await mobilePass();
await browser.close();
console.log('done');
