// Screenshot harness for the Warlock demon pack (src/sim/content/warlock_pets.ts
// + the five Summon spells in classes.ts). Boots an offline level-20 warlock,
// captures the spellbook (showing the new Summon Succubus/Felhunter/Felguard/
// Infernal/Doomguard spells), a summon-spell tooltip, and an in-world shot of a
// summoned demon fighting at the warlock's side.
//
// Needs `npm run dev` on :5173 (override with GAME_URL). Writes to tmp/.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1600,1750', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 1750 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE:', m.text()); });

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await sleep(200);
await page.type('#char-name', 'Mortcaller');
await page.click('#offline-select .mini-class[data-class="warlock"]');
await page.click('#btn-start-offline');
await sleep(2500);

// level 20 warlock, god-moded with a deep mana pool so the summons resolve
await page.evaluate(() => {
  const g = window.__game;
  const p = g.sim.player;
  g.sim.setPlayerLevel(20, p.id);
  p.gm = true;
  p.maxHp = 99999; p.hp = 99999;
  p.maxMp = 99999; p.mp = 99999;
});
await sleep(800);

// --- spellbook: the five new Summon spells appended to the warlock kit ---
await page.evaluate(() => window.__game.hud.toggleSpellbook());
await sleep(900);
await page.screenshot({ path: 'tmp/warlock-demon-spellbook.png' });

// --- tooltip on the Summon Felguard row ---
const hovered = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.spell-row')];
  const row = rows.find((r) => /Felguard|Felhunter|Succubus|Infernal|Doomguard/.test(r.textContent || ''));
  if (!row) return null;
  const b = row.getBoundingClientRect();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, label: row.textContent?.trim().slice(0, 40) };
});
if (hovered) {
  await page.mouse.move(hovered.x, hovered.y);
  await sleep(700);
  await page.screenshot({ path: 'tmp/warlock-demon-tooltip.png' });
  console.log('tooltip row:', hovered.label);
} else {
  console.log('WARN: no summon spell row found');
}

// --- in-world: summon a demon and let it fight a nearby mob ---
await page.evaluate(() => window.__game.hud.toggleSpellbook());
await page.evaluate(() => {
  const g = window.__game;
  const p = g.sim.player;
  p.mp = 99999;
  g.sim.castAbility('summon_felguard', p.id);
});
await sleep(6000); // 5s cast time + settle, driven by the offline render loop

await page.evaluate(() => {
  const g = window.__game;
  const p = g.sim.player;
  // pull the camera back and angle down so the summoned demon is framed beside us
  g.input.camYaw = p.facing;
  g.input.camPitch = 0.32;
});
await sleep(1200);
await page.screenshot({ path: 'tmp/warlock-demon-inworld.png' });

await browser.close();
console.log('done -> tmp/warlock-demon-{spellbook,tooltip,inworld}.png');
