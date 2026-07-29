// Captures the mail parcel quantity field offline: teleports the player to a
// raven mailbox, opens the real mailbox window on the Send tab, stages a bag
// stack through the real stageParcel entry, and shoots the parcel chip row.
// Run with MODE=base on the base branch for the before shot (read-only span).
// Needs the dev client running:  npm run dev
//   BROWSER_PATH=... node scripts/mail_qty_input_shot.mjs

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
const booted = await enterOfflineGame(page, { charClass: 'warrior', charName: 'Thorgar' });
console.log('offline boot:', booted);
await page.evaluate(() => document.querySelector('.gpu-notice-dismiss')?.click());
await sleep(600);

// Stand at the nearest raven mailbox, grab a sendable stack, open the window.
const staged = await page.evaluate(() => {
  const sim = window.__game.sim;
  const hud = window.__game.hud;
  const me = sim.player;
  const box = [...sim.entities.values()].find(
    (e) => e.kind === 'object' && e.templateId === 'mailbox',
  );
  if (!box) return 'no mailbox entity';
  me.pos = { x: box.pos.x + 1, y: box.pos.y, z: box.pos.z + 1 };
  sim.chat('/dev give wolf_fang 5');
  hud.openMailbox();
  const send = document.querySelector('#mailbox-window [data-tab="send"], [data-tab="send"]');
  if (!(send instanceof HTMLElement)) return 'no send tab';
  send.click();
  hud.mailboxWindow.stageParcel('wolf_fang');
  return 'ok';
});
console.log('staged:', staged);
await sleep(500);

// Type a quantity through the real input (branch mode only; base has a span).
if (MODE !== 'base') {
  const typed = await page.evaluate(() => {
    const input = document.querySelector('.mail-parcel-qty-input');
    if (!(input instanceof HTMLInputElement)) return 'no qty input';
    input.value = '3';
    input.dispatchEvent(new Event('change'));
    return 'ok';
  });
  console.log('typed:', typed);
  await sleep(300);
}

const clip = await page.evaluate(() => {
  const el =
    document.querySelector('#mail-parcels')?.closest('.mail-send-form') ??
    document.querySelector('.mail-send-form');
  const r = el.getBoundingClientRect();
  return {
    x: Math.max(0, r.left - 8),
    y: Math.max(0, r.top - 8),
    width: r.width + 16,
    height: r.height + 16,
  };
});
await page.screenshot({ path: `tmp/mailqty-${PREFIX}.png`, clip });
console.log(`${PREFIX} shot`, clip);

await browser.close();
console.log('done');
