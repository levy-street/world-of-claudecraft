// Rogue E2E: energy, builders/finishers, combo pips in the UI, vendor buy/sell.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

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
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await new Promise((r) => setTimeout(r, 200));
await page.type('#char-name', 'Sneaks');
await page.click('#offline-select .mini-class[data-class="rogue"]');
await page.click('#btn-start-offline');
await new Promise((r) => setTimeout(r, 1500));

// engage a wolf with sinister strike
await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const p = sim.player;
  let wolf = null, d = 1e9;
  for (const e of sim.entities.values()) {
    if (e.templateId === 'forest_wolf' && !e.dead) {
      const dd = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
      if (dd < d) { d = dd; wolf = e; }
    }
  }
  p.pos.x = wolf.pos.x + 2.5; p.pos.z = wolf.pos.z;
  // beef the wolf up so we can bank 3 combo points before it dies
  wolf.maxHp = 120; wolf.hp = 120;
  sim.targetEntity(wolf.id);
  p.facing = Math.atan2(wolf.pos.x - p.pos.x, wolf.pos.z - p.pos.z);
  g.input.camYaw = p.facing;
  sim.startAutoAttack();
  window.__wolfId = wolf.id;
});

let maxCombo = 0;
let evisFired = false;
for (let i = 0; i < 60; i++) {
  const s = await page.evaluate(() => {
    const g = window.__game;
    const sim = g.sim;
    const p = sim.player;
    const w = sim.entities.get(window.__wolfId);
    if (!w.dead) {
      if (p.targetId !== w.id) sim.targetEntity(w.id);
      p.facing = Math.atan2(w.pos.x - p.pos.x, w.pos.z - p.pos.z);
      if (!p.autoAttack) sim.startAutoAttack();
      if (p.comboPoints >= 3 && p.resource >= 35 && p.gcdRemaining <= 0) {
        sim.castAbility('eviscerate');
        window.__evis = true;
      } else if (p.resource >= 45 && p.gcdRemaining <= 0) {
        sim.castAbility('sinister_strike');
      }
    }
    const pips = [...document.querySelectorAll('.combo-pip.on')].length;
    return { combo: p.comboPoints, pips, energy: Math.round(p.resource), dead: w.dead, evis: !!window.__evis };
  });
  maxCombo = Math.max(maxCombo, s.combo);
  if (s.combo >= 2 && !evisFired) {
    // give the HUD time to catch up before sampling the pips — headless
    // swiftshader frames can take several hundred ms each, so poll
    let pips = { ui: -1, combo: -2 };
    for (let j = 0; j < 10 && pips.ui !== pips.combo; j++) {
      await new Promise((r) => setTimeout(r, 200));
      pips = await page.evaluate(() => {
        const p = window.__game.sim.player;
        return { ui: [...document.querySelectorAll('.combo-pip.on')].length, combo: p.comboPoints };
      });
    }
    await page.screenshot({ path: 'tmp/r1_combo.png' });
    console.log('combo state:', JSON.stringify(s), '| UI pips match:', pips.ui === pips.combo ? 'OK' : `FAIL (ui ${pips.ui} vs ${pips.combo})`);
    evisFired = true;
  }
  if (s.dead) {
    console.log('rogue killed wolf:', 'OK', '| eviscerate used:', s.evis ? 'OK' : 'FAIL', '| max combo:', maxCombo);
    break;
  }
  await new Promise((r) => setTimeout(r, 400));
}

// loot, then vendor: buy bread, sell junk
await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const w = sim.entities.get(window.__wolfId);
  sim.player.pos.x = w.pos.x + 1; sim.player.pos.z = w.pos.z;
  sim.lootCorpse(w.id);
});
const vendor = await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const wilkes = [...sim.entities.values()].find((e) => e.templateId === 'trader_wilkes');
  sim.player.pos.x = wilkes.pos.x + 2; sim.player.pos.z = wilkes.pos.z;
  sim.copper = 100;
  sim.buyItem(wilkes.id, 'baked_bread');
  const fangs = sim.countItem('wolf_fang');
  if (fangs > 0) sim.sellItem('wolf_fang');
  return { bread: sim.countItem('baked_bread'), copper: sim.copper, hadFang: fangs > 0 };
});
console.log('vendor buy bread:', vendor.bread === 1 ? 'OK' : 'FAIL', '| copper after:', vendor.copper);

// eat the bread
const eat = await page.evaluate(() => {
  const sim = window.__game.sim;
  const p = sim.player;
  p.hp = Math.round(p.maxHp * 0.4);
  p.inCombat = false;
  p.combatTimer = 99;
  sim.useItem('baked_bread');
  return { sitting: p.sitting, hp: p.hp };
});
await new Promise((r) => setTimeout(r, 4500));
const eat2 = await page.evaluate(() => window.__game.sim.player.hp);
console.log('eating heals while sitting:', eat.sitting && eat2 > eat.hp ? `OK (${eat.hp} -> ${eat2})` : 'FAIL');
await page.screenshot({ path: 'tmp/r2_eating.png' });

console.log(errors.length ? 'ERRORS:\n' + errors.slice(0, 10).join('\n') : 'no page errors');
await browser.close();
