// Screenshots for the "Maddening Whisper" enfeeble affix (Wyrmcult Zealot).
// A landed hit drains the caster's Intellect, shrinking the mana pool, and shows
// a red debuff on the buff bar. Runs the offline flow (no server). Needs
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
  if (n) { n.value = 'Lyra'; n.dispatchEvent(new Event('input', { bubbles: true })); }
});
await page.evaluate(() => document.querySelector('#offline-select .mini-class[data-class="mage"]')?.click());
await page.evaluate(() => document.querySelector('#btn-start-offline')?.click());
await wait(3000);

// Level the mage to 20 so a L17 Zealot's swing never one-shots it, and capture
// the mana numbers before the curse for the console summary.
await page.evaluate(() => {
  const g = window.__game, sim = g.sim;
  sim.setPlayerLevel(20);
  const p = sim.player;
  p.resource = p.maxResource; // start full
});
await wait(400);

// Retemplate the nearest mob into a Wyrmcult Zealot, stage it in front of the
// player, then force a few swings so the Maddening Whisper curse lands.
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
  mob.templateId = 'wyrmcult_zealot';
  mob.name = 'Wyrmcult Zealot';
  mob.hostile = true;
  mob.level = 17;
  mob.pos.x = p.pos.x + 3; mob.pos.z = p.pos.z; mob.pos.y = p.pos.y;
  const intBefore = p.stats.int, maxManaBefore = p.maxResource;
  // The data table chance is 0.3; swing repeatedly until the curse lands (most
  // swings land — the L20 mage rarely misses being hit by a L17 mob).
  let cursed = false;
  for (let i = 0; i < 200 && !cursed; i++) {
    p.hp = p.maxHp; // never let the swing kill us
    sim.mobSwing(mob, p);
    cursed = p.auras.some((a) => a.kind === 'buff_int' && a.value < 0);
  }
  return {
    ok: cursed, intBefore, intAfter: p.stats.int,
    maxManaBefore, maxManaAfter: p.maxResource,
    aura: p.auras.find((a) => a.kind === 'buff_int' && a.value < 0)?.name ?? null,
  };
});

if (!result.ok) {
  // The data table chance is 0.3 — swing many more times to guarantee a proc.
  await page.evaluate(() => {
    const sim = window.__game.sim, p = sim.player;
    let mob = null, best = 1e9;
    for (const e of sim.entities.values()) {
      if (e.templateId === 'wyrmcult_zealot' && !e.dead) { mob = e; break; }
    }
    if (!mob) return;
    for (let i = 0; i < 400; i++) {
      p.hp = p.maxHp;
      sim.mobSwing(mob, p);
      if (p.auras.some((a) => a.kind === 'buff_int' && a.value < 0)) break;
    }
  });
}

// Teleport the player away so combat ends and the 12s curse rides along, then
// screenshot quickly before regen/recalc churn.
await page.evaluate(() => {
  const sim = window.__game.sim, p = sim.player;
  p.pos.x -= 80;
  p.prevPos = { ...p.pos };
});
await wait(160);
await page.screenshot({ path: 'tmp/enfeeble-hud.png' });

// Crop the buff bar (top-right, left of the minimap) for a legible debuff icon.
try {
  const clip = await page.evaluate(() => {
    const el = document.querySelector('#buff-bar');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.max(0, r.x - 12), y: Math.max(0, r.y - 8), width: Math.min(360, r.width + 24), height: Math.min(120, r.height + 50) };
  });
  if (clip && clip.width > 4) await page.screenshot({ path: 'tmp/enfeeble-buffbar.png', clip });
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
  await page.screenshot({ path: 'tmp/enfeeble-tooltip.png', clip: { x: 900, y: 0, width: 380, height: 230 } });
} catch (e) { errors.push('tooltip: ' + e.message); }

console.log('RESULT', JSON.stringify(result));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'OK: no page errors');
await browser.close();
