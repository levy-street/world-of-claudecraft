// One-off local capture tool for the guild bank TRANSACTION HISTORY (the Guild
// pane's History sub-view). Sibling of scripts/guild_bank_log_shot.mjs and built
// on its recipe: a REAL online server, a real member standing at a real banker,
// and the real bank window painted from the real wire response. Where the log
// shot founds a fresh guild through play (a dozen rows), this one logs an
// EXISTING character into a guild whose ledger already runs to pages, because
// the surface under test is the paging, the filters and the search, and a
// ten-row history shows none of them.
//
// Dev-only, not wired into any npm script or CI gate. Needs a running server
// with ALLOW_DEV_COMMANDS=1 (dev_teleport brings the character to the banker)
// and a vite dev client pointed at it (WOC_DEV_API_TARGET); never production.
// The account is whatever local test account owns a guild member; its
// credentials come from the environment and are never written here.
//
// Usage:
//   GAME_URL=http://localhost:5181 GAME_USER=... GAME_PASS=... GAME_CHAR=... \
//     SHOTS_DIR=docs/screenshots/guild-bank-history \
//     node scripts/guild_bank_history_shot.mjs
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { suppressGpuNotice } from './lib/gpu_notice_suppress.mjs';

const GAME_URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = process.env.SHOTS_DIR ?? 'docs/screenshots/guild-bank-history';
const USER = process.env.GAME_USER;
const PASS = process.env.GAME_PASS;
const CHAR = process.env.GAME_CHAR;
if (!USER || !PASS || !CHAR) {
  throw new Error('GAME_USER, GAME_PASS and GAME_CHAR are required (a local test account).');
}
// Where the character is placed: beside Bursar Fernando in Eastbrook
// (src/sim/eastbrook_layout.ts places him at the bank's front standing point).
const BANKER_X = Number(process.env.BANKER_X ?? 9.5);
const BANKER_Z = Number(process.env.BANKER_Z ?? -97.5);
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uniq = Date.now().toString(36).slice(-6);

const MOBILE_VIEWPORT = {
  viewport: { width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
};

async function launchBrowser(mobile) {
  return puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: 'new',
    protocolTimeout: 180000,
    userDataDir: `${process.env.TEMP ?? '/tmp'}/gbank-history-shot-${uniq}-${Date.now()}`,
    args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    defaultViewport: mobile
      ? MOBILE_VIEWPORT.viewport
      : { width: 1600, height: 900, deviceScaleFactor: 1 },
  });
}

// The standing capture rule: the LOWEST graphics preset before the app boots.
async function seedLowestPreset(page) {
  await page.evaluateOnNewDocument(() => {
    try {
      const raw = localStorage.getItem('woc_settings');
      const prev = raw ? JSON.parse(raw) : {};
      localStorage.setItem('woc_settings', JSON.stringify({ ...prev, graphicsPreset: 1 }));
    } catch {
      /* storage unavailable */
    }
  });
}

