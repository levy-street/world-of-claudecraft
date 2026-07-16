// Dungeon Finder PR screenshots (docs/prd/dungeon-finder.md): boots the OFFLINE
// game on the Vite dev server, fabricates realm state directly on the offline
// Sim (extra local players, role selections, queue joins, listings), and
// captures the window's three tabs plus the live proposal on desktop and
// mobile portrait/landscape. Output lands in docs/screenshots/ (committed,
// referenced from the PR body).
//   node scripts/dungeon_finder_shots.mjs   (needs `npm run dev` on :5173)
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = 'docs/screenshots';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];

async function bootOffline(page, name) {
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 60000 });
  // Skip the first-spawn intro cinematic (it inline-hides #ui while it runs).
  await page.evaluate((n) => {
    localStorage.setItem(`woc_spawn_intro_seen:offline:warrior:${n}`, '1');
  }, name);
  await enterOfflineGame(page, { charClass: 'warrior', charName: name, settleMs: 1500 });
  await page.waitForFunction(() => window.__game?.sim?.player, { timeout: 40000 });
  // Dismiss the new-adventurer tutorial overlay (it intercepts input).
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) =>
      /skip tutorial/i.test(b.textContent || ''),
    );
    btn?.click();
    document.querySelector('.tut-skip')?.click();
  });
  await sleep(400);
}

// Fabricate the shared finder scenario on the offline Sim: the primary tank at
// level 8 plus four locals, listings on the board, and everyone ready to queue.
async function seedFinderState(page) {
  await page.evaluate(() => {
    const sim = window.__game.sim;
    sim.setPlayerLevel(8);
    sim.dungeonFinderSetRoles(['tank']);
    const bots = [
      ['Lumen', 'priest', ['healer']],
      ['Wick', 'mage', ['dps']],
      ['Fletch', 'hunter', ['dps']],
      ['Shade', 'rogue', ['dps']],
    ].map(([name, cls, roles]) => {
      const pid = sim.addPlayer(cls, name);
      // Dev bots auto-accept finder proposals (the /dev lfg behavior), so the
      // popup meters fill and the group forms off the primary's single accept.
      sim.players.get(pid).isDevBot = true;
      sim.setPlayerLevel(8, pid);
      sim.dungeonFinderSetRoles(roles, pid);
      return pid;
    });
    window.__dfBots = bots;
  });
  await sleep(300);
}

async function shot(page, file) {
  await page.screenshot({ path: `${OUT}/${file}`, type: 'jpeg', quality: 85 });
  console.log('shot', file);
}

const clickIn = (page, sel) =>
  page.evaluate((s) => {
    const el = document.querySelector(`#dungeon-finder-window ${s}`);
    if (!el) throw new Error(`missing ${s}`);
    el.click();
  }, sel);

