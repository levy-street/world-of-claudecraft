// One-off local capture tool for the admin Chat moderation panel, used as the
// PR screenshot for fix/chat-mute-resume-race: an admin's chat mute against a
// REAL server serving the REAL POST /admin/api/moderation/accounts/:id/chat-mute
// route, showing the "muted until" state a resuming session must never lose
// (server/chat_mod_live.ts).
//
// Dev-only, not wired into any npm script or CI gate. Needs:
//   - the dev Postgres up (npm run db:up)
//   - a server on SERVER_URL (e.g. PORT=8790 npm run server)
//   - a vite dev client on GAME_URL proxying to it
//     (e.g. WOC_DEV_API_TARGET=http://127.0.0.1:8790 npx vite --port 5173)
//
// Usage:
//   GAME_URL=http://localhost:5173 SERVER_URL=http://127.0.0.1:8790 \
//     SHOTS_DIR=docs/screenshots/chat-mute-resume-race \
//     node scripts/chat_mute_resume_shot.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { assertLoopbackDatabaseUrl, assertLoopbackUrl } from './lib/loopback_guard.mjs';

const GAME_URL = process.env.GAME_URL ?? 'http://localhost:5173';
const SERVER_URL = process.env.SERVER_URL ?? 'http://127.0.0.1:8790';
const OUT = process.env.SHOTS_DIR ?? 'docs/screenshots/chat-mute-resume-race';

// This script registers accounts and grants a STAFF role, so every target it
// touches must be loopback (the mob_stall_repro.mjs policy).
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

// The account under sanction, with one character so the modal reads like a
// real account rather than an empty shell.
const targetUser = `mutetarget${uniq}`;
const reg = await api('/api/register', {
  username: targetUser,
  password: 'hunter22',
  email: `${targetUser}@example.com`,
});
if (!reg.body.token) throw new Error(`register failed: ${JSON.stringify(reg.body)}`);
const char = await api(
  '/api/characters',
  { name: `Rowdy${alpha}`.slice(0, 12), class: 'warrior' },
  reg.body.token,
);
if (!char.body.id) throw new Error(`character create failed: ${JSON.stringify(char.body)}`);

// The operator.
const adminUser = `muteop${uniq}`;
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
const panel = '.chat-mod-controls';

async function openAccountModal() {
  await page.goto(`${GAME_URL}/admin.html?page=accounts`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#account-search', { timeout: 30000 });
  await page.type('#account-search', targetUser);
  await page.waitForFunction(
    (user) =>
      [...document.querySelectorAll('tr.clickable td')].some((td) =>
        td.textContent?.includes(user),
      ),
    { timeout: 30000 },
    targetUser,
  );
  await page.evaluate((user) => {
    const row = [...document.querySelectorAll('tr.clickable')].find((tr) =>
      tr.textContent?.includes(user),
    );
    row?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }, targetUser);
  await page.waitForSelector(panel, { visible: true, timeout: 30000 });
  await page.evaluate(
    (sel) => document.querySelector(sel)?.scrollIntoView({ block: 'center' }),
    panel,
  );
  await sleep(400);
}

await openAccountModal();
await page.screenshot({ path: `${OUT}/panel-unmuted.png`, fullPage: true });
console.log(`${OUT}/panel-unmuted.png`);

// The mute flow, left exactly as an operator would just before committing.
await page.evaluate((sel) => {
  const btn = [...document.querySelectorAll(`${sel} button`)].find((b) =>
    b.textContent?.includes('Mute Chat 1h'),
  );
  btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}, panel);
await page.waitForSelector('.moderation-action-prompt', { visible: true, timeout: 20000 });
await page.type(
  '.moderation-action-prompt input[maxlength="500"]',
  'Repeated slurs in General after two warnings.',
);
await sleep(400);
await page.screenshot({ path: `${OUT}/mute-confirm.png`, fullPage: true });
console.log(`${OUT}/mute-confirm.png`);

// Commit the mute through the real route, then shoot the live-mute state:
// the "muted until" badge a resuming session must never silently lose.
await page.click('.moderation-action-prompt button[data-confirm-moderation]');
await page.waitForFunction(
  (sel) =>
    [...document.querySelectorAll(`${sel} .status-badge, ${sel} [class*="badge"]`)].some((b) =>
      b.textContent?.includes('muted until'),
    ),
  { timeout: 30000 },
  panel,
);
await page.evaluate(
  (sel) => document.querySelector(sel)?.scrollIntoView({ block: 'center' }),
  panel,
);
await sleep(400);
await page.screenshot({ path: `${OUT}/panel-muted.png`, fullPage: true });
console.log(`${OUT}/panel-muted.png`);

await browser.close();
console.log(`done: account ${targetUser} muted by ${adminUser}`);
process.exit(0);
