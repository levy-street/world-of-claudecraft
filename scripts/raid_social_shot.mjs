// Visual capture for the raid-roster social panel fix (raid members now appear).
// Boots the offline game at MAX graphics (?gfx=ultra), builds a real raid in the
// Sim (leader + bots across two subgroups), then screenshots the Social panel's
// Raid tab and the in-world raid frames. Needs `npm run dev` on :5173.
//
// The bug it illustrates was online-only: the server party wire dropped the
// `raid` flag and each member's `group`, so the online raid roster rendered
// empty. Offline always carried those fields, so this offline capture shows the
// exact roster UI the server-side fix restores for online raids.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';
import { PLAYABLE_CLASSES } from './lib/playable_classes.mjs';

const URL = `${process.env.GAME_URL ?? 'http://localhost:5173'}/?gfx=ultra`;
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RAID_BOT_NAMES = {
  warrior: 'Ironhowl',
  swordmaster: 'Azureedge',
  hunter: 'Swiftarrow',
  rogue: 'Nightblade',
  priest: 'Holyverse',
  shaman: 'Stormcaller',
  mage: 'Emberlyn',
  warlock: 'Grimfang',
  druid: 'Brightoak',
};
const RAID_ROSTER = PLAYABLE_CLASSES.filter((cls) => cls !== 'paladin').map((cls) => [
  RAID_BOT_NAMES[cls],
  cls,
]);

const PROFILE =
  process.env.CHROME_PROFILE_DIR ?? `${process.env.TMPDIR ?? '/tmp'}/raid-shot-profile`;
fs.rmSync(PROFILE, { recursive: true, force: true });
fs.mkdirSync(PROFILE, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  protocolTimeout: 120000,
  userDataDir: PROFILE,
  args: [
    '--window-size=1366,820',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
    '--disable-breakpad',
    '--disable-crash-reporter',
    '--disable-dev-shm-usage',
  ],
  defaultViewport: { width: 1366, height: 820 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
// This is a roster capture, so resolve the unrelated one-shot camera choice
// before world entry. Its delayed spawn can otherwise cover the finished shot.
await page.evaluate(() => localStorage.setItem('woc.cameraModePrompt.shown', '1'));
const clk = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);
await page.waitForSelector('#btn-offline', { timeout: 20000 });
await clk('#btn-offline');
await sleep(300);
await page.type('#char-name', 'Raidlead');
await clk('#offline-select .mini-class[data-class="paladin"]');
await sleep(150);
await clk('#btn-start-offline');
// Ultra graphics on software GL boots slowly; poll generously for the globals.
await page.waitForFunction(() => window.__game?.renderer && window.__game.sim, {
  timeout: 110000,
  polling: 500,
});
await sleep(2500);

// Build a real raid in the Sim: invite four bots to form a full party, convert
// it to a raid, then invite the remaining five. Every step goes through the
// public party methods so this follows the live PartyMachine seam.
const built = await page.evaluate((roster) => {
  const sim = window.__game.sim;
  const me = sim.primaryId;
  const p = sim.player;
  // Spawn bots in a cluster near the leader so the in-world frames have live units.
  const pids = roster.map(([name, cls], i) => {
    const pid = sim.addPlayer(cls, name);
    const e = sim.entities.get(pid);
    if (e) {
      e.pos = { x: p.pos.x + (i % 4) * 2 - 3, y: p.pos.y, z: p.pos.z + Math.floor(i / 4) * 2 + 2 };
      e.prevPos = { ...e.pos };
    }
    return pid;
  });
  for (const pid of pids.slice(0, 4)) {
    sim.partyInvite(pid, me);
    sim.partyAccept(pid);
  }
  sim.convertPartyToRaid(me);
  for (const pid of pids.slice(4)) {
    sim.partyInvite(pid, me);
    sim.partyAccept(pid);
  }
  // The local HUD never needs to render the programmatically accepted invite
  // prompts that were emitted while constructing this screenshot state.
  sim.drainEvents();

  const info = sim.partyInfo;
  return {
    raid: info?.raid ?? null,
    members: info?.members?.length ?? 0,
    groups: info?.members?.map((m) => m.group) ?? [],
  };
}, RAID_ROSTER);
console.log('raid built:', JSON.stringify(built));

// Dismiss the new-adventurer tutorial card so it does not overlay the panel.
await page.evaluate(() => document.querySelector('.tut-skip')?.click());
await sleep(300);

// Open the Social panel and switch to the Raid tab.
await page.evaluate(() => window.__game.hud.toggleSocial());
await sleep(400);
await clk('#social-window [data-tab="raid"]');
await sleep(600);
const raidRows = await page.evaluate(
  () =>
    document.querySelectorAll(
      '#social-window .soc-body .raid-row, #social-window .soc-body [data-raid-pid]',
    ).length,
);
console.log('raid roster rows rendered:', raidRows);
console.log(
  `raid tab text:\n${await page.evaluate(
    () => document.querySelector('#social-window .soc-body')?.innerText ?? '(no body)',
  )}`,
);
// Full-frame shot (panel over the 3D world at ultra graphics), then a clipped
// shot of just the social window for a legible roster close-up.
await page.screenshot({ path: 'tmp/raid_social_panel.png' });
const box = await page.evaluate(() => {
  const el = document.querySelector('#social-window');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {
    x: Math.max(0, r.x - 8),
    y: Math.max(0, r.y - 8),
    width: r.width + 16,
    height: r.height + 16,
  };
});
if (box && box.width > 10) await page.screenshot({ path: 'tmp/raid_social_roster.png', clip: box });

// Close the panel and capture the in-world raid frames over the 3D scene.
await page.evaluate(() => window.__game.hud.toggleSocial());
await sleep(500);
await page.screenshot({ path: 'tmp/raid_world_frames.png' });
const frames = await page.evaluate(() => document.querySelectorAll('.party-frame').length);
console.log('in-world party/raid frames:', frames);

console.log(built.raid && built.members >= 8 ? 'RAID OK' : 'RAID FAIL');
await browser.close();
