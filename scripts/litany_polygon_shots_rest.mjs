// Cover the Drowned Litany modules the first tour's roll missed (baptistry,
// choir_loft, causeway): re-enter the delve until each has appeared, then
// screenshot it. Needs npm run dev (:5173). Writes tmp/litany_poly_*.png.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const WANT = new Set(['litany_baptistry', 'litany_choir_loft', 'litany_causeway']);
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

await page.evaluate(async () => {
  const dl = await import('/src/sim/delve_layout.ts');
  const data = await import('/src/sim/data.ts');
  window.__DELVE_LAYOUTS = dl.DELVE_MODULE_LAYOUTS;
  window.__delveModuleZOffset = data.delveModuleZOffset;
  window.__game.sim.setPlayerLevel(14);
});

async function shotModule(mi, label) {
  await page.evaluate((target) => {
    const sim = window.__game.sim;
    const run = sim.delveRunForPlayer(sim.playerId);
    while (run.moduleIndex < target && run.moduleIndex < run.modules.length - 1) {
      run.exitPortalOpen = true;
      sim.advanceDelveModule(run);
    }
  }, mi);
  await sleep(2500);
  await page.evaluate(() => {
    const sim = window.__game.sim;
    const run = sim.delveRunForPlayer(sim.playerId);
    const id = run.modules[run.moduleIndex];
    const L = window.__DELVE_LAYOUTS[id];
    const zBase = window.__delveModuleZOffset(run.modules, run.moduleIndex);
    const p = sim.player;
    p.pos.x = run.origin.x + 2;
    p.pos.z = run.origin.z + zBase + (L.zMin + L.zMax) / 2;
    p.pos.y = 0;
    p.prevPos = { ...p.pos };
    p.facing = -Math.PI / 2;
  });
  await sleep(1600);
  await page.screenshot({ path: `tmp/litany_poly_${label}_wall.png` });
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
    p.facing = 0;
  });
  await sleep(1600);
  await page.screenshot({ path: `tmp/litany_poly_${label}_room.png` });
  console.log('shot', label);
}

// The offline module roll is seed-deterministic (always the same 3 trash rooms),
// so force the run's module list to the three rooms the first tour missed. The
// renderer builds interiors from run.modules on its next frame, so overriding in
// the same evaluate as enterDelve means only the forced rooms are ever built.
const mods = await page.evaluate(
  (want) => {
    const sim = window.__game.sim;
    sim.enterDelve('drowned_litany', 'normal');
    const run = sim.delveRunForPlayer(sim.playerId);
    run.modules = [...want, 'litany_apse'];
    return run.modules.slice();
  },
  [...WANT],
);
console.log('forced modules:', mods.join(', '));
await sleep(3500);
for (let mi = 0; mi < mods.length - 1; mi++) {
  await shotModule(mi, mods[mi].replace('litany_', ''));
}
await browser.close();
console.log('done');
