// Screenshot harness for the new warlock demon: Summon Succubus.
// Boots the offline client, rolls a warlock, levels it to 20 so the spell is
// known, then casts Summon Succubus and waits out the cast so the magenta melee
// demon appears at the warlock's side. Writes PNGs to tmp/.
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
page.on('console', (msg) => { if (msg.type() === 'error') errors.push('CONSOLE: ' + msg.text()); });

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await new Promise((r) => setTimeout(r, 200));
await page.type('#char-name', 'Soulbinder');
await page.click('#offline-select .mini-class[data-class="warlock"]');
await page.click('#btn-start-offline');
await new Promise((r) => setTimeout(r, 2500));

// Level the warlock to 20 (so Summon Succubus is known), refill mana, clear any
// existing demon, and angle the camera so the summon lands in frame.
const setup = await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const p = sim.player;
  sim.setPlayerLevel(20, p.id);
  p.hp = p.maxHp; p.mana = p.maxMana;
  // dismiss any existing demon so only the succubus is on screen
  for (const e of [...sim.entities.values()]) {
    if (e.kind === 'mob' && e.ownerId === p.id) sim.removeEntity?.(e.id);
  }
  g.input.camYaw = p.facing;
  return { level: p.level, mana: p.mana };
});
console.log('setup:', JSON.stringify(setup));
await page.screenshot({ path: 'tmp/succubus_01_before.png' });

// Cast the real ability and tick out the 5s cast.
await page.evaluate(() => { window.__game.sim.castAbility('summon_succubus'); });
await new Promise((r) => setTimeout(r, 6500));

const after = await page.evaluate(() => {
  const sim = window.__game.sim;
  for (const e of sim.entities.values()) {
    if (e.templateId === 'succubus' && !e.dead) {
      // pin it beside the player and re-aim the camera for a clean framing
      const p = sim.player;
      e.pos.x = p.pos.x + 2.5; e.pos.z = p.pos.z + 1;
      window.__game.input.camYaw = p.facing;
      return { id: e.id, name: e.name, hp: e.hp, maxHp: e.maxHp, level: e.level };
    }
  }
  return null;
});
console.log('succubus:', JSON.stringify(after));
await new Promise((r) => setTimeout(r, 600));
await page.screenshot({ path: 'tmp/succubus_02_summoned.png' });

if (errors.length) { console.log('=== PAGE ERRORS ==='); for (const e of errors.slice(0, 20)) console.log(e); }
else console.log('no page errors');
await browser.close();
