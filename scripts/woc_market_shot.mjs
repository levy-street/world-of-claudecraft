// One-off local capture tool for the $WOC Exchange window PR
// (docs/prd/woc/marketplace.md): captures the REAL online window against a
// running server with the dev economy, so the screenshots show a live
// listing, the detail pane with the bid form, the sell tab, and the mobile
// landscape sheet, none of which exist offline (the window is online-only).
// The mobile arm also opens BOTH listing shapes' detail panes and asserts the
// money-surface touch floors (40px consent label, terms link and buttons, 24px
// checkbox, the bid field) plus the pre-bid disclosures' DOM order ahead of
// Place bid, the pixel-geometry arm the DOM units cannot see.
//
// Dev-only, not wired into any npm script or CI gate. Needs:
//   - a server started with WOC_MARKET_ENABLED=1 WOC_MARKET_DEV_SERVICE=1
//     ALLOW_DEV_COMMANDS=1 (the dev economy quotes a fixed price and the
//     epic items arrive via /dev give)
//   - a running vite dev client proxying to that server
//
// Usage: GAME_URL=http://localhost:5173 SERVER_URL=http://localhost:8787 \
//        SHOTS_DIR=docs/screenshots/woc-market node scripts/woc_market_shot.mjs
//   STRESS=1      also seeds the stress content (a 16-letter seller name, the
//                 longest sellable names incl. a mount, the maximum price, and
//                 two more sellers at the per-seller listing cap so Browse
//                 fills a page) and shoots the stress captures; the buyer's own
//                 account gets three listings so Activity has rows.
//   SHOT_LANG=ru_RU  boots the client in that locale (the wordiest fills) and
//                 suffixes every capture with the locale; run it AFTER a
//                 STRESS=1 pass so the listings it browses already exist.
//   SHOT_PREFIX=before  names the files before-* instead of after-*.
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { ed25519 } from '@noble/curves/ed25519';
import bs58 from 'bs58';
import puppeteer from 'puppeteer-core';
import WebSocket from 'ws';
import { BROWSER_PATH } from './browser_path.mjs';
import { suppressGpuNotice } from './lib/gpu_notice_suppress.mjs';
import { dismissPerfNudge } from './lib/perf_nudge_dismiss.mjs';
import { worldAuthMessage } from './lib/world_auth.mjs';

