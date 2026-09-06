// Bespoke capture for the Wyrmgate Waystone (a teleport-based, two-zone flow the
// target table cannot express): the Highwatch arch, the toll refusal toast, and the
// paid crossing landing in Wyrmwatch. MODE=before shoots the same spots on a base
// checkout (empty ground). Launch block copied verbatim from pr_screenshots.mjs.
//   GAME_URL=http://localhost:5211 MODE=after SHOTS_DIR=pr-shots node scripts/waystone_shot.mjs
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { dismissEntryOverlays, enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const MODE = process.env.MODE ?? 'after';
const OUT = process.env.SHOTS_DIR ?? 'pr-shots';
mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ENTRY_OPTS = { settleMs: 3000, selectorTimeoutMs: 90000, gameBootTimeoutMs: 60000 };

const SIDE_A = { x: 52, z: 668 };
const SIDE_B = { x: 383, z: 2029 };

async function seed(page) {
  await page.evaluateOnNewDocument(() => {
    try {
      localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: 1 }));
      localStorage.removeItem('woc_entry_probe');
      localStorage.setItem('woc.cameraModePrompt.shown', '1');
    } catch {}
  });
}

async function veilSettled(page, streakMs = 3000) {
  const deadline = Date.now() + 120000;
  let hiddenSince = null;
  while (Date.now() < deadline) {
    const hidden = await page.evaluate(() => {
      const veil = document.getElementById('loading-screen');
      if (!veil) return true;
      const s = getComputedStyle(veil);
      return s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0;
    });
    if (hidden) {
      hiddenSince ??= Date.now();
      if (Date.now() - hiddenSince >= streakMs) return;
    } else hiddenSince = null;
    await wait(250);
  }
}

// Stand the player at (x,z) looking along `facing` (forward = (-sin f, cos f)).
async function stand(page, x, z, facing, copper) {
  await page.evaluate(
    (x, z, facing, copper) => {
      const sim = window.__game?.sim;
      const p = sim?.player;
      if (!p) return;
      document.getElementById('tutorial-greeting')?.remove();
      for (const e of sim.entities.values()) {
        if (e.kind !== 'mob' || e.dead) continue;
        e.dead = true;
        e.aiState = 'dead';
        e.hp = 0;
        e.respawnTimer = 9999;
        e.corpseTimer = 9999;
      }
      const g = sim.groundPos(x, z);
      p.pos.x = g.x;
      p.pos.y = g.y;
      p.pos.z = g.z;
      p.prevPos = { ...p.pos };
      p.facing = facing;
      p.inCombat = false;
      p.combatTimer = 0;
      p.portalHoldId = undefined;
      const meta = sim.players.get(sim.primaryId);
      if (meta && copper != null) meta.copper = copper;
    },
    x,
    z,
    facing,
    copper,
  );
}

async function shoot(page, name) {
  await veilSettled(page);
  await wait(900);
  await page.screenshot({ path: `${OUT}/${MODE}-${name}.png` });
  console.log('shot', `${OUT}/${MODE}-${name}.png`);
}

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
try {
  const page = await browser.newPage();
  await seed(page);
  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 120000 });
  await enterOfflineGame(page, { charClass: 'warrior', charName: 'Aldwin', ...ENTRY_OPTS });
  await dismissEntryOverlays(page);
  // 1. The Highwatch arch, seen from the town side (facing +x = east).
  await stand(page, SIDE_A.x - 7, SIDE_A.z + 1, -Math.PI / 2, 0);
  await wait(4000);
  await shoot(page, 'highwatch-arch');
  // 2. The Last Keep arch, seen from just inside the main gate (facing east).
  await stand(page, SIDE_B.x - 7, SIDE_B.z + 0.5, -Math.PI / 2, 0);
  await wait(4000);
  await shoot(page, 'last-keep-arch');
  // 2b. The keep's market row: the sutler and the sergeant (facing the well).
  await stand(page, 404, 2040, -0.9, 0);
  await wait(4000);
  await shoot(page, 'last-keep-bailey');
  if (MODE === 'after') {
    // 3. Broke: step into the Highwatch arch, the toll refusal.
    await stand(page, SIDE_A.x - 7, SIDE_A.z + 1, -Math.PI / 2, 0);
    await wait(2500);
    await stand(page, SIDE_A.x, SIDE_A.z, -Math.PI / 2, 0);
    await wait(900);
    await shoot(page, 'toll-refused');
    // 4. Paid: step out, take a gold coin, step back in, land in Wyrmwatch.
    await stand(page, SIDE_A.x - 7, SIDE_A.z + 1, -Math.PI / 2, 10_000);
    await wait(1500);
    await stand(page, SIDE_A.x, SIDE_A.z, -Math.PI / 2, 10_000);
    await wait(5000);
    await shoot(page, 'last-keep-arrival');
    await page.close();
    // 5. Mobile (landscape): the paid crossing landing.
    const mobile = await browser.newPage();
    await seed(mobile);
    await mobile.emulate({
      viewport: { width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    });
    await mobile.goto(URL, { waitUntil: 'networkidle0', timeout: 120000 });
    await mobile.evaluate(() => document.body.classList.add('mobile-touch'));
    await enterOfflineGame(mobile, { charClass: 'mage', charName: 'Aldwin', ...ENTRY_OPTS });
    await dismissEntryOverlays(mobile);
    await stand(mobile, SIDE_A.x - 7, SIDE_A.z + 1, -Math.PI / 2, 10_000);
    await wait(2500);
    await stand(mobile, SIDE_A.x, SIDE_A.z, -Math.PI / 2, 10_000);
    await wait(5000);
    await shoot(mobile, 'last-keep-arrival-mobile');
    await mobile.close();
  }
} finally {
  await browser.close();
}
