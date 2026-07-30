// Live-client proof: a choice-row pick grants a real castable spell in the running game.
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=1280,800', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1280, height: 800 },
});
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://localhost:5173', { waitUntil: 'networkidle0', timeout: 180000 });
await page.waitForSelector('#btn-offline', { timeout: 60000 });
await page.evaluate(() => document.querySelector('#btn-offline')?.click());
await sleep(400);
await page.waitForSelector('#char-name', { timeout: 30000 });
await page.type('#char-name', 'Rowtester');
await page.evaluate(() =>
  document.querySelector(`#offline-select .mini-class[data-class="warrior"]`)?.click(),
);
await sleep(300);
await page.evaluate(() => document.querySelector('#btn-start-offline')?.click());
await page.waitForFunction(() => window.__game?.sim?.player, { timeout: 60000 });
await sleep(1200);
const result = await page.evaluate(() => {
  const sim = window.__game.sim;
  sim.setPlayerLevel(20);
  document.querySelector('#tutorial-hint .btn, #tutorial-hint button')?.click();
  // pick three rows live: r14 Bladed Gyre grant, r5 whatever, r20
  const before = !!sim.resolvedAbility('whirlwind');
  sim.applyTalents({ spec: 'arms', ranks: {}, choices: {}, rows: { 14: 'war_r14_whirlwind' } });
  const after = sim.resolvedAbility('whirlwind');
  const me = sim.player;
  me.resource = me.maxResource;
  me.gcdRemaining = 0;
  sim.castAbility('whirlwind');
  for (let i = 0; i < 3; i++) sim.tick();
  const persisted = sim.serializeCharacter(sim.playerId);
  return {
    knownBefore: before,
    grantedName: after?.def?.name ?? null,
    rowsApplied: JSON.stringify(sim.talents.rows),
    persistedRows: JSON.stringify(persisted?.talents?.rows),
    signature: sim.resolvedAbility('mortal_strike')?.def?.name ?? null,
  };
});
console.log(JSON.stringify(result, null, 1));
console.log('pageErrors:', errs.length ? errs.slice(0, 2) : 'none');
await browser.close();
