// Before/after capture for the Shadow priest's form look (Gloamveil): the
// entry, standing, casting and walking moments on a full preset, what the
// lowest preset keeps, and the form inside a dungeon instance. Needs a Vite dev
// client (offline world only, no server):
//
//   GAME_URL=http://127.0.0.1:5173 SHOTS_DIR=tmp/gloamveil-look \
//     node scripts/gloamveil_look_shot.mjs after
//
// Run it once on the base tree (`before`) and once on the branch (`after`): it
// drives only the sim's public surface (level, talents, the real form ability,
// a real Mind Blast at a spawned wolf) and the renderer's editor camera, so the
// same file runs on both.
//
// This is a GRAPHICS comparison, the one exception to the lowest-preset
// capture rule (pr-screenshots skill): the form's look is a tier ladder, so the
// rig launches on a real GPU backend (a software rasterizer is detected and
// forced to the lowest tier) and seeds the preset each scenario asks for.
//
// The stills are read off the game canvas inside the frame that drew them
// (`canvas.toDataURL` in a requestAnimationFrame callback that runs after the
// game's own), at offsets measured on the page clock. A node-side sleep is not
// game time, and a 0.3 s entry beat cannot be caught with one.

import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';
import { assertLoopbackUrl } from './lib/loopback_guard.mjs';

const url = assertLoopbackUrl(process.env.GAME_URL ?? 'http://127.0.0.1:5173', 'GAME_URL');
const out = path.resolve(process.env.SHOTS_DIR ?? 'tmp/gloamveil-look');
// File prefix, the first CLI argument: `before` on the base tree, `after` on the branch.
const prefix = process.argv[2] ?? 'shot';
// Optional second argument: one scenario name, to re-shoot a single one.
const only = process.argv[3] ?? null;
fs.mkdirSync(out, { recursive: true });

const VIEWPORT = { width: 1600, height: 900 };
// The character sits at screen center; the crop keeps the floor around it.
const CROP = { x: 400, y: 70, width: 800, height: 760 };
// Camera offsets around the character, in facing-relative yaw (0 = in front).
const CAMERA = { yaw: Math.PI + 2.5, dist: 7.0, height: 2.8, lookY: 0.9 };

// preset: the graphics preset seeded before boot (src/ui/options_view.ts ladder).
const SCENARIOS = [
  {
    name: 'world',
    preset: 4,
    where: 'shore',
    moments: ['entry', 'standing', 'casting', 'walking'],
  },
  { name: 'low', preset: 1, where: 'shore', moments: ['standing'] },
  { name: 'dungeon', preset: 4, where: 'hollow_crypt', moments: ['standing'] },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const SETTLE_MS = 22000;

async function awaitWorldPainted(page) {
  await page.waitForFunction(
    () => {
      const el = document.getElementById('loading-screen');
      if (!el) return true;
      const cs = getComputedStyle(el);
      return cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0;
    },
    { timeout: 240000 },
  );
}

// Installed once per page: a camera that follows the player every frame, and a
// still read off the canvas `ms` after a page-clock mark.
const PAGE_HELPERS = `(() => {
  const g = window.__game;
  window.__shotCam = null;
  const follow = () => {
    const v = window.__shotCam;
    if (v) {
      const p = g.sim.player;
      const yaw = v.facing + v.yaw;
      const target = g.renderer.camera.position.clone().set(p.pos.x, p.pos.y + v.lookY, p.pos.z);
      const pos = target.clone().set(
        p.pos.x + Math.sin(yaw) * v.dist,
        p.pos.y + v.height + 0.35,
        p.pos.z + Math.cos(yaw) * v.dist,
      );
      g.renderer.editorCam = { target, pos };
    }
    requestAnimationFrame(follow);
  };
  requestAnimationFrame(follow);
  window.__shotMark = 0;
  window.__shotBlank = 0;
  window.__shotGrab = (ms, crop) => new Promise((resolve) => {
    const tick = () => {
      if (performance.now() - window.__shotMark < ms) return requestAnimationFrame(tick);
      const src = g.renderer.webgl.domElement;
      const scale = src.width / src.clientWidth;
      const still = document.createElement('canvas');
      still.width = crop.width;
      still.height = crop.height;
      const ctx = still.getContext('2d');
      ctx.drawImage(
        src,
        crop.x * scale, crop.y * scale, crop.width * scale, crop.height * scale,
        0, 0, crop.width, crop.height,
      );
      // A frame read after the browser presented it comes back blank (the
      // drawing buffer is not preserved): take the next one instead.
      const probe = ctx.getImageData(0, 0, crop.width, 32).data;
      let lit = 0;
      for (let i = 0; i < probe.length; i += 16) lit += probe[i] + probe[i + 1] + probe[i + 2];
      if (lit === 0 && ++window.__shotBlank < 60) return requestAnimationFrame(tick);
      window.__shotBlank = 0;
      resolve(still.toDataURL('image/png'));
    };
    requestAnimationFrame(tick);
  });
})()`;

async function grab(page, name, ms = 0) {
  const data = await page.evaluate((delay, crop) => window.__shotGrab(delay, crop), ms, CROP);
  const file = path.join(out, `${prefix}-${name}.png`);
  fs.writeFileSync(file, Buffer.from(data.split(',')[1], 'base64'));
  console.log(`wrote ${file}`);
}

const mark = (page) =>
  page.evaluate(() => {
    window.__shotMark = performance.now();
  });

const enterForm = (page) =>
  page.evaluate(() => {
    const g = window.__game;
    const p = g.sim.player;
    p.resource = p.maxResource;
    p.gcdRemaining = 0;
    p.cooldowns.clear();
    g.sim.castAbility('shadowform');
    g.hud.handleEvents(g.sim.drainEvents());
    window.__shotMark = performance.now();
    return p.auras.some((a) => a.kind === 'form_shadow');
  });

// A shadow spell at a spawned wolf: a cast that drives the form without
// ending it (a holy heal would).
const castAtWolf = (page) =>
  page.evaluate(() => {
    const g = window.__game;
    const sim = g.sim;
    const p = sim.player;
    p.resource = p.maxResource;
    p.gcdRemaining = 0;
    p.cooldowns.clear();
    let best = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const e of sim.entities.values()) {
      if (e.kind !== 'mob' || e.dead || e.templateId !== 'forest_wolf') continue;
      const d = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
      if (d < bestDist) {
        bestDist = d;
        best = e;
      }
    }
    if (!best) return false;
    p.targetId = best.id;
    p.facing = p.prevFacing = Math.atan2(best.pos.x - p.pos.x, best.pos.z - p.pos.z);
    sim.castAbility('mind_blast');
    g.hud.handleEvents(sim.drainEvents());
    window.__shotMark = performance.now();
    return p.castRemaining > 0;
  });

