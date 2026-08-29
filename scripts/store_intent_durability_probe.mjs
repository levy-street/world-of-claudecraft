// The GO-LIVE arm of Bank Storage ruling 19: a purchase intent survives the
// page, and a reload after an AMBIGUOUS outcome costs exactly ONE debit.
//
// WHY IT EXISTS. The whole subject of phase 16 is a state no jsdom-family suite
// can produce: the economy service DEBITED, the reply never reached the client,
// and the page then went away. The unit suite proves the record's rules with an
// injected clock and a fake store; only a real browser against a real
// GameServer, real Postgres and the real economy service can prove that the
// money LANDS ONCE. Which layer held the line is reported rather than assumed:
// the proxy's forward counter is sampled across the retry, so the transcript
// says whether the SERVICE deduped on the client's key or the GAME SERVER
// short-circuited on its own prior row before any spend went out. Both are
// correct; only one of them is what a reader would otherwise have inferred.
//
// NOT A CI TEST, and deliberately not written as one: it needs a whole rig.
// Run it when the durable purchase intent changes.
//
// RIG:
//   1. Portable Postgres on 127.0.0.1:5433 (the packet's user-space recipe),
//      with a `woc` database for the game and an `economy` one for the service.
//   2. The economy service on :8798 with the season 1 catalog.
//   3. The LATENCY PROXY in scripts/claudium_latency_proxy.mjs on :8799,
//      which delays /spend past the game server's
//      SERVICE_TIMEOUT_MS (5000, server/claudium_proxy.ts) and forwards it
//      anyway, so the debit is REAL and the answer is lost. That is the only way
//      to manufacture the ambiguous outcome this phase exists for. The delay
//      sits on the REPLY, never on the forward: delaying the forward would make
//      the request provably-never-reached inside the client's window, which
//      phase 14 settles as REFUSED rather than ambiguous, and would exercise the
//      opposite case. GET /rig/delay/<ms> retunes it live.
//      WOC_ECONOMY_SERVICE_URL points at the PROXY and must end in /v1/claudium,
//      or every store call degrades to available:false.
//   4. npm run server on :8787 with ALLOW_DEV_COMMANDS=1.
//   5. npm run dev on :5173 (Vite binds ::1 only: use localhost, not 127.0.0.1).
//   6. BROWSER_PATH, DATABASE_URL (the game db) and ECONOMY_DATABASE_URL (the
//      service db), plus the two economy secrets, in the environment.
//
// HOW TO RUN, two processes per arm, because the split is the rig (see the
// PHASE constant below for why a second app boot in one renderer will not do):
//   PROBE_PHASE=1 PROBE_LABEL=A node scripts/store_intent_durability_probe.mjs
//   PROBE_PHASE=2 PROBE_LABEL=A node scripts/store_intent_durability_probe.mjs
//   PROBE_PHASE=1 PROBE_LABEL=B PROBE_CLEAR_ROW=1 node scripts/...
//   PROBE_PHASE=2 PROBE_LABEL=B PROBE_CLEAR_ROW=1 node scripts/...
//   PROBE_PHASE=1 PROBE_LABEL=C node scripts/...
//   PROBE_PHASE=2 PROBE_LABEL=C PROBE_CANCEL_FIRST=1 node scripts/...
// Arm C is arm A with a CANCEL pressed on the restored intent before the retry,
// which is the one path the fix round created and nothing had ever driven live.
//
// PASS THE RIG ENV PER COMMAND, never `source` it into the shell you will later
// run the gate from. DATABASE_URL and ALLOW_DEV_COMMANDS silently switch the
// mode of a dozen DB-gated and dev-gated suites, so a gate inherited from this
// rig's shell reds files this change never touched, and the triage points at the
// wrong place every time.
//
// AFTERWARDS: put the proxy delay back with `curl $RIG_PROXY_URL/rig/delay/0`. A
// run that fails between the two phases leaves it at 9000ms, and the next thing
// to use the rig then sees every purchase time out for a reason that is not its
// own. The per-arm browser profiles under OUT_DIR are disposable; delete the
// whole directory rather than reusing one across a code change, because a stale
// profile carries a durable row minted by the OLD build.
// Phase 2 waits for the realm to empty on its own: LINKDEAD_GRACE_MS is FIVE
// minutes (server/linkdead.ts), and the record's own ten minute bound is what
// caps how long the whole arm may take before the retry stops being a real test.
// The probe reports the entry's AGE and fails loudly if it drifted past the
// bound, because a slow rig otherwise looks exactly like a broken feature.
//
// THE CONTROL IS THE POINT. Arm B repeats arm A with the durable row DELETED
// between the ambiguous outcome and the retry, which is exactly the pre-phase
// client. It must show TWO debits. Without it, "one debit" proves nothing: a rig
// that cannot detect the double charge would report success against a feature
// that does nothing.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import pg from 'pg';
import puppeteer from 'puppeteer-core';
import { assertLoopbackDatabaseUrl, assertLoopbackUrl } from './lib/loopback_guard.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173/';
// A LOCAL dev instrument only: it drives /dev cheats, mints accounts and reads
// the money tables, so refuse anything but a loopback target before a single
// request goes out.
assertLoopbackUrl(URL, 'GAME_URL');
assertLoopbackDatabaseUrl(process.env.DATABASE_URL);
const ECONOMY_DATABASE_URL = process.env.ECONOMY_DATABASE_URL ?? '';
assertLoopbackDatabaseUrl(ECONOMY_DATABASE_URL);
const SERVICE_URL = process.env.WOC_ECONOMY_ADMIN_URL ?? 'http://127.0.0.1:8798';
assertLoopbackUrl(SERVICE_URL, 'WOC_ECONOMY_ADMIN_URL');
const PROXY_URL = process.env.RIG_PROXY_URL ?? 'http://127.0.0.1:8799';
assertLoopbackUrl(PROXY_URL, 'RIG_PROXY_URL');
const GAME_API = process.env.GAME_API_URL ?? 'http://127.0.0.1:8787';
assertLoopbackUrl(GAME_API, 'GAME_API_URL');
const BROWSER_PATH = process.env.BROWSER_PATH;
// NOT the repo root. Everything this rig writes is real-money material: arm-<L>.json
// carries the live idempotency key, and profile-<L>/ is a whole Chromium profile
// whose localStorage holds the durable record itself. Defaulting to '.' put all of
// it beside the source, untracked but NOT ignored, one `git add -A` from being
// committed. The default is the per-session scratch dir .gitignore already owns,
// and the explicit rows below it cover a run that overrides OUT_DIR anyway.
const OUT = process.env.OUT_DIR ?? '.claude-scratch/intent-durability-rig';
// Character names are LETTERS ONLY: a digit makes the create button silently not
// submit and the rig then times out pointing at world entry.
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

