// Capture for PR #1029 follow-up: the wider desktop inspect window (gear names read
// in full, no ellipsis) and the mobile single-column, scrollable, one-item-per-row
// gear list. Boots the offline game, dresses a second player in a full set with long
// item names, and shoots the inspect window on a desktop and a phone viewport.
//   node scripts/inspect_gear_layout_shot.mjs   (needs `npm run dev`; GAME_URL= to override port)
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = 'docs/pr-assets/inspect-gear';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const FULL_SET = {
  helmet: 'deathlords_dread_visage',
  shoulder: 'necromancers_soulspire_mantle',
  chest: 'deathlord_warplate',
  mainhand: 'deathless_heartwood',
  gloves: 'wyrmshadow_talongrips',
  waist: 'boundstone_girdle',
  legs: 'deathlord_legguards',
  feet: 'deathlord_sabatons',
};

async function boot(page) {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await enterOfflineGame(page, { charClass: 'warrior', charName: 'Looker', settleMs: 2600 });
  await page.evaluate(() => document.querySelector('#mobile-preflight-continue')?.click());
  await sleep(400);
  await page.evaluate(() => {
    document.querySelector('.tut-skip')?.click();
    const hud = window.__game?.hud;
    for (let i = 0; i < 20 && hud?.closeAll?.(); i++) {}
  });
  await sleep(300);
  return page.evaluate((set) => {
    const sim = window.__game.sim;
    const pid = sim.addPlayer('mage', 'Sorcia');
    const ent = sim.entities.get(pid);
    ent.level = 60;
    ent.equippedItems = set;
    ent.pos = { ...sim.player.pos, x: sim.player.pos.x + 2 };
    return pid;
  }, FULL_SET);
}

async function shoot(page, pid, file) {
  await page.evaluate((id) => window.__game.hud.openInspect(id), pid);
  await sleep(500);
  await page.evaluate(() => {
    for (const w of document.querySelectorAll('.window')) {
      if (w.id !== 'inspect-window') w.style.display = 'none';
    }
  });
  const box = await page.evaluate(() => {
    const el = document.querySelector('#inspect-window');
    const r = el.getBoundingClientRect();
    return {
      x: Math.round(r.x),
      y: Math.round(r.y),
      width: Math.round(r.width),
      height: Math.round(r.height),
    };
  });
  await page.screenshot({
    path: `${OUT}/${file}`,
    clip: {
      x: Math.max(0, box.x - 8),
      y: Math.max(0, box.y - 8),
      width: box.width + 16,
      height: box.height + 16,
    },
  });
  console.log(`wrote ${OUT}/${file}`, JSON.stringify(box));
}

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1280,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1280, height: 900 },
});

// Desktop: the wider 420px window, names wrap in full.
const desktop = await browser.newPage();
desktop.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
const dpid = await boot(desktop);
await shoot(desktop, dpid, 'desktop-wider.png');
await desktop.close();

// Mobile (landscape phone): single-column, scrollable, one item per row.
const mobile = await browser.newPage();
mobile.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await mobile.emulate({
  name: 'phone-landscape',
  userAgent:
    'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36',
  viewport: {
    width: 900,
    height: 440,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    isLandscape: true,
  },
});
const mpid = await boot(mobile);
await mobile.evaluate(() => document.querySelector('#mobile-preflight-continue')?.click());
await sleep(300);
await shoot(mobile, mpid, 'mobile-list.png');
await mobile.close();

await browser.close();
console.log('done ->', OUT);
