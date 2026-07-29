// Captures the action-bar charge UI states offline on a Fury warrior's
// Twinstrike (ability id raging_gale, an authored 2-charge pool): full pool
// (badge "2"), one spent (badge "1" + the thin recharge strip, button still
// usable), and empty (full cooldown sweep + strip). Run with MODE=base on the
// base branch for the before set (small white badge, no strip).
// Needs the dev client running:  npm run dev
//   BROWSER_PATH=... node scripts/charge_ui_shot.mjs

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
  // deviceScaleFactor 3: the deliverable is a close crop of one 46px action
  // button, so the capture needs the extra pixel density to stay readable.
  defaultViewport: { width: 1280, height: 760, deviceScaleFactor: 3 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERR', e.message));

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
const booted = await enterOfflineGame(page, { charClass: 'warrior', charName: 'Thorgar' });
console.log('offline boot:', booted);
await page.evaluate(() => document.querySelector('.gpu-notice-dismiss')?.click());
await sleep(600);

// Level into Fury so Twinstrike (raging_gale, 2 charges) is learned and barred.
await page.evaluate(() => {
  const sim = window.__game.sim;
  sim.setPlayerLevel(10);
  sim.setSpec('fury');
});
await sleep(800);

// The slot button that carries Twinstrike (the aria-label routes the localized
// ability name, and the icon key data rides the painter, so match via the sim's
// bar binding instead: find the barSlot bound to raging_gale, then its button).
const slotInfo = await page.evaluate(() => {
  const buttons = Array.from(document.querySelectorAll('#actionbar .action-btn'));
  const hud = window.__game.hud;
  for (const btn of buttons) {
    const slot = Number(btn.dataset.hotbarSlot ?? -1);
    if (slot >= 1 && hud.abilityForSlot?.(slot)?.def?.id === 'raging_gale') {
      const r = btn.getBoundingClientRect();
      return { slot, x: r.left, y: r.top, w: r.width, h: r.height };
    }
  }
  return null;
});
console.log('twinstrike slot:', slotInfo);
if (!slotInfo) {
  console.log('FAILED: raging_gale not found on the bar');
  await browser.close();
  process.exit(1);
}

// One frozen clip: the Twinstrike button plus a neighbor either side for context.
const clip = {
  x: Math.max(0, slotInfo.x - slotInfo.w - 14),
  y: Math.max(0, slotInfo.y - 18),
  width: slotInfo.w * 3 + 40,
  height: slotInfo.h + 36,
};

await page.screenshot({ path: `tmp/charge-${PREFIX}-full.png`, clip });
console.log('full-pool shot');

// Spawn a practice target next to the player and face it, then spend charges
// through the REAL cast path.
await page.evaluate(() => {
  const sim = window.__game.sim;
  sim.chat('/dev spawn wolf');
});
await sleep(400);
await page.evaluate(() => {
  const sim = window.__game.sim;
  const me = sim.player;
  let nearest = null;
  let best = Infinity;
  for (const e of sim.entities.values()) {
    if (e.kind !== 'mob' || e.dead) continue;
    const d = (e.pos.x - me.pos.x) ** 2 + (e.pos.z - me.pos.z) ** 2;
    if (d < best) {
      best = d;
      nearest = e;
    }
  }
  if (nearest) {
    // Snap the practice target into melee range directly ahead so the strike
    // cannot fail the range gate (same direct-staging idiom as afk_nameplate_shot).
    nearest.pos = {
      x: me.pos.x + Math.sin(me.facing) * 2,
      y: me.pos.y,
      z: me.pos.z + Math.cos(me.facing) * 2,
    };
    me.targetId = nearest.id;
  }
});
await sleep(300);

const castOnce = () =>
  page.evaluate(() => {
    window.__game.sim.castAbility('raging_gale');
  });

await castOnce();
// Let the GCD sweep finish so the shot isolates the charge state: badge "1",
// the thin recharge strip, and NO full-width curtain.
await sleep(1800);
await page.screenshot({ path: `tmp/charge-${PREFIX}-one-spent.png`, clip });
console.log('one-spent shot');

await castOnce();
await sleep(1800);
await page.screenshot({ path: `tmp/charge-${PREFIX}-empty.png`, clip });
console.log('empty-pool shot');

// Sanity: report the live charge state so the shots are verifiable.
const state = await page.evaluate(() => {
  const sim = window.__game.sim;
  return {
    charges: sim.player.abilityCharges?.raging_gale ?? null,
    cooldown: sim.player.cooldowns.get('raging_gale') ?? 0,
  };
});
console.log('final charge state:', JSON.stringify(state));
await page.close();

// Mobile ring pass: the same one-spent state on the mobile action ring (its
// bespoke charge-count / recharge-strip CSS is separate from the desktop bar).
const mob = await browser.newPage();
mob.on('pageerror', (e) => console.log('PAGEERR', e.message));
await mob.emulate({
  viewport: { width: 844, height: 390, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
});
await mob.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
const mobBoot = await enterOfflineGame(mob, { charClass: 'warrior', charName: 'Thorgar' });
console.log('mobile boot:', mobBoot);
await mob.evaluate(() => document.querySelector('.gpu-notice-dismiss')?.click());
await sleep(600);
await mob.evaluate(() => {
  const sim = window.__game.sim;
  sim.setPlayerLevel(10);
  sim.setSpec('fury');
});
await sleep(800);
await mob.evaluate(() => {
  const sim = window.__game.sim;
  sim.chat('/dev spawn wolf');
});
await sleep(400);
await mob.evaluate(() => {
  const sim = window.__game.sim;
  const me = sim.player;
  let nearest = null;
  let best = Infinity;
  for (const e of sim.entities.values()) {
    if (e.kind !== 'mob' || e.dead) continue;
    const d = (e.pos.x - me.pos.x) ** 2 + (e.pos.z - me.pos.z) ** 2;
    if (d < best) {
      best = d;
      nearest = e;
    }
  }
  if (nearest) {
    nearest.pos = {
      x: me.pos.x + Math.sin(me.facing) * 2,
      y: me.pos.y,
      z: me.pos.z + Math.cos(me.facing) * 2,
    };
    me.targetId = nearest.id;
  }
});
await sleep(300);
await mob.evaluate(() => {
  window.__game.sim.castAbility('raging_gale');
});
await sleep(1800);
// Clip the action-ring cluster (bottom-right quadrant of the landscape HUD).
await mob.screenshot({
  path: `tmp/charge-${PREFIX}-mobile-one-spent.png`,
  clip: { x: 844 - 320, y: 390 - 260, width: 320, height: 260 },
});
console.log('mobile one-spent shot');

await browser.close();
console.log('done');