async function shootBankWindow(page, file, { fullFrame = false } = {}) {
  if (fullFrame) {
    await page.screenshot({ path: file });
    console.log('shot', file);
    return;
  }
  const region = await page.evaluate(() => {
    const el = document.querySelector('#bank-window');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  if (!region || region.width <= 0) {
    await page.screenshot({ path: file });
    console.log('shot (full frame fallback)', file);
    return;
  }
  const m = 12;
  await page.screenshot({
    path: file,
    clip: {
      x: Math.max(0, region.x - m),
      y: Math.max(0, region.y - m),
      width: region.width + m * 2,
      height: region.height + m * 2,
    },
  });
  console.log('shot', file);
}

async function dismissCameraPrompt(page) {
  for (let i = 0; i < 6; i++) {
    const dismissed = await page
      .evaluate(() => {
        const btn = document.querySelector('.camera-prompt-confirm');
        if (btn instanceof HTMLElement) {
          btn.click();
          return true;
        }
        return false;
      })
      .catch(() => false);
    if (dismissed) return;
    await sleep(300);
  }
}

// The proven online-login recipe (scripts/guild_bank_log_shot.mjs), login only.
async function loginAndEnter(page, { mobile = false }) {
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
        if (form.dataset.authMode !== 'login') toggle.click();
        userEl.value = u;
        passEl.value = p;
        submit.click();
        return true;
      },
      USER,
      PASS,
    );
    if (!filled) await sleep(400);
  }
  if (!filled) throw new Error('login form never stabilized');
  await page.waitForSelector('#realm-list .realm-row', { timeout: 15000 });
  await page.evaluate(() => {
    const row = document.querySelector('#realm-list .realm-row');
    (row instanceof HTMLElement ? row : null)?.click();
  });
  await page.waitForFunction(
    () => !document.querySelector('#charselect-panel')?.hasAttribute('hidden'),
    { timeout: 15000, polling: 200 },
  );
  await page.waitForSelector('#char-list .char-row', { timeout: 20000 });
  for (let i = 0; i < 30; i++) {
    const advanced = await page.evaluate(
      () =>
        document.querySelector('#charselect-panel')?.hasAttribute('hidden') ||
        document.body.classList.contains('mobile-preflight-open') ||
        typeof window.__game !== 'undefined',
    );
    if (advanced) break;
    await page.evaluate((name) => {
      window.confirm = () => true;
      const rows = [...document.querySelectorAll('#char-list .char-row')];
      const row =
        rows.find((r) => r.querySelector('.char-name')?.textContent?.trim() === name) ?? rows[0];
      const btn = row?.querySelector('.enter-world-btn') ?? row?.querySelector('.take-over-btn');
      btn?.click();
    }, CHAR);
    await sleep(700);
  }
  if (mobile) {
    for (let i = 0; i < 60; i++) {
      const booted = await page.evaluate(() => typeof window.__game !== 'undefined');
      if (booted) break;
      await page
        .evaluate(() => document.querySelector('#mobile-preflight-continue')?.click())
        .catch(() => {});
      await sleep(1000);
    }
  }
  await page.waitForFunction(() => window.__game?.world?.entities?.size >= 1, {
    timeout: 90000,
    polling: 500,
  });
  await sleep(1200);
  await page.evaluate(() => document.querySelector('button.tut-skip')?.click()).catch(() => {});
  await dismissCameraPrompt(page);
}

async function standAtBanker(page) {
  await page.evaluate(
    (x, z) => window.__game.online.cmd({ cmd: 'dev_teleport', x, z }),
    BANKER_X,
    BANKER_Z,
  );
  await page.waitForFunction(() => window.__game.world.guildBankInfo !== null, {
    timeout: 20000,
    polling: 300,
  });
}

async function openBankOn(page, tab, mobile) {
  await dismissCameraPrompt(page);
  const open = await page.evaluate(() => {
    const el = document.querySelector('#bank-window');
    return !!el && getComputedStyle(el).display !== 'none';
  });
  if (!open) {
    if (mobile) await page.evaluate(() => document.querySelector('#mobile-interact')?.click());
    else await page.evaluate(() => window.__game.hud.openBank());
    await page.waitForSelector('#bank-window', { visible: true, timeout: 8000 });
    await sleep(600);
  }
  await page.waitForSelector('#bank-window .bank-tab', { timeout: 8000 });
  await page.evaluate((t) => {
    document
      .querySelector(`#bank-window .bank-tab[data-tab="${t}"]`)
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }, tab);
  await sleep(600);
}

const rowCount = (page) =>
  page.evaluate(() => document.querySelectorAll('#bank-window .gbank-log-row').length);