/** How many /spend requests the real economy service has ANSWERED so far.
 *
 *  Read across the retry, this is what separates the two stories that produce
 *  byte-identical money evidence: the SERVICE deduping on the client's key
 *  (delta 1) from the GAME SERVER short-circuiting on its own prior row before
 *  any spend goes out (delta 0). Both leave exactly one debit, and the packet
 *  cares which one it measured.
 *
 *  It reads `forwards` and NOT `spends`. The proxy counts a spend as RECEIVED
 *  before it has decided whether to refuse the target and before it knows the
 *  upstream is even reachable, so a refused request and a 502 both move `spends`
 *  while neither ever reached a service. Asserting on that would let arm B's
 *  control pass on a request the economy service never saw. */
async function proxySpendCount() {
  const r = await fetch(`${PROXY_URL}/rig/stats`).then((x) => x.json());
  return r.forwards;
}

async function setProxyDelay(ms) {
  const r = await fetch(`${PROXY_URL}/rig/delay/${ms}`).then((x) => x.json());
  note(`proxy /spend delay -> ${r.delayMs}ms (spends seen so far: ${r.spends})`);
}

async function economyDebits(accountId) {
  const db = new pg.Client({ connectionString: ECONOMY_DATABASE_URL });
  await db.connect();
  const r = await db.query(
    `SELECT idempotency_key, delta, reason, ref FROM claudium_ledger
      WHERE account_id = $1 AND delta < 0 ORDER BY entry_id`,
    [accountId],
  );
  await db.end();
  return r.rows;
}

