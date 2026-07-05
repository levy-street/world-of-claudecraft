// Screenshot harness for the Master Loot feature. Boots the offline world,
// forms a two-person party, enables master loot (capturing the leader-only
// loot-method control in the party panel), then renders the master-loot
// assignment prompt the master looter sees when a threshold item drops.
// Needs a dev server (default :5173, override GAME_URL). Renders at ?gfx=ultra.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = `${process.env.GAME_URL ?? 'http://localhost:5173'}/?gfx=ultra`;
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [
    '--window-size=1600,900',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-crash-reporter',
    '--disable-breakpad',
    `--user-data-dir=${fs.mkdtempSync('/tmp/woc-chrome-')}`,
  ],
  defaultViewport: { width: 1600, height: 900, deviceScaleFactor: 2 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE:', m.text());
});

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('#btn-offline', { timeout: 60000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await sleep(300);
await page.type('#char-name', 'Sortwyn');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await page.waitForFunction(() => window.__game?.hud, { timeout: 60000 });
await sleep(2000);

// Form a two-person party and turn on master loot (leader is master looter).
await page.evaluate(() => {
  const sim = window.__game.sim;
  const me = sim.playerId;
  const bert = sim.addPlayer('mage', 'Berta');
  sim.partyInvite(bert, me);
  sim.partyAccept(bert);
  sim.setPartyLootMaster(true, 0, 'uncommon', me);
});
await sleep(800);

// (1) The leader-only loot-method control in the party panel.
const party = await page.$('#party-frames');
if (party) await party.screenshot({ path: 'tmp/master-loot-1-control.png' });

// (2) The master-loot assignment prompt the master looter sees on a threshold drop.
await page.evaluate(() => {
  const hud = window.__game.hud;
  hud.showMasterLoot({
    type: 'masterLoot',
    rollId: 1,
    itemId: 'greyjaw_hide_boots',
    itemName: 'Greyjaw Hide Boots',
    quality: 'uncommon',
    expiresAt: 9_999_999,
    candidates: [
      { pid: window.__game.sim.playerId, name: 'Sortwyn' },
      { pid: 2, name: 'Berta' },
    ],
  });
});
await sleep(600);
const rect = await page.evaluate(() => {
  const el = document.querySelector('#loot-rolls');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
});
if (rect && rect.width > 0)
  await page.screenshot({
    path: 'tmp/master-loot-2-assign.png',
    clip: { x: rect.x - 8, y: rect.y - 8, width: rect.width + 16, height: rect.height + 16 },
  });

await browser.close();
console.log('wrote tmp/master-loot-1-control.png and tmp/master-loot-2-assign.png');
