// Screenshot the Spectral Ward affix (mob spell reflect) in the offline client.
// Boots the game as a mage, reskins a nearby mob as a Wyrmcult Necromancer,
// stands it in front, and repeatedly lands spell hits on it so its ward lashes
// flat shadow damage back at the caster — captured as the floating combat text
// over the player and the "Spectral Ward hits you" combat-log lines.
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
page.on('pageerror', (e) => console.log('PAGEERROR: ' + e.message));

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await new Promise((r) => setTimeout(r, 200));
await page.type('#char-name', 'Aevera');
await page.click('#offline-select .mini-class[data-class="mage"]');
await page.click('#btn-start-offline');
await new Promise((r) => setTimeout(r, 2500));

// Reskin the nearest mob as the warded necromancer and plant it in front of us.
const setup = await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const p = sim.player;
  p.maxHp = 100000; p.hp = 100000; // survive the bout; gm would block the reflect

  let mob = null, d = 1e9;
  for (const e of sim.entities.values()) {
    if (e.kind === 'mob' && !e.dead) {
      const dd = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
      if (dd < d) { d = dd; mob = e; }
    }
  }
  mob.templateId = 'wyrmcult_necromancer';
  mob.name = 'Wyrmcult Necromancer';
  mob.level = 19; // match its real Thornpeak spawn level for the label
  mob.hostile = true;
  mob.maxHp = 100000; mob.hp = 100000;
  mob.pos.x = p.pos.x + 6; mob.pos.z = p.pos.z + 6;
  sim.targetEntity(mob.id);
  p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
  g.input.camYaw = p.facing;
  if (g.input) g.input.camDist = 10;
  return { mobId: mob.id, ward: sim.constructor && null, name: mob.name };
});
console.log('spell-reflect setup:', JSON.stringify(setup));

// Fire a burst of spell hits so the ward reflects repeatedly; capture mid-burst
// while the floating "-9" combat text is still rising over the player.
for (let i = 0; i < 10; i++) {
  await page.evaluate(({ mobId, crit }) => {
    const sim = window.__game.sim;
    const p = sim.player;
    const mob = sim.entities.get(mobId);
    if (mob && !mob.dead) sim.dealDamage(p, mob, 45, crit, 'fire', 'Fireball', 'hit');
  }, { mobId: setup.mobId, crit: i % 3 === 0 });
  await new Promise((r) => setTimeout(r, 120));
}

await new Promise((r) => setTimeout(r, 250));
await page.screenshot({ path: 'tmp/spell_reflect_full.png' });

// One more burst, then immediately grab the scene to catch fresh FCT, and crop
// the combat log (persistent) which lists the "Spectral Ward hits you" lines.
const verdict = await page.evaluate(({ mobId }) => {
  const sim = window.__game.sim;
  const p = sim.player;
  const mob = sim.entities.get(mobId);
  const before = p.hp;
  for (let i = 0; i < 4; i++) sim.dealDamage(p, mob, 45, false, 'frost', 'Frostbolt', 'hit');
  return { reflectedTotal: before - p.hp, mob: mob.name };
}, { mobId: setup.mobId });
console.log('spell-reflect verdict:', JSON.stringify(verdict));
await new Promise((r) => setTimeout(r, 60));
await page.screenshot({ path: 'tmp/spell_reflect_fct.png' });

// Crop the combat log (bottom-left) showing the named reflect lines, and read
// back its text so we can confirm the wording is "Spectral Ward hits you".
const logBox = await page.evaluate(() => {
  const el = document.querySelector('#combatlog');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height, text: el.innerText };
});
console.log('combat-log text:', logBox && JSON.stringify(logBox.text));
// Switch to the Combat Log tab so the reflect lines are visible, then crop the
// known bottom-left region directly (the panel measures 0-width via the DOM).
await page.evaluate(() => {
  const tab = document.querySelector('.chat-tab[data-log-tab="combat"]');
  if (tab) tab.click();
});
await new Promise((r) => setTimeout(r, 200));
await page.screenshot({ path: 'tmp/spell_reflect_log.png', clip: { x: 6, y: 600, width: 440, height: 160 } });
// Player-centred crop to frame the reflected damage text over the caster.
await page.screenshot({ path: 'tmp/spell_reflect_scene.png', clip: { x: 430, y: 150, width: 740, height: 480 } });
console.log('crops written');

await browser.close();
