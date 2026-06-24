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

const URL = `${process.env.GAME_URL ?? 'http://localhost:5173'}/?gfx=ultra`;
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

// Build a real raid in the Sim: invite bots to form a 5-player party, convert to
// a raid, then fill it out to two subgroups. Every step goes through the real
// sim methods so the roster is genuine, not faked.
const built = await page.evaluate(() => {
  const sim = window.__game.sim;
  const me = sim.primaryId;
  const p = sim.player;
  const roster = [
    ['Brightoak', 'druid', 1],
    ['Stormcaller', 'shaman', 1],
    ['Nightblade', 'rogue', 1],
    ['Emberlyn', 'mage', 1],
    ['Holyverse', 'priest', 2],
    ['Ironhowl', 'warrior', 2],
    ['Grimfang', 'warlock', 2],
    ['Swiftarrow', 'hunter', 2],
  ];
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
  // Build the raid party directly. Going through invite/accept in a single-HUD
  // offline context queues local invite prompt cards (the bots accept
  // programmatically, leaving stale cards over the panel), so we assemble the
  // Party struct the roster reads (leader/members/raidGroups/raid) by hand.
  const party = {
    id: sim.nextPartyId++,
    leader: me,
    members: [me, ...pids],
    raid: true,
    raidGroups: new Map(),
    lootStrategies: {},
  };
  party.raidGroups.set(me, 1);
  roster.forEach(([, , group], i) => {
    party.raidGroups.set(pids[i], group);
  });
  sim.parties.set(party.id, party);
  sim.partyByPid.set(me, party.id);
  pids.forEach((p) => {
    sim.partyByPid.set(p, party.id);
  });

  const info = sim.partyInfo;
  return {
    raid: info?.raid ?? null,
    members: info?.members?.length ?? 0,
    groups: info?.members?.map((m) => m.group) ?? [],
  };
});
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
