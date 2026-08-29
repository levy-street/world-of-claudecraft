// The GO-LIVE arm of Bank Storage phase 17: the BANKER's Claudium rung purchase,
// driven through the real bank window after the flow moved out of it.
//
// WHY IT EXISTS, and why the packet's other probes are not it. Phase 17 moves a
// live real-money state machine out of src/ui/bank_window.ts into
// src/ui/bank_rung_purchase_core.ts. The store's durability probe
// (scripts/store_intent_durability_probe.mjs) drives the CHARTER surface, which
// this phase leaves alone, and scripts/store_online_ladder_probe.mjs clicks the
// bank's buy button but always takes the GOLD rail. So nothing in the tree had
// ever driven the moved path with real money. A move whose acceptance evidence
// never exercises the thing that moved is not evidence.
//
// It also drives the phase's own behaviour change, which no jsdom arm can prove
// against a real server: a repaint that tears the confirm prompt down ENDS the
// attempt, so the durable record for that rung is gone afterwards and the next
// click quotes what the wire says NOW.
//
// NOT A CI TEST, and deliberately not written as one: it needs a whole rig. Run
// it when the rung purchase flow changes.
//
// RIG (identical to the durability probe's; see that file's header for the
// traps, every one of which reads as a product bug):
//   1. Portable Postgres on 127.0.0.1:5433. The economy service reads the
//      `accounts` table, so it and the game share one database in this rig.
//   2. The economy service on :8798 with the season 1 catalog.
//   3. The latency proxy on :8799 (this probe leaves its delay at 0; it is in the
//      path only so WOC_ECONOMY_SERVICE_URL is one URL for every rig script).
//   4. npm run server on :8787 with ALLOW_DEV_COMMANDS=1.
//   5. npm run dev on :5173 (Vite binds ::1 only: use localhost, not 127.0.0.1).
//   6. BROWSER_PATH, DATABASE_URL, ECONOMY_DATABASE_URL and the two economy
//      secrets in the environment.
//
// HOW TO RUN, one process, about two minutes:
//   node scripts/bank_rung_claudium_probe.mjs
//
// PASS THE RIG ENV PER COMMAND, never `source` it into the shell you will later
// run the gate from: DATABASE_URL and ALLOW_DEV_COMMANDS silently switch the mode
// of a dozen DB-gated and dev-gated suites.
//
// THE ENTRY MACHINERY BELOW IS A COPY of the durability probe's, deliberately.
// Every probe in this packet is self-contained (store_live_ladder,
// store_online_ladder, store_intent_durability each carry their own), and the
// reviewed original is the durability probe. A shared scripts/lib/ entry helper
// is the right answer and is recorded as a follow-up rather than taken in the
// same change as a money-path move.

import { mkdirSync, writeFileSync } from 'node:fs';
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
const OUT = process.env.OUT_DIR ?? '.claude-scratch/bank-rung-rig';
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

/** The durable purchase-intent row this build writes, read out of the browser. */
async function durableRow(page) {
  return page.evaluate(() => {
    const w = window.__game.world;
    const name = `woc_purchase_intents_${w.cfg.playerClass}_${w.player.name}`;
    const raw = localStorage.getItem(name);
    return { name, raw, parsed: raw ? JSON.parse(raw) : null };
  });
}

/** Stand at a bursar and open the bank. Position is STAGED through /dev, which
 *  is not the verb under test; every step that matters below is a real click or
 *  a real key. */
async function standAtBursar(page) {
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
  await page.evaluate(() => window.__game.hud.openBank());
  await page.waitForSelector('.bank-buy-btn', { timeout: 15000 });
  await sleep(500);
}

/** Open the rung confirm by CLICKING the buy button, and say why it never came
 *  if it does not: a bare waitForSelector timeout here is indistinguishable
 *  between no Claudium tag, a maxed ladder, and a prompt that opened elsewhere. */
