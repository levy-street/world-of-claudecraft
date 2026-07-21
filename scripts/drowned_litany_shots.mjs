// Screenshot every Drowned Litany module to eyeball the redesigned rooms, the
// shallow/deep Blackwater, and the boss apse. Offline single-player; needs the
// dev server. Writes tmp/litany_*.png. Override port with GAME_URL.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5174';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync('tmp', { recursive: true });

const ALL_MODULES = [
  'litany_sluice',
  'litany_ledger',
  'litany_ring',
  'litany_baptistry',
  'litany_choir_loft',
  'litany_causeway',
  'litany_apse',
];

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
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLEERR', m.text().slice(0, 200));
});

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await sleep(800);
await page.evaluate(() => document.querySelector('#btn-offline')?.click());
await sleep(400);
await page.evaluate(() => {
  document.querySelector('#offline-select .mini-class[data-class="warrior"]')?.click();
  const n = document.querySelector('#char-name');
  if (n) n.value = 'Litanycheck';
  document.querySelector('#btn-start-offline')?.click();
});
await page.waitForFunction(() => window.__game?.sim?.player, { timeout: 60000, polling: 300 });

await page.evaluate(async () => {
  const lay = await import('/src/sim/delve_litany_layout.ts');
  const data = await import('/src/sim/data.ts');
  window.__LITANY_BOUNDS = lay.litanyModuleBounds;
  window.__delveModuleZOffset = data.delveModuleZOffset;
});

// Enter the delve, then force the full ordered module list so we can shot all 7.
await page.evaluate((mods) => {
  const sim = window.__game.sim;
  sim.setPlayerLevel(14);
  sim.enterDelve('drowned_litany', 'normal');
  const run = sim.delveRunForPlayer(sim.playerId);
  run.modules = mods.slice();
}, ALL_MODULES);
await sleep(2500);

async function shotModule(mi, label, faceY) {
  await page.evaluate((target) => {
    const sim = window.__game.sim;
    const run = sim.delveRunForPlayer(sim.playerId);
    while (run.moduleIndex < target && run.moduleIndex < run.modules.length - 1) {
      run.exitPortalOpen = true;
      sim.advanceDelveModule(run);
    }
  }, mi);
  await sleep(2600); // let the renderer build/settle the module interior
  await page.evaluate(
    ({ faceY }) => {
      const sim = window.__game.sim;
      const run = sim.delveRunForPlayer(sim.playerId);
      const id = run.modules[run.moduleIndex];
      const b = window.__LITANY_BOUNDS(id);
      const zBase = window.__delveModuleZOffset(run.modules, run.moduleIndex);
      const cx = run.origin.x;
      const cz = run.origin.z + zBase + (b.zMin + b.zMax) / 2;
      const p = sim.player;
      // stand near the entry end so the camera looks up the room over the water
      p.pos.x = cx;
      p.pos.z = run.origin.z + zBase + b.zMin + 8;
      p.pos.y = 0;
      p.prevPos = { ...p.pos };
      p.facing = faceY; // look up-room (+z)
      void cz;
    },
    { faceY },
  );
  await sleep(1700); // let the chase cam swing around
  await page.screenshot({ path: `tmp/litany_${mi}_${label}.png` });
  console.log('shot', mi, label);
}

for (let mi = 0; mi < ALL_MODULES.length; mi++) {
  await shotModule(mi, ALL_MODULES[mi].replace('litany_', ''), 0);
}

await browser.close();
console.log('done');
