// Take a single named screenshot of the offline world at a fixed editor-cam
// pose. Run once per shot (node scripts/screenshot_one_gather_shot.mjs <name>
// <camX> <camZ> <camH> <tgtX> <tgtZ> <tgtH>) so a slow/contended machine only
// has to keep one boot alive at a time instead of a long multi-shot batch.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const [, , name, camX, camZ, camH, tgtX, tgtZ, tgtH] = process.argv;
if (!name) {
  console.error(
    'usage: node scripts/screenshot_one_gather_shot.mjs <name> <camX> <camZ> <camH> <tgtX> <tgtZ> <tgtH>',
  );
  process.exit(1);
}
const cam = { x: Number(camX), z: Number(camZ), h: Number(camH) };
const target = { x: Number(tgtX), z: Number(tgtZ), h: Number(tgtH) };

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT =
  process.env.OUT_DIR ??
  '/tmp/claude-1000/-home-jegoh-Documents-repo-world-of-claudecraft/0174d831-2820-40d0-a54b-72b455bbc917/scratchpad/zone_gather_shots';
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

let booted = false;
for (let attempt = 0; attempt < 5 && !booted; attempt++) {
  try {
    await page.goto(URL, { waitUntil: 'load', timeout: 90000 });
    await page.waitForSelector('#btn-offline', { timeout: 60000 });
    await new Promise((r) => setTimeout(r, 2500));
    await page.evaluate(() => document.querySelector('#btn-offline').click());
    await new Promise((r) => setTimeout(r, 400));
    await page.type('#char-name', 'Prospector');
    await page.evaluate(() => {
      document.querySelector('#offline-select .mini-class[data-class="warrior"]').click();
      document.querySelector('#btn-start-offline').click();
    });
    await page.waitForFunction(() => !!window.__game?.sim?.player, {
      timeout: 180000,
      polling: 1000,
    });
    booted = true;
  } catch (err) {
    console.log(`boot attempt ${attempt + 1} failed:`, err.message);
  }
}
if (!booted) {
  await browser.close();
  throw new Error('could not boot the offline world');
}
await new Promise((r) => setTimeout(r, 2500));
await page.evaluate(() => {
  const skip = [...document.querySelectorAll('button')].find((b) =>
    (b.textContent || '').includes('Skip Tutorial'),
  );
  skip?.click();
});

await page.evaluate(
  async (c, t) => {
    const g = window.__game;
    const p = g.sim.player;
    p.maxHp = 99999;
    p.hp = 99999;
    p.pos.x = c.x;
    p.pos.z = c.z;
    p.prevPos.x = c.x;
    p.prevPos.z = c.z;
    await new Promise((r) => setTimeout(r, 250));
    const gy = p.pos.y;
    const dx = t.x - c.x;
    const dz = t.z - c.z;
    const dl = Math.hypot(dx, dz) || 1;
    p.pos.x = c.x - (dx / dl) * 3;
    p.pos.z = c.z - (dz / dl) * 3;
    p.prevPos.x = p.pos.x;
    p.prevPos.z = p.pos.z;
    g.renderer.editorCam = {
      pos: { x: c.x, y: gy + c.h, z: c.z },
      target: { x: t.x, y: gy + t.h, z: t.z },
    };
  },
  cam,
  target,
);
await new Promise((r) => setTimeout(r, 1800));
await page.screenshot({ path: `${OUT}/${name}.png` });
console.log('wrote', `${OUT}/${name}.png`);

await browser.close();
