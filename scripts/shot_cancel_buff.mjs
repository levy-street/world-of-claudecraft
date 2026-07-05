// Screenshot the right-click-to-cancel-a-buff feature in the offline client.
// Boots the game, puts three auras on the player (two helpful buffs + one
// debuff), crops the buff bar, then calls sim.cancelAura on one buff through the
// real IWorld path and crops it again so the before/after shows the buff gone and
// the debuff (which is NOT cancelable) untouched.
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
await page.type('#char-name', 'Brannok');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await page.bringToFront();
// swiftshader boots the renderer slowly; node-driven poll (rAF is throttled in a
// non-painting headless tab, so waitForFunction would hang).
let ready = false;
for (let i = 0; i < 30 && !ready; i++) {
  ready = await page.evaluate(() => !!window.__game?.sim?.player);
  if (!ready) await new Promise((r) => setTimeout(r, 1000));
}
if (!ready) throw new Error('game never became ready');
await new Promise((r) => setTimeout(r, 800));

// Put two helpful buffs and one debuff on the player through the real aura path.
await page.evaluate(() => {
  const sim = window.__game.sim;
  const p = sim.player;
  p.auras.length = 0;
  const mk = (id, name, kind, value) => ({
    id,
    name,
    kind,
    remaining: 300,
    duration: 300,
    value,
    sourceId: p.id,
    school: 'physical',
  });
  sim.applyAura(p, mk('stoneskin', 'Stoneskin', 'buff_armor', 200));
  sim.applyAura(p, mk('renew', 'Renew', 'hot', 40));
  sim.applyAura(p, mk('crippled', 'Crippling Poison', 'slow', 0.5));
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
await page.screenshot({ path: 'tmp/cancel_buff_before.png', clip });

// Cancel the Stoneskin buff through the IWorld seam, exactly as the right-click does.
const res = await page.evaluate(() => {
  const sim = window.__game.sim;
  const p = sim.player;
  const armorBefore = p.stats.armor;
  sim.cancelAura('stoneskin');
  sim.cancelAura('crippled'); // a debuff: must be refused, stays on the bar
  return {
    remaining: p.auras.map((a) => a.id),
    armorBefore,
    armorAfter: p.stats.armor,
  };
});
console.log('cancel result:', JSON.stringify(res));
await new Promise((r) => setTimeout(r, 600));
await page.screenshot({ path: 'tmp/cancel_buff_after.png', clip });

console.log('saved tmp/cancel_buff_before.png, tmp/cancel_buff_after.png');
await browser.close();
