// Captures the /afk nameplate tag offline: a nearby player's overhead name gains
// a "<AFK>" prefix once their afk flag is set (the flag rides the entity, the tag
// is composed client-side in nameplate_painter.ts).
// Needs the dev client running:  npm run dev
//   GAME_URL=http://localhost:5173 node scripts/afk_nameplate_shot.mjs

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
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
  defaultViewport: { width: 1280, height: 760 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERR', e.message));

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
const booted = await enterOfflineGame(page, { charClass: 'warrior', charName: 'Thorgar' });
console.log('offline boot:', booted);
await page.evaluate(() => document.querySelector('.gpu-notice-dismiss')?.click());
await sleep(800);

// Stage a second player 7yd directly in front of the local player so the camera
// frames their nameplate. Player-kind entities have no AI, so they hold still.
const placed = await page.evaluate(() => {
  const sim = window.__game.sim;
  const p = sim.entities.get(sim.playerId);
  const botId = sim.addPlayer('mage', 'Sundara');
  const bot = sim.entities.get(botId);
  const dx = Math.sin(p.facing),
    dz = Math.cos(p.facing);
  bot.pos = { x: p.pos.x + dx * 7, y: p.pos.y, z: p.pos.z + dz * 7 };
  bot.facing = p.facing + Math.PI; // face back toward the camera
  window.__botId = botId;
  return botId;
});
console.log('bot placed:', placed);
await page.evaluate(() => {
  const i = window.__game.input;
  if (i) i.camDist = 7;
});
// Wait for the bot's nameplate DOM to appear so both shots share a stable clip.
await page.waitForFunction(
  () =>
    [...document.querySelectorAll('.nameplate')].some((n) => /Sundara/.test(n.textContent ?? '')),
  { timeout: 10000, polling: 200 },
);
await sleep(500);

// Clip tightly around the bot's nameplate (the plate whose name row carries the bot name).
const clipFor = () =>
  page.evaluate(() => {
    const plate = [...document.querySelectorAll('.nameplate')].find((n) =>
      /Sundara/.test(n.textContent ?? ''),
    );
    if (!plate) return null;
    const r = plate.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    return { x: Math.max(0, cx - 220), y: Math.max(0, r.top - 30), width: 440, height: 110 };
  });

// Freeze one clip region and use it for BOTH shots so before/after align exactly.
const clip = await clipFor();
await page.screenshot({ path: 'tmp/afk-before.png', clip: clip ?? undefined });
console.log('before shot (not afk)', clip);

// Flag the player AFK: the tag appears the next repaint (displayName drives the sig).
await page.evaluate(() => {
  window.__game.sim.entities.get(window.__botId).afk = true;
});
await sleep(700);
await page.screenshot({ path: 'tmp/afk-after.png', clip: clip ?? undefined });
console.log('after shot (afk tagged)', clip);

const tagged = await page.evaluate(() => {
  const plate = [...document.querySelectorAll('.nameplate')].find((n) =>
    /Sundara/.test(n.textContent ?? ''),
  );
  return plate ? plate.textContent : 'PLATE MISSING';
});
console.log('DOM name check:', tagged);

await browser.close();
