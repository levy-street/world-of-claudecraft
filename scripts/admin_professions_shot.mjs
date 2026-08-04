// One-off local capture tool for the R35 GM professions tooling (phase 15 of
// the professions tuning packet): shoots the admin Characters page and the
// professions inspector modal against a REAL server, after exercising the two
// audited restores through the real admin API (so the modal shows a live
// character with a re-minted slot, not a fixture).
//
// Dev-only, not wired into any npm script or CI gate. Needs:
//   - the dev Postgres up (npm run db:up)
//   - a server started with ALLOW_DEV_COMMANDS=1 (the /dev gather cheat seeds
//     visible proficiency)
//   - a vite dev client for the SPA under capture (WOC_DEV_API_TARGET pointed
//     at that server)
//
// Usage (after, this branch):
//   GAME_URL=http://localhost:5195 SERVER_URL=http://127.0.0.1:8791 \
//     SHOTS_DIR=docs/screenshots/r35-admin-professions-inspector \
//     node scripts/admin_professions_shot.mjs
// Usage (before, a scratch worktree at the pre-change tip on its own vite):
//   MODE=before GAME_URL=http://localhost:5196 SERVER_URL=http://127.0.0.1:8791 \
//     SHOTS_DIR=docs/screenshots/r35-admin-professions-inspector \
//     node scripts/admin_professions_shot.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import WebSocket from 'ws';
import { BROWSER_PATH } from './browser_path.mjs';
import { assertLoopbackDatabaseUrl, assertLoopbackUrl } from './lib/loopback_guard.mjs';
import { worldAuthMessage } from './lib/world_auth.mjs';

const MODE = process.env.MODE === 'before' ? 'before' : 'after';
const GAME_URL = process.env.GAME_URL ?? 'http://localhost:5195';
const SERVER_URL = process.env.SERVER_URL ?? 'http://127.0.0.1:8791';
// This script registers accounts and grants a STAFF role; every target it
// touches must be loopback (the mob_stall_repro.mjs policy): the HTTP server,
// the origin that receives the minted admin bearer via localStorage, AND the
// database grant_admin.mjs will connect to (the arm that actually mints
// superadmin runs on DATABASE_URL, which is independent of SERVER_URL). The
// checks live in scripts/lib/loopback_guard.mjs (shared with
// mob_stall_repro.mjs and load_professions.mjs, pinned by
// tests/loopback_guard.test.ts); the DATABASE arm validates the host
// node-postgres will ACTUALLY use (?host= override aware) and never echoes
// the credential-bearing value.
assertLoopbackUrl(SERVER_URL, 'SERVER_URL');
assertLoopbackUrl(GAME_URL, 'GAME_URL');
// Mirror grant_admin.mjs's own resolution (.env fills only unset vars).
try {
  process.loadEnvFile?.();
} catch {
  // .env is optional; the guard below still sees a directly-passed value.
}
assertLoopbackDatabaseUrl(process.env.DATABASE_URL);
const WS_BASE = SERVER_URL.replace(/^http/, 'ws');
const OUT = process.env.SHOTS_DIR ?? 'docs/screenshots/r35-admin-professions-inspector';
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uniq = Date.now().toString(36).slice(-6);
const alpha = uniq.replace(/[0-9]/g, (d) => 'abcdefghij'[Number(d)]);

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

// 1. A live character with visible professions state: register, create,
// join the world over the raw wire, seed proficiency via the dev cheat, and
// STAY CONNECTED so the inspector reads the live serializeCharacter snapshot.
const playerUser = `gmcap${uniq}`;
const charName = `Aldwin${alpha}`.slice(0, 12);
const reg = await api('/api/register', {
  username: playerUser,
  password: 'hunter22',
  email: `${playerUser}@example.com`,
});
if (!reg.body.token) throw new Error(`register failed: ${JSON.stringify(reg.body)}`);
const char = await api('/api/characters', { name: charName, class: 'warrior' }, reg.body.token);
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
const cmd = (p) => ws.send(JSON.stringify({ t: 'cmd', ...p }));
cmd({ cmd: 'chat', text: '/dev gather mining 87' });
cmd({ cmd: 'chat', text: '/dev gather fishing 42' });
await sleep(1500); // let the queued grants apply over a few ticks

// 2. An operator: register, grant superadmin (grant_admin.mjs reads .env for
// the dev DATABASE_URL), and log in for the admin bearer.
const adminUser = `gmop${uniq}`;
await api('/api/register', {
  username: adminUser,
  password: 'hunter22-op',
  email: `${adminUser}@example.com`,
});
execFileSync('node', ['scripts/grant_admin.mjs', adminUser], { stdio: 'inherit' });
const login = await api('/admin/api/login', { username: adminUser, password: 'hunter22-op' });
const adminToken = login.body?.data?.token;
if (!adminToken) throw new Error(`admin login failed: ${JSON.stringify(login.body)}`);

// 3. AFTER only: exercise the real restore endpoints so the modal shows the
// re-minted slot (item first: the slot mint sizes charges by the owned tool).
if (MODE === 'after') {
  const adminApi = (path, body) =>
    fetch(SERVER_URL + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify(body),
    }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
  const item = await adminApi(`/admin/api/moderation/characters/${char.body.id}/restore-item`, {
    itemId: 'copper_mining_pick',
    count: 1,
    reason: 'R35 capture: restore the lost pick',
  });
  if (item.status !== 200) throw new Error(`restore-item failed: ${JSON.stringify(item.body)}`);
  const slot = await adminApi(`/admin/api/moderation/characters/${char.body.id}/restore-slot`, {
    professionId: 'mining',
    effectId: 'gatherers_cache',
    reason: 'R35 capture: re-mint the lost slot row',
  });
  if (slot.status !== 200) throw new Error(`restore-slot failed: ${JSON.stringify(slot.body)}`);
  console.log('restores landed:', item.status, slot.status);
}

// 4. Shoot the dashboard.
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
await page.goto(`${GAME_URL}/admin.html?page=characters`, { waitUntil: 'networkidle2' });
await page.waitForSelector('#character-search', { visible: true, timeout: 30000 });
await page.type('#character-search', charName);
await page.waitForFunction(
  (name) => [...document.querySelectorAll('td')].some((td) => td.textContent === name),
  { timeout: 20000 },
  charName,
);
await sleep(400);
await page.screenshot({ path: `${OUT}/${MODE}-characters.png` });
console.log(`${OUT}/${MODE}-characters.png`);

if (MODE === 'after') {
  const buttons = await page.$$('button');
  let clicked = false;
  for (const b of buttons) {
    const label = await b.evaluate((el) => el.textContent?.trim());
    if (label === 'Inspect') {
      await b.click();
      clicked = true;
      break;
    }
  }
  if (!clicked) throw new Error('professions button not found');
  await page.waitForSelector('#prof-inspect-title', { visible: true, timeout: 20000 });
  await page.waitForFunction(
    () => [...document.querySelectorAll('td')].some((td) => td.textContent === 'gatherers_cache'),
    { timeout: 20000 },
  );
  await sleep(400);
  await page.screenshot({ path: `${OUT}/after-professions-modal.png` });
  console.log(`${OUT}/after-professions-modal.png`);
}

await browser.close();
ws.close();
process.exit(0);
