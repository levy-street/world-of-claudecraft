// Phase 9b acceptance journey: q_farm_intro completes through CLIENT-FACING
// entry points only. This is the E2E that would have caught the Phase 9 (bn)
// gap (sim-API green with no player-reachable verb): it drives the real quest
// dialog rows, the real interact gesture (KeyF on desktop, the mobile-interact
// button on touch), the real plant sheet DOM, and asserts the quest's
// +150 xp / +50 copper turn-in.
//
// window.__game is used ONLY for the sanctioned staging set: position writes
// (the pr_shot_targets teleport idiom), hostile shoving, the xp/copper/level
// baseline reads, and issuing /dev farmgrow (the one sanctioned dev command,
// which moves readyAtMs only). NEVER for plantCrop, harvestCrop, convertHusks,
// or any quest verb: those go through the DOM a player uses.
//
// Prereq: the vite dev client must already be serving (default
// http://127.0.0.1:5188/; override with JOURNEY_URL). Start it with:
//   npx vite --port 5188 --strictPort --host 127.0.0.1
// and kill it by port afterwards (fuser -k 5188/tcp), never pkill -f.
//
// Usage:
//   node scripts/farming_journey_e2e.mjs [--mobile] [--shots <dir>]
// --mobile runs the same journey in the 844x390 LANDSCAPE touch viewport
// (the standing mobile capture rule) and interacts through the
// mobile-interact button. --shots saves the three evidence screenshots
// (plant sheet open, the knob row, the harvest moment) into <dir> with a
// -desktop/-mobile suffix. LOW graphics preset is seeded through localStorage
// BEFORE boot (the standing screenshots-on-low rule).
//
// Probe traps honored (all previously struck in the Phase 9 QA): no const
// named URL; the quest-row click can race a repaint, so the row click and the
// detail-button probe live in the same evaluate inside a retry loop; DOM
// waits poll computed visibility, never a fixed sleep alone.

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const MOBILE = process.argv.includes('--mobile');
const shotsFlag = process.argv.indexOf('--shots');
const SHOTS_DIR = shotsFlag >= 0 ? process.argv[shotsFlag + 1] : null;
const VARIANT = MOBILE ? 'mobile' : 'desktop';
const PAGE_URL = process.env.JOURNEY_URL || 'http://127.0.0.1:5188/';
const TRACKER_SELECTOR = MOBILE ? '#quest-strip' : '#quest-tracker';
const VIEW = MOBILE
  ? { width: 844, height: 390, isMobile: true, hasTouch: true }
  : { width: 1600, height: 900 };

