// Screenshot each Collapsed Reliquary module to eyeball the per-module dressing.
// Offline single-player; needs npm run dev (:5173). Writes tmp/delve_mod_*.png.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync('tmp', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  protocolTimeout: 60000,
  args: [
    '--window-size=1280,820',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
  ],
  defaultViewport: { width: 1280, height: 820 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERR', e.message.slice(0, 200)));

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await sleep(800);
await page.evaluate(() => document.querySelector('#btn-offline')?.click());
await sleep(400);
await page.evaluate(() => {
  document.querySelector('#offline-select .mini-class[data-class="warrior"]')?.click();
  const n = document.querySelector('#char-name');
  if (n) n.value = 'Artcheck';
  document.querySelector('#btn-start-offline')?.click();
});
await page.waitForFunction(() => window.__game?.sim?.player, { timeout: 60000, polling: 300 });

await page.evaluate(() => {
  const sim = window.__game.sim;
  sim.setPlayerLevel(9);
  sim.enterDelve('collapsed_reliquary', 'normal');
});
await sleep(2500);

// Place the camera high and looking down the room for a clear dressing shot.
async function shotModule(mi, label) {
  // advance to module `mi` (teleport-based) and center the player.
  await page.evaluate((target) => {
    const sim = window.__game.sim;
    const run = sim.delveRunForPlayer(sim.playerId);
    while (run.moduleIndex < target && run.moduleIndex < run.modules.length - 1) {
      run.exitPortalOpen = true;
      sim.advanceDelveModule(run);
    }
  }, mi);
  await sleep(2500); // let the renderer build/settle the module interior
  // Stand mid-room near the right side and face the LEFT wall, so the chase cam
  // naturally frames the wall-side dressing (coffins / piers / statues / hoard).
  await page.evaluate(() => {
    const sim = window.__game.sim;
    const run = sim.delveRunForPlayer(sim.playerId);
    const id = run.modules[run.moduleIndex];
    const L = window.__DELVE_LAYOUTS[id];
    const zBase = window.__delveModuleZOffset(run.modules, run.moduleIndex);
    const cx = run.origin.x;
    const cz = run.origin.z + zBase + (L.zMin + L.zMax) / 2;
    const p = sim.player;
    p.pos.x = cx + 2;
    p.pos.z = cz;
    p.pos.y = 0;
    p.prevPos = { ...p.pos };
    p.facing = -Math.PI / 2; // look toward -x (the dressed left wall)
  });
  await sleep(1600); // let the chase cam swing around to the new facing
  await page.screenshot({ path: `tmp/delve_mod_${mi}_${label}.png` });
  console.log('shot', mi, label);
}

await page.evaluate(async () => {
  const dl = await import('/src/sim/delve_layout.ts');
  const data = await import('/src/sim/data.ts');
  window.__DELVE_LAYOUTS = dl.DELVE_MODULE_LAYOUTS;
  window.__delveModuleZOffset = data.delveModuleZOffset;
});

const mods = await page.evaluate(() => {
  const sim = window.__game.sim;
  return sim.delveRunForPlayer(sim.playerId).modules.slice();
});
console.log('modules:', mods.join(', '));

for (let mi = 0; mi < mods.length; mi++) {
  await shotModule(mi, mods[mi].replace('reliquary_', ''));
}

await browser.close();
console.log('done');
