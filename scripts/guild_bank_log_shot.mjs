// One-off local capture tool for the guild bank ACTIVITY LOG (the Guild pane's
// Log sub-view). Sibling of scripts/guild_bank_tab_shot.mjs and built on the
// same recipe: a REAL online server (the Guild tab exists only online, and the
// log is officer-plus + banker proximity + a loaded book), real facet commands
// to produce the history, and the real bank window painted from the real wire
// response.
//
// Dev-only, not wired into any npm script or CI gate. Needs a running server
// with ALLOW_DEV_COMMANDS=1 (dev_give / dev_teleport stock the scene) and a
// vite dev client pointed at it (WOC_DEV_API_TARGET); never production.
//
// Usage:
//   GAME_URL=http://localhost:5173 SHOTS_DIR=docs/screenshots/guild-bank-tab \
//     node scripts/guild_bank_log_shot.mjs
//
// THE EMPTY-STATE SHOT IS DRIVEN, NOT FAKED, and here is exactly how. Founding
// a guild always writes a `create_fee` bank_ledger row, so a guild whose log is
// genuinely empty is unreachable through play. The empty pane is still a state
// the client must render (a server that answers zero visible rows), so the shot
// swaps the WORLD's guildBankLog() read for one that returns an empty ready
// view and lets the real core + real painter draw it. Nothing about the image
// is drawn by this script; it is the shipping pane fed the shipping empty
// model.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { suppressGpuNotice } from './lib/gpu_notice_suppress.mjs';

const GAME_URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = process.env.SHOTS_DIR ?? 'docs/screenshots/guild-bank-tab';
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uniq = Date.now().toString(36).slice(-6);
const alpha = uniq.replace(/[0-9]/g, (d) => 'abcdefghij'[Number(d)]);

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
    userDataDir: `/tmp/claude-501/gbank-log-shot-${uniq}-${Date.now()}`,
    args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    defaultViewport: mobile
      ? MOBILE_VIEWPORT.viewport
      : { width: 1600, height: 900, deviceScaleFactor: 1 },
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

// The proven online-login recipe (scripts/guild_bank_tab_shot.mjs).
async function loginAndEnter(page, username, charName, cls, { mobile = false, register = true }) {
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
      (u, p, mail, reg) => {
        const form = document.querySelector('#login-panel');
        const userEl = document.querySelector('#login-user');
        const passEl = document.querySelector('#login-pass');
        const toggle = document.querySelector('#btn-auth-toggle');
        const submit = document.querySelector('#btn-login');
        if (!form || !userEl || !passEl || !toggle || !submit) return false;
        const wantMode = reg ? 'register' : 'login';
        if (form.dataset.authMode !== wantMode) toggle.click();
        const emailEl = document.querySelector('#login-email');
        userEl.value = u;
        passEl.value = p;
        if (reg && emailEl) emailEl.value = mail;
        submit.click();
        return true;
      },
      username,
      'hunter22',
      `${username}@example.com`,
      register,
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
    () =>
      !document.querySelector('#charcreate-panel')?.hasAttribute('hidden') ||
      !document.querySelector('#charselect-panel')?.hasAttribute('hidden'),
    { timeout: 15000, polling: 200 },
  );
  if (register) {
    const onCreatePanel = await page.evaluate(
      () => !document.querySelector('#charcreate-panel')?.hasAttribute('hidden'),
    );
    if (!onCreatePanel) {
      await page.evaluate(() => document.querySelector('#btn-new-character')?.click());
      await page.waitForFunction(
        () => !document.querySelector('#charcreate-panel')?.hasAttribute('hidden'),
        { timeout: 10000, polling: 200 },
      );
    }
    await page.evaluate(
      (name, cls2) => {
        document.querySelector('#new-char-name').value = name;
        document.querySelector(`#charcreate-panel .mini-class[data-class="${cls2}"]`)?.click();
        document.querySelector('#btn-create-char').click();
      },
      charName,
      cls,
    );
  }
  await page.waitForFunction(
    () => !document.querySelector('#charselect-panel')?.hasAttribute('hidden'),
    { timeout: 10000, polling: 200 },
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
    }, charName);
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