// Jessica stands at (-15.5, -81.5) facing the beds; bed_eastbrook_1 is at
// (-24, -84). The bed arm resolves the caller's OWN nearest bed by proximity
// (INTERACT_RANGE), so the journey stands the player ON the bed.
const JESSICA_SPOT = { x: -17, z: -81.5 };
const BED_SPOT = { x: -24, z: -84 };

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let step = 0;
function ok(message) {
  step += 1;
  console.log(`[${step}] ${message}`);
}
function fail(message) {
  step += 1;
  console.error(`[${step}] FAIL: ${message}`);
  throw new Error(message);
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: 'new',
    args: [
      `--window-size=${VIEW.width},${VIEW.height}`,
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
    ],
    defaultViewport: VIEW,
  });
  try {
    const page = await browser.newPage();
    // LOW preset + the two overlay keys, seeded BEFORE the document loads:
    // the renderer reads graphicsPreset during startup, and the camera prompt
    // and GPU notice have both photobombed captures before.
    await page.evaluateOnNewDocument(
      `try {
        const k = 'woc_settings';
        const s = JSON.parse(localStorage.getItem(k) || '{}');
        s.graphicsPreset = 1;
        s.graphicsDefaultApplied = true;
        localStorage.setItem(k, JSON.stringify(s));
        localStorage.setItem('woc_gpu_notice_dismissed', '1');
        localStorage.setItem('woc.cameraModePrompt.shown', '1');
      } catch {}`,
    );
    await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

    const booted = await enterOfflineGame(page, {
      settleMs: 3000,
      selectorTimeoutMs: 60000,
      gameBootTimeoutMs: 60000,
    });
    if (!booted) fail('the offline world never booted (window.__game.sim.player absent)');
    ok(`world booted (${VARIANT}, offline Sim, LOW preset seeded pre-boot)`);

    // The overlay dismissal loop, run before every click (repo capture rule).
    const dismissOverlays = async () => {
      for (let i = 0; i < 3; i++) {
        await page.evaluate(() => {
          document.querySelector('.camera-prompt-confirm')?.click();
          document.querySelector('.tut-skip')?.click();
          document.querySelector('.gpu-notice-dismiss')?.click();
          document.querySelector('#gpu-notice')?.remove();
        });
        await wait(300);
      }
    };
    await dismissOverlays();

    const shot = async (name) => {
      if (!SHOTS_DIR) return;
      await page.screenshot({ path: path.join(SHOTS_DIR, `${name}-${VARIANT}.png`) });
    };
    const shotElement = async (selector, name) => {
      if (!SHOTS_DIR) return;
      const handle = await page.$(selector);
      if (handle) {
        await handle.screenshot({ path: path.join(SHOTS_DIR, `${name}-${VARIANT}.png`) });
      }
    };

    // Sanctioned staging reads: the xp/copper/level baseline.
    const before = await page.evaluate(() => ({
      xp: window.__game.sim.xp,
      copper: window.__game.sim.copper,
      level: window.__game.sim.player.level,
    }));
    ok(`baseline read: level ${before.level}, xp ${before.xp}, copper ${before.copper}`);

    // Sanctioned staging position write (the pr_shot_targets teleport idiom),
    // plus the hostile shove so nothing interrupts the dialog.
    const stageAt = (spot) =>
      page.evaluate((s) => {
        const sim = window.__game?.sim;
        const player = sim?.player;
        if (!player?.pos) return false;
        player.pos.x = s.x;
        player.pos.z = s.z;
        player.prevPos = { ...player.pos };
        for (const e of sim.entities.values()) {
          if (!e?.hostile || !e.pos) continue;
          const dx = e.pos.x - s.x;
          const dz = e.pos.z - s.z;
          if (dx * dx + dz * dz < 60 * 60) {
            e.pos.x += 500;
            e.pos.z += 500;
          }
        }
        return true;
      }, spot);

    // The real interact gesture: the mobile-interact button on touch (its
    // bindTouchTap click path is the same handler a finger reaches), KeyF on
    // desktop. Never a window.__game verb.
    const touchActive = await page.evaluate(() => document.body.classList.contains('mobile-touch'));
    const pressInteract = async () => {
      await dismissOverlays();
      await page.evaluate(() => {
        const el = document.activeElement;
        if (el && el !== document.body) el.blur?.();
      });
      if (MOBILE && touchActive) {
        await page.evaluate(() => document.getElementById('mobile-interact')?.click());
      } else {
        await page.keyboard.press('KeyF');
      }
    };
    if (MOBILE && !touchActive) {
      // A KeyF fallback would let a broken #mobile-interact wiring print
      // "JOURNEY PASS (mobile)"; the mobile run's whole point is the button.
      fail('touch interface inactive; the mobile journey must drive #mobile-interact');
    }

    const waitVisible = (selector, timeoutMs) =>
      page
        .waitForFunction(
          (sel) => {
            const el = document.querySelector(sel);
            if (!el || getComputedStyle(el).display === 'none') return false;
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          },
          { timeout: timeoutMs, polling: 200 },
          selector,
        )
        .then(() => true)
        .catch(() => false);

    const waitForTrackerText = (text, present = true) =>
      page
        .waitForFunction(
          (selector, expected, shouldBePresent) => {
            const root = document.querySelector(selector);
            const activeMatch =
              root !== null &&
              !root.classList.contains('empty') &&
              (root.textContent || '').includes(expected);
            return activeMatch === shouldBePresent;
          },
          { timeout: 10000, polling: 200 },
          TRACKER_SELECTOR,
          text,
          present,
        )
        .then(() => true)
        .catch(() => false);

    const readTrackerText = () =>
      page.evaluate(
        (selector) => document.querySelector(selector)?.textContent?.trim() ?? '',
        TRACKER_SELECTOR,
      );

    // The quest-row click can race a repaint: the row click and the
    // detail-button probe live in ONE evaluate, retried until the button is
    // both found and clicked.
    const driveQuestRowTo = async (buttonLabel) => {
      for (let attempt = 0; attempt < 8; attempt++) {
        const state = await page.evaluate((label) => {
          const dialog = document.querySelector('#quest-dialog');
          if (!dialog) return { clicked: false, row: false };
          const buttons = [...dialog.querySelectorAll('button.btn')];
          const target = buttons.find((b) => b.textContent === label);
          if (target) {
            target.click();
            return { clicked: true, row: false };
          }
          const row = dialog.querySelector('[data-quest="q_farm_intro"]');
          row?.click();
          return { clicked: false, row: !!row };
        }, buttonLabel);
        if (state.clicked) return true;
        await wait(500);
      }
      return false;
    };

    // ---- Accept at Jessica ------------------------------------------------
    if (!(await stageAt(JESSICA_SPOT))) fail('staging beside Farmer Jessica failed');
    ok(`staged beside Farmer Jessica at (${JESSICA_SPOT.x}, ${JESSICA_SPOT.z})`);
    await pressInteract();
    if (!(await waitVisible('#quest-dialog', 15000)))
      fail('the quest dialog never opened at Jessica (interact press)');
    ok('interact press opened the quest dialog at Farmer Jessica');
    if (!(await driveQuestRowTo('Accept')))
      fail('the First Furrow row / Accept button was never clickable');
    ok('clicked the q_farm_intro gossip row, then Accept');
    const tracked = await waitForTrackerText('First Furrow');
    if (!tracked) fail('First Furrow never appeared in the quest tracker after Accept');
    ok('First Furrow is tracked (quest tracker shows the quest)');
    await page.keyboard.press('Escape');
    await wait(400);

    // ---- Plant at bed_eastbrook_1 ----------------------------------------
    if (!(await stageAt(BED_SPOT))) fail('staging onto bed_eastbrook_1 failed');
    ok(`staged onto bed_eastbrook_1 at (${BED_SPOT.x}, ${BED_SPOT.z})`);
    await pressInteract();
    if (!(await waitVisible('#plant-sheet-window', 15000)))
      fail('the plant sheet never opened from the bed press');
    const sheet = await page.evaluate(() => {
      const root = document.querySelector('#plant-sheet-window');
      const seed = root?.querySelector('[data-seed-crop]');
      return {
        title: root?.querySelector('#plant-sheet-title')?.textContent ?? null,
        crop: seed?.dataset.seedCrop ?? null,
        // The seed rows are radios since the Phase 14 a11y batch.
        checked: seed?.getAttribute('aria-checked') ?? null,
        plant: !!root?.querySelector('[data-plant]'),
        knobs: [...(root?.querySelectorAll('.ps-knob-name') ?? [])].map((el) => el.textContent),
      };
    });
    if (sheet.crop !== 'vale_wheat' || !sheet.plant)
      fail(`plant sheet wrong: ${JSON.stringify(sheet)}`);
    ok(
      `interact press opened the plant sheet: title "${sheet.title}", seed row ${sheet.crop} ` +
        `(aria-checked ${sheet.checked}), knobs [${sheet.knobs.join(', ')}], Plant control present`,
    );
    await wait(600);
    await shot('plant-sheet-open');
    await shotElement('#plant-sheet-window .ps-knobs', 'plant-sheet-knobs');
    await page.evaluate(() => {
      const root = document.querySelector('#plant-sheet-window');
      root?.querySelector('[data-seed-crop="vale_wheat"]')?.click();
      root?.querySelector('[data-plant]')?.click();
    });
    const sheetClosed = await page
      .waitForFunction(
        () => {
          const el = document.querySelector('#plant-sheet-window');
          return !el || getComputedStyle(el).display === 'none' || el.childElementCount === 0;
        },
        { timeout: 10000, polling: 200 },
      )
      .then(() => true)
      .catch(() => false);
    if (!sheetClosed) fail('the plant sheet never closed after Plant (no farmPlanted)');
    ok('Plant clicked through the sheet DOM; the sheet closed on farmPlanted');
    const plantedTracker = await waitForTrackerText('Vale Wheat planted');
    if (!plantedTracker) fail('the tracker never showed the planted objective');
    const trackerText1 = await readTrackerText();
    ok(`tracker shows the plant objective: "${trackerText1.replace(/\s+/g, ' ')}"`);

    // ---- /dev farmgrow (the one sanctioned dev command) -------------------
    await page.evaluate(() => window.__game.sim.chat('/dev farmgrow'));
    await wait(800);
    const devLine = await page.evaluate(() => {
      const log = document.getElementById('chatlog')?.textContent || '';
      const at = log.lastIndexOf('[dev]');
      return at >= 0 ? log.slice(at, at + 80) : '(no [dev] line)';
    });
    ok(`issued /dev farmgrow; chat log answered: "${devLine.replace(/\s+/g, ' ').trim()}"`);

    // ---- Harvest through the interact press -------------------------------
    await pressInteract();
    const harvested = await page
      .waitForFunction(
        () => (document.getElementById('chatlog')?.textContent || '').includes('You bring in:'),
        { timeout: 10000, polling: 200 },
      )
      .then(() => true)
      .catch(() => false);
    if (!harvested) fail('no "You bring in:" harvest line after the interact press');
    const harvestLine = await page.evaluate(() => {
      const log = document.getElementById('chatlog')?.textContent || '';
      const at = log.lastIndexOf('You bring in:');
      return log.slice(at, at + 60);
    });
    await shot('harvest-toast');
    ok(`interact press harvested the ready plot: "${harvestLine.replace(/\s+/g, ' ').trim()}"`);
    const harvestedTracker = await waitForTrackerText('Vale Wheat harvested');
    if (!harvestedTracker) fail('the tracker never showed the harvest objective complete');
    ok('tracker shows the harvest objective');

    // ---- Turn in at Jessica ----------------------------------------------
    if (!(await stageAt(JESSICA_SPOT))) fail('staging back to Farmer Jessica failed');
    ok('staged back beside Farmer Jessica');
    await pressInteract();
    if (!(await waitVisible('#quest-dialog', 15000)))
      fail('the quest dialog never reopened for the turn-in');
    if (!(await driveQuestRowTo('Complete Quest')))
      fail('the Complete Quest button was never clickable');
    ok('clicked the ready quest row, then Complete Quest');
    const rewarded = await page
      .waitForFunction(
        (base) => window.__game.sim.copper === base + 50,
        { timeout: 10000, polling: 200 },
        before.copper,
      )
      .then(() => true)
      .catch(() => false);
    const after = await page.evaluate(() => ({
      xp: window.__game.sim.xp,
      copper: window.__game.sim.copper,
      level: window.__game.sim.player.level,
    }));
    if (!rewarded || after.xp - before.xp !== 150 || after.level !== before.level) {
      fail(
        `reward mismatch: xp ${before.xp} -> ${after.xp} (want +150), ` +
          `copper ${before.copper} -> ${after.copper} (want +50), level ${before.level} -> ${after.level}`,
      );
    }
    ok(
      `turn-in paid the quest reward: xp +${after.xp - before.xp} (${before.xp} -> ${after.xp}), ` +
        `copper +${after.copper - before.copper} (${before.copper} -> ${after.copper}), level ${after.level}`,
    );
    const gone = await waitForTrackerText('First Furrow', false);
    if (!gone) fail('First Furrow still in the tracker after completion');
    ok('First Furrow left the tracker: q_farm_intro is COMPLETE through the client');
    console.log(`JOURNEY PASS (${VARIANT})`);
  } finally {
    await browser.close();
  }
}

if (SHOTS_DIR) mkdirSync(SHOTS_DIR, { recursive: true });
main().catch((err) => {
  console.error(`JOURNEY FAIL: ${err?.message ?? err}`);
  process.exit(1);
});