// ---------------------------------------------------------------------------
// Desktop 1600x900.
// ---------------------------------------------------------------------------
const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  protocolTimeout: 60000,
  args: [
    '--no-sandbox',
    '--window-size=1600,900',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
await bootOffline(page, 'Anvil');
await seedFinderState(page);

// --- Premade board: my listing + an applicant + another open listing ---
await page.evaluate(() => {
  const sim = window.__game.sim;
  const [healer, , , rogue] = window.__dfBots;
  sim.dungeonFinderListingCreate('hollow_crypt_normal', ['first_run', 'learning']);
  sim.dungeonFinderListingCreate('hollow_crypt_normal', ['fast_run'], healer);
  for (let i = 0; i < 3; i++) sim.tick();
  const mine = sim.dungeonFinderInfoFor(sim.playerId).myListing;
  sim.dungeonFinderApply(mine.id, rogue);
  for (let i = 0; i < 3; i++) sim.tick();
  window.__game.hud.toggleDungeonFinder();
});
await sleep(600);
await clickIn(page, '[data-tab="board"]');
await sleep(600);
await shot(page, 'dungeon-finder-desktop-board.jpg');

// --- Quick Match: staged checklist, then a live proposal ---
await page.evaluate(() => {
  const sim = window.__game.sim;
  sim.dungeonFinderListingClose();
  const [healer] = window.__dfBots;
  sim.dungeonFinderListingClose(healer);
});
await sleep(400);
await clickIn(page, '[data-tab="queue"]');
await sleep(300);
await clickIn(page, '[data-opt="hollow_crypt_normal"]');
await sleep(400);
await shot(page, 'dungeon-finder-desktop-queue.jpg');

await page.evaluate(() => {
  const sim = window.__game.sim;
  for (const pid of window.__dfBots) sim.dungeonFinderQueueJoin(['hollow_crypt_normal'], pid);
});
await clickIn(page, '[data-act="join"]');
await page.waitForFunction(() => window.__game.sim.dungeonFinderInfo?.proposal !== null, {
  timeout: 10000,
  polling: 200,
});
await sleep(800);
// The bots auto-accept, so the popup meters already show 4/5: capture it both
// over the open window and standalone over the world.
await shot(page, 'dungeon-finder-desktop-proposal.jpg');
await page.evaluate(() => window.__game.hud.toggleDungeonFinder());
await sleep(400);
await shot(page, 'dungeon-finder-desktop-proposal-popup.jpg');

// Accept through the popup: the finder forms the party in place (no teleport).
await page.evaluate(() => {
  document.querySelector('#dfinder-proposal-popup [data-dfp="accept"]').click();
});
await sleep(1200);
const party = await page.evaluate(() => {
  const sim = window.__game.sim;
  const p = sim.partyOf(sim.playerId);
  return p ? { size: p.members.length, leader: p.leader === sim.playerId } : null;
});
console.log('formed party:', JSON.stringify(party));

// --- Catalogue detail: the heroic five-man and the raid, at cap with a spec ---
await page.evaluate(() => {
  const sim = window.__game.sim;
  sim.setPlayerLevel(20);
  sim.setSpec('prot');
  window.__game.hud.toggleDungeonFinder(); // reopen after the popup-only shot
});
await sleep(400);
await clickIn(page, '[data-tab="catalogue"]');
await sleep(300);
await clickIn(page, '[data-row="hollow_crypt_heroic"]');
await sleep(800);
await shot(page, 'dungeon-finder-desktop-catalogue-heroic.jpg');
await clickIn(page, '[data-row="nythraxis_boss_arena_normal"]');
await sleep(800);
await shot(page, 'dungeon-finder-desktop-catalogue-raid.jpg');

// "Show on Map": closes the finder, opens the map on the entrance zone, pings it.
await clickIn(page, '[data-showmap]');
await sleep(900);
await shot(page, 'dungeon-finder-desktop-show-on-map.jpg');
await page.close();

// ---------------------------------------------------------------------------
// Mobile portrait 390x844 and landscape 844x390.
// ---------------------------------------------------------------------------
async function mobilePage(width, height) {
  const p = await browser.newPage();
  await p.setViewport({ width, height, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const cdp = await p.target().createCDPSession();
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [
      { name: 'pointer', value: 'coarse' },
      { name: 'hover', value: 'none' },
    ],
  });
  return p;
}

const portrait = await mobilePage(390, 844);
await bootOffline(portrait, 'Anvilp');
await seedFinderState(portrait);
await portrait.evaluate(() => window.__game.hud.toggleDungeonFinder());
await sleep(700);
await shot(portrait, 'dungeon-finder-mobile-portrait-list.jpg');
await clickIn(portrait, '[data-row="hollow_crypt_normal"]');
await sleep(700);
await shot(portrait, 'dungeon-finder-mobile-portrait-detail.jpg');
await clickIn(portrait, '[data-back]');
await sleep(300);
await clickIn(portrait, '[data-tab="queue"]');
await sleep(500);
await shot(portrait, 'dungeon-finder-mobile-portrait-queue.jpg');
await portrait.close();

const landscape = await mobilePage(844, 390);
await bootOffline(landscape, 'Anvill');
await seedFinderState(landscape);
await landscape.evaluate(() => window.__game.hud.toggleDungeonFinder());
await sleep(700);
await clickIn(landscape, '[data-row="hollow_crypt_normal"]');
await sleep(700);
await shot(landscape, 'dungeon-finder-mobile-landscape-detail.jpg');
await landscape.close();

await browser.close();
if (errors.length) {
  console.error('page errors:\n' + errors.join('\n'));
  process.exit(1);
}
console.log('done');
