// One-off local capture tool for the admin Cheater mark panel (part D of the
// operator-applied Cheater mark): shoots the account modal's CheaterMarkControls
// in its three states (unmarked apply form, filled confirm prompt, live mark
// with the lift arm), against a REAL server serving the REAL
// POST /admin/api/moderation/accounts/:id/cheater-mark route.
//
// Everything is real on purpose: a registered account, a real admin grant, the
// real accounts table search, the real modal, and a mark applied through the
// panel itself, so the marked-state frame shows what an operator actually sees
// after the write lands (remaining played-time budget, audited reason, set-at).
//
// Dev-only, not wired into any npm script or CI gate. Needs:
//   - the dev Postgres up (npm run db:up)
//   - a server on SERVER_URL (e.g. PORT=8791 npm run server)
//   - a vite dev client on GAME_URL proxying to it
//     (e.g. WOC_DEV_API_TARGET=http://127.0.0.1:8791 npx vite --port 5195)
//
// Usage:
//   GAME_URL=http://localhost:5195 SERVER_URL=http://127.0.0.1:8791 \
//     SHOTS_DIR=docs/screenshots/admin-cheater-mark \
//     node scripts/admin_cheater_mark_shot.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { assertLoopbackDatabaseUrl, assertLoopbackUrl } from './lib/loopback_guard.mjs';

const GAME_URL = process.env.GAME_URL ?? 'http://localhost:5195';
const SERVER_URL = process.env.SERVER_URL ?? 'http://127.0.0.1:8791';
// Defaults to the directory the committed captures actually live in, so a bare
// re-run overwrites them in place instead of minting a second screenshot dir.
const OUT = process.env.SHOTS_DIR ?? 'docs/screenshots/admin-cheater-mark';

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

// The account under sanction, with one character so the modal reads like a
// real account rather than an empty shell.
const targetUser = `cmtarget${uniq}`;
const reg = await api('/api/register', {
  username: targetUser,
  password: 'hunter22',
  email: `${targetUser}@example.com`,
});
if (!reg.body.token) throw new Error(`register failed: ${JSON.stringify(reg.body)}`);
const char = await api(
  '/api/characters',
  { name: `Koko${alpha}`.slice(0, 12), class: 'rogue' },
  reg.body.token,
);
if (!char.body.id) throw new Error(`character create failed: ${JSON.stringify(char.body)}`);

// The operator.
const adminUser = `cmop${uniq}`;
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
const panel = '.cheater-mark-controls';

// A viewport change resets the accounts page and closes the modal, so every
// framing (and every viewport) walks the real path again: search the table,
// click the row, wait for the panel.
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
await page.screenshot({ path: `${OUT}/panel-unmarked.png`, fullPage: true });
console.log(`${OUT}/panel-unmarked.png`);

// Mobile of the same state: the controls stack single-column.
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
await openAccountModal();
await page.screenshot({ path: `${OUT}/panel-unmarked-mobile.png`, fullPage: true });
console.log(`${OUT}/panel-unmarked-mobile.png`);
await page.setViewport({ width: 1440, height: 900 });
await openAccountModal();

// The apply flow, left exactly as an operator would just before committing:
// budget typed, reason typed, confirm enabled.
await page.type(`${panel} input[type="number"]`, '6');
await page.evaluate((sel) => {
  const apply = [...document.querySelectorAll(`${sel} button`)].find((b) =>
    b.textContent?.includes('Apply cheater mark'),
  );
  apply?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}, panel);
await page.waitForSelector('.moderation-action-prompt', { visible: true, timeout: 20000 });
await page.type(
  '.moderation-action-prompt input[maxlength="500"]',
  'Win-traded the 1v1 arena on 2026-08-10 (guild chat confession).',
);
await sleep(400);
await page.screenshot({ path: `${OUT}/apply-confirm.png`, fullPage: true });
console.log(`${OUT}/apply-confirm.png`);

// Commit the mark through the real route, then shoot the live-mark state.
await page.click('.moderation-action-prompt button[data-confirm-moderation]');
await page.waitForFunction(
  (sel) =>
    [...document.querySelectorAll(`${sel} button`)].some((b) =>
      b.textContent?.includes('Lift cheater mark'),
    ),
  { timeout: 30000 },
  panel,
);
await page.evaluate(
  (sel) => document.querySelector(sel)?.scrollIntoView({ block: 'center' }),
  panel,
);
await sleep(400);
await page.screenshot({ path: `${OUT}/panel-marked.png`, fullPage: true });
console.log(`${OUT}/panel-marked.png`);

await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
await openAccountModal();
await page.screenshot({ path: `${OUT}/panel-marked-mobile.png`, fullPage: true });
console.log(`${OUT}/panel-marked-mobile.png`);

await browser.close();
console.log(`done: account ${targetUser} marked by ${adminUser}`);
process.exit(0);
