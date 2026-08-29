// The ONLINE arm of Bank Storage rulings 17 and 21, driven in a real browser
// against a real GameServer, real Postgres and the real economy service.
//
// WHY IT EXISTS. The phase's other probe (scripts/store_live_ladder_probe.mjs)
// is OFFLINE with a stubbed world, so the composition this one covers, the
// server's `bpsl` self key reaching ClientWorld and then the store's charter fit
// gate, had never been driven end to end. Two of its checks are things no
// jsdom-family suite can answer at all: happy-dom implements neither layout nor
// scrolling, so "a background repaint does not jump the scroller" is prose
// everywhere else.
//
// NOT A CI TEST, and deliberately not written as one: it needs a whole rig. Run
// it when the store's live-ladder behaviour changes.
//
// RIG:
//   1. Portable Postgres on 127.0.0.1:5433 (see the packet's user-space recipe).
//   2. The economy service on :8798 with the season 1 catalog. Its base URL for
//      the game server INCLUDES the API prefix: WOC_ECONOMY_SERVICE_URL must end
//      in /v1/claudium, or every store call degrades to available:false and the
//      store paints its error body with no charters at all.
//   3. npm run server on :8787 with ALLOW_DEV_COMMANDS=1.
//   4. npm run dev on :5173 (Vite binds ::1 only: use localhost, not 127.0.0.1).
//   5. BROWSER_PATH, DATABASE_URL, WOC_ECONOMY_INTERNAL_SECRET and
//      WOC_ECONOMY_ADMIN_SECRET in the environment.
// The account needs a real service BALANCE before any charter can render, so the
// script credits its own account through the admin endpoint; the requestId
// carries the account id because that endpoint is idempotent on it.
import { mkdirSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import pg from 'pg';
import puppeteer from 'puppeteer-core';
import { assertLoopbackDatabaseUrl, assertLoopbackUrl } from './lib/loopback_guard.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173/';
// This tool drives /dev cheats, mints characters and reads the account table, so
// it is a LOCAL dev instrument only: refuse anything but a loopback target
// before a single request goes out.
assertLoopbackUrl(URL, 'GAME_URL');
assertLoopbackDatabaseUrl(process.env.DATABASE_URL);
const SERVICE_URL = process.env.WOC_ECONOMY_ADMIN_URL ?? 'http://127.0.0.1:8798';
assertLoopbackUrl(SERVICE_URL, 'WOC_ECONOMY_ADMIN_URL');
const BROWSER_PATH = process.env.BROWSER_PATH;
const OUT = process.env.OUT_DIR ?? '.';
const UNIQ = Date.now()
  .toString(36)
  .replace(/[0-9]/g, (d) => 'abcdefghij'[Number(d)])
  .slice(-5);
const PASS = 'hunter22';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

let pass = 0;
let fail = 0;
const lines = [];
function check(name, cond, extra = '') {
  if (cond) {
    pass++;
    console.log(`OK   ${name}`);
    lines.push(`OK   ${name}`);
  } else {
    fail++;
    console.log(`FAIL ${name} ${extra}`);
    lines.push(`FAIL ${name} ${extra}`);
  }
}
function note(msg) {
  console.log(`     ${msg}`);
  lines.push(`     ${msg}`);
}

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  protocolTimeout: 120000,
  args: [
    '--no-sandbox',
    '--window-size=1440,900',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
  defaultViewport: { width: 1440, height: 900 },
});

async function dumpState(page, label) {
  const state = await page
    .evaluate(() => ({
      panels: [
        '#mode-select',
        '#login-panel',
        '#realm-panel',
        '#charselect-panel',
        '#charcreate-panel',
      ].filter((id) => {
        const el = document.querySelector(id);
        return el && !el.hasAttribute('hidden');
      }),
      err: document.querySelector('#login-error')?.textContent ?? '',
      inWorld: !!window.__game?.world,
    }))
    .catch(() => null);
  console.error(`STATE[${label}]`, JSON.stringify(state));
  await page.screenshot({ path: `${OUT}/debug_${label}.png` }).catch(() => {});
}

