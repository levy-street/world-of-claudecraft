// Before/after proof for the Druid "Wolf Form swings as fast as a rogue" fix.
// Drives the REAL offline Sim in-page: a level-20 druid auto-attacks a god-mode
// dummy for 20s under three conditions and we chart cumulative auto-attacks:
//   - Wolf Form AFTER fix   (form_cat -> fixed rogue cadence, 1.8s)
//   - Wolf Form BEFORE fix  (no form -> the slow caster staff leaked in)
//   - Rogue (reference)     (1.8s dagger, no form) -> overlaps the AFTER line
// The bug is visible as the "before" line falling well behind the rogue line;
// the fix makes "after" land exactly on the rogue reference.
// Needs `npm run dev` (override with GAME_URL). Writes tmp/wolf-form-swing-chart.png.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1280,820', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1280, height: 820 },
});
const page = await browser.newPage();
await page.bringToFront(); // headless tabs throttle rAF until focused; sim never readies otherwise
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE:', m.text());
});

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 45000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await sleep(300);
await page.evaluate(() => {
  const card = document.querySelector('#offline-select .mini-class[data-class="druid"]');
  card?.click();
});
await sleep(150);
await page.evaluate(() => {
  const n = document.querySelector('#char-name');
  if (n) n.value = 'Thornroot';
});
await page.evaluate(() => document.querySelector('#btn-start-offline')?.click());
// Boots slowly under swiftshader; give it room (matches scripts/assist_shot.mjs).
await page.waitForFunction(
  () => window.__game?.sim?.player && window.__game.sim.entities?.size > 5,
  { timeout: 60000, polling: 250 },
);
await sleep(2000);

const out = await page.evaluate(() => {
  const sim = window.__game.sim;
  const p = sim.player;
  sim.setPlayerLevel(20, p.id);
  p.gm = true;
  const staffSpeed = p.weapon.speed;

  const TICKS = 400; // 20s at 20Hz

  // Count cumulative player white-hit auto-attacks (ability == null physical swings)
  // against a god-mode dummy kept adjacent and topped up every tick.
  function run({ form, weaponSpeed }) {
    p.auras = p.auras.filter((a) => a.kind !== 'form_cat');
    if (form) {
      p.auras.push({
        id: 'wolf_form',
        name: 'Wolf Form',
        kind: 'form_cat',
        remaining: 3600,
        duration: 3600,
        value: 1,
        sourceId: p.id,
        school: 'physical',
      });
    }
    p.weapon = { ...p.weapon, speed: weaponSpeed };
    p.swingTimer = 0;

    const dummy = [...sim.entities.values()].find((e) => e.kind === 'mob' && !e.dead);
    p.pos.x = dummy.pos.x + 1.0;
    p.pos.z = dummy.pos.z;
    p.pos.y = dummy.pos.y;
    p.prevPos = { ...p.pos };
    p.targetId = dummy.id;
    sim.startAutoAttack(p.id);

    let count = 0;
    const cum = [];
    for (let i = 0; i < TICKS; i++) {
      dummy.hp = dummy.maxHp = 1e9;
      dummy.dead = false;
      p.facing = Math.atan2(dummy.pos.x - p.pos.x, dummy.pos.z - p.pos.z);
      const evs = sim.tick();
      for (const e of evs) {
        if (e.type === 'damage' && e.sourceId === p.id && e.ability == null) count++;
      }
      cum.push(count);
    }
    return cum;
  }

  return {
    staffSpeed,
    after: run({ form: true, weaponSpeed: staffSpeed }),
    before: run({ form: false, weaponSpeed: staffSpeed }),
    rogue: run({ form: false, weaponSpeed: 1.8 }),
  };
});

