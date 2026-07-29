// Visual capture for issue 2652 (the map window draws no party markers, only
// the minimap does). Boots the offline game at MAX graphics (?gfx=ultra),
// builds a real small party in the Sim (bypassing invite/accept the way
// raid_to_party_shot.mjs does), then screenshots BOTH levels of the map
// window: the per-zone detail map and the continent "World Map" overview.
//
// The roster is deliberately split so one run proves both levels: two members
// stand inside the player's own zone (they appear on the zone map, which drops
// anyone out of zone) and two stand several zones north (they appear only on
// the world map, which is the surface that answers "which zone is the rest of
// my group in").
//
// Run once against the unmodified upstream build (BEFORE: no party markers on
// either level) and once against the fixed build (AFTER). Needs `npm run dev`
// running at GAME_URL: run it once against a checkout of the base commit and
// once against the fixed build, on two different ports if both need to run at
// once.
//
// Usage: GAME_URL=http://localhost:5173 OUT_PREFIX=tmp/before node scripts/zone_map_party_markers_shot.mjs
//        GAME_URL=http://localhost:5174 OUT_PREFIX=tmp/after  node scripts/zone_map_party_markers_shot.mjs
// Writes <prefix>-desktop.png (zone map) and <prefix>-world-desktop.png
// (continent). Add MOBILE=1 to also capture the 844x390 mobile-viewport pair.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const BASE_URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT_PREFIX = process.env.OUT_PREFIX ?? 'tmp/zone_map_party';
const MOBILE = process.env.MOBILE === '1';
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function buildPartyAndOpenMap(page) {
  // Build a real 4-member party directly in the Sim, the same technique
  // raid_to_party_shot.mjs uses (going through invite/accept in a single
  // offline HUD queues a stale invite card). Two members sit a few yards from
  // the player (in zone, so the zone map plots them) and two sit far north in
  // other zones (only the continent level plots them).
  const built = await page.evaluate(() => {
    const sim = window.__game.sim;
    const me = sim.primaryId;
    const p = sim.player;
    const roster = [
      // [class, name, x, z, dead]
      ['mage', 'Emberlyn', p.pos.x + 12, p.pos.z + 4, false],
      ['priest', 'Fallenora', p.pos.x - 12, p.pos.z - 6, true],
      ['rogue', 'Sableknife', 120, 620, false],
      ['druid', 'Thistlebark', -200, 1500, false],
    ];
    const pids = [me];
    for (const [cls, name, x, z, dead] of roster) {
      const pid = sim.addPlayer(cls, name);
      const e = sim.entities.get(pid);
      if (e) {
        e.pos = { x, y: p.pos.y, z };
        e.prevPos = { ...e.pos };
        if (dead) {
          e.dead = true;
          e.hp = 0;
        }
      }
      pids.push(pid);
    }
    const party = {
      id: sim.party.nextPartyId++,
      leader: me,
      members: pids,
      raid: false,
      raidGroups: new Map(),
      lootStrategies: {},
    };
    sim.party.parties.set(party.id, party);
    for (const pid of pids) sim.party.partyByPid.set(pid, party.id);
    const info = sim.partyInfo;
    return { members: info?.members?.map((m) => ({ name: m.name, cls: m.cls, dead: m.dead })) };
  });
  console.log('party built:', JSON.stringify(built));

  // Open the map window (M / minimap click both route to Hud.toggleMap()). It
  // always opens on the per-zone detail level.
  await page.evaluate(() => window.__game.hud.toggleMap());
  await sleep(700);
  return built;
}

/** Switch the open map window to the continent overview (the level toggle
 *  button, the same control a right-click on the zone map drives). */
async function showWorldMap(page) {
  await page.evaluate(() => document.querySelector('#map-level-toggle').click());
  await sleep(900);
}

async function clipElement(page, selector, path, margin = 8) {
  const box = await page.evaluate(
    (sel, m) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        x: Math.max(0, r.x - m),
        y: Math.max(0, r.y - m),
        width: r.width + m * 2,
        height: r.height + m * 2,
      };
    },
    selector,
    margin,
  );
  if (!box || box.width < 10) {
    console.log(`WARN: ${selector} not found or too small, falling back to full page`);
    await page.screenshot({ path });
    return;
  }
  await page.screenshot({ path, clip: box });
}

async function run(viewport, zonePath, worldPath) {
  const browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: 'new',
    protocolTimeout: 300000,
    args: [
      `--window-size=${viewport.width},${viewport.height}`,
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--no-sandbox',
      '--disable-breakpad',
      '--disable-crash-reporter',
      '--disable-dev-shm-usage',
    ],
    defaultViewport: viewport,
  });
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
    if (viewport.isMobile) await page.setViewport(viewport);
    await page.goto(`${BASE_URL}/?gfx=ultra`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const booted = await enterOfflineGame(page, {
      charClass: 'warrior',
      charName: 'Mapkeeper',
      settleMs: 2500,
      gameBootTimeoutMs: 240000,
      mobilePreflightTimeoutMs: 10000,
    });
    if (!booted) {
      console.log(`world never booted for ${zonePath}`);
      return false;
    }
    if (viewport.isMobile) {
      // Headless can't report pointer:coarse; force the gameplay body classes
      // the way mobile_minimap_safe_area.mjs does.
      await page.evaluate(() => document.body.classList.add('mobile-touch', 'game-active'));
      await sleep(300);
    }
    await buildPartyAndOpenMap(page);
    await clipElement(page, '#map-window', zonePath);
    console.log(`saved ${zonePath}`);
    await showWorldMap(page);
    await clipElement(page, '#map-window', worldPath);
    console.log(`saved ${worldPath}`);
    return true;
  } finally {
    await browser.close();
  }
}

const DESKTOP = { width: 1280, height: 800 };
// The game is landscape-locked on mobile (meta[name=orientation]=landscape; a
// portrait viewport shows only the "Rotate to Landscape" gate, never the map),
// so the mobile capture uses a landscape phone viewport.
const MOBILE_LANDSCAPE = { width: 844, height: 390, isMobile: true, hasTouch: true };

// DESKTOP_ONLY=1 skips the mobile variant; desktop always captures.
const DESKTOP_ONLY = process.env.DESKTOP_ONLY === '1';
const okDesktop = await run(
  DESKTOP,
  `${OUT_PREFIX}-desktop.png`,
  `${OUT_PREFIX}-world-desktop.png`,
);
let okMobile = true;
if (MOBILE && !DESKTOP_ONLY) {
  okMobile = await run(
    MOBILE_LANDSCAPE,
    `${OUT_PREFIX}-mobile.png`,
    `${OUT_PREFIX}-world-mobile.png`,
  );
}
process.exit(okDesktop && okMobile ? 0 : 1);