const GAME_URL = process.env.GAME_URL ?? 'http://localhost:5173';
const SERVER_URL = process.env.SERVER_URL ?? 'http://localhost:8787';
const WS_BASE = SERVER_URL.replace(/^http/, 'ws');
const OUT = process.env.SHOTS_DIR ?? 'docs/screenshots/woc-market';
// Failure-path debug dumps go OUTSIDE the committed capture directory: a
// stalled run must never leave a debug-*.png where a bulk git add of the
// capture set would sweep it in.
const DEBUG_OUT = process.env.DEBUG_DIR ?? 'tmp';
const STRESS = process.env.STRESS === '1';
// The server's chat token bucket (server/game.ts CHAT_RATE_BURST /
// CHAT_RATE_REFILL_PER_SECOND / CHAT_COOLDOWN_SECONDS): a dev command is a
// chat message, so the seeder paces itself to it rather than losing gifts.
const CHAT_BURST = 4;
const CHAT_REFILL_MS = 3200;
const CHAT_COOLDOWN_MS = 21000;
// The listing endpoint's own throttle (server/ratelimit.ts
// WOC_MARKET_LIST_MAX_PER_MINUTE = 10, a sliding minute fused across the
// per-IP and per-account buckets): every seeded seller shares 127.0.0.1, so
// the IP half is what a multi-seller seed exhausts. Pace the creates at the
// sustained rate and honour a 429's own retry hint. The step-up mint is a
// separate, looser bucket (20/min) and needs no pacing of its own.
const LIST_MIN_INTERVAL_MS = 6500;
let lastListingAtMs = 0;
async function paceListingCall() {
  const waitMs = lastListingAtMs + LIST_MIN_INTERVAL_MS - Date.now();
  if (waitMs > 0) await sleep(waitMs);
  lastListingAtMs = Date.now();
}
const SHOT_LANG = process.env.SHOT_LANG ?? '';
const SHOT_PREFIX = process.env.SHOT_PREFIX ?? 'after';
// SEED=0 with BUYER=<username> reuses listings and a buyer this rig already
// seeded (a rerun, or the before-state pass over the same database), so an
// iteration costs a browser flow rather than five minutes of paced seeding.
const SEED = process.env.SEED !== '0';
const REUSE_BUYER = process.env.BUYER ?? '';
// The page URL: the locale rides the boot query (the client's own language
// switch), so every capture of a locale pass reads in that locale.
const PAGE_URL = SHOT_LANG ? `${GAME_URL}/?lang=${encodeURIComponent(SHOT_LANG)}` : GAME_URL;
const shotName = (base) => `${SHOT_PREFIX}-${base}${SHOT_LANG ? `-${SHOT_LANG}` : ''}.png`;
// The stress fixtures: the longest sellable equipment name and the longest
// mount name (mounts trade at any rarity on the default policy), listed at the
// MAXIMUM price so $1,000.00 lands in the table, the detail pane and the hints.
const LONG_ITEM = 'voidsong_dirk';
const LONG_MOUNT = 'reins_shadowjump_toad';
const MAX_PRICE_CENTS = 100000;
// Sellable epics for the page-filling sellers (each seller may hold twelve
// active listings; a fresh character's sixteen bag slots already carry its
// starter kit, so no seeded seller receives more than eight gifts).
const FILLER_ITEMS = [
  'kingsbane_last_oath',
  'deathless_heartwood',
  'blackwater_vanguard_chest',
  'scepter_of_the_deathless_court',
  'vestments_of_the_waking_grove',
  'morthens_cryptforged_hauberk',
  'necromancers_soulspire_mantle',
  'architects_cornerstone',
  'medallion_of_endless_profit',
  'maul_of_the_scourged_wilds',
  'deathless_warguard_legmail',
  'wildheart_hexwood_staff',
];
// TWO listings, because a listing is an auction XOR a buy-now now that the
// combined format is no longer creatable: one of each is what makes the detail
// pane's bid form and its Buy now button both reachable in a capture.
const EPIC_ITEM = 'deathlord_warplate';
const BUY_NOW_ITEM = 'wyrmshadow_harness';
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(DEBUG_OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// One assertion ledger for the whole run (the desktop stress arm asserts its
// rows opened, the mobile arm its floors), drained at the end.
const fails = [];
const check = (cond, msg) => {
  console.log(`${cond ? 'OK  ' : 'FAIL'}  ${msg}`);
  if (!cond) fails.push(msg);
};
const uniq = Date.now().toString(36).slice(-6);
// Character names are letters only (2 to 16), so the name suffix maps digits
// onto letters; usernames may keep the raw base36.
const alpha = uniq.replace(/[0-9]/g, (d) => 'abcdefghij'[Number(d)]);
// The TAIL of the base36 stamp, not the head: the leading digits are the coarse
// ones (the 4th from the end only rolls over about once a minute), so slicing
// from the front reused a name across reruns and the register returned 409.
const nameSuffix = alpha.slice(-4);

async function api(path, body, token, method = 'POST') {
  const res = await fetch(SERVER_URL + path, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

// The real wallet-link flow, signed with a throwaway ed25519 key: challenge,
// sign the returned message, link. No custody anywhere, exactly like a wallet.
async function linkThrowawayWallet(token) {
  const secret = randomBytes(32);
  const address = bs58.encode(ed25519.getPublicKey(secret));
  const challenge = await api('/api/wallet/link/challenge', { address }, token);
  if (challenge.status !== 200) throw new Error(`challenge failed: ${challenge.status}`);
  const signature = bs58.encode(
    ed25519.sign(new TextEncoder().encode(challenge.body.message), secret),
  );
  const link = await api(
    '/api/wallet/link',
    { address, signature, nonce: challenge.body.nonce },
    token,
  );
  if (link.status !== 200) {
    throw new Error(`link failed: ${link.status} ${JSON.stringify(link.body)}`);
  }
  return { address, secret };
}

// The listing step-up (B6/R1): a server-built challenge signed by the linked
// wallet rides beside the listing params (a bare create refuses
// stepup_required since the step-up landed).
async function stepUpFor(token, secret, params) {
  const ch = await api(
    '/api/woc-market/step-up/challenge',
    { operation: 'create_listing', expectInstance: null, ...params },
    token,
  );
  if (ch.status !== 200) {
    throw new Error(`step-up challenge failed: ${ch.status} ${JSON.stringify(ch.body)}`);
  }
  const c = ch.body.challenge ?? ch.body;
  const signature = bs58.encode(ed25519.sign(new TextEncoder().encode(c.message), secret));
  return { nonce: c.nonce, signature };
}

/** Log in to an account this rig seeded earlier (SEED=0 reuse). */
async function loginAccount(username) {
  const res = await api('/api/login', { username, password: 'hunter22' });
  if (res.status !== 200) throw new Error(`login ${username} failed: ${res.status}`);
  return { username, token: res.body.token };
}

/**
 * Listing ids by item, read from the REAL browse endpoint rather than by
 * matching row TEXT: a price or an item name renders in the client's locale
 * ("250,00 $" in ru), so every English needle silently found no row and the
 * whole detail-pane arm then measured a pane that was never opened. Newest id
 * per item wins (this rig seeds the same ids repeatedly).
 */
async function listingIdsByItem(token) {
  const byItem = new Map();
  for (let page = 0; page < 4; page++) {
    const res = await api(
      `/api/woc-market/listings?page=${page}&sort=newest`,
      undefined,
      token,
      'GET',
    );
    if (res.status !== 200) break;
    for (const row of res.body.listings ?? []) {
      if (!byItem.has(row.itemId)) byItem.set(row.itemId, row.id);
    }
    if (!res.body.hasMore) break;
  }
  return byItem;
}

async function registerAccount(prefix) {
  const username = `${prefix}${uniq}`;
  const reg = await api('/api/register', {
    username,
    password: 'hunter22',
    email: `${username}@example.com`,
  });
  if (reg.status !== 200) throw new Error(`${prefix} register failed: ${reg.status}`);
  return { username, token: reg.body.token };
}

// A seller: registers (or reuses the given account), links a wallet, joins
// over the raw wire, receives the items via /dev give, then lists them on the
// Exchange through the real REST flow. `shapes` are the listing params per
// item; the returned account carries the character so a browser can log in
// as it afterwards (the buyer's own listings for the Activity tab).
async function seedListings({ prefix, charName, shapes, account = null }) {
  const { username, token } = account ?? (await registerAccount(prefix));
  const { secret } = account?.wallet ?? (await linkThrowawayWallet(token));
  const char = await api('/api/characters', { name: charName, class: 'warrior' }, token);
  if (char.status !== 200) throw new Error(`${prefix} character failed: ${char.status}`);
  const characterId = char.body.id;

  const ws = new WebSocket(`${WS_BASE}/ws`);
  // The delta-guarded self.inv rides the snapshot: the REAL bag index of each
  // gift, so every listing costs one step-up plus one create (walking forty
  // indexes trips the listing rate limiter now that the step-up doubles the
  // calls per attempt).
  let inv = null;
  await new Promise((resolve, reject) => {
    ws.on('open', () => {
      ws.send(JSON.stringify(worldAuthMessage(token, characterId)));
    });
    ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.self && Array.isArray(msg.self.inv)) inv = msg.self.inv;
      if (msg.t === 'hello') resolve(undefined);
      if (msg.t === 'error') reject(new Error(`seller join refused: ${msg.error}`));
    });
    ws.on('error', reject);
  });
  // ONE item at a time: give it, wait for the delta-guarded self.inv to show
  // it, list it, then wait for the escrow delta to take it back out. A fresh
  // character's sixteen backpack slots are mostly starter kit, so front-loading
  // every gift silently overflowed the bags and the listing loop then failed on
  // an item that had never landed. Listing frees the slot again, so this shape
  // seeds any number of listings per seller within the active-listing cap.
  const waitForItem = async (itemId, tries) => {
    for (let i = 0; i < tries; i++) {
      const index = (inv ?? []).findIndex((s) => s && s.itemId === itemId);
      if (index >= 0) return index;
      await sleep(300);
    }
    return -1;
  };
  // A dev command rides the CHAT channel, which is token bucketed on the
  // server (burst 5, then one per 3 seconds, and three refusals in a row buy a
  // 20 second cooldown). A seeding loop that ignores it silently loses gifts
  // after the fifth item, which then reads as "never reached the bags". Spend
  // the burst, then pace; a miss waits out the cooldown and retries once.
  let gifts = 0;
  const giveAndWait = async (itemId) => {
    if (gifts >= CHAT_BURST) await sleep(CHAT_REFILL_MS);
    gifts++;
    ws.send(JSON.stringify({ t: 'cmd', cmd: 'chat', text: `/dev give ${itemId}` }));
    const found = await waitForItem(itemId, 20);
    if (found >= 0) return found;
    // Assume the bucket refused it: wait the cooldown out and try once more.
    await sleep(CHAT_COOLDOWN_MS);
    ws.send(JSON.stringify({ t: 'cmd', cmd: 'chat', text: `/dev give ${itemId}` }));
    return waitForItem(itemId, 40);
  };
  const listed = [];
  for (const shape of shapes) {
    const index = await giveAndWait(shape.itemId);
    if (index < 0) {
      throw new Error(
        `${shape.itemId} never reached the bags (${(inv ?? []).length} slots used); is ALLOW_DEV_COMMANDS=1 set?`,
      );
    }
    const params = { startCents: 2500, durationHours: 24, offerNext: true, ...shape };
    const create = async () => {
      await paceListingCall();
      // The step-up nonce is single-use and short-lived, so it is minted INSIDE
      // the paced window, never before the wait.
      const stepUp = await stepUpFor(token, secret, params);
      return api(
        '/api/woc-market/listings',
        { characterId, itemIndex: index, ...params, stepUp },
        token,
      );
    };
    let out = await create();
    if (out.status === 429) {
      const retryMs = Math.min(90, Number(out.body?.retryAfterSeconds ?? 60)) * 1000 + 1500;
      console.log(`listing ${shape.itemId} throttled; waiting ${Math.round(retryMs / 1000)}s`);
      await sleep(retryMs);
      out = await create();
    }
    if (out.status === 200) {
      listed.push(shape.itemId);
      // Let the post-escrow inventory delta land before the next index read.
      for (let i = 0; i < 20 && (inv ?? []).some((s) => s && s.itemId === shape.itemId); i++) {
        await sleep(200);
      }
    } else {
      console.log(`listing ${shape.itemId} refused: ${out.status} ${JSON.stringify(out.body)}`);
    }
  }
  ws.close();
  if (listed.length < shapes.length) {
    throw new Error(
      `${prefix} listed only ${listed.length}/${shapes.length}; is WOC_MARKET_ENABLED=1 set on the server?`,
    );
  }
  console.log(
    `${prefix} ${username} listed ${listed.length} (${listed.slice(0, 3).join(', ')}...)`,
  );
  return { username, token, characterId, charName };
}

