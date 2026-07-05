// Visual capture for the OSRS-style click-feedback marker (ring + crossed "X").
// Boots the offline game at MAX graphics (?gfx=ultra), drops a neutral (gold)
// marker and a hostile (red) marker in front of the player via the renderer, and
// screenshots the world canvas mid-animation. Needs `npm run dev` on :5173.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = (process.env.GAME_URL ?? 'http://localhost:5173') + '/?gfx=ultra';
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: EDGE, headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
const clk = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);
await page.waitForSelector('#btn-offline', { timeout: 20000 });
await clk('#btn-offline');
await sleep(300);
await page.type('#char-name', 'Marker');
await clk('#offline-select .mini-class[data-class="warrior"]');
await sleep(150);
await clk('#btn-start-offline');
// Ultra graphics on software GL loads slowly, so poll generously for the game globals.
await page.waitForFunction(() => window.__game && window.__game.renderer && window.__game.sim, { timeout: 60000, polling: 500 });
await sleep(2500);

// Tilt the camera down a touch so the ground marker is clearly in view, and pick
// a spot a few yards in front of the player on open ground.
const spot = await page.evaluate(() => {
  const g = window.__game, p = g.sim.player;
  g.renderer.camPitch = 0.62;
  g.renderer.camDist = 9;
  const fx = p.pos.x + 4, fz = p.pos.z + 4;
  return { fx, fz };
});

// Keep markers fresh across the capture window by re-stamping each frame: the
// marker lives ~0.5s, so without this it would fade before the screenshot.
async function captureMarker(hostile, path, label) {
  const handle = await page.evaluateHandle(({ fx, fz, hostile }) => {
    const g = window.__game;
    const id = setInterval(() => {
      // Re-stamp slightly behind the live one so the X+ring read at full strength.
      g.renderer.spawnClickMarker(fx, fz, hostile);
    }, 90);
    return id;
  }, { fx: spot.fx, fz: spot.fz, hostile });
  await sleep(260); // let a couple of frames render the ring expanding + X stamped
  await page.screenshot({ path });
  await page.evaluate((id) => clearInterval(id), handle);
  await handle.dispose();
  await sleep(700); // let existing markers fade out before the next capture
  console.log('shot:', label, '→', path);
}

await captureMarker(false, 'tmp/click_marker_neutral.png', 'neutral (gold)');
await captureMarker(true, 'tmp/click_marker_hostile.png', 'hostile (red)');

await browser.close();
console.log('done');
