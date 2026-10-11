// Before/after capture for the shapeshift form adornments (Moonwing Form's
// antlers, crescent and wings; Gloamveil's shadow veil). Needs a Vite dev
// client (offline world only, no server):
//
//   GAME_URL=http://127.0.0.1:5173 SHOTS_DIR=tmp/form-adornments \
//     node scripts/form_adornment_shot.mjs after
//
// Each scenario boots an offline character of the class, levels it, picks the
// spec that owns the form, casts the REAL form ability through the sim, then
// pins the camera (renderer.editorCam) on a front and a back three-quarter view
// of the character. Seeds the lowest graphics preset first (the capture rule in
// the pr-screenshots skill).

import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';
import { assertLoopbackUrl } from './lib/loopback_guard.mjs';

const url = assertLoopbackUrl(process.env.GAME_URL ?? 'http://127.0.0.1:5173', 'GAME_URL');
const out = path.resolve(process.env.SHOTS_DIR ?? 'tmp/form-adornments');
// File prefix, the first CLI argument: `before` on the base tree, `after` on the branch.
const prefix = process.argv[2] ?? 'shot';
fs.mkdirSync(out, { recursive: true });

// The veil is a face piece, so Gloamveil is shot from the front only.
const SCENARIOS = [
  {
    name: 'moonwing',
    cls: 'druid',
    spec: 'balance',
    ability: 'moonkin_form',
    aura: 'form_moonkin',
    views: ['front', 'back'],
  },
  {
    name: 'gloamveil',
    cls: 'priest',
    spec: 'shadow',
    ability: 'shadowform',
    aura: 'form_shadow',
    views: ['front'],
  },
];

// Camera offsets around the character, in facing-relative yaw (0 = in front).
const VIEWS = [
  { name: 'front', yaw: 0.55, dist: 3.9, height: 1.1, lookY: 1.15 },
  { name: 'back', yaw: Math.PI + 0.55, dist: 3.9, height: 1.3, lookY: 1.1 },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function awaitWorldPainted(page) {
  await page.waitForFunction(
    () => {
      const el = document.getElementById('loading-screen');
      if (!el) return true;
      const cs = getComputedStyle(el);
      return cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0;
    },
    { timeout: 120000 },
  );
}

async function frame(page, view) {
  await page.evaluate((v) => {
    const g = window.__game;
    const p = g.sim.player;
    const yaw = p.facing + v.yaw;
    const target = g.renderer.camera.position.clone().set(p.pos.x, p.pos.y + v.lookY, p.pos.z);
    const pos = target
      .clone()
      .set(
        p.pos.x + Math.sin(yaw) * v.dist,
        p.pos.y + v.height + 0.35,
        p.pos.z + Math.cos(yaw) * v.dist,
      );
    g.renderer.editorCam = { target, pos };
  }, view);
  await sleep(1500);
}

async function capture(page, file, viewport) {
  const w = viewport.width;
  const h = viewport.height;
  // The character sits at screen center; clip a square-ish band around it so the
  // HUD frames and bars stay out of the comparison.
  const cw = Math.round(Math.min(w, h * 1.1));
  const ch = Math.round(h * 0.86);
  await page.screenshot({
    path: file,
    clip: { x: Math.round((w - cw) / 2), y: Math.round((h - ch) / 2), width: cw, height: ch },
  });
  console.log(`wrote ${file}`);
}

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});

try {
  for (const scenario of SCENARIOS) {
    const viewport = { width: 1600, height: 900 };
    const page = await browser.newPage();
    page.on('pageerror', (error) => console.log(`[pageerror] ${error.message}`));
    await page.setViewport(viewport);
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: 1 }));
    });
    await page.goto(url.href, { waitUntil: 'networkidle0', timeout: 120000 });
    const booted = await enterOfflineGame(page, {
      charClass: scenario.cls,
      charName: scenario.name === 'moonwing' ? 'Fizban' : 'Faceless',
      selectorTimeoutMs: 60000,
      gameBootTimeoutMs: 120000,
    });
    if (!booted) throw new Error(`offline ${scenario.cls} did not boot`);
    await awaitWorldPainted(page);
    await page.addStyleTag({
      content:
        '#banner, #gpu-notice, #tutorial-greeting, #talking-head { display: none !important; }',
    });
    const state = await page.evaluate((s) => {
      const g = window.__game;
      const sim = g.sim;
      sim.setPlayerLevel(20);
      sim.applyTalents({ spec: s.spec, rows: {} });
      const p = sim.player;
      p.inCombat = false;
      p.resource = p.maxResource;
      p.gcdRemaining = 0;
      // Turned so the camera looks along the shore, away from the spawn NPCs.
      p.facing = p.prevFacing = 0.4 + Math.PI;
      sim.castAbility(s.ability);
      g.hud.handleEvents(sim.drainEvents());
      const v = g.renderer.views.get(p.id);
      return {
        form: p.auras.some((a) => a.kind === s.aura),
        key: v?.visual?.key ?? null,
      };
    }, scenario);
    console.log(`${scenario.name}: form=${state.form} rig=${state.key}`);
    if (!state.form) throw new Error(`${scenario.ability} did not apply ${scenario.aura}`);
    // Let the tint's effect-swap compile gate settle before the first capture.
    await sleep(4000);
    const views = VIEWS.filter((view) => scenario.views.includes(view.name));
    for (const view of views) {
      await frame(page, view);
      await capture(page, path.join(out, `${prefix}-${scenario.name}-${view.name}.png`), viewport);
    }
    await page.close();
  }
} finally {
  await browser.close();
}