// Fund, found, open, and then WORK the bank, so the log has one line of every
// sentence the pane can draw: the charter fee, the purse-paid opening, a
// treasury-paid expansion, money in and out, and items in and out.
async function fundFoundAndWorkTheBank(page) {
  await page.evaluate(() => {
    const cmd = (p) => window.__game.online.cmd(p);
    cmd({ cmd: 'dev_level', level: 20 });
    for (let i = 0; i < 10; i++) cmd({ cmd: 'dev_give', item: 'heart_of_the_rift', count: 1 });
    cmd({ cmd: 'dev_teleport', x: 0, z: 9.5 }); // the merchant stall
  });
  await sleep(1200);
  for (let i = 0; i < 10; i++) {
    await page.evaluate(() => window.__game.world.sellItem('heart_of_the_rift', 1));
    await sleep(250);
  }
  await page.waitForFunction(() => window.__game.world.copper >= 400000, {
    timeout: 15000,
    polling: 300,
  });
  await page.evaluate((name) => window.__game.world.guildCreate(name), `Gilded Vanguard ${alpha}`);
  await sleep(1500);
  await page.evaluate(() => {
    const cmd = (p) => window.__game.online.cmd(p);
    cmd({ cmd: 'dev_teleport', x: 13, z: 6.2 }); // Bursar Fernando
    for (const [id, n] of [
      ['bone_fragments', 12],
      ['wolf_fang', 9],
      ['linen_scrap', 10],
    ])
      cmd({ cmd: 'dev_give', item: id, count: n });
  });
  await page.waitForFunction(() => window.__game.world.guildBankInfo !== null, {
    timeout: 15000,
    polling: 300,
  });
  // Rung 0 opens the bank from the acting officer's own purse.
  await page.evaluate(() => window.__game.world.guildBankBuySlots());
  await page.waitForFunction(() => (window.__game.world.guildBankInfo?.capacity ?? 0) > 0, {
    timeout: 10000,
    polling: 300,
  });
  await sleep(600);
  await page.evaluate(() => window.__game.world.guildBankDepositGold(300000));
  await sleep(900);
  await page.evaluate(() => window.__game.world.guildBankBuySlots()); // rung 1: treasury-paid
  await sleep(900);
  for (const id of ['bone_fragments', 'wolf_fang', 'linen_scrap']) {
    await page.evaluate((itemId) => {
      const idx = window.__game.world.inventory.findIndex((s) => s.itemId === itemId);
      if (idx >= 0) window.__game.world.guildBankDeposit(idx);
    }, id);
    await sleep(800);
  }
  // ...and back out again, so the log shows both directions.
  await page.evaluate(() => window.__game.world.guildBankWithdraw(0, 3));
  await sleep(900);
  await page.evaluate(() => window.__game.world.guildBankWithdrawGold(12345));
  await sleep(1200);
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

async function openLogView(page) {
  await page.waitForSelector('#bank-window .gbank-view-tab[data-tab="log"]', { timeout: 8000 });
  await page.evaluate(() => {
    document
      .querySelector('#bank-window .gbank-view-tab[data-tab="log"]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  // Wait for the on-demand fetch to land: rows, or the empty/refused line.
  await page
    .waitForFunction(
      () =>
        document.querySelectorAll('#bank-window .gbank-log-row').length > 0 ||
        document.querySelector('#bank-window .gbank-log-empty') !== null ||
        document.querySelector('#bank-window .gbank-log-refused') !== null,
      { timeout: 15000, polling: 250 },
    )
    .catch(() => {});
  await sleep(500);
}

/** Swap the world's log read for an empty ready view and repaint: the real
 *  core and the real painter draw the real empty pane (see the header). */
async function forceEmptyLog(page) {
  await page.evaluate(() => {
    const world = window.__game.world;
    world.guildBankLog = () => ({ state: 'ready', entries: [] });
    window.__game.hud.bankWindow.render();
  });
  await sleep(500);
}

async function run() {
  const username = `gblog_${uniq}`;
  const charName = `Verity${alpha}`;

  // Session A (desktop): register, fund, found, open, work the bank, shoot the
  // populated log and then the empty pane.
  {
    const browser = await launchBrowser(false);
    const page = await browser.newPage();
    await suppressGpuNotice(page);
    await loginAndEnter(page, username, charName, 'paladin', { register: true });
    await fundFoundAndWorkTheBank(page);
    await openBankOn(page, 'guild', false);
    await openLogView(page);
    await shootBankWindow(page, `${OUT}/after-desktop-guild-log.png`);
    await shootBankWindow(page, `${OUT}/after-desktop-guild-log-full.png`, { fullFrame: true });
    await forceEmptyLog(page);
    await shootBankWindow(page, `${OUT}/after-desktop-guild-log-empty.png`);
    await browser.close();
  }

  // Session B (mobile, same character; the desktop browser is closed first so
  // the takeover fence never fires).
  {
    const browser = await launchBrowser(true);
    const page = await browser.newPage();
    await suppressGpuNotice(page);
    await page.emulate(MOBILE_VIEWPORT);
    const cdp = await page.target().createCDPSession();
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [
        { name: 'pointer', value: 'coarse' },
        { name: 'hover', value: 'none' },
      ],
    });
    await loginAndEnter(page, username, charName, 'paladin', { mobile: true, register: false });
    await page.waitForFunction(() => window.__game.world.guildBankInfo !== null, {
      timeout: 20000,
      polling: 300,
    });
    await openBankOn(page, 'guild', true);
    await openLogView(page);
    await shootBankWindow(page, `${OUT}/after-mobile-guild-log.png`, { fullFrame: true });
    await forceEmptyLog(page);
    await shootBankWindow(page, `${OUT}/after-mobile-guild-log-empty.png`, { fullFrame: true });
    await browser.close();
  }
}

await run();
console.log('done');