// The base pair: an AUCTION carries a reserve and no buy-now price, and a
// BUY-NOW carries the price and no reserve: the rules refuse any other pairing,
// so these are the only two shapes a new listing can take.
async function seedSellerListing() {
  await seedListings({
    prefix: 'wocsell',
    charName: `Aurelia${nameSuffix}`,
    shapes: [
      { itemId: EPIC_ITEM, format: 'auction', reserveCents: 10000, buyNowCents: null },
      { itemId: BUY_NOW_ITEM, format: 'buy_now', reserveCents: null, buyNowCents: 25000 },
    ],
  });
}

// The stress content: a 16-letter seller (the name cap) listing the longest
// names at the maximum price, plus two page-filling sellers at the cap.
async function seedStressListings() {
  const auction = (itemId, startCents = 2500) => ({
    itemId,
    format: 'auction',
    reserveCents: null,
    buyNowCents: null,
    startCents,
  });
  await seedListings({
    prefix: 'wocmax',
    // Twelve letters plus the four-letter run suffix: exactly the 16 cap.
    charName: `Bartholomewa${nameSuffix}`,
    shapes: [
      {
        itemId: LONG_MOUNT,
        format: 'buy_now',
        reserveCents: null,
        buyNowCents: MAX_PRICE_CENTS,
        startCents: 99975,
      },
      {
        itemId: LONG_ITEM,
        format: 'auction',
        reserveCents: 100000,
        buyNowCents: null,
        startCents: 99975,
      },
      ...FILLER_ITEMS.slice(0, 6).map((id) => auction(id)),
    ],
  });
  await seedListings({
    prefix: 'wocfill',
    charName: `Corvina${nameSuffix}`,
    shapes: FILLER_ITEMS.slice(0, 8).map((id, i) => auction(id, 2500 + i * 725)),
  });
  await seedListings({
    prefix: 'wocfilb',
    charName: `Dorian${nameSuffix}`,
    shapes: FILLER_ITEMS.slice(4, 12).map((id, i) => auction(id, 3100 + i * 640)),
  });
}

