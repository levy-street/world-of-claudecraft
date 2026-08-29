// THE GUILD PANE of the bank window, measured against a real realm.
//
// WHY IT EXISTS. Bank Storage phase 18 made the personal pane a scrollport with a
// pinned footer, scoped by `:has(.bank-footer)`. The guild pane has no footer, so
// the scoping never reaches it and it keeps today's regime. That was ASSERTED
// from the selector, never measured: the pane is ONLINE-ONLY (it needs a real
// guild, a real member and a guild book loaded into the live sim), so no offline
// rig and no jsdom suite can mount it at all. Meanwhile phase 18 changed
// restoreScroll to write el.scrollTop on WHICHEVER element is the scroller, and
// the guild path is one of the elements it now writes. Nothing had ever looked.
//
// NOT A CI TEST, and deliberately not written as one: it needs a whole rig.
//
// RIG:
//   1. Portable Postgres on 127.0.0.1:5433 (the packet's user-space recipe).
//   2. node scripts/bank_guild_pane_seed.mjs  (mints the accounts, characters,
//      guilds and STOCKED guild books, and writes tmp/bank_guild_pane_state.json).
//   3. RESTART npm run server on :8787 with ALLOW_DEV_COMMANDS=1. This is not
//      optional: GameServer.loadGuildBanks reads every guild book ONCE at boot,
//      so a guild seeded into a running server has no live book and its tab
//      never renders.
//   4. npm run dev on :5173 (Vite binds ::1 only: use localhost, not 127.0.0.1).
//   5. BROWSER_PATH and DATABASE_URL in the environment.
//
// THREE TRAPS IT PAYS FOR, all of which cost a run:
//   - character names are LETTERS ONLY; a digit is refused at create and world
//     entry then waits forever on a character that was never made.
//   - the auth panel opens in REGISTER mode and the toggle REBUILDS the form, so
//     a fill in the same evaluate as the toggle click submits the register button.
//   - a character LEASE outlives a run; re-entry hangs until it is cleared.
//
// It also refuses to spell the banker's seat as a literal: the Eastbrook rebuild
// moved the bank ~105 yards and silently broke the sibling rig that did.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { assertLoopbackUrl } from './lib/loopback_guard.mjs';

const SEEDED = JSON.parse(fs.readFileSync('tmp/bank_guild_pane_state.json', 'utf8'));
const GAME_URL = process.env.GAME_URL ?? 'http://localhost:5173/';
// This tool drives /dev cheats against a live realm, so it is a LOCAL dev
// instrument only: refuse anything but a loopback target before it opens a page.
assertLoopbackUrl(GAME_URL, 'GAME_URL');
const BROWSER_PATH = process.env.BROWSER_PATH;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0,
  fail = 0;
const check = (n, c, extra = '') => {
  if (c) {
    pass++;
    console.log('PASS', n);
  } else {
    fail++;
    console.log('FAIL', n, extra);
  }
};