async function shoot(browser, scenario) {
  const page = await browser.newPage();
  page.on('pageerror', (error) => console.log(`[pageerror] ${error.message}`));
  await page.setViewport(VIEWPORT);
  // graphicsDefaultApplied pins the choice: without it the first-run device
  // detection (main.ts) overwrites a seeded preset with the one it picks.
  await page.evaluateOnNewDocument((preset) => {
    localStorage.setItem(
      'woc_settings',
      JSON.stringify({ graphicsPreset: preset, graphicsDefaultApplied: true }),
    );
  }, scenario.preset);
  await page.goto(url.href, { waitUntil: 'networkidle0', timeout: 240000 });
  const booted = await enterOfflineGame(page, {
    charClass: 'priest',
    charName: 'Faceless',
    selectorTimeoutMs: 120000,
    gameBootTimeoutMs: 240000,
  });
  if (!booted) throw new Error('offline priest did not boot');
  await awaitWorldPainted(page);
  await page.addStyleTag({
    content:
      '#banner, #gpu-notice, #tutorial-greeting, #talking-head { display: none !important; }',
  });
  await page.evaluate(() =>
    import('/src/render/day_night_clock.ts').then((m) => m.setDayNightPhaseOverride(0.5)),
  );
  const tier = await page.evaluate((where) => {
    const g = window.__game;
    const sim = g.sim;
    sim.setPlayerLevel(20);
    sim.applyTalents({ spec: 'shadow', rows: {} });
    sim.chat('/dev god');
    if (where !== 'shore') sim.enterDungeon(where);
    return g.renderer.perfStats?.().tier ?? null;
  }, scenario.where);
  console.log(`${scenario.name}: preset ${scenario.preset}, tier ${tier}`);
  // An instance arrival runs behind its own cover; let it lift.
  await sleep(scenario.where === 'shore' ? 3000 : 12000);
  await awaitWorldPainted(page);
  await page.evaluate(PAGE_HELPERS);
  await page.evaluate((camera) => {
    const p = window.__game.sim.player;
    p.inCombat = false;
    // Turned so the camera looks along the shore, away from the spawn NPCs.
    if (!window.__game.sim.riftFloor) p.facing = p.prevFacing = 0.4 + Math.PI;
    window.__shotCam = { ...camera, facing: p.facing };
  }, CAMERA);
  // Let the boot's background link debt drain before the shift: on a client
  // that is still linking its catalog the form's settled materials land a few
  // hundred milliseconds after its stand-ins, and the entry still would catch
  // the stand-ins instead of the look a player normally sees.
  await sleep(SETTLE_MS);

  if (!(await enterForm(page))) throw new Error('shadowform did not apply form_shadow');
  if (scenario.moments.includes('entry')) await grab(page, `${scenario.name}-entry`, 330);
  if (scenario.moments.includes('standing')) await grab(page, `${scenario.name}-standing`, 5200);
  if (scenario.moments.includes('casting')) {
    await page.evaluate(() => window.__game.sim.chat('/dev spawn forest_wolf 1 14'));
    await sleep(1800);
    if (!(await castAtWolf(page))) throw new Error('mind_blast did not start a cast');
    await grab(page, `${scenario.name}-casting`, 900);
    await sleep(3200);
  }
  if (scenario.moments.includes('walking')) {
    await page.evaluate(() => {
      const p = window.__game.sim.player;
      p.targetId = null;
      p.facing = p.prevFacing = window.__shotCam.facing + Math.PI;
    });
    await page.keyboard.down('w');
    await mark(page);
    await grab(page, `${scenario.name}-walking`, 1500);
    await page.keyboard.up('w');
  }
  await page.close();
}

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
  defaultViewport: VIEWPORT,
});

try {
  for (const scenario of SCENARIOS) {
    if (only && scenario.name !== only) continue;
    await shoot(browser, scenario);
  }
} finally {
  await browser.close();
}
