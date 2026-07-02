// Screenshot each Drowned Litany module to eyeball the polygon shells, marsh
// dressing, and winding pools. Offline single-player; needs npm run dev (:5173).
// Writes tmp/litany_poly_*.png.

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
  sim.setPlayerLevel(14);
  sim.enterDelve('drowned_litany', 'normal');
});
await sleep(3000);

await page.evaluate(async () => {
  const dl = await import('/src/sim/delve_layout.ts');
  const data = await import('/src/sim/data.ts');
  window.__DELVE_LAYOUTS = dl.DELVE_MODULE_LAYOUTS;
  window.__delveModuleZOffset = data.delveModuleZOffset;
});

// Two shots per module: a mid-room wall-facing shot (dressing + wall band) and a
// down-room shot from the entrance (polygon silhouette + pools reading down the room).
async function shotModule(mi, label) {
  await page.evaluate((target) => {
    const sim = window.__game.sim;
    const run = sim.delveRunForPlayer(sim.playerId);
    while (run.moduleIndex < target && run.moduleIndex < run.modules.length - 1) {
      run.exitPortalOpen = true;
      sim.advanceDelveModule(run);
    }
  }, mi);
  await sleep(2500); // let the renderer build/settle the module interior

  // Shot A: stand mid-room right of center, face the left wall (dressing band).
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
    p.facing = -Math.PI / 2;
  });
  await sleep(1600);
  await page.screenshot({ path: `tmp/litany_poly_${mi}_${label}_wall.png` });

  // Shot B: stand near the entrance end on the centerline, face down the room
  // (+z) so the polygon shell's angled walls and the pools read in one frame.
  await page.evaluate(() => {
    const sim = window.__game.sim;
    const run = sim.delveRunForPlayer(sim.playerId);
    const id = run.modules[run.moduleIndex];
    const L = window.__DELVE_LAYOUTS[id];
    const zBase = window.__delveModuleZOffset(run.modules, run.moduleIndex);
    const p = sim.player;
    p.pos.x = run.origin.x;
    p.pos.z = run.origin.z + zBase + L.zMin + 4;
    p.pos.y = 0;
    p.prevPos = { ...p.pos };
    p.facing = 0; // face +z, down the room
  });
  await sleep(1600);
  await page.screenshot({ path: `tmp/litany_poly_${mi}_${label}_room.png` });
  console.log('shot', mi, label);
}

const mods = await page.evaluate(() => {
  const sim = window.__game.sim;
  return sim.delveRunForPlayer(sim.playerId).modules.slice();
});
console.log('modules:', mods.join(', '));

for (let mi = 0; mi < mods.length; mi++) {
  await shotModule(mi, mods[mi].replace('litany_', ''));
}

await browser.close();
console.log('done');