async function gamePurchaseRows(accountId) {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const r = await db.query(
    `SELECT idempotency_key, item_id, status, expected_cost_claudium
       FROM storage_purchases WHERE account_id = $1 ORDER BY id`,
    [accountId],
  );
  await db.end();
  return r.rows;
}

async function accountIdOf(username) {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const r = await db.query('SELECT id FROM accounts WHERE username = $1', [username]);
  await db.end();
  return r.rows[0]?.id ?? null;
}

// A PERSISTENT PROFILE per arm, and the whole browser is closed and relaunched
// between the ambiguous purchase and the retry. That is the strongest form of
// the claim (the player closed the game and opened it again) and it is also the
// only form that worked: reloading in place, and opening a second tab, both hung
// a CDP evaluate. src/main.ts says why in its own words, that repeated
// logout/login cycles exhaust the GPU, and this rig runs on swiftshader.
// localStorage lives in the profile, so it survives the relaunch exactly as it
// does for a real player.
function launchBrowser(userDataDir) {
  return puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: 'new',
    userDataDir,
    // The second entry waits out the linkdead grace (about 60 to 90 seconds),
    // during which a single CDP call can outlive a shorter budget and fail the
    // run for a reason that has nothing to do with the subject.
    protocolTimeout: 420000,
    args: [
      '--no-sandbox',
      '--window-size=1440,900',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
    ],
    defaultViewport: { width: 1440, height: 900 },
  });
}

/**
 * Reach the world from WHATEVER screen the client is on.
 *
 * Written as a state machine over the VISIBLE panel rather than a fixed
 * sequence, because that is the bug that cost this rig three passes: after a
 * relaunch on a persisted profile the client restores its session and lands on
 * #charselect-panel, while #btn-online and #login-user are both still in the
 * DOM merely HIDDEN. puppeteer's waitForSelector matches a hidden element, so a
 * sequence keyed on "does the selector exist" happily drove a login over a
 * character-select screen and then waited forever for a world that nothing had
 * asked for. Every branch below tests the `hidden` attribute on the panel.
 */