// The exemplar flow from scripts/social_landscape_online_shot.mjs, verbatim
// where it matters: goto retry, #btn-online, the toggling #login-panel form,
// the realm picker, charcreate, Enter World, the mobile preflight.
async function enterWorldInBrowser(
  page,
  { username, charName, cls, mobile = false, register = false, existingChar = false },
) {
  await suppressGpuNotice(page);
  // A takeover asks through a NATIVE window.confirm (src/main.ts
  // takeOverAndEnter), which puppeteer suppresses unless a dialog handler
  // answers it: without this the press silently did nothing and the flow hung
  // on the character panel. Registered once per page, before any click.
  if (!page.__wocDialogHandler) {
    page.__wocDialogHandler = true;
    page.on('dialog', (dialog) => {
      void dialog.accept().catch(() => {});
    });
  }
  // The capture rule: the LOWEST graphics preset, seeded before the document
  // loads (the renderer reads woc_settings.graphicsPreset at startup, so a
  // staging-time write lands too late; graphicsDefaultApplied rides along or
  // main.ts's first-run probe persists its own tier over the seed). Window
  // shots are evidence about the DOM, never render fidelity, and tier 1 is
  // what SwiftShader should be asked to pay for on a shared box.
  await page.evaluateOnNewDocument(
    `try { const k = 'woc_settings'; const s = JSON.parse(localStorage.getItem(k) || '{}'); s.graphicsPreset = 1; s.graphicsDefaultApplied = true; localStorage.setItem(k, JSON.stringify(s)); } catch {}`,
  );
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
      lastErr = undefined;
      break;
    } catch (e) {
      lastErr = e;
      await sleep(1000);
    }
  }
  if (lastErr) throw lastErr;
  if (mobile) await page.evaluate(() => document.body.classList.add('mobile-touch'));
  await page.waitForSelector('#btn-online', { timeout: 30000 });
  await sleep(1000);
  await page.evaluate(() => document.querySelector('#btn-online')?.click());
  await page.waitForSelector('#login-user', { visible: true, timeout: 45000 });
  let filled = false;
  for (let attempt = 0; attempt < 6 && !filled; attempt++) {
    filled = await page.evaluate(
      (u, p, mail, wantRegister) => {
        const form = document.querySelector('#login-panel');
        const userEl = document.querySelector('#login-user');
        const passEl = document.querySelector('#login-pass');
        const toggle = document.querySelector('#btn-auth-toggle');
        const submit = document.querySelector('#btn-login');
        if (!form || !userEl || !passEl || !toggle || !submit) return false;
        const mode = form.dataset.authMode === 'register' ? 'register' : 'login';
        const wanted = wantRegister ? 'register' : 'login';
        if (mode !== wanted) toggle.click();
        const emailEl = document.querySelector('#login-email');
        userEl.value = u;
        passEl.value = p;
        if (emailEl) emailEl.value = mail;
        submit.click();
        return true;
      },
      username,
      'hunter22',
      `${username}@example.com`,
      register,
    );
    if (!filled) await sleep(400);
  }
  if (!filled) throw new Error('login form never stabilized');
  // A REGISTER submit lands back on the site's own landing card (the account
  // is authenticated, the nav even flips to Logout) rather than straight into
  // the realm list, so the realm list simply never appears for the flow that
  // waited on it. Press PLAY again and re-check, the same shape as the realm
  // and enter-world retries below.
  let onRealms = false;
  for (let attempt = 0; attempt < 4 && !onRealms; attempt++) {
    onRealms = await page
      .waitForSelector('#realm-list .realm-row', { timeout: 8000 })
      .then(() => true)
      .catch(() => false);
    if (onRealms) break;
    console.log('realm list did not appear; pressing PLAY again');
    await page.evaluate(() => document.querySelector('#btn-online')?.click());
    await sleep(800);
  }
  if (!onRealms) throw new Error('realm list never appeared after the login submit');
  // The realm press occasionally lands before the row is wired (the realm list
  // paints from one fetch and wires from another), and the flow then waited out
  // its timeout at a panel that never opened: press until a panel answers.
  let onPanel = false;
  for (let attempt = 0; attempt < 4 && !onPanel; attempt++) {
    await page.evaluate(() => {
      const row = document.querySelector('#realm-list .realm-row');
      if (row instanceof HTMLElement) row.click();
    });
    onPanel = await page
      .waitForFunction(
        () =>
          !document.querySelector('#charcreate-panel')?.hasAttribute('hidden') ||
          !document.querySelector('#charselect-panel')?.hasAttribute('hidden'),
        { timeout: 8000, polling: 200 },
      )
      .then(() => true)
      .catch(() => false);
    if (!onPanel) console.log('realm press did not open a panel; retrying');
  }
  if (!onPanel) {
    // Name what the page actually shows: a bare throw here cost a rerun every
    // time, and every stall so far has been one of these fields.
    const state = await page.evaluate(() => ({
      realmRows: document.querySelectorAll('#realm-list .realm-row').length,
      firstRealm: document.querySelector('#realm-list .realm-row')?.textContent?.trim() ?? '',
      realmDisabled: document.querySelector('#realm-list .realm-row')?.hasAttribute('disabled'),
      realmErr: document.querySelector('#realm-error')?.textContent ?? '',
      login: document.querySelector('#login-panel')?.hasAttribute('hidden'),
      loginErr: document.querySelector('#login-error')?.textContent ?? '',
      charcreate: document.querySelector('#charcreate-panel')?.hasAttribute('hidden'),
      charselect: document.querySelector('#charselect-panel')?.hasAttribute('hidden'),
      game: typeof window.__game,
    }));
    console.error('realm press never opened a panel:', JSON.stringify(state));
    await page.screenshot({ path: `${DEBUG_OUT}/debug-realm.png` });
    throw new Error('realm selection never opened a character panel');
  }
  const onCreatePanel = await page.evaluate(
    () => !document.querySelector('#charcreate-panel')?.hasAttribute('hidden'),
  );
  // An account seeded over the wire already has its character (the buyer's
  // own listings): pick it from the select panel instead of creating one.
  if (!existingChar) {
    if (!onCreatePanel) {
      await page.evaluate(() => document.querySelector('#btn-new-character')?.click());
      await page.waitForFunction(
        () => !document.querySelector('#charcreate-panel')?.hasAttribute('hidden'),
        { timeout: 10000, polling: 200 },
      );
    }
    await page.evaluate(
      (name, wantedClass) => {
        document.querySelector('#new-char-name').value = name;
        document
          .querySelector(`#charcreate-panel .mini-class[data-class="${wantedClass}"]`)
          ?.click();
        document.querySelector('#btn-create-char').click();
      },
      charName,
      cls,
    );
  }
  // Dump the panel state rather than dying on a bare timeout: every stall in
  // this flow so far (a taken name, a refused register, a lease held by the
  // previous run) shows up as one of these fields, and a bare TimeoutError
  // named none of them.
  await page
    .waitForFunction(() => !document.querySelector('#charselect-panel')?.hasAttribute('hidden'), {
      timeout: 10000,
      polling: 200,
    })
    .catch(async (err) => {
      const state = await page.evaluate(() => ({
        login: document.querySelector('#login-panel')?.hasAttribute('hidden'),
        loginErr: document.querySelector('#login-error')?.textContent ?? '',
        realmRows: document.querySelectorAll('#realm-list .realm-row').length,
        charcreate: document.querySelector('#charcreate-panel')?.hasAttribute('hidden'),
        charselect: document.querySelector('#charselect-panel')?.hasAttribute('hidden'),
        createErr: document.querySelector('#charcreate-error')?.textContent ?? '',
        selectErr: document.querySelector('#charselect-error')?.textContent ?? '',
        rows: document.querySelectorAll('#char-list .char-row').length,
      }));
      console.error('character panel never opened:', JSON.stringify(state));
      await page.screenshot({ path: `${DEBUG_OUT}/debug-charselect.png` });
      throw err;
    });
  // WAIT for the list, do not sleep at it: an account whose character was
  // seeded over the wire (the buyer's own listings) lands on a select panel
  // that populates from a REST read, and a fixed sleep clicked an empty list
  // and hung at the panel with no error to show.
  await page.waitForSelector('#char-list .char-row', { timeout: 20000 });
  const enterWorld = async () => {
    await page.evaluate((name) => {
      const rows = [...document.querySelectorAll('#char-list .char-row')];
      const row =
        rows.find((r) => r.querySelector('.char-name')?.textContent?.trim() === name) ?? rows[0];
      row?.click();
      // A character the seeding socket still holds a lease on offers TAKE OVER
      // instead of Enter World (the row says "Already in world"), and the
      // shared button relabels itself the same way: press whichever is there.
      const enter = row?.querySelector('.enter-world-btn');
      const takeover =
        row?.querySelector('.take-over-btn') ??
        document.querySelector('#charselect-panel .take-over-btn');
      if (takeover instanceof HTMLElement) takeover.click();
      else if (enter instanceof HTMLElement) enter.click();
      else document.querySelector('#btn-enter-world')?.click();
    }, charName);
    await sleep(500);
    if (mobile) {
      await page
        .waitForSelector('#mobile-preflight-continue', { visible: true, timeout: 8000 })
        .catch(() => {});
      await page.evaluate(() => document.querySelector('#mobile-preflight-continue')?.click());
    }
  };
  await enterWorld();
  try {
    // Two more presses if the first is swallowed (a lease the seeding socket
    // has not released yet answers, and the panel stays put with no error).
    // NEVER re-press once the client is in: a second Take Over takes over this
    // session's OWN character, and the server then kicks the client that had
    // just entered (the flow died later at an undefined window.__game). So the
    // re-press is gated on __game still being absent, and a client that has
    // booted is given a longer window to finish streaming entities.
    for (let attempt = 0; attempt < 3; attempt++) {
      const entered = await page
        .waitForFunction(() => window.__game?.world?.entities?.size >= 1, {
          timeout: 30000,
          polling: 500,
        })
        .then(() => true)
        .catch(() => false);
      if (entered) break;
      const booted = await page.evaluate(() => typeof window.__game !== 'undefined');
      if (booted) {
        console.log('client is in; waiting for the entity stream');
        await page.waitForFunction(() => window.__game?.world?.entities?.size >= 1, {
          timeout: 60000,
          polling: 500,
        });
        break;
      }
      if (attempt === 2) throw new Error('never entered the world after three attempts');
      console.log('enter-world press did not take; retrying');
      await enterWorld();
    }
  } catch (err) {
    // Dump the stuck page state so a rerun can be diagnosed from the artifact.
    await page.screenshot({ path: `${DEBUG_OUT}/debug-stuck.png` });
    const state = await page.evaluate(() => ({
      login: document.querySelector('#login-panel')?.hasAttribute('hidden'),
      realm: document.querySelector('#realm-list') !== null,
      charcreate: document.querySelector('#charcreate-panel')?.hasAttribute('hidden'),
      charselect: document.querySelector('#charselect-panel')?.hasAttribute('hidden'),
      err: document.querySelector('#charselect-error')?.textContent ?? '',
      loginErr: document.querySelector('#login-error')?.textContent ?? '',
      game: typeof window.__game,
    }));
    console.error('stuck state:', JSON.stringify(state));
    throw err;
  }
  await page.evaluate(() => document.querySelector('button.tut-skip')?.click()).catch(() => {});
  await sleep(800);
}

