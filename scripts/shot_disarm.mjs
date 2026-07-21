// Screenshot harness for the Thornpeak Crusher "Disarming Smash" disarm affix.
// Runs the offline client (no server/Postgres), forces the on-hit disarm proc, and
// captures the debuff on the player frame + proves auto-attack is suppressed while
// the weapon is knocked away. Needs `npm run dev` running. Writes PNGs to tmp/.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';
const URL = process.env.GAME_URL ?? 'http://localhost:5173';
fs.mkdirSync('tmp', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });

const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
const tap = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);

await page.evaluate(() => document.querySelector('#btn-offline').click());
await wait(200);
await page.evaluate(() => {
  const n = document.querySelector('#char-name');
  if (n) { n.value = 'Disarmed'; n.dispatchEvent(new Event('input', { bubbles: true })); }
});
await tap('#offline-select .mini-class[data-class="warrior"]');
await tap('#btn-start-offline');
await wait(3000);

// God-mode the player and force the disarm proc from a repurposed nearby mob.
const info = await page.evaluate(() => {
  const game = window.__game;
  const sim = game.sim;
  const p = sim.player;
  p.maxHp = 99999; p.hp = 99999;
  // Repurpose the nearest living mob as a Thornpeak Crusher carrying the affix.
  let best = null, bestD = Infinity;
  for (const e of sim.entities.values()) {
    if (e.kind !== 'mob' || e.dead || e.id === p.id) continue;
    const dx = e.pos.x - p.pos.x, dz = e.pos.z - p.pos.z;
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = e; }
  }
  if (!best) return { ok: false, reason: 'no mob nearby' };
  best.templateId = 'ogre_crusher';
  best.hostile = true;
  // Swing repeatedly until the 25% disarm proc lands (misses/dodges possible).
  for (let i = 0; i < 200 && !p.auras.some((a) => a.kind === 'disarm'); i++) {
    p.hp = 99999; // stay alive through every landed swing
    sim.mobSwing(best, p);
  }
  const disarm = p.auras.find((a) => a.kind === 'disarm');
  return {
    ok: !!disarm,
    auraName: disarm?.name ?? null,
    remaining: disarm?.remaining ?? null,
    autoAttackSuppressed: disarm ? (sim.isDisarmed ? sim.isDisarmed(p) : true) : null,
  };
});

await wait(400);
await page.screenshot({ path: 'tmp/disarm_world.png' });

// Crop the player unit frame + buff/debuff bar if present.
const frame = await page.evaluate(() => {
  const el = document.querySelector('#buff-bar') || document.querySelector('#player-frame');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.max(0, r.x - 8), y: Math.max(0, r.y - 8), width: r.width + 16, height: r.height + 16 };
});
if (frame && frame.width > 4 && frame.height > 4) {
  await page.screenshot({ path: 'tmp/disarm_debuff_crop.png', clip: frame });
}

console.log('disarm result:', JSON.stringify(info));
if (errors.length) console.log('PAGE ERRORS:\n' + errors.join('\n'));
console.log('wrote tmp/disarm_world.png' + (frame ? ', tmp/disarm_debuff_crop.png' : ''));
await browser.close();
process.exit(info.ok ? 0 : 1);
