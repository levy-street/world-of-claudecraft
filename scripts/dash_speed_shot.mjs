// Screenshot harness for the Dash / Loping Stride speed stacking fix.
// Boots the offline world as a level 20 druid, shifts into Cat Form, waits the
// Loping Stride out, casts Dash, then holds the real forward key for a timed
// run and stamps the measured yards (and the run-speed multiple they imply)
// on the frame beside the buff bar. Run once on the base branch (SHOT_TAG=before)
// and once on the fix (SHOT_TAG=after) with SHOT_DIR=docs/screenshots/dash-speed-stack:
// the files land as <tag>-<viewport>.png, the committed layout. The yard count is
// the evidence, the buff bar shows the same Cat Form + Dash pair both times.
// Needs a dev server (default :5173, override GAME_URL). Seeds the lowest
// graphics preset by the standing capture rule.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = `${process.env.GAME_URL ?? 'http://localhost:5173'}/?gfx=low`;
const OUT = process.env.SHOT_DIR ?? 'tmp';
const TAG = process.env.SHOT_TAG ?? 'after';
const RUN_SECONDS = 3;
const RUN_SPEED = 7; // src/sim/types.ts RUN_SPEED (yards/sec)
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

async function shoot(label, viewport, stride) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: 1 }));
  });
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  if (viewport.isMobile) {
    const cdp = await page.target().createCDPSession();
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [
        { name: 'pointer', value: 'coarse' },
        { name: 'hover', value: 'none' },
      ],
    });
  }
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await enterOfflineGame(page, {
    charClass: 'druid',
    charName: 'Dasher',
    settleMs: 3000,
    gameBootTimeoutMs: 120000,
    selectorTimeoutMs: 60000,
  });
  await page.waitForFunction(() => window.__game?.hud, { timeout: 120000 });

  // Level 20 (Dash learns at 12), Cat Form, then let the 3 s Loping Stride
  // shift sprint expire so the Dash-only frame is what the yard count measures.
  await page.evaluate(() => {
    const sim = window.__game.sim;
    sim.setPlayerLevel(20);
    sim.player.resource = sim.player.maxResource;
    sim.player.gcdRemaining = 0;
    sim.castAbility('cat_form');
  });
  await page.waitForFunction(
    () => window.__game.sim.player.auras.some((a) => a.kind === 'form_cat'),
    { timeout: 30000 },
  );
  if (stride === 'expired') {
    await page.waitForFunction(
      () => !window.__game.sim.player.auras.some((a) => a.id === 'loping_stride'),
      // Headless SwiftShader ticks the offline sim well under real time.
      { timeout: 90000, polling: 250 },
    );
  }
  await page.evaluate(() => {
    const sim = window.__game.sim;
    sim.player.gcdRemaining = 0;
    sim.castAbility('dash');
  });
  await page.waitForFunction(() => window.__game.sim.player.auras.some((a) => a.id === 'dash'), {
    timeout: 30000,
  });

  // Open ground: the spawn's forward line hits a wall about 30 yd out, so the
  // rig asks the sim's own collision resolver for a start point (nearest to
  // spawn, on the current facing) with a clear 45 yd lane ahead and teleports
  // there. The lane is measured with the same resolveMove the run uses.
  const lane = await page.evaluate(() => {
    const sim = window.__game.sim;
    const p = sim.player;
    const sin = Math.sin(p.facing);
    const cos = Math.cos(p.facing);
    const clearAhead = (x0, z0) => {
      let x = x0;
      let z = z0;
      for (let i = 0; i < 45; i++) {
        const r = sim.resolveMove(x, z, x + sin, z + cos, 0.5, p, false);
        if (Math.hypot(r.x - (x + sin), r.z - (z + cos)) > 0.01) return i;
        x = r.x;
        z = r.z;
      }
      return 45;
    };
    let best = null;
    for (let radius = 0; radius <= 160 && !best; radius += 8) {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const x = p.pos.x + radius * Math.cos(a);
        const z = p.pos.z + radius * Math.sin(a);
        if (clearAhead(x, z) >= 45) {
          best = { x, z, radius };
          break;
        }
      }
    }
    if (!best) throw new Error('no clear 45 yd lane within 160 yd of spawn');
    p.pos.x = best.x;
    p.pos.z = best.z;
    p.prevPos.x = best.x;
    p.prevPos.z = best.z;
    return best;
  });
  console.log(`lane ${label}:`, JSON.stringify(lane));
  await sleep(1500);

  // The real forward bind, held for a timed run: the yards come from the sim's
  // own integrator, never from moveSpeedMult read back.
  // Timed in SIM ticks (20 Hz), not wall-clock: headless SwiftShader runs the
  // frame loop, and so the offline sim, well under real time.
  const snap = () =>
    page.evaluate(() => ({ ...window.__game.sim.player.pos, tick: window.__game.sim.tickCount }));
  const rest = await snap();
  await page.keyboard.down('KeyW');
  // The clock starts on the first tick that actually moves, so the input
  // latency between key-down and the sim reading the intent never counts.
  await page.waitForFunction(
    (r) => {
      const q = window.__game.sim.player.pos;
      return Math.hypot(q.x - r.x, q.z - r.z) > 0.05;
    },
    { timeout: 30000, polling: 20 },
    rest,
  );
  const start = await snap();
  await page.waitForFunction(
    (t0, ticks) => window.__game.sim.tickCount >= t0 + ticks,
    { timeout: 120000, polling: 50 },
    start.tick,
    RUN_SECONDS * 20,
  );
  const end = await snap();
  await page.keyboard.up('KeyW');
  const seconds = (end.tick - start.tick) / 20;
  const yards = Math.hypot(end.x - start.x, end.z - start.z);
  const mult = yards / (RUN_SPEED * seconds);
  const auras = await page.evaluate(() =>
    window.__game.sim.player.auras.map((a) => `${a.id}:${a.kind}:${a.value}`),
  );
  console.log(
    `REPORT ${label} ${TAG}: ${yards.toFixed(1)} yd in ${seconds}s = ${(mult * 100).toFixed(0)}% run speed`,
    auras,
  );

  // Evidence stamp (capture-only DOM, never shipped): the measured run.
  await page.evaluate(
    (text) => {
      const el = document.createElement('div');
      el.id = 'dash-speed-stamp';
      el.textContent = text;
      Object.assign(el.style, {
        position: 'fixed',
        top: '12px',
        left: '50%',
        transform: 'translateX(-50%)',
        padding: '8px 14px',
        background: 'rgba(0,0,0,0.78)',
        color: '#ffd76a',
        font: '600 18px/1.3 system-ui, sans-serif',
        border: '1px solid #ffd76a',
        borderRadius: '6px',
        zIndex: 99999,
        pointerEvents: 'none',
      });
      document.body.appendChild(el);
    },
    `Cat Form + Dash: ran ${yards.toFixed(1)} yd in ${seconds} s = ${(mult * 100).toFixed(0)}% of run speed (${TAG})`,
  );
  await sleep(300);
  await page.screenshot({ path: `${OUT}/${TAG}-${label}.png` });
  fs.writeFileSync(
    `${OUT}/${TAG}-${label}-report.json`,
    JSON.stringify({ yards, seconds, mult, auras }, null, 2),
  );
  await page.close();
}

await shoot('desktop', { width: 1600, height: 900, deviceScaleFactor: 1 }, 'expired');
await shoot(
  'mobile',
  { width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  'expired',
);
await browser.close();
