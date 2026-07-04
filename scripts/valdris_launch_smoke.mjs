// Verification + screenshot harness for the level-40 launch trio:
//   1. the active level cap (XP freezes at 40, MAX LEVEL bar state),
//   2. the sealed-frontier rockslides (the Landing exit stays shut in-world),
//   3. the Envoys' Hall faction oath (window, swear, arrival at the realm hub)
//      and the ferry passage back.
// Drives the OFFLINE world (the same sim the server runs) through window.__game,
// mirroring the tests, and drops screenshots under tmp/valdris-smoke/.
// Needs `npm run dev` on :5173.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = (process.env.GAME_URL ?? 'http://localhost:5173') + '/?gfx=ultra';
const OUT = 'tmp/valdris-smoke';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures.push(name);
};

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900, deviceScaleFactor: 2 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('#btn-offline', { timeout: 60000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await sleep(300);
await page.type('#char-name', 'Smoketest');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await page.waitForFunction(() => window.__game?.hud && window.__game?.renderer, { timeout: 60000 });
await sleep(2500);

// The offline quick-start no longer offers a race picker: the character must be unsworn.
const unsworn = await page.evaluate(() => window.__game.world.player.race ?? null);
check('character starts unsworn (no race)', unsworn === null);

// --- 1. Active level cap: XP freezes at 40 -----------------------------------
const cap = await page.evaluate(() => {
  const g = window.__game;
  g.world.setPlayerLevel(40);
  const before = g.world.player.level;
  g.world.grantXp(500000);
  return { before, after: g.world.player.level, xp: g.world.xp };
});
check('level bar freezes at the active cap', cap.after === 40 && cap.xp === 0, JSON.stringify(cap));
await sleep(600);
await page.screenshot({ path: `${OUT}/1_max_level_bar.png` });

// --- 2. The sealed Landing exit ----------------------------------------------
const tp = (x, z) =>
  page.evaluate(
    ([x, z]) => {
      const g = window.__game;
      const e = g.world.player;
      e.pos = g.world.groundPos(x, z); // exact terrain height: no fall damage
      e.prevPos = { ...e.pos };
      e.hp = e.maxHp;
    },
    [x, z],
  );
await tp(0, 888);
await sleep(1200);
const barrier = await page.evaluate(() => {
  const g = window.__game;
  // hold north input via the sim move intent for ~4s of sim time
  const meta = g.world.meta(g.world.playerId);
  meta.moveInput.forward = 1;
  return new Promise((resolve) => {
    let ticks = 0;
    const iv = setInterval(() => {
      if (++ticks >= 80) {
        clearInterval(iv);
        meta.moveInput.forward = 0;
        resolve(g.world.player.pos.z);
      }
    }, 50);
  });
});
check('the Landing exit rockslide blocks walking north', barrier < 901, `z=${barrier.toFixed(1)}`);
// frame the rockslide from a few paces south so the barricade reads in shot
await tp(3, 882);
await sleep(900);
await page.screenshot({ path: `${OUT}/2_landing_barrier.png` });

// --- 3. The Envoys' Hall oath + arrival + ferry back --------------------------
await tp(0, 864);
await sleep(1200);
await page.screenshot({ path: `${OUT}/3_envoys_hall.png` });
await page.evaluate(() => window.__game.hud.openFactionChoice());
await sleep(400);
await page.screenshot({ path: `${OUT}/4_faction_choice_window.png` });
const oath = await page.evaluate(async () => {
  const g = window.__game;
  document.querySelector('#faction-choice-window .mini-race[data-race="sand_mage"]').click();
  await new Promise((r) => setTimeout(r, 150));
  document.querySelector('#faction-choice-window [data-act="swear"]').click();
  await new Promise((r) => setTimeout(r, 600));
  return { race: g.world.player.race, z: g.world.player.pos.z };
});
check(
  'the oath swears Ossara and lands at Qesh Aram',
  oath.race === 'sand_mage' && oath.z > 950 && oath.z < 1050,
  JSON.stringify(oath),
);
await sleep(1500);
await page.screenshot({ path: `${OUT}/5_realm_arrival.png` });
const second = await page.evaluate(() => window.__game.world.chooseRace('dwarf'));
check('the oath is one-shot (a second swear is refused)', second === false);

// ferry back: stand beside Sandskiff Master Rhouma (6, 1000)
await tp(6, 999);
await sleep(800);
const ferried = await page.evaluate(() => {
  const g = window.__game;
  const ok = g.world.travel();
  return { ok, z: g.world.player.pos.z };
});
check(
  'the realm ferry returns to the Envoys Hall',
  ferried.ok === true && Math.abs(ferried.z - 858) < 4,
  JSON.stringify(ferried),
);
await sleep(1200);
await page.screenshot({ path: `${OUT}/6_ferry_back_at_hall.png` });

await browser.close();
if (failures.length) {
  console.log(`\n${failures.length} check(s) FAILED`);
  process.exit(1);
}
console.log('\nAll Valdris launch smoke checks passed. Screenshots in tmp/valdris-smoke/.');
