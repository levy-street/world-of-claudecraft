// Screenshot harness for the Loot Settings feature. Boots the offline world, forms a
// party, and captures the full set for the PR:
//   1. loot-settings-dock      full screen: auto-opens below the party frames on forming
//                              a group (leader), the default left dock.
//   2. loot-settings-leader    the leader's editable window (method + threshold).
//   3. loot-settings-member    a member's read-only window.
//   4. loot-settings-menu      the right-click party-member menu with the Loot Settings entry.
//   5. loot-settings-messages  chat: join summary + setting change + loot lifecycle with
//                              clickable item links.
//   6. loot-settings-overflow  full screen at a short HUD height: the panel flows to the
//                              right of the party frames when the left column would overflow.
// Needs `npm run dev` (default :5173; override GAME_URL, e.g. http://localhost:5174). ?gfx=ultra.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = `${process.env.GAME_URL ?? 'http://localhost:5173'}/?gfx=ultra`;
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [
    '--window-size=1600,900',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-crash-reporter',
    '--disable-breakpad',
    `--user-data-dir=${fs.mkdtempSync('/tmp/woc-chrome-')}`,
  ],
  defaultViewport: { width: 1600, height: 900, deviceScaleFactor: 2 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE:', m.text());
});

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('#btn-offline', { timeout: 60000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await sleep(300);
await page.type('#char-name', 'Ashkandi');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await page.waitForFunction(() => window.__game?.hud, { timeout: 60000 });
await sleep(2000);

// Best-effort: dismiss the new-character tutorial so it does not clutter full-screen shots.
await page.evaluate(() => {
  const skip = [...document.querySelectorAll('button')].find((b) =>
    /skip/i.test(b.textContent || ''),
  );
  skip?.click();
});
await sleep(300);

const shotEl = async (sel, name) => {
  await sleep(350);
  const el = await page.$(sel);
  if (el) await el.screenshot({ path: `tmp/${name}.png` });
  else console.log(`MISS: ${sel} for ${name}`);
};
const shotFull = async (name) => {
  await sleep(350);
  await page.screenshot({ path: `tmp/${name}.png` });
};

// Form a party. As leader, the panel AUTO-OPENS docked below the party frames.
await page.evaluate(() => {
  const sim = window.__game.sim;
  const me = sim.playerId;
  const thrall = sim.addPlayer('shaman', 'Thrall');
  sim.partyInvite(thrall, me);
  sim.partyAccept(thrall);
});
await sleep(800);

// (1) Full screen: the auto-open + left dock below the party frames.
await shotFull('loot-settings-dock');

// (2) Leader (editable): enable master loot so the looter + threshold rows show.
await page.evaluate(() => {
  const sim = window.__game.sim;
  sim.setPartyLootMaster(true, 0, 'rare', sim.playerId);
  window.__game.hud.closeLootSettings();
  window.__game.hud.openLootSettings();
});
await shotEl('#loot-settings-window', 'loot-settings-leader');

// (3) Member (read-only): re-point the sim's player id at the member for the capture.
// `playerId` is a `get` on the Sim prototype; an own accessor on the instance shadows
// it without needing the prototype property to be configurable.
await page.evaluate(() => {
  const g = window.__game;
  const thrallPid = g.sim.partyInfo.members.find((m) => m.name === 'Thrall').pid;
  Object.defineProperty(g.sim, 'playerId', { get: () => thrallPid, configurable: true });
  g.hud.closeLootSettings();
  g.hud.openLootSettings();
});
await shotEl('#loot-settings-window', 'loot-settings-member');

// (4) Right-click party-member menu (with the Loot Settings entry). Restore the leader
// view first so the menu is built from the leader's perspective.
await page.evaluate(() => {
  const g = window.__game;
  delete g.sim.playerId; // drop the instance shadow, back to the prototype getter (leader)
  g.hud.closeLootSettings();
  const thrall = g.sim.partyInfo.members.find((m) => m.name === 'Thrall');
  g.hud.openContextMenu(thrall.pid, thrall.name, 40, 120);
});
await shotEl('#ctx-menu', 'loot-settings-menu');

// (5) Chat: real join summary + setting change already logged; add the loot lifecycle
// with clickable item links.
await page.evaluate(() => {
  const hud = window.__game.hud;
  hud.closeContextMenu?.();
  for (const text of [
    'Rolling for [[i:greyjaw_hide_boots]].',
    'Thrall wins [[i:greyjaw_hide_boots]] (87)',
    'Ashkandi assigned [[i:worn_sword]] to Thrall.',
    'Everyone passed on [[i:worn_sword]].',
  ])
    hud.handleEvents([{ type: 'loot', text }]);
});
await shotEl('#chatlog', 'loot-settings-messages');

// (6) Overflow: at a short HUD height the left column cannot fit the panel below the
// party frames, so it flows to their right. Full screen so the fallback is visible.
await page.setViewport({ width: 1600, height: 260, deviceScaleFactor: 2 });
await sleep(300);
await page.evaluate(() => {
  window.__game.hud.closeLootSettings();
  window.__game.hud.openLootSettings();
});
await shotFull('loot-settings-overflow');

await browser.close();
console.log('wrote tmp/loot-settings-{dock,leader,member,menu,messages,overflow}.png');
