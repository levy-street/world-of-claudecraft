// Visual capture for the "Take Over" character-select fix.
//
// Boots the real game server against the local eastbrook Postgres, registers an
// account + character over REST, occupies that character's WebSocket session so
// the server reports it `online: true`, then drives the real built client to the
// character-select screen and screenshots the new hint + "Take Over" button.
//
// Usage: node scripts/takeover_shot.mjs   (run from repo root; requires `npm run build` first)
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdirSync } from 'node:fs';
import WebSocket from 'ws';
import puppeteer from 'puppeteer-core';

const PORT = Number(process.env.WOC_SHOT_PORT ?? 8799);
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = 'docs/superpowers/shots';
const CHROME = process.env.CHROME_BIN ?? '/usr/bin/chromium';
mkdirSync(OUT, { recursive: true });

const env = {
  ...process.env,
  PORT: String(PORT),
  REALM_NAME: 'Eastbrook',
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://eastbrook@127.0.0.1:5432/eastbrook',
};

const log = (...a) => console.log('[shot]', ...a);
const server = spawn('npm', ['run', 'server'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
server.stdout.on('data', (d) => process.stdout.write(`[server] ${d}`));
server.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));

async function waitForServer() {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`${BASE}/api/realms`);
      if (r.ok) return;
    } catch { /* not up yet */ }
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

let browser, ws;
try {
  await waitForServer();
  log('server ready');

  const stamp = Date.now();
  const username = 'takeover' + stamp;
  const password = 'test1234';
  const reg = await api('/api/register', { method: 'POST', body: { username, password } });
  const token = reg.data.token;
  if (!token) throw new Error('register failed: ' + JSON.stringify(reg));
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  let name = 'Hero';
  for (let i = 0; i < 8; i++) name += letters[Math.floor(Math.random() * letters.length)];
  const created = await api('/api/characters', { method: 'POST', token, body: { name, class: 'paladin', skin: 0 } });
  if (created.status !== 200) throw new Error('create char failed: ' + JSON.stringify(created));
  const characterId = created.data.id;
  log('character created', characterId);

  // Occupy the session so the server reports the character as online.
  ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}/ws`);
  await new Promise((resolve, reject) => {
    ws.on('open', () => { ws.send(JSON.stringify({ t: 'auth', token, character: characterId })); resolve(); });
    ws.on('error', reject);
  });
  // Give the server a moment to register the session, then confirm via REST.
  await sleep(1500);
  const chars = await api('/api/characters', { token });
  log('online flag:', chars.data.characters?.[0]?.online);

  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--window-size=1600,1000'],
    defaultViewport: { width: 1600, height: 1000, deviceScaleFactor: 2 },
  });
  const page = await browser.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle2' });

  // Landing -> login -> realm -> charselect.
  await page.waitForSelector('#nav-btn-login', { visible: true });
  await page.click('#nav-btn-login');
  await page.waitForSelector('#login-user', { visible: true });
  await page.type('#login-user', username);
  await page.type('#login-pass', password);
  await page.click('#btn-login');

  await page.waitForSelector('#realm-list .realm-row', { visible: true });
  await sleep(800);
  await page.click('#realm-list .realm-row');

  await page.waitForSelector('#char-list .char-row.online', { visible: true, timeout: 15000 });
  await sleep(800);
  await page.screenshot({ path: `${OUT}/takeover-charselect.png` });
  log('captured charselect');

  // Cropped close-up of the online row (hint + Take Over button).
  const row = await page.$('#char-list .char-row.online');
  if (row) await row.screenshot({ path: `${OUT}/takeover-row.png` });

  // Hover the Take Over button to surface its explanatory title/aria text.
  const btn = await page.$('.take-over-btn');
  if (btn) {
    await btn.hover();
    await sleep(400);
    await page.screenshot({ path: `${OUT}/takeover-hover.png` });
  }
  log('done');
} finally {
  try { ws?.close(); } catch {}
  try { await browser?.close(); } catch {}
  server.kill('SIGKILL');
}