function readPane(which) {
  const win = document.querySelector('#bank-window');
  if (!win) return { error: 'no #bank-window' };
  const wb = win.getBoundingClientRect();
  const scrollers = [];
  (function walk(el) {
    for (const c of el.children) {
      const cs = getComputedStyle(c);
      if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && c.scrollHeight > c.clientHeight)
        scrollers.push(c.className.split(' ')[0]);
      walk(c);
    }
  })(win);
  const cs = getComputedStyle(win);
  const inner = win.querySelector('.bank-scroll');
  const controls = [...win.querySelectorAll('button,input,select,.bag-chip,.bank-tab')]
    .map((e) => {
      const b = e.getBoundingClientRect();
      return {
        c: e.className.split(' ')[0] || e.tagName,
        h: +b.height.toFixed(1),
        w: +b.width.toFixed(1),
      };
    })
    .filter((x) => x.h > 0 || x.w > 0);
  // the LAST transactional control in this pane, whatever it is
  // The guild pane's CHROME, which is what must stay inside the window. An item
  // cell inside the inner scrollport is NOT chrome: cells below the fold are
  // outside the window by construction, which is what scrolling means, so
  // measuring "the last button" answers the wrong question here.
  const CHROME = [
    '.gbank-actions',
    '.gbank-action',
    '.gbank-view-tab',
    '.gbank-tabs',
    '.gbank-treasury',
    '.gbank-header',
    '.bank-tabs',
    '.panel-title',
    '.gbank-deposit',
    '.gbank-withdraw',
    '.gbank-log-btn',
  ];
  const chrome = [];
  for (const sel of CHROME) {
    for (const el of win.querySelectorAll(sel)) {
      const b = el.getBoundingClientRect();
      if (b.height <= 0) continue;
      chrome.push({
        sel,
        h: +b.height.toFixed(1),
        w: +b.width.toFixed(1),
        past: +(b.bottom - wb.bottom).toFixed(1),
      });
    }
  }
  const rows = [...win.querySelectorAll('button')].filter(
    (b) => b.getBoundingClientRect().height > 0,
  );
  const lastBtn = rows[rows.length - 1];
  return {
    which,
    activeTab:
      win.querySelector('.bank-tab.active,.bank-tab[aria-selected="true"]')?.textContent?.trim() ??
      null,
    winH: +wb.height.toFixed(1),
    winBottom: +wb.bottom.toFixed(1),
    hasFooter: !!win.querySelector('.bank-footer'),
    overflowY: cs.overflowY,
    touchAction: cs.touchAction,
    windowScrolls: win.scrollHeight > win.clientHeight,
    windowScrollTop: win.scrollTop,
    windowRange: win.scrollHeight - win.clientHeight,
    innerScrollers: scrollers,
    innerScroll: inner
      ? {
          cls: inner.className.split(' ')[0],
          overflowY: getComputedStyle(inner).overflowY,
          scrollTop: inner.scrollTop,
          range: inner.scrollHeight - inner.clientHeight,
          bottomPast: +(inner.getBoundingClientRect().bottom - wb.bottom).toFixed(1),
        }
      : null,
    lastControlPast: lastBtn
      ? +(lastBtn.getBoundingClientRect().bottom - wb.bottom).toFixed(1)
      : null,
    lastControlLabel: lastBtn ? lastBtn.textContent.trim().slice(0, 28) : null,
    chrome,
    chromeOutside: chrome.filter((c) => c.past > 0),
    zeroBox: controls.filter((c) => c.h <= 0 || c.w <= 0).length,
    underFloor: controls.filter((c) => c.h > 0 && c.h < 40).map((c) => `${c.c}:${c.h}`),
    controlCount: controls.length,
  };
}