async function openExchange(page) {
  // The online entry can leave the intro overlays up (enterOfflineGame handles
  // these for offline tours); dismiss anything that hides #ui before opening.
  await page.evaluate(() => {
    document.querySelector('button.tut-skip')?.click();
    document.querySelector('#intro-skip')?.click();
    document.querySelector('.camera-prompt-confirm')?.click();
    const ui = document.querySelector('#ui');
    if (ui instanceof HTMLElement && ui.style.display === 'none')
      ui.style.removeProperty('display');
    document.body.classList.remove('intro-active');
  });
  await sleep(400);
  await page.evaluate(() => window.__game.hud.toggleWocMarket());
  await page.waitForFunction(
    () =>
      document.querySelector('#woc-market-window .wm-table') !== null ||
      document.querySelector('#woc-market-window .wm-status') !== null,
    { timeout: 15000, polling: 250 },
  );
  await sleep(1200);
  const state = await page.evaluate(() => {
    const win = document.querySelector('#woc-market-window');
    const rect = win?.getBoundingClientRect();
    return {
      win: win?.getAttribute('style') ?? 'missing',
      body: (document.querySelector('#woc-market-window .wm-body')?.textContent ?? '').slice(0, 80),
      uiStyle: document.querySelector('#ui')?.getAttribute('style') ?? 'none-attr',
      uiHidden: document.querySelector('#ui')?.hasAttribute('hidden') ?? 'no-el',
      // The layout facts a screenshot cannot tell apart: a window wider than the
      // viewport looks identical to a correctly-sized one that the capture clipped.
      rect: rect ? `${Math.round(rect.left)},${Math.round(rect.width)}` : 'no-rect',
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      uiScale: getComputedStyle(document.documentElement).getPropertyValue('--ui-scale').trim(),
      mobileTouch: document.body.classList.contains('mobile-touch'),
    };
  });
  console.log('exchange state:', JSON.stringify(state));
}

