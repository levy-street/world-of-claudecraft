// Verification + screenshot harness for "character model snaps/rotates wrongly".
//
// Boots the offline world as a warrior at max graphics (?gfx=ultra). Then drives
// the renderer directly to reproduce the camera-driven facing override: it seeds
// the self model at facing 0 (override disengaged), then engages the override at
// a target ~180deg away (the camera orbited fully behind) and samples the self
// model's group.rotation.y per sync() call. With the fix the per-frame yaw change
// is capped (smooth turn); before the fix the first frame jumped the whole ~PI
// gap (the instant backward snap). Calls run inside one synchronous evaluate so
// the rAF loop cannot interleave and re-seed mid-measurement.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = (process.env.GAME_URL ?? 'http://localhost:5173') + '/?gfx=ultra';
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900, deviceScaleFactor: 2 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE:', m.text()); });

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('#btn-offline', { timeout: 60000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await sleep(300);
await page.type('#char-name', 'Turnwyn');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await page.waitForFunction(() => window.__game?.hud && window.__game?.renderer, { timeout: 60000 });
await sleep(2500);

const result = await page.evaluate(() => {
  const g = window.__game;
  const r = g.renderer;
  const id = g.world.player.id;
  const grp = r.views.get(id)?.group;
  if (!grp) return { error: 'no self view' };
  const p = g.world.player;
  // Seed: model facing 0, override disengaged.
  p.facing = 0; p.prevFacing = 0;
  r.sync(1, 1 / 60, null);
  const start = grp.rotation.y;
  // Engage the override ~180deg behind (camera orbited fully around) and sample.
  const target = Math.PI * 0.99;
  const deltas = [];
  let prev = grp.rotation.y;
  for (let i = 0; i < 60; i++) {
    r.sync(1, 1 / 60, target);
    const cur = grp.rotation.y;
    let d = cur - prev;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    deltas.push(Math.abs(d));
    prev = cur;
  }
  const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  return {
    start,
    target,
    firstFrameDelta: deltas[0],
    maxFrameDelta: Math.max(...deltas),
    framesToTurn: deltas.filter((d) => d > 1e-5).length,
    finalGap: Math.abs(wrap(prev - target)),
  };
});

console.log('=== facing snap verification (ultra build) ===');
console.log(JSON.stringify(result, null, 2));
const cap = 10 / 60; // SELF_TURN_MAX_RATE / 60Hz
const ok = result.firstFrameDelta !== undefined
  && result.firstFrameDelta <= cap + 1e-6
  && result.maxFrameDelta <= cap + 1e-6
  && result.framesToTurn > 1
  && result.finalGap < 1e-3;
console.log('PASS:', ok, `(per-frame cap ${cap.toFixed(4)} rad; a teleport would be ~${(Math.PI).toFixed(2)} rad)`);

// Max-graphics in-world screenshot of the character.
await page.evaluate(() => {
  // tuck the camera in behind for a clean character framing if knobs are public
  const r = window.__game.renderer;
  if ('camDist' in r) r.camDist = 14;
  if ('camPitch' in r) r.camPitch = 0.28;
});
await sleep(800);
await page.screenshot({ path: 'tmp/facing-snap-ultra.png' });
console.log('screenshot -> tmp/facing-snap-ultra.png');

await browser.close();
process.exit(ok ? 0 : 1);
