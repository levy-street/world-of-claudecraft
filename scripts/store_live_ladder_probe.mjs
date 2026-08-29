// Real-browser probe for Bank Storage phase 15, rulings 17 and 21. It exists
// because this packet has been bitten twice by the same thing: phase 12's focus
// fix in THIS window "never worked and only a browser could say so", and the
// happy-dom suite passed the whole time. Ruling 21's repaint and the review
// round's background-paint focus exemption are both in that blast radius, so
// they get driven in a real browser rather than shipped on jsdom evidence.
//
// It asserts four things a unit test cannot:
//   1. Away from every bursar, bankInfo is null while the ladder read answers,
//      and the store's charter grid is FIT-GATED there (ruling 17).
//   2. A rung bought BEHIND an open store changes the offered cards with NO
//      click and NO store event: the slow band alone (ruling 21).
//   3. That repaint does NOT pull keyboard focus. A player parked on <body>
//      mid-purchase stays there rather than being yanked into the charter grid
//      by a paint nobody asked for.
//   4. It repaints ONCE. A signature that never converges would keep rebuilding
//      the whole armory grid at 2 Hz for as long as the store is open, which is
//      the regression the gate exists to prevent and which no static capture
//      would ever show.
//
// Dev-only, not wired into any npm script or CI gate. Needs a vite dev client.
// Exits non-zero with a named failure, so it is usable as a manual gate.
//
// Usage:
//   BROWSER_PATH=~/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome \
//   GAME_URL=http://localhost:5173 \
//     node scripts/store_live_ladder_probe.mjs
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';
import { suppressGpuNotice } from './lib/gpu_notice_suppress.mjs';

const GAME_URL = process.env.GAME_URL ?? 'http://localhost:5173';
const uniq = Date.now().toString(36).slice(-6);

// The store does not exist offline (main.ts builds claudiumHooks only in its
// online arm), so the rig attaches a stub. It answers ONLY the reads the store
// paints from and never fakes a purchase result, exactly as the capture rig
// does; nothing here can drift from the real spend contract.
const CHARTER_PRICES = {
  strongbox_charter_1: 500,
  strongbox_charter_2: 900,
  strongbox_charter_3: 1500,
  strongbox_charter_complete: 2000,
};

