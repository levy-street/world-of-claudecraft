// Screenshot the hunter aspect mutual-exclusion fix in the offline client.
// Boots a hunter, levels to 14 so Hawk/Monkey/Cheetah are all trained, then casts
// each aspect in turn (clearing the GCD between casts). Before the fix all three
// stacked (+AP, +dodge, +speed at once); now only the most recent aspect is up.
// Captures the buff bar holding a single aspect icon and logs the stat proof.

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
await new Promise((r) => setTimeout(r, 400));
await page.type('#char-name', 'Brannok');
await page.evaluate(() => {
  const chip = document.querySelector('#offline-select .mini-class[data-class="hunter"]');
  if (chip) chip.click();
});
await page.click('#btn-start-offline');
// Poll for the world to boot (the __game global appears a few seconds in).
let booted = false;
for (let i = 0; i < 30; i++) {
  booted = await page.evaluate(() => !!window.__game?.sim?.player);
  if (booted) break;
  await new Promise((r) => setTimeout(r, 1000));
}
if (!booted) throw new Error('world did not boot');
await new Promise((r) => setTimeout(r, 800));

const result = await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const p = sim.player;
  sim.setPlayerLevel(14); // hawk(4) + monkey(10) + cheetah(14) all trained
  p.gm = true; // survive the ambient world loop while we pose
  // Aspects trigger the GCD; settle 32 ticks (1.6s) between casts so each lands.
  const settle = () => {
    for (let i = 0; i < 32; i++) sim.tick();
  };
  const aspects = () => p.auras.filter((a) => a.id.startsWith('aspect_of_the_')).map((a) => a.id);

  const base = { ap: p.attackPower, dodge: p.dodgeChance };
  sim.castAbility('aspect_of_the_hawk');
  settle();
  const afterHawk = { aspects: aspects(), ap: p.attackPower };
  sim.castAbility('aspect_of_the_monkey');
  settle();
  const afterMonkey = { aspects: aspects(), ap: p.attackPower, dodge: p.dodgeChance };
  sim.castAbility('aspect_of_the_cheetah');
  settle();
  const afterCheetah = { aspects: aspects() };
  return { base, afterHawk, afterMonkey, afterCheetah };
});
console.log('aspect exclusion result:', JSON.stringify(result, null, 2));
// Sanity: exactly one aspect active at each step, and the swapped-out AP is gone.
const ok =
  result.afterHawk.aspects.length === 1 &&
  result.afterMonkey.aspects.length === 1 &&
  result.afterCheetah.aspects.join() === 'aspect_of_the_cheetah' &&
  result.afterMonkey.ap === result.base.ap; // hawk AP dropped after swapping to monkey
console.log(ok ? 'PASS: only one aspect active, no stat stacking' : 'FAIL: aspects stacked');

await new Promise((r) => setTimeout(r, 600));
await page.screenshot({ path: 'tmp/aspect_exclusion_scene.png' });

// Buff-bar crop (top-right): should show a single aspect icon, not three.
const box = await page.evaluate(() => {
  const bar = document.querySelector('#buff-bar');
  if (!bar) return null;
  const r = bar.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
});
if (box && box.w > 0) {
  const pad = 18;
  await page.screenshot({
    path: 'tmp/aspect_exclusion_buff.png',
    clip: {
      x: Math.max(0, box.x - pad),
      y: Math.max(0, box.y - pad),
      width: box.w + pad * 2,
      height: box.h + pad * 2,
    },
  });
}
console.log('saved tmp/aspect_exclusion_scene.png, aspect_exclusion_buff.png');
await browser.close();
process.exit(ok ? 0 : 1);
