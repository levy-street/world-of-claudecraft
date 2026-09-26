// Spectate action-bar shot: a staff warrior watches a mage with /spectate,
// returns with /unspectate, and the moderator's own action bar is shot before
// and after the round trip. Before the fix the bar comes back scrambled (the
// warrior's abilities pruned as "unknown", the mage's kit seeded in their
// place, and that state uploaded); after it the bar is untouched.
//
// Dev-only, not wired into any npm script or CI gate. Needs:
//   - the dev Postgres up (npm run db:up)
//   - a server on SERVER_URL started with ALLOW_DEV_COMMANDS=1 (PORT=8790)
//   - a vite dev client on GAME_URL proxying to it
//     (WOC_DEV_API_TARGET=http://127.0.0.1:8790 npx vite --port 5183)
//
//   GAME_URL=http://localhost:5183 SERVER_URL=http://127.0.0.1:8790 \
//     SHOTS_DIR=tmp/spectate-action-bar TAG=after \
//     node scripts/spectate_action_bar_shot.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { assertLoopbackDatabaseUrl, assertLoopbackUrl } from './lib/loopback_guard.mjs';

const GAME_URL = process.env.GAME_URL ?? 'http://localhost:5183';
const SERVER_URL = process.env.SERVER_URL ?? 'http://127.0.0.1:8790';
const OUT = process.env.SHOTS_DIR ?? 'tmp/spectate-action-bar';
const TAG = process.env.TAG ?? 'after';
assertLoopbackUrl(SERVER_URL, 'SERVER_URL');
assertLoopbackUrl(GAME_URL, 'GAME_URL');
try {
  process.loadEnvFile?.();
} catch {
  // .env is optional
}
assertLoopbackDatabaseUrl(process.env.DATABASE_URL);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });
const uniq = Date.now().toString(36).slice(-5);
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

async function registerWithChar(user, pass, charName, cls) {
  const reg = await api('/api/register', {
    username: user,
    password: pass,
    email: `${user}@example.com`,
  });
  if (!reg.body.token) throw new Error(`register ${user} failed: ${JSON.stringify(reg.body)}`);
  const char = await api('/api/characters', { name: charName, class: cls }, reg.body.token);
  if (!char.body.id) throw new Error(`char ${charName} failed: ${JSON.stringify(char.body)}`);
}

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  protocolTimeout: 90000,
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});

