// Screenshot Aspect of the Monkey (hunter dodge self-buff) in the offline client.
// Boots the game as a hunter, levels to 10 so the aspect is trained, casts it,
// and captures (1) the world scene with the buff active, (2) the buff-bar icon,
// and (3) the spellbook tooltip.
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
await page.type('#char-name', 'Brannok');
// Pick the hunter; tolerate the auto-select panel where the chip may not be clickable.
await page.evaluate(() => {
  const chip = document.querySelector('#offline-select .mini-class[data-class="hunter"]');
  if (chip) chip.click();
});
await page.click('#btn-start-offline');
await new Promise((r) => setTimeout(r, 2500));

const result = await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const p = sim.player;
  sim.setPlayerLevel(10);
  p.gm = true; // survive the ambient world loop while we pose
  const dodgeBefore = p.dodgeChance;
  sim.castAbility('aspect_of_the_monkey');
  sim.tick();
  const buff = p.auras.find((a) => a.id === 'aspect_of_the_monkey');
  return {
    cls: sim.resolve(p.id).meta.cls,
    level: p.level,
    dodgeBefore,
    dodgeAfter: p.dodgeChance,
    hasBuff: !!buff,
    buffKind: buff?.kind,
    buffValue: buff?.value,
    buffRemaining: buff?.remaining,
  };
});
console.log('aspect monkey result:', JSON.stringify(result));

await new Promise((r) => setTimeout(r, 600));
await page.screenshot({ path: 'tmp/aspect_monkey_scene.png' });

// Buff-bar icon crop (top-right). The buff bar collapses to 0x0 when empty.
const box = await page.evaluate(() => {
  const bar = document.querySelector('#buff-bar');
  if (!bar) return null;
  const r = bar.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
});
if (box && box.w > 0) {
  const pad = 18;
  await page.screenshot({
    path: 'tmp/aspect_monkey_buff.png',
    clip: {
      x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad),
      width: box.w + pad * 2, height: box.h + pad * 2,
    },
  });
}

// Open the spellbook and hover the ability for its tooltip.
await page.evaluate(() => window.__game.hud.toggleSpellbook());
await new Promise((r) => setTimeout(r, 500));
const target = await page.evaluate(() => {
  const book = document.querySelector('#spellbook');
  if (!book) return null;
  let best = null;
  for (const el of book.querySelectorAll('*')) {
    if (el.children.length === 0 && /Aspect of the Monkey/.test(el.textContent || '')) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && (!best || r.width < best.w)) best = { x: r.left, y: r.top, w: r.width, h: r.height };
    }
  }
  return best;
});
if (target) {
  await page.mouse.move(target.x + target.w / 2, target.y + target.h / 2);
  await new Promise((r) => setTimeout(r, 500));
}
await page.screenshot({ path: 'tmp/aspect_monkey_spellbook.png' });

console.log('saved tmp/aspect_monkey_scene.png, aspect_monkey_buff.png, aspect_monkey_spellbook.png');
await browser.close();
