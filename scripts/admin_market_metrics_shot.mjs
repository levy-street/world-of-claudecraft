// One-off local capture tool for the admin Market Metrics page
// (src/admin/pages/MarketMetrics.svelte, gated on analytics.read), shot with
// REAL listings in the REAL book.
//
// Everything is real on purpose. The panel reads
// server/admin_market_metrics.ts, whose source is the sim's live in-process
// listing book (Sim.marketListings, injected from server/main.ts), never a
// world_state blob and never SQL. So there is nothing to seed in Postgres: the
// only way to a populated panel is a player standing at the Merchant listing
// goods through the ordinary market_list command, which is what this does.
//
// Why the panel has no committed screenshot until now: it renders empty without
// staged market activity, and staging it needs a game session against the same
// process the dashboard reads.
//
// WHAT IS DELIBERATELY LEFT EMPTY: the `essence` bucket. Sundered Essence and
// Maker's Ember are soulbound and can never legally be listed
// (src/sim/market.ts reclaimSoulboundListings), so the bucket is a
// structural-zero tripwire: a nonzero there is a bug signal, and staging one for
// a prettier screenshot would fake exactly the alarm the panel exists to raise.
// The capture shows it at zero, which is its correct healthy state.
//
// Dev-only, not wired into any npm script or CI gate. Needs:
//   - the dev Postgres up (npm run db:up)
//   - a server on SERVER_URL with dev commands (e.g.
//     PORT=8791 ALLOW_DEV_COMMANDS=1 npm run server)
//   - a vite dev client on GAME_URL proxying to it
//     (e.g. WOC_DEV_API_TARGET=http://127.0.0.1:8791 npx vite --port 5196)
//
// Usage:
//   GAME_URL=http://localhost:5196 SERVER_URL=http://127.0.0.1:8791 \
//     node scripts/admin_market_metrics_shot.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import WebSocket from 'ws';
import { BROWSER_PATH } from './browser_path.mjs';
import { assertLoopbackDatabaseUrl, assertLoopbackUrl } from './lib/loopback_guard.mjs';
import { chatCommandMessage, worldAuthMessage } from './lib/world_auth.mjs';

const GAME_URL = process.env.GAME_URL ?? 'http://localhost:5196';
const SERVER_URL = process.env.SERVER_URL ?? 'http://127.0.0.1:8791';
const WS_BASE = SERVER_URL.replace(/^http/, 'ws');
const OUT = process.env.SHOTS_DIR ?? 'docs/screenshots/admin-market-metrics';

