// Quest-item fallback screenshots (max graphics, ?gfx=ultra).
// Demonstrates: a player attuned for "The Bound Guardian" who no longer holds
// the Crypt Keystone accepts the quest, and the sim re-grants the keystone so
// the quest is not permanently blocked. Captures the bag BEFORE (no keystone)
// and AFTER (keystone re-granted) plus the quest tracker.
// Offline flow (no server). Needs `npm run dev`. Writes PNGs to tmp/.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';
const URL = (process.env.GAME_URL ?? 'http://localhost:5173') + '/?gfx=ultra';
fs.mkdirSync('tmp', { recursive: true });

const QUEST = 'q_nythraxis_bound_guardian';
const PREREQ = 'q_nythraxis_sealed_crypt';
const KEYSTONE = 'crypt_keystone';
const GIVER = 'brother_aldric_highwatch';

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 960, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tap = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await tap('#btn-offline');
await wait(200);
await page.evaluate(() => {
  const n = document.querySelector('#char-name');
  if (n) { n.value = 'Attuned'; n.dispatchEvent(new Event('input', { bubbles: true })); }
});
await tap('#offline-select .mini-class[data-class="warrior"]');
await tap('#btn-start-offline');
await page.waitForFunction(() => window.__game?.sim && window.__game?.hud, { timeout: 30000 });
await wait(2500);

// Set up the progression-block scenario: attuned (prereq done), high enough
// level, standing on the quest giver, and WITHOUT the keystone in the bag.
const before = await page.evaluate(({ QUEST, PREREQ, KEYSTONE, GIVER }) => {
  const sim = window.__game.sim;
  const pid = sim.player.id ?? sim.player.entityId;
  sim.player.maxHp = 99999; sim.player.hp = 99999;
  sim.player.level = 20;
  const meta = sim.players.get(pid);
  meta.questsDone.add(PREREQ);
  // ensure no keystone is held
  meta.inventory = meta.inventory.filter((s) => s.itemId !== KEYSTONE);
  const aldric = [...sim.entities.values()].find((e) => e.kind === 'npc' && e.templateId === GIVER && !e.dead);
  const p = sim.entities.get(pid);
  p.pos.x = aldric.pos.x; p.pos.z = aldric.pos.z;
  return { keystone: sim.countItem(KEYSTONE, pid), state: sim.questState(QUEST, pid) };
}, { QUEST, PREREQ, KEYSTONE, GIVER });
console.log('BEFORE accept:', JSON.stringify(before));

await page.evaluate(() => window.__game.hud.toggleBags?.());
await wait(600);
await page.screenshot({ path: 'tmp/quest_fallback_before.png' });

// Accept the quest through the real sim path -> the fallback re-grants the keystone.
const after = await page.evaluate(({ QUEST, KEYSTONE }) => {
  const sim = window.__game.sim;
  const pid = sim.player.id ?? sim.player.entityId;
  sim.acceptQuest(QUEST, pid);
  return { keystone: sim.countItem(KEYSTONE, pid), state: sim.players.get(pid).questLog.get(QUEST)?.state };
}, { QUEST, KEYSTONE });
console.log('AFTER accept:', JSON.stringify(after));
await wait(800);
await page.screenshot({ path: 'tmp/quest_fallback_after.png' });

// World view at max graphics with the quest tracker showing.
await page.evaluate(() => window.__game.hud.toggleBags?.());
await wait(400);
await page.screenshot({ path: 'tmp/quest_fallback_world.png' });

console.log('errors:', errors.slice(0, 5));
await browser.close();
if (before.keystone !== 0 || after.keystone !== 1) {
  console.error('UNEXPECTED: fallback did not behave as designed');
  process.exit(1);
}
console.log('OK: keystone 0 -> 1 on accept');
