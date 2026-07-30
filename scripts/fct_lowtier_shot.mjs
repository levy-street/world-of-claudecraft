// Proof shot for the low-tier floating-combat-text fix (#1718): on the LOW graphics
// preset (data-fx-level="low"), the damage you deal to an enemy now floats. Boots the
// offline world, faces a mob, forces the low HUD effect tier, and feeds a burst of
// player damage-done SimEvents through the real hud.handleEvents -> FctPainter path so
// the numbers spawn exactly as they do in combat. Run from the repo that has
// puppeteer-core installed; point GAME_URL at the worktree's dev server.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5273';
const OUT = process.env.OUT_DIR ?? 'tmp';
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: [
    '--window-size=1600,900',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--disable-gpu',
  ],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 60000 });
await new Promise((r) => setTimeout(r, 800));
// DOM .click() bypasses hit-testing (a landing CTA modal can sit over the buttons).
await page.evaluate(() => {
  document.querySelector('#discord-cta-close')?.click();
  document.querySelector('#btn-offline')?.click();
});
await new Promise((r) => setTimeout(r, 500));
await page.evaluate((name) => {
  const i = document.querySelector('#char-name');
  if (i) {
    i.value = name;
    i.dispatchEvent(new Event('input', { bubbles: true }));
  }
  document.querySelector('#offline-select .mini-class[data-class="warrior"]')?.click();
}, 'Valdris');
await new Promise((r) => setTimeout(r, 300));
await page.evaluate(() => document.querySelector('#btn-start-offline')?.click());
// wait for the world to boot (window.__game), then skip the intro cinematic (Escape)
// until the HUD (#ui) is shown, then close the options menu if Escape opened it.
for (let i = 0; i < 25; i++) {
  await new Promise((r) => setTimeout(r, 600));
  if (await page.evaluate(() => !!window.__game)) break;
}
for (let i = 0; i < 8; i++) {
  const uiShown = await page.evaluate(() => {
    const ui = document.querySelector('#ui');
    return ui ? window.getComputedStyle(ui).display !== 'none' : false;
  });
  if (uiShown) break;
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 500));
}
// If Escape popped the options menu open, close it so the world is clear.
await page.evaluate(() => {
  const menu = document.querySelector('#options-menu, #game-menu, #esc-menu');
  if (menu && window.getComputedStyle(menu).display !== 'none') {
    document.querySelector('#options-menu .btn-close, #game-menu .btn-close')?.click();
  }
});
await new Promise((r) => setTimeout(r, 500));

// Skip the tutorial overlay if present, for a clean world shot.
await page.evaluate(() => {
  for (const b of document.querySelectorAll('button')) {
    if (/skip tutorial/i.test(b.textContent || '')) b.click();
  }
});
// Let the transient login banners (zone welcome, "raven mail") fade before capturing.
await new Promise((r) => setTimeout(r, 6000));

// Force the LOW HUD effect tier (exactly what the low graphics preset stamps), then pick
// an entity that is actually ON SCREEN (project every entity via the real
// renderer.worldToScreen) so the floaters over its head are visible, and target it.
const setup = await page.evaluate(() => {
  document.documentElement.dataset.fxLevel = 'low';
  document.documentElement.style.setProperty('--fct-scale', '2.1'); // bigger for the shot
  const g = window.__game;
  const sim = g.sim;
  const p = sim.player;
  p.hp = p.maxHp;
  const W = window.innerWidth;
  const H = window.innerHeight;
  // Prefer a hostile mob (open sky above it, and it reads as combat); fall back to any npc.
  const candidate = (kinds) => {
    let best = null;
    let bestDc = 1e9;
    for (const e of sim.entities.values()) {
      if (e.id === p.id || e.dead || !kinds.includes(e.kind)) continue;
      const v = g.renderer.worldToScreen(e.pos.x, e.pos.y + 2 * (e.scale ?? 1), e.pos.z);
      if (!v || v.behind) continue;
      // keep it clear of the HUD edges and high enough that risen numbers stay on screen
      if (v.x < W * 0.22 || v.x > W * 0.82 || v.y < H * 0.28 || v.y > H * 0.6) continue;
      const dc = Math.hypot(v.x - W * 0.5, v.y - H * 0.42);
      if (dc < bestDc) {
        bestDc = dc;
        best = { id: e.id, sx: Math.round(v.x), sy: Math.round(v.y) };
      }
    }
    return best;
  };
  const pick = candidate(['mob']) ?? candidate(['npc']);
  if (!pick) return { ok: false };
  sim.targetEntity(pick.id);
  return {
    ok: true,
    mobId: pick.id,
    playerId: p.id,
    fx: document.documentElement.dataset.fxLevel,
    screen: pick,
  };
});
console.log('setup:', JSON.stringify(setup));
if (!setup.ok) {
  console.log('no on-screen entity found');
  if (errors.length) console.log('errors:', errors.join('\n'));
  await browser.close();
  process.exit(1);
}
await new Promise((r) => setTimeout(r, 400));

