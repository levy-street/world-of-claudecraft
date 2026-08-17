// Capture of the public character sheet at /c/:name, the ONE surface in the
// Reliquary work that the change-aware offline rig cannot reach.
//
// pr_screenshots.mjs drives the Vite dev client with no server behind it, and
// /c/ is server-rendered straight out of a Postgres row (handleProfilePage ->
// characterSheet -> profileHtml), so there is no window.__game to drive and no
// target-table entry that could bring it up. Hence a script: it boots the real
// server against the local eastbrook Postgres, registers an account plus a
// character over the real REST routes, writes the character's persisted state
// blob (the input the page reads), and screenshots the rendered page.
//
// The state blob is the fixture, deliberately: the recent-finds ring is written
// in play by relic first-finds, and reproducing a hundred catalogued finds
// through live gameplay would test the loot tables, not the page. Everything
// downstream of the row is the real thing, restore guards included.
//
// Runs under tsx, not bare node: the relic id list comes from the TypeScript
// content table rather than a hand-copied literal.
//
// Usage (from the repo root, with Postgres up):
//   DATABASE_URL=postgres://... BROWSER_PATH=/path/to/chrome \
//     SHOT_OUT=pr-shots SHOT_NAME=after-profile-strip \
//     npx tsx scripts/profile_recent_finds_shot.mjs
// Env:
//   DATABASE_URL   required; the same database `npm run server` would use
//   PORT           server port for this run (default 8797)
//   SHOT_OUT       output directory (default pr-shots)
//   SHOT_NAME      output basename without .png (default profile-strip)
//   PROFILE_CHAR   character name to create/reuse (default Relicwarden).
//                  Reusing one name across a before/after pair is what makes
//                  the two shots the same character rather than two rolls.
//   BROWSER_PATH   Chrome/Edge/Chromium binary (see browser_path.mjs)
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import pg from 'pg';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { assertLoopbackDatabaseUrl, assertLoopbackUrl } from './lib/loopback_guard.mjs';

const PORT = Number(process.env.PORT ?? 8797);
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = process.env.SHOT_OUT ?? 'pr-shots';
const NAME = process.env.SHOT_NAME ?? 'profile-strip';
const CHAR = process.env.PROFILE_CHAR ?? 'Relicwarden';
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('DATABASE_URL is required');
// This rig registers accounts and rewrites a character's state blob: both
// targets must be local. The URL arm covers the server this script spawns
// (a hostile PORT/env cannot point it elsewhere), the DATABASE arm the pg
// connection the seeding UPDATE runs on.
assertLoopbackUrl(BASE, 'BASE (from PORT)');
assertLoopbackDatabaseUrl(DATABASE_URL);
mkdirSync(OUT, { recursive: true });

const log = (...a) => console.log('[profile-shot]', ...a);

// The persisted Reliquary ring, OLDEST-first (restoreReliquaryRecent walks it
// from the tail, so the strip prints these in reverse). One authored mark among
// the items on purpose: mark ids resolve their English through the server's own
// RELIQUARY_MARK_ENGLISH table while item ids resolve through ITEMS, and a strip
// of items alone would exercise only one of the two.
const RECENT_RING = [
  'cryptbone_helm',
  'masterwork:first',
  'morthens_cryptforged_hauberk',
  'gather_event:moonlit_bloom',
];
const MARKS = ['masterwork:first', 'gather_event:moonlit_bloom'];

