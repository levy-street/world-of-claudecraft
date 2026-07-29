// Screenshot harness for #2526: what the master looter sees when a candidate leaves
// during the curate window. Boots the offline world, forms a three-person party with
// master loot on, and opens a REAL curate-phase roll off a real corpse; every state
// change below goes through the sim and the shipped controls, nothing is faked into
// the HUD.
//
// Shoots the same fixed region three times, so the branch and the base produce
// directly comparable frames:
//   1-prompt       the curate prompt, open with all three candidates. Identical on
//                  both trees.
//   2-roster       a candidate has logged out and NOTHING has been clicked. On this
//                  branch the row has followed the roll's roster and dropped her; on
//                  the base tree the checkbox list is still the open-time snapshot,
//                  which is what lets the looter pick someone the sim will refuse.
//   3-after-grace  after a refusal that IS still reachable (the candidate leaves in
//                  the same frame as the click, staged atomically here) and past the
//                  re-show grace. On this branch the prompt is back; on the base tree
//                  it stays gone until the 300s timeout, which IS the bug.
//
// Every frame reads the row state before AND after the raster and refuses to write a
// frame the two disagree on. That guard is load-bearing: page.screenshot waits for a
// composited frame, and under swiftshader that wait runs to several seconds, so a
// capture aimed at a short-lived state can silently raster a later one. All three
// states above are deliberately stable ones for that reason.
//
// Needs a dev server (default :5173, override GAME_URL). Renders at ?gfx=medium: the
// subject is a DOM panel, so 3D richness buys nothing and costs raster time.
// Output prefix defaults to tmp/master-loot-refusal-, override SHOT_PREFIX.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = `${process.env.GAME_URL ?? 'http://localhost:5173'}/?gfx=medium`;
const PREFIX = process.env.SHOT_PREFIX ?? 'tmp/master-loot-refusal-';
fs.mkdirSync(PREFIX.slice(0, PREFIX.lastIndexOf('/')) || '.', { recursive: true });
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
// The shared entry flow, which also dismisses the intro cinematic that otherwise
// keeps #ui hidden (and would make every clip measure zero).
const booted = await enterOfflineGame(page, {
  charClass: 'warrior',
  charName: 'Sortwyn',
  settleMs: 2500,
  gameBootTimeoutMs: 120000,
});
if (!booted) throw new Error('the offline world never booted');
await page.waitForFunction(() => window.__game?.hud, { timeout: 60000 });

// A real three-person party on a real corpse holding a threshold drop, with master
// loot on. Nothing here is faked into the HUD: lootCorpse opens the roll and emits
// the masterLoot event the prompt renders from.
const staged = await page.evaluate(() => {
  const sim = window.__game.sim;
  const me = sim.playerId;
  const player = sim.entities.get(me);
  const berta = sim.addPlayer('mage', 'Berta');
  const cara = sim.addPlayer('rogue', 'Cara');
  for (const pid of [berta, cara]) {
    sim.partyInvite(pid, me);
    sim.partyAccept(pid);
    const e = sim.entities.get(pid);
    e.pos = { x: player.pos.x + 1, y: player.pos.y, z: player.pos.z + 1 };
    e.prevPos = { ...e.pos };
  }
  sim.setPartyLootMaster(true, 0, 'uncommon', me);

  // Hijack a live world mob into a freshly tapped corpse next to the party, so the
  // loot path is the real one (no createMob import is reachable from the page).
  const mob = [...sim.entities.values()].find((e) => e.kind === 'mob' && !e.dead);
  if (!mob) return { ok: false, reason: 'no mob available in the generated world' };
  mob.pos = { x: player.pos.x, y: player.pos.y, z: player.pos.z + 2 };
  mob.prevPos = { ...mob.pos };
  mob.dead = true;
  mob.lootable = true;
  mob.tappedById = me;
  mob.loot = { copper: 0, items: [{ itemId: 'greyjaw_hide_boots', count: 1 }] };
  sim.lootCorpse(mob.id, me);
  const roll = sim.activeMasterLootRolls
    ? sim.activeMasterLootRolls(me)[0]
    : { rollId: null, candidates: [] };
  return { ok: true, me, berta, cara, rollId: roll?.rollId ?? null };
});
if (!staged.ok) throw new Error(staged.reason);
await sleep(800);

