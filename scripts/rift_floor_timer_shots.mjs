// Screenshot capture for issue #2655 (rift floor + closing-timer HUD tracker).
// Offline only: enters the local Vite dev client, drives a rift entirely through
// the offline sim seam (window.__game.world), and captures the new #rift-tracker
// strip. Needs `npm run dev` (or an equivalent Vite dev server) running.
//
// Cases captured:
//   after-desktop            natural-portal-shaped rift (a real backing RiftEvent),
//                             showing "Floor N of M" + a live "closes in" countdown.
//   after-mobile              same rift, landscape mobile viewport (in-game mobile is
//                             landscape-only on the web client).
//   after-desktop-devportal   a /dev portal (no backing RiftEvent): floor progress
//                             only, confirming the timer line is omitted rather than
//                             showing a bogus/zero value.
//   after-desktop-lowtier     the same live-timer rift on the Low graphics preset
//                             (?gfx=low), confirming this actionable info is never
//                             shed by a tier (graphics-settings-fairness).

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';
import { suppressGpuNotice } from './lib/gpu_notice_suppress.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = process.env.SHOTS_DIR ?? 'docs/screenshots/rift-floor-timer-hud';
fs.mkdirSync(OUT, { recursive: true });
// Reruns get a fresh name suffix (classic letters-only name rule elsewhere in scripts/),
// though each puppeteer.launch() below also gets its own ephemeral profile.
const alpha =
  Date.now()
    .toString(36)
    .replace(/[^a-z]/gi, '')
    .slice(-4) || 'abcd';

const errors = [];

function watch(page, tag) {
  page.on('pageerror', (e) => errors.push(`PAGEERROR(${tag}): ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`CONSOLE(${tag}): ${m.text()}`);
  });
}

const tick = (page, frames = 40) =>
  page.evaluate(async (n) => {
    for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r));
  }, frames);

/** Spawn a /dev portal, optionally give it a real backing RiftEvent (like a natural
 *  world portal would have), walk the player through it, and let the tracker settle. */
async function enterRift(page, { withEvent }) {
  await page.evaluate(() => window.__game.world.chat('/dev god', window.__game.world.player.id));
  // Rifts are level-20 gated on entry (walking through the portal), not on spawn.
  await page.evaluate(() =>
    window.__game.world.chat('/dev level 20', window.__game.world.player.id),
  );
  await page.evaluate(() =>
    window.__game.world.chat('/dev portal 91 20', window.__game.world.player.id),
  );
  await tick(page, 5);
  await page.evaluate((withEvent) => {
    const w = window.__game.world;
    const portal = [...w.entities.values()].find((e) => e.templateId === 'rift_portal');
    if (withEvent && portal) {
      const eventId = 'shot-rift-event';
      portal.riftEventId = eventId;
      w.riftEvents.push({
        eventId,
        ordinal: 1,
        portalId: portal.id,
        status: 'open',
        tier: 'C',
        zoneId: 'shot_zone',
        zoneName: 'Shot Zone',
        riftName: 'Screenshot Rift',
        seed: 91,
        baseLevel: 20,
        openedAt: w.time,
        expiresAt: w.time + 3600, // RIFT_PORTAL_LIFETIME
        position: { x: portal.pos.x, z: portal.pos.z },
        contentId: 'shot',
        contentHash: 'shot',
        contentLocked: false,
        upgradeStatus: 'heuristic',
        upgrade: null,
        assetPipeline: { status: 'none', jobId: null, requestIds: [] },
        firstClear: null,
      });
    }
    if (portal) w.player.pos = { ...portal.pos };
  }, withEvent);
  await tick(page, 60);
}

async function shoot(page, name) {
  const file = `${OUT}/${name}.png`;
  await page.screenshot({ path: file });
  console.log('shot:', file);
}

async function withPage(browser, tag, setup, run) {
  const page = await browser.newPage();
  watch(page, tag);
  try {
    await suppressGpuNotice(page);
    await setup(page);
    await page.waitForFunction(() => !!window.__game?.world?.player, {
      timeout: 60000,
      polling: 200,
    });
    await run(page);
  } catch (e) {
    errors.push(`SCENE ${tag}: ${e.message}`);
  } finally {
    await page.close().catch(() => {});
  }
}

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1280,800', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1280, height: 800 },
});

try {
  // --- Desktop: live-timer rift ---------------------------------------------------
  await withPage(
    browser,
    'desktop',
    async (page) => {
      await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await enterOfflineGame(page, { charName: `Rifter${alpha}` });
    },
    async (page) => {
      await enterRift(page, { withEvent: true });
      const info = await page.evaluate(() => ({
        rf: window.__game.world.riftFloor,
        remaining: window.__game.world.riftEventMsRemaining(),
      }));
      console.log('desktop rift state:', JSON.stringify(info));
      await shoot(page, 'after-desktop');
      // A second shot a couple seconds later proves the countdown ticks locally
      // (no reconnect, no snapshot round trip: this is single-player offline).
      await new Promise((r) => setTimeout(r, 2500));
      await tick(page, 10);
      const info2 = await page.evaluate(() => window.__game.world.riftEventMsRemaining());
      console.log('desktop rift remaining after 2.5s wall-clock:', info2);
      await shoot(page, 'after-desktop-ticked');
    },
  );

  // --- Desktop: dev-portal degrade case (no backing event, no timer line) --------
  await withPage(
    browser,
    'devportal',
    async (page) => {
      await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await enterOfflineGame(page, { charName: `DevTest${alpha}` });
    },
    async (page) => {
      await enterRift(page, { withEvent: false });
      await shoot(page, 'after-desktop-devportal');
    },
  );

  // --- Desktop: Low graphics preset (actionable info must survive every tier) -----
  await withPage(
    browser,
    'lowtier',
    async (page) => {
      await page.goto(`${URL}/?gfx=low`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await enterOfflineGame(page, { charName: `LowTier${alpha}` });
    },
    async (page) => {
      await enterRift(page, { withEvent: true });
      await shoot(page, 'after-desktop-lowtier');
    },
  );

  // --- Mobile landscape: live-timer rift ------------------------------------------
  await withPage(
    browser,
    'mobile',
    async (page) => {
      await page.emulate({
        viewport: { width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      });
      await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.evaluate(() => document.body.classList.add('mobile-touch'));
      await enterOfflineGame(page, { charClass: 'mage', charName: `Aldwin${alpha}` });
    },
    async (page) => {
      await enterRift(page, { withEvent: true });
      await shoot(page, 'after-mobile');
    },
  );
} finally {
  await browser.close();
}

console.log(`\nerrors during run: ${errors.length}`);
for (const e of errors.slice(0, 30)) console.log(`  ${e}`);
process.exit(errors.some((e) => e.startsWith('PAGEERROR') || e.startsWith('SCENE')) ? 1 : 0);
