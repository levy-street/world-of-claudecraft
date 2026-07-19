// Visual proof of the Phase 4 gather feedback (Professions 2.0): the
// rarity-colored "You gather:" line the gatherResult event renders next to the
// grant hub's "You receive:" loot line, and the pristine-vein zone broadcast
// with its five-fold signed yield. Boots the offline game, teleports next to a
// real ore node, harvests once normally (shot 1), then forces the rare-event
// draw to hit and harvests again (shot 2).
//   node scripts/gather_feedback_shot.mjs    (needs `npm run dev` on :5173)
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
fs.mkdirSync('docs/screenshots', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await enterOfflineGame(page, { charClass: 'warrior', charName: 'Gatherer', settleMs: 3000 });
await page.evaluate(() => document.querySelector('#gpu-notice')?.remove());

// The ore node sits in a Deeprock Digger camp that shreds a level 1 warrior
// before the screenshot lands; a few levels keep the shot corpse-free.
await page.evaluate(() => {
  window.__game.sim.chat('/dev level 12');
});

// Teleport next to the eastbrook ore node and harvest once: the chat log shows
// the grant hub's "You receive:" loot line plus the new rarity-colored
// "You gather:" line from gatherResult. Teleport and harvest run in ONE
// evaluate: between separate evaluates the sim keeps ticking and the player
// can drift back out of INTERACT_RANGE.
const normal = await page.evaluate(() => {
  const sim = window.__game.sim;
  sim.chat('/dev tp -70 -52');
  return { granted: sim.harvestNode('ore_eastbrook_1') };
});
console.log('normal harvest:', JSON.stringify(normal));
await new Promise((r) => setTimeout(r, 800));
await page.screenshot({ path: 'docs/screenshots/pr-phase04-gather-line.png' });
console.log('captured docs/screenshots/pr-phase04-gather-line.png');

// Force the rare-event roll (resolveHarvest draw #2) to hit for one harvest:
// the pristine-vein broadcast line, the five signed copper grants, and the
// x5 gather line land together. Direct state manipulation is the shot-script
// house style; the rng patch restores itself after the second draw.
const vein = await page.evaluate(() => {
  const sim = window.__game.sim;
  sim.chat('/dev tp -70 -52');
  const meta = sim.players.get(sim.player.id);
  delete meta.nodeHarvestReadyAt.ore_eastbrook_1;
  const rng = sim.rng;
  const orig = rng.next.bind(rng);
  let calls = 0;
  rng.next = () => {
    calls++;
    const v = orig();
    if (calls === 2) {
      rng.next = orig;
      return 0; // below GATHER_RARE_EVENT_CHANCE: a guaranteed pristine vein
    }
    return v;
  };
  const granted = sim.harvestNode('ore_eastbrook_1');
  rng.next = orig;
  return { granted, calls };
});
console.log('pristine vein harvest:', JSON.stringify(vein));
await new Promise((r) => setTimeout(r, 800));
await page.screenshot({ path: 'docs/screenshots/pr-phase04-pristine-vein.png' });
console.log('captured docs/screenshots/pr-phase04-pristine-vein.png');

await browser.close();