async function openRungPrompt(page) {
  // SETTLE FIRST, and this is a RIG TRAP that reads as a product bug. After a
  // purchase the owner-only snapshot lands and the slow band repaints; a confirm
  // prompt opened INSIDE that window is torn down by render()'s family teardown,
  // correctly and by this phase's own design, and the probe then reports "no
  // rung confirm prompt" against a flow that works. Wait for the bank's own
  // readout to stop moving, then click.
  let last = null;
  for (let i = 0; i < 20; i++) {
    const now = await page.evaluate(() => {
      const b = window.__game.world.bankInfo;
      return b === null ? null : `${b.purchasedSlots}/${b.capacity}/${b.slots.length}`;
    });
    if (now !== null && now === last) break;
    last = now;
    await sleep(400);
  }

  // Two attempts, because settling narrows the window rather than closing it: a
  // repaint can still land between the click and the mount. A silent second
  // failure is what the diagnostic dump below is for.
  let state = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const clicked = await page.evaluate(() => {
      const btn = document.querySelector('.bank-footer .bank-buy-btn');
      if (!btn) return false;
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return true;
    });
    if (!clicked) {
      await sleep(600);
      continue;
    }
    state = await page
      .waitForFunction(() => document.querySelector('.bank-buy-prompt') !== null, {
        timeout: 4000,
        polling: 150,
      })
      .then(() => true)
      .catch(() => false);
    if (state) break;
    note(`rung prompt did not mount on attempt ${attempt + 1}; retrying after a settle`);
    await sleep(1200);
  }

  const readout = await page.evaluate(() => {
    const p = document.querySelector('.bank-buy-prompt');
    return {
      prompt: !!p,
      buttons: p ? [...p.querySelectorAll('button')].map((b) => b.textContent) : [],
      claudiumTag: !!document.querySelector('.bank-buy-tag-claudium'),
      maxed: !!document.querySelector('.bank-buy-maxed'),
      buyBtn: !!document.querySelector('.bank-footer .bank-buy-btn'),
      promptStack: !!document.getElementById('prompt-stack'),
      inert: document.getElementById('bank-window')?.inert ?? null,
      bankOpen: document.getElementById('bank-window')?.style.display ?? null,
    };
  });
  if (!readout.prompt) {
    await page.screenshot({ path: `${OUT}/no_rung_prompt.png` }).catch(() => {});
    throw new Error(`no rung confirm prompt: ${JSON.stringify(readout)}`);
  }
  return readout;
}

/** Take the CLAUDIUM rail. It is the SECOND button on the dual prompt (gold is
 *  primary by position), and taking it by index would be a cancel on the
 *  gold-only shape, so it is taken by CLASS. */
