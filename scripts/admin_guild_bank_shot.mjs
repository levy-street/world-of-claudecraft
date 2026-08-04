// One-off local capture tool for the admin guild bank panel (the follow-up that
// closed the dormant-slot purge's dashboard deferral): shoots the guild detail
// page's bank panel and the remove-item confirmation, against a REAL server
// serving the REAL GET /admin/api/guilds/:id/bank endpoint.
//
// WHY IT SEEDS WITH SQL. A DORMANT slot is by construction a row no player
// action can produce: deposit refuses the copy in the first place, and a slot
// only becomes stuck when a later content update flags an item already sitting
// in the book (docs/guild-bank/state.md). Playing the scenario is therefore not
// possible; writing the legacy-shaped row is what actually reproduces it. The
// book is read at boot (GameServer.loadGuildBanks), so the row must exist
// BEFORE the server starts. Everything downstream is real: the real load path
// sanitizes the row, the real sim holds the book, the real endpoint projects
// it, and the real dashboard renders it.
//
// Dev-only, not wired into any npm script or CI gate. Needs:
//   - the dev Postgres up (npm run db:up)
//   - a vite dev client for the SPA under capture (WOC_DEV_API_TARGET pointed
//     at the SERVER_URL below), started AFTER this script prints the seeded
//     guild id is not required: the client only proxies
//   - a server started AFTER this script's seed step, on SERVER_URL
//
// Usage (two steps, because the seed must precede the server boot):
//   node scripts/admin_guild_bank_shot.mjs --seed
//   # start the server, e.g.:
//   #   PORT=8791 npm run server
//   # start the client, e.g.:
//   #   WOC_DEV_API_TARGET=http://127.0.0.1:8791 npx vite --port 5195
//   GAME_URL=http://localhost:5195 SERVER_URL=http://127.0.0.1:8791 \
//     SHOTS_DIR=docs/screenshots/admin-guild-bank-panel \
//     node scripts/admin_guild_bank_shot.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import pg from 'pg';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { assertLoopbackDatabaseUrl, assertLoopbackUrl } from './lib/loopback_guard.mjs';

const SEED_ONLY = process.argv.includes('--seed');
const GAME_URL = process.env.GAME_URL ?? 'http://localhost:5195';
const SERVER_URL = process.env.SERVER_URL ?? 'http://127.0.0.1:8791';
const REALM = process.env.REALM_NAME ?? 'Claudemoon';
const OUT = process.env.SHOTS_DIR ?? 'docs/screenshots/admin-guild-bank-panel';
const STATE_FILE = 'tmp/admin-guild-bank-shot.json';

// This script registers accounts and grants a STAFF role, so every target it
// touches must be loopback (the mob_stall_repro.mjs policy): the HTTP server,
// the origin that receives the minted admin bearer via localStorage, AND the
// database it seeds and grant_admin.mjs connects to.
if (!SEED_ONLY) {
  assertLoopbackUrl(SERVER_URL, 'SERVER_URL');
  assertLoopbackUrl(GAME_URL, 'GAME_URL');
}
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

