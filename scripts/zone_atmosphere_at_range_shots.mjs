// Visual A/B for the biome haze field (src/render/biome_haze_field.ts): stand
// at a zone border vantage and look across it, once with the field on and once
// with `?zonehaze=off`, so the pair shows whether a neighbouring realm reads as
// its own place from a distance instead of borrowing the camera zone's air.
//
// Needs `npm run dev` running. Writes tmp/zonehaze-<vantage>-<on|off>.png.
// Env: GAME_URL, DAY_PHASE (a /daynight argument, default 'day'), GFX_TIER,
// SHOT_W / SHOT_H, ALL_VANTAGES=1.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const BASE = process.env.GAME_URL ?? 'http://localhost:5173';
const PHASE = process.env.DAY_PHASE ?? 'day';
// high, not ultra, by default: same vista envelope and the same haze shader,
// but a coarser far mesh, and a whole-world frame under SwiftShader is minutes
// of rasterization on a busy machine. GFX_TIER=ultra for the showcase pass.
const TIER = process.env.GFX_TIER ?? 'high';
const W = Number(process.env.SHOT_W ?? 960);
const H = Number(process.env.SHOT_H ?? 540);
const SUFFIX = process.env.SHOT_SUFFIX ?? '';
fs.mkdirSync('tmp', { recursive: true });

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// Each vantage stands inside one realm looking across a COLUMN border into the
// next, which is the sightline the effect exists for. The Frostveil band is the
// pick because it has a different realm on each side at the same z: the
// Nightbloom's lavender to the west and the Wraithwood's dead grey to the east,
// so one boot yields two opposite contrasts against the same icy foreground.
// yaw 0 faces +z; pitch is the chase-camera pitch (0.32 is the game default,
// clamped to 1.35), so a low value with a long boom reads as a vista.
const VANTAGES = [
  { name: 'frostveil-to-nightbloom', x: 100, z: 1650, yaw: -Math.PI / 2, pitch: 0.36, dist: 46 },
  { name: 'frostveil-to-wraithwood', x: -100, z: 1650, yaw: Math.PI / 2, pitch: 0.36, dist: 46 },
  // The Amberfall's southern shoulder looking down into the Nightbloom: warm
  // golden air over the amber downs, lavender over the violet ones. Off by
  // default because it needs a second cross-world stream to settle.
  ...(process.env.ALL_VANTAGES
    ? [{ name: 'amberfall-to-nightbloom', x: -360, z: 1900, yaw: Math.PI, pitch: 0.36, dist: 46 }]
    : []),
];

async function capture(hazeOn) {
  const arm = hazeOn ? 'on' : 'off';
  const url = `${BASE}/?gfx=${TIER}${hazeOn ? '' : '&zonehaze=off'}`;
  log('launch', arm, url);
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: 'new',
    args: [`--window-size=${W},${H}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    defaultViewport: { width: W, height: H },
    // A whole-world vista frame under SwiftShader outruns the default 180s
    // protocol timeout, which would abort the capture call itself.
    protocolTimeout: 900000,
  });
  const page = await browser.newPage();
  // Pre-dismiss the software-rendering notice: SwiftShader always trips it and
  // the toast would sit over the sky in every frame.
  await page.evaluateOnNewDocument(() => {
    try {
      localStorage.setItem('woc_gpu_notice_dismissed', '1');
    } catch {}
  });
  page.on('pageerror', (e) => log('PAGEERROR:', e.message.slice(0, 300)));
  page.on('console', (m) => {
    const t = m.text();
    // A failed shader patch is a console error from three, never a pageerror.
    if (m.type() === 'error' && /shader|program|gl_|glsl/i.test(t)) {
      log('SHADER ERROR:', t.slice(0, 600));
    }
  });
  // domcontentloaded, not networkidle0: with no `npm run server` behind the
  // dev proxy the site-presence heartbeat retries forever and the page never
  // goes idle. enterOfflineGame owns the real readiness waits.
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  log('loaded, waiting for the launcher');
  // The launcher decodes the character-preview assets before it paints, which
  // under SwiftShader on a loaded machine outruns enterOfflineGame's own 30s
  // wait for the same hook; absorb that here so the shared helper stays as is.
  await page.waitForSelector('#btn-offline', { timeout: 240000 });
  log('launcher up, entering the world');
  const booted = await enterOfflineGame(page, {
    charName: 'Skywatcher',
    settleMs: 6000,
    selectorTimeoutMs: 120000,
    gameBootTimeoutMs: 600000,
  });
  if (!booted) {
    // enterOfflineGame RETURNS false rather than throwing when the world hook
    // has not appeared yet, and a SwiftShader scene build on a busy machine
    // runs well past any reasonable shared default. Keep waiting here.
    log('world hook not up yet, waiting longer');
    await page.waitForFunction(() => window.__game?.sim?.player, {
      timeout: 900000,
      polling: 2000,
    });
  }
  log('in world, setting the day phase');

  await page.waitForSelector('#chat-input', { timeout: 120000 });
  await page.evaluate((phase) => {
    const chat = document.querySelector('#chat-input');
    chat.value = `/daynight ${phase}`;
    chat.dispatchEvent(new Event('input', { bubbles: true }));
    chat.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  }, PHASE);
  await new Promise((r) => setTimeout(r, 8000)); // the grade lerps in

  for (const v of VANTAGES) {
    log('teleport', v.name);
    await page.evaluate((s) => {
      const g = window.__game;
      const p = g.sim.player;
      p.pos.x = s.x;
      p.pos.z = s.z;
      p.facing = s.yaw;
      g.input.camYaw = s.yaw;
      g.input.camPitch = s.pitch;
      g.input.camDist = s.dist;
    }, v);
    // A cross-world teleport raises the loading screen while the destination
    // zone streams, and it raises again for each further prepare stage, so a
    // single "not visible" check passes in a gap and photographs the screen a
    // moment later. Require it to stay down for a run of consecutive polls.
    const clear = () =>
      page.evaluate(
        () => !document.querySelector('#loading-screen')?.classList.contains('visible'),
      );
    const deadline = Date.now() + 600000;
    let streak = 0;
    while (streak < 6) {
      if (Date.now() > deadline) throw new Error('loading screen never settled');
      streak = (await clear()) ? streak + 1 : 0;
      await new Promise((r) => setTimeout(r, 2000));
    }
    // Then let the far vista finish taking its idle slots: without this the
    // horizon is still coarse or empty and the comparison is meaningless.
    await new Promise((r) => setTimeout(r, 30000));
    const path = `tmp/zonehaze-${v.name}${SUFFIX}-${arm}.png`;
    log('capturing', path);
    await page.screenshot({ path });
    log('wrote', path);
  }
  await browser.close();
  log('closed', arm);
}

// ARMS=on captures only the field-on arm, for a second day phase where the
// question is "does the haze follow the cycle" rather than "is it there".
const arms = process.env.ARMS ?? 'both';
if (arms !== 'off') await capture(true);
if (arms !== 'on') await capture(false);
log('done');
