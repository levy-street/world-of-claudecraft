// One-off local capture tool for the realm message of the day PR: shows what
// an admin sees after typing /motd, and what a player sees in chat when they
// enter the world afterwards, against a REAL server and the REAL chat input.
//
// Dev-only, not wired into any npm script or CI gate. Needs:
//   - the dev Postgres up (npm run db:up)
//   - a server on SERVER_URL built from this branch (e.g. PORT=8796 npm run server)
//   - a vite dev client on GAME_URL proxying to it
//     (e.g. WOC_DEV_API_TARGET=http://127.0.0.1:8796 npx vite --port 5196)
//
// Usage:
//   GAME_URL=http://localhost:5196 SERVER_URL=http://127.0.0.1:8796 \
//     SHOTS_DIR=docs/screenshots/realm-motd node scripts/realm_motd_shot.mjs
//
// It registers throwaway accounts, grants the admin role to two of them, and
// clears the message of the day again before exiting.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { dismissEntryOverlays } from './enter_offline_game.mjs';
import { suppressGpuNotice } from './lib/gpu_notice_suppress.mjs';
import { assertLoopbackDatabaseUrl, assertLoopbackUrl } from './lib/loopback_guard.mjs';

const GAME_URL = process.env.GAME_URL ?? 'http://localhost:5196';
const SERVER_URL = process.env.SERVER_URL ?? 'http://127.0.0.1:8796';
const OUT = process.env.SHOTS_DIR ?? 'docs/screenshots/realm-motd';
const MOTD = 'Double XP all weekend! Server maintenance on Sunday at 22:00 UTC.';

assertLoopbackUrl(SERVER_URL, 'SERVER_URL');
assertLoopbackUrl(GAME_URL, 'GAME_URL');
try {
  process.loadEnvFile?.();
} catch {
  // .env is optional; the guard below still sees a directly-passed value.
}
assertLoopbackDatabaseUrl(process.env.DATABASE_URL);

fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uniq = Date.now().toString(36).slice(-6);
const alpha = uniq.replace(/[0-9]/g, (d) => 'abcdefghij'[Number(d)]);
const PASSWORD = 'hunter22-motd';

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

async function makeAccount(prefix, charName, cls, admin) {
  const username = `${prefix}${uniq}`;
  const reg = await api('/api/register', {
    username,
    password: PASSWORD,
    email: `${username}@example.com`,
  });
  if (!reg.body.token) throw new Error(`register failed: ${JSON.stringify(reg.body)}`);
  const char = await api('/api/characters', { name: charName, class: cls }, reg.body.token);
  if (!char.body.id) throw new Error(`character create failed: ${JSON.stringify(char.body)}`);
  // Permissions are snapshotted at world join, so the grant lands first.
  if (admin) {
    execFileSync('node', ['scripts/grant_admin.mjs', username, '--roles', 'admin'], {
      stdio: 'inherit',
    });
  }
  return { username, charName };
}

async function launchBrowser() {
  return puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: 'new',
    protocolTimeout: 60000,
    userDataDir: `/tmp/claude-1000/realm-motd-shot-${uniq}-${Date.now()}`,
    args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
}