async function enter(page, user, charName, cls) {
  page.on('pageerror', (e) => note(`pageerror: ${e.message}`));
  // Seed the LOW graphics preset before any app code runs (standing repo rule
  // for screenshots): graphicsPreset 1 is LOW, and graphicsDefaultApplied stops
  // the first-boot auto-detect from overwriting it.
  await page.evaluateOnNewDocument(() => {
    try {
      const s = JSON.parse(localStorage.getItem('woc_settings') || '{}');
      s.graphicsPreset = 1;
      s.graphicsDefaultApplied = true;
      localStorage.setItem('woc_settings', JSON.stringify(s));
    } catch {}
  });
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#btn-online', { timeout: 30000 });
  await sleep(600);
  await page.evaluate(() => document.querySelector('#btn-online')?.click());
  await page.waitForSelector('#login-user', { timeout: 15000 });
  await page.evaluate(() => document.querySelector('#btn-auth-toggle')?.click());
  await sleep(300);
  await page.evaluate(
    (u, p) => {
      const set = (sel, v) => {
        const el = document.querySelector(sel);
        el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      set('#login-user', u);
      set('#login-pass', p);
      set('#login-email', `${u}@example.com`);
      document.querySelector('#btn-login').click();
    },
    user,
    PASS,
  );
  await page.waitForFunction(() => document.querySelectorAll('#realm-list .realm-row').length > 0, {
    timeout: 20000,
    polling: 200,
  });
  await sleep(300);
  await page.evaluate(() => {
    const row = document.querySelector('#realm-list .realm-row');
    (row?.querySelector('button') ?? row)?.click();
  });
  await page.waitForFunction(
    () =>
      !document.querySelector('#charselect-panel')?.hasAttribute('hidden') ||
      !document.querySelector('#charcreate-panel')?.hasAttribute('hidden'),
    { timeout: 20000, polling: 200 },
  );
  await sleep(600);
  const onCreate = await page.evaluate(
    () => !document.querySelector('#charcreate-panel')?.hasAttribute('hidden'),
  );
  if (!onCreate) {
    await page.evaluate(() => document.querySelector('#btn-new-character')?.click());
    await page.waitForFunction(
      () => !document.querySelector('#charcreate-panel')?.hasAttribute('hidden'),
      { timeout: 10000, polling: 200 },
    );
  }
  await page.evaluate((klass) => {
    document.querySelector(`#charcreate-panel .mini-class[data-class="${klass}"]`)?.click();
  }, cls);
  await page.click('#new-char-name');
  await page.type('#new-char-name', charName, { delay: 25 });
  await sleep(250);
  await page.evaluate(() => document.querySelector('#btn-create-char')?.click());
  await page.waitForFunction(
    () =>
      window.__game?.world ||
      (!document.querySelector('#charselect-panel')?.hasAttribute('hidden') &&
        document.querySelectorAll('#char-list li').length > 0),
    { timeout: 60000, polling: 400 },
  );
  if (!(await page.evaluate(() => !!window.__game?.world))) {
    await sleep(700);
    await page.evaluate(() => document.querySelector('#char-list li')?.click());
    await sleep(400);
    await page.evaluate(() => document.querySelector('#btn-charselect-enter')?.click());
  }
  await page.waitForFunction(() => window.__game?.world?.entities?.size > 5, {
    timeout: 90000,
    polling: 500,
  });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.getElementById('ui')?.style.display !== 'none', {
    timeout: 30000,
    polling: 300,
  });
  await sleep(1500);
  // The camera prompt swallows real clicks on a fresh profile. Removing only the
  // BACKDROP leaves the dialog itself standing over every screenshot, which is
  // how the first captures from this rig came out unusable: take both.
  await page.evaluate(() => {
    document.querySelector('#camera-prompt-backdrop')?.remove();
    document.querySelector('.camera-prompt-dialog')?.remove();
    document.querySelector('#discord-cta-close')?.click();
    for (const b of document.querySelectorAll('button')) {
      if (b.textContent?.trim() === 'Skip Tutorial') b.click();
    }
  });
  await sleep(400);
}

