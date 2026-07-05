// Proof + max-graphics capture for the Druid "Travel Form" change.
//
// Travel Form keeps its CLASSIC value (form_travel multiplier 1.4, i.e. +40%);
// the PR's new work is a PRESENTATION-ONLY speed-illusion cue that makes the
// +40% read as fast (src/render/travel_speed_fx*). So this harness produces two
// artifacts at MAX graphics (?gfx=ultra):
//
//   1) A distance chart driving the REAL offline Sim in-page: a level-20 druid
//      runs straight forward for 15s with and without Travel Form, charting
//      cumulative distance to prove the classic +40% applies on the player path:
//        - No form       (baseline, mult 1.0)
//        - Travel Form   (value 1.4 -> +40%)
//   2) A real in-game cast with sustained forward movement so the render loop
//      measures on-screen speed and paints the speed-streak + motion-vignette
//      cue over the shifted druid.
//
// Needs `npm run dev` (override with GAME_URL). Writes tmp/travel-form-*.png.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { BROWSER_PATH } from './browser_path.mjs';

// Max graphics: boot the renderer at ultra quality.
const URL = process.env.GAME_URL ?? 'http://localhost:5173/?gfx=ultra';
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  // The speed-illusion cue is driven by the render loop measuring on-screen
  // movement per animation frame, so the page must keep painting at full rate.
  // Headless Chrome backgrounds the tab and throttles rAF/timers; these flags
  // keep it foregrounded so the cue ramps via its real path during capture.
  args: ['--window-size=1280,820', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding'],
  defaultViewport: { width: 1280, height: 820 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE:', m.text()); });

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 60000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await sleep(300);
await page.type('#char-name', 'Thornroot');
await page.evaluate(() => {
  const el = document.querySelector('#offline-select .mini-class[data-class="druid"]');
  if (el) el.click();
});
await page.click('#btn-start-offline');
await page.waitForFunction(() => window.__game && window.__game.sim && window.__game.sim.player,
  { timeout: 60000 });
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
    p.auras = p.auras.filter((a) => a.kind !== 'form_travel');
    if (value != null) {
      p.auras.push({ id: 'travel_form', name: 'Travel Form', kind: 'form_travel',
        remaining: 3600, duration: 3600, value, sourceId: p.id, school: 'nature' });
    }
    const sx = p.pos.x, sz = p.pos.z;
    const dists = [];
    for (let i = 0; i < TICKS; i++) {
      sim.moveInput.forward = true; // re-assert each tick (sync loop, no RAF interleave)
      sim.tick();
      dists.push(Math.hypot(p.pos.x - sx, p.pos.z - sz));
    }
    return dists;
  }

  return {
    none: run(null),
    form: run(1.4),
  };
});

