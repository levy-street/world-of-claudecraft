// Visual tour: screenshots of the overhauled game for inspection.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';
const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const CLASS = process.env.GAME_CLASS ?? 'warrior';
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
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await new Promise((r) => setTimeout(r, 200));
await page.screenshot({ path: 'tmp/t00_start.png' });
await page.type('#char-name', 'Thorgar');
await page.click(`#offline-select .mini-class[data-class="${CLASS}"]`);
await page.click('#btn-start-offline');
await new Promise((r) => setTimeout(r, 3000));
await page.screenshot({ path: 'tmp/t01_town.png' });

// tour god mode so the camp mobs don't murder the photographer
await page.evaluate(() => {
  const p = window.__game.sim.player;
  p.maxHp = 99999; p.hp = 99999;
});

const tp = async (x, z, yaw = 0) => {
  await page.evaluate((x, z, yaw) => {
    const g = window.__game;
    const p = g.sim.player;
    if (p.dead) g.sim.releaseSpirit();
    p.maxHp = 99999; p.hp = 99999;
    p.pos.x = x; p.pos.z = z;
    p.facing = yaw;
    g.input.camYaw = yaw;
  }, x, z, yaw);
  await new Promise((r) => setTimeout(r, 700));
};

// look at town from the road
await tp(0, -22, 0);
await page.screenshot({ path: 'tmp/t02_town_view.png' });

// wolf woods
await tp(-15, 45, 0.4);
await page.screenshot({ path: 'tmp/t03_wolves.png' });

// lake + murlocs + dock
await tp(-58, 50, -0.9);
await page.screenshot({ path: 'tmp/t04_lake.png' });

// mine
await tp(-72, -55, -2.4);
await page.screenshot({ path: 'tmp/t05_mine.png' });

// bandit camp + tents + campfires
await tp(55, -55, 2.4);
await page.screenshot({ path: 'tmp/t06_bandits.png' });

// ruins + skeletons
await tp(70, 68, 0.8);
await page.screenshot({ path: 'tmp/t07_ruins.png' });

// fight a wolf for combat UI
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
  p.pos.x = wolf.pos.x + 3; p.pos.z = wolf.pos.z;
  p.facing = Math.atan2(wolf.pos.x - p.pos.x, wolf.pos.z - p.pos.z);
  g.input.camYaw = p.facing;
  sim.targetEntity(wolf.id);
  sim.startAutoAttack();
});
await new Promise((r) => setTimeout(r, 2500));
await page.screenshot({ path: 'tmp/t08_combat.png' });

// UI windows
await page.keyboard.press('c');
await new Promise((r) => setTimeout(r, 300));
await page.screenshot({ path: 'tmp/t09_character.png' });
await page.keyboard.press('c');
await page.keyboard.press('p');
await new Promise((r) => setTimeout(r, 300));
await page.screenshot({ path: 'tmp/t10_spellbook.png' });
await page.keyboard.press('p');

// accept a quest then quest log
await page.evaluate(() => {
  const g = window.__game;
  g.sim.player.pos.x = 4; g.sim.player.pos.z = 3;
});
await new Promise((r) => setTimeout(r, 200));
await page.keyboard.press('f');
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: 'tmp/t11_gossip.png' });
await page.evaluate(() => {
  const items = [...document.querySelectorAll('#quest-dialog .qd-list-item')];
  if (items[0]) items[0].click();
});
await new Promise((r) => setTimeout(r, 300));
await page.screenshot({ path: 'tmp/t12_quest_detail.png' });
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('#quest-dialog .btn')];
  const accept = btns.find((b) => b.textContent === 'Accept');
  if (accept) accept.click();
  document.querySelector('#quest-dialog [data-close]')?.click();
});
await page.keyboard.press('l');
await new Promise((r) => setTimeout(r, 300));
await page.screenshot({ path: 'tmp/t13_questlog.png' });
await page.keyboard.press('l');

// vendor
await page.evaluate(() => {
  const g = window.__game;
  const wilkes = [...g.sim.entities.values()].find((e) => e.templateId === 'trader_wilkes');
  g.sim.player.pos.x = wilkes.pos.x + 2; g.sim.player.pos.z = wilkes.pos.z;
  g.sim.copper = 500;
  g.hud.openVendor(wilkes.id);
});
await new Promise((r) => setTimeout(r, 300));
await page.screenshot({ path: 'tmp/t14_vendor.png' });
await page.keyboard.press('Escape');

// map
await page.keyboard.press('m');
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: 'tmp/t15_map.png' });
await page.keyboard.press('m');

console.log(errors.length ? 'ERRORS:\n' + errors.slice(0, 15).join('\n') : 'no page errors');
await browser.close();
