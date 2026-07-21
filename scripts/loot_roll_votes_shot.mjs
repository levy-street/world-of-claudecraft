// Screenshot harness for the group loot-roll vote strip (the XLoot-style
// monitor): who has answered Need/Greed/Pass on an open roll, live on the roll
// frame, and the watch-only row that keeps the frame up after the local player
// answers.
//
// Boots the offline world at max graphics (?gfx=ultra), feeds the HUD a lootRoll
// event for the prompt row, and stubs the world's lootRollGroupStatus read (the
// IWorld surface the HUD polls) so the strip renders a mid-vote party without
// needing a live multi-client server. Captures:
//   tmp/loot_roll_votes_before.png  the prompt as it ships today (no strip)
//   tmp/loot_roll_votes_prompt.png  prompt row + live vote strip
//   tmp/loot_roll_votes_watch.png   watch-only row after answering
//
// Needs a dev server (default :5173, override with GAME_URL). Writes to tmp/.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = (process.env.GAME_URL ?? 'http://localhost:5173') + '/?gfx=ultra';
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
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
await page.type('#char-name', 'Rollwyn');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await page.waitForFunction(() => window.__game?.hud, { timeout: 60000 });
await sleep(2000);
// Skip the intro cinematic (it keeps #ui display:none until it ends) and any
// tutorial overlay so the HUD is visible and unobstructed.
await page.keyboard.press('Escape');
await page.waitForFunction(
  () => {
    const ui = document.getElementById('ui');
    return ui && getComputedStyle(ui).display !== 'none';
  },
  { timeout: 30000 },
);
await page.evaluate(() => document.querySelector('.tut-skip')?.click());
await sleep(500);

async function crop(path) {
  const clip = await page.evaluate(() => {
    const el = document.getElementById('loot-rolls');
    const r = el.getBoundingClientRect();
    const pad = 24;
    return {
      x: Math.max(0, r.x - pad),
      y: Math.max(0, r.y - pad),
      width: r.width + pad * 2,
      height: r.height + pad * 2,
    };
  });
  await page.screenshot({ path, clip });
  console.log('wrote', path);
}

// Before: the prompt exactly as it ships without the group status (no strip).
await page.evaluate(() => {
  const { hud, world } = window.__game;
  const t = (world.time ?? 0) + 45;
  hud.handleEvents([
    {
      type: 'lootRoll',
      rollId: 8001,
      itemId: 'greyjaw_hide_boots',
      itemName: 'Greyjaw Hide Boots',
      quality: 'uncommon',
      expiresAt: t,
    },
  ]);
});
await page.waitForFunction(
  () => document.querySelector('#loot-rolls .loot-roll .loot-roll-btn.need'),
  { timeout: 30000 },
);
await sleep(400);
await crop('tmp/loot_roll_votes_before.png');

// Prompt row + live strip: stub the IWorld group-status read the HUD polls.
// A full 10-person raid (RAID_MAX = 10) mid-vote, so the "N/M rolled" glance
// line and the bounded, scrollable strip are exercised at the real ceiling.
await page.evaluate(() => {
  const { world } = window.__game;
  const selfPid = world.playerId;
  const t = (world.time ?? 0) + 45;
  const names = [
    'Thane',
    'Mirella',
    'Ossric',
    'Kaelis',
    'Br128nlongname',
    'Sable',
    'Dregmaw',
    'Yllowen',
    'Pict',
  ];
  const choices = ['need', 'greed', 'pass', 'need', 'greed', 'pass', 'need', null, null];
  world.lootRollGroupStatus = () => [
    {
      rollId: 8001,
      itemId: 'greyjaw_hide_boots',
      itemName: 'Greyjaw Hide Boots',
      quality: 'uncommon',
      expiresAt: t,
      entries: [
        { pid: selfPid, name: 'Rollwyn', choice: null },
        ...names.map((name, i) => ({ pid: 900001 + i, name, choice: choices[i] })),
      ],
    },
  ];
});
await page.waitForFunction(() => document.querySelector('#loot-rolls .loot-roll-vote-chip.greed'), {
  timeout: 30000,
});
await sleep(400);
await crop('tmp/loot_roll_votes_prompt.png');

// Watch-only row: the local player answered (prompt dismissed) but the frame
// stays up with everyone's votes until the server resolves the roll.
await page.evaluate(() => {
  const { hud, world } = window.__game;
  const selfPid = world.playerId;
  const prev = world.lootRollGroupStatus()[0];
  // Re-feed the event so the prompt is alive regardless of how long the prior
  // captures took (the local prompt expires after 60s), then answer it.
  hud.handleEvents([
    {
      type: 'lootRoll',
      rollId: 8001,
      itemId: 'greyjaw_hide_boots',
      itemName: 'Greyjaw Hide Boots',
      quality: 'uncommon',
      expiresAt: (world.time ?? 0) + 45,
    },
  ]);
  document.querySelector('#loot-rolls .loot-roll-btn.need').click();
  world.lootRollGroupStatus = () => [
    {
      ...prev,
      entries: prev.entries.map((e) => (e.pid === selfPid ? { ...e, choice: 'need' } : e)),
    },
  ];
});
await page.waitForFunction(
  () =>
    document.querySelector('#loot-rolls .loot-roll.watch') &&
    !document.querySelector('#loot-rolls .loot-roll-btn.need'),
  { timeout: 30000 },
);
await sleep(400);
await crop('tmp/loot_roll_votes_watch.png');

await browser.close();