async function enterWorld(user, pass, charName) {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(
    "localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: 1, graphicsDefaultApplied: true }));",
  );
  await page.goto(GAME_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('#btn-online', { timeout: 30000 });
  await sleep(1000);
  await page.evaluate(() => document.querySelector('#btn-online')?.click());
  await page.waitForSelector('#login-user', { timeout: 45000 });
  await sleep(1500);
  let filled = false;
  for (let attempt = 0; attempt < 6 && !filled; attempt++) {
    filled = await page.evaluate(
      (u, p) => {
        const form = document.querySelector('#login-panel');
        const userEl = document.querySelector('#login-user');
        const passEl = document.querySelector('#login-pass');
        const toggle = document.querySelector('#btn-auth-toggle');
        const submit = document.querySelector('#btn-login');
        if (!form || !userEl || !passEl || !toggle || !submit) return false;
        if (form.dataset.authMode === 'register') toggle.click();
        userEl.value = u;
        passEl.value = p;
        submit.click();
        return true;
      },
      user,
      pass,
    );
    if (!filled) await sleep(400);
  }
  if (!filled) throw new Error('login form never stabilized');
  // A single-realm dev server skips the realm list straight to char select.
  await page.waitForFunction(
    () =>
      document.querySelector('#realm-list .realm-row') ||
      document.querySelector('#char-list .char-row'),
    { timeout: 30000, polling: 200 },
  );
  await page.evaluate(() => document.querySelector('#realm-list .realm-row')?.click());
  await page.waitForSelector('#char-list .char-row', { timeout: 15000 });
  await sleep(700);
  await page.evaluate((name) => {
    const rows = [...document.querySelectorAll('#char-list .char-row')];
    const row =
      rows.find((r) => r.querySelector('.char-name')?.textContent?.trim() === name) ?? rows[0];
    row?.click();
  }, charName);
  await sleep(400);
  await page.evaluate(() => document.getElementById('btn-charselect-enter')?.click());
  try {
    await page.waitForFunction(() => window.__game?.world?.entities?.size >= 1, {
      timeout: 60000,
      polling: 500,
    });
  } catch (err) {
    await page.screenshot({ path: `${OUT}/debug-enter-${user}.png` });
    console.log(
      'enter state:',
      await page.evaluate(() =>
        JSON.stringify({
          game: typeof window.__game,
          ents: window.__game?.world?.entities?.size,
          charsel: document.querySelector('#charselect-panel')?.hasAttribute('hidden'),
          rows: document.querySelectorAll('#char-list .char-row').length,
          btns: document.querySelectorAll('#char-list .enter-world-btn').length,
          loading: document.getElementById('loading-screen')?.className,
        }),
      ),
    );
    throw err;
  }
  await page.evaluate(() => window.__game.online.cmd({ cmd: 'dev_level', level: 20 }));
  await sleep(4000);
  await page.evaluate(() => document.getElementById('tutorial-greeting')?.remove());
  return page;
}

async function barIds(page) {
  return page.evaluate(() =>
    window.__game.hud.actionBarController.actions
      .slice(0, 11)
      .map((a) => a?.id ?? '-')
      .join('|'),
  );
}

// The bottom-centre HUD strip: the player frame plus the three action rows.
const BAR_CLIP = { x: 470, y: 690, width: 700, height: 210 };

async function shotBar(page, file) {
  await page.screenshot({ path: `${OUT}/${file}`, clip: BAR_CLIP });
}

// The watched character: a mage, so the moderator's warrior kit is fully foreign.
const targetUser = `spectgt${uniq}`;
const targetChar = `Watched${alpha}`.slice(0, 12);
await registerWithChar(targetUser, 'hunter22', targetChar, 'mage');
// The moderator: a warrior with the staff role that unlocks /spectate.
const modUser = `spectmod${uniq}`;
const modChar = `Warden${alpha}`.slice(0, 12);
await registerWithChar(modUser, 'hunter22-op', modChar, 'warrior');
execFileSync('node', ['scripts/grant_admin.mjs', modUser], { stdio: 'inherit' });

const targetPage = await enterWorld(targetUser, 'hunter22', targetChar);
const modPage = await enterWorld(modUser, 'hunter22-op', modChar);
await sleep(2000);
// A customized arrangement (the seeded bar reversed): the scramble is invisible
// on a default-ordered bar because the re-place after /unspectate recreates the
// same learned order by coincidence.
await modPage.evaluate(() => {
  const c = window.__game.hud.actionBarController;
  const a = c.actions.slice();
  c.replaceActions([...a.slice(0, 11).reverse(), ...a.slice(11)]);
  c.saveActions();
});
await sleep(1500);
console.log('moderator bar (own):', await barIds(modPage));
await shotBar(modPage, `${TAG}-1-own-bar.png`);

await modPage.evaluate((name) => window.__game.online.chat(`/spectate ${name}`), targetChar);
await sleep(4000);
console.log('spectating:', await modPage.evaluate(() => window.__game.online.spectating));
await shotBar(modPage, `${TAG}-2-while-spectating.png`);

await modPage.evaluate(() => window.__game.online.chat('/unspectate'));
await sleep(4000);
console.log('spectating:', await modPage.evaluate(() => window.__game.online.spectating));
console.log('moderator bar (after /unspectate):', await barIds(modPage));
await shotBar(modPage, `${TAG}-3-after-unspectate.png`);
await modPage.screenshot({ path: `${OUT}/${TAG}-3-after-unspectate-full.png` });

await targetPage.close();
await modPage.close();
await browser.close();