async function enter(page, user, charName, cls, { create }) {
  await page.evaluateOnNewDocument(() => {
    try {
      const s = JSON.parse(localStorage.getItem('woc_settings') || '{}');
      s.graphicsPreset = 1;
      s.graphicsDefaultApplied = true;
      localStorage.setItem('woc_settings', JSON.stringify(s));
      // The camera prompt mounts a focus-trapping aria-modal on first world
      // entry and swallows every click behind it. Seed it as already seen.
      localStorage.setItem('woc.cameraModePrompt.shown', '1');
    } catch {}
  });
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // NOT offsetParent: it is null for a position:fixed element, and these panels
  // are fixed, so an offsetParent test reported the visible Create Character
  // screen as hidden and the state machine sat in 'waiting' forever. Measure the
  // box instead.
  const visible = (id) =>
    page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el || el.hasAttribute('hidden')) return false;
      const box = el.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    }, id);

  // Rows stay in the DOM after their panel hides, so "are there realm rows" is
  // true forever once it has been true once. Every branch is gated on the PANEL
  // being visible; this only asks whether the visible panel has anything to
  // click yet.
  const realmRows = () =>
    page.evaluate(() => document.querySelectorAll('#realm-list .realm-row').length > 0);

  const settleUntil = Date.now() + 15000;
  const deadline = Date.now() + 300000;
  let created = false;
  let lastStage = '';
  while (Date.now() < deadline) {
    if (await page.evaluate(() => !!window.__game?.world)) break;
    let stage = 'waiting';
    if (await visible('#charcreate-panel')) {
      stage = 'charcreate';
      if (create && !created) {
        await page.evaluate((klass) => {
          document.querySelector(`#charcreate-panel .mini-class[data-class="${klass}"]`)?.click();
        }, cls);
        await page.click('#new-char-name');
        await page.type('#new-char-name', charName, { delay: 25 });
        await sleep(250);
        await page.evaluate(() => document.querySelector('#btn-create-char')?.click());
        created = true;
      } else {
        // Not our job to mint a second character: go back to the list.
        await page.evaluate(() => document.querySelector('#btn-charcreate-back')?.click());
      }
    } else if (await visible('#charselect-panel')) {
      stage = 'charselect';
      if (
        create &&
        !created &&
        (await page.evaluate(() => document.querySelectorAll('#char-list li').length === 0))
      ) {
        await page.evaluate(() => document.querySelector('#btn-new-character')?.click());
      } else {
        await page.evaluate((name) => {
          const rows = [...document.querySelectorAll('#char-list li')];
          const mine = rows.find((li) => (li.textContent ?? '').includes(name)) ?? rows[0];
          mine?.click();
        }, charName);
        await sleep(400);
        await page.evaluate(() => document.querySelector('#btn-charselect-enter')?.click());
        // The join can stall behind the previous session's linkdead grace; give
        // the retry a real window before pressing the button again.
        await sleep(15000);
      }
    } else if ((await visible('#realm-panel')) && (await realmRows())) {
      stage = 'realm';
      await page.evaluate(() => {
        const row = document.querySelector('#realm-list .realm-row');
        (row?.querySelector('button') ?? row)?.click();
      });
    } else if (await visible('#login-panel')) {
      stage = 'login';
      if (create && !created) {
        await page.evaluate(() => document.querySelector('#btn-auth-toggle')?.click());
        await sleep(300);
      }
      await page.evaluate(
        (u, p, isCreate) => {
          const set = (sel, v) => {
            const el = document.querySelector(sel);
            if (!el) return;
            el.value = v;
            el.dispatchEvent(new Event('input', { bubbles: true }));
          };
          set('#login-user', u);
          set('#login-pass', p);
          if (isCreate) set('#login-email', `${u}@example.com`);
          document.querySelector('#btn-login')?.click();
        },
        user,
        PASS,
        create && !created,
      );
    } else if (await visible('#mode-select')) {
      stage = 'mode-select';
      // WAIT before pressing Online. On a profile that already holds a session
      // the client restores it and walks itself to character select; pressing
      // Online into that restore hung a CDP evaluate every single time, which is
      // what made three earlier versions of this rig look like an app bug. Give
      // the restore its window first, and only then drive the cold path.
      if (Date.now() > settleUntil) {
        await page.evaluate(() => document.querySelector('#btn-online')?.click());
      } else {
        stage = 'mode-select (letting a stored session restore itself)';
      }
    }
    if (stage !== lastStage) {
      note(`entry stage: ${stage}`);
      lastStage = stage;
    }
    await sleep(2000);
  }

  const entered = await page
    .waitForFunction(() => window.__game?.world?.entities?.size > 5, {
      timeout: 120000,
      polling: 1000,
    })
    .then(() => true)
    .catch(() => false);
  if (!entered) {
    await page.screenshot({ path: `${OUT}/entry_stall.png` }).catch(() => {});
    throw new Error(`world entry stalled at stage ${lastStage}`);
  }
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.getElementById('ui')?.style.display !== 'none', {
    timeout: 30000,
    polling: 300,
  });
  await sleep(1500);
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

/** The durable row this build writes, read straight out of the browser. */
async function durableRow(page) {
  return page.evaluate(() => {
    const w = window.__game.world;
    const name = `woc_purchase_intents_${w.cfg.playerClass}_${w.player.name}`;
    const raw = localStorage.getItem(name);
    return { name, raw, parsed: raw === null ? null : JSON.parse(raw) };
  });
}

/**
 * Wait for the charter grid, and SAY WHY when it never arrives.
 *
 * A bare waitForSelector here fails with nothing but the selector text, and the
 * store has several ways to paint no charter cards that all look identical from
 * outside: a service call that never resolved, a store body still on the rewards
 * tab, an error body, or a fit gate that judged every charter unpurchasable. A
 * rig that cannot tell those apart sends the reader hunting in the wrong file,
 * so dump the body and the world's own store state before giving up.
 */