async function newPage(browser, mobile) {
  const page = await browser.newPage();
  await suppressGpuNotice(page);
  // Standing capture rule: the lowest graphics preset, seeded before boot.
  await page.evaluateOnNewDocument(
    "try { localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: 1 })); } catch (e) {}",
  );
  if (mobile) {
    await page.emulate({
      viewport: { width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    });
  } else {
    await page.setViewport({ width: 1280, height: 720 });
  }
  return page;
}

async function enterWorld(page, { username, charName }, mobile) {
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await page.goto(GAME_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
      lastErr = undefined;
      break;
    } catch (e) {
      lastErr = e;
      await sleep(1000);
    }
  }
  if (lastErr) throw lastErr;
  if (mobile) await page.evaluate(() => document.body.classList.add('mobile-touch'));
  await page.waitForSelector('#btn-online', { timeout: 30000 });
  await sleep(1000);
  await page.evaluate(() => document.querySelector('#btn-online')?.click());
  await page.waitForSelector('#login-user', { visible: true, timeout: 45000 });
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
      username,
      PASSWORD,
    );
    if (!filled) await sleep(400);
  }
  if (!filled) throw new Error('login form never stabilized');
  await page.waitForSelector('#realm-list .realm-row', { timeout: 15000 });
  await page.evaluate(() => document.querySelector('#realm-list .realm-row')?.click());
  await page.waitForFunction(
    () => !document.querySelector('#charselect-panel')?.hasAttribute('hidden'),
    { timeout: 15000, polling: 200 },
  );
  await sleep(700);
  await page.evaluate((name) => {
    const rows = [...document.querySelectorAll('#char-list .char-row')];
    const row =
      rows.find((r) => r.querySelector('.char-name')?.textContent?.trim() === name) ?? rows[0];
    row?.querySelector('.enter-world-btn')?.click();
  }, charName);
  if (mobile) {
    await page
      .waitForSelector('#mobile-preflight-continue', { visible: true, timeout: 8000 })
      .catch(() => {});
    await page.evaluate(() => document.querySelector('#mobile-preflight-continue')?.click());
  }
  await page.waitForFunction(() => window.__game?.world?.entities?.size >= 1, {
    timeout: 60000,
    polling: 500,
  });
  await sleep(1500);
  await dismissOverlays(page);
}

// The shared entry-overlay pass skips the spawn cinematic (which swallows every
// key while it plays), the tutorial, the camera prompt and the ferryman's
// welcome note; the store promo card is closed here as well so no capture
// carries it.
async function dismissOverlays(page) {
  await dismissEntryOverlays(page);
  await page.evaluate(() => document.querySelector('.store-promo-card-close')?.click());
  await page.waitForFunction(() => document.getElementById('ui')?.style.display !== 'none', {
    timeout: 20000,
    polling: 200,
  });
}

async function chatText(page) {
  return page.evaluate(() => document.querySelector('#chatlog')?.textContent ?? '');
}

async function waitForChat(page, needle, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if ((await chatText(page)).includes(needle)) return;
    await sleep(250);
  }
  throw new Error(`chat never showed "${needle}"; chat was: ${await chatText(page)}`);
}

// Mobile: a tap on the Chat button opens the read view (the log plus the
// composer bar); it is a pointerdown/pointerup pair on #mobile-chat.
async function openMobileChat(page) {
  if (await page.evaluate(() => document.body.classList.contains('mobile-chat-open'))) return;
  await page.evaluate(() => {
    const button = document.querySelector('#mobile-chat');
    const opts = { bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: true };
    button?.dispatchEvent(new PointerEvent('pointerdown', opts));
    button?.dispatchEvent(new PointerEvent('pointerup', opts));
  });
  await page.waitForFunction(() => document.body.classList.contains('mobile-chat-open'), {
    timeout: 5000,
    polling: 100,
  });
  await sleep(400);
}

// Opens the chat composer (Enter on desktop, a tap on the composer bar on
// mobile), types the command, and sends it with Enter.
async function sendChat(page, text, mobile) {
  if (mobile) {
    await page.tap('#chat-input');
  } else {
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    });
    await page.keyboard.press('Enter');
  }
  await page.waitForFunction(
    () => {
      const input = document.querySelector('#chat-input');
      return (
        input && getComputedStyle(input).display !== 'none' && document.activeElement === input
      );
    },
    { timeout: 5000, polling: 100 },
  );
  await page.keyboard.type(text, { delay: 5 });
  await page.keyboard.press('Enter');
}

