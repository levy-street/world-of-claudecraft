// Screenshot the shaman Frostbrand Weapon imbue in the offline client.
// Boots an offline shaman, levels to 20 so the rank-2 imbue is known,
// casts it, and captures (1) the world scene with the buff-bar icon,
// (2) a tight crop of the buff-bar imbue icon, and (3) the spellbook
// tooltip for the ability.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

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
page.on('pageerror', (e) => console.log('PAGEERROR: ' + e.message));

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await new Promise((r) => setTimeout(r, 400));
await page.type('#char-name', 'Thrall');
await page.evaluate(() => {
  const el = document.querySelector('#offline-select .mini-class[data-class="shaman"]');
  if (el) el.click();
});
await page.click('#btn-start-offline');
await new Promise((r) => setTimeout(r, 2500));

const result = await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const p = sim.player;
  // Level to 20 so rank 2 is learned; setPlayerLevel refreshes the known cache.
  sim.setPlayerLevel(20, p.id);
  p.gm = true;

  const dodgeBefore = null;
  sim.castAbility('frostbrand_weapon', p.id);
  sim.tick();
  const aura = p.auras.find((a) => a.id === 'frostbrand_weapon');
  return { hasImbue: !!aura, kind: aura?.kind, value: aura?.value, remaining: aura?.remaining };
});
console.log('frostbrand result:', JSON.stringify(result));

await new Promise((r) => setTimeout(r, 600));
await page.screenshot({ path: 'tmp/frostbrand_scene.png' });

// Tight crop of the buff bar showing the frost-sword imbue icon.
const box = await page.evaluate(() => {
  const bar = document.querySelector('#buff-bar');
  if (!bar) return null;
  const r = bar.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
});
if (box && box.w > 0) {
  const pad = 16;
  await page.screenshot({
    path: 'tmp/frostbrand_buff.png',
    clip: {
      x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad),
      width: box.w + pad * 2, height: box.h + pad * 2,
    },
  });
}

// Open the spellbook and hover the Frostbrand Weapon entry for its tooltip.
await page.evaluate(() => window.__game.hud.toggleSpellbook());
await new Promise((r) => setTimeout(r, 500));
const hover = await page.evaluate(() => {
  const sb = document.querySelector('#spellbook');
  if (!sb) return null;
  const row = [...sb.querySelectorAll('.spell-row')].find((el) =>
    (el.textContent || '').trim().startsWith('Frostbrand Weapon'));
  if (!row) return null;
  const r = row.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
if (hover) {
  await page.mouse.move(hover.x, hover.y);
  await new Promise((r) => setTimeout(r, 600));
}
await page.screenshot({ path: 'tmp/frostbrand_spellbook.png' });

console.log('saved tmp/frostbrand_scene.png, frostbrand_buff.png, frostbrand_spellbook.png');
await browser.close();
