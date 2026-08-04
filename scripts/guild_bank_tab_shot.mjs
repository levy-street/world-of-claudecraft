// One-off local capture tool for the Guild Bank UI phase (Phase 4): shoots the
// bank window's Personal/Guild tab against a REAL online server (the Guild tab
// only exists online: guildBankInfo is officer-plus + banker proximity + a
// loaded book), plus the offline bank window (which must show NO tab strip:
// offline play never has a guild).
//
// Dev-only, not wired into any npm script or CI gate. Needs:
//   - STAGE=online: a running server with ALLOW_DEV_COMMANDS=1 (dev_give /
//     dev_teleport stock the scene) and a vite dev client pointed at it
//     (WOC_DEV_API_TARGET); never production.
//   - STAGE=offline: just the vite dev client.
//
// Usage:
//   GAME_URL=http://localhost:5273 \
//   STAGE=online SHOTS_DIR=docs/screenshots/guild-bank-tab \
//     node scripts/guild_bank_tab_shot.mjs
//   GAME_URL=http://localhost:5273 STAGE=offline PREFIX=before \
//     node scripts/guild_bank_tab_shot.mjs
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';
import { suppressGpuNotice } from './lib/gpu_notice_suppress.mjs';

const GAME_URL = process.env.GAME_URL ?? 'http://localhost:5273';
const OUT = process.env.SHOTS_DIR ?? 'docs/screenshots/guild-bank-tab';
const STAGE = process.env.STAGE ?? 'online';
const PREFIX = process.env.PREFIX ?? 'after';
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
    // Must exceed the longest waitForFunction below (the 90s world-entry wait),
    // or the CDP call itself times out first (observed live on the mobile arm).
    protocolTimeout: 180000,
    userDataDir: `/tmp/claude-501/gbank-shot-profile-${uniq}-${Date.now()}`,
    args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    // Desktop stays dpr 1: a dpr-2 1600x900 canvas under swiftshader starved
    // the world-entry wait past its timeout on this machine (observed live).
    defaultViewport: mobile
      ? MOBILE_VIEWPORT.viewport
      : { width: 1600, height: 900, deviceScaleFactor: 1 },
  });
}