// Draw the chart on a canvas overlay and screenshot it.
await page.evaluate((s) => {
  const TICKS = s.none.length;
  const W = 1180, H = 720, PAD = 80;
  const cv = document.createElement('canvas');
  cv.id = 'tf-chart';
  cv.width = W; cv.height = H;
  Object.assign(cv.style, { position: 'fixed', left: '50px', top: '50px', zIndex: 99999,
    background: '#11151c', border: '1px solid #2c3a4a', borderRadius: '8px' });
  document.body.appendChild(cv);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#11151c'; ctx.fillRect(0, 0, W, H);

  const all = [...s.none, ...s.form];
  const maxD = Math.max(...all) * 1.05;
  const x = (t) => PAD + (t / (TICKS - 1)) * (W - PAD * 1.3);
  const y = (d) => H - PAD - (d / maxD) * (H - PAD * 2);

  ctx.strokeStyle = '#39414f'; ctx.fillStyle = '#9aa6b8';
  ctx.font = '15px system-ui, sans-serif'; ctx.lineWidth = 1;
  for (let gy = 0; gy <= 5; gy++) {
    const d = (maxD / 5) * gy;
    const yy = y(d);
    ctx.beginPath(); ctx.moveTo(PAD, yy); ctx.lineTo(W - PAD * 0.3, yy); ctx.stroke();
    ctx.fillText(`${d.toFixed(0)} yd`, 10, yy + 5);
  }
  for (let sec = 0; sec <= 15; sec += 3) {
    const xx = x(sec * 20);
    ctx.fillText(`${sec}s`, xx - 8, H - PAD + 24);
  }

  const line = (data, color, dash) => {
    ctx.strokeStyle = color; ctx.lineWidth = 3.5; ctx.setLineDash(dash || []);
    ctx.beginPath();
    data.forEach((d, t) => { const xx = x(t), yy = y(d); t ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy); });
    ctx.stroke(); ctx.setLineDash([]);
  };
  line(s.none, '#6b7688');
  line(s.form, '#4ad07a');

  ctx.fillStyle = '#e8edf4'; ctx.font = '600 24px system-ui, sans-serif';
  ctx.fillText('Druid Travel Form - distance run over 15s (classic +40%, value 1.4)', PAD, 38);
  const legend = [
    ['#4ad07a', 'Travel Form (value 1.4) -> +40% distance'],
    ['#6b7688', 'No form (baseline)'],
  ];
  ctx.font = '16px system-ui, sans-serif';
  legend.forEach(([c, label], i) => {
    const ly = 70 + i * 26;
    ctx.fillStyle = c; ctx.fillRect(PAD, ly - 12, 26, 6);
    ctx.fillStyle = '#cdd6e3'; ctx.fillText(label, PAD + 38, ly - 4);
  });

  const fd = (a) => a[a.length - 1].toFixed(1);
  ctx.fillStyle = '#8b95a6'; ctx.font = '15px system-ui, sans-serif';
  ctx.fillText(`final: form ${fd(s.form)} yd, none ${fd(s.none)} yd  (ratio ${(s.form.at(-1) / s.none.at(-1)).toFixed(2)}x)`,
    PAD, H - 18);
}, series);

await sleep(200);
const el = await page.$('#tf-chart');
await el.screenshot({ path: 'tmp/travel-form-speed-chart.png' });
console.log('wrote tmp/travel-form-speed-chart.png');

// --- second artifact: real in-game cast at MAX graphics with the speed-illusion
// cue active. We cast through the real pipeline (value 1.4) then sustain forward
// movement via the controller move-input so the RENDER loop measures on-screen
// speed each frame and ramps the screen-space speed-streak / motion vignette.
await page.evaluate(() => {
  const cv = document.querySelector('#tf-chart'); if (cv) cv.remove();
  // Dismiss the new-adventurer tutorial overlay so it does not clutter the cue.
  for (const b of document.querySelectorAll('button')) {
    if (/skip/i.test(b.textContent || '')) { b.click(); break; }
  }
  const g = window.__game, sim = g.sim, p = sim.player;
  p.auras = p.auras.filter((a) => a.kind !== 'form_travel');
  p.resource = 100;
  // Face across the open valley (away from the spawn tree) and snap the orbit
  // camera behind so the run heads into clean terrain the streaks read against.
  p.facing = Math.PI;
  g.input.recenterCameraBehind(Math.PI);
  // Look toward the horizon so screen-center (where the streaks radiate from) is
  // distant darker terrain/sky, giving the light-blue speed streaks contrast.
  g.input.camPitch = -0.08;
  sim.castAbility('travel_form', p.id); // real pipeline -> classic value 1.4
  // Persisted forward intent: readMoveInput() returns this every frame until
  // cleared, so the player keeps running and the render loop sees real speed.
  g.input.setControllerMoveInput({ forward: true });
});
// Let real animation frames run so selfPos advances and the cue eases up to full.
await sleep(2600);
await page.screenshot({ path: 'tmp/travel-form-ultra.png' });
await page.evaluate(() => window.__game.input.clearControllerMoveInput());
console.log('wrote tmp/travel-form-ultra.png');
console.log('final distances:',
  'none', series.none.at(-1).toFixed(1),
  'form', series.form.at(-1).toFixed(1),
  'ratio form/none', (series.form.at(-1) / series.none.at(-1)).toFixed(2));

await browser.close();
