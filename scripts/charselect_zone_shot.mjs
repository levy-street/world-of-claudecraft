// One-off local capture tool for the character-select zone line: registers an
// account, creates a small roster, parks each character's saved position in a
// different zone straight in the dev database (one inside a delve, so the
// door-zone rule shows), then shoots the roster panel on desktop and on a
// landscape phone viewport. Run the same script against a base-branch server
// and client for the BEFORE frames.
//
// Dev-only, not wired into any npm script or CI gate. Needs:
//   - the dev Postgres up (npm run db:up)
//   - a server on SERVER_URL (e.g. PORT=8791 npm run server)
//   - a vite dev client on GAME_URL proxying to it
//     (e.g. WOC_DEV_API_TARGET=http://127.0.0.1:8791 npx vite --port 5195)
//
// Usage:
//   GAME_URL=http://localhost:5195 SERVER_URL=http://127.0.0.1:8791 \
//     SHOTS_DIR=docs/screenshots/charselect-zone PREFIX=after \
//     node scripts/charselect_zone_shot.mjs
import fs from 'node:fs';
import pg from 'pg';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { assertLoopbackDatabaseUrl, assertLoopbackUrl } from './lib/loopback_guard.mjs';

const GAME_URL = process.env.GAME_URL ?? 'http://localhost:5195';
const SERVER_URL = process.env.SERVER_URL ?? 'http://127.0.0.1:8791';
const OUT = process.env.SHOTS_DIR ?? 'docs/screenshots/charselect-zone';
const PREFIX = process.env.PREFIX ?? 'after';

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
const uniq = Date.now().toString(36).slice(-5);
const alpha = uniq.replace(/[0-9]/g, (d) => 'abcdefghij'[Number(d)]);
const username = `zoneshot${uniq}`;
const password = 'hunter22';
const reg = await api('/api/register', { username, password, email: `${username}@example.com` });
if (!reg.body.token) throw new Error(`register failed: ${JSON.stringify(reg.body)}`);

// Name, class, level, and the saved position that places each one:
//   Eastbrook Vale (0, 0); Thornpeak Heights (0, 700); inside the Drowned Litany
//   delve (104823, 0), which the door rule reports as Mirefen Marsh; and one
//   never-saved character with no position (no zone line).
const roster = [
  ['Aldric', 'warrior', 12, { x: 0, z: 0 }],
  ['Brisa', 'mage', 24, { x: 0, z: 700 }],
  ['Corvin', 'rogue', 31, { x: 104823, z: 0 }],
  ['Dessa', 'priest', 1, null],
];
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
// The characters table is trigger-guarded: a writer announces itself through
// this session setting (server/material_source_writer.ts) or the UPDATE raises.
await db.query("SELECT set_config('woc.material_source_writer', '1', false)");
for (const [name, cls, level, pos] of roster) {
  const ch = await api(
    '/api/characters',
    { name: `${name}${alpha}`.slice(0, 12), class: cls },
    reg.body.token,
  );
  if (!ch.body.id) throw new Error(`character create failed: ${JSON.stringify(ch.body)}`);
  await db.query(
    `UPDATE characters SET level = $2,
       state = CASE WHEN $3::jsonb IS NULL THEN state
                    ELSE COALESCE(state, '{}'::jsonb) || jsonb_build_object('pos', $3::jsonb) END
     WHERE id = $1`,
    [ch.body.id, level, pos ? JSON.stringify(pos) : null],
  );
}
await db.end();

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1600,1000', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
// Standing capture rule: the lowest graphics preset, seeded before boot.
await page.evaluateOnNewDocument(
  `localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: 1 }));`,
);

const visible = (sel) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && el.getClientRects().length > 0;
  }, sel);

async function loginToRoster() {
  await page.goto(GAME_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#btn-online', { timeout: 60000 });
  // The online/offline triggers are hidden compat hooks: click them from the page.
  await page.evaluate("document.querySelector('#btn-online').click()");
  // A remembered session skips the login form and lands on the realm list or
  // straight on the roster, so wait for whichever step shows first.
  await page.waitForFunction(
    () =>
      ['#login-user', '#realm-panel .realm-row', '#char-list .char-row'].some((s) => {
        const el = document.querySelector(s);
        return el && getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0;
      }),
    { timeout: 30000 },
  );
  if (await visible('#login-user')) {
    await page.type('#login-user', username);
    await page.type('#login-pass', password);
    await page.evaluate("document.querySelector('#btn-login').click()");
  }
  if (!(await visible('#char-list .char-row'))) {
    await page.waitForSelector('#realm-panel .realm-row', { visible: true, timeout: 30000 });
    await page.evaluate("document.querySelector('#realm-panel .realm-row').click()");
  }
  await page.waitForFunction(
    (n) => document.querySelectorAll('#char-list .char-row').length >= n,
    { timeout: 30000 },
    roster.length,
  );
  if (!(await visible('#charselect-panel'))) throw new Error('charselect panel not visible');
  // Let the portrait chips and the turntable stage settle.
  await sleep(2500);
}

async function shoot(file) {
  const box = await page.evaluate(() => {
    const r = document.querySelector('#charselect-panel').getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height, vw: innerWidth, vh: innerHeight };
  });
  // Clamp to the viewport: the fixed panel scrolls on a phone, and a clip past
  // the viewport edge shoots unpainted black.
  const x = Math.max(0, Math.floor(box.x) - 8);
  const y = Math.max(0, Math.floor(box.y) - 8);
  const clip = {
    x,
    y,
    width: Math.min(Math.ceil(box.width) + 16, box.vw - x),
    height: Math.min(Math.ceil(box.height) + 16, box.vh - y),
  };
  await page.screenshot({ path: `${OUT}/${file}`, clip });
  console.log(`${OUT}/${file}`);
}

await page.setViewport({ width: 1440, height: 900 });
await loginToRoster();
await shoot(`${PREFIX}-desktop.png`);

// Mobile is landscape-only in-game on the web client.
await page.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true });
await loginToRoster();
await shoot(`${PREFIX}-mobile.png`);

await browser.close();
