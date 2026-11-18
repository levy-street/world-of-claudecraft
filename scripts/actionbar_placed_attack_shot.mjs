// Screenshot Attack placed on a normal action bar slot, in the offline client.
// Boots a warrior, turns "Show Attack Button" off (freeing slot 1 for a spell),
// then puts the placeable Attack action on bar slot 4 (configurable index 2):
// the same bar state a spellbook drag of the Attack row onto that slot leaves.
// After the change, slot 4 paints the Attack icon and its key toggles
// auto-attack (the run starts auto-attack on a nearby mob so the active glow
// shows). Before the change the bar has no Attack kind, so slot 4 stays empty
// and nothing on the bar can start auto-attack.
//
// Desktop shoots #actionbar; mobile (landscape, touch layout) shoots the touch
// ring, whose first page maps to bar slots 1 to 4.
//
//   GAME_URL=http://localhost:5199 SHOT_VIEWPORT=desktop|mobile \
//   SHOT_OUT_PREFIX=tmp/placed_attack-after node scripts/actionbar_placed_attack_shot.mjs

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5199';
const VIEWPORT = process.env.SHOT_VIEWPORT ?? 'desktop';
const OUT_PREFIX = process.env.SHOT_OUT_PREFIX ?? 'tmp/placed_attack';
const isMobile = VIEWPORT === 'mobile';
// Mobile HUD is landscape-only on the web client.
const metrics = isMobile
  ? { width: 844, height: 390, deviceScaleFactor: 2, mobile: true }
  : { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false };
fs.mkdirSync('tmp', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'],
  defaultViewport: isMobile
    ? {
        width: metrics.width,
        height: metrics.height,
        deviceScaleFactor: metrics.deviceScaleFactor,
        isMobile: true,
        hasTouch: true,
      }
    : { width: metrics.width, height: metrics.height },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log(`PAGEERROR: ${e.message}`));

// Lowest graphics preset (standing capture rule). enterOfflineGame dismisses the
// onboarding overlays itself.
await page.evaluateOnNewDocument(() => {
  window.localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: 1 }));
});

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 60000 });
const booted = await enterOfflineGame(page, {
  charClass: 'warrior',
  charName: 'Placedattack',
  gameBootTimeoutMs: 60000,
  selectorTimeoutMs: 30000,
}).catch(async (e) => {
  await page.screenshot({ path: `${OUT_PREFIX}-entry-failed.png` });
  throw e;
});
if (!booted) throw new Error('world did not boot');
if (isMobile) await page.evaluate(() => document.body.classList.add('mobile-touch'));
await new Promise((r) => setTimeout(r, 500));

const setup = await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const hud = g.hud;
  sim.setPlayerLevel(20);
  sim.player.gm = true;
  // Free slot 1 (the fixed Attack button), the Interface option a player unticks.
  hud.optionsHooks.settings.set('showAttackButton', false);
  // Put a spell that is not already on the bar on the freed slot 1, so the bar
  // reads like a real one.
  const onBar = new Set(hud.actionBarController.actions.map((a) => a?.id));
  const firstSpell = sim.known.find((k) => !k.def.passive && !onBar.has(k.def.id))?.def.id ?? null;
  if (firstSpell) hud.actionBarController.replaceAttackAction({ type: 'ability', id: firstSpell });
  // Place Attack on bar slot 4 (configurable index 2), the state a spellbook drop leaves.
  const actions = hud.actionBarController.actions.slice();
  actions[2] = { type: 'attack', id: 'attack' };
  hud.actionBarController.replaceActions(actions);
  hud.actionBarController.saveActions();
  hud.actionBarController.saveAttackAction();
  // Target the nearest living mob and press the slot's key path, so the
  // active (swinging) glow shows where the change supports it.
  let best = null;
  let bestD = Infinity;
  for (const e of sim.entities.values()) {
    if (e.kind !== 'mob' || e.dead) continue;
    const d = Math.hypot(e.pos.x - sim.player.pos.x, e.pos.z - sim.player.pos.z);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  if (best) sim.targetEntity(best.id);
  hud.castSlot(3);
  return {
    slot3: hud.actionBarController.actionForSlot(3),
    autoAttack: sim.player.autoAttack,
    target: best?.name ?? null,
  };
});
console.log('setup:', JSON.stringify(setup));
await new Promise((r) => setTimeout(r, 800));
if (!isMobile) {
  // The chat log can overlap the bar's left edge at this size; hide it so the clip
  // isolates the bar (onboarding overlays are suppressed the same way above).
  await page.evaluate(() => {
    const chat = document.getElementById('chatlog-wrap');
    if (chat) chat.style.display = 'none';
  });
}

await page.screenshot({ path: `${OUT_PREFIX}-scene.png` });
const box = await page.evaluate(
  (s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  },
  isMobile ? '#mobile-action-ring' : '#actionbar',
);
if (box && box.w > 0) {
  const pad = 14;
  const x = Math.max(0, box.x - pad);
  const y = Math.max(0, box.y - pad);
  await page.screenshot({
    path: `${OUT_PREFIX}-bar.png`,
    clip: {
      x,
      y,
      width: Math.min(metrics.width - x, box.w + pad * 2),
      height: Math.min(metrics.height - y, box.h + pad * 2),
    },
  });
}
console.log(`saved ${OUT_PREFIX}-scene.png, ${OUT_PREFIX}-bar.png`);
await browser.close();
process.exit(0);
