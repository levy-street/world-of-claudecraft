// Visual capture for the combat-potion ladder + the Eastbrook rare "Grix the
// Tunnelking". Boots the offline game in a headless browser, drives the REAL Sim
// + HUD: spawns the player next to Grix for a nameplate/combat shot, then fills
// the bags with the new potion tiers and opens the bag window with a tooltip.
// Writes PNGs straight into docs/screenshots/ for the PR. Needs `npm run dev`.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = 'docs/screenshots';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [];
const check = (cond, msg) => {
  console.log(`${cond ? 'OK  ' : 'FAIL'}  ${msg}`);
  if (!cond) fails.push(msg);
};

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [
    '--window-size=1600,900',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
  ],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => fails.push('PAGEERROR: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE-ERR:', m.text());
});

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.click('#btn-offline');
await sleep(200);
await page.type('#char-name', 'Adventurer');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await page.waitForFunction(() => window.__game?.sim?.entities?.size > 5, {
  timeout: 20000,
  polling: 200,
});
await sleep(1500);

// --- set the scene: god-mode the player and stand them beside Grix, who lairs
// at the deep end of the south-west kobold mine. ----------------------------
const scene = await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const grix = [...sim.entities.values()].find((e) => e.templateId === 'grix_the_tunnelking');
  if (!grix) return { grix: false };
  const me = sim.player;
  const meta = sim.players.get(me.id);
  // god mode so the elite + its adds never kill the camera
  me.maxHp = 999999;
  me.hp = 999999;
  sim.setPlayerLevel(7);
  const p = sim.groundPos(grix.pos.x, grix.pos.z - 4.5);
  me.pos = p;
  me.prevPos = { ...p };
  me.facing = 0;
  me.prevFacing = 0;
  sim.targetEntity(grix.id);
  return {
    grix: true,
    name: grix.name,
    level: grix.level,
    rare: !!grix.rare,
    elite: !!grix.elite,
    hp: grix.maxHp,
  };
});
check(scene.grix, 'Grix the Tunnelking spawned in Eastbrook Vale');
check(scene.hp > 1000, `Grix has elite-scaled health (Lv ${scene.level}, ${scene.hp} HP)`);

// 1) the rare's nameplate, in his lair
await page.evaluate(() => {
  window.__game.input.camDist = 8;
  window.__game.input.camPitch = 0.28;
});
await sleep(1200);
await page.screenshot({ path: `${OUT}/grix-the-tunnelking.png` });

// 2) engage him: a few melee swings + abilities so floating combat text shows
await page.evaluate(() => {
  const g = window.__game;
  g.sim.player.inCombat = true;
  for (const id of ['heroic_strike', 'thunder_clap', 'cleave']) {
    try {
      g.sim.castAbility(id);
    } catch {}
  }
});
await sleep(1600);
await page.screenshot({ path: `${OUT}/grix-combat.png` });

// 3) the potion ladder in the bags, with a tooltip on a new tier
const bags = await page.evaluate(() => {
  const g = window.__game;
  g.sim.addItem('minor_healing_potion', 5);
  g.sim.addItem('lesser_healing_potion', 5);
  g.sim.addItem('healing_potion', 5);
  g.sim.addItem('lesser_mana_potion', 5);
  g.sim.addItem('mana_potion', 5);
  g.sim.addItem('tunnelkings_spade', 1);
  g.hud.renderBags();
  document.getElementById('bags').style.display = 'flex';
  const slots = document.querySelectorAll('#bags .bag-item').length;
  return {
    slots,
    hasLesser: g.sim.countItem('lesser_healing_potion') > 0,
    hasStd: g.sim.countItem('healing_potion') > 0 && g.sim.countItem('mana_potion') > 0,
  };
});
check(bags.hasLesser && bags.hasStd, 'the new potion tiers appear in the bags');
await sleep(400);
// hover a Healing Potion to surface its tooltip
await page.evaluate(() => {
  const row = [...document.querySelectorAll('#bags .bag-item')].find((r) =>
    /Lesser Healing Potion/.test(r.textContent),
  );
  row?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  row?.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 900, clientY: 500 }));
});
await sleep(600);
await page.screenshot({ path: `${OUT}/potion-ladder-bags.png` });

await browser.close();
console.log(
  fails.length === 0
    ? '\nALL GRIX/POTION CHECKS PASSED'
    : `\n${fails.length} CHECK(S) FAILED:\n - ` + fails.join('\n - '),
);
process.exit(fails.length === 0 ? 0 : 1);