async function shoot(page, file, clip, frameSel) {
  // The perf-doctor nudge fires mid-session on any slow machine, and a headless
  // swiftshader box is one: pressed away the way a player would, right before
  // the shot, or it sits in the frame's corner over the window.
  await dismissPerfNudge(page);
  // Frame the sheet from the TOP of whatever scrolls in it: the floor sweep
  // scrolls each control into view one at a time, so the last one it touched
  // decided the offset and the shots came out mid-face. A capture whose FACE
  // lives below the window top (the one-column sheet paints the detail pane
  // under the table) passes frameSel instead, and the frame starts there:
  // scrollIntoView honours the window's own scroll-padding-top, so the sticky
  // header never covers the face's first row.
  await page.evaluate((sel) => {
    const win = document.querySelector('#woc-market-window');
    if (win) win.scrollTop = 0;
    for (const pane of win?.querySelectorAll('.wm-body, .wm-browse, .wm-detail') ?? []) {
      pane.scrollTop = 0;
    }
    if (sel) document.querySelector(sel)?.scrollIntoView({ block: 'start' });
  }, frameSel ?? null);
  // The camera-choice prompt mounts a beat after world entry and would
  // overlay the window; dismiss it (and any lingering tutorial chip) at the
  // last moment before every capture.
  const dismissed = await page.evaluate(() => {
    const confirm = document.querySelector('.camera-prompt-confirm');
    if (confirm instanceof HTMLElement) confirm.click();
    document.querySelector('button.tut-skip')?.click();
    // The index-only Discord CTA banner floats over the top of the viewport and
    // sat across the window header in the first captures. It ships on / but not
    // on /play, so hiding it is the honest framing of the window itself.
    const cta = document.getElementById('discord-cta-banner');
    if (cta !== null) cta.hidden = true;
    // The software-rendering notice is a top-right toast that sat across the
    // window header and the minimap in the first stress captures; it is a
    // headless-environment artifact, so dismiss it rather than frame it.
    for (const btn of document.querySelectorAll('#gpu-notice button, .gpu-notice button')) {
      if (btn instanceof HTMLElement) btn.click();
    }
    const notice = document.querySelector('#gpu-notice, .gpu-notice');
    if (notice instanceof HTMLElement) notice.hidden = true;
    return confirm !== null;
  });
  if (dismissed) await sleep(500);
  await page.screenshot({ path: `${OUT}/${file}`, ...(clip ? { clip } : {}) });
  console.log(`wrote ${OUT}/${file}`);
}

async function clickTab(page, tab) {
  await page.evaluate((id) => {
    const el = document.querySelector(`#woc-market-window .wm-tab[data-tab="${id}"]`);
    if (el instanceof HTMLElement) el.click();
  }, tab);
  await sleep(600);
}

/**
 * Open a listing by id, WALKING the pager until its row is on screen.
 *
 * A listing id says nothing about which page it lands on: the sheet's default
 * order is "ending soonest" and a reused database holds pages of older rows, so
 * a direct click found no row and every detail-pane assertion after it then
 * measured a pane that was never opened. Sort NEWEST first (the rig's own seeds
 * lead that order), then page forward a bounded number of times.
 */
