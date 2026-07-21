// Screenshots for the "Soul Siphon" enervate affix (Boneclad Revenant).
// A landed hit drains the victim's Stamina, shrinking their max-HP pool, and
// shows a red debuff on the buff bar. Runs the offline flow (no server). Needs
// `npm run dev`. Writes PNGs to tmp/.
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
await page.setViewport({ width: 1280, height: 720 });

const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.evaluate(() => document.querySelector('#btn-offline')?.click());
await wait(200);
await page.evaluate(() => {
  const n = document.querySelector('#char-name');
  if (n) { n.value = 'Brann', n.dispatchEvent(new Event('input', { bubbles: true })); }
});
await page.evaluate(() => document.querySelector('#offline-select .mini-class[data-class="warrior"]')?.click());
await page.evaluate(() => document.querySelector('#btn-start-offline')?.click());
await wait(3000);

// Level the warrior to 20 so a L18 Revenant's swing never one-shots it.
await page.evaluate(() => {
  const sim = window.__game.sim;
  sim.setPlayerLevel(20);
  const p = sim.player;
  p.hp = p.maxHp;
});
await wait(400);

// Retemplate the nearest mob into a Boneclad Revenant, stage it in front of the
// player, then force swings until the Soul Siphon drain lands.
const result = await page.evaluate(async () => {
  const sim = window.__game.sim;
  const p = sim.player;
  let mob = null, best = 1e9;
  for (const e of sim.entities.values()) {
    if (e.kind !== 'mob' || e.dead) continue;
    const dx = e.pos.x - p.pos.x, dz = e.pos.z - p.pos.z;
    const d = dx * dx + dz * dz;
    if (d < best) { best = d; mob = e; }
  }
  if (!mob) return { ok: false, why: 'no mob nearby' };
  mob.templateId = 'boneclad_revenant';
  mob.name = 'Boneclad Revenant';
  mob.hostile = true;
  mob.level = 18;
  mob.pos.x = p.pos.x + 3; mob.pos.z = p.pos.z; mob.pos.y = p.pos.y;
  const staBefore = p.stats.sta, maxHpBefore = p.maxHp;
  let drained = false;
  for (let i = 0; i < 400 && !drained; i++) {
    p.hp = p.maxHp; // never let the swing kill us
    sim.mobSwing(mob, p);
    drained = p.auras.some((a) => a.kind === 'buff_sta' && a.value < 0);
  }
  // Set HP to ~70% of the (now-smaller) pool so the red HP bar reads clearly.
  p.hp = Math.round(p.maxHp * 0.7);
  return {
    ok: drained, staBefore, staAfter: p.stats.sta,
    maxHpBefore, maxHpAfter: p.maxHp,
    aura: p.auras.find((a) => a.kind === 'buff_sta' && a.value < 0)?.name ?? null,
  };
});

// Teleport the player away so combat ends and the 12s drain rides along, then
// screenshot quickly before regen/recalc churn.
await page.evaluate(() => {
  const sim = window.__game.sim, p = sim.player;
  p.pos.x -= 80;
  p.prevPos = { ...p.pos };
});
await wait(160);
await page.screenshot({ path: 'tmp/enervate-hud.png' });

// Crop the buff bar (top-right, left of the minimap) for a legible debuff icon.
try {
  const clip = await page.evaluate(() => {
    const el = document.querySelector('#buff-bar');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.max(0, r.x - 12), y: Math.max(0, r.y - 8), width: Math.min(360, r.width + 24), height: Math.min(120, r.height + 50) };
  });
  if (clip && clip.width > 4) await page.screenshot({ path: 'tmp/enervate-buffbar.png', clip });
} catch (e) { errors.push('buffbar crop: ' + e.message); }

// Hover the debuff icon to surface its tooltip, then crop the top-right region.
try {
  await page.evaluate(() => {
    const icon = document.querySelector('#buff-bar .buff.debuff') || document.querySelector('#buff-bar .buff');
    if (!icon) return;
    const r = icon.getBoundingClientRect();
    const opts = { bubbles: false, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 };
    icon.dispatchEvent(new MouseEvent('mouseenter', opts));
    icon.dispatchEvent(new MouseEvent('mousemove', { ...opts, bubbles: true }));
  });
  await wait(250);
  await page.screenshot({ path: 'tmp/enervate-tooltip.png', clip: { x: 900, y: 0, width: 380, height: 230 } });
} catch (e) { errors.push('tooltip: ' + e.message); }

console.log('RESULT', JSON.stringify(result));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'OK: no page errors');
await browser.close();
