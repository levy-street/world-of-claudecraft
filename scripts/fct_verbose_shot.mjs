// Proof shots for the Verbose Combat Text option (#1721). With the option ON, the HUD
// floats a lavender "{name} faded" status floater when one of YOUR auras drops off a
// relevant unit (you, your current target, or a party member). This boots offline with the
// option enabled, targets an enemy, and feeds the real `aura` fade SimEvents through
// hud.handleEvents so the floaters spawn exactly as in play. Also captures the options
// toggle. Run from the repo that has puppeteer-core; point GAME_URL at the worktree server.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5373';
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

// Turn the option ON before the client boots (Settings reads woc_settings on load).
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.setItem('woc_settings', JSON.stringify({ verboseCombatText: true }));
  } catch {}
});

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 60000 });
await new Promise((r) => setTimeout(r, 800));
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
}, 'Kaelith');
await new Promise((r) => setTimeout(r, 300));
await page.evaluate(() => document.querySelector('#btn-start-offline')?.click());
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
await page.evaluate(() => {
  for (const b of document.querySelectorAll('button')) {
    if (/skip tutorial/i.test(b.textContent || '')) b.click();
  }
});
await new Promise((r) => setTimeout(r, 6000)); // let login banners fade

// Verify the option loaded on, hide nameplates, and pick an on-screen enemy to target.
const setup = await page.evaluate(() => {
  document.documentElement.style.setProperty('--fct-scale', '1.9');
  const ns = document.createElement('style');
  ns.textContent = '#nameplates{display:none !important}';
  document.head.appendChild(ns);
  const g = window.__game;
  const sim = g.sim;
  const p = sim.player;
  p.hp = p.maxHp;
  const W = window.innerWidth;
  const H = window.innerHeight;
  let best = null;
  let bestDc = 1e9;
  for (const e of sim.entities.values()) {
    if (e.id === p.id || e.dead || e.kind !== 'mob') continue;
    const v = g.renderer.worldToScreen(e.pos.x, e.pos.y + 2 * (e.scale ?? 1), e.pos.z);
    if (!v || v.behind) continue;
    if (v.x < W * 0.22 || v.x > W * 0.82 || v.y < H * 0.28 || v.y > H * 0.6) continue;
    const dc = Math.hypot(v.x - W * 0.5, v.y - H * 0.42);
    if (dc < bestDc) {
      bestDc = dc;
      best = { id: e.id, sx: Math.round(v.x), sy: Math.round(v.y) };
    }
  }
  if (!best) return { ok: false };
  sim.targetEntity(best.id);
  return {
    ok: true,
    mobId: best.id,
    playerId: sim.playerId,
    verbose: g.hud.optionsHooks?.settings.get('verboseCombatText') ?? null,
    screen: best,
  };
});
console.log('setup:', JSON.stringify(setup));
if (!setup.ok) {
  console.log('no on-screen mob');
  await browser.close();
  process.exit(1);
}

await page.evaluate(() => {
  const c = document.createElement('div');
  c.textContent = 'Verbose Combat Text ON - your DoT fades over the enemy';
  c.style.cssText =
    'position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:99999;' +
    'background:rgba(0,0,0,0.75);color:#d8a0d8;font:600 15px system-ui;padding:6px 12px;' +
    'border:1px solid #d8a0d8;border-radius:6px;pointer-events:none';
  document.body.appendChild(c);
});

// Feed the real aura FADE events: a DoT dropping off your target, plus one on the player.
const feed = (evs) => page.evaluate((e) => window.__game.hud.handleEvents(e), evs);
const fade = (targetId, name) => ({ type: 'aura', targetId, name, gained: false });
const tgtInfo = await page.evaluate(
  (mobId) => ({
    playerTargetId: window.__game.sim.player.targetId,
    mobId,
    verbose: window.__game.hud.optionsHooks?.settings.get('verboseCombatText'),
  }),
  setup.mobId,
);
console.log('tgtInfo:', JSON.stringify(tgtInfo));
const waves = [
  fade(setup.playerId, 'Battle Shout'),
  fade(setup.mobId, 'Rend'),
  fade(setup.mobId, 'Deep Wound'),
  fade(setup.mobId, 'Corruption'),
];
for (const ev of waves) {
  await feed([ev]);
  await new Promise((r) => setTimeout(r, 60));
}
const early = await page.evaluate(() => ({
  fct: document.querySelectorAll('.fct').length,
  status: document.querySelectorAll('.fct-status').length,
  texts: [...document.querySelectorAll('.fct')].slice(0, 6).map((n) => n.textContent + '|' + n.className),
}));
console.log('early diag:', JSON.stringify(early));
const cropClip = () => ({
  x: Math.max(0, setup.screen.sx - 300),
  y: 0,
  width: 600,
  height: 420,
});
for (let i = 0; i < 8; i++) {
  await page.screenshot({ path: `${OUT}/verbose_seq_${i}.png`, clip: cropClip() });
  await new Promise((r) => setTimeout(r, 32));
}
const diag = await page.evaluate(() => {
  const nodes = [...document.querySelectorAll('.fct-status')];
  return { statusCount: nodes.length, texts: nodes.slice(0, 5).map((n) => n.textContent) };
});
console.log('status diag:', JSON.stringify(diag));

// ---- Options toggle shot (static DOM, renders reliably) ----
await page.keyboard.press('Escape');
await new Promise((r) => setTimeout(r, 500));
const opened = await page.evaluate(() => {
  // click the Interface row in the options menu
  const rows = [...document.querySelectorAll('button, .menu-row, [role="button"]')];
  const interfaceRow = rows.find((r) => /^interface$/i.test((r.textContent || '').trim()));
  if (interfaceRow) {
    interfaceRow.click();
    return true;
  }
  return false;
});
await new Promise((r) => setTimeout(r, 500));
const toggleShot = await page.evaluate(() => {
  // lift any scroll cap so the whole list is visible, then locate the toggle row
  for (const el of document.querySelectorAll('#options-menu, .options-panel, .set-list, .window')) {
    el.style.maxHeight = 'none';
    el.style.overflow = 'visible';
  }
  const rows = [...document.querySelectorAll('.set-row')];
  const row = rows.find((r) => /verbose combat text/i.test(r.textContent || ''));
  if (!row) return null;
  row.scrollIntoView({ block: 'center' });
  const win =
    row.closest('#options-menu') || row.closest('.window') || row.parentElement;
  const b = (win || row).getBoundingClientRect();
  return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), found: true };
});
console.log('toggleShot:', JSON.stringify(toggleShot));
if (toggleShot?.found) {
  await new Promise((r) => setTimeout(r, 200));
  await page.screenshot({
    path: `${OUT}/verbose_options_toggle.png`,
    clip: {
      x: Math.max(0, toggleShot.x - 6),
      y: Math.max(0, toggleShot.y - 6),
      width: Math.min(1600, toggleShot.w + 12),
      height: Math.min(900, toggleShot.h + 12),
    },
  });
  console.log('wrote verbose_options_toggle.png');
}

if (errors.length) console.log('errors:', errors.join('\n'));
await browser.close();