// Pins the log to its newest line (the chat follows the bottom, but a panel
// opened after the lines arrived can sit a line short on the phone layout).
async function scrollChatToEnd(page) {
  await page.evaluate(() => {
    const log = document.querySelector('#chatlog');
    if (log) log.scrollTop = log.scrollHeight;
  });
  await sleep(300);
}

async function shootChat(page, file) {
  const region = await page.evaluate(() => {
    const el = document.querySelector('#chatlog-wrap');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  const m = 8;
  if (!region || region.width <= 0 || region.height <= 0) throw new Error('no chat region');
  await page.screenshot({
    path: file,
    clip: {
      x: Math.max(0, region.x - m),
      y: Math.max(0, region.y - m),
      width: region.width + m * 2,
      height: region.height + m * 2,
    },
  });
}

const adminDesktop = await makeAccount('motdadm', `Herald${alpha}`.slice(0, 12), 'paladin', true);
const playerDesktop = await makeAccount('motdply', `Wanderer${alpha}`.slice(0, 12), 'mage', false);
const adminMobile = await makeAccount('motdadmm', `Crier${alpha}`.slice(0, 12), 'priest', true);
const playerMobile = await makeAccount('motdplym', `Rover${alpha}`.slice(0, 12), 'rogue', false);

const browsers = [];
try {
  // 1. The admin sets the message on desktop: the realm-wide line plus the
  //    "updated" confirmation land in their own chat.
  const b1 = await launchBrowser();
  browsers.push(b1);
  const admin = await newPage(b1, false);
  await enterWorld(admin, adminDesktop, false);
  await sendChat(admin, `/motd "${MOTD}"`);
  await waitForChat(admin, 'Message of the day updated.');
  await sleep(500);
  await shootChat(admin, `${OUT}/after-admin-desktop-chat.png`);
  console.log('admin desktop captured');

  // 2. A player enters the world afterwards: the message follows the
  //    world-entry line.
  const b2 = await launchBrowser();
  browsers.push(b2);
  const player = await newPage(b2, false);
  await enterWorld(player, playerDesktop, false);
  await waitForChat(player, 'Message of the day:');
  await sleep(500);
  await shootChat(player, `${OUT}/after-player-desktop-chat.png`);
  console.log('player desktop captured');
  await b2.close();
  browsers.pop();
  await b1.close();
  browsers.pop();

  // 3. Mobile: a player entering the world on a phone.
  const b3 = await launchBrowser();
  browsers.push(b3);
  const mobilePlayer = await newPage(b3, true);
  await enterWorld(mobilePlayer, playerMobile, true);
  await waitForChat(mobilePlayer, 'Message of the day:');
  await openMobileChat(mobilePlayer);
  await scrollChatToEnd(mobilePlayer);
  await sleep(800);
  await shootChat(mobilePlayer, `${OUT}/after-player-mobile-chat.png`);
  console.log('player mobile captured');
  await b3.close();
  browsers.pop();

  // 4. Mobile: an admin re-issuing the same command from a phone, then the
  //    clear that leaves the dev realm as it was found.
  const b4 = await launchBrowser();
  browsers.push(b4);
  const mobileAdmin = await newPage(b4, true);
  await enterWorld(mobileAdmin, adminMobile, true);
  await openMobileChat(mobileAdmin);
  await sendChat(mobileAdmin, `/motd "${MOTD}"`, true);
  await waitForChat(mobileAdmin, 'Message of the day updated.');
  await openMobileChat(mobileAdmin);
  await scrollChatToEnd(mobileAdmin);
  await sleep(800);
  await shootChat(mobileAdmin, `${OUT}/after-admin-mobile-chat.png`);
  console.log('admin mobile captured');
  await openMobileChat(mobileAdmin);
  await sendChat(mobileAdmin, '/motd clear', true);
  await waitForChat(mobileAdmin, 'Message of the day cleared.');
  console.log('message of the day cleared');
} finally {
  for (const b of browsers) await b.close().catch(() => {});
}