async function loginAndEnter(page, username, charName) {
  let lastErr;
  for (let a = 0; a < 4; a++) {
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
  await page.evaluate(() => document.body.classList.add('mobile-touch'));
  await page.waitForSelector('#btn-online', { timeout: 30000 });
  await sleep(1000);
  await page.evaluate(() => document.querySelector('#btn-online')?.click());
  await page.waitForSelector('#login-user', { visible: true, timeout: 45000 });
  // The auth panel opens in REGISTER mode and the toggle REBUILDS the form, so a
  // fill in the same evaluate as the toggle click writes into the DOM that is
  // about to be replaced and submits the register button instead. Toggle, wait
  // for the mode to actually flip, THEN fill and submit.
  for (let a = 0; a < 8; a++) {
    const mode = await page.evaluate(
      () => document.querySelector('#login-panel')?.dataset.authMode ?? null,
    );
    if (mode === 'login') break;
    await page.evaluate(() => document.querySelector('#btn-auth-toggle')?.click());
    await sleep(500);
  }
  const mode = await page.evaluate(
    () => document.querySelector('#login-panel')?.dataset.authMode ?? null,
  );
  if (mode !== 'login') throw new Error(`auth panel never reached login mode (mode=${mode})`);
  let filled = false;
  for (let a = 0; a < 6 && !filled; a++) {
    filled = await page.evaluate(
      (u, pw) => {
        const userEl = document.querySelector('#login-user'),
          passEl = document.querySelector('#login-pass');
        const submit = document.querySelector('#btn-login');
        if (!userEl || !passEl || !submit) return false;
        userEl.value = u;
        passEl.value = pw;
        userEl.dispatchEvent(new Event('input', { bubbles: true }));
        passEl.dispatchEvent(new Event('input', { bubbles: true }));
        submit.click();
        return true;
      },
      username,
      'hunter22',
    );
    if (!filled) await sleep(400);
  }
  if (!filled) throw new Error('login form never stabilized');
  await sleep(2500);
  const authState = await page.evaluate(() => ({
    mode: document.querySelector('#login-panel')?.dataset.authMode ?? null,
    err:
      document.querySelector('#login-panel .err, #login-err, .auth-error')?.textContent?.trim() ??
      null,
    visiblePanels: [...document.querySelectorAll('[id$="-panel"]')]
      .filter((e) => !e.hasAttribute('hidden'))
      .map((e) => e.id),
    realmRows: document.querySelectorAll('#realm-list .realm-row').length,
    bodyText: (document.querySelector('#login-panel')?.innerText ?? '').slice(0, 220),
  }));
  console.log('AUTH STATE:', JSON.stringify(authState));
  await page.waitForSelector('#realm-list .realm-row', { timeout: 20000 });
  await page.evaluate(() => document.querySelector('#realm-list .realm-row')?.click());
  // The character already exists (minted over REST), so this lands on char select.
  await page.waitForFunction(
    () => !document.querySelector('#charselect-panel')?.hasAttribute('hidden'),
    { timeout: 20000, polling: 200 },
  );
  await sleep(700);
  await page.evaluate((name) => {
    const rows = [...document.querySelectorAll('#char-list .char-row')];
    (rows.find((r) => r.querySelector('.char-name')?.textContent?.trim() === name) ?? rows[0])
      ?.querySelector('.enter-world-btn')
      ?.click();
  }, charName);
  await page
    .waitForSelector('#mobile-preflight-continue', { visible: true, timeout: 8000 })
    .catch(() => {});
  await page.evaluate(() => document.querySelector('#mobile-preflight-continue')?.click());
  await page.waitForFunction(() => window.__game?.world?.entities?.size >= 1, {
    timeout: 40000,
    polling: 500,
  });
}

const PROFILES = [
  { name: '740x360', width: 740, height: 360 },
  { name: '844x390', width: 844, height: 390 },
];
for (const profile of PROFILES) {
  const seed = SEEDED.find((r) => r.width === profile.width);
  const user = seed.user;
  // Character names are LETTERS ONLY: a digit is silently rejected at create
  // and the world entry then waits forever on a character that was never made.
  const charName = seed.charName;
  const browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage();
  await page.setViewport({
    width: profile.width,
    height: profile.height,
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const cdp = await page.target().createCDPSession();
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [
      { name: 'pointer', value: 'coarse' },
      { name: 'hover', value: 'none' },
    ],
  });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  try {
    await loginAndEnter(page, user, charName);
    check(`${profile.name} entered the online world`, true);

    // Online the SERVER owns position, so reach the banker with the real dev
    // teleport. Its seat is imported from the layout module in-page rather than
    // spelled as a literal: the Eastbrook rebuild has already moved it once.
    const seat = await page.evaluate(async () => {
      const m = await import('/src/sim/eastbrook_layout.ts');
      const byId = m.EASTBROOK_NPC_PLACEMENTS_BY_ID ?? null;
      const p = byId?.bursar_fernando?.position ?? null;
      return p ? { x: p.x, z: p.z } : null;
    });
    check(`${profile.name} banker seat read from the layout module`, !!seat, JSON.stringify(seat));
    if (!seat) {
      await browser.close();
      continue;
    }
    await page.evaluate(
      (x, z) => window.__game.world.chat(`/dev tp ${x} ${z + 2}`),
      seat.x,
      seat.z,
    );
    await sleep(3500);
    const near = await page.evaluate(() => {
      const w = window.__game.world;
      const p = w.player ?? null;
      return p ? { x: +p.pos.x.toFixed(1), z: +p.pos.z.toFixed(1) } : null;
    });
    check(
      `${profile.name} teleported to the banker`,
      !!near && Math.abs(near.z - (seat.z + 2)) < 6,
      JSON.stringify({ near, seat }),
    );

    // guildBankInfo is proximity-gated like BankInfo, so it can only arrive once
    // the player is actually standing at the banker.
    const inGuild = await page
      .waitForFunction(
        () => {
          const w = window.__game.world;
          const info = (typeof w.guildBankInfo === 'function' ? w.guildBankInfo() : null) ?? null;
          return !!info;
        },
        { timeout: 25000, polling: 500 },
      )
      .then(() => true)
      .catch(() => false);
    if (!inGuild)
      console.log(
        `[${profile.name}] note: guildBankInfo() is not a client-side function; the GUILD tab's presence below is the real proof the info arrived`,
      );

    await page.evaluate(() => document.querySelector('#mobile-interact')?.click());
    const opened = await page
      .waitForSelector('#bank-window', { visible: true, timeout: 12000 })
      .then(() => true)
      .catch(() => false);
    check(`${profile.name} bank window opened online`, opened);
    if (!opened) {
      await browser.close();
      continue;
    }
    await sleep(2000);

    const personal = await page.evaluate(readPane, 'personal');
    console.log(`[${profile.name}] PERSONAL  ${JSON.stringify(personal)}`);

    // Switch to the GUILD tab.
    const switched = await page.evaluate(() => {
      const tabs = [...document.querySelectorAll('#bank-window .bank-tab')];
      const g = tabs.find((t) => /guild/i.test(t.textContent ?? '')) ?? null;
      if (!g) return { ok: false, tabs: tabs.map((t) => t.textContent.trim()) };
      g.click();
      return { ok: true, tabs: tabs.map((t) => t.textContent.trim()) };
    });
    console.log(`[${profile.name}] tab switch: ${JSON.stringify(switched)}`);
    check(
      `${profile.name} the GUILD tab exists and was clicked`,
      switched.ok,
      JSON.stringify(switched),
    );
    await sleep(2200);
    const guild = await page.evaluate(readPane, 'guild');
    console.log(`[${profile.name}] GUILD     ${JSON.stringify(guild)}`);

    check(
      `${profile.name} guild pane has NO .bank-footer (the :has() scoping never reaches it)`,
      guild.hasFooter === false,
      JSON.stringify({ hasFooter: guild.hasFooter }),
    );
    check(
      `${profile.name} guild pane keeps the INNER .bank-scroll as its scroller`,
      !!guild.innerScroll,
      JSON.stringify(guild.innerScroll),
    );
    check(
      `${profile.name} guild pane CHROME is inside the window border`,
      guild.chromeOutside.length === 0,
      JSON.stringify(guild.chromeOutside),
    );
    console.log(`[${profile.name}] guild chrome: ${JSON.stringify(guild.chrome)}`);
    check(
      `${profile.name} guild pane has no zero-box control`,
      guild.zeroBox === 0,
      JSON.stringify(guild.zeroBox),
    );
    check(
      `${profile.name} guild pane holds the 40px touch floor`,
      guild.underFloor.length === 0,
      JSON.stringify(guild.underFloor),
    );

    // The scroll-offset seam on the guild path: write, repaint, read back.
    const off = await page.evaluate(async () => {
      const win = document.querySelector('#bank-window');
      const inner = win.querySelector('.bank-scroll');
      if (!inner) return { skipped: 'no inner scroller' };
      const range = inner.scrollHeight - inner.clientHeight;
      if (range <= 10) return { skipped: `inner range only ${range}` };
      inner.scrollTop = Math.min(60, range);
      const before = inner.scrollTop;
      const winBefore = win.scrollTop;
      return { before, winBefore, range };
    });
    console.log(`[${profile.name}] guild scroll seam BEFORE: ${JSON.stringify(off)}`);
    if (!off.skipped) {
      await sleep(2500); // let a real repaint land (the pane repaints on bank data)
      const after = await page.evaluate(() => {
        const win = document.querySelector('#bank-window');
        const inner = win.querySelector('.bank-scroll');
        return { innerAfter: inner ? inner.scrollTop : null, winAfter: win.scrollTop };
      });
      console.log(`[${profile.name}] guild scroll seam AFTER:  ${JSON.stringify(after)}`);
      check(
        `${profile.name} guild pane keeps its inner scroll offset across a repaint`,
        after.innerAfter === off.before,
        JSON.stringify({ ...off, ...after }),
      );
    }
  } catch (e) {
    fail++;
    console.log('FAIL', profile.name, 'threw:', e.message);
  }
  await browser.close();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