async function takeClaudiumRail(page) {
  const label = await page.evaluate(() => {
    const alt = document.querySelector('.bank-buy-prompt .bank-buy-alt');
    if (!alt) return null;
    const text = alt.textContent;
    alt.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return text;
  });
  if (label === null) throw new Error('no Claudium rail on the confirm prompt');
  return label;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  // The proxy is in the path only so every rig script shares one
  // WOC_ECONOMY_SERVICE_URL. Put its delay back to zero on the way in, because a
  // run that failed between the durability probe's two phases leaves it at 9000
  // and every purchase here would then time out for a reason that is not its own.
  await setProxyDelay(0);
  const uniq = String(Date.now())
    .slice(-6)
    .replace(/[0-9]/g, (d) => 'abcdefghij'[Number(d)]);
  const user = `rung${uniq}`;
  const charName = `Rung${uniq[0].toUpperCase()}${uniq.slice(1)}`;
  const browser = await launchBrowser(`${OUT}/profile`);
  const page = await browser.newPage();
  page.on('pageerror', (e) => note(`pageerror: ${e.message}`));
  try {
    await enter(page, user, charName, 'warrior', { create: true });
    const accountId = await accountIdOf(user);
    note(`entered as ${charName}, account ${accountId}`);

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
        reason: 'phase17 bank rung probe',
        requestId: `qa17-${accountId}-${uniq}`,
      }),
    }).then((r) => r.json());
    if (credited.ok !== true) throw new Error(`admin credit failed: ${JSON.stringify(credited)}`);

    await standAtBursar(page);
    const before = await page.evaluate(() => window.__game.world.bankInfo?.purchasedSlots ?? -1);

    // --- ARM 1: buy a rung with CLAUDIUM through the real UI ---------------
    const opened = await openRungPrompt(page);
    check(
      'R1 the confirm carries BOTH rails and inerts the window behind it',
      opened.claudiumTag && opened.buttons.length === 3 && opened.inert === true,
      JSON.stringify(opened),
    );
    const railLabel = await takeClaudiumRail(page);
    note(`Claudium rail taken by label: ${JSON.stringify(railLabel)}`);
    await page.waitForFunction(
      (prev) => (window.__game.world.bankInfo?.purchasedSlots ?? -1) > prev,
      { timeout: 25000, polling: 250 },
      before,
    );
    const after = await page.evaluate(() => window.__game.world.bankInfo?.purchasedSlots ?? -1);
    check(
      'R2 the ladder advanced by exactly one rung',
      after === before + 6,
      `${before} -> ${after}`,
    );

    const debits = await economyDebits(accountId);
    check(
      'R3 THE CLAIM: exactly ONE Claudium debit exists for the rung',
      debits.length === 1 && Number(debits[0].delta) < 0,
      JSON.stringify(debits),
    );
    const rows = await gamePurchaseRows(accountId);
    check(
      'R4 and the game server holds exactly ONE applied purchase row for it',
      rows.length === 1 && rows[0].status === 'applied',
      JSON.stringify(rows),
    );
    check(
      'R5 the debit and the purchase row carry the SAME client-minted key',
      rows.length === 1 &&
        debits.length === 1 &&
        rows[0].idempotency_key === debits[0].idempotency_key,
      JSON.stringify({ row: rows[0]?.idempotency_key, debit: debits[0]?.idempotency_key }),
    );
    const band = await page.evaluate(
      () => document.querySelector('.bank-rung-notice')?.textContent ?? null,
    );
    check(
      'R6 a result band is painted for the purchase',
      typeof band === 'string' && band.length > 0,
      String(band),
    );

    // --- ARM 2: a repaint that tears the prompt down ENDS the attempt ------
    // The phase's own behaviour change, and the reason it needs a real server:
    // the repaint is driven by the slow band observing an authoritative bank
    // change, which is not a thing jsdom can produce.
    await openRungPrompt(page);
    const armed = await durableRow(page);
    const sku = armed.parsed?.intents ? Object.keys(armed.parsed.intents)[0] : null;
    check('R7 opening the confirm armed a DURABLE intent', sku !== null, armed.raw ?? 'null');

    // Move the bank data from OUTSIDE the inert window, which is what a real
    // slow-band repaint reacts to.
    await page.evaluate(() => window.__game.world.chat('/dev gold 250000'));
    await page.evaluate(() => window.__game.world.bankBuySlots());
    const gone = await page
      .waitForFunction(() => !document.querySelector('.bank-buy-prompt'), {
        timeout: 20000,
        polling: 200,
      })
      .then(() => true)
      .catch(() => false);
    check('R8 the repaint tore the confirm prompt down', gone);
    await sleep(600);
    const afterTeardown = await durableRow(page);
    check(
      'R9 THE PHASE CHANGE: the teardown ENDED the attempt, so the durable record is gone',
      sku !== null && afterTeardown.parsed?.intents?.[sku] === undefined,
      afterTeardown.raw ?? 'null',
    );

    // --- ARM 3: and no second debit came out of any of it ------------------
    const finalDebits = await economyDebits(accountId);
    check(
      'R10 STILL exactly one Claudium debit after the teardown and the gold rung',
      finalDebits.length === 1,
      JSON.stringify(finalDebits),
    );
    const forwards = await proxySpendCount();
    note(`proxy /spend forwards over the whole run: ${JSON.stringify(forwards)}`);
  } finally {
    await browser.close().catch(() => {});
  }
}

await main()
  .catch((e) => {
    note(`PROBE ERROR ${e?.stack ?? e}`);
    fail++;
  })
  .finally(() => {
    const summary = `=== bank rung Claudium probe: ${pass} passed, ${fail} failed ===`;
    console.log(`\n${summary}`);
    // The transcript is written next to the profile so a run can be committed as
    // evidence, which is the whole point of a go-live: it attests to the tree it
    // RAN ON, and a re-run after any later fix is a different transcript.
    try {
      writeFileSync(`${OUT}/transcript.txt`, `${lines.join('\n')}\n${summary}\n`);
    } catch {}
    process.exit(fail === 0 ? 0 : 1);
  });
