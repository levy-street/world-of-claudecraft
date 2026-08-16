// Smoke proof for the Rallycart RXT: boots the offline game, grants its
// ignition key, rides it, and screenshots it parked and mid-run. Verifies the
// GLB actually loads and the clips resolve in the real renderer, which no unit
// test covers.
//   node scripts/rallycart_shot.mjs   (needs `npm run dev`; GAME_URL overrides)
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
fs.mkdirSync('tmp', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
page.on('console', (m) => {
  const t = m.text();
  if (/rallycart|mount|glb|error/i.test(t)) console.log('CONSOLE:', t.slice(0, 200));
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jsClick = (sel) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) throw new Error(`missing ${s}`);
    el.click();
  }, sel);

await page.goto(URL, { waitUntil: 'load', timeout: 90000 });
await page.waitForSelector('#btn-offline', { timeout: 90000 });
await sleep(400);
await jsClick('#btn-offline');
await sleep(300);
await page.type('#char-name', 'Driver');
await jsClick('#offline-select .mini-class[data-class="warrior"]');
await jsClick('#btn-start-offline');
await page.waitForFunction(() => window.__game?.sim?.player, { timeout: 40000 });
await sleep(2000);

await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) =>
    /skip tutorial/i.test(b.textContent || ''),
  );
  btn?.click();
});
await sleep(400);
await page.waitForFunction(
  () => getComputedStyle(document.querySelector('#ui')).display !== 'none',
  { timeout: 20000, polling: 250 },
);

await page.evaluate(() => {
  const sim = window.__game.sim;
  sim.setPlayerLevel(20, sim.playerId);
  // Riding is a trained skill bought from Marla; grant it directly for the shot.
  const meta = sim.meta ?? null;
  if (meta) {
    meta.ridingTrained = true;
    meta.mountTrainingFeePaid = true;
  }
  sim.addItem('reins_rallycart_rxt', 1);
  // Mounts are usable ITEMS on this branch, not a stored "selected mount":
  // using the reins summons it (sim.ts: useItem -> summonMountItem).
  sim.useItem('reins_rallycart_rxt', sim.playerId);
});
// Summoning is a CHANNEL, not instant: the mount appears on its completion
// edge, so this has to wait rather than re-issue the use every poll.
await sleep(1000);
await page.waitForFunction(
  () => window.__game.sim.player.mountKey === 'rallycart_rxt',
  { timeout: 30000, polling: 400 },
);
await page.waitForFunction(
  () => !!window.__game.renderer?.views?.get(window.__game.sim.playerId)?.mountVisual,
  { timeout: 30000, polling: 300 },
);
await sleep(1200);
await page.screenshot({ path: 'tmp/rallycart_parked.png' });
console.log('parked: tmp/rallycart_parked.png');

await page.keyboard.down('w');
await sleep(1100);
await page.screenshot({ path: 'tmp/rallycart_run.png' });
await sleep(700);
await page.screenshot({ path: 'tmp/rallycart_run2.png' });
await page.keyboard.up('w');
console.log('run: tmp/rallycart_run.png, tmp/rallycart_run2.png');

await page.keyboard.down('s');
await sleep(1000);
await page.screenshot({ path: 'tmp/rallycart_reverse.png' });
await page.keyboard.up('s');
console.log('reverse: tmp/rallycart_reverse.png');

console.log(
  'state:',
  await page.evaluate(() => {
    const sim = window.__game.sim;
    const v = window.__game.renderer?.views?.get(sim.playerId);
    return {
      mountKey: sim.player.mountKey,
      mountVisual: !!v?.mountVisual,
      mountLift: v?.mountLift,
      clips: v?.mountVisual?.clipNames?.() ?? null,
    };
  }),
);
await browser.close();
