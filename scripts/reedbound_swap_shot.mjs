// One-off verification shot for the Reedbound Acolyte -> Stone Cantor model swap:
// boots the offline world, enters The Drowned Litany, walks the player up to the
// first Reedbound Acolyte, and captures it idle and then mid-cast (it is a ranged
// caster, so aggro means casting). Needs the dev server (GAME_URL, default :5175).
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5175';
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
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLEERR', m.text().slice(0, 200));
});

await page.goto(URL + '/?gfx=ultra', { waitUntil: 'domcontentloaded', timeout: 30000 });
await sleep(800);
await page.evaluate(() => document.querySelector('#btn-offline')?.click());
await sleep(400);
await page.evaluate(() => {
  document.querySelector('#offline-select .mini-class[data-class="warrior"]')?.click();
  const n = document.querySelector('#char-name');
  if (n) n.value = 'Swapcheck';
  document.querySelector('#btn-start-offline')?.click();
});
await page.waitForFunction(() => window.__game?.sim?.player, { timeout: 60000, polling: 300 });

await page.evaluate(() => {
  const sim = window.__game.sim;
  sim.setPlayerLevel(14);
  sim.enterDelve('drowned_litany', 'normal');
});
await sleep(2500);

// Advance modules until a live Reedbound Acolyte exists, then stand near it.
const found = await page.evaluate(() => {
  const sim = window.__game.sim;
  const run = sim.delveRunForPlayer(sim.playerId);
  for (let hop = 0; hop < 8; hop++) {
    const aco = [...sim.entities.values()].find(
      (e) => e.templateId === 'reedbound_acolyte' && !e.dead,
    );
    if (aco) return { module: run.modules[run.moduleIndex], x: aco.pos.x, z: aco.pos.z };
    if (run.moduleIndex >= run.modules.length - 1) break;
    run.exitPortalOpen = true;
    sim.advanceDelveModule(run);
  }
  return null;
});
if (!found) {
  console.log('NO reedbound_acolyte found');
  process.exit(1);
}
console.log('found acolyte in module', found.module);
await sleep(2600); // let the renderer settle the module

async function standNear(dist) {
  await page.evaluate(
    ({ dist }) => {
      const sim = window.__game.sim;
      const aco = [...sim.entities.values()].find(
        (e) => e.templateId === 'reedbound_acolyte' && !e.dead,
      );
      const p = sim.player;
      p.pos.x = aco.pos.x;
      p.pos.z = aco.pos.z + dist;
      p.pos.y = aco.pos.y;
      p.prevPos = { ...p.pos };
      p.facing = Math.PI; // face -Z, toward the acolyte
      window.__game.camera?.snapBehindPlayer?.();
    },
    { dist },
  );
}

// Clean shots: hide the HUD chrome so the model fills the frame.
await page.addStyleTag({
  content: '#ui { display: none !important; }',
});

// Verification shots read better bright: the delve is intentionally murky.
await page.evaluate(() => {
  const r = window.__game.renderer;
  r.baseExposure = (r.baseExposure ?? 1) * 3.2;
});

// Shot 1: idle, just outside aggro range.
await standNear(8);
await sleep(2000);
await page.screenshot({ path: 'tmp/reedbound_swap_idle.png' });

// Shot 2: step into range and wait for the moment a cast is actually in flight.
await standNear(4);
const state = await page.evaluate(async () => {
  const sim = window.__game.sim;
  const find = () =>
    [...sim.entities.values()].find((e) => e.templateId === 'reedbound_acolyte' && !e.dead);
  const t0 = performance.now();
  while (performance.now() - t0 < 10000) {
    const aco = find();
    if (!aco) return { gone: true };
    if (aco.casting) return { aggro: aco.aggroTargetId, cast: aco.casting?.name ?? true };
    await new Promise((r) => setTimeout(r, 80));
  }
  const aco = find();
  return { aggro: aco?.aggroTargetId ?? null, cast: false };
});
console.log('acolyte state:', JSON.stringify(state));
await sleep(350); // let the cast pose land a few frames
await page.screenshot({ path: 'tmp/reedbound_swap_cast.png' });
console.log('wrote tmp/reedbound_swap_idle.png and tmp/reedbound_swap_cast.png');
await browser.close();
