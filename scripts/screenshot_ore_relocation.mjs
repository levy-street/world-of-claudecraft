// Before/after shots for the q_prof_intro ore-discoverability fix: the ore
// veins used to sit near Boar Meadow (a wolf/boar mob area with no mining
// flavor), far from the zone's only mine-themed landmark, Copper Dig. This
// drives the offline world and screenshots both spots so the PR shows the
// old empty Boar Meadow rocks next to the new, populated Copper Dig cluster.
// Needs `npm run dev` running; pass GAME_URL if vite picked a non-default port.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5174';
const OUT =
  process.env.OUT_DIR ??
  '/tmp/claude-1000/-home-jegoh-Documents-repo-world-of-claudecraft/0174d831-2820-40d0-a54b-72b455bbc917/scratchpad/ore_shots';
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
for (let attempt = 0; attempt < 4 && !booted; attempt++) {
  try {
    await page.goto(URL, { waitUntil: 'load', timeout: 45000 });
    await page.waitForSelector('#btn-offline', { timeout: 30000 });
    await new Promise((r) => setTimeout(r, 2500));
    await page.evaluate(() => document.querySelector('#btn-offline').click());
    await new Promise((r) => setTimeout(r, 400));
    await page.type('#char-name', 'Prospector');
    await page.evaluate(() => {
      document.querySelector('#offline-select .mini-class[data-class="warrior"]').click();
      document.querySelector('#btn-start-offline').click();
    });
    await page.waitForFunction(() => !!window.__game?.sim?.player, {
      timeout: 120000,
      polling: 500,
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

async function shot(name, cam, target, settleMs = 1800) {
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
  await new Promise((r) => setTimeout(r, settleMs));
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('wrote', `${OUT}/${name}.png`);
}

// BEFORE: the old ore location near Boar Meadow (x:72-78, z:-6..22), empty
// rocky ground, no ore veins, no landmark tying it to the quest text.
await shot('before_boar_meadow_no_ore', { x: 60, z: 4, h: 6 }, { x: 75, z: 5, h: 1 });

// AFTER: the new ore location clustered around the Copper Dig POI
// (x:-84, z:-64), the zone's actual mine-themed landmark.
await shot('after_copper_dig_ore', { x: -70, z: -70, h: 6 }, { x: -84, z: -64, h: 1 });

await browser.close();
console.log('done ->', OUT);
