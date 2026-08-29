// Live geometry check for the personal bank pane on short landscape phones.
//
// WHAT IT GUARDS, and the claim changed at Bank Storage phase 18. It used to
// assert that the transactional BUY ROW stayed inside the window. That was
// never the claim that was false: on a STOCKED bank the whole FOOTER (the
// capacity meter and its numbers, the gilded near-full warning, the price, the
// buy button, and the Claudium purchase-result band) sat outside the window
// entirely, clipped by the window's own overflow: hidden. So this asserts the
// FOOTER's bottom edge against the window border, in every band state, at rest
// and at maximum scroll.
//
// It is also the only instrument that can make these claims at all: jsdom and
// happy-dom implement neither layout nor scrolling, so no Vitest can see a
// pixel here. tests/bank_chrome_layout.test.ts owns the pure decisions and the
// stylesheet contract; this owns the geometry.
//
// Runs the offline flow (no server/Postgres); needs `npm run dev` (default
// :5173, override GAME_URL) and BROWSER_PATH when no system Chrome is present.

import puppeteer from 'puppeteer-core';

import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const BASE = (process.env.GAME_URL ?? 'http://localhost:5173') + '/';
const CHAR_NAME = 'Proberton';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
function check(name, cond, extra = '') {
  if (cond) {
    pass++;
    console.log('PASS', name);
  } else {
    fail++;
    console.log('FAIL', name, extra);
  }
}

const PROFILES = [
  { name: '740x360', width: 740, height: 360 },
  { name: '844x390', width: 844, height: 390 },
  { name: '915x412', width: 915, height: 412 },
];

// The footer may eat into the window's bottom padding, never past its border.
const CLEARANCE = 2;
// The 40px touch floor every control in this pane keeps (src/styles/CLAUDE.md).
const TOUCH_FLOOR = 40;

// One geometry read of the whole pane. Returned as plain numbers so a failure
// message carries the measurement rather than a selector.
function readPane() {
  const win = document.querySelector('#bank-window');
  if (!win) return { error: 'no #bank-window' };
  const wb = win.getBoundingClientRect();
  const box = (sel) => {
    const el = win.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { h: +r.height.toFixed(1), w: +r.width.toFixed(1), bottom: +r.bottom.toFixed(1) };
  };
  const past = (sel) => {
    const el = win.querySelector(sel);
    if (!el) return null;
    return +(el.getBoundingClientRect().bottom - wb.bottom).toFixed(1);
  };
  const scrollers = [];
  const walk = (el) => {
    for (const c of el.children) {
      const cs = getComputedStyle(c);
      if (cs.overflowY === 'auto' || cs.overflowY === 'scroll') {
        if (c.scrollHeight > c.clientHeight) scrollers.push(c.className);
      }
      walk(c);
    }
  };
  walk(win);
  const cs = getComputedStyle(win);
  return {
    winBottom: +wb.bottom.toFixed(1),
    footerPast: past('.bank-footer'),
    meterPast: past('.bank-meter'),
    buyPast: past('.bank-buy-row'),
    noticePast: past('.bank-rung-notice'),
    hasFooter: !!win.querySelector('.bank-footer'),
    hasStatus: !!win.querySelector('.bank-status'),
    hasNotice: !!win.querySelector('.bank-rung-notice'),
    nearFull: !!win.querySelector('.bank-footer.near-full'),
    windowOverflowY: cs.overflowY,
    windowTouchAction: cs.touchAction,
    innerScrollers: scrollers,
    windowScrolls: win.scrollHeight > win.clientHeight,
    controls: {
      chip: box('.bag-chip'),
      search: box('.bag-search'),
      sort: box('.bag-sort'),
      deposit: box('.bank-deposit-all'),
      socket: box('.bag-socket'),
      tab: box('.bank-tab'),
      buyBtn: box('.bank-buy-btn'),
    },
  };
}