async function shootBankWindow(page, file, { fullFrame = false } = {}) {
  if (fullFrame) {
    await page.screenshot({ path: file });
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

// ---------------------------------------------------------------------------
// STAGE=offline: the bank window with NO guild (offline play): no tab strip.
// ---------------------------------------------------------------------------
async function offlineStage() {
  for (const mobile of [false, true]) {
    const browser = await launchBrowser(mobile);
    const page = await browser.newPage();
    await suppressGpuNotice(page);
    if (mobile) {
      const cdp = await page.target().createCDPSession();
      await cdp.send('Emulation.setEmulatedMedia', {
        features: [
          { name: 'pointer', value: 'coarse' },
          { name: 'hover', value: 'none' },
        ],
      });
    }
    const charName = mobile ? 'Probermob' : 'Proberton';
    await page.goto(`${GAME_URL}/`, { waitUntil: 'networkidle0', timeout: 60000 });
    await page.evaluate((name) => {
      localStorage.setItem(`woc_spawn_intro_seen:offline:warrior:${name}`, '1');
    }, charName);
    await enterOfflineGame(page, { charClass: 'warrior', charName, settleMs: 2500 });
    await page.evaluate(() => {
      const sim = window.__game.sim;
      const p = sim.player;
      for (const [id, n] of [
        ['bone_fragments', 12],
        ['wolf_fang', 9],
        ['linen_scrap', 10],
        ['amber_hide', 6],
      ])
        sim.addItem(id, n);
      sim.players.get(p.id).copper = 123456;
      p.pos.x = 13;
      p.pos.y = 1.5;
      p.pos.z = 6.2;
      document.querySelector('.tut-skip')?.click();
    });
    await sleep(800);
    await dismissCameraPrompt(page);
    if (mobile) await page.evaluate(() => document.querySelector('#mobile-interact')?.click());
    else await page.evaluate(() => window.__game.hud.openBank());
    await page.waitForSelector('#bank-window', { visible: true, timeout: 5000 });
    await page.evaluate(() => document.querySelector('#bank-window .bank-deposit-all')?.click());
    await sleep(5200); // let the transient deposit-all status expire before the shot
    await shootBankWindow(page, `${OUT}/${PREFIX}-${mobile ? 'mobile' : 'desktop'}.png`, {
      fullFrame: mobile,
    });
    await browser.close();
  }
}

// ---------------------------------------------------------------------------
// STAGE=online: officer at the banker with a founded guild and a stocked book.
// ---------------------------------------------------------------------------

// The proven online-login recipe (scripts/social_landscape_online_shot.mjs).
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
  // The character list populates asynchronously (slower on the mobile page):
  // wait for a real row, then retry the Enter World click until something
  // visibly happened (charselect hid, the preflight opened, or the game booted).
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
      // The desktop session can linger linkdead for a grace period, so the row
      // may offer Take Over instead of Enter World: press whichever exists
      // (self-takeover is the ordinary reconnect path; confirm() is stubbed).
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
    // The tap-to-continue preflight arms only once Enter World is clicked, and
    // a single early click lands before its handler is wired (observed live:
    // the panel stayed up and no WS ever opened). Keep tapping until the game
    // actually boots.
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

// Funds + founds the guild from the acting session: sell dev-given valuables
// at the merchant, found the guild (the 1g fee comes out at the gate), then
// stand at the banker with materials in the bags. Under the pricing redesign
// the guild bank is UNOPENED at this point (0 item slots; the treasury works),
// which is exactly the state the unopened-pane shots capture.
async function fundAndFound(page) {
  await page.evaluate(() => {
    const cmd = (p) => window.__game.online.cmd(p);
    cmd({ cmd: 'dev_level', level: 20 });
    for (let i = 0; i < 10; i++) cmd({ cmd: 'dev_give', item: 'heart_of_the_rift', count: 1 });
    cmd({ cmd: 'dev_teleport', x: 0, z: 9.5 }); // the merchant stall
  });
  await sleep(1200);
  // Sell the valuables (50_000 copper each): 10 sales fund the fee, the
  // purse-paid opening, and the treasury.
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
  // Stand at Bursar Fernando; wait for the officer-gated guildBank stream.
  await page.evaluate(() => {
    const cmd = (p) => window.__game.online.cmd(p);
    cmd({ cmd: 'dev_teleport', x: 13, z: 6.2 });
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
}

// Opens the bank (rung 0, paid from the acting officer's own purse) and stocks
// it through the REAL facet commands: gold in, one treasury expansion, a few
// material stacks deposited.
async function openAndStock(page) {
  await page.evaluate(() => window.__game.world.guildBankBuySlots()); // rung 0: opens
  await page.waitForFunction(() => (window.__game.world.guildBankInfo?.capacity ?? 0) > 0, {
    timeout: 10000,
    polling: 300,
  });
  await page.evaluate(() => window.__game.world.guildBankDepositGold(300000));
  await sleep(700);
  await page.evaluate(() => window.__game.world.guildBankBuySlots()); // rung 1: treasury
  await sleep(700);
  for (const id of ['bone_fragments', 'wolf_fang', 'linen_scrap']) {
    await page.evaluate((itemId) => {
      const idx = window.__game.world.inventory.findIndex((s) => s.itemId === itemId);
      if (idx >= 0) window.__game.world.guildBankDeposit(idx);
    }, id);
    await sleep(700);
  }
}

async function openBankOn(page, tab, mobile) {
  // The first-run camera prompt can appear well after world entry; clear it
  // right before every shot so it never overlaps the captured window.
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

async function newMobilePage() {
  const mobileBrowser = await launchBrowser(true);
  const mobile = await mobileBrowser.newPage();
  await suppressGpuNotice(mobile);
  await mobile.emulate(MOBILE_VIEWPORT);
  const cdp = await mobile.target().createCDPSession();
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [
      { name: 'pointer', value: 'coarse' },
      { name: 'hover', value: 'none' },
    ],
  });
  return { mobileBrowser, mobile };
}

async function loginMobile(mobile, username, charName) {
  try {
    await loginAndEnter(mobile, username, charName, 'paladin', { mobile: true, register: false });
  } catch (e) {
    // Diagnostic dump: where did the mobile arm stall?
    await mobile.screenshot({ path: `${OUT}/debug-mobile-fail.png` }).catch(() => {});
    const state = await mobile
      .evaluate(() => ({
        body: document.body.className,
        panels: ['#login-panel', '#realm-panel', '#charselect-panel', '#charcreate-panel'].map(
          (s) => `${s}:${document.querySelector(s)?.hasAttribute('hidden') ? 'hidden' : 'shown'}`,
        ),
        preflight: !!document.querySelector('#mobile-preflight-continue'),
        game: typeof window.__game,
        entities: window.__game?.world?.entities?.size ?? -1,
      }))
      .catch(() => 'evaluate failed');
    console.log('MOBILE STALL STATE:', JSON.stringify(state));
    throw e;
  }
  await mobile.waitForFunction(() => window.__game.world.guildBankInfo !== null, {
    timeout: 15000,
    polling: 300,
  });
}

async function onlineStage() {
  const username = `gbank_${uniq}`;
  const charName = `Aurelia${alpha}`;

  // Session A (desktop): register, fund, found. The freshly founded guild's
  // bank is UNOPENED (pricing redesign): shoot the open-the-bank pane.
  {
    const desktopBrowser = await launchBrowser(false);
    const desktop = await desktopBrowser.newPage();
    await suppressGpuNotice(desktop);
    await loginAndEnter(desktop, username, charName, 'paladin', { register: true });
    await fundAndFound(desktop);
    await openBankOn(desktop, 'guild', false);
    await shootBankWindow(desktop, `${OUT}/after-desktop-guild-unopened.png`);
    await desktopBrowser.close();
  }

  // Session B (mobile, same character; the previous browser is closed first so
  // the takeover fence never fires): shoot the unopened pane on touch, then
  // open + stock the bank FROM THIS session (the facet commands are
  // host-identical) and shoot the opened touch pairing on both tabs.
  {
    const { mobileBrowser, mobile } = await newMobilePage();
    await loginMobile(mobile, username, charName);
    await openBankOn(mobile, 'guild', true);
    await shootBankWindow(mobile, `${OUT}/after-mobile-guild-unopened.png`, { fullFrame: true });
    await openAndStock(mobile);
    await sleep(800); // let the opened pane repaint off the snapshot echo
    await shootBankWindow(mobile, `${OUT}/after-mobile-guild.png`, { fullFrame: true });
    await openBankOn(mobile, 'personal', true);
    await shootBankWindow(mobile, `${OUT}/after-mobile-personal.png`, { fullFrame: true });
    await mobileBrowser.close();
  }

  // Session C (desktop, same character): the opened, stocked book on desktop.
  {
    const desktopBrowser = await launchBrowser(false);
    const desktop = await desktopBrowser.newPage();
    await suppressGpuNotice(desktop);
    await loginAndEnter(desktop, username, charName, 'paladin', { register: false });
    await desktop.waitForFunction(() => window.__game.world.guildBankInfo !== null, {
      timeout: 15000,
      polling: 300,
    });
    await openBankOn(desktop, 'personal', false);
    await shootBankWindow(desktop, `${OUT}/after-desktop-personal.png`);
    await openBankOn(desktop, 'guild', false);
    await shootBankWindow(desktop, `${OUT}/after-desktop-guild.png`);
    await shootBankWindow(desktop, `${OUT}/after-desktop-guild-full.png`, { fullFrame: true });
    await desktopBrowser.close();
  }
}

if (STAGE === 'offline') await offlineStage();
else await onlineStage();
console.log('done');