// The fixed clip: the prompt's own box while it is up, padded. Reused for all three
// frames so the empty states are the SAME region, not a shrunken one.
const box = await page.evaluate(() => {
  const el = document.querySelector('#loot-rolls');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
});
if (!box || box.width === 0) throw new Error('the master-loot prompt never rendered');
const clip = {
  x: Math.max(0, box.x - 16),
  y: Math.max(0, box.y - 16),
  width: box.width + 32,
  height: box.height + 32,
};
// Reads the row state, shoots, and reads it AGAIN, so a frame that drifted past
// the moment it is named for cannot pass unnoticed. The second read is the
// load-bearing one: page.screenshot waits for a composited frame, and under
// swiftshader that wait can outlast the 2s re-show grace, so a capture taken while
// the row is legitimately gone can still raster the row on its way back.
const shots = [];
const rowState = () =>
  page.evaluate(() => {
    const row = document.querySelector('#loot-rolls .loot-roll.master');
    if (!row) return { shown: false, candidates: [] };
    return { shown: true, candidates: [...row.querySelectorAll('.ml-pick')].map((p) => p.value) };
  });

async function capture(name) {
  const before = await rowState();
  const startedAt = Date.now();
  await page.screenshot({ path: `${PREFIX}${name}.png`, clip });
  const rasterMs = Date.now() - startedAt;
  const after = await rowState();
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw new Error(
      `${name}: the row changed during a ${rasterMs}ms raster (${JSON.stringify(before)} -> ` +
        `${JSON.stringify(after)}), so the frame cannot be trusted`,
    );
  }
  shots.push({ name, rasterMs, ...after });
  return after;
}

await capture('1-prompt');

// Cara logs out mid-window. The sim drops her from the roll immediately; whether the
// on-screen checkbox list follows is the difference between the two trees.
await page.evaluate((cara) => window.__game.sim.removePlayer(cara), staged.cara);
await sleep(1500);
await capture('2-roster');

// The refusal that survives the roster refresh: the candidate leaves in the SAME
// frame as the click. Staged atomically in one evaluate, so no HUD frame runs
// between checking Berta, the sim dropping her, and the Roll button firing. This is
// the real race, not a synthetic call: the click goes through the shipped button.
const clicked = await page.evaluate((berta) => {
  const row = document.querySelector('#loot-rolls .loot-roll.master');
  if (!row) return { ok: false, reason: 'no master row on screen' };
  const target = [...row.querySelectorAll('.ml-pick')].find((p) => Number(p.value) === berta);
  if (!target) return { ok: false, reason: 'the intended candidate is not on the row' };
  target.checked = true;
  target.dispatchEvent(new Event('change'));
  const roll = row.querySelector('.ml-roll');
  if (!roll || roll.disabled) return { ok: false, reason: 'roll button stayed disabled' };
  window.__game.sim.removePlayer(berta); // she leaves before the command lands
  roll.click();
  return { ok: true, pid: target.value };
}, staged.berta);
if (!clicked.ok) throw new Error(clicked.reason);

// Past the re-show grace (LOOT_ROLL_REGRACE_MS is 2s), with frames still running.
// On the base tree this stays empty until MASTER_LOOT_TIMEOUT, which is the bug.
await sleep(4000);
await capture('3-after-grace');

await browser.close();
console.log(`assigned to pid ${clicked.pid}, who left in the same frame as the click`);
for (const shot of shots) console.log(`  ${PREFIX}${shot.name}.png`, JSON.stringify(shot));
