// Proof + max-graphics capture for the Rogue "Stealth at 50% speed" change.
//
// Rogue Stealth (and the in-combat Vanish variant) now apply a stealth aura with
// value 0.5: the rogue moves at 50% of normal speed while hidden (was 0.7 / 70%).
// The mechanic lives in the deterministic Sim (moveSpeedMult treats a 'stealth'
// aura as a slow), so this harness produces two artifacts at MAX graphics
// (?gfx=ultra):
//
//   1) A distance chart driving the REAL offline Sim in-page: a level-20 rogue
//      runs straight forward for 15s, charting cumulative distance to prove the
//      stealth slow applies on the player path:
//        - Normal   (baseline, mult 1.0)
//        - Stealth  (value 0.5 -> 50% speed)  -> exactly half the distance
//   2) A real in-game Stealth toggle so the render loop paints the stealthed
//      (ghosted) rogue moving forward at the reduced speed.
//
// Needs `npm run dev` (override with GAME_URL). Writes tmp/stealth-speed-*.png.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173/?gfx=ultra';
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [
    '--window-size=1280,820',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
  ],
  defaultViewport: { width: 1280, height: 820 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE:', m.text());
});

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 60000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await sleep(300);
await page.type('#char-name', 'Shadowstep');
await page.evaluate(() => {
  const el = document.querySelector('#offline-select .mini-class[data-class="rogue"]');
  if (el) el.click();
});
await page.click('#btn-start-offline');
await page.waitForFunction(() => window.__game && window.__game.sim && window.__game.sim.player, {
  timeout: 60000,
});
await sleep(1200);

const series = await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const p = sim.player;
  sim.setPlayerLevel(20, p.id);
  p.gm = true;

  const TICKS = 300; // 15s at 20Hz

  function run(value) {
    p.facing = 0;
    p.auras = p.auras.filter((a) => a.kind !== 'stealth');
    if (value != null) {
      p.auras.push({
        id: 'stealth',
        name: 'Stealth',
        kind: 'stealth',
        remaining: 3600,
        duration: 3600,
        value,
        sourceId: p.id,
        school: 'physical',
      });
    }
    const sx = p.pos.x,
      sz = p.pos.z;
    const dists = [];
    for (let i = 0; i < TICKS; i++) {
      sim.moveInput.forward = true; // re-assert each tick (sync loop, no RAF interleave)
      sim.tick();
      dists.push(Math.hypot(p.pos.x - sx, p.pos.z - sz));
    }
    return dists;
  }

  return {
    normal: run(null),
    stealth: run(0.5),
  };
});

// Draw the chart on a canvas overlay and screenshot it.
await page.evaluate((s) => {
  const TICKS = s.normal.length;
  const W = 1180,
    H = 720,
    PAD = 80;
  const cv = document.createElement('canvas');
  cv.id = 'st-chart';
  cv.width = W;
  cv.height = H;
  Object.assign(cv.style, {
    position: 'fixed',
    left: '50px',
    top: '50px',
    zIndex: 99999,
    background: '#11151c',
    border: '1px solid #2c3a4a',
    borderRadius: '8px',
  });
  document.body.appendChild(cv);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#11151c';
  ctx.fillRect(0, 0, W, H);

  const all = [...s.normal, ...s.stealth];
  const maxD = Math.max(...all) * 1.05;
  const x = (t) => PAD + (t / (TICKS - 1)) * (W - PAD * 1.3);
  const y = (d) => H - PAD - (d / maxD) * (H - PAD * 2);

  ctx.strokeStyle = '#39414f';
  ctx.fillStyle = '#9aa6b8';
  ctx.font = '15px system-ui, sans-serif';
  ctx.lineWidth = 1;
  for (let gy = 0; gy <= 5; gy++) {
    const d = (maxD / 5) * gy;
    const yy = y(d);
    ctx.beginPath();
    ctx.moveTo(PAD, yy);
    ctx.lineTo(W - PAD * 0.3, yy);
    ctx.stroke();
    ctx.fillText(`${d.toFixed(0)} yd`, 10, yy + 5);
  }
  for (let sec = 0; sec <= 15; sec += 3) {
    const xx = x(sec * 20);
    ctx.fillText(`${sec}s`, xx - 8, H - PAD + 24);
  }

  const line = (data, color, dash) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 3.5;
    ctx.setLineDash(dash || []);
    ctx.beginPath();
    data.forEach((d, t) => {
      const xx = x(t),
        yy = y(d);
      t ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy);
    });
    ctx.stroke();
    ctx.setLineDash([]);
  };
  line(s.normal, '#6b7688');
  line(s.stealth, '#9a6ad0');

  ctx.fillStyle = '#e8edf4';
  ctx.font = '600 24px system-ui, sans-serif';
  ctx.fillText('Rogue Stealth - distance run over 15s (new value 0.5 -> 50% speed)', PAD, 38);
  const legend = [
    ['#6b7688', 'Normal (baseline, mult 1.0)'],
    ['#9a6ad0', 'Stealth (value 0.5) -> half the distance'],
  ];
  ctx.font = '16px system-ui, sans-serif';
  legend.forEach(([c, label], i) => {
    const ly = 70 + i * 26;
    ctx.fillStyle = c;
    ctx.fillRect(PAD, ly - 12, 26, 6);
    ctx.fillStyle = '#cdd6e3';
    ctx.fillText(label, PAD + 38, ly - 4);
  });

  const fd = (a) => a[a.length - 1].toFixed(1);
  ctx.fillStyle = '#8b95a6';
  ctx.font = '15px system-ui, sans-serif';
  ctx.fillText(
    `final: normal ${fd(s.normal)} yd, stealth ${fd(s.stealth)} yd  (ratio ${(s.stealth.at(-1) / s.normal.at(-1)).toFixed(2)}x)`,
    PAD,
    H - 18,
  );
}, series);

await sleep(200);
const el = await page.$('#st-chart');
await el.screenshot({ path: 'tmp/stealth-speed-chart.png' });
console.log('wrote tmp/stealth-speed-chart.png');

// --- second artifact: real in-game Stealth at MAX graphics. Toggle Stealth via
// the real pipeline (value 0.5) then sustain forward movement so the render loop
// paints the ghosted rogue creeping at the reduced speed.
await page.evaluate(() => {
  const cv = document.querySelector('#st-chart');
  if (cv) cv.remove();
  for (const b of document.querySelectorAll('button')) {
    if (/skip/i.test(b.textContent || '')) {
      b.click();
      break;
    }
  }
  const g = window.__game,
    sim = g.sim,
    p = sim.player;
  p.auras = p.auras.filter((a) => a.kind !== 'stealth');
  p.facing = Math.PI;
  g.input.recenterCameraBehind(Math.PI);
  g.input.camPitch = -0.08;
  sim.castAbility('stealth', p.id); // real pipeline -> value 0.5
  g.input.setControllerMoveInput({ forward: true });
});
await sleep(2600);
await page.screenshot({ path: 'tmp/stealth-speed-ultra.png' });
await page.evaluate(() => window.__game.input.clearControllerMoveInput());
console.log('wrote tmp/stealth-speed-ultra.png');
console.log(
  'final distances:',
  'normal',
  series.normal.at(-1).toFixed(1),
  'stealth',
  series.stealth.at(-1).toFixed(1),
  'ratio stealth/normal',
  (series.stealth.at(-1) / series.normal.at(-1)).toFixed(2),
);

await browser.close();