// ---------------------------------------------------------------------------
// Step 1 (--seed, BEFORE the server boots): one guild whose book holds an
// ordinary stack, an ordinary crafted item, and one STUCK copy.
// ---------------------------------------------------------------------------
if (SEED_ONLY) {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const name = `Ashen Vault ${Date.now().toString(36).slice(-4)}`;
  const guild = await pool.query('INSERT INTO guilds (name, realm) VALUES ($1, $2) RETURNING id', [
    name,
    REALM,
  ]);
  const guildId = guild.rows[0].id;
  const book = {
    treasury: 123_456,
    purchasedSlots: 30,
    inventory: [
      { itemId: 'wolf_fang', count: 12 },
      // The stuck copy: reins_grag_bear is soulbound, so the anonymous-pipe
      // policy refuses it in BOTH directions. No officer can withdraw it and
      // the guild can never empty its bank.
      { itemId: 'reins_grag_bear', count: 1 },
      { itemId: 'iron_sword', count: 1, craftedRecipeId: 'smith_iron_sword' },
    ],
  };
  await pool.query('INSERT INTO guild_banks (guild_id, realm, data) VALUES ($1, $2, $3)', [
    guildId,
    REALM,
    JSON.stringify(book),
  ]);
  await pool.end();
  fs.mkdirSync('tmp', { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify({ guildId, name }, null, 2));
  console.log(`seeded guild ${guildId} (${name}); start the server, then re-run without --seed`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Step 2: an operator, a member for the roster, and the capture.
// ---------------------------------------------------------------------------
const { guildId, name } = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
fs.mkdirSync(OUT, { recursive: true });
const uniq = Date.now().toString(36).slice(-6);
const alpha = uniq.replace(/[0-9]/g, (d) => 'abcdefghij'[Number(d)]);

// A member, so the detail page reads like a real guild rather than an empty
// shell. The roster is a LIVE db read, so this can land after boot.
const playerUser = `gbmember${uniq}`;
const reg = await api('/api/register', {
  username: playerUser,
  password: 'hunter22',
  email: `${playerUser}@example.com`,
});
if (!reg.body.token) throw new Error(`register failed: ${JSON.stringify(reg.body)}`);
const char = await api(
  '/api/characters',
  { name: `Bryn${alpha}`.slice(0, 12), class: 'paladin' },
  reg.body.token,
);
if (!char.body.id) throw new Error(`character create failed: ${JSON.stringify(char.body)}`);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
await pool.query(
  `INSERT INTO guild_members (character_id, guild_id, rank) VALUES ($1, $2, 'leader')
   ON CONFLICT (character_id) DO UPDATE SET guild_id = EXCLUDED.guild_id, rank = 'leader'`,
  [char.body.id, guildId],
);
await pool.end();

// The operator. Superadmin, because the REMOVE action is superadmin-only
// (guildbank.purge); the read itself only needs moderation.read.
const adminUser = `gbop${uniq}`;
await api('/api/register', {
  username: adminUser,
  password: 'hunter22-op',
  email: `${adminUser}@example.com`,
});
execFileSync('node', ['scripts/grant_admin.mjs', adminUser], { stdio: 'inherit' });
const login = await api('/admin/api/login', { username: adminUser, password: 'hunter22-op' });
const adminToken = login.body?.data?.token;
if (!adminToken) throw new Error(`admin login failed: ${JSON.stringify(login.body)}`);

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1560,1000'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.evaluateOnNewDocument(
  `localStorage.setItem('claudecraft_admin_token', ${JSON.stringify(adminToken)});
   localStorage.setItem('claudecraft_admin_name', ${JSON.stringify(adminUser)});`,
);
await page.goto(`${GAME_URL}/admin.html?page=guilds&guildId=${guildId}`, {
  waitUntil: 'networkidle2',
});

// The panel is live once the stuck row is on screen.
await page.waitForFunction(
  () => [...document.querySelectorAll('td')].some((td) => td.textContent === 'reins_grag_bear'),
  { timeout: 30000 },
);
await sleep(400);
await page.screenshot({ path: `${OUT}/admin-guild-bank-panel.png`, fullPage: true });
console.log(`${OUT}/admin-guild-bank-panel.png (guild ${guildId}: ${name})`);

// Mobile: the summary collapses to a grid and the table scrolls in place.
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
await sleep(500);
await page.screenshot({ path: `${OUT}/admin-guild-bank-panel-mobile.png`, fullPage: true });
console.log(`${OUT}/admin-guild-bank-panel-mobile.png`);
await page.setViewport({ width: 1440, height: 900 });
await sleep(300);

// The confirmation, filled in as an operator would leave it just before
// committing: reason typed, acknowledgement ticked, submit enabled.
const buttons = await page.$$('button');
let clicked = false;
for (const b of buttons) {
  const label = await b.evaluate((el) => el.textContent?.trim());
  if (label === 'Remove item') {
    await b.click();
    clicked = true;
    break;
  }
}
if (!clicked) throw new Error('remove-item button not found');
await page.waitForSelector('#guild-bank-purge-title', { visible: true, timeout: 20000 });
await page.type(
  '[role="dialog"] textarea',
  'Ticket 4471: soulbound reins stuck since 0.31, guild cannot disband.',
);
await page.click('[role="dialog"] input[type="checkbox"]');
await sleep(400);
await page.screenshot({ path: `${OUT}/admin-guild-bank-purge-confirm.png` });
console.log(`${OUT}/admin-guild-bank-purge-confirm.png`);

await browser.close();
process.exit(0);