const api = async (path, opts = {}) => {
  const res = await fetch(BASE + path, {
    method: opts.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
};

async function waitForServer() {
  for (let i = 0; i < 180; i++) {
    try {
      const r = await fetch(`${BASE}/api/realms`);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  throw new Error('server did not become ready');
}

// Every catalogued relic ITEM id, read out of the live page table so a content
// edit cannot leave the seeded character short of the rank it is meant to show.
async function cataloguedItemIds() {
  const { RELIQUARY_PAGES } = await import('../src/sim/content/reliquary.ts');
  const ids = new Set();
  for (const page of RELIQUARY_PAGES) {
    for (const relic of page.relics) if (relic.kind === 'item') ids.add(relic.itemId);
  }
  return [...ids];
}

// Refuse to run against a port something else already holds. This is the trap
// that cost a whole before/after round: `npm run server` boots the real server
// as a GRANDCHILD (npm -> node dist-server/server.cjs), so killing the npm
// wrapper leaves the server listening, and the next run's readiness probe
// happily passes against that stale bundle. A before/after pair captured that
// way looks perfectly plausible and is simply wrong. Two answers, both here:
// build and spawn the server binary DIRECTLY so the pid we kill is the server,
// and fail loudly if the port is busy before we start.
async function assertPortFree(port) {
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', (err) =>
      reject(
        new Error(
          `port ${port} is already in use (${err.code}). Something else is serving it: ` +
            'stop that process, or pass a free PORT. Never shoot against a server this ' +
            'script did not build, it may be a stale bundle.',
        ),
      ),
    );
    probe.once('listening', () => probe.close(() => resolve()));
    probe.listen(port, '127.0.0.1');
  });
}
await assertPortFree(PORT);

// Bundle first and separately, so the spawn below is the server process itself
// and every run is guaranteed to serve the sources currently on disk (a
// before/after pair swaps them between runs).
log('bundling server');
const built = spawnSync('npm', ['run', 'build:server'], { stdio: 'inherit' });
if (built.status !== 0) throw new Error('build:server failed');

const server = spawn(process.execPath, ['dist-server/server.cjs'], {
  env: { ...process.env, PORT: String(PORT), DATABASE_URL },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', (d) => process.stdout.write(`[server] ${d}`));
server.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));

let browser;
const client = new pg.Client({ connectionString: DATABASE_URL });
try {
  await waitForServer();
  log('server ready on', PORT);

  // Create the character if this is the first run of the pair; a second run
  // finds the name taken and simply reuses the row it left behind.
  const stamp = Date.now();
  const username = `relicshot${stamp}`;
  const reg = await api('/api/register', {
    method: 'POST',
    body: { username, password: 'test1234', email: `${username}@example.com` },
  });
  const token = reg.data.token;
  if (!token) throw new Error(`register failed: ${JSON.stringify(reg)}`);
  const created = await api('/api/characters', {
    method: 'POST',
    token,
    body: { name: CHAR, class: 'paladin', skin: 0 },
  });
  log('character create:', created.status, created.status === 200 ? 'new' : 'reusing existing');

  await client.connect();
  const found = await client.query('SELECT id FROM characters WHERE name = $1', [CHAR]);
  if (found.rowCount === 0) throw new Error(`no character row for ${CHAR}`);
  const characterId = found.rows[0].id;

  const state = {
    level: 60,
    skin: 0,
    pos: { x: 0, y: 0, z: 0 },
    renown: 640,
    deedStats: { itemsDiscovered: await cataloguedItemIds() },
    deeds: { col_reliquary_rank_5: '2026-08-01' },
    reliquary: { marks: MARKS, recent: RECENT_RING },
  };
  await client.query('UPDATE characters SET state = $1, level = $2 WHERE id = $3', [
    JSON.stringify(state),
    60,
    characterId,
  ]);
  log('seeded state for character', characterId);

  browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: 'new',
    args: ['--window-size=1000,760', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    defaultViewport: { width: 1000, height: 760 },
  });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  const url = `${BASE}/c/${encodeURIComponent(CHAR)}`;
  const res = await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
  if (res?.status() !== 200) throw new Error(`GET /c/ returned ${res?.status()}`);
  await sleep(600);
  const body = await page.evaluate('document.body.innerText');
  log(`page text:\n${body.split('\n').slice(0, 24).join('\n')}`);
  const file = `${OUT}/${NAME}.png`;
  await page.screenshot({ path: file });
  log('shot:', file);
} finally {
  if (browser) await browser.close();
  await client.end().catch(() => {});
  server.kill('SIGTERM');
  await sleep(1000);
  if (!server.killed) server.kill('SIGKILL');
}
