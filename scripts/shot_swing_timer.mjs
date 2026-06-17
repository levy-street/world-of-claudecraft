// Screenshot the auto-attack swing-timer / weave indicator in the offline
// client. Boots the game as a warrior, stands a tanky mob next to the player,
// turns on auto-attack, then captures the swing bar (which sits right below the
// cast-bar slot) at a few fill levels — low (red) and imminent (gold).
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
await new Promise((r) => setTimeout(r, 200));
await page.type('#char-name', 'Brannok');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await new Promise((r) => setTimeout(r, 2500));

// Stand a sturdy target next to the player and start auto-attacking it.
const setup = await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const p = sim.player;
  p.maxHp = 1e6; p.hp = 1e6;

  let mob = null, d = 1e9;
  for (const e of sim.entities.values()) {
    if (e.kind === 'mob' && !e.dead) {
      const dd = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
      if (dd < d) { d = dd; mob = e; }
    }
  }
  mob.maxHp = 1e6; mob.hp = 1e6; mob.hostile = true;
  mob.pos.x = p.pos.x + 2; mob.pos.z = p.pos.z;
  mob.pos.y = p.pos.y;
  sim.targetEntity(mob.id);
  p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
  g.input.camYaw = p.facing;
  sim.startAutoAttack();
  return { weaponSpeed: p.weapon.speed, mobName: mob.name };
});
console.log('swing setup:', JSON.stringify(setup));
await new Promise((r) => setTimeout(r, 400));

// Helper: pin the swing timer to a given remaining fraction, let one HUD frame
// render, then screenshot full + a crop around the swing bar.
async function capture(tag, remainingFrac) {
  await page.evaluate((frac) => {
    const sim = window.__game.sim;
    const p = sim.player;
    p.autoAttack = true;
    p.swingTimer = p.weapon.speed * frac;
  }, remainingFrac);
  // screenshot within a frame or two so the live 20 Hz loop doesn't swing+reset
  // the pinned timer before the capture
  await new Promise((r) => setTimeout(r, 35));
  await page.screenshot({ path: `tmp/swing_${tag}_full.png` });
  const box = await page.evaluate(() => {
    const el = document.querySelector('#swingbar');
    if (!el || getComputedStyle(el).display === 'none') return null;
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  if (box) {
    const padX = 40, padTop = 70, padBot = 24;
    await page.screenshot({
      path: `tmp/swing_${tag}_crop.png`,
      clip: {
        x: Math.max(0, box.x - padX), y: Math.max(0, box.y - padTop),
        width: box.w + padX * 2, height: box.h + padTop + padBot,
      },
    });
  } else {
    console.log(`WARN: #swingbar not visible for ${tag}`);
  }
  return box;
}

// mid swing (red), then nearly ready (gold "imminent")
const b1 = await capture('mid', 0.5);
const b2 = await capture('imminent', 0.13);
console.log('boxes:', JSON.stringify({ b1, b2 }));

// Stacked: a cast in progress with the swing bar directly beneath it, to show
// the indicator lives right below the cast-bar slot. (A real caster wand-swings
// while casting; here we drive both bars on the same frame.)
await page.evaluate(() => {
  const sim = window.__game.sim;
  const p = sim.player;
  p.autoAttack = true;
  p.swingTimer = p.weapon.speed * 0.45;
  p.castingAbility = 'fireball';
  p.channeling = false;
  p.castTotal = 3;
  p.castRemaining = 1.7;
});
await new Promise((r) => setTimeout(r, 35));
await page.screenshot({ path: 'tmp/swing_stacked_full.png' });
{
  const box = await page.evaluate(() => {
    // re-pin both bars on this very frame (a blocked-by-cast swing never resets,
    // so the timer would otherwise drain to 0 before the crop)
    const p = window.__game.sim.player;
    p.swingTimer = p.weapon.speed * 0.45;
    p.castingAbility = 'fireball'; p.castTotal = 3; p.castRemaining = 1.7;
    const cb = document.querySelector('#castbar').getBoundingClientRect();
    const sb = document.querySelector('#swingbar').getBoundingClientRect();
    const x = Math.min(cb.left, sb.left), top = cb.top;
    const right = Math.max(cb.right, sb.right), bot = sb.bottom;
    return { x, top, w: right - x, h: bot - top };
  });
  const padX = 40, padTop = 16, padBot = 18;
  await page.screenshot({
    path: 'tmp/swing_stacked_crop.png',
    clip: {
      x: Math.max(0, box.x - padX), y: Math.max(0, box.top - padTop),
      width: box.w + padX * 2, height: box.h + padTop + padBot,
    },
  });
}
await page.evaluate(() => {
  const p = window.__game.sim.player;
  p.castingAbility = null; p.castRemaining = 0;
});

// Confirm the indicator hides the instant auto-attack stops.
await page.evaluate(() => window.__game.sim.stopAutoAttack());
await new Promise((r) => setTimeout(r, 200));
const hidden = await page.evaluate(() => {
  const el = document.querySelector('#swingbar');
  return !el || getComputedStyle(el).display === 'none';
});
console.log('hidden after stop:', hidden);
await page.screenshot({ path: 'tmp/swing_stopped_full.png' });

console.log('saved tmp/swing_mid_*, swing_imminent_*, swing_stopped_full.png');
await browser.close();
