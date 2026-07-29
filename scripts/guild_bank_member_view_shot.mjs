// One-off local capture tool for the guild bank MEMBER READ-ONLY view: a
// two-account online scene (the change-aware pr_screenshots flow drives the
// OFFLINE client, which never has a guild, so this is the sanctioned bespoke
// arm). Account L founds, opens, and stocks the guild bank; account M joins as
// a plain member and stands at the banker.
//
//   STAGE=after  (this branch): the member sees the Guild tab READ-ONLY:
//                disabled gold buttons, the always-visible note, no buy row,
//                plus the now-member-readable activity log. Desktop + mobile.
//   STAGE=before (the base):    the member sees NO tab strip at all (the
//                officer-plus gate nulls their mirror). Desktop + mobile.
//
// Dev-only, not wired into any npm script or CI gate. Needs a running server
// with ALLOW_DEV_COMMANDS=1 (dev_level / dev_give / dev_teleport stage the
// scene) and a vite dev client pointed at it; never production. The login /
// entry / shot helpers are the proven recipe from guild_bank_tab_shot.mjs.
//
// Usage:
//   GAME_URL=http://localhost:5273 STAGE=after \
//     SHOTS_DIR=docs/screenshots/guild-bank-member-readonly \
//     node scripts/guild_bank_member_view_shot.mjs
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { suppressGpuNotice } from './lib/gpu_notice_suppress.mjs';

const GAME_URL = process.env.GAME_URL ?? 'http://localhost:5273';
const OUT = process.env.SHOTS_DIR ?? 'docs/screenshots/guild-bank-member-readonly';
const STAGE = process.env.STAGE ?? 'after';
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
    userDataDir: `/tmp/claude-501/gbank-member-shot-${uniq}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
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
    console.log('shot (fallback full)', file);
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

// The proven online-login recipe (guild_bank_tab_shot.mjs, unchanged).
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

// Fund + found + open + stock, all from the leader session (the proven
// guild_bank_tab_shot.mjs sequence, condensed): heart_of_the_rift sales fund
// the charter fee, the purse-paid opening, and the treasury.
async function foundOpenStock(page, guildName) {
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
  await page.evaluate((name) => window.__game.world.guildCreate(name), guildName);
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
  await page.evaluate(() => window.__game.world.guildBankBuySlots()); // rung 0: opens
  await page.waitForFunction(() => (window.__game.world.guildBankInfo?.capacity ?? 0) > 0, {
    timeout: 10000,
    polling: 300,
  });
  await page.evaluate(() => window.__game.world.guildBankDepositGold(300000));
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
  await dismissCameraPrompt(page);
  // A late-arriving invite toast must never overlap the captured window.
  await page.evaluate(() => {
    for (const p of document.querySelectorAll('.prompt')) {
      if (p.textContent?.includes('invites you to join')) p.remove();
    }
  });
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
  if (tab) {
    await page.waitForSelector('#bank-window .bank-tab', { timeout: 8000 });
    await page.evaluate((t) => {
      document
        .querySelector(`#bank-window .bank-tab[data-tab="${t}"]`)
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }, tab);
    await sleep(600);
  }
}

// Put the member character at the banker. The invite/accept pair retries until
// the membership lands (the invite is only sendable once M's session exists).
async function joinAsMember(memberPage, leaderPage, memberChar) {
  for (let i = 0; i < 20; i++) {
    const inGuild = await memberPage.evaluate(() => window.__game.world.socialInfo?.guild !== null);
    if (inGuild) break;
    await leaderPage.evaluate((name) => window.__game.world.guildInvite(name), memberChar);
    await sleep(600);
    await memberPage.evaluate(() => window.__game.world.guildAccept());
    await sleep(600);
  }
  const joined = await memberPage.evaluate(() => window.__game.world.socialInfo?.guild !== null);
  if (!joined) throw new Error('member never joined the guild');
  // The retry loop can leave a stale invite prompt on screen after the accept
  // lands (a later invite arrived mid-flight); strip it so no toast overlaps
  // the captured window. Pure DOM removal: no command, nothing to decline.
  await memberPage.evaluate(() => {
    for (const p of document.querySelectorAll('.prompt')) {
      if (p.textContent?.includes('invites you to join')) p.remove();
    }
  });
  await memberPage.evaluate(() => {
    window.__game.online.cmd({ cmd: 'dev_teleport', x: 13, z: 6.2 }); // the banker
  });
  await sleep(1200);
}

const guildName = `Gilded Vanguard ${alpha}`;
const leaderUser = `gbl_${uniq}`;
const memberUser = `gbm_${uniq}`;
const leaderChar = `Aurelia${alpha}`;
const memberChar = `Bram${alpha}`;

// Session L (desktop): found, open, stock; stays online to send the invite.
const leaderBrowser = await launchBrowser(false);
const leader = await leaderBrowser.newPage();
await suppressGpuNotice(leader);
await loginAndEnter(leader, leaderUser, leaderChar, 'paladin', { register: true });
await foundOpenStock(leader, guildName);

// Session M (desktop): register, join as plain member, stand at the banker.
const memberBrowser = await launchBrowser(false);
const member = await memberBrowser.newPage();
await suppressGpuNotice(member);
await loginAndEnter(member, memberUser, memberChar, 'warrior', { register: true });
await joinAsMember(member, leader, memberChar);

if (STAGE === 'after') {
  // The membership-gated stream must land WITH canEdit false (the member arm).
  await member.waitForFunction(() => window.__game.world.guildBankInfo?.canEdit === false, {
    timeout: 15000,
    polling: 300,
  });
  await openBankOn(member, 'guild', false);
  await shootBankWindow(member, `${OUT}/after-desktop-member-guild.png`);
  // The activity log, now member-readable: switch the pane's sub-view.
  await member.evaluate(() => {
    document
      .querySelector('#bank-window .gbank-view-tab[data-tab="log"]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await sleep(2500); // one on-demand fetch round-trip
  await shootBankWindow(member, `${OUT}/after-desktop-member-guild-log.png`);
} else {
  // BEFORE (base code): the member's mirror stays null, so the bank window
  // renders with NO tab strip at all. Prove the negative before shooting.
  await openBankOn(member, null, false);
  const hasStrip = await member.evaluate(() => !!document.querySelector('#bank-window .bank-tab'));
  if (hasStrip) throw new Error('BEFORE stage expected no tab strip for a member');
  await shootBankWindow(member, `${OUT}/before-desktop-member.png`);
}
await memberBrowser.close();

// Mobile member arm (same character; the desktop session is closed first so
// the takeover fence never fires).
{
  const { mobileBrowser, mobile } = await newMobilePage();
  await loginAndEnter(mobile, memberUser, memberChar, 'warrior', { mobile: true, register: false });
  if (STAGE === 'after') {
    await mobile.waitForFunction(() => window.__game.world.guildBankInfo?.canEdit === false, {
      timeout: 15000,
      polling: 300,
    });
    await openBankOn(mobile, 'guild', true);
    await shootBankWindow(mobile, `${OUT}/after-mobile-member-guild.png`, { fullFrame: true });
  } else {
    await openBankOn(mobile, null, true);
    await shootBankWindow(mobile, `${OUT}/before-mobile-member.png`, { fullFrame: true });
  }
  await mobileBrowser.close();
}

await leaderBrowser.close();
console.log('done');
