// Screenshot proof for the practice-dummy pull fix: an Ascension-empowered
// Veilbound March final wave used to drag the Highwatch row's boss dummies
// off their authored 6-yard marks (pullMarkedEnemy skipped isPullEligible).
//
// Boots an offline level-20 Protection paladin at the LOWEST graphics preset
// (standing capture rule; this is not a graphics comparison), teleports them
// just behind the row's normal/heroic boss dummies, grants an Ascension
// charge, casts Veilbound March, walks straight through both dummies at tick
// precision, then lets the march's final wave land. Logs the two dummies'
// z positions (their row marks are 654 and 660) next to the pixels so the
// screenshot is backed by numbers, not just a picture.
//
// Needs `npm run dev` on :5173 (override with GAME_URL). Writes to tmp/.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = process.env.SHOT_NAME ?? 'after';
const T0 = Date.now();
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

// Standing capture rule: seed the lowest graphics preset before boot.
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: 1 }));
  } catch {
    /* ignore */
  }
});

function dismissPerfBanner() {
  return page.evaluate(() => {
    const dismiss = [...document.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === 'Dismiss',
    );
    dismiss?.click();
  });
}

// The loading veil can rise more than once (asset streaming re-arms it), so
// wait until it has stayed hidden for a full streak before trusting the DOM
// underneath it (pr_shot_targets.mjs awaitVeilSettled precedent).
async function awaitVeilSettled(streakMs = 3000) {
  const deadline = Date.now() + 120000;
  let hiddenSince = null;
  while (Date.now() < deadline) {
    const hidden = await page.evaluate(() => {
      const veil = document.getElementById('loading-screen');
      if (!veil) return true;
      const style = getComputedStyle(veil);
      return (
        style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0
      );
    });
    if (!hidden) hiddenSince = null;
    else if (hiddenSince === null) hiddenSince = Date.now();
    else if (Date.now() - hiddenSince >= streakMs) return;
    await sleep(150);
  }
  console.log('WARNING: loading veil never settled within 120s');
}

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
const booted = await enterOfflineGame(page, { charClass: 'paladin', charName: 'Drillmaster' });
if (!booted) throw new Error('offline world did not boot');
console.log('booted at', Date.now() - T0, 'ms');
await awaitVeilSettled();
console.log('veil settled at', Date.now() - T0, 'ms');

// Level 20 Protection, standing at (-40, 651): behind the row's normal (654)
// and heroic (660) boss dummies, ahead of the training dummy (648) and the
// friendly ally (642) so the walk only ever touches the two boss dummies.
const setup = await page.evaluate(() => {
  const sim = window.__game.sim;
  sim.setPlayerLevel(20);
  sim.setSpec('protection');
  const p = sim.player;
  const pos = sim.groundPos(-40, 651);
  p.pos = pos;
  p.prevPos = { ...pos };
  p.facing = 0; // +z, straight down the row toward the boss dummies
  p.prevFacing = 0;
  p.vx = 0;
  p.vy = 0;
  p.vz = 0;
  sim.grid.update(p);
  sim.playerGrid.update(p);
  p.resource = p.maxResource;
  p.paladinDevotion.value = 20;
  sim.castAbility('divine_ascension');
  sim.castAbility('veilbound_march');
  const dummyZ = (id) => {
    const e = [...sim.entities.values()].find((ent) => ent.templateId === id);
    return e ? { x: +e.pos.x.toFixed(2), z: +e.pos.z.toFixed(2) } : null;
  };
  const before = {
    ascensionCharges: p.paladinDevotion.ascensionCharges,
    marching: p.auras.some((a) => a.id === 'veilbound_march'),
    normal: dummyZ('normal_boss_dummy'),
    heroic: dummyZ('heroic_boss_dummy'),
  };

  // Drive movement at TICK precision (real key/frame polling would overwrite
  // moveInput before it ever reaches the sim, the same trap climb_stall_shot.mjs
  // works around): walk forward for 23 ticks (~1.15s at the march's 1.4x run
  // speed, ~9.8 yd/s) so the touch segment crosses BOTH boss dummies (654,
  // 660), stopping just past the heroic one. `completeVeilboundMarch` only
  // pulls a mark still within 10 yd of the caster when the march ends, so
  // step off the row's own axis (both dummies sit at x=-40) toward a point
  // roughly equidistant from both, within that radius: this is what a real
  // Paladin marching through, then side-stepping, looks like, and it is the
  // shape that actually converges the two marks together on screen (a pull
  // parallel to the row's own axis only ever slides both marks by the same
  // amount, which leaves their spacing unchanged).
  const idle = {
    forward: false,
    back: false,
    turnLeft: false,
    turnRight: false,
    strafeLeft: false,
    strafeRight: false,
    jump: false,
  };
  for (let i = 0; i < 23; i++) {
    Object.assign(sim.moveInput, idle, { forward: true });
    sim.tick();
  }
  Object.assign(sim.moveInput, idle);
  sim.tick();
  const sidePos = sim.groundPos(-33, 657);
  p.pos = sidePos;
  p.prevPos = { ...sidePos };
  sim.grid.update(p);
  sim.playerGrid.update(p);
  for (let i = 0; i < 75; i++) sim.tick();

  return { before, player: { x: +p.pos.x.toFixed(2), z: +p.pos.z.toFixed(2) } };
});
console.log('setup:', JSON.stringify(setup));
if (!setup.before.ascensionCharges || !setup.before.marching) {
  throw new Error('failed to arm Ascension + march');
}

await dismissPerfBanner();

// The row runs purely along z (both dummies share x=-40), so a camera
// looking along z sees them stacked end-on (the exact "collapses into one"
// problem practice_dummies.ts warns about). Orbit to the side instead, so
// the z gap between them reads as a left-right spread on screen. The
// always-on mouse-camera follow (camera_follow.ts) snaps camYaw back to the
// player's facing every frame unless it reads an active drag
// (`input.leftDown && input.isCameraDragActive()`, main.ts), so force both.
await page.evaluate(() => {
  const inp = window.__game.input;
  inp.leftDown = true;
  inp.cameraDragActive = true;
  inp.camYaw = Math.PI / 2;
  inp.camDist = 20;
  inp.camPitch = 0.5;
});
await page.screenshot({ path: 'tmp/_frame.png' }); // one compositor frame
await awaitVeilSettled(1000);
console.log('post-walk veil settled at', Date.now() - T0, 'ms');

const result = await page.evaluate(() => {
  const sim = window.__game.sim;
  const dummyZ = (id) => {
    const e = [...sim.entities.values()].find((ent) => ent.templateId === id);
    return e ? { x: +e.pos.x.toFixed(2), z: +e.pos.z.toFixed(2) } : null;
  };
  return {
    normal: dummyZ('normal_boss_dummy'),
    heroic: dummyZ('heroic_boss_dummy'),
    player: { x: +sim.player.pos.x.toFixed(2), z: +sim.player.pos.z.toFixed(2) },
  };
});
console.log('result:', JSON.stringify(result));
const gap = result.heroic && result.normal ? +(result.heroic.z - result.normal.z).toFixed(2) : null;
console.log(`gap between normal and heroic boss dummy: ${gap} yd (authored: 6 yd)`);

await page.screenshot({ path: `tmp/veilbound-dummy-pull-${OUT}.png` });

await browser.close();
process.exit(0);