async function waitForCharterCards(page, label) {
  try {
    await page.waitForSelector('#daily-rewards-window [data-charter-buy]', { timeout: 30000 });
    return;
  } catch (e) {
    const diag = await page
      .evaluate(() => {
        const win = document.getElementById('daily-rewards-window');
        const body = win?.querySelector('.dr-body');
        return {
          windowPresent: !!win,
          windowHidden: win?.hasAttribute('hidden') ?? null,
          windowDisplay: win ? getComputedStyle(win).display : null,
          activeTab:
            win?.querySelector('[aria-selected="true"]')?.getAttribute('data-tab') ??
            win?.querySelector('.dr-tab.active')?.textContent?.trim() ??
            null,
          charterButtons: win?.querySelectorAll('[data-charter-buy]').length ?? 0,
          bodyText: (body?.textContent ?? '').slice(0, 600),
          bodyHtml: (body?.innerHTML ?? '').slice(0, 2000),
        };
      })
      .catch((err) => ({ evaluateFailed: String(err) }));
    note(`[${label}] NO CHARTER CARDS. store diagnostic: ${JSON.stringify(diag)}`);
    await page.screenshot({ path: `${OUT}/no_charter_cards_${label}.png` }).catch(() => {});
    throw e;
  }
}

/** Click Buy on a charter card and take the confirm dialog's OK BY LABEL: the
 *  shared dialog's buttons are [close-X, Cancel, OK], so index 0 is a cancel. */
async function buyCharter(page, charterId) {
  await page.evaluate((id) => {
    document.querySelector(`[data-charter-buy="${id}"]`)?.click();
  }, charterId);
  await sleep(700);
  await page.waitForSelector('#confirm-dialog [data-ok]', { timeout: 15000 });
  const clicked = await page.evaluate(() => {
    // The shared dialog's buttons are [close-X(data-cancel), Cancel(data-cancel),
    // OK(data-ok)], so taking one by INDEX is a cancel and taking one by text is
    // localized. Take it by the data attribute the markup mints.
    const ok = document.querySelector('#confirm-dialog [data-ok]');
    if (!ok) return null;
    ok.click();
    return ok.textContent?.trim() ?? '';
  });
  return clicked;
}

/** Click Buy on a charter card and DISMISS the confirm dialog, which is the
 *  player's cancel. Both `[data-cancel]` elements (the title-bar X and the
 *  labelled Cancel button) run the same handler in src/ui/hud.ts, and both fire
 *  the dialog's no-choice callback; the LAST one is the labelled button a player
 *  actually presses, so take that. */
async function cancelCharter(page, charterId) {
  await page.evaluate((id) => {
    document.querySelector(`[data-charter-buy="${id}"]`)?.click();
  }, charterId);
  await sleep(700);
  await page.waitForSelector('#confirm-dialog [data-cancel]', { timeout: 15000 });
  const clicked = await page.evaluate(() => {
    const all = [...document.querySelectorAll('#confirm-dialog [data-cancel]')];
    const btn = all[all.length - 1];
    if (!btn) return null;
    btn.click();
    return btn.textContent?.trim() ?? '';
  });
  await sleep(700);
  return clicked;
}

const results = {};

// TWO PHASES, TWO PROCESSES, ONE PROFILE. Phase 1 makes the purchase ambiguous
// and exits; phase 2 relaunches on the same browser profile and retries. The
// split is not cosmetic: a second app boot inside one renderer hung a CDP
// evaluate every time (a second tab, a reload in place and a second browser in
// the same process all did), which is the GPU exhaustion src/main.ts warns about
// on this swiftshader rig. A fresh PROCESS is also the truer statement of the
// claim: phase 2 is a client that has never seen this purchase, holding nothing
// but what the browser profile kept.
const PHASE = process.env.PROBE_PHASE ?? '1';
const LABEL = process.env.PROBE_LABEL ?? 'A';
const CLEAR_ROW = process.env.PROBE_CLEAR_ROW === '1';
// THE RESTORE-THEN-CANCEL ARM (phase 2 only). The fix round taught the ledger to
// treat a RESTORED intent as possibly-sent, so abandon() keeps its durable
// record: the window's own "this key already reached the service" latch is an
// in-memory Set that died with the page, so on the page AFTER an ambiguous
// outcome the window believes nothing was sent and its cancel path would
// otherwise drop the key protecting a live debit. Nothing had ever driven that
// live. With this set, phase 2 presses Buy, CANCELS the confirm, and only then
// buys for real; the same one-debit claim must still hold, and it can only hold
// if the cancel left the record alone.
const CANCEL_FIRST = process.env.PROBE_CANCEL_FIRST === '1';
const STATE_FILE = `${OUT}/arm-${LABEL}.json`;
const profile = `${OUT}/profile-${LABEL}`;