// Hide the overhead nameplates so the floating damage numbers read cleanly over the enemy.
await page.evaluate(() => {
  const s = document.createElement('style');
  s.textContent = '#nameplates{display:none !important}';
  document.head.appendChild(s);
});

// A caption so the screenshot is self-evidently the LOW preset.
await page.evaluate(() => {
  const c = document.createElement('div');
  c.textContent = 'Graphics preset: LOW (data-fx-level="low") - the damage you deal now floats';
  c.style.cssText =
    'position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:99999;' +
    'background:rgba(0,0,0,0.75);color:#ffe97a;font:600 15px system-ui;padding:6px 12px;' +
    'border:1px solid #ffe97a;border-radius:6px;pointer-events:none';
  c.id = 'shot-caption';
  document.body.appendChild(c);
});

// Feed player damage-done events (as real combat would) through the HUD event pump.
function burst(mobId, playerId) {
  const mk = (amount, ability, crit) => ({
    type: 'damage',
    sourceId: playerId,
    targetId: mobId,
    amount,
    crit,
    school: 'physical',
    ability,
    kind: 'hit',
  });
  // All NON-CRIT ability hits: exactly the floaters the bug dropped on LOW (only crits
  // used to show). High-contrast yellow so they read against the field.
  return [
    mk(74, 'mortalstrike', false),
    mk(112, 'mortalstrike', false),
    mk(88, 'mortalstrike', false),
    mk(103, 'mortalstrike', false),
    mk(69, 'mortalstrike', false),
  ];
}

// Feed the damage burst and capture within the first frames, while the running rise
// animation keeps the nodes re-rasterizing (a FROZEN node sits on a stale, empty
// compositor layer in headless and never paints; nameplates render for the same reason,
// they re-raster every frame). Two quick waves so several numbers are on screen.
const feed = (evs) => page.evaluate((e) => window.__game.hud.handleEvents(e), evs);
// The floaters only rasterize into the screenshot while their rise animation is live
// (a frozen node sits on a stale, empty compositor layer). So keep re-feeding waves and
// capture a burst of frames; the numbers rise as a legible column above the enemy. Pick
// the clearest crop afterwards.
const cropClip = () => ({
  x: Math.max(0, setup.screen.sx - 300),
  y: 0,
  width: 600,
  height: 420,
});
// Stagger the hits ~55ms apart so they rise into a legible column, then grab frames right
// after the last spawn (the floaters only rasterize while their rise animation is live).
const evs = [...burst(setup.mobId, setup.playerId), ...burst(setup.mobId, setup.playerId)];
for (const e of evs) {
  await feed([e]);
  await new Promise((r) => setTimeout(r, 55));
}
for (let i = 0; i < 8; i++) {
  await page.screenshot({ path: `${OUT}/fct_seq_${i}.png`, clip: cropClip() });
  await new Promise((r) => setTimeout(r, 32));
}
console.log('wrote fct_seq_0..7');
const diag = await page.evaluate(() => {
  const nodes = [...document.querySelectorAll('.fct')];
  const ui = document.querySelector('#ui');
  const uiCs = ui ? window.getComputedStyle(ui) : null;
  const n0 = nodes[0];
  const cs = n0 ? window.getComputedStyle(n0) : null;
  const r = n0 ? n0.getBoundingClientRect() : null;
  return {
    playerId: window.__game.sim.playerId,
    fctCount: nodes.length,
    ui: uiCs ? { zoom: uiCs.zoom, transform: uiCs.transform, overflow: uiCs.overflow } : null,
    node0: n0
      ? {
          t: n0.textContent,
          left: n0.style.left,
          top: n0.style.top,
          color: cs.color,
          fontSize: cs.fontSize,
          visibility: cs.visibility,
          rect: {
            x: Math.round(r.x),
            y: Math.round(r.y),
            w: Math.round(r.width),
            h: Math.round(r.height),
          },
        }
      : null,
    mountId: document.querySelector('.fct')?.parentElement?.id,
  };
});
console.log('fct diag:', JSON.stringify(diag, null, 1));
await page.screenshot({ path: `${OUT}/fct_lowtier_damage.png` });
const cx = setup.screen.sx;
const cy = setup.screen.sy;
await page.screenshot({
  path: `${OUT}/fct_lowtier_damage_crop.png`,
  clip: { x: Math.max(0, cx - 240), y: Math.max(0, cy - 200), width: 480, height: 320 },
});
console.log(`wrote ${OUT}/fct_lowtier_damage_crop.png`);
console.log(`wrote ${OUT}/fct_lowtier_damage.png`);

if (errors.length) console.log('errors:', errors.join('\n'));
await browser.close();
