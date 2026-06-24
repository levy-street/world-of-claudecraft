// Visual capture for the raid -> party demotion feature (PR #880 review request
// by patrick261). Boots the offline game at MAX graphics (?gfx=ultra), builds a
// real small raid in the Sim (leader + 4 bots, <= one party's worth), screenshots
// the Social panel Raid tab showing the new "Convert to party" button, clicks it
// through the real sim path, then screenshots the panel after the raid has folded
// back into a normal party. Needs `npm run dev` on :5173.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = `${process.env.GAME_URL ?? 'http://localhost:5173'}/?gfx=ultra`;
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PROFILE =
  process.env.CHROME_PROFILE_DIR ?? `${process.env.TMPDIR ?? '/tmp'}/raid2party-profile`;
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
await page.waitForFunction(() => window.__game?.renderer && window.__game.sim, {
  timeout: 110000,
  polling: 500,
});
await sleep(2500);

// Build a real 5-player raid (leader + 4) so it is <= one party's worth and the
// "Convert to party" control is offered. Assemble the Party struct directly (going
// through invite/accept in single-HUD offline queues stale invite cards).
const built = await page.evaluate(() => {
  const sim = window.__game.sim;
  const me = sim.primaryId;
  const p = sim.player;
  const roster = [
    ['Brightoak', 'druid', 1],
    ['Stormcaller', 'shaman', 1],
    ['Nightblade', 'rogue', 1],
    ['Emberlyn', 'mage', 1],
  ];
  const pids = roster.map(([name, cls], i) => {
    const pid = sim.addPlayer(cls, name);
    const e = sim.entities.get(pid);
    if (e) {
      e.pos = { x: p.pos.x + (i % 4) * 2 - 3, y: p.pos.y, z: p.pos.z + 2 };
      e.prevPos = { ...e.pos };
    }
    return pid;
  });
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
  pids.forEach((q) => {
    sim.partyByPid.set(q, party.id);
  });
  const info = sim.partyInfo;
  return { raid: info?.raid ?? null, members: info?.members?.length ?? 0 };
});
console.log('raid built:', JSON.stringify(built));

await page.evaluate(() => document.querySelector('.tut-skip')?.click());
await sleep(300);

// Open Social -> Raid tab. With a <= 5 raid the leader sees "Convert to party".
await page.evaluate(() => window.__game.hud.toggleSocial());
await sleep(400);
await clk('#social-window [data-tab="raid"]');
await sleep(600);
const hasBtn = await page.evaluate(
  () => !!document.querySelector('#social-window [data-act="convert-party"]'),
);
console.log('convert-to-party button present:', hasBtn);
console.log(
  `raid tab text (before):\n${await page.evaluate(
    () => document.querySelector('#social-window .soc-body')?.innerText ?? '(no body)',
  )}`,
);

const clipSocial = async (path) => {
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
  if (box && box.width > 10) await page.screenshot({ path, clip: box });
};
await page.screenshot({ path: 'tmp/raid2party_before_panel.png' });
await clipSocial('tmp/raid2party_before.png');

// Click the new control: raid folds back into a party.
await clk('#social-window [data-act="convert-party"]');
await sleep(600);
const afterRaid = await page.evaluate(() => window.__game.sim.partyInfo?.raid ?? null);
console.log('party.raid after convert:', afterRaid);
console.log(
  `raid tab text (after):\n${await page.evaluate(
    () => document.querySelector('#social-window .soc-body')?.innerText ?? '(no body)',
  )}`,
);
await page.screenshot({ path: 'tmp/raid2party_after_panel.png' });
await clipSocial('tmp/raid2party_after.png');

console.log(
  built.raid && built.members === 5 && hasBtn && afterRaid === false
    ? 'CONVERT OK'
    : 'CONVERT FAIL',
);
await browser.close();
