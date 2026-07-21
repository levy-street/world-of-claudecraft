// Visual proof of the Mana Sear on-hit affix: a Wyrmcult Necromancer drains a
// mage's mana on a landed swing. Boots the offline client as a mage, spawns a
// necromancer next to the player, forces its Mana Sear to land, and captures the
// player unit frame (mana bar dropping) + combat log line.
//
// Run the dev client first:  npx vite --port 5180 --strictPort &
// then:  GAME_URL=http://localhost:5180 node scripts/mana_burn_visual.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5180';
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  protocolTimeout: 60000,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1320,820', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1320, height: 820 },
});

const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await sleep(800);

// Offline entry as a MAGE (mana user).
await page.evaluate(() => {
  document.querySelector('#btn-offline').click();
  document.querySelector('#char-name').value = 'Lyra';
  document.querySelector('#offline-select .mini-class[data-class="mage"]').click();
  document.querySelector('#btn-start-offline').click();
});
await page.waitForFunction(() => window.__game?.sim && document.querySelector('#minimap-wrap'), { timeout: 20000, polling: 300 });
await sleep(1500);

// Level the mage up so it survives a level-18 necromancer's swing, then spawn the
// necromancer right next to it and force Mana Sear to land.
const result = await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const p = sim.player;
  sim.setPlayerLevel(20);
  const before = { res: Math.round(p.resource), max: Math.round(p.maxResource) };

  // Build a Wyrmcult Necromancer beside the player. Private modules are reachable
  // at runtime; createMob/MOBS come off the sim's own imports via a tiny eval-free
  // path: reuse an existing entity as the carrier by retemplating it.
  let necro = [...sim.entities.values()].find((e) => e.kind === 'mob' && e.templateId === 'wyrmcult_necromancer' && !e.dead);
  if (!necro) {
    // retemplate the nearest living mob into a necromancer carrier
    necro = [...sim.entities.values()].find((e) => e.kind === 'mob' && !e.dead);
    if (necro) { necro.templateId = 'wyrmcult_necromancer'; necro.name = 'Wyrmcult Necromancer'; necro.level = 18; }
  }
  if (necro) {
    necro.pos = { x: p.pos.x + 2, y: p.pos.y, z: p.pos.z + 2 };
    necro.hostile = true;
    sim.targetEntity(necro.id, p.id);
  }

  // Force a few Mana Sear procs for a clearly visible dip (keep the mage alive by
  // topping its real HP each swing — no fake HP override, so the frame reads true).
  let procs = 0;
  for (let i = 0; i < 200 && procs < 4; i++) {
    p.hp = p.maxHp;
    const r0 = p.resource;
    sim.mobSwing(necro, p);
    if (p.resource < r0) procs++;
  }
  p.hp = p.maxHp;
  return { before, after: { res: Math.round(p.resource), max: Math.round(p.maxResource) }, procs, necro: !!necro };
});
console.log('mana before/after:', JSON.stringify(result));

await sleep(150); // grab the frame before mana regen refills it

const frame = await page.$('#player-frame');
if (frame) await frame.screenshot({ path: 'tmp/mana_burn_frame.png' });

// Switch to the Combat Log tab so the "You gain Mana Sear." lines are visible.
await page.evaluate(() => document.querySelector('.chat-tab[data-tab="combat"]')?.click());
await sleep(200);
const log = await page.$('#chatlog-wrap');
if (log) await log.screenshot({ path: 'tmp/mana_burn_log.png' });
await page.screenshot({ path: 'tmp/mana_burn_full.png' });
console.log('shots written to tmp/');

await browser.close();