const failures = [];
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `: ${detail}` : ''}`);
  if (!ok) failures.push(name);
}

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  protocolTimeout: 180000,
  userDataDir: `/tmp/claude-1000/store-ladder-probe-${uniq}`,
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900, deviceScaleFactor: 1 },
});

try {
  const page = await browser.newPage();
  await suppressGpuNotice(page);
  await page.goto(GAME_URL, { waitUntil: 'domcontentloaded' });
  await enterOfflineGame(page, { settleMs: 4000 });
  await page.waitForFunction(() => !!window.__game?.hud?.attachClaudium, { timeout: 120000 });

  // Stand at the bursar and buy SIX real rungs (36 of 72 slots).
  const staged = await page.evaluate(() => {
    const sim = window.__game.sim;
    for (const e of sim.entities.values()) {
      if (e.kind === 'npc' && e.templateId === 'bursar_fernando') {
        const p = sim.entities.get(sim.playerId);
        p.pos = { ...e.pos };
        p.prevPos = { ...p.pos };
        sim.rebucket(p);
        break;
      }
    }
    const meta = sim.players.get(sim.playerId);
    meta.copper += 100000000;
    for (let i = 0; i < 6; i++) sim.bankBuySlots();
    return { atBursar: sim.bankInfo?.purchasedSlots ?? null, ladder: sim.bankPurchasedSlots };
  });
  check('staged six real rungs at the bursar', staged.atBursar === 36, JSON.stringify(staged));

  await page.evaluate((priceMap) => {
    const storeItems = Object.entries(priceMap).map(([itemId, costClaudium]) => ({
      itemId,
      name: itemId,
      kind: 'storage',
      costClaudium,
      owned: false,
    }));
    window.__game.hud.attachClaudium({
      balance: async () => 9000,
      storeSnapshot: async () => ({ available: true, balance: 9000, storeItems }),
      snapshot: async () => ({ available: false, packs: [], rails: [] }),
      buy: async () => {},
      spend: async () => ({
        granted: false,
        balance: 9000,
        costClaudium: null,
        reason: 'unavailable',
      }),
    });
  }, CHARTER_PRICES);

  // ---- 1. RULING 17: the fit gate away from every bursar ----
  const away = await page.evaluate(() => {
    const sim = window.__game.sim;
    const p = sim.entities.get(sim.playerId);
    p.pos = { x: 500, y: p.pos.y, z: 500 };
    p.prevPos = { ...p.pos };
    sim.rebucket(p);
    return { bankInfo: sim.bankInfo, ladder: sim.bankPurchasedSlots };
  });
  check(
    'away from every bursar: bankInfo is null but the ladder read still answers',
    away.bankInfo === null && away.ladder === 36,
    `bankInfo=${away.bankInfo === null ? 'null' : 'NOT NULL'} ladder=${away.ladder}`,
  );

  await page.evaluate(() => window.__game.hud.toggleDailyRewards());
  await page.waitForFunction(
    () => !!document.querySelector('#daily-rewards-window .charter-section'),
    { timeout: 30000 },
  );
  await new Promise((r) => setTimeout(r, 1500));
  const cardIds = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('#daily-rewards-window [data-charter-buy]')].map((el) =>
        el.getAttribute('data-charter-buy'),
      ),
    );
  const gatedAway = await cardIds();
  // 36 purchased of 72: the 12 and 24 grants fit, the 48 and 72 overshoot.
  check(
    'the store away from a bursar offers ONLY the charters that fit',
    gatedAway.length === 2 &&
      gatedAway.includes('strongbox_charter_1') &&
      gatedAway.includes('strongbox_charter_2'),
    gatedAway.join(',') || '(none)',
  );

  // ---- 2 and 3. RULING 21: the ladder moves BEHIND the open store ----
  // Park focus on <body>, which is exactly where a keyboard buyer sits between
  // the confirm dialog closing and the purchase outcome landing.
  await page.evaluate(() => document.activeElement?.blur?.());
  const focusBefore = await page.evaluate(() => document.activeElement?.tagName ?? null);

  // Three more rungs, bought at the bursar with the store still open. No click,
  // no store event, nothing the window observes: only the world state moves.
  const moved = await page.evaluate(() => {
    const sim = window.__game.sim;
    for (const e of sim.entities.values()) {
      if (e.kind === 'npc' && e.templateId === 'bursar_fernando') {
        const p = sim.entities.get(sim.playerId);
        p.pos = { ...e.pos };
        p.prevPos = { ...p.pos };
        sim.rebucket(p);
        break;
      }
    }
    for (let i = 0; i < 3; i++) sim.bankBuySlots();
    return sim.bankPurchasedSlots;
  });
  check('three more rungs landed behind the open store', moved === 54, `ladder=${moved}`);

  // The slow band is 500ms. Give it several turns.
  await new Promise((r) => setTimeout(r, 2500));
  const afterPoll = await cardIds();
  // 54 purchased of 72: only the 12 grant still fits.
  check(
    'the OPEN store repainted from the slow band alone, with no click',
    afterPoll.length === 1 && afterPoll[0] === 'strongbox_charter_1',
    afterPoll.join(',') || '(none)',
  );

  const focusAfter = await page.evaluate(() => ({
    tag: document.activeElement?.tagName ?? null,
    charterBuy: document.activeElement?.getAttribute?.('data-charter-buy') ?? null,
  }));
  check(
    'the background repaint did NOT pull keyboard focus into the grid',
    focusAfter.charterBuy === null && focusAfter.tag === focusBefore,
    `before=${focusBefore} after=${focusAfter.tag} charterBuy=${focusAfter.charterBuy}`,
  );

  // ---- 4. It repaints ONCE, not on every poll ----
  const settled = await page.evaluate(
    () => document.querySelector('#daily-rewards-window .charter-section')?.firstElementChild,
  );
  void settled;
  const stable = await page.evaluate(async () => {
    const grid = () => document.querySelector('#daily-rewards-window .charter-grid');
    const first = grid();
    await new Promise((r) => setTimeout(r, 2500)); // five slow-band ticks
    // Element IDENTITY, not markup: a repaint replaces the subtree even when the
    // string matches, which is what would drop focus under a keyboard user.
    return first !== null && grid() === first;
  });
  check('a settled store stops repainting (the grid element survives five ticks)', stable);
} finally {
  await browser.close();
}

if (failures.length) {
  console.error(`\n${failures.length} FAILED: ${failures.join(' | ')}`);
  process.exit(1);
}
console.log('\nall probe checks passed');
