// Water overhaul verification tour: boots the offline game and captures the
// new water at a lake shore, over the open sea, mid-swim, and from under the
// surface, logging any shader/page errors. Needs `npm run dev` (GAME_URL).
// PNGs land in tmp/.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5199';
fs.mkdirSync('tmp', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
let sawError = false;
page.on('pageerror', (e) => {
  sawError = true;
  console.log('PAGEERROR:', e.message);
});
page.on('console', (m) => {
  const t = m.text();
  if (/error|invalid|failed to compile|THREE\.WebGLProgram/i.test(t)) {
    sawError = true;
    console.log('CONSOLE:', t.slice(0, 500));
  }
});

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('#btn-offline', { timeout: 120000 });
await new Promise((r) => setTimeout(r, 800));
await page.evaluate(() => document.querySelector('#btn-offline')?.click());
await new Promise((r) => setTimeout(r, 300));
await page.evaluate(() => {
  const el = document.querySelector('#char-name');
  if (el) {
    el.value = 'Swimmer';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
});
// DOM-level clicks: the class chips can sit outside the clickable viewport in
// a headless window, and .click() bypasses the elementFromPoint check.
await page.evaluate(() => {
  document.querySelector('.mini-class[data-class="warrior"]')?.click();
});
await new Promise((r) => setTimeout(r, 200));
await page.evaluate(() => {
  document.querySelector('#btn-start-offline')?.click();
});
await page.waitForFunction(() => window.__game?.sim?.player, { timeout: 150000 });
await new Promise((r) => setTimeout(r, 2500));

// Clear every overlay: camera-choice dialog, tutorial toast, GPU warning.
await page.evaluate(() => {
  for (const b of document.querySelectorAll('button')) {
    const t = (b.textContent ?? '').trim().toLowerCase();
    if (t === 'confirm' || t === 'skip tutorial' || t === 'dismiss') b.click();
  }
  document.querySelector('.tut-skip')?.click();
});
await new Promise((r) => setTimeout(r, 400));
// Midday light via the dev chat command, so the water reads in daylight.
await page.evaluate(() => {
  const chat = document.querySelector('#chat-input');
  chat.value = '/daynight day';
  chat.dispatchEvent(new Event('input', { bubbles: true }));
  chat.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
});
await new Promise((r) => setTimeout(r, 10000)); // the day/night grade lerps in

async function shoot(name, spot) {
  await page.evaluate((s) => {
    const g = window.__game;
    const p = g.sim.player;
    p.maxHp = 99999;
    p.hp = 99999;
    p.pos.x = s.x;
    p.pos.z = s.z;
    if (s.y !== undefined) {
      p.pos.y = s.y;
      p.onGround = false;
    }
    p.prevPos = { ...p.pos };
    p.facing = s.facing ?? 0;
    g.input.camYaw = s.facing ?? 0;
    if (s.camPitch !== undefined) g.input.camPitch = s.camPitch;
  }, spot);
  await new Promise((r) => setTimeout(r, spot.settleMs ?? 2000));
  // Overlays (camera choice, tutorial, raven banner, GPU toast) can appear on
  // their own timers: clear them right before every frame.
  await page.evaluate(() => {
    for (const b of document.querySelectorAll('button')) {
      const t = (b.textContent ?? '').trim().toLowerCase();
      if (t === 'confirm' || t === 'skip tutorial' || t === 'dismiss') b.click();
    }
    document.querySelector('.tut-skip')?.click();
    for (const el of document.querySelectorAll('.mail-banner, .toast, .announce')) el.remove();
  });
  await new Promise((r) => setTimeout(r, 700));
  await page.screenshot({ path: `tmp/${name}.png` });
  const state = await page.evaluate(() => {
    const p = window.__game.sim.player;
    return { x: p.pos.x.toFixed(1), y: p.pos.y.toFixed(2), z: p.pos.z.toFixed(1) };
  });
  console.log(name, JSON.stringify(state));
}

// 1. Mirror Lake shore in Eastbrook Vale, looking across the water at the sun.
await shoot('water_01_lake_shore', { x: -92 + 34, z: 88 - 20, facing: -Math.PI / 2.4 });
// 2. The vale's southern open-sea coast: beach + surf band + sea to horizon.
await shoot('water_02_sea_coast', { x: -40, z: -195, facing: Math.PI, camPitch: 0.12 });
// 3. Swimming in the open sea (the fix: this used to walk the seabed).
await shoot('water_03_swimming', { x: -40, z: -225, facing: Math.PI, settleMs: 2600 });
// 4. Under the surface looking up at the new water ceiling.
await shoot('water_04_underwater', {
  x: -40,
  z: -223,
  y: -9,
  facing: Math.PI,
  camPitch: -0.9,
  settleMs: 900,
});

console.log(sawError ? 'ERRORS SEEN (see log above)' : 'no page/shader errors');
await browser.close();