async function openHistoryView(page) {
  await page.waitForSelector('#bank-window .gbank-view-tab[data-tab="log"]', { timeout: 8000 });
  await page.evaluate(() => {
    document
      .querySelector('#bank-window .gbank-view-tab[data-tab="log"]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await page.waitForFunction(
    () => document.querySelectorAll('#bank-window .gbank-log-row').length > 0,
    { timeout: 15000, polling: 250 },
  );
  await sleep(500);
}

/** Press "Show older" and wait for the row count to grow. */
async function loadOlder(page) {
  const before = await rowCount(page);
  await page.evaluate(() => {
    document
      .querySelector('#bank-window .gbank-log-older')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await page.waitForFunction(
    (n) => document.querySelectorAll('#bank-window .gbank-log-row').length > n,
    { timeout: 15000, polling: 250 },
    before,
  );
  await sleep(400);
}

async function pressFilter(page, kind) {
  await page.evaluate((k) => {
    document
      .querySelector(`#bank-window .gbank-log-filter[data-kind="${k}"]`)
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }, kind);
  await page.waitForFunction(
    () => document.querySelectorAll('#bank-window .gbank-log-row').length > 0,
    { timeout: 15000, polling: 250 },
  );
  await sleep(500);
}

async function typeSearch(page, text) {
  await page.evaluate((t) => {
    const box = document.querySelector('#bank-window .gbank-log-search');
    if (!(box instanceof HTMLInputElement)) return;
    box.focus();
    box.value = t;
    box.dispatchEvent(new Event('input', { bubbles: true }));
  }, text);
  await sleep(400);
}

/** Scroll the history list a little so the pinned header is visibly floating
 *  over rows that have passed under it. */
async function scrollList(page, px) {
  await page.evaluate((y) => {
    const scroller = document.querySelector('#bank-window .gbank-log .bank-scroll');
    if (scroller) scroller.scrollTop = y;
  }, px);
  await sleep(300);
}

async function run() {
  // Session A (desktop): the newest window, two older pages with the header
  // pinned mid-scroll, the Money slice, and a search.
  {
    const browser = await launchBrowser(false);
    const page = await browser.newPage();
    await suppressGpuNotice(page);
    await seedLowestPreset(page);
    await loginAndEnter(page, { mobile: false });
    await standAtBanker(page);
    await openBankOn(page, 'guild', false);
    await openHistoryView(page);
    await shootBankWindow(page, `${OUT}/after-desktop-guild-history.png`);
    await shootBankWindow(page, `${OUT}/after-desktop-guild-history-full.png`, {
      fullFrame: true,
    });
    await loadOlder(page);
    await scrollList(page, 420);
    await shootBankWindow(page, `${OUT}/after-desktop-guild-history-older.png`);
    await scrollList(page, 0);
    await pressFilter(page, 'money');
    await shootBankWindow(page, `${OUT}/after-desktop-guild-history-money.png`);
    await pressFilter(page, 'all');
    await typeSearch(page, 'iron');
    await shootBankWindow(page, `${OUT}/after-desktop-guild-history-search.png`);
    await browser.close();
  }

  // Session B (mobile, same character; the desktop browser is closed first so
  // the takeover fence never fires).
  {
    const browser = await launchBrowser(true);
    const page = await browser.newPage();
    await suppressGpuNotice(page);
    await seedLowestPreset(page);
    await page.emulate(MOBILE_VIEWPORT);
    const cdp = await page.target().createCDPSession();
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [
        { name: 'pointer', value: 'coarse' },
        { name: 'hover', value: 'none' },
      ],
    });
    await loginAndEnter(page, { mobile: true });
    await standAtBanker(page);
    await openBankOn(page, 'guild', true);
    await openHistoryView(page);
    await shootBankWindow(page, `${OUT}/after-mobile-guild-history.png`, { fullFrame: true });
    await typeSearch(page, 'iron');
    await shootBankWindow(page, `${OUT}/after-mobile-guild-history-search.png`, {
      fullFrame: true,
    });
    await browser.close();
  }
}

await run();
console.log('done');
