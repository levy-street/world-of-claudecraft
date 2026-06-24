// Visual walkthrough of the /assist command (group-play target matching).
// Boots the offline game at max graphics (?gfx=ultra), stages a party member
// ("Fernando") already locked onto a nearby mob, then drives the REAL chat
// input to type "/assist Fernando" and shows the caster snap onto the same
// target. Screenshots land in tmp/. Needs `npm run dev` already running.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = (process.env.GAME_URL ?? 'http://localhost:5173') + '/?gfx=ultra';
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [];
const check = (cond, msg) => { console.log(`${cond ? 'OK  ' : 'FAIL'}  ${msg}`); if (!cond) fails.push(msg); };

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => fails.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE-ERR:', m.text()); });

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 45000 });
// Home -> offline character select -> enter world as a warrior.
await page.evaluate(() => document.querySelector('#btn-offline').click());
await sleep(300);
await page.evaluate(() => {
  const card = document.querySelector('#offline-select .mini-class[data-class="warrior"]') || document.querySelector('.class-card[data-class="warrior"]');
  card?.click();
});
await sleep(150);
await page.evaluate(() => { const n = document.querySelector('#char-name'); if (n) n.value = 'Aki'; });
await page.evaluate(() => document.querySelector('#btn-start-offline')?.click());
// ?gfx=ultra boots slowly under swiftshader; give it room.
await page.waitForFunction(() => window.__game?.sim?.entities?.size > 5, { timeout: 60000, polling: 250 });
await sleep(2500);
// dismiss the new-adventurer tutorial overlay so it does not cover the shot.
await page.evaluate(() => document.querySelector('.tut-skip')?.click());
await sleep(300);

// --- stage the scene: put a party member "Fernando" next to the caster, both
// beside a nearby mob, with Fernando already targeting (and swinging at) it.
const scene = await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const me = sim.entities.get(g.world.playerId);
  // nearest living hostile-ish mob to the caster
  const mobs = [...sim.entities.values()].filter((e) => e.kind === 'mob' && !e.dead);
  mobs.sort((a, b) => ((a.pos.x - me.pos.x) ** 2 + (a.pos.z - me.pos.z) ** 2) - ((b.pos.x - me.pos.x) ** 2 + (b.pos.z - me.pos.z) ** 2));
  const mob = mobs[0];
  // place the caster a few yards from the mob
  me.pos.x = mob.pos.x - 4; me.pos.z = mob.pos.z + 3;
  // spawn the party member and lock them onto the mob
  const fid = sim.addPlayer('mage', 'Fernando');
  const fern = sim.entities.get(fid);
  fern.pos.x = mob.pos.x + 3; fern.pos.z = mob.pos.z + 3; fern.pos.y = me.pos.y;
  fern.targetId = mob.id; fern.autoAttack = true;
  return { mobId: mob.id, mobName: mob.name, fid, meTarget: me.targetId };
});
check(!!scene.mobId, `staged a nearby mob: ${scene.mobName}`);
check(scene.meTarget == null || scene.meTarget !== scene.mobId, 'caster has no/other target before /assist');

// frame the shot: pull the camera in a touch, and show the command typed in
// the chat input so the "before" frame reads like a player about to send it.
await page.evaluate(() => { const i = window.__game.input; i.camDist = 9; i.camPitch = 0.33; });
await page.evaluate(() => {
  const inp = document.querySelector('#chat-input');
  if (inp) { inp.style.display = ''; inp.value = '/assist Fernando'; }
});
await sleep(800);
await page.screenshot({ path: 'tmp/assist_1_before.png' });

// --- send it through the real offline command path (world.chat -> Sim.chat),
// then clear the input as the HUD would on submit.
await page.evaluate(() => {
  window.__game.world.chat('/assist Fernando');
  const inp = document.querySelector('#chat-input');
  if (inp) { inp.value = ''; inp.style.display = 'none'; }
});
await sleep(900);

const after = await page.evaluate(() => {
  const g = window.__game;
  const me = g.sim.entities.get(g.world.playerId);
  return { meTarget: me.targetId };
});
check(after.meTarget === scene.mobId, `/assist switched caster's target to ${scene.mobName} (${scene.mobId}) -> got ${after.meTarget}`);
await sleep(700);
await page.screenshot({ path: 'tmp/assist_2_after.png' });

await browser.close();
console.log(fails.length ? `\nFAILURES:\n- ${fails.join('\n- ')}` : '\nAll checks passed.');
process.exit(fails.length ? 1 : 0);
