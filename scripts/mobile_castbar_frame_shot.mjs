// Screenshot the mobile-touch bottom-center #player-frame alongside a
// mid-cast #castbar, in landscape at a width the PR #1440 review flagged
// (640px is inside the reported 568-640px overlap band). Needs `npm run dev`.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
fs.mkdirSync('tmp', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=640,375', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.emulate({
  name: 'phone-landscape-narrow',
  userAgent:
    'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36',
  viewport: {
    width: 640,
    height: 360,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    isLandscape: true,
  },
});

const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push('CONSOLE: ' + msg.text());
});

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await enterOfflineGame(page, { charClass: 'mage', charName: 'Overlapcheck', settleMs: 2800 });

await page.evaluate(() => {
  document.getElementById('mobile-preflight-continue')?.click();
});
await new Promise((r) => setTimeout(r, 600));
await page.evaluate(() =>
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
);
await new Promise((r) => setTimeout(r, 300));

await page.evaluate(() => {
  const sim = window.__game.sim;
  const meta = sim.meta(sim.playerId);
  for (let i = 0; i < 25; i++) sim.grantXp(999999, meta);
});
await new Promise((r) => setTimeout(r, 400));

await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll('button'));
  btns.find((b) => b.textContent?.includes('Skip Tutorial'))?.click();
});
await new Promise((r) => setTimeout(r, 300));

const touchOn = await page.evaluate(() => document.body.classList.contains('mobile-touch'));
console.log('mobile-touch active:', touchOn ? 'OK' : 'FAIL');

// Fireball has a real cast time but needs a live hostile target; grab the
// nearest mob and target it before casting so #castbar renders.
const targeted = await page.evaluate(() => {
  const sim = window.__game.sim;
  const p = sim.entities.get(sim.playerId);
  let nearest = null;
  let nearestD = Infinity;
  for (const e of sim.entities.values()) {
    if (e.kind !== 'mob' || e.dead) continue;
    const d = (e.pos.x - p.pos.x) ** 2 + (e.pos.z - p.pos.z) ** 2;
    if (d < nearestD) {
      nearestD = d;
      nearest = e;
    }
  }
  if (!nearest) return false;
  p.targetId = nearest.id;
  // Walk into range so fireball's range/LoS checks pass (offline debug only,
  // same as the other mobile_*_shot.mjs scripts' window.__game usage).
  p.pos.x = nearest.pos.x + 5;
  p.pos.z = nearest.pos.z;
  return true;
});
console.log('targeted a mob:', targeted);

await page.evaluate(() => {
  window.__game.sim.castAbility('fireball');
});
await new Promise((r) => setTimeout(r, 250));

const geometry = await page.evaluate(() => {
  const toPlain = (r) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
  const cast = document.getElementById('castbar');
  const frame = document.getElementById('player-frame');
  return {
    casting: cast ? getComputedStyle(cast).display !== 'none' : false,
    cast: cast ? toPlain(cast.getBoundingClientRect()) : null,
    frame: frame ? toPlain(frame.getBoundingClientRect()) : null,
  };
});
console.log('geometry:', JSON.stringify(geometry));

if (geometry.cast && geometry.frame) {
  const overlap =
    Math.min(geometry.cast.right, geometry.frame.right) -
    Math.max(geometry.cast.left, geometry.frame.left);
  console.log(overlap > 0 ? `OVERLAP: ${overlap.toFixed(1)}px` : 'clear: no overlap');
}

await page.screenshot({ path: 'tmp/mobile-hud-castbar-frame-clear.png' });

if (errors.length) {
  console.log('\n=== PAGE ERRORS ===');
  for (const e of errors.slice(0, 20)) console.log(e);
} else {
  console.log('no page errors');
}
await browser.close();
process.exit(touchOn && geometry.casting ? 0 : 1);