const browser = await launchBrowser(profile);
const spends = [];
const page = await browser.newPage();
page.on('request', (req) => {
  if (req.url().endsWith('/api/claudium/spend') && req.method() === 'POST') {
    try {
      spends.push(JSON.parse(req.postData() ?? '{}'));
    } catch {
      spends.push({ unparsed: req.postData() });
    }
  }
});
page.on('pageerror', (e) => note(`[${LABEL}] pageerror: ${e.message}`));

try {
  if (PHASE === '1') {
    const user = `dur${LABEL.toLowerCase()}${UNIQ}`;
    const charName = `Durable${LABEL}${UNIQ}`;
    await enter(page, user, charName, 'warrior', { create: true });
    const accountId = await accountIdOf(user);
    note(`[${LABEL}] entered as ${charName}, account ${accountId}`);

    // The store paints an ERROR body with no charters until the account has a
    // real service BALANCE, which reads exactly like a broken fit gate.
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
        reason: 'phase16 durable intent probe',
        // Idempotent on requestId: reusing one funds only the first account it
        // ever saw, and every later arm then runs at a zero balance.
        requestId: `qa16-${accountId}-${LABEL}-${UNIQ}`,
      }),
    }).then((r) => r.json());
    if (credited.ok !== true) throw new Error(`[${LABEL}] admin credit failed`);

    await setProxyDelay(9000);
    await page.evaluate(() => window.__game.hud.openWocStore());
    await waitForCharterCards(page, LABEL);
    await sleep(600);
    const charterId = await page.evaluate(
      () => document.querySelector('[data-charter-buy]')?.dataset.charterBuy ?? null,
    );
    if (!charterId) throw new Error(`[${LABEL}] no charter card rendered`);
    note(`[${LABEL}] buying ${charterId}`);
    const okLabel = await buyCharter(page, charterId);
    note(`[${LABEL}] confirm taken by label: ${JSON.stringify(okLabel)}`);
    // The game server gives up at SERVICE_TIMEOUT_MS and answers the AMBIGUOUS
    // 'unavailable'; the proxy forwards anyway, so the service really debits.
    await sleep(12000);
    const afterFirst = await durableRow(page);
    const firstSpend = spends[0] ?? null;
    note(`[${LABEL}] first spend body: ${JSON.stringify(firstSpend)}`);
    note(`[${LABEL}] durable row: ${afterFirst.raw}`);
    check(
      `${LABEL}1 the ambiguous outcome PERSISTED the intent, key and frozen cost together`,
      !!firstSpend &&
        !!afterFirst.parsed &&
        afterFirst.parsed.intents?.[charterId]?.key === firstSpend.idempotencyKey &&
        afterFirst.parsed.intents?.[charterId]?.costClaudium === firstSpend.expectedCostClaudium,
      JSON.stringify({ firstSpend, row: afterFirst.parsed }),
    );
    check(
      `${LABEL}2 the row is scoped to this character`,
      afterFirst.name === `woc_purchase_intents_warrior_${charName}` &&
        afterFirst.parsed?.scope === `warrior_${charName}`,
      JSON.stringify({ name: afterFirst.name, scope: afterFirst.parsed?.scope }),
    );
    const debitsAfterFirst = await economyDebits(accountId);
    note(`[${LABEL}] service debits after the ambiguous buy: ${debitsAfterFirst.length}`);
    check(
      `${LABEL}3 the ambiguous outcome really did move money (the debit is REAL)`,
      debitsAfterFirst.length === 1,
      JSON.stringify(debitsAfterFirst),
    );
    if (CLEAR_ROW) {
      // THE CONTROL: the pre-phase client, whose ledger died with the page and
      // left nothing behind.
      await page.evaluate((n) => localStorage.removeItem(n), afterFirst.name);
      note(`[${LABEL}] CONTROL: durable row deleted before the process exits`);
    }
    writeFileSync(
      STATE_FILE,
      JSON.stringify({
        user,
        charName,
        accountId,
        charterId,
        firstKey: firstSpend?.idempotencyKey ?? null,
        rowName: afterFirst.name,
        clearRow: CLEAR_ROW,
      }),
    );
    note(`[${LABEL}] phase 1 done; state at ${STATE_FILE}`);
  } else {
    const st = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    note(`[${LABEL}] phase 2 resuming ${JSON.stringify(st)}`);
    await setProxyDelay(0);
    // WAIT FOR THE PREVIOUS SESSION TO BE GONE, rather than sleeping a guess.
    // One live character per account plus a linkdead grace means the next join
    // stalls in the client's entry retry until the server has actually let go,
    // and while it is stalled the client sits on the mode-select screen where
    // pressing Online hangs the renderer. players_online falling to zero is the
    // server saying the seat is free; the record's own ten minute bound is what
    // caps how long this may take before the retry stops being a real test.
    // LINKDEAD_GRACE_MS is FIVE minutes (server/linkdead.ts), not the minute or
    // two an earlier note claimed, so the budget has to clear it with slack. It
    // still fits inside the record's own ten minute bound, which is what makes
    // this arm a real test rather than an expiry demonstration.
    const freeBy = Date.now() + 400000;
    for (;;) {
      const status = await fetch(`${GAME_API}/api/status`)
        .then((r) => r.json())
        .catch(() => null);
      if (status && status.players_online === 0) {
        note(`[${LABEL}] realm empty, the seat is free`);
        break;
      }
      if (Date.now() > freeBy) {
        note(`[${LABEL}] gave up waiting for an empty realm: ${JSON.stringify(status)}`);
        break;
      }
      await sleep(5000);
    }
    await enter(page, st.user, st.charName, 'warrior', { create: false });
    note(`[${LABEL}] re-entered in a FRESH process, holding only what the profile kept`);
    const afterReload = await durableRow(page);
    const entry = afterReload.parsed?.intents?.[st.charterId];
    // The AGE matters as much as the presence. The record expires at
    // PURCHASE_INTENT_MAX_AGE_MS (ten minutes, borrowed from the server's own
    // ambiguity bound), so a rig that dawdles between the phases will find the
    // row on disk and correctly refuse to restore it. That looked exactly like a
    // product defect once, so the age is reported and asserted rather than left
    // to be inferred from a mint timestamp nobody printed.
    const ageMs = entry ? Date.now() - entry.mintedAtMs : -1;
    note(`[${LABEL}] durable entry age at retry: ${ageMs}ms (bound is 600000ms)`);
    check(
      `${LABEL}4 the durable row ${st.clearRow ? 'is GONE (control)' : 'SURVIVED the page'}`,
      st.clearRow ? afterReload.raw === null : entry !== undefined,
      JSON.stringify(afterReload.raw),
    );
    if (!st.clearRow) {
      check(
        `${LABEL}4b the entry is still INSIDE its bound, so the retry is a real test`,
        ageMs >= 0 && ageMs < 600000,
        `age=${ageMs}ms: the rig took too long between phases; re-run it`,
      );
    }

    await page.evaluate(() => window.__game.hud.openWocStore());
    await waitForCharterCards(page, LABEL);
    await sleep(800);
    if (CANCEL_FIRST) {
      const cancelLabel = await cancelCharter(page, st.charterId);
      note(`[${LABEL}] cancel taken by label: ${JSON.stringify(cancelLabel)}`);
      // A cancel must not spend. If it did, everything after it is measuring the
      // wrong thing and the one-debit claim below would be satisfied for the
      // wrong reason.
      check(`${LABEL}4c the CANCEL sent no spend`, spends.length === 0, JSON.stringify(spends));
      const afterCancel = await durableRow(page);
      const kept = afterCancel.parsed?.intents?.[st.charterId];
      note(`[${LABEL}] durable row after the cancel: ${afterCancel.raw}`);
      check(
        `${LABEL}4d THE FIX-ROUND CLAIM: cancelling a RESTORED intent KEEPS its record, key and frozen cost intact`,
        kept !== undefined && kept.key === st.firstKey && kept.costClaudium === 500,
        JSON.stringify({ expectedKey: st.firstKey, kept }),
      );
    }
    const forwardsBefore = await proxySpendCount();
    await buyCharter(page, st.charterId);
    await sleep(8000);
    const forwarded = (await proxySpendCount()) - forwardsBefore;
    // WHICH MECHANISM PRODUCED THE SINGLE DEBIT, stated rather than implied. The
    // header used to claim the run proved "the key the client persists is the key
    // the service dedupes on", and nothing in the transcript could tell that from
    // the game server refusing the retry off its own applied row before any spend
    // left the process. Both are correct outcomes for ruling 19; only one of them
    // is the sentence the header was writing.
    note(
      `[${LABEL}] /spend forwards across the retry: ${forwarded} ` +
        '(1 = the SERVICE deduped on the client key; 0 = the GAME SERVER ' +
        'short-circuited on its own prior row before any spend went out)',
    );
    const secondSpend = spends[0] ?? null;
    note(`[${LABEL}] second spend body: ${JSON.stringify(secondSpend)}`);
    check(
      `${LABEL}5 the retry carries ${st.clearRow ? 'a FRESH key (control)' : 'the SAME key'}`,
      !!secondSpend &&
        (st.clearRow
          ? secondSpend.idempotencyKey !== st.firstKey
          : secondSpend.idempotencyKey === st.firstKey),
      JSON.stringify({ first: st.firstKey, second: secondSpend?.idempotencyKey }),
    );

    const debits = await economyDebits(st.accountId);
    const rows = await gamePurchaseRows(st.accountId);
    note(`[${LABEL}] FINAL service debits: ${JSON.stringify(debits)}`);
    note(`[${LABEL}] FINAL game purchase rows: ${JSON.stringify(rows)}`);
    results[LABEL] = { debits: debits.length, keys: rows.length, accountId: st.accountId };
    if (st.clearRow) {
      check(
        `${LABEL}6 CONTROL: without the durable row the same flow charges TWICE`,
        debits.length === 2,
        `debits=${debits.length}`,
      );
      check(
        `${LABEL}7 and it did so by minting a SECOND key, which is the mechanism`,
        rows.length === 2 && rows[0].idempotency_key !== rows[1].idempotency_key,
        JSON.stringify(rows),
      );
      check(
        `${LABEL}8 and the second charge really TRAVERSED the service (control)`,
        forwarded === 1,
        `forwarded=${forwarded}: a control that never reached the service proves nothing`,
      );
    } else {
      check(
        `${LABEL}6 THE CLAIM: after an ambiguous purchase and a page teardown, exactly ONE debit exists`,
        debits.length === 1,
        `debits=${debits.length}`,
      );
      check(
        `${LABEL}7 and the game server minted exactly ONE purchase key for it`,
        rows.length === 1,
        JSON.stringify(rows),
      );
      // Not a pass/fail on WHICH mechanism (both are correct), but the run must
      // have taken one of them and said so, rather than leaving a later reader to
      // assume the one the header happened to name.
      check(
        `${LABEL}8 and the run states which mechanism held the line`,
        forwarded === 0 || forwarded === 1,
        `forwarded=${forwarded}: more than one forward means the retry was not a replay`,
      );
    }
  }
} catch (e) {
  fail++;
  console.error('PROBE ERROR', e);
  lines.push(`FAIL probe threw: ${e?.message ?? e}`);
} finally {
  await browser.close();
  // Put the delay back on EVERY exit path, including phase 1's. The condition
  // used to exclude phase 1, which is the one exit the comment above was written
  // about: phase 1 is where the delay is RAISED, so a failure there is exactly
  // what strands it at 9000ms. Nothing depends on it surviving between the two
  // processes, because phase 2 sets its own delay before it does anything.
  await setProxyDelay(0).catch(() => {});
  const summary = `${pass} passed, ${fail} failed\n${lines.join('\n')}\n${JSON.stringify(results, null, 1)}\n`;
  writeFileSync(`${OUT}/intent_durability_probe_${LABEL}_${PHASE}.txt`, summary);
  console.log(`\n=== ${LABEL} phase ${PHASE}: ${pass} passed, ${fail} failed ===`);
  process.exit(fail === 0 ? 0 : 1);
}