// This script registers accounts and grants a STAFF role, so every target it
// touches must be loopback (the mob_stall_repro.mjs policy): the HTTP server,
// the origin that receives the minted admin bearer via localStorage, AND the
// database grant_admin.mjs connects to.
assertLoopbackUrl(SERVER_URL, 'SERVER_URL');
assertLoopbackUrl(GAME_URL, 'GAME_URL');
try {
  process.loadEnvFile?.();
} catch {
  // .env is optional; the guard below still sees a directly-passed value.
}
assertLoopbackDatabaseUrl(process.env.DATABASE_URL);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, body, token) {
  const res = await fetch(SERVER_URL + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

fs.mkdirSync(OUT, { recursive: true });
const uniq = Date.now().toString(36).slice(-6);
const alpha = uniq.replace(/[0-9]/g, (d) => 'abcdefghij'[Number(d)]);

// One listing per POPULATED bucket, priced apart so the Lowest and Median
// columns show real spread rather than one repeated number. Counts stay inside
// the /dev give clamp (1..20) and the seller stays under MARKET_MAX_LISTINGS.
const LISTINGS = [
  { bucket: 'cores', item: 'wyrmfall_core', count: 2, price: 480000 },
  // The patterns bucket tracks every ITEMS entry with kind 'recipe'; the apex
  // plans are the ones that carry a real market price. The teachesRecipeId
  // ('recipe_...') is NOT an item id, so give the PATTERN id.
  { bucket: 'patterns', item: 'pattern_spiritweld_girdle', count: 1, price: 250000 },
  { bucket: 'produce', item: 'vale_wheat', count: 20, price: 900 },
  { bucket: 'produce', item: 'fine_vale_wheat', count: 8, price: 2600 },
  { bucket: 'produce', item: 'brook_carrot', count: 12, price: 1100 },
  { bucket: 'seeds', item: 'vale_wheat_seed', count: 15, price: 450 },
  { bucket: 'seeds', item: 'brook_carrot_seed', count: 10, price: 520 },
  { bucket: 'compost', item: 'compost', count: 20, price: 300 },
  { bucket: 'compost', item: 'growth_tonic', count: 6, price: 1800 },
];

// The seller.
const sellerUser = `mmseller${uniq}`;
const reg = await api('/api/register', {
  username: sellerUser,
  password: 'hunter22',
  email: `${sellerUser}@example.com`,
});
if (!reg.body.token) throw new Error(`register failed: ${JSON.stringify(reg.body)}`);
const char = await api(
  '/api/characters',
  { name: `Mkt${alpha}`.slice(0, 12), class: 'warrior' },
  reg.body.token,
);
if (!char.body.id) throw new Error(`character create failed: ${JSON.stringify(char.body)}`);

const ws = new WebSocket(`${WS_BASE}/ws`);
await new Promise((resolve, reject) => {
  const to = setTimeout(() => reject(new Error('ws join timeout')), 20000);
  ws.on('open', () => ws.send(JSON.stringify(worldAuthMessage(reg.body.token, char.body.id))));
  ws.on('message', (data) => {
    if (JSON.parse(String(data)).t === 'hello') {
      clearTimeout(to);
      resolve();
    }
  });
  ws.on('error', reject);
});
// Surface the sim's own refusals. Every staging step here can fail silently
// server-side (an unknown item id, a stall out of range, a price out of bounds),
// and without this the only symptom is an empty panel much later.
const simErrors = [];
ws.on('message', (data) => {
  const message = JSON.parse(String(data));
  if (message.t !== 'events') return;
  for (const event of message.list ?? []) {
    if (event.type === 'error') simErrors.push(event.text);
  }
});
const send = (payload) => ws.send(JSON.stringify(payload));
// Every /dev cheat rides the chat command envelope (scripts/lib/world_auth.mjs
// chatCommandMessage); a bare {t:'chat'} frame matches nothing in the server's
// command switch and is dropped in silence.
const dev = (text) => send(chatCommandMessage(text));

// Stock the bags FIRST, then walk to the stall. A fresh character is set down on
// the Proving Shore by the ferry a beat after entry
// (src/sim/content/proving_shore.ts PROVING_SHORE_ARRIVAL, x -281 z -18), and
// that arrival lands AFTER an earlier teleport and overrides it, so the
// teleport has to come last or the seller ends up an ocean away from the stall.
// PACED, not batched: /dev cheats ride the chat channel, so a burst of them
// trips the ordinary anti-spam rate limiter and the server locks chat for
// twenty seconds. The first time this ran unpaced it swallowed the teleport
// that follows, and every listing then refused with "You must bring your goods
// to the Merchant" while the real fault was three commands earlier.
for (const listing of LISTINGS) {
  dev(`/dev give ${listing.item} ${listing.count}`);
  await sleep(1200);
}
await sleep(3000); // let the queued grants apply, and let the ferry land

// The Merchant's stall. MERCHANT_POSITION is COMPUTED from MARKET_STALLS[0]
// (src/sim/eastbrook_layout.ts), not a literal, and the Eastbrook rebuild moved
// it: the live NPC stands at about (-19.3, -95.5), which is where marketList's
// nearMerchant check passes. Read it back from the running sim rather than
// trusting a copied constant if this ever starts refusing again: the older
// (0, 11.5) seat still carried in some tooling is stale for this build.
dev('/dev tp -19.3 -95.5');
await sleep(2000);

for (const listing of LISTINGS) {
  send({
    t: 'cmd',
    cmd: 'market_list',
    item: listing.item,
    count: listing.count,
    price: listing.price,
  });
  await sleep(250);
}
await sleep(1500);

// The operator. analytics.read is all the panel needs, but grant_admin's default
// superadmin covers it and matches the other admin shot scripts.
const adminUser = `mmop${uniq}`;
await api('/api/register', {
  username: adminUser,
  password: 'hunter22-op',
  email: `${adminUser}@example.com`,
});
execFileSync('node', ['scripts/grant_admin.mjs', adminUser], { stdio: 'inherit' });
const login = await api('/admin/api/login', { username: adminUser, password: 'hunter22-op' });
const adminToken = login.body?.data?.token;
if (!adminToken) throw new Error(`admin login failed: ${JSON.stringify(login.body)}`);

// Prove the book really populated BEFORE opening a browser, so a failed staging
// step fails here loudly instead of quietly producing an empty-panel screenshot
// that looks like a successful capture. The read is cached 15s server-side, so
// poll rather than reading once.
let staged = null;
let lastMetrics = null;
for (let attempt = 0; attempt < 20; attempt++) {
  const res = await fetch(`${SERVER_URL}/admin/api/market/metrics`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const json = await res.json().catch(() => ({}));
  lastMetrics = json;
  const buckets = json?.data?.buckets ?? [];
  const listed = buckets.filter((b) => b.listingCount > 0).map((b) => b.bucket);
  if (listed.length >= 4) {
    staged = { listed, buckets };
    break;
  }
  await sleep(1500);
}
if (!staged) {
  console.error(`last metrics response: ${JSON.stringify(lastMetrics)}`);
  console.error(`sim refusals during staging: ${JSON.stringify(simErrors)}`);
  throw new Error('market metrics never reported listings; the staging step did not land');
}
console.log(`staged buckets: ${staged.listed.join(', ')}`);
const essence = staged.buckets.find((b) => b.bucket === 'essence');
if (essence && essence.listingCount !== 0) {
  throw new Error(`essence is a structural-zero tripwire but reported ${essence.listingCount}`);
}

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1560,1000'],
});
const page = await browser.newPage();
await page.evaluateOnNewDocument(
  `localStorage.setItem('claudecraft_admin_token', ${JSON.stringify(adminToken)});
   localStorage.setItem('claudecraft_admin_name', ${JSON.stringify(adminUser)});`,
);

async function capture(name, viewport) {
  await page.setViewport(viewport);
  await page.goto(`${GAME_URL}/admin.html?page=market-metrics`, { waitUntil: 'networkidle2' });
  // Wait for real rows, never a fixed sleep: the page fetches after mount.
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr').length > 0, {
    timeout: 30000,
  });
  await sleep(400);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  console.log(`wrote ${OUT}/${name}.png`);
}

await capture('market-metrics-desktop', { width: 1440, height: 900 });
// Admin pages allow PORTRAIT for the mobile shot (the pr-screenshots skill:
// mobile is landscape-only for in-game HUD captures, and the dashboard is not
// the game).
await capture('market-metrics-mobile', { width: 390, height: 844, isMobile: true, hasTouch: true });

try {
  ws.close();
} catch {
  // Nothing to do; the capture is already written.
}
await browser.close();
process.exit(0);
