// Before/after proof for the Lightning Shield nerf (3 charges + 5s internal
// cooldown). Drives the REAL offline Sim in-page: a level-12 shaman casts
// Lightning Shield, a fast beefy wolf wails on it for 40s, and we chart the
// cumulative Nature damage the shield reflects back under two rules:
//   - BEFORE: unlimited, no cooldown (re-armed every tick) -> climbs forever
//   - AFTER:  the shipped 3-charge / 5s-ICD cap            -> plateaus at 3 hits
// The nerf is visible as the "after" line flattening while "before" runs away.
// Needs `npm run dev` (override with GAME_URL). Writes tmp/lightning-shield-chart.png.
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
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE:', m.text());
});

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
// #btn-offline is a hidden, aria-hidden compat trigger: click it via the DOM so
// puppeteer's visibility check doesn't reject it, then wait for the panel to show.
await page.evaluate(() => document.querySelector('#btn-offline').click());
await page.waitForSelector('#offline-select:not([hidden])', { timeout: 15000 });
await sleep(300);
await page.type('#char-name', 'Stormcaller');
await page.evaluate(() => {
  document.querySelector('#offline-select .mini-class[data-class="shaman"]').click();
});
await sleep(150);
await page.click('#btn-start-offline');
await page.waitForFunction(() => window.__game && window.__game.sim && window.__game.sim.player, {
  timeout: 45000,
});
await sleep(1200);

const series = await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const p = sim.player;
  sim.setPlayerLevel(12, p.id);
  p.gm = true;

  const TICKS = 800; // 40s at 20Hz

  function findWolf() {
    let best = null;
    let bestD = Infinity;
    for (const e of sim.entities.values()) {
      if (e.kind !== 'mob' || e.dead || e.templateId !== 'forest_wolf') continue;
      const d = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  // `unlimited` re-arms the shield each tick to emulate the pre-nerf coat.
  function run(unlimited) {
    p.auras = p.auras.filter((a) => a.id !== 'lightning_shield');
    p.hp = p.maxHp = 100000;
    sim.castAbility('lightning_shield');
    sim.tick();
    const wolf = findWolf();
    wolf.level = p.level;
    wolf.weapon = { min: 1, max: 1, speed: 1 };
    wolf.hp = wolf.maxHp = 100000;
    // sit the shaman right next to the wolf
    wolf.pos.x = p.pos.x + 2;
    wolf.pos.z = p.pos.z;
    wolf.prevPos = { x: wolf.pos.x, y: wolf.pos.y, z: wolf.pos.z };

    const cumulative = [];
    let total = 0;
    for (let i = 0; i < TICKS; i++) {
      if (unlimited) {
        const a = p.auras.find((x) => x.id === 'lightning_shield');
        if (a) {
          a.charges = 3;
          a.icd = 0;
          a.remaining = a.duration;
        }
      }
      const evs = sim.tick();
      for (const e of evs) {
        if (e.type === 'damage' && e.ability === 'Lightning Shield' && e.targetId === wolf.id) {
          total += e.amount;
        }
      }
      cumulative.push(total);
    }
    return cumulative;
  }

  const before = run(true);
  const after = run(false);
  return { before, after, ticks: TICKS };
});

// Draw the chart on a detached canvas in-page, then screenshot the element.
await page.evaluate((data) => {
  const { before, after, ticks } = data;
  document.body.innerHTML = '';
  document.body.style.background = '#14110c';
  const W = 1000;
  const H = 560;
  const padL = 90;
  const padR = 40;
  const padT = 70;
  const padB = 70;
  const canvas = document.createElement('canvas');
  canvas.id = 'chart';
  canvas.width = W;
  canvas.height = H;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#14110c';
  ctx.fillRect(0, 0, W, H);

  const maxY = Math.max(before[before.length - 1], after[after.length - 1], 1);
  const x = (i) => padL + (i / (ticks - 1)) * (W - padL - padR);
  const y = (v) => H - padB - (v / maxY) * (H - padT - padB);

  // axes
  ctx.strokeStyle = '#5a4d36';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(padL, padT);
  ctx.lineTo(padL, H - padB);
  ctx.lineTo(W - padR, H - padB);
  ctx.stroke();

  // gridlines + y labels (seconds on x)
  ctx.fillStyle = '#b9a77f';
  ctx.font = '14px system-ui, sans-serif';
  ctx.textAlign = 'right';
  for (let g = 0; g <= 4; g++) {
    const v = (maxY * g) / 4;
    const yy = y(v);
    ctx.strokeStyle = '#2b2418';
    ctx.beginPath();
    ctx.moveTo(padL, yy);
    ctx.lineTo(W - padR, yy);
    ctx.stroke();
    ctx.fillText(String(Math.round(v)), padL - 10, yy + 5);
  }
  ctx.textAlign = 'center';
  for (let s = 0; s <= 40; s += 10) {
    const i = (s / 40) * (ticks - 1);
    ctx.fillText(`${s}s`, x(i), H - padB + 22);
  }

  const line = (arr, color) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    arr.forEach((v, i) => {
      if (i === 0) ctx.moveTo(x(i), y(v));
      else ctx.lineTo(x(i), y(v));
    });
    ctx.stroke();
  };
  line(before, '#e8554d'); // before: runaway red
  line(after, '#46c2a8'); // after: capped teal

  // titles + legend
  ctx.fillStyle = '#f3e7c4';
  ctx.font = 'bold 22px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('Lightning Shield: cumulative reflected damage', padL, 36);
  ctx.font = '15px system-ui, sans-serif';
  ctx.fillStyle = '#e8554d';
  ctx.fillText('before (unlimited, no cooldown)', padL, 56);
  ctx.fillStyle = '#46c2a8';
  ctx.fillText('after (3 charges, 5s internal cooldown)', padL + 320, 56);
  ctx.fillStyle = '#8a7c5c';
  ctx.textAlign = 'right';
  ctx.fillText('reflected Nature damage', W - padR, padT - 18);
}, series);

await sleep(150);
const el = await page.$('#chart');
await el.screenshot({ path: 'tmp/lightning-shield-chart.png' });
console.log(
  'wrote tmp/lightning-shield-chart.png; after-plateau =',
  series.after[series.after.length - 1],
  'before-total =',
  series.before[series.before.length - 1],
);

await browser.close();
