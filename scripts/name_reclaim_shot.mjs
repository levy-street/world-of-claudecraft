// Visual + behavioral capture for the "reclaim a deactivated account's character
// name" fix.
//
// Boots the real game server against the local eastbrook Postgres and drives the
// real REST API through the exact scenario from the bug report:
//   1. Account A creates character <NAME>.
//   2. Account B tries <NAME> while A is live          -> 409 "that name is taken"  (live names stay protected)
//   3. Account A deactivates (its account becomes "invalid").
//   4. Account B tries <NAME> again                    -> 200 created               (the fix: name reclaimed)
//   5. Account A is reactivated; its old character now carries an archival name
//      and force_rename, so the original owner is prompted to pick a new name.
//
// Then it drives the built client to screenshot (a) account B's character-select
// showing the reclaimed name and (b) account A's character-select showing the
// force-rename prompt on the archived character.
//
// Usage: npm run build && node scripts/name_reclaim_shot.mjs   (run from repo root)
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const PORT = Number(process.env.WOC_SHOT_PORT ?? 8801);
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = 'docs/superpowers/shots';
const CHROME = process.env.CHROME_BIN ?? '/usr/bin/chromium';
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://eastbrook@127.0.0.1:5432/eastbrook';
mkdirSync(OUT, { recursive: true });

const env = { ...process.env, PORT: String(PORT), REALM_NAME: 'Eastbrook', DATABASE_URL };
const log = (...a) => console.log('[shot]', ...a);

// detached so we can SIGKILL the whole process group (npm + its node child);
// killing npm alone would orphan the node server and leak the port.
const server = spawn('npm', ['run', 'server'], { env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
server.stdout.on('data', (d) => process.stdout.write(`[server] ${d}`));
server.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));

async function waitForServer() {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${BASE}/api/realms`)).ok) return; } catch { /* not up yet */ }
    await sleep(500);
  }
  throw new Error('server did not become ready');
}

const api = async (path, opts = {}) => {
  const res = await fetch(BASE + path, {
    method: opts.method ?? 'GET',
    headers: { 'Content-Type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
};

const register = async (username, password) => {
  const r = await api('/api/register', { method: 'POST', body: { username, password } });
  if (!r.data.token) throw new Error(`register ${username} failed: ${JSON.stringify(r)}`);
  return r.data.token;
};

let browser;
try {
  await waitForServer();
  log('server ready');

  const stamp = Date.now();
  const password = 'test1234';
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  let suffix = '';
  for (let i = 0; i < 3; i++) suffix += letters[Math.floor(Math.random() * letters.length)];
  const NAME = 'Sturdystubs' + suffix; // <= 16 chars, letters only (normalizeCharName)

  const userA = 'oldacct' + stamp;
  const userB = 'newacct' + stamp;

  // 1. Account A (the "old account") creates the character.
  const tokenA = await register(userA, password);
  const aCreate = await api('/api/characters', { method: 'POST', token: tokenA, body: { name: NAME, class: 'warrior', skin: 0 } });
  if (aCreate.status !== 200) throw new Error('A create failed: ' + JSON.stringify(aCreate));
  log(`A created "${NAME}" (id ${aCreate.data.id})`);

  // 2. Account B cannot take the name while A is live.
  const tokenB = await register(userB, password);
  const bBlocked = await api('/api/characters', { method: 'POST', token: tokenB, body: { name: NAME, class: 'mage', skin: 0 } });
  log(`B create while A live  -> ${bBlocked.status} ${JSON.stringify(bBlocked.data)}`);
  if (bBlocked.status !== 409) throw new Error('expected 409 while A is live, got ' + bBlocked.status);

  // 3. A deactivates -> the old account becomes "invalid".
  const deact = await api('/api/account/deactivate', { method: 'POST', token: tokenA, body: { username: userA, password } });
  log(`A deactivate           -> ${deact.status} ${JSON.stringify(deact.data)}`);
  if (deact.status !== 200) throw new Error('deactivate failed: ' + JSON.stringify(deact));

  // 4. THE FIX: B can now reclaim the name abandoned by the deactivated account.
  const bReclaim = await api('/api/characters', { method: 'POST', token: tokenB, body: { name: NAME, class: 'mage', skin: 0 } });
  log(`B create after deactiv -> ${bReclaim.status} ${JSON.stringify(bReclaim.data)}`);
  if (bReclaim.status !== 200) throw new Error('expected 200 reclaim, got ' + bReclaim.status);
  log(`RECLAIMED "${bReclaim.data.name}" for the new account (id ${bReclaim.data.id})`);

  // Browser shot 1: account B's character-select shows the reclaimed name.
  browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--window-size=1600,1000'],
    defaultViewport: { width: 1600, height: 1000, deviceScaleFactor: 2 },
  });
  const gotoCharSelect = async (username) => {
    // Fresh incognito context per account so a prior login's stored token does
    // not auto-skip the landing page.
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle2' });
    await page.waitForSelector('#nav-btn-login', { visible: true });
    await page.click('#nav-btn-login');
    await page.waitForSelector('#login-user', { visible: true });
    await page.type('#login-user', username);
    await page.type('#login-pass', password);
    await page.click('#btn-login');
    await page.waitForSelector('#realm-list .realm-row', { visible: true });
    await sleep(800);
    await page.click('#realm-list .realm-row');
    await page.waitForSelector('#char-list .char-row', { visible: true, timeout: 15000 });
    await sleep(800);
    return page;
  };

  const pageB = await gotoCharSelect(userB);
  await pageB.screenshot({ path: `${OUT}/name-reclaim-newaccount.png` });
  log('captured new-account char-select (reclaimed name)');
  await pageB.close();

  // 5. Reactivate A (admin-only in prod; done directly here) and show the old
  //    character now carries an archival name + force_rename prompt.
  const react = spawnSync('psql', [DATABASE_URL, '-v', `un=${userA}`, '-c', `UPDATE accounts SET deactivated_at = NULL WHERE username = :'un';`], { encoding: 'utf8' });
  log('reactivate A via DB:', react.stdout.trim() || react.stderr.trim());
  const aChars = await api('/api/characters', { token: tokenA });
  log('A characters after reactivation:', JSON.stringify(aChars.data.characters));

  const pageA = await gotoCharSelect(userA);
  await pageA.screenshot({ path: `${OUT}/name-reclaim-oldaccount-forcerename.png` });
  const renameRow = await pageA.$('#char-list .char-row.rename-required');
  if (renameRow) await renameRow.screenshot({ path: `${OUT}/name-reclaim-forcerename-row.png` });
  log('captured old-account char-select (force-rename prompt):', renameRow ? 'rename-required row present' : 'NO rename row');
  await pageA.close();

  log('done — screenshots in', OUT);
} finally {
  try { await browser?.close(); } catch {}
  try { process.kill(-server.pid, 'SIGKILL'); } catch { server.kill('SIGKILL'); }
}
