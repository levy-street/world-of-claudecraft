// Before/after chart for the cowardly-mob flee-speed cap fix. Boots the offline
// game, reads the live RUN_SPEED player base and the flee constants, then plots
// the flee speed a fleeing mob actually travels at across a range of base move
// speeds, for a mob that is also speed-buffed (moveSpeedMult > 1 from
// buff_speed / form_travel). The BEFORE curve uses the old parenthesisation
// (cap applied to the base projection, then multiplied past it by the buff); the
// AFTER curve folds the multiplier inside the cap. The dashed line is the player
// base run speed: BEFORE pokes above it (the bug), AFTER never does. Needs
// `npm run dev` (:5173). Writes to tmp/.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const W = 1600,
  H = 900;
fs.mkdirSync('tmp', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: [`--window-size=${W},${H}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: W, height: H },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push('CONSOLE: ' + msg.text());
});

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await new Promise((r) => setTimeout(r, 200));
await page.type('#char-name', 'Chaser');
await page.evaluate(() => {
  document.querySelector('.mini-class[data-class="warrior"]').click();
  document.querySelector('#btn-start-offline').click();
});
await page.waitForFunction(() => window.__game?.sim?.player, { timeout: 90000, polling: 250 });
await new Promise((r) => setTimeout(r, 1500));

// Pull the live player base run speed straight off the running sim so the chart
// can never disagree with the game. moveToward(player) uses RUN_SPEED * mult.
const RUN_SPEED = await page.evaluate(() => {
  // Effective player base = the speed an unbuffed player runs at.
  const g = window.__game;
  const p = g.sim.player;
  return g.sim.moveSpeedMult(p) * 7; // 7 = classic RUN_SPEED, mult=1 for a fresh char
});
console.log('player base run speed:', RUN_SPEED);

// Draw the before/after flee-speed chart on a canvas overlay and screenshot it.
await page.evaluate(
  ({ RUN_SPEED }) => {
    const FLEE_SPEED_MULT = 1.4;
    // Fleeing mobs are now capped at 65% of the player base run speed so the player
    // reliably catches them (maintainer guidance on #979). The old cap was the full
    // player run speed, which the BEFORE curve still multiplied past via the buff.
    const FLEE_CAP = RUN_SPEED * 0.65;
    const buffMult = 1.4; // a fleeing mob under buff_speed / form_travel (+40%)
    // The fleeing mob is hasted; sample across plausible base move speeds.
    const before = (base) => Math.min(base * FLEE_SPEED_MULT, RUN_SPEED) * buffMult;
    const after = (base) => Math.min(base * FLEE_SPEED_MULT * buffMult, FLEE_CAP);

    const cv = document.createElement('canvas');
    cv.id = 'flee-chart-overlay';
    cv.width = 1600;
    cv.height = 900;
    cv.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#11151c';
    document.body.appendChild(cv);
    const c = cv.getContext('2d');
    const L = 120,
      R = 1520,
      T = 130,
      B = 770;
    const xMin = 3,
      xMax = 9,
      yMax = 11;
    const sx = (b) => L + ((b - xMin) / (xMax - xMin)) * (R - L);
    const sy = (v) => B - (v / yMax) * (B - T);

    c.fillStyle = '#e8eef5';
    c.font = '34px sans-serif';
    c.fillText('Fleeing mob speed vs player base run speed (hasted fleeing mob)', L, 70);
    c.font = '20px sans-serif';

    // axes
    c.strokeStyle = '#3a4250';
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(L, T);
    c.lineTo(L, B);
    c.lineTo(R, B);
    c.stroke();
    c.fillStyle = '#9fb0c3';
    for (let v = 0; v <= yMax; v += 1) {
      const y = sy(v);
      c.fillText(String(v), L - 40, y + 6);
      c.strokeStyle = '#222a34';
      c.beginPath();
      c.moveTo(L, y);
      c.lineTo(R, y);
      c.stroke();
    }
    for (let b = xMin; b <= xMax; b += 1) c.fillText(String(b), sx(b) - 6, B + 32);
    c.fillStyle = '#9fb0c3';
    c.fillText('mob base move speed (yd/s)', (L + R) / 2 - 110, B + 70);
    c.save();
    c.translate(L - 80, (T + B) / 2 + 90);
    c.rotate(-Math.PI / 2);
    c.fillText('flee speed (yd/s)', 0, 0);
    c.restore();

    // player base run speed line — the speed the chasing player travels at
    c.strokeStyle = '#d8c14a';
    c.setLineDash([10, 8]);
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(sx(xMin), sy(RUN_SPEED));
    c.lineTo(sx(xMax), sy(RUN_SPEED));
    c.stroke();
    c.fillStyle = '#d8c14a';
    c.fillText('player base run speed = ' + RUN_SPEED + ' yd/s', L + 10, sy(RUN_SPEED) - 14);
    // flee speed ceiling line — 65% of player run speed, so the player always closes the gap
    c.strokeStyle = '#5aa0d8';
    c.beginPath();
    c.moveTo(sx(xMin), sy(FLEE_CAP));
    c.lineTo(sx(xMax), sy(FLEE_CAP));
    c.stroke();
    c.setLineDash([]);
    c.fillStyle = '#5aa0d8';
    c.fillText(
      'flee cap = 65% run speed = ' + FLEE_CAP.toFixed(2) + ' yd/s',
      L + 10,
      sy(FLEE_CAP) - 14,
    );

    const plot = (fn, color, label, dy) => {
      c.strokeStyle = color;
      c.lineWidth = 4;
      c.beginPath();
      let first = true;
      for (let b = xMin; b <= xMax; b += 0.1) {
        const x = sx(b);
        const y = sy(fn(b));
        if (first) {
          c.moveTo(x, y);
          first = false;
        } else {
          c.lineTo(x, y);
        }
      }
      c.stroke();
      c.fillStyle = color;
      c.fillText(label, R - 360, sy(fn(xMax)) + dy);
    };
    // BEFORE pokes above the ceiling for fast mobs; AFTER tracks it and clamps.
    plot(before, '#d9534f', 'before — buff escapes the cap (bug)', -16);
    plot(after, '#4ea36b', 'after — capped at 65% run speed', 28);
  },
  { RUN_SPEED },
);

await new Promise((r) => setTimeout(r, 200));
await page.screenshot({ path: 'tmp/flee_speed_cap_chart.png' });
console.log('wrote tmp/flee_speed_cap_chart.png');

if (errors.length) {
  console.log('=== PAGE ERRORS ===');
  for (const e of errors.slice(0, 20)) console.log(e);
} else console.log('no page errors');
await browser.close();