async function clickListing(page, listingId, { sortNewest = true } = {}) {
  if (sortNewest) {
    await page.evaluate(() => {
      const sel = document.querySelector('#woc-market-window [data-field="sort"]');
      if (sel instanceof HTMLSelectElement && sel.value !== 'newest') {
        sel.value = 'newest';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    await sleep(1500);
  }
  for (let page_ = 0; page_ < 6; page_++) {
    const clicked = await page.evaluate((id) => {
      const row = document.querySelector(`#woc-market-window .wm-row[data-listing="${id}"]`);
      if (row instanceof HTMLElement) {
        row.click();
        return true;
      }
      return false;
    }, listingId);
    if (clicked) {
      await sleep(1500);
      return true;
    }
    const advanced = await page.evaluate(() => {
      const next = document.querySelector('#woc-market-window [data-action="page-next"]');
      if (next instanceof HTMLButtonElement && !next.disabled) {
        next.click();
        return true;
      }
      return false;
    });
    if (!advanced) return false;
    await sleep(1400);
  }
  return false;
}

async function main() {
  if (SEED) {
    await seedSellerListing();
    if (STRESS) await seedStressListings();
  } else {
    console.log('SEED=0: reusing the listings already in the database');
  }

  const browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: 'new',
    args: ['--window-size=1600,1000', '--use-angle=swiftshader'],
  });

  // Buyer main: the account exists (and has its wallet linked) BEFORE the
  // browser signs in, so refreshWalletLinkStatus sees the link at login and
  // the window renders its wallet-live state. Under STRESS the buyer's own
  // character is seeded over the wire with three listings first, so the
  // Activity tab has rows of its own to show (and the picker later fills from
  // a bag of many epics).
  // A reused buyer logs in with the password every seeded account shares; its
  // character already exists and already holds listings.
  const buyer = REUSE_BUYER
    ? { username: REUSE_BUYER, token: null }
    : await registerAccount('wocbuy');
  const buyerWallet = REUSE_BUYER ? null : await linkThrowawayWallet(buyer.token);
  const buyerChar = REUSE_BUYER ? '' : `Bramble${nameSuffix}`;
  if (SEED && STRESS && !REUSE_BUYER) {
    await seedListings({
      prefix: 'wocbuy',
      charName: buyerChar,
      account: { ...buyer, wallet: buyerWallet },
      shapes: FILLER_ITEMS.slice(0, 3).map((id, i) => ({
        itemId: id,
        format: 'auction',
        reserveCents: null,
        buyNowCents: null,
        startCents: 4000 + i * 1000,
      })),
    });
  }
  // The authenticated read that maps items to listing ids (locale-proof row
  // selection); a reused buyer logs in for its token.
  const buyerToken = buyer.token ?? (await loginAccount(buyer.username)).token;
  const listingIds = await listingIdsByItem(buyerToken);
  console.log(`listing ids: ${listingIds.size} items on the newest pages`);
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  await enterWorldInBrowser(page, {
    username: buyer.username,
    charName: buyerChar,
    cls: 'rogue',
    existingChar: STRESS || REUSE_BUYER !== '',
  });
  await openExchange(page);
  // ZERO STATES first, before any bag gift: the Sell tab with nothing eligible
  // and, without stress seeding, the Activity tab with nothing at all.
  await clickTab(page, 'sell');
  await shoot(page, shotName('desktop-sell-empty'));
  await clickTab(page, 'activity');
  await shoot(page, shotName(STRESS ? 'desktop-activity-own-listings' : 'desktop-activity-empty'));
  await clickTab(page, 'browse');
  // Epics in the buyer's own bags give the Sell tab real rows (many, under
  // stress, so the picker list scrolls).
  // Paced to the same chat bucket as the seeder above (the client's own chat
  // call is the same channel); the first few ride the burst.
  const gifts = STRESS ? [EPIC_ITEM, ...FILLER_ITEMS.slice(3, 9), LONG_ITEM] : [EPIC_ITEM];
  for (const [i, item] of gifts.entries()) {
    await page.evaluate((id) => window.__game.world.chat(`/dev give ${id}`), item);
    await sleep(i >= CHAT_BURST - 1 ? CHAT_REFILL_MS : 500);
  }
  await sleep(1200);
  await page.evaluate(() => {
    const row = document.querySelector('#woc-market-window .wm-row');
    if (row instanceof HTMLElement) row.click();
  });
  await sleep(1500);
  await shoot(page, shotName('desktop-browse'));
  if (STRESS) {
    // The maximum price on the longest mount name (the buy-now pane), then the
    // longest equipment name at a maximum starting bid (the bid form). Both by
    // listing id, never by rendered text (see listingIdsByItem).
    if (listingIds.has(LONG_MOUNT)) {
      check(
        await clickListing(page, listingIds.get(LONG_MOUNT)),
        'stress: the max-price mount row opened',
      );
      await shoot(page, shotName('desktop-browse-stress-max-price'));
    }
    if (listingIds.has(LONG_ITEM)) {
      check(
        await clickListing(page, listingIds.get(LONG_ITEM)),
        'stress: the long-name auction row opened',
      );
      await shoot(page, shotName('desktop-browse-stress-long-name'));
    }
    // The last page of a full browse: page-next until it disables.
    for (let i = 0; i < 4; i++) {
      const more = await page.evaluate(() => {
        const next = document.querySelector('#woc-market-window [data-action="page-next"]');
        if (next instanceof HTMLButtonElement && !next.disabled) {
          next.click();
          return true;
        }
        return false;
      });
      if (!more) break;
      await sleep(1200);
    }
    await shoot(page, shotName('desktop-browse-stress-last-page'));
    await page.evaluate(() => {
      const prev = document.querySelector('#woc-market-window [data-action="page-prev"]');
      if (prev instanceof HTMLButtonElement && !prev.disabled) prev.click();
    });
    await sleep(1200);
  }

  await clickTab(page, 'sell');
  // The picker is a combobox now, not a grid of .wm-sell-item buttons. Focus
  // ALONE opens the full list (the delegated focusin arm), and an option commits
  // on MOUSEDOWN rather than click, because the options are non-focusable divs
  // and a click would blur the input first.
  await page.evaluate(() => {
    document.querySelector('#woc-market-window .wm-combo-input')?.focus();
  });
  await sleep(700);
  await shoot(page, shotName('desktop-sell'));
  await page.evaluate(() => {
    document
      .querySelector('#woc-market-window .wm-combo-item')
      ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  });
  await sleep(700);
  // A typed price lands the resolved fee lines under the form.
  await page.evaluate(() => {
    const start = document.querySelector('#woc-market-window [data-field="sell-start"]');
    if (start instanceof HTMLInputElement) {
      start.value = '125';
      start.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await sleep(1200);
  await shoot(page, shotName('desktop-sell-selected'));
  await page.close();

  // Mobile landscape (in-game mobile is landscape-only on the web client).
  // Entry happens on the desktop shell (the mobile marketing shell's login
  // path diverges under emulation), then the viewport flips to landscape
  // device metrics + mobile-touch, which is what the HUD's sheet layout keys
  // on (body class + viewport), before the window opens.
  const mob = await registerAccount('wocmob');
  await linkThrowawayWallet(mob.token);
  // A fresh browser context: the default profile keeps the buyer's stored
  // session, whose auto-resume skips the login panel this flow waits on.
  const mobileContext = await browser.createBrowserContext();
  const mobile = await mobileContext.newPage();
  await mobile.setViewport({ width: 1280, height: 800 });
  await enterWorldInBrowser(mobile, {
    username: mob.username,
    charName: `Wren${nameSuffix}`,
    cls: 'mage',
  });
  // Puppeteer's OWN setViewport, not a raw Emulation.setDeviceMetricsOverride.
  // A raw CDP override is invisible to puppeteer, and page.screenshot re-asserts
  // the metrics it believes in before capturing: the layout snapped back to
  // 1280 wide and the clip then cropped the top-left of a desktop-width window,
  // which looks exactly like a window overflowing its viewport. The logged rect
  // vs viewport pair below is what caught it.
  // No isMobile/hasTouch here: flipping either makes puppeteer RELOAD the page,
  // which throws away the entered world (window.__game) this flow then drives.
  // The mobile sheet keys on the body.mobile-touch class, set below, so the
  // metrics alone are what the viewport has to supply.
  await mobile.setViewport({ width: 915, height: 412, deviceScaleFactor: 2 });
  const client = await mobile.createCDPSession();
  await client.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  await mobile.evaluate(() => {
    document.body.classList.add('mobile-touch');
    window.dispatchEvent(new Event('resize'));
  });
  await sleep(1500);
  await openExchange(mobile);
  // No clip: the viewport IS the frame now that puppeteer owns the metrics.
  await shoot(mobile, shotName('mobile-browse'), null);

  // The money-surface floors, in a REAL phone viewport: open each listing
  // shape's detail pane and measure what the DOM units cannot (rendered tap
  // heights, on-screen after scroll, the disclosures' DOM order).
  const openRow = (listingId) => clickListing(mobile, listingId);
  const measureDetail = async () =>
    mobile.evaluate(() => {
      const detail = document.querySelector('#woc-market-window .wm-detail');
      const rect = (el) => {
        if (!el) return null;
        el.scrollIntoView({ block: 'nearest' });
        const r = el.getBoundingClientRect();
        return {
          w: Math.round(r.width),
          h: Math.round(r.height),
          onScreen:
            r.top >= 0 &&
            r.bottom <= window.innerHeight &&
            r.left >= 0 &&
            r.right <= window.innerWidth,
        };
      };
      const pick = (sel) => rect(detail?.querySelector(sel) ?? null);
      const order = [...(detail?.querySelectorAll('p.wm-note, button[data-action]') ?? [])].map(
        (el) =>
          `${el.getAttribute('data-action') ?? 'note'}:${(el.textContent || '').trim().slice(0, 40)}`,
      );
      return {
        termsLabel: pick('label.wm-terms'),
        termsBox: pick('label.wm-terms input'),
        termsLink: pick('a.wm-terms-link'),
        buyNow: pick('button[data-action="buy-now"]'),
        placeBid: pick('button[data-action="place-bid"]'),
        bidUsd: pick('input[data-field="bid-usd"]'),
        order,
      };
    });
  const floors = (m, label) => {
    check(m.termsLabel !== null, `${label}: the consent row renders (fresh account)`);
    if (m.termsLabel) {
      check(m.termsLabel.h >= 40, `${label}: consent label height ${m.termsLabel.h} >= 40`);
      check(
        m.termsBox && m.termsBox.w >= 24 && m.termsBox.h >= 24,
        `${label}: consent checkbox ${m.termsBox?.w}x${m.termsBox?.h} >= 24`,
      );
      check(
        m.termsLink && m.termsLink.h >= 40,
        `${label}: terms link height ${m.termsLink?.h} >= 40`,
      );
      check(m.termsLabel.onScreen && m.termsLink?.onScreen, `${label}: consent row on screen`);
    }
  };
  // Every control on the sheet at the touch floor: a window-wide sweep of the
  // buttons, links, inputs, selects and consent labels the CSS claims to
  // floor (40px, checkbox 24px, inputs at the 16px anti-zoom font), plus the
  // coarse-pointer fact the floors depend on.
  const sweepFloors = async (label) => {
    const m = await mobile.evaluate(() => {
      const win = document.querySelector('#woc-market-window');
      const rows = [];
      for (const el of win?.querySelectorAll(
        'button, a, input, select, label.wm-terms, label.wm-offer-next',
      ) ?? []) {
        if (el.closest('[hidden]')) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        const cs = getComputedStyle(el);
        rows.push({
          tag: el.tagName.toLowerCase(),
          type: el.getAttribute('type') ?? '',
          key: el.getAttribute('data-focus-key') ?? el.getAttribute('data-action') ?? el.className,
          w: Math.round(r.width),
          h: Math.round(r.height),
          font: Number.parseFloat(cs.fontSize),
        });
      }
      return { coarse: matchMedia('(pointer: coarse)').matches, rows };
    });
    console.log(`   ${label}: pointer coarse ${m.coarse}, ${m.rows.length} controls`);
    for (const c of m.rows) {
      const isBox = c.tag === 'input' && c.type === 'checkbox';
      const floor = isBox ? 24 : 40;
      check(c.h >= floor, `${label}: ${c.tag} [${c.key}] height ${c.h} >= ${floor}`);
      if ((c.tag === 'input' && !isBox) || c.tag === 'select')
        check(c.font >= 16, `${label}: ${c.tag} [${c.key}] font ${c.font} >= 16`);
    }
  };
  await sweepFloors('mobile browse');
  // The BUY-NOW pane (no bid form): the consent row plus the walk-away note.
  check(
    listingIds.has(BUY_NOW_ITEM) && (await openRow(listingIds.get(BUY_NOW_ITEM))),
    'buy-now listing row opened',
  );
  const bn = await measureDetail();
  floors(bn, 'buy-now');
  check(bn.buyNow && bn.buyNow.h >= 40, `buy-now: Buy now button height ${bn.buyNow?.h} >= 40`);
  const buyIdx = bn.order.findIndex((o) => o.startsWith('buy-now:'));
  // Two checks, because a locale pass renders its own wording: the STRUCTURAL
  // one (a disclosure sits above the action) holds in every locale, and the
  // English needle runs only where the source copy is authored. Matching the
  // English text under a fill would pin the needle, not the layout.
  check(
    bn.order.findIndex((o) => o.startsWith('note:')) >= 0 &&
      bn.order.findIndex((o) => o.startsWith('note:')) < buyIdx,
    'buy-now: a disclosure precedes the button',
  );
  if (!SHOT_LANG)
    check(
      bn.order.findIndex((o) => o.startsWith('note:Buy now holds')) >= 0 &&
        bn.order.findIndex((o) => o.startsWith('note:Buy now holds')) < buyIdx,
      'buy-now: the walk-away note precedes the button',
    );
  await shoot(mobile, shotName('mobile-buy-now-consent'), null, '#woc-market-window .wm-detail');
  await sweepFloors('mobile buy-now detail');
  // The AUCTION pane: the bid form with the disclosures BEFORE Place bid.
  check(
    listingIds.has(EPIC_ITEM) && (await openRow(listingIds.get(EPIC_ITEM))),
    'auction listing row opened',
  );
  const au = await measureDetail();
  floors(au, 'auction');
  const bidIdx = au.order.findIndex((o) => o.startsWith('place-bid:'));
  check(
    au.order.findIndex((o) => o.startsWith('note:')) >= 0 &&
      au.order.findIndex((o) => o.startsWith('note:')) < bidIdx,
    'auction: a disclosure precedes Place bid',
  );
  if (!SHOT_LANG)
    check(
      au.order.findIndex((o) => /binding/i.test(o)) >= 0 &&
        au.order.findIndex((o) => /binding/i.test(o)) < bidIdx,
      'auction: the binding disclosure precedes Place bid',
    );
  check(au.placeBid && au.placeBid.h >= 40, `auction: Place bid height ${au.placeBid?.h} >= 40`);
  check(au.bidUsd && au.bidUsd.h >= 40, `auction: bid field height ${au.bidUsd?.h} >= 40`);
  await shoot(
    mobile,
    shotName('mobile-auction-disclosures'),
    null,
    // The face this capture is NAMED for is the pre-bid disclosure block, and
    // the auction pane is tall enough that the detail's top pushes it out of a
    // 420px frame: frame from the disclosures themselves.
    '#woc-market-window .wm-disclosures',
  );
  await sweepFloors('mobile auction detail');
  // The Sell tab: the combobox open, then a chosen item's form (its money
  // inputs and selects at the floor).
  await clickTab(mobile, 'sell');
  await mobile.evaluate((id) => window.__game.world.chat(`/dev give ${id}`), EPIC_ITEM);
  await sleep(1500);
  await mobile.evaluate(() => {
    document.querySelector('#woc-market-window .wm-combo-input')?.focus();
  });
  await sleep(700);
  await shoot(mobile, shotName('mobile-sell'), null);
  await sweepFloors('mobile sell picker');
  await mobile.evaluate(() => {
    document
      .querySelector('#woc-market-window .wm-combo-item')
      ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  });
  await sleep(700);
  await shoot(mobile, shotName('mobile-sell-selected'), null);
  await sweepFloors('mobile sell form');
  await mobile.close();

  await browser.close();
  console.log(
    fails.length === 0
      ? 'done: all mobile floor checks passed'
      : `${fails.length} mobile floor check(s) FAILED:\n - ${fails.join('\n - ')}`,
  );
  process.exit(fails.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