const page = await browser.newPage();
try {
  await enter(page, `lad_${UNIQ}`, `Ladderer${UNIQ}`, 'warrior');
  note(`entered as Ladderer${UNIQ}`);

  // The store body paints an ERROR div when the balance is null, so the account
  // needs a real service balance before any charter can render.
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const acc = await db.query('SELECT id FROM accounts WHERE username = $1', [`lad_${UNIQ}`]);
  const accountId = acc.rows[0].id;
  await db.end();
  const credited = await fetch(`${SERVICE_URL}/v1/claudium/admin/credits`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-woc-economy-secret': process.env.WOC_ECONOMY_INTERNAL_SECRET ?? 'rigsecret',
      'x-woc-economy-admin-secret': process.env.WOC_ECONOMY_ADMIN_SECRET ?? 'rigadmin',
      'x-woc-economy-admin-actor': 'qa-rig',
    },
    body: JSON.stringify({
      accountId,
      amount: 20000,
      category: 'testing',
      reason: 'phase15 qa online ladder probe',
      requestId: `qa15-${accountId}-${UNIQ}`,
    }),
  }).then((r) => r.json());
  note(`credited account ${accountId}: ${JSON.stringify(credited)}`);
  if (credited.ok !== true) throw new Error('admin credit failed');

  // --- baseline: fresh character, no rungs bought -------------------------
  const base = await page.evaluate(() => ({
    bpsl: window.__game.world.bankPurchasedSlots,
    bankInfo: window.__game.world.bankInfo === null ? null : 'present',
  }));
  note(`baseline bpsl=${JSON.stringify(base.bpsl)} bankInfo=${base.bankInfo}`);
  check(
    'A1 fresh online character reports a ladder count of 0 away from any bursar',
    base.bpsl === 0 && base.bankInfo === null,
    JSON.stringify(base),
  );

  // POSITIVE CONTROL. A zero-ladder character away from a bursar must see the
  // WHOLE charter set, so the pruning asserted later cannot be an empty section
  // or a store that failed to paint.
  await page.evaluate(() => window.__game.hud.openWocStore());
  await page.waitForSelector('#daily-rewards-window [data-charter-buy]', { timeout: 20000 });
  await sleep(600);
  const control = await page.evaluate(() => ({
    cards: [...document.querySelectorAll('[data-charter-buy]')].map((b) => b.dataset.charterBuy),
    bankInfo: window.__game.world.bankInfo,
    bpsl: window.__game.world.bankPurchasedSlots,
    err: !!document.querySelector('#daily-rewards-window .dr-error'),
  }));
  note(`control (0 slots, away from bursar): ${JSON.stringify(control)}`);
  check(
    'A1b CONTROL a zero-ladder character away from a bursar sees the whole charter set',
    control.bankInfo === null && control.bpsl === 0 && control.cards.length === 4 && !control.err,
    JSON.stringify(control),
  );
  const controlCards = control.cards;
  await page.evaluate(() => window.__game.hud.toggleDailyRewards());
  await sleep(400);

  // --- fund and teleport to the bursar ------------------------------------
  await page.evaluate(() => window.__game.world.chat('/dev gold 5000'));
  await sleep(600);
  const bursar = await page.evaluate(() => {
    for (const e of window.__game.world.entities.values()) {
      if (typeof e.name === 'string' && e.name.toLowerCase().includes('bursar')) {
        return { x: e.pos.x, z: e.pos.z, name: e.name };
      }
    }
    return null;
  });
  if (!bursar) throw new Error('no bursar entity in interest range at spawn');
  note(`bursar ${bursar.name} at ${bursar.x.toFixed(1)}, ${bursar.z.toFixed(1)}`);
  await page.evaluate(
    (x, z) => window.__game.world.chat(`/dev tp ${x.toFixed(1)} ${z.toFixed(1)}`),
    bursar.x,
    bursar.z + 1,
  );
  await page.waitForFunction(() => window.__game.world.bankInfo !== null, {
    timeout: 20000,
    polling: 200,
  });
  note('bankInfo present at the bursar');

  // --- buy five copper rungs through the real bank UI ----------------------
  await page.evaluate(() => window.__game.hud.openBank());
  await page.waitForSelector('.bank-buy-btn', { timeout: 15000 });
  const RUNGS = 5;
  for (let i = 0; i < RUNGS; i++) {
    const before = await page.evaluate(() => window.__game.world.bankInfo?.purchasedSlots ?? -1);
    await page.evaluate(() => {
      const b = document.querySelector('.bank-buy-btn');
      b?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await sleep(350);
    // A confirm prompt may stand between the click and the purchase.
    await page.evaluate(() => {
      const prompt = document.querySelector('.bank-quantity-prompt, .bank-buy-prompt');
      if (!prompt) return;
      const ok = [...prompt.querySelectorAll('button')].find(
        (b) => !/cancel|close/i.test(b.textContent ?? ''),
      );
      ok?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await page
      .waitForFunction(
        (prev) => (window.__game.world.bankInfo?.purchasedSlots ?? -1) > prev,
        { timeout: 12000, polling: 150 },
        before,
      )
      .catch(() => {});
  }
  const atBursar = await page.evaluate(() => ({
    bpsl: window.__game.world.bankPurchasedSlots,
    bankPurchased: window.__game.world.bankInfo?.purchasedSlots ?? null,
  }));
  note(`after buying: bpsl=${atBursar.bpsl} bankInfo.purchasedSlots=${atBursar.bankPurchased}`);
  check(
    'A2 the ladder read agrees with the banker-gated snapshot while both are observable',
    atBursar.bpsl !== null && atBursar.bpsl === atBursar.bankPurchased && atBursar.bpsl > 0,
    JSON.stringify(atBursar),
  );
  const bought = atBursar.bpsl;

  // --- ruling 17: walk away, the count must survive ------------------------
  await page.evaluate(() => window.__game.hud.closeAllWindows?.());
  await page.evaluate(
    (x, z) => window.__game.world.chat(`/dev tp ${x.toFixed(1)} ${z.toFixed(1)}`),
    bursar.x + 140,
    bursar.z + 140,
  );
  await page.waitForFunction(() => window.__game.world.bankInfo === null, {
    timeout: 20000,
    polling: 200,
  });
  const away = await page.evaluate(() => ({
    bpsl: window.__game.world.bankPurchasedSlots,
    bankInfo: window.__game.world.bankInfo,
  }));
  note(`away from the bursar: bpsl=${away.bpsl} bankInfo=${JSON.stringify(away.bankInfo)}`);
  check(
    'A3 RULING 17 the ladder count is still readable with bankInfo null (the whole point)',
    away.bankInfo === null && away.bpsl === bought,
    JSON.stringify(away),
  );

  // --- ruling 17: the store's fit gate uses it -----------------------------
  await page.evaluate(() => window.__game.hud.openWocStore());
  await page.waitForSelector('.charter-card', { timeout: 25000 }).catch(() => {});
  await sleep(1200);
  const store = await page.evaluate(() => ({
    cards: [...document.querySelectorAll('[data-charter-buy]')].map((b) => b.dataset.charterBuy),
    bankInfo: window.__game.world.bankInfo,
    bpsl: window.__game.world.bankPurchasedSlots,
  }));
  note(`store charters away from the bursar: ${JSON.stringify(store.cards)}`);
  // Ceiling 72. purchased = bought. A charter of grant G is listed iff
  // bought + G <= 72. Grants: charter_1 12, charter_2 24, charter_3 48,
  // charter_complete 72.
  const GRANTS = {
    strongbox_charter_1: 12,
    strongbox_charter_2: 24,
    strongbox_charter_3: 48,
    strongbox_charter_complete: 72,
  };
  const expected = Object.keys(GRANTS).filter((id) => bought + GRANTS[id] <= 72);
  check(
    'A4 RULING 17 the store fit gate runs away from a bursar and lists exactly the fitting charters',
    store.bankInfo === null &&
      store.cards.length === expected.length &&
      expected.every((id) => store.cards.includes(id)),
    `expected ${JSON.stringify(expected)} got ${JSON.stringify(store.cards)}`,
  );
  check(
    'A5 the gate PRUNED relative to the zero-ladder control, so A4 is not vacuous',
    controlCards.length === 4 &&
      store.cards.length === 3 &&
      controlCards.includes('strongbox_charter_complete') &&
      !store.cards.includes('strongbox_charter_complete'),
    `control ${JSON.stringify(controlCards)} vs away ${JSON.stringify(store.cards)}`,
  );
  await page.screenshot({ path: `${OUT}/online_store_away_from_bursar.png` });

  // --- ruling 21: a rung bought behind an open store ------------------------
  await page.evaluate(
    (x, z) => window.__game.world.chat(`/dev tp ${x.toFixed(1)} ${z.toFixed(1)}`),
    bursar.x,
    bursar.z + 1,
  );
  await page.waitForFunction(() => window.__game.world.bankInfo !== null, {
    timeout: 20000,
    polling: 200,
  });
  await sleep(600);
  // --- the FOCUS half, which only a real browser can answer ----------------
  // happy-dom implements no layout and no scrolling, so the whole reason a
  // background repaint degrades within its own family (a cross-section jump
  // would scroll the viewport) is prose in every jsdom-family suite. Drive it
  // here: park focus on a charter card deep in the scroller, make that exact
  // card vanish WITHOUT touching the store, and read where focus and the
  // scroll position ended up.
  const focusProbe = await page.evaluate(async () => {
    const body = document.querySelector('#daily-rewards-window .dr-body');
    if (!body) return { ok: false, why: 'no store body' };
    const grants = {
      strongbox_charter_1: 12,
      strongbox_charter_2: 24,
      strongbox_charter_3: 48,
      strongbox_charter_complete: 72,
    };
    const n = window.__game.world.bankPurchasedSlots;
    const cards = [...document.querySelectorAll('[data-charter-buy]')];
    // The card ONE rung will push out of the fit set, so the repaint really does
    // destroy the control focus is on while leaving family siblings behind.
    const target = cards.find((c) => {
      const g = grants[c.dataset.charterBuy ?? ''];
      return g !== undefined && n + 6 + g > 72 && n + g <= 72;
    });
    if (!target) return { ok: false, why: `no card a rung would remove at ladder ${n}` };
    if (cards.length < 2) return { ok: false, why: 'no family sibling to degrade to' };
    const key = target.dataset.focusKey ?? null;
    body.scrollTop = body.scrollHeight;
    target.focus();
    const scrollBefore = body.scrollTop;
    const focusedBefore = document.activeElement === target;
    // The ladder moves with NO interaction inside the store: the command goes
    // straight through the world, so focus never leaves the charter grid.
    window.__game.world.bankBuySlots();
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
      if (!document.querySelector(`[data-charter-buy="${target.dataset.charterBuy}"]`)) break;
    }
    const after = document.activeElement;
    return {
      ok: true,
      key,
      scrollBefore,
      scrollAfter: body.scrollTop,
      scrollHeight: body.scrollHeight,
      clientHeight: body.clientHeight,
      cardGone: !document.querySelector(`[data-charter-buy="${target.dataset.charterBuy}"]`),
      focusedBefore,
      afterKey: after instanceof HTMLElement ? (after.dataset.focusKey ?? null) : null,
      afterIsBody: after === document.body,
      afterIsTopUp: after instanceof HTMLElement && after.hasAttribute('data-buy-claudium'),
    };
  });
  note(`focus probe: ${JSON.stringify(focusProbe)}`);
  check(
    'A9 the focused card really vanished on a repaint nothing in the store triggered',
    focusProbe.ok && focusProbe.focusedBefore && focusProbe.cardGone && focusProbe.scrollBefore > 0,
    JSON.stringify(focusProbe),
  );
  check(
    'A9b focus stays in the CHARTER family, never <body> and never the top-up button',
    focusProbe.afterKey !== null &&
      focusProbe.afterKey.startsWith('charter-') &&
      focusProbe.afterKey !== focusProbe.key &&
      !focusProbe.afterIsBody &&
      !focusProbe.afterIsTopUp,
    JSON.stringify(focusProbe),
  );
  check(
    'A9c the scroller did NOT jump back to the top',
    focusProbe.scrollAfter > focusProbe.scrollBefore / 2,
    JSON.stringify(focusProbe),
  );

  // Store stays open; open the bank beside it.
  const storeStillOpen = await page.evaluate(
    () => !!document.querySelector('#daily-rewards-window [data-charter-buy]'),
  );
  note(`store still open at the bursar: ${storeStillOpen}`);
  await page.evaluate(() => window.__game.hud.openBank());
  await page.waitForSelector('.bank-buy-btn', { timeout: 15000 });
  await sleep(800);
  const beforeBuy = await page.evaluate(() => ({
    cards: [...document.querySelectorAll('[data-charter-buy]')].map((b) => b.dataset.charterBuy),
    bpsl: window.__game.world.bankPurchasedSlots,
    focus: document.activeElement?.tagName ?? null,
  }));
  note(`before the behind-the-store rung: ${JSON.stringify(beforeBuy)}`);
  // Buy rungs in the bank until the fit set must change, WITHOUT touching the store.
  let ticks = 0;
  const target = 72 - 24; // pushes charter_2 (24) out of the fit set
  while (
    (await page.evaluate(() => window.__game.world.bankPurchasedSlots)) <= target &&
    ticks < 12
  ) {
    const before = await page.evaluate(() => window.__game.world.bankInfo?.purchasedSlots ?? -1);
    await page.evaluate(() => {
      document
        .querySelector('.bank-buy-btn')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await sleep(300);
    await page.evaluate(() => {
      const prompt = document.querySelector('.bank-quantity-prompt, .bank-buy-prompt');
      if (!prompt) return;
      const ok = [...prompt.querySelectorAll('button')].find(
        (b) => !/cancel|close/i.test(b.textContent ?? ''),
      );
      ok?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await page
      .waitForFunction(
        (prev) => (window.__game.world.bankInfo?.purchasedSlots ?? -1) > prev,
        { timeout: 12000, polling: 150 },
        before,
      )
      .catch(() => {});
    ticks++;
  }
  // Now WAIT without clicking anything in the store and watch it converge.
  const settled = await page
    .waitForFunction(
      (prevJson) => {
        const now = JSON.stringify(
          [...document.querySelectorAll('[data-charter-buy]')].map((b) => b.dataset.charterBuy),
        );
        return now !== prevJson;
      },
      { timeout: 8000, polling: 100 },
      JSON.stringify(beforeBuy.cards),
    )
    .then(() => true)
    .catch(() => false);
  const afterBuy = await page.evaluate(() => ({
    cards: [...document.querySelectorAll('[data-charter-buy]')].map((b) => b.dataset.charterBuy),
    bpsl: window.__game.world.bankPurchasedSlots,
  }));
  note(`after the behind-the-store rung: ${JSON.stringify(afterBuy)}`);
  check(
    'A6 RULING 21 an open store notices a rung bought behind it, with no click in the store',
    settled && JSON.stringify(afterBuy.cards) !== JSON.stringify(beforeBuy.cards),
    `before ${JSON.stringify(beforeBuy.cards)} after ${JSON.stringify(afterBuy.cards)}`,
  );
  // The DOM trails the count by up to one slow-band period by design, so wait
  // for convergence and report the latency rather than racing the band.
  const t0 = Date.now();
  const converged = await page
    .waitForFunction(
      (grants, ceiling) => {
        const n = window.__game.world.bankPurchasedSlots;
        if (n === null) return false;
        const want = Object.keys(grants)
          .filter((id) => n + grants[id] <= ceiling)
          .sort()
          .join(',');
        const have = [...document.querySelectorAll('[data-charter-buy]')]
          .map((b) => b.dataset.charterBuy)
          .sort()
          .join(',');
        return want === have;
      },
      { timeout: 8000, polling: 50 },
      GRANTS,
      72,
    )
    .then(() => true)
    .catch(() => false);
  const settledState = await page.evaluate(() => ({
    cards: [...document.querySelectorAll('[data-charter-buy]')].map((b) => b.dataset.charterBuy),
    bpsl: window.__game.world.bankPurchasedSlots,
  }));
  const expectedAfter = Object.keys(GRANTS).filter((id) => settledState.bpsl + GRANTS[id] <= 72);
  note(`converged in ${Date.now() - t0} ms to ${JSON.stringify(settledState)}`);
  check(
    'A7 the list converges to exactly the fit set for the FINAL count',
    converged &&
      settledState.cards.length === expectedAfter.length &&
      expectedAfter.every((id) => settledState.cards.includes(id)),
    `expected ${JSON.stringify(expectedAfter)} got ${JSON.stringify(settledState.cards)}`,
  );
  await page.screenshot({ path: `${OUT}/online_store_ruling21.png` });

  // --- the poll must repaint ONCE, not every slow tick ---------------------
  const repaintOnce = await page.evaluate(async () => {
    const body = document.querySelector('#daily-rewards-window .dr-body');
    if (!body) return { ok: false, why: 'no store body' };
    const first = body.querySelector('[data-charter-buy]');
    await new Promise((r) => setTimeout(r, 3000));
    const later = body.querySelector('[data-charter-buy]');
    return { ok: !!first && first === later, why: first === later ? 'stable' : 'rebuilt' };
  });
  check(
    'A8 with the ladder settled the open store is NOT rebuilt on every slow tick',
    repaintOnce.ok,
    JSON.stringify(repaintOnce),
  );
} catch (err) {
  await dumpState(page, 'crash');
  fail++;
  lines.push(`FAIL harness ${err && err.message}`);
  console.error('HARNESS ERROR', err);
} finally {
  writeFileSync(`${OUT}/online_ladder_probe.txt`, lines.join('\n') + '\n');
  await browser.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
