// Screenshot the Lightning Shield buff icon showing its remaining-charge badge in the
// offline client. Boots the game as a shaman, puts a charge-limited Lightning Shield aura
// on the player through the real aura path, crops the buff bar (badge reads 3), then drops
// the charge count to 1 (as a reflected hit would) and crops again so the before/after
// shows the badge counting down. This is the user-facing half of PR #975: the sim already
// tracked Aura.charges; this proves the buff icon now surfaces it.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
fs.mkdirSync('tmp', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log(`PAGEERROR: ${e.message}`));

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await new Promise((r) => setTimeout(r, 200));
await page.type('#char-name', 'Thunderpaw');
await page.click('#offline-select .mini-class[data-class="shaman"]');
await page.click('#btn-start-offline');
await page.bringToFront();
let ready = false;
for (let i = 0; i < 30 && !ready; i++) {
  ready = await page.evaluate(() => !!window.__game?.sim?.player);
  if (!ready) await new Promise((r) => setTimeout(r, 1000));
}
if (!ready) throw new Error('game never became ready');
await new Promise((r) => setTimeout(r, 800));

// Put a charge-limited Lightning Shield on the player through the real aura path.
await page.evaluate(() => {
  const sim = window.__game.sim;
  const p = sim.player;
  p.auras.length = 0;
  sim.applyAura(p, {
    id: 'lightning_shield',
    name: 'Lightning Shield',
    kind: 'thorns',
    remaining: 600,
    duration: 600,
    value: 13,
    charges: 3,
    icd: 0,
    icdMax: 5,
    sourceId: p.id,
    school: 'nature',
  });
});
await new Promise((r) => setTimeout(r, 600));

const bbRect = await page.evaluate(() => {
  const el = document.querySelector('#buff-bar');
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
});
const clip = {
  x: Math.max(0, bbRect.x - 16),
  y: Math.max(0, bbRect.y - 16),
  width: bbRect.w + 32,
  height: bbRect.h + 36,
};
await page.screenshot({ path: 'tmp/lightning_shield_badge_3.png', clip });

// Drop to 1 charge (two reflects spent), exactly the field the reflect path decrements.
const res = await page.evaluate(() => {
  const sim = window.__game.sim;
  const a = sim.player.auras.find((x) => x.id === 'lightning_shield');
  a.charges = 1;
  return { charges: a.charges };
});
console.log('after spend:', JSON.stringify(res));
await new Promise((r) => setTimeout(r, 600));
await page.screenshot({ path: 'tmp/lightning_shield_badge_1.png', clip });

console.log('saved tmp/lightning_shield_badge_3.png, tmp/lightning_shield_badge_1.png');
await browser.close();
