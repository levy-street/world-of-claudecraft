// Target-frame portrait screenshots: target a Wild Boar (family beast → paw
// crest) so we can eyeball the portrait fill/crispness + the portrait/bar
// overlap. LABEL=<name> names the output; TEMPLATE=<mobId> targets a different
// mob (e.g. an elite like elder_bristleback). Runs offline (needs `npm run dev`).
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';
const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const LABEL = process.env.LABEL ?? 'before';
fs.mkdirSync('tmp', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  // deviceScaleFactor: 2 reproduces the retina blur the report is about.
  defaultViewport: { width: 1600, height: 900, deviceScaleFactor: 2 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
// JS-driven clicks: the auth panels fade in via transitions, so puppeteer's
// clickable-point check races them. Dispatching click directly is reliable.
await page.evaluate(() => document.querySelector('#btn-offline').click());
await new Promise((r) => setTimeout(r, 500));
await page.evaluate(() => {
  const n = document.querySelector('#char-name');
  n.value = 'Thorgar';
  n.dispatchEvent(new Event('input', { bubbles: true }));
});
await new Promise((r) => setTimeout(r, 200));
await page.evaluate(() => document.querySelector('#btn-start-offline').click());
await new Promise((r) => setTimeout(r, 3500));

const TEMPLATE = process.env.TEMPLATE ?? 'wild_boar';
const found = await page.evaluate((template) => {
  const g = window.__game;
  const sim = g.sim;
  const p = sim.player;
  const boar = [...sim.entities.values()].find((e) => e.templateId === template);
  if (!boar) return { ok: false };
  p.maxHp = 999999; p.hp = 999999;
  p.pos.x = boar.pos.x + 3; p.pos.z = boar.pos.z + 3; p.pos.y = boar.pos.y;
  p.facing = Math.atan2(boar.pos.x - p.pos.x, boar.pos.z - p.pos.z);
  g.input.camYaw = p.facing;
  sim.targetEntity(boar.id);
  return { ok: true, name: boar.name, level: boar.level };
}, TEMPLATE);
console.log('boar:', JSON.stringify(found));
await new Promise((r) => setTimeout(r, 1200));

// Whole target frame.
await page.screenshot({ path: `tmp/tf_${LABEL}_frame.png`, clip: { x: 0, y: 0, width: 320, height: 110 } });
// Zoomed portrait only (the circle + its overlap with the bar's right edge).
await page.screenshot({ path: `tmp/tf_${LABEL}_portrait.png`, clip: { x: 168, y: 4, width: 92, height: 92 } });
// Full HUD: compare the target frame (top-left) against the player frame (the
// bottom-centre one the user is happy with) so the fix can match it.
await page.screenshot({ path: `tmp/tf_${LABEL}_full.png` });
// Player frame (bottom-centre): portrait on the LEFT, the mirror of the target
// frame and the layout the user accepts.
const pf = await page.evaluate(() => {
  const r = document.querySelector('#player-frame').getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
});
await page.screenshot({ path: `tmp/tf_${LABEL}_playerframe.png`, clip: { x: pf.x - 6, y: pf.y - 6, width: Math.min(360, pf.w + 12), height: pf.h + 12 } });

console.log(errors.length ? 'ERRORS:\n' + errors.slice(0, 15).join('\n') : 'no page errors');
await browser.close();