await page.evaluate((s) => {
  const TICKS = s.after.length;
  const W = 1180,
    H = 720,
    PAD = 80;
  const cv = document.createElement('canvas');
  cv.id = 'swing-chart';
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

  const all = [...s.after, ...s.before, ...s.rogue];
  const maxN = Math.max(...all) * 1.05;
  const x = (t) => PAD + (t / (TICKS - 1)) * (W - PAD * 1.3);
  const y = (n) => H - PAD - (n / maxN) * (H - PAD * 2);

  ctx.strokeStyle = '#39414f';
  ctx.fillStyle = '#9aa6b8';
  ctx.font = '15px system-ui, sans-serif';
  ctx.lineWidth = 1;
  for (let gy = 0; gy <= 5; gy++) {
    const n = (maxN / 5) * gy;
    const yy = y(n);
    ctx.beginPath();
    ctx.moveTo(PAD, yy);
    ctx.lineTo(W - PAD * 0.3, yy);
    ctx.stroke();
    ctx.fillText(`${n.toFixed(0)}`, 18, yy + 5);
  }
  for (let sec = 0; sec <= 20; sec += 4) {
    const xx = x(sec * 20);
    ctx.fillText(`${sec}s`, xx - 8, H - PAD + 24);
  }

  const line = (data, color, dash, width) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width || 3.5;
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
  // Rogue reference thick underneath; AFTER dashed on top to show the overlap.
  line(s.rogue, '#4ad07a', [], 6);
  line(s.after, '#e8edf4', [10, 8], 3);
  line(s.before, '#e8623a');

  ctx.fillStyle = '#e8edf4';
  ctx.font = '600 24px system-ui, sans-serif';
  ctx.fillText('Druid Wolf Form: auto-attacks landed over 20s (vs a dummy)', PAD, 38);
  const legend = [
    ['#4ad07a', 'Rogue reference (1.8s dagger)'],
    ['#e8edf4', 'Wolf Form AFTER fix  -> matches rogue cadence (overlaps green)'],
    ['#e8623a', `Wolf Form BEFORE fix -> slow ${s.staffSpeed.toFixed(1)}s staff leaked in`],
  ];
  ctx.font = '16px system-ui, sans-serif';
  legend.forEach(([c, label], i) => {
    const ly = 70 + i * 26;
    ctx.fillStyle = c;
    ctx.fillRect(PAD, ly - 12, 26, 6);
    ctx.fillStyle = '#cdd6e3';
    ctx.fillText(label, PAD + 38, ly - 4);
  });

  const fn = (a) => a[a.length - 1];
  ctx.fillStyle = '#8b95a6';
  ctx.font = '15px system-ui, sans-serif';
  ctx.fillText(
    `final swings: after ${fn(s.after)} · rogue ${fn(s.rogue)} · before ${fn(s.before)}`,
    PAD,
    H - 18,
  );
}, out);

await sleep(200);
const el = await page.$('#swing-chart');
await el.screenshot({ path: 'tmp/wolf-form-swing-chart.png' });
console.log('wrote tmp/wolf-form-swing-chart.png');

// Second artifact: the real druid shifted into Wolf Form through the ability pipeline.
await page.evaluate(() => {
  document.querySelector('#swing-chart')?.remove();
  const sim = window.__game.sim,
    p = sim.player;
  p.auras = p.auras.filter((a) => a.kind === 'form_cat');
  if (!p.auras.some((a) => a.kind === 'form_cat')) sim.castAbility('cat_form', p.id);
  window.__game.input.camDist = 8;
  window.__game.input.camPitch = 0.3;
  sim.tick();
});
await sleep(1200);
await page.evaluate(() => document.querySelector('.tut-skip')?.click());
await sleep(300);
await page.screenshot({ path: 'tmp/wolf-form-ingame.png' });
console.log('wrote tmp/wolf-form-ingame.png');
console.log(
  'staff speed:',
  out.staffSpeed,
  '| final swings  after:',
  out.after.at(-1),
  'rogue:',
  out.rogue.at(-1),
  'before:',
  out.before.at(-1),
);

await browser.close();
