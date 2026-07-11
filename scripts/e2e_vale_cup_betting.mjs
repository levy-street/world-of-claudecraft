// Visual probe of the Vale Cup SPECTATOR betting experience on the OFFLINE
// client: stage an idle bot-vs-bot showcase at the Sowfield, stand the player in
// the stands (a spectator, not a participant), and capture the betting banner,
// the expanded card, and the state after placing a wager. Needs `npm run dev`.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = process.env.SHOT_DIR ?? 'tmp/vcup_bet_e2e';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  protocolTimeout: 120000,
  args: [
    '--no-sandbox',
    '--window-size=1600,900',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

await page.goto(`${URL}/?gfx=high`, { waitUntil: 'networkidle0', timeout: 60000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await sleep(400);
await page.type('#char-name', 'Punter');
await page.evaluate(() => {
  document.querySelector('#offline-select .mini-class[data-class="warrior"]').click();
  document.querySelector('#btn-start-offline').click();
});
await page.waitForFunction(() => Boolean(window.__game?.sim), { timeout: 60000, polling: 500 });
await sleep(1500);

async function shot(name, waitMs = 700) {
  await sleep(waitMs);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('wrote', `${OUT}/${name}.png`);
}

// Stand in the stands at the Sowfield and force the idle showcase to fire now.
await page.evaluate(() => {
  const sim = window.__game.sim;
  const me = sim.entities.get(sim.primaryId);
  me.pos.x = -11;
  me.pos.z = -94; // just north of the pitch, inside the Sowfield footprint
  me.prevPos = { ...me.pos };
  sim.players.get(sim.primaryId).copper = 500000; // 50g to wager with (probe only)
  sim.vcup.lastActivityAt = sim.time - 100; // trip the 60s idle timer immediately
});
// Let the showcase spawn + the briefing open, then confirm we are a spectator.
await page.waitForFunction(() => Boolean(window.__game?.sim?.cupInfo?.spectate), {
  timeout: 15000,
  polling: 300,
});
const info = await page.evaluate(() => {
  const s = window.__game.sim.cupInfo.spectate;
  return { phase: s.phase, nationA: s.nationA, nationB: s.nationB, teamA: s.teamA.length };
});
console.log('CHECK spectator view:', JSON.stringify(info));
await shot('bet1_banner');

// Expand the full card.
await page.evaluate(() => document.querySelector('.vcupbet-toggle')?.click());
await shot('bet2_card');

// Place a few wagers on side A, then peek at the pool + my bet.
await page.evaluate(() => {
  const btns = document.querySelectorAll('.vcupbet-stakes-a button[data-stake]');
  btns[1]?.click(); // 1s
  btns[2]?.click(); // 10s
});
await sleep(600);
const bets = await page.evaluate(() => {
  const b = window.__game.sim.cupInfo.spectate.bets;
  return { poolA: b.poolA, poolB: b.poolB, myStake: b.myStake, mySide: b.mySide };
});
console.log('CHECK after wager:', JSON.stringify(bets));
await shot('bet3_after_wager', 1500);

console.log('done');
await browser.close();
