// Hypothesis test: if dungeon GLBs fail to load, is the delve permanently black
// and does it ever retry? Aborts the FIRST load of each dungeon glb, then allows
// later loads, to see whether the memoized ensureDungeonAssets() poisons forever.

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
  args: ['--window-size=1280,760', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1280, height: 760 },
});
const page = await browser.newPage();
await page.setRequestInterception(true);
const failedOnce = new Set();
let aborted = 0,
  allowed = 0;
page.on('request', (req) => {
  const u = req.url();
  if (/models\/dungeon\/.*\.glb/.test(u)) {
    if (!failedOnce.has(u)) {
      failedOnce.add(u);
      aborted++;
      return void req.abort('failed');
    }
    allowed++;
    return void req.continue();
  }
  req.continue();
});

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.click('#btn-offline');
await sleep(200);
await page.type('#char-name', 'Probe');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await sleep(2000);

await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const p = sim.player;
  p.level = 12;
  sim.enterDelve('collapsed_reliquary', 'normal');
  const run = sim.delveRun;
  const wx = run.origin.x + 22,
    wz = run.origin.z + 8 + 25;
  p.pos.x = wx;
  p.pos.z = wz;
  p.prevPos.x = wx;
  p.prevPos.z = wz;
  g.input.camYaw = Math.PI / 2;
  g.input.camPitch = 0.32;
  g.input.camDist = 12;
});

for (let i = 0; i < 16; i++) {
  await sleep(500);
  const s = await page.evaluate(() => {
    const r = window.__game.renderer;
    const census = [];
    r.scene.traverse((o) => {
      if (o.isInstancedMesh && o.position && o.parent?.position?.x > 3000) census.push(1);
    });
    return {
      built: [...(r.builtInteriors ?? [])].length,
      pending: [...(r.pendingInteriors ?? [])].length,
      instanced: census.length,
    };
  });
  console.log(
    `t=${((i + 1) * 0.5).toFixed(1)}s built=${s.built} pending=${s.pending} instancedNear=${s.instanced} (aborted=${aborted} allowedRetry=${allowed})`,
  );
}
await page.screenshot({ path: 'tmp/delve_assetfail.png' });
console.log(`aborted first-loads=${aborted}, allowed retries=${allowed}`);
await browser.close();
