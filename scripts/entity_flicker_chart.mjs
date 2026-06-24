// Before/after proof for the "characters flashing in and out of existence" fix.
// An entity wandering across the server's interest-scope boundary (~95yd, the
// server adds at 90 and drops at 100) repeatedly falls out of and back into the
// snapshot. The OLD client deleted it the instant it was missing, so the
// renderer tore down and rebuilt its rig a frame later — visible flicker. The
// NEW client holds a briefly-missing far entity for a short grace window, so the
// short gaps are bridged and the character stays put.
//
// This models the server hysteresis + both client prune behaviours exactly and
// draws a presence timeline. No dev server needed; renders on a blank canvas.
// Output: tmp/entity_flicker_before_after.png
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { BROWSER_PATH } from './browser_path.mjs';

fs.mkdirSync('tmp', { recursive: true });

const SNAP_MS = 50;            // 20Hz snapshot cadence
const N = 200;                 // snapshots (~10s)
const ADD = 90, DROP = 100;    // server interest add/drop radii (players)
const GRACE_MS = 600;          // client despawn grace window (the fix)

// Distance of an entity moving briskly near the boundary (circling/strafing or
// a charge), dipping out past the drop radius and back inside the add radius
// within a second — the fast-crossing case the grace window is meant to bridge.
const dist = (i) => 95 + 17 * Math.sin(i * 0.55);

// Server-side: with add/drop hysteresis, is the entity in this snapshot?
const sent = [];
let known = false;
for (let i = 0; i < N; i++) {
  const d = dist(i);
  if (known) { if (d > DROP) known = false; }
  else if (d <= ADD) known = true;
  sent.push(known);
}

// OLD client: present iff in this snapshot.
const oldPresent = sent.slice();

// NEW client: far entity held for GRACE_MS after going missing.
const newPresent = [];
let missingSince = null, alive = false;
for (let i = 0; i < N; i++) {
  const t = i * SNAP_MS;
  if (sent[i]) { alive = true; missingSince = null; }
  else if (alive) {
    if (missingSince === null) missingSince = t;
    if (t - missingSince >= GRACE_MS) { alive = false; missingSince = null; }
  }
  newPresent.push(alive);
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
  const { N, oldPresent, newPresent, sent, oldFlips, newFlips } = data;
  const ctx = document.getElementById('c').getContext('2d');
  ctx.fillStyle = '#14171c'; ctx.fillRect(0, 0, 1100, 460);
  ctx.fillStyle = '#d4af37';
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText('Entity at the interest-scope boundary (~95yd): presence per snapshot', 30, 36);
  ctx.font = '13px sans-serif';
  ctx.fillStyle = '#9aa3ad';
  ctx.fillText('Server add 90yd / drop 100yd · 20Hz · green = drawn, red = gone', 30, 56);

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
  row(110, 'BEFORE', oldPresent, `${oldFlips} flips — flicker`);
  row(220, 'AFTER',  newPresent, `${newFlips} flip — steady`);

  ctx.fillStyle = '#7c828b'; ctx.font = '12px sans-serif';
  ctx.fillText('server snapshot →', x0, 300);
  ctx.fillText(`red gaps the server actually sent: ${sent.filter((s) => !s).length}/${N} snapshots`, x0, 318);
}, { N, oldPresent, newPresent, sent, oldFlips: flips(oldPresent), newFlips: flips(newPresent) });

const buf = await page.$eval('#c', (c) => c.toDataURL('image/png'));
fs.writeFileSync('tmp/entity_flicker_before_after.png', Buffer.from(buf.split(',')[1], 'base64'));
await browser.close();
console.log(`BEFORE flips=${flips(oldPresent)}  AFTER flips=${flips(newPresent)}`);
console.log('wrote tmp/entity_flicker_before_after.png');
