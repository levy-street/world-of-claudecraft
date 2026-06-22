// Screenshot the focused-quest arrow: it floats above the player's head and
// rotates to keep pointing at the focused quest's target as the camera turns.
// Boots offline, accepts a starting quest, focuses it via the right-click path,
// then captures at several camera yaws. Needs `npm run dev`.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
await page.evaluate(() => document.querySelector('#btn-offline')?.click());
await sleep(600);
await page.evaluate(() => {
  const n = document.querySelector('#char-name');
  if (n) { n.value = 'Wayra'; n.dispatchEvent(new Event('input', { bubbles: true })); }
  document.querySelector('#offline-select .mini-class[data-class="warrior"]')?.click();
});
await sleep(200);
await page.evaluate(() => document.querySelector('#btn-start-offline')?.click());
// wait for the world to come up
for (let i = 0; i < 40; i++) {
  const ready = await page.evaluate(() => !!(window.__game && window.__game.sim && window.__game.sim.player));
  if (ready) break;
  await sleep(300);
}
await page.evaluate(() => document.querySelector('#mobile-preflight-continue')?.click());
await sleep(800);

// Accept a starting kill quest so it shows in the tracker. Teleport next to the
// giver so the real accept path's range check passes; seed the log directly if not.
const accepted = await page.evaluate(() => {
  const sim = window.__game.sim;
  const giver = [...sim.entities.values()].find((e) => e.templateId === 'marshal_redbrook');
  if (giver) { sim.player.pos.x = giver.pos.x + 2; sim.player.pos.z = giver.pos.z; sim.player.pos.y = giver.pos.y; }
  sim.acceptQuest('q_wolves');
  if (!sim.questLog.has('q_wolves')) {
    sim.questLog.set('q_wolves', { questId: 'q_wolves', counts: [0], state: 'active' });
  }
  return [...sim.questLog.keys()];
});
console.log('questLog after accept:', JSON.stringify(accepted));
await sleep(700);

// Focus the quest directly on the HUD (the contextmenu-on-row path needs the
// tracker DOM, which the headless harness renders inconsistently). updateQuestWaypoint
// runs every frame off focusedQuestId, so the arrow renders regardless.
const focused = await page.evaluate(() => {
  window.__game.hud.focusedQuestId = 'q_wolves';
  return window.__game.hud.focusedQuestId;
});
console.log('focusedQuestId:', focused);
// Dismiss the onboarding tutorial card so it doesn't overlap the arrow.
await page.evaluate(() => document.querySelector('.tut-skip')?.click());
await sleep(900);

async function shot(name, yaw) {
  await page.evaluate((y) => { if (y !== null) window.__game.input.camYaw = y; }, yaw ?? null);
  await sleep(450);
  const info = await page.evaluate(() => {
    const wp = document.querySelector('#quest-waypoint');
    return {
      display: wp ? getComputedStyle(wp).display : 'MISSING',
      left: wp?.style.left, top: wp?.style.top,
      rot: document.querySelector('#quest-waypoint .qw-arrow')?.style.transform,
      dist: document.querySelector('#quest-waypoint .qw-dist')?.textContent,
    };
  });
  console.log(name, JSON.stringify(info));
  await page.screenshot({ path: `tmp/${name}.png` });
}

await shot('qwp_yaw_default', Math.PI);
await shot('qwp_yaw_left', Math.PI - 1.1);
await shot('qwp_yaw_right', Math.PI + 1.1);
await shot('qwp_yaw_back', 0);

// Full-resolution close-up around the arrow (anchored ~800,374) so the glyph,
// distance, and gap above the head are clearly legible.
await page.evaluate(() => { window.__game.input.camYaw = Math.PI; });
await sleep(450);
await page.screenshot({ path: 'tmp/qwp_closeup.png', clip: { x: 620, y: 220, width: 360, height: 320 } });

console.log(errors.length ? 'ERRORS:\n' + errors.slice(0, 8).join('\n') : 'no page errors');
await browser.close();
