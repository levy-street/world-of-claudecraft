// Before/after proof for the ACTUAL on-screen flicker: the renderer's per-frame
// `visible` toggle at the 80yd draw edge (renderer.ts). The rig OBJECT is created
// at 80yd and destroyed at 96yd (hysteresis), but the per-frame visibility flag
// used to flip with a HARD cutoff at exactly 80yd — so a character hovering right
// at the draw edge popped visible/invisible every frame. This is the band that is
// both drawn and on the boundary (the entity-map churn the other chart models
// happens at 90-130yd, beyond the 80yd draw range, so it's never on screen).
//
// The fix gives the per-frame flag the same 80/96 hysteresis as create/destroy.
// This models both behaviours at render frame rate and draws a visibility
// timeline. No dev server needed; renders on a blank canvas.
// Output: tmp/entity_visible_flicker_before_after.png
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { BROWSER_PATH } from './browser_path.mjs';

fs.mkdirSync('tmp', { recursive: true });

const FPS = 60;
const N = 240; // frames (~4s)
const DRAW = 80; // ENTITY_DRAW_RANGE (show within)
const DESTROY = 96; // ENTITY_VIEW_DESTROY_RANGE (hide/destroy beyond)

// A character lingering right at the draw edge (idle/strafing at ~80yd), the case
// where a hard cutoff toggles every frame.
const dist = (i) => DRAW + 6 * Math.sin(i * 0.25);

// BEFORE: hard cutoff — visible iff within 80yd, recomputed each frame.
const before = [];
for (let i = 0; i < N; i++) before.push(dist(i) <= DRAW);

// AFTER: 80/96 hysteresis — once shown, stay until past 96; while hidden, show within 80.
const after = [];
let shown = dist(0) <= DRAW;
for (let i = 0; i < N; i++) {
  const d = dist(i);
  shown = shown ? d <= DESTROY : d <= DRAW;
  after.push(shown);
}

const flips = (a) => a.reduce((n, v, i) => n + (i > 0 && v !== a[i - 1] ? 1 : 0), 0);

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1100, height: 460 },
});
const page = await browser.newPage();
await page.setContent('<canvas id="c" width="1100" height="460"></canvas>');

await page.evaluate((data) => {
  const { N, before, after, beforeFlips, afterFlips } = data;
  const ctx = document.getElementById('c').getContext('2d');
  ctx.fillStyle = '#14171c'; ctx.fillRect(0, 0, 1100, 460);
  ctx.fillStyle = '#d4af37';
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText('Character at the 80yd draw edge: renderer visibility per frame', 30, 36);
  ctx.font = '13px sans-serif';
  ctx.fillStyle = '#9aa3ad';
  ctx.fillText('Rig drawn ≤80yd / destroyed >96yd · 60fps · green = visible, red = hidden', 30, 56);

  const x0 = 200, w = 860, h = 46;
  const cellW = w / N;
  const row = (y, label, arr, sub) => {
    ctx.fillStyle = '#e6e9ee'; ctx.font = 'bold 15px sans-serif';
    ctx.fillText(label, 30, y + 27);
    ctx.fillStyle = '#7c828b'; ctx.font = '12px sans-serif';
    ctx.fillText(sub, 30, y + 44);
    for (let i = 0; i < N; i++) {
      ctx.fillStyle = arr[i] ? '#3fb950' : '#f04747';
      ctx.fillRect(x0 + i * cellW, y, Math.ceil(cellW) + 0.5, h);
    }
    ctx.strokeStyle = '#000'; ctx.strokeRect(x0, y, w, h);
  };
  row(110, 'BEFORE', before, `${beforeFlips} flips — hard 80yd cutoff toggles every frame`);
  row(220, 'AFTER',  after,  `${afterFlips} flip — 80/96 hysteresis, steady`);

  ctx.fillStyle = '#7c828b'; ctx.font = '12px sans-serif';
  ctx.fillText('render frame →', x0, 300);
}, { N, before, after, beforeFlips: flips(before), afterFlips: flips(after) });

const buf = await page.$eval('#c', (c) => c.toDataURL('image/png'));
fs.writeFileSync('tmp/entity_visible_flicker_before_after.png', Buffer.from(buf.split(',')[1], 'base64'));
await browser.close();
console.log(`BEFORE flips=${flips(before)}  AFTER flips=${flips(after)}`);
console.log('wrote tmp/entity_visible_flicker_before_after.png');