for (const profile of PROFILES) {
  const browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: 'new',
    args: [
      `--window-size=${profile.width + 80},${profile.height + 120}`,
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
    ],
    defaultViewport: {
      width: profile.width,
      height: profile.height,
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: true,
    },
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  const cdp = await page.target().createCDPSession();
  // Satisfy PHONE_TOUCH_QUERY: (pointer: coarse) / no hover.
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [
      { name: 'pointer', value: 'coarse' },
      { name: 'hover', value: 'none' },
    ],
  });
  await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 60000 });
  // Skip the first-spawn intro cinematic (it inline-hides #ui while it runs).
  await page.evaluate((name) => {
    localStorage.setItem(`woc_spawn_intro_seen:offline:warrior:${name}`, '1');
  }, CHAR_NAME);
  // The class cards get their box only after the procedural icons render, which
  // under SwiftShader can outlast the helper's default.
  await enterOfflineGame(page, {
    charClass: 'warrior',
    charName: CHAR_NAME,
    settleMs: 3000,
    selectorTimeoutMs: 45000,
  });

  // Arrange: god-mode, coin for the buy row, then teleport to the banker.
  //
  // The banker's seat is READ OFF THE LIVE WORLD, never hardcoded. It used to be
  // spelled as zone1 {x:13, z:6.2}, and the Eastbrook rebuild moved the bank
  // building from {x:18, z:10.5} to {x:12, z:-94}, which put the whole rig ~105
  // yards from the NPC it means to stand at and failed it on a selector timeout
  // rather than on a claim. A coordinate is exactly the kind of literal this file
  // already refuses for item ids: a wrong one is silent.
  //
  // The greeting modal is dismissed by its own button. The Proving Shore tutorial
  // is compulsory and has no skip, so the old `.tut-skip` hook no longer exists;
  // the modal is a real overlay and would otherwise swallow the interact tap.
  const staged = await page.evaluate(() => {
    const sim = window.__game.sim;
    const p = sim.player;
    p.maxHp = 99999;
    p.hp = 99999;
    sim.players.get(p.id).copper = 12345678;
    const pools = [];
    if (sim.entities instanceof Map) pools.push(...sim.entities.values());
    if (sim.npcs instanceof Map) pools.push(...sim.npcs.values());
    else if (Array.isArray(sim.npcs)) pools.push(...sim.npcs);
    const banker = pools.find(
      (e) => e && e.pos && /^bursar_fernando$/.test(String(e.templateId ?? e.id ?? '')),
    );
    if (banker) {
      p.pos.x = banker.pos.x;
      p.pos.y = banker.pos.y ?? 1.5;
      p.pos.z = banker.pos.z + 1.5;
    }
    for (const sel of ['#tutorial-greeting .cd-ok', '#tutorial-greeting button', '.tut-skip']) {
      const el = document.querySelector(sel);
      if (el) {
        el.click();
        break;
      }
    }
    return { foundBanker: !!banker, at: banker ? { x: banker.pos.x, z: banker.pos.z } : null };
  });
  check(
    `${profile.name} banker located in the live world`,
    staged.foundBanker,
    JSON.stringify(staged),
  );
  await wait(1000);

  // Stock the carried bags with REAL material stacks, read off the live catalog
  // through the sim's own taxonomy rather than a hardcoded id list that rots
  // when an item is renamed (a wrong id is silent: addItem simply does nothing).
  const stocked = await page.evaluate(async () => {
    const sim = window.__game.sim;
    const data = await import('/src/sim/data.ts');
    const tax = await import('/src/sim/material_taxonomy.ts');
    const all = data.ITEMS instanceof Map ? [...data.ITEMS.values()] : Object.values(data.ITEMS);
    const mats = all.filter((d) => d && d.id && tax.isMaterialItem(d)).map((d) => d.id);
    for (const id of mats.slice(0, 34)) {
      try {
        sim.addItem(id, 3);
      } catch {
        // refused (full bags): the count below is what matters, not this loop
      }
    }
    return { matIds: mats.length, carried: (window.__game.world.inventory ?? []).length };
  });
  check(
    `${profile.name} carried material stacks staged`,
    stocked.matIds > 0 && stocked.carried > 0,
    JSON.stringify(stocked),
  );

  // Act: the REAL touch interact opens the bank; deposit-all stocks the PERSONAL
  // bank (which is what mounts the full search/chips toolbar) and mounts the
  // transient status line.
  await page.evaluate(() => document.querySelector('#mobile-interact')?.click());
  await page.waitForSelector('#bank-window', { visible: true, timeout: 8000 });
  // The cold bank window repaints on a ~1s cadence; settle before any DOM read.
  await wait(1800);
  await page.evaluate(() => document.querySelector('#bank-window .bank-deposit-all')?.click());
  await wait(900);

  const withStatus = await page.evaluate(readPane);
  check(
    `${profile.name} status line mounted after deposit-all`,
    withStatus.hasStatus,
    JSON.stringify(withStatus),
  );
  check(
    `${profile.name} the bank is stocked and near-full (the gilded case)`,
    withStatus.hasFooter && withStatus.nearFull,
    JSON.stringify(withStatus),
  );
  check(
    `${profile.name} FOOTER inside the window WITH the status line`,
    withStatus.footerPast !== null && withStatus.footerPast <= -CLEARANCE,
    JSON.stringify(withStatus),
  );
  check(
    `${profile.name} buy row inside the window WITH the status line`,
    withStatus.buyPast !== null && withStatus.buyPast <= -CLEARANCE,
    JSON.stringify(withStatus),
  );

  // The status line auto-clears (DEPOSIT_STATUS_MS).
  await wait(4500);
  const noBand = await page.evaluate(readPane);
  check(`${profile.name} status line cleared`, !noBand.hasStatus, JSON.stringify(noBand));
  check(
    `${profile.name} FOOTER inside the window with NO band`,
    noBand.footerPast !== null && noBand.footerPast <= -CLEARANCE,
    JSON.stringify(noBand),
  );
  // The three the phase exists for: every one of them was outside the window.
  check(
    `${profile.name} capacity meter visible without scrolling`,
    noBand.meterPast !== null && noBand.meterPast <= -CLEARANCE,
    JSON.stringify(noBand),
  );
  check(
    `${profile.name} buy row visible without scrolling`,
    noBand.buyPast !== null && noBand.buyPast <= -CLEARANCE,
    JSON.stringify(noBand),
  );

  // Nothing the fix allowed to scroll may be hidden: every control keeps a real
  // box and the touch floor. A pane that fits by shedding a control is the
  // failure this check exists to catch, not a cheaper way to pass.
  const missing = Object.entries(noBand.controls)
    .filter(([, b]) => b === null || b.h < TOUCH_FLOOR || b.w <= 0)
    .map(([k]) => k);
  check(
    `${profile.name} every control keeps a box and the ${TOUCH_FLOOR}px touch floor`,
    missing.length === 0,
    `missing or under floor: ${missing.join(', ')} ${JSON.stringify(noBand.controls)}`,
  );

  // Exactly one vertical scroller, and no touch-action on the window: the chip
  // row pans HORIZONTALLY inside it, and touch-action binds descendants, so a
  // pan-y here would put the chips out of reach.
  check(
    `${profile.name} the window is the pane's only vertical scroller`,
    noBand.windowOverflowY === 'auto' && noBand.innerScrollers.length === 0,
    JSON.stringify({ oy: noBand.windowOverflowY, inner: noBand.innerScrollers }),
  );
  check(
    `${profile.name} the window forbids no horizontal pan (the chip row needs it)`,
    noBand.windowTouchAction === 'auto',
    `touch-action: ${noBand.windowTouchAction}`,
  );
  check(
    `${profile.name} the item grid is reachable by scrolling`,
    noBand.windowScrolls === true,
    JSON.stringify({ windowScrolls: noBand.windowScrolls }),
  );

  // The footer must still be pinned at MAXIMUM scroll, which is where a sticky
  // band that is merely last in the flow stops being pinned.
  const atBottom = await page.evaluate(() => {
    const w = document.querySelector('#bank-window');
    w.scrollTop = 99999;
    return w.scrollTop;
  });
  await wait(250);
  const scrolled = await page.evaluate(readPane);
  check(
    `${profile.name} FOOTER still inside the window at MAXIMUM scroll`,
    atBottom > 0 && scrolled.footerPast !== null && scrolled.footerPast <= -CLEARANCE,
    JSON.stringify({ atBottom, ...scrolled }),
  );
  await page.evaluate(() => {
    document.querySelector('#bank-window').scrollTop = 0;
  });
  await wait(250);

  // The two Claudium purchase-result bands. Staged through the live controller
  // by NAME, exactly as tests/browser/a11y.browser.test.ts stages them, because
  // neither the window nor the controller exposes a public setter. If those
  // names move, they move here in the same change.
  for (const band of [
    { key: 'success', value: { granted: true, reason: null } },
    { key: 'rungOutage', value: { granted: false, reason: 'some_unknown_service_token' } },
  ]) {
    await page.evaluate((notice) => {
      const bw = window.__game.hud.bankWindow;
      bw.rungPurchase.band = notice;
      bw.render();
    }, band.value);
    await wait(500);
    const withBand = await page.evaluate(readPane);
    check(
      `${profile.name} ${band.key} band actually mounted`,
      withBand.hasNotice,
      JSON.stringify(withBand),
    );
    check(
      `${profile.name} FOOTER inside the window with the ${band.key} band`,
      withBand.footerPast !== null && withBand.footerPast <= -CLEARANCE,
      JSON.stringify(withBand),
    );
    check(
      `${profile.name} the ${band.key} band itself is visible`,
      withBand.noticePast !== null && withBand.noticePast <= -CLEARANCE,
      JSON.stringify(withBand),
    );
  }
  await page.evaluate(() => {
    const bw = window.__game.hud.bankWindow;
    bw.rungPurchase.band = null;
    bw.render();
  });
  await wait(500);

  // The UNDOCKED standalone state: closing the bags companion on touch drops
  // body.bank-open while the bank stays open (Hud.onBagsClosed) and the bank
  // goes full viewport. It overflowed too, and it is easy to miss because every
  // walkthrough opens the pair.
  const undocked = await page.evaluate(async () => {
    document.body.classList.remove('bank-open');
    await new Promise((r) => setTimeout(r, 500));
    return { bankOpenClass: document.body.classList.contains('bank-open') };
  });
  const undockedPane = await page.evaluate(readPane);
  check(
    `${profile.name} FOOTER inside the window in the UNDOCKED standalone state`,
    undocked.bankOpenClass === false &&
      undockedPane.footerPast !== null &&
      undockedPane.footerPast <= -CLEARANCE,
    JSON.stringify({ ...undocked, ...undockedPane }),
  );
  await page.evaluate(() => document.body.classList.add('bank-open'));
  await wait(400);

  check(`${profile.name} no page errors`, errors.length === 0, errors.join(' | '));

  await browser.close();
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
