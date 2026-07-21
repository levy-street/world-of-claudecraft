// Visual capture for the absorb-shield bar overlay (Power Word: Shield etc.).
// Boots the offline game, injects absorb auras onto the player/target entities
// (purely to exercise the HUD render — fresh chars are too low level to cast),
// and screenshots the unit frames. Needs `npm run dev` on :5173.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: EDGE, headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.click('#btn-offline');
await sleep(200);
await page.type('#char-name', 'Cleric');
await page.click('#offline-select .mini-class[data-class="priest"]');
await page.click('#btn-start-offline');
await sleep(2500);

// Helper run in the page: stamp an absorb aura on an entity's plain `.auras`
// array (the HUD reads it each frame). Args are data only — no eval.
async function pushAbsorb(args) {
  await page.evaluate(({ which, hpFrac, valFrac, name, id }) => {
    const sim = window.__game.sim;
    const e = which === 'player' ? sim.player : sim.entities.get(sim.player.targetId);
    if (!e) return;
    e.hp = Math.round(e.maxHp * hpFrac);
    e.auras = (e.auras || []).filter((a) => a.kind !== 'absorb');
    e.auras.push({ id, name, kind: 'absorb', remaining: 30, duration: 30,
      value: Math.round(e.maxHp * valFrac), sourceId: 0, school: 'holy' });
  }, args);
}

// Clip a screenshot to a single element's bounding box (+ padding).
async function shoot(sel, path, pad = 12) {
  const b = await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, sel);
  if (!b) { console.log('no element', sel); return; }
  await page.screenshot({ path, clip: { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: b.w + pad * 2, height: b.h + pad * 2 } });
}

// --- Shot 3 prep: target a nearby enemy so the target frame is visible ---
const ok = await page.evaluate(() => {
  const sim = window.__game.sim, p = sim.player;
  let wolf = null, d = 1e9;
  for (const e of sim.entities.values()) {
    if (e.kind === 'mob' && !e.dead) {
      const dd = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
      if (dd < d) { d = dd; wolf = e; }
    }
  }
  if (!wolf) return false;
  p.pos.x = wolf.pos.x + 3; p.pos.z = wolf.pos.z;
  sim.targetEntity(wolf.id);
  return true;
});
console.log('target setup:', ok ? 'OK' : 'no mob found');

// --- Shot 1: partial shield on the player frame ---
await pushAbsorb({ which: 'player', hpFrac: 0.6, valFrac: 0.25, name: 'Power Word: Shield', id: 'power_word_shield' });
await pushAbsorb({ which: 'target', hpFrac: 0.5, valFrac: 0.3, name: 'Ice Barrier', id: 'ice_barrier' });
await sleep(500);
await shoot('#player-frame', 'tmp/absorb_01_player_partial.png');
// --- Shot 3: shield on a targeted enemy (target frame) ---
await shoot('#target-frame', 'tmp/absorb_03_target.png');

// --- Shot 2: overshield (absorb covers the whole bar -> gold) ---
await pushAbsorb({ which: 'player', hpFrac: 0.85, valFrac: 0.9, name: 'Power Word: Shield', id: 'power_word_shield' });
await sleep(400);
await shoot('#player-frame', 'tmp/absorb_02_player_overshield.png');

// Full HUD context shot
await page.screenshot({ path: 'tmp/absorb_04_full.png' });

console.log('screenshots written to tmp/absorb_0*.png');
await browser.close();
